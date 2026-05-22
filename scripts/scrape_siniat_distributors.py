import json
import re
import time
from dataclasses import dataclass, asdict
from html import unescape
from pathlib import Path
from urllib.parse import urljoin
from urllib.request import Request, urlopen

from lxml import html


WORKSPACE_DIR = Path(__file__).resolve().parents[1]
OUTPUT_DIR = WORKSPACE_DIR / "outputs" / "siniat_distributors"
SOURCE_URL = "https://www.siniat.com.au/en-au/contact-us/siniat-distributors/"


@dataclass
class ListingLink:
    source_order: int
    region_group: str
    listing_name: str
    url: str


def fetch_text(url: str) -> str:
    request = Request(
        url,
        headers={
            "User-Agent": "Mozilla/5.0",
            "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        },
    )
    with urlopen(request, timeout=40) as response:
        return response.read().decode("utf-8", errors="replace")


def clean_text(value: str | None) -> str:
    if not value:
        return ""
    text = unescape(value)
    replacements = {
        "\u00e2\u20ac\u201c": "-",
        "\u00e2\u20ac\u201d": "-",
        "\u00e2\u20ac\u2122": "'",
        "\u00e2\u20ac\u0153": '"',
        "\u00e2\u20ac\ufffd": '"',
        "\u2013": "-",
        "\u2014": "-",
        "\u2018": "'",
        "\u2019": "'",
        "\u201c": '"',
        "\u201d": '"',
    }
    for old, new in replacements.items():
        text = text.replace(old, new)
    return re.sub(r"\s+", " ", text).strip()


def node_text_lines(node) -> list[str]:
    raw = html.tostring(node, encoding="unicode", method="html")
    raw = re.sub(r"(?i)<br\s*/?>", "\n", raw)
    raw = re.sub(r"(?i)</(p|div|li|h[1-6])>", "\n", raw)
    text = html.fromstring(raw).text_content()
    return [clean_text(line) for line in text.splitlines() if clean_text(line)]


def parse_listing(root_html: str) -> list[ListingLink]:
    doc = html.fromstring(root_html)
    links: list[ListingLink] = []
    order = 1
    for heading in doc.xpath("//h4"):
        region = clean_text(heading.text_content()).replace("\xa0", " ").strip()
        if not region or region.lower() in {"contact"}:
            continue
        ul = heading.getnext()
        while ul is not None and ul.tag.lower() != "ul":
            ul = ul.getnext()
        if ul is None:
            continue
        for anchor in ul.xpath(".//a[@href]"):
            text = clean_text(anchor.text_content())
            href = anchor.get("href")
            if not text or not href or "/siniat-distributors/" not in href:
                continue
            links.append(
                ListingLink(
                    source_order=order,
                    region_group=region,
                    listing_name=text,
                    url=urljoin(SOURCE_URL, href),
                )
            )
            order += 1
    return links


def first_match(pattern: str, text: str, flags: int = re.I) -> str:
    match = re.search(pattern, text, flags)
    return clean_text(match.group(1)) if match else ""


def state_from_region_group(region_group: str, address: str) -> str:
    address_match = re.search(r"\b(ACT|NSW|NT|QLD|SA|TAS|VIC|WA)\b", address, re.I)
    if address_match:
        return address_match.group(1).upper()
    if "|" not in region_group:
        return region_group.strip().upper()
    return ""


def postcode_from_address(address: str) -> str:
    match = re.search(r"\b(\d{4})\b", address)
    return match.group(1) if match else ""


def locality_from_address(address: str) -> str:
    match = re.search(r"\n?([^,\n]+?)\s+\b(?:ACT|NSW|NT|QLD|SA|TAS|VIC|WA)\b\s+\d{4}\b", address, re.I)
    if match:
        return clean_text(match.group(1))
    lines = [line for line in address.splitlines() if line.strip()]
    if len(lines) >= 2:
        candidate = re.sub(r"\b(ACT|NSW|NT|QLD|SA|TAS|VIC|WA)\b.*$", "", lines[-1], flags=re.I)
        return clean_text(candidate)
    return ""


def parse_detail(link: ListingLink, detail_html: str) -> dict:
    doc = html.fromstring(detail_html)
    contact_section = None
    sections = doc.xpath("//section[@id='desktop-orders']")
    if sections:
        contact_section = sections[0]
    if contact_section is None:
        sections = doc.xpath("//section[contains(@class, 'richText')]")
        for section in sections:
            if "Contact" in section.text_content():
                contact_section = section
                break

    heading = ""
    contact_lines: list[str] = []
    if contact_section is not None:
        heading_nodes = contact_section.xpath(".//h2[contains(@class, 'heading')]")
        if heading_nodes:
            heading = clean_text(heading_nodes[0].text_content())
        textblock_nodes = contact_section.xpath(".//*[contains(@class, 'textblock')]")
        if textblock_nodes:
            contact_lines = node_text_lines(textblock_nodes[0])
        else:
            contact_lines = node_text_lines(contact_section)

    detail_text = "\n".join(contact_lines)
    emails = sorted(set(re.findall(r"[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}", detail_text)))
    if not emails:
        emails = sorted(set(re.findall(r"[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}", detail_html)))

    website = ""
    if contact_section is not None:
        website_links = []
        for anchor in contact_section.xpath(".//a[@href]"):
            href = clean_text(anchor.get("href"))
            text = clean_text(anchor.text_content())
            if href.startswith("mailto:"):
                continue
            if href.startswith("http") or "www." in text:
                website_links.append(href if href.startswith("http") else text)
        if website_links:
            website = website_links[0]
    if not website:
        website = first_match(r"\bW\s*:\s*(\S+)", detail_text)

    phone = first_match(r"\bP\s*:\s*([^\n]+)", detail_text)
    if not phone:
        phone = first_match(r"\bPhone\s*:\s*([^\n]+)", detail_text)
    phone = re.sub(r"\s+", " ", phone).strip()

    address_lines: list[str] = []
    in_contact = False
    for line in contact_lines:
        if re.fullmatch(r"Contact", line, re.I):
            in_contact = True
            continue
        if not in_contact:
            continue
        if re.match(r"^(P|E|W)\s*:", line, re.I) or re.match(r"^Opening Times\b", line, re.I):
            break
        if line and line != "\xa0":
            address_lines.append(line)
    address = "\n".join(address_lines)
    address_single_line = clean_text(", ".join(address_lines))

    opening_lines: list[str] = []
    for index, line in enumerate(contact_lines):
        if re.match(r"^Opening Times\b", line, re.I):
            opening_lines = contact_lines[index + 1 :]
            break
    if opening_lines:
        stop_words = {"About Us", "Sign up to MySiniat"}
        trimmed: list[str] = []
        for line in opening_lines:
            if line in stop_words:
                break
            trimmed.append(line)
        opening_lines = trimmed

    title = first_match(r"<title>(.*?)</title>", detail_html, flags=re.I | re.S)
    return {
        "sourceOrder": link.source_order,
        "regionGroup": link.region_group,
        "distributorType": "Siniat Distributor",
        "listingName": link.listing_name,
        "name": heading or link.listing_name,
        "phone": phone,
        "email": "; ".join(emails),
        "website": website,
        "address": address_single_line,
        "addressLines": address,
        "locality": locality_from_address(address),
        "state": state_from_region_group(link.region_group, address),
        "postcode": postcode_from_address(address),
        "openingHours": " | ".join(opening_lines),
        "sourceUrl": link.url,
        "sourceListingUrl": SOURCE_URL,
        "pageTitle": title,
        "rawContactText": detail_text,
    }


def main() -> None:
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    root_html = fetch_text(SOURCE_URL)
    links = parse_listing(root_html)
    records = []
    for link in links:
        detail_html = fetch_text(link.url)
        records.append(parse_detail(link, detail_html))
        time.sleep(0.05)

    payload = {
        "sourceUrl": SOURCE_URL,
        "scrapedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "count": len(records),
        "links": [asdict(link) for link in links],
        "records": records,
    }
    output_path = OUTPUT_DIR / "siniat_distributors.json"
    output_path.write_text(json.dumps(payload, indent=2, ensure_ascii=False), encoding="utf-8")
    missing = {
        "phone": [r["name"] for r in records if not r["phone"]],
        "email": [r["name"] for r in records if not r["email"]],
        "address": [r["name"] for r in records if not r["address"]],
        "state": [r["name"] for r in records if not r["state"]],
    }
    print(json.dumps({"output": str(output_path), "count": len(records), "missing": missing}, indent=2))


if __name__ == "__main__":
    main()
