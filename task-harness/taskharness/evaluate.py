"""Score results against labels and build the before/after comparison."""

from __future__ import annotations

import csv
from decimal import Decimal
from pathlib import Path

from jsonschema import Draft202012Validator

from .normalize import CENT, currency_code, date_candidates, norm_exact, norm_text, to_decimal
from .preprocess import clean
from .validate import grounding_issues

FIELDS = ["vendor_name", "invoice_number", "invoice_date", "currency",
          "subtotal", "discount", "tax", "total", "line_items"]
AMOUNT_FIELDS = {"subtotal", "discount", "tax", "total"}


def _same_amount(got: object, expected: float) -> bool:
    parsed = to_decimal(got)
    return parsed is not None and parsed.quantize(CENT) == Decimal(str(expected)).quantize(CENT)


def _same_item(got: object, expected: dict) -> bool:
    return (isinstance(got, dict)
            and norm_text(str(got.get("description", ""))) == norm_text(expected["description"])
            and all(_same_amount(got.get(k), expected[k]) for k in ("quantity", "unit_price", "amount")))


def field_correct(field: str, got: object, expected: object) -> bool:
    """Lenient on format (a correct value in a different format still counts), strict on meaning."""
    if field in AMOUNT_FIELDS and expected == 0 and got in (None, "", "0", "none", "None"):
        return True
    if got is None:
        return False
    if field in AMOUNT_FIELDS:
        return _same_amount(got, expected)  # type: ignore[arg-type]
    if field == "invoice_date":
        return expected in date_candidates(str(got))
    if field == "currency":
        return currency_code(got) == expected
    if field == "line_items":
        if not isinstance(got, list) or len(got) != len(expected):  # type: ignore[arg-type]
            return False
        remaining = list(got)
        for item in expected:  # type: ignore[union-attr]
            match = next((g for g in remaining if _same_item(g, item)), None)
            if match is None:
                return False
            remaining.remove(match)
        return True
    if field == "invoice_number":
        return norm_exact(str(got)) == norm_exact(str(expected))
    return norm_text(str(got)) == norm_text(str(expected))


def score_result(result: dict, label: dict, raw_text: str, template: dict) -> dict:
    expected = label["expected"]
    output = result.get("output")
    if not isinstance(output, dict):
        output = None
    fields = {f: bool(output) and field_correct(f, output.get(f), expected[f]) for f in FIELDS}
    schema_ok = output is not None and not any(Draft202012Validator(template["output_schema"]).iter_errors(output))
    invented = len(grounding_issues(output, clean(raw_text), template)) if output else 0
    all_correct = all(fields.values())
    flagged = result.get("status") in ("flagged", "rejected")
    delivered = result.get("status") in ("passed", "unchecked")
    return {
        "doc_id": result["doc_id"],
        "mode": result["mode"],
        "status": result.get("status"),
        "fields": fields,
        "all_correct": all_correct,
        "schema_ok": schema_ok,
        "invented_values": invented,
        "flagged": flagged,
        "silent_error": not all_correct and delivered,
        "latency_ms": result.get("latency_ms", 0.0),
        "tokens": result.get("prompt_tokens", 0) + result.get("completion_tokens", 0),
        "attempts": len(result.get("attempts", [])),
        "tricks": label.get("meta", {}).get("tricks", []),
    }


def summarize(scores: list[dict]) -> dict:
    n = len(scores)
    if n == 0:
        return {"docs": 0}
    field_hits = sum(sum(s["fields"].values()) for s in scores)
    wrong = [s for s in scores if not s["all_correct"]]
    return {
        "mode": scores[0]["mode"],
        "docs": n,
        "fully_correct": sum(s["all_correct"] for s in scores),
        "field_accuracy": round(field_hits / (n * len(FIELDS)), 3),
        "format_errors": sum(not s["schema_ok"] for s in scores),
        "invented_values": sum(s["invented_values"] for s in scores),
        "flagged_for_review": sum(s["flagged"] for s in scores),
        "wrong_and_flagged": sum(s["flagged"] for s in wrong),
        "silent_errors": sum(s["silent_error"] for s in scores),
        "retries": sum(max(s["attempts"] - 1, 0) for s in scores),
        "api_errors": sum(s["status"] == "api_error" for s in scores),
        "avg_seconds": round(sum(s["latency_ms"] for s in scores) / n / 1000, 2),
        "total_tokens": sum(s["tokens"] for s in scores),
        "per_field_accuracy": {f: round(sum(s["fields"][f] for s in scores) / n, 3) for f in FIELDS},
    }


COLUMNS = [
    ("mode", "Mode"), ("docs", "Docs"), ("fully_correct", "Fully correct"),
    ("field_accuracy", "Field accuracy"), ("format_errors", "Format errors"),
    ("invented_values", "Invented values"), ("flagged_for_review", "Flagged"),
    ("silent_errors", "Silent errors"), ("retries", "Retries"), ("api_errors", "API errors"),
    ("avg_seconds", "Avg s/doc"), ("total_tokens", "Tokens"),
]


def format_table(summaries: list[dict]) -> str:
    headers = [title for _, title in COLUMNS]
    rows = [[str(s.get(key, "")) for key, _ in COLUMNS] for s in summaries]
    widths = [max(len(h), *(len(r[i]) for r in rows)) for i, h in enumerate(headers)]
    line = lambda cells: " | ".join(c.ljust(w) for c, w in zip(cells, widths))  # noqa: E731
    return "\n".join([line(headers), "-+-".join("-" * w for w in widths), *(line(r) for r in rows)])


def write_csv(summaries: list[dict], path: Path) -> None:
    with path.open("w", newline="", encoding="utf-8") as handle:
        writer = csv.writer(handle)
        writer.writerow([title for _, title in COLUMNS])
        for s in summaries:
            writer.writerow([s.get(key, "") for key, _ in COLUMNS])
