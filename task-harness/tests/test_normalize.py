from decimal import Decimal

from taskharness.normalize import (
    amount_candidates,
    currency_code,
    currency_in_source,
    date_candidates,
    parse_number,
    text_in_source,
    to_decimal,
)


def test_parse_number_handles_regional_formats():
    assert parse_number("1,20,000.00") == Decimal("120000.00")
    assert parse_number("1.200,50") == Decimal("1200.50")
    assert parse_number("4,956.82") == Decimal("4956.82")
    assert parse_number("1,200") == Decimal("1200")
    assert parse_number("12,50") == Decimal("12.50")


def test_to_decimal_strips_currency_text():
    assert to_decimal("₹1,57,520.16") == Decimal("157520.16")
    assert to_decimal("EUR 1.234,56") == Decimal("1234.56")
    assert to_decimal(12) == Decimal("12")
    assert to_decimal(True) is None
    assert to_decimal("n/a") is None


def test_amount_candidates_find_table_values():
    found = amount_candidates("Laptop docking station   10   79.49   794.90")
    assert {Decimal("10.00"), Decimal("79.49"), Decimal("794.90")} <= found


def test_date_candidates_cover_common_formats():
    assert "2026-10-24" in date_candidates("Invoice Date: 24/10/2026")
    assert "2026-11-05" in date_candidates("05.11.2026")
    assert "2026-11-05" in date_candidates("05-Nov-2026")
    assert "2026-11-05" in date_candidates("Nov 5, 2026")
    assert "2026-11-05" in date_candidates("5 November 2026")
    assert "2026-11-05" in date_candidates("2026-11-05")
    assert date_candidates("05/11/2026") == {"2026-11-05", "2026-05-11"}


def test_text_in_source_ignores_case_punctuation_and_invisible_chars():
    source = "From:\nSharma Tech Solutions Pvt. Ltd.\n"
    assert text_in_source("sharma tech solutions pvt ltd", source)
    assert text_in_source("Sharma\u200b Tech Solutions Pvt. Ltd.", source)
    assert not text_in_source("Sharma Tech", "Sharmatech")


def test_currency_helpers():
    assert currency_in_source("INR", "Total: ₹1,000.00")
    assert currency_in_source("GBP", "Total: GBP 10.00")
    assert not currency_in_source("USD", "Total: €10,00")
    assert currency_code("€") == "EUR"
    assert currency_code("usd") == "USD"
