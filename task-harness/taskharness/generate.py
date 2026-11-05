"""Synthetic invoice generator with known correct answers.

Documents deliberately include traps: customer names before the vendor, due dates
next to issue dates, PO numbers, discounts, previous balances, local number and
date formats, and whitespace noise.
"""

from __future__ import annotations

import json
import random
from datetime import date, timedelta
from decimal import ROUND_HALF_UP, Decimal
from pathlib import Path

CENT = Decimal("0.01")

LOCALES = {
    "IN": {
        "currency": "INR", "symbols": ["₹", "INR ", "Rs. "], "tax_label": "GST",
        "tax_rates": ["18", "12", "5"], "amount_style": "indian", "price_scale": Decimal("80"),
        "date_styles": ["dmy_slash", "dmy_dash_mon", "d_month_y"],
        "vendors": ["Sharma Tech Solutions Pvt. Ltd.", "Kaveri Office Supplies", "Nimbus Cloud Services India Pvt. Ltd.", "Lotus Print House"],
        "customers": ["Bharat Logistics Ltd.", "Greenleaf Hospitals", "Orbit Retail Pvt. Ltd."],
        "addresses": ["14 MG Road, Bengaluru 560001", "Plot 7, Sector 18, Gurugram 122015", "22 Anna Salai, Chennai 600002"],
        "tax_id": "GSTIN",
    },
    "US": {
        "currency": "USD", "symbols": ["$", "USD "], "tax_label": "Sales Tax",
        "tax_rates": ["8.25", "7", "6"], "amount_style": "us", "price_scale": Decimal("1"),
        "date_styles": ["mdy_slash", "mon_d_y"],
        "vendors": ["Blue Ridge Analytics LLC", "Summit Office Depot Inc.", "Cedar & Pine Consulting", "Northwind IT Services"],
        "customers": ["Lakeside Dental Group", "Harper & Cole Law Office", "Redwood Schools District"],
        "addresses": ["410 Market St, Denver, CO 80202", "88 Elm Ave, Austin, TX 78701", "1200 Pine Rd, Raleigh, NC 27601"],
        "tax_id": "EIN",
    },
    "DE": {
        "currency": "EUR", "symbols": ["€ ", "EUR "], "tax_label": "MwSt",
        "tax_rates": ["19", "7"], "amount_style": "eu", "price_scale": Decimal("0.9"),
        "date_styles": ["dmy_dot"],
        "vendors": ["Müller Bürotechnik GmbH", "Rheinland Software AG", "Schneider Logistik GmbH"],
        "customers": ["Klinikum Nordstadt", "Becker & Sohn KG", "Stadtwerke Hafenstadt"],
        "addresses": ["Hauptstraße 12, 50667 Köln", "Lindenallee 5, 10115 Berlin", "Am Markt 3, 80331 München"],
        "tax_id": "USt-IdNr.",
    },
    "UK": {
        "currency": "GBP", "symbols": ["£", "GBP "], "tax_label": "VAT",
        "tax_rates": ["20", "5"], "amount_style": "us", "price_scale": Decimal("0.8"),
        "date_styles": ["d_month_y", "dmy_slash"],
        "vendors": ["Thames Valley Print Ltd", "Harbour Digital Ltd", "Oakfield Facilities Management"],
        "customers": ["St Aidan's Primary School", "Northgate Housing Trust", "Pemberton Estates"],
        "addresses": ["5 Kings Road, Reading RG1 3AA", "19 Dock Street, Leeds LS10 1JF", "2 Mill Lane, Bristol BS1 4ST"],
        "tax_id": "VAT Reg No.",
    },
}

ITEMS = [
    ("Website maintenance (monthly)", 150, 600),
    ("Laptop docking station", 80, 250),
    ("Cloud storage 1 TB plan", 10, 60),
    ("On-site support visit", 90, 300),
    ("A4 copier paper (box of 5 reams)", 20, 45),
    ("Software licence - annual", 200, 1500),
    ("Network cable Cat6 (30 m)", 15, 40),
    ("Data migration service", 500, 2500),
    ("Ergonomic office chair", 120, 450),
    ("Printer toner cartridge", 40, 120),
]

