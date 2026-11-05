"""Normalisation helpers for comparing extracted values with source text."""

from __future__ import annotations

import re
import unicodedata
from datetime import date
from decimal import Decimal, InvalidOperation

CENT = Decimal("0.01")

MONTHS = {
    "jan": 1, "january": 1, "feb": 2, "february": 2, "mar": 3, "march": 3,
    "apr": 4, "april": 4, "may": 5, "jun": 6, "june": 6, "jul": 7, "july": 7,
    "aug": 8, "august": 8, "sep": 9, "sept": 9, "september": 9, "oct": 10,
    "october": 10, "nov": 11, "november": 11, "dec": 12, "december": 12,
}

CURRENCY_SYMBOLS = {"₹": "INR", "rs.": "INR", "$": "USD", "€": "EUR", "£": "GBP"}

_NUMBER_RE = re.compile(r"\d(?:[\d,.]*\d)?")
_ISO_RE = re.compile(r"(?<!\d)(\d{4})-(\d{1,2})-(\d{1,2})(?!\d)")
_NUMERIC_DATE_RE = re.compile(r"(?<!\d)(\d{1,2})[/.\-](\d{1,2})[/.\-](\d{4})(?!\d)")
_DAY_MONTH_RE = re.compile(r"(?<!\d)(\d{1,2})(?:st|nd|rd|th)?[\s\-]+([A-Za-z]{3,9})\.?[\s\-,]+(\d{4})(?!\d)")
_MONTH_DAY_RE = re.compile(r"\b([A-Za-z]{3,9})\.?\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(\d{4})(?!\d)")


def norm_text(value: str) -> str:
    """Case-fold and reduce text to words separated by single spaces."""
    value = unicodedata.normalize("NFKC", str(value)).casefold()
    value = "".join(ch for ch in value if unicodedata.category(ch) != "Cf")
    return re.sub(r"[^\w]+", " ", value).strip()


def text_in_source(value: str, source: str) -> bool:
    needle = norm_text(value)
    return bool(needle) and f" {needle} " in f" {norm_text(source)} "


def norm_exact(value: str) -> str:
    value = unicodedata.normalize("NFKC", str(value)).casefold()
    value = "".join(ch for ch in value if unicodedata.category(ch) != "Cf")
    return re.sub(r"\s+", " ", value).strip()


def exact_in_source(value: str, source: str) -> bool:
    """Like text_in_source, but punctuation must match (case and spacing are ignored)."""
    needle = norm_exact(value)
    if not needle:
        return False
    return re.search(rf"(?<!\w){re.escape(needle)}(?!\w)", norm_exact(source)) is not None


def parse_number(token: str) -> Decimal | None:
    """Parse a number written with US, Indian or European separators.

    When both ',' and '.' appear, the last one is the decimal separator.
    A single ',' followed by exactly two digits is treated as a decimal comma.
    """
    token = token.strip()
    if not token:
        return None
    has_comma, has_dot = "," in token, "." in token
    if has_comma and has_dot:
        if token.rfind(",") > token.rfind("."):
            token = token.replace(".", "").replace(",", ".")
        else:
            token = token.replace(",", "")
    elif has_comma:
        parts = token.split(",")
        if len(parts) == 2 and len(parts[1]) == 2:
            token = token.replace(",", ".")
        else:
            token = token.replace(",", "")
    elif has_dot and token.count(".") > 1:
        token = token.replace(".", "")
    try:
        return Decimal(token)
    except InvalidOperation:
        return None


def to_decimal(value: object) -> Decimal | None:
    """Leniently convert an extracted value (number or string) to a finite Decimal."""
    if isinstance(value, bool) or value is None:
        return None
    parsed: Decimal | None = None
    if isinstance(value, (int, float)):
        parsed = Decimal(str(value))
    elif isinstance(value, str):
        match = _NUMBER_RE.search(value)
        parsed = parse_number(match.group(0)) if match else None
    return parsed if parsed is not None and parsed.is_finite() else None


def amount_candidates(text: str) -> set[Decimal]:
    found = set()
    for match in _NUMBER_RE.finditer(text):
        parsed = parse_number(match.group(0))
        if parsed is not None:
            found.add(parsed.quantize(CENT))
    return found


def amount_in(value: object, candidates: set[Decimal]) -> bool:
    parsed = to_decimal(value)
    return parsed is not None and parsed.quantize(CENT) in candidates


def _iso(year: int, month: int, day: int) -> str | None:
    try:
        return date(year, month, day).isoformat()
    except ValueError:
        return None


def date_candidates(text: str) -> set[str]:
    """Every ISO date the text could mean. Numeric dates yield both D/M and M/D readings."""
    found: set[str | None] = set()
    for y, m, d in _ISO_RE.findall(text):
        found.add(_iso(int(y), int(m), int(d)))
    for a, b, y in _NUMERIC_DATE_RE.findall(text):
        found.add(_iso(int(y), int(b), int(a)))
        found.add(_iso(int(y), int(a), int(b)))
    for d, mon, y in _DAY_MONTH_RE.findall(text):
        if mon.casefold() in MONTHS:
            found.add(_iso(int(y), MONTHS[mon.casefold()], int(d)))
    for mon, d, y in _MONTH_DAY_RE.findall(text):
        if mon.casefold() in MONTHS:
            found.add(_iso(int(y), MONTHS[mon.casefold()], int(d)))
    found.discard(None)
    return found  # type: ignore[return-value]


def currency_in_source(code: str, source: str) -> bool:
    code = str(code).strip().upper()
    if not code:
        return False
    if re.search(rf"\b{re.escape(code)}\b", source.upper()):
        return True
    lowered = source.casefold()
    return any(symbol in lowered for symbol, iso in CURRENCY_SYMBOLS.items() if iso == code)


def currency_code(value: object) -> str | None:
    """Map an extracted currency value (code or symbol) to an ISO code."""
    if not isinstance(value, str) or not value.strip():
        return None
    text = value.strip()
    if re.fullmatch(r"[A-Za-z]{3}", text):
        return text.upper()
    return CURRENCY_SYMBOLS.get(text.casefold())