MONTH_ABBR = ["", "Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]
MONTH_FULL = ["", "January", "February", "March", "April", "May", "June", "July", "August",
              "September", "October", "November", "December"]
SLASH_STYLES = {"dmy_slash", "mdy_slash"}


def money(value: Decimal) -> Decimal:
    return value.quantize(CENT, rounding=ROUND_HALF_UP)


def format_amount(value: Decimal, style: str) -> str:
    text = f"{money(value):,.2f}"
    if style == "eu":
        return text.replace(",", "_").replace(".", ",").replace("_", ".")
    if style == "indian":
        integer, fraction = f"{money(value):.2f}".split(".")
        if len(integer) > 3:
            head, tail = integer[:-3], integer[-3:]
            groups = []
            while len(head) > 2:
                groups.insert(0, head[-2:])
                head = head[:-2]
            if head:
                groups.insert(0, head)
            integer = ",".join(groups + [tail])
        return f"{integer}.{fraction}"
    return text


def format_date(value: date, style: str) -> str:
    d, m, y = value.day, value.month, value.year
    return {
        "dmy_slash": f"{d:02d}/{m:02d}/{y}",
        "mdy_slash": f"{m:02d}/{d:02d}/{y}",
        "dmy_dot": f"{d:02d}.{m:02d}.{y}",
        "dmy_dash_mon": f"{d:02d}-{MONTH_ABBR[m]}-{y}",
        "mon_d_y": f"{MONTH_ABBR[m]} {d}, {y}",
        "d_month_y": f"{d} {MONTH_FULL[m]} {y}",
    }[style]


def _invoice_number(rng: random.Random, year: int) -> str:
    style = rng.randrange(3)
    if style == 0:
        return f"INV-{year}-{rng.randint(1, 9999):04d}"
    if style == 1:
        return f"A/{year}/{rng.randint(100, 999)}"
    return str(rng.randint(10_000_000, 99_999_999))


def generate_invoice(rng: random.Random, doc_id: str) -> tuple[str, dict]:
    locale_key = rng.choice(sorted(LOCALES))
    loc = LOCALES[locale_key]
    style = loc["amount_style"]
    symbol = rng.choice(loc["symbols"])
    date_style = rng.choice(loc["date_styles"])
    vendor = rng.choice(loc["vendors"])
    customer = rng.choice(loc["customers"])
    vendor_addr, customer_addr = rng.sample(loc["addresses"], 2)

    issue_day = rng.randint(13, 28) if date_style in SLASH_STYLES else rng.randint(1, 28)
    issued = date(2026, rng.randint(1, 10), issue_day)
    due = issued + timedelta(days=rng.choice([15, 30, 45]))
    inv_no = _invoice_number(rng, issued.year)
    po_no = f"PO-{rng.randint(10000, 99999)}"
    cust_id = f"CUST-{rng.randint(100, 999)}"

    items = []
    for description, low, high in rng.sample(ITEMS, rng.randint(1, 5)):
        unit = money(Decimal(rng.randrange(low * 100, high * 100)) / 100 * loc["price_scale"])
        qty = rng.randint(1, 12)
        items.append({"description": description, "quantity": qty, "unit_price": unit, "amount": money(unit * qty)})
    subtotal = sum((i["amount"] for i in items), Decimal("0"))

    tricks = []
    discount_pct = rng.choice([5, 10]) if rng.random() < 0.3 else 0
    discount = money(subtotal * discount_pct / 100)
    if discount:
        tricks.append("discount")
    tax_rate = rng.choice(loc["tax_rates"])
    tax = money((subtotal - discount) * Decimal(tax_rate) / 100)
    total = subtotal - discount + tax
    previous = money(Decimal(rng.randrange(5000, 90000)) / 100 * loc["price_scale"]) if rng.random() < 0.25 else Decimal("0")
    if previous:
        tricks.append("previous_balance")

    fa = lambda v: format_amount(v, style)  # noqa: E731
    fd = lambda v: format_date(v, date_style)  # noqa: E731

    meta = [
        f"{rng.choice(['Invoice No.', 'Invoice #', 'Invoice Number'])}: {inv_no}",
        f"{rng.choice(['Invoice Date', 'Date of Issue', 'Date'])}: {fd(issued)}",
        f"Due Date: {fd(due)}",
        f"PO Number: {po_no}",
        f"Customer ID: {cust_id}",
    ]
    rng.shuffle(meta)
    if meta.index(next(m for m in meta if m.startswith("Due"))) < 2:
        tricks.append("due_date_early")

    totals = [f"Subtotal: {symbol}{fa(subtotal)}"]
    if discount:
        totals.append(f"Discount ({discount_pct}%): -{symbol}{fa(discount)}")
    totals.append(f"{loc['tax_label']} ({tax_rate}%): {symbol}{fa(tax)}")
    totals.append(f"{rng.choice(['Total', 'Invoice Total', 'Grand Total'])}: {symbol}{fa(total)}")
    if previous:
        totals.append(f"Previous Balance: {symbol}{fa(previous)}")
        totals.append(f"Amount Due: {symbol}{fa(total + previous)}")
    elif rng.random() < 0.4:
        totals.append(f"Amount Due: {symbol}{fa(total)}")

    layout = rng.choice(["A", "B", "C"])
    if layout == "C":
        item_lines = ["Items:"] + [
            f"{n}. {i['description']} - Qty {i['quantity']} x {fa(i['unit_price'])} = {fa(i['amount'])}"
            for n, i in enumerate(items, 1)
        ]
    else:
        item_lines = [f"{'Description':<36}{'Qty':>5}{'Unit Price':>14}{'Amount':>14}"]
        item_lines += [
            f"{i['description']:<36}{i['quantity']:>5}{fa(i['unit_price']):>14}{fa(i['amount']):>14}" for i in items
        ]
    tax_id_line = f"{loc['tax_id']}: {rng.randint(10**9, 10**10 - 1)}"

    if layout == "A":
        blocks = [[vendor, vendor_addr, tax_id_line], [rng.choice(["INVOICE", "TAX INVOICE"])], meta,
                  ["Bill To:", customer, customer_addr], item_lines, totals, ["Thank you for your business."]]
    elif layout == "B":
        tricks.append("customer_first")
        blocks = [["TAX INVOICE"], ["Bill To:", customer, customer_addr], ["From:", vendor, vendor_addr, tax_id_line],
                  meta, item_lines, totals, [f"Please make payment to {vendor.rstrip('.')}."]]
    else:
        blocks = [["INVOICE"], [f"Customer: {customer}", f"Customer address: {customer_addr}"],
                  [f"Supplier: {vendor}", f"Supplier address: {vendor_addr}", tax_id_line], meta, item_lines, totals]
        tricks.append("customer_first")

    text = "\n\n".join("\n".join(block) for block in blocks) + "\n"
    if rng.random() < 0.3:
        tricks.append("noise")
        text = text.replace(f"{symbol}", f"{symbol.strip()}\u00a0", 2).replace("\n\n", "\n\n\n", 2)
        text = "\n".join(line + "  " for line in text.split("\n")).replace("\n", "\r\n")

    expected = {
        "vendor_name": vendor,
        "invoice_number": inv_no,
        "invoice_date": issued.isoformat(),
        "currency": loc["currency"],
        "subtotal": float(subtotal),
        "discount": float(discount),
        "tax": float(tax),
        "total": float(total),
        "line_items": [
            {"description": i["description"], "quantity": i["quantity"],
             "unit_price": float(i["unit_price"]), "amount": float(i["amount"])}
            for i in items
        ],
    }
    label = {"doc_id": doc_id, "meta": {"locale": locale_key, "layout": layout, "tricks": sorted(set(tricks))},
             "expected": expected}
    return text, label


def generate_dataset(out_dir: Path, count: int, seed: int) -> list[str]:
    rng = random.Random(seed)
    docs_dir, labels_dir = out_dir / "invoices", out_dir / "labels"
    docs_dir.mkdir(parents=True, exist_ok=True)
    labels_dir.mkdir(parents=True, exist_ok=True)
    for old in [*docs_dir.glob("inv_*.txt"), *labels_dir.glob("inv_*.json")]:
        old.unlink()  # a smaller regeneration must not leave earlier invoices behind
    ids = []
    for n in range(1, count + 1):
        doc_id = f"inv_{n:03d}"
        text, label = generate_invoice(rng, doc_id)
        (docs_dir / f"{doc_id}.txt").write_bytes(text.encode("utf-8"))
        (labels_dir / f"{doc_id}.json").write_text(json.dumps(label, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
        ids.append(doc_id)
    return ids


def load_dataset(data_dir: Path) -> list[dict]:
    """Return [{doc_id, text, label}] for every invoice with a matching label file."""
    items = []
    for doc_path in sorted((data_dir / "invoices").glob("*.txt")):
        label_path = data_dir / "labels" / f"{doc_path.stem}.json"
        if not label_path.exists():
            continue
        items.append({
            "doc_id": doc_path.stem,
            "text": doc_path.read_bytes().decode("utf-8"),
            "label": json.loads(label_path.read_text(encoding="utf-8")),
        })
    return items
