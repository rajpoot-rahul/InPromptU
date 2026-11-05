"""Deterministic output checks: JSON parsing, schema, grounding, context and arithmetic."""

from __future__ import annotations

import json
import math
import re
from dataclasses import asdict, dataclass
from decimal import Decimal

from jsonschema import Draft202012Validator

from .normalize import (
    CENT,
    amount_candidates,
    amount_in,
    currency_in_source,
    date_candidates,
    norm_text,
    exact_in_source,
    text_in_source,
    to_decimal,
)


@dataclass
class Issue:
    field: str
    kind: str  # parse | schema | ungrounded | context | arithmetic
    message: str

    def to_dict(self) -> dict:
        return asdict(self)


def _has_non_finite(value: object) -> bool:
    if isinstance(value, float):
        return not math.isfinite(value)
    if isinstance(value, dict):
        return any(_has_non_finite(v) for v in value.values())
    if isinstance(value, list):
        return any(_has_non_finite(v) for v in value)
    return False


def parse_json_output(text: str) -> tuple[dict | None, str | None]:
    """Parse model output, tolerating Markdown code fences and surrounding prose."""
    candidate = text.strip()
    fenced = re.search(r"```(?:json)?\s*(.*?)```", candidate, re.DOTALL)
    if fenced:
        candidate = fenced.group(1).strip()
    for attempt in (candidate, candidate[candidate.find("{"): candidate.rfind("}") + 1]):
        if not attempt:
            continue
        try:
            value = json.loads(attempt, parse_constant=lambda name: float("nan"))
        except json.JSONDecodeError:
            continue
        if not isinstance(value, dict):
            return None, "Output is JSON but not an object."
        if _has_non_finite(value):
            return None, "Output contains a number that is not a real value (infinity or NaN)."
        return value, None
    return None, "Output is not valid JSON."


def schema_issues(output: dict, schema: dict) -> list[Issue]:
    validator = Draft202012Validator(schema)
    issues = []
    for error in sorted(validator.iter_errors(output), key=lambda e: list(e.path)):
        path = ".".join(str(p) for p in error.path) or "(root)"
        issues.append(Issue(path, "schema", f"{path}: {error.message}"))
    return issues


def _is_zero(value: object) -> bool:
    parsed = to_decimal(value)
    return parsed is not None and parsed == 0


def grounding_issues(output: dict, source: str, template: dict) -> list[Issue]:
    """Values that cannot be found in the source text, after normalising formats."""
    cfg = template.get("grounding", {})
    amounts = amount_candidates(source)
    dates = date_candidates(source)
    source_lines = source.splitlines()
    issues = []

    for field in cfg.get("text_fields", []):
        value = output.get(field)
        if value in (None, ""):
            continue
        if field in cfg.get("exact_text_fields", []):
            if not exact_in_source(str(value), source):
                issues.append(Issue(field, "ungrounded", f"{field} '{value}' does not appear exactly as printed in the document."))
        elif not text_in_source(str(value), source):
            issues.append(Issue(field, "ungrounded", f"{field} '{value}' does not appear in the document."))

    for field in cfg.get("date_fields", []):
        value = output.get(field)
        if value in (None, ""):
            continue
        readings = date_candidates(str(value))
        if not readings & dates:
            issues.append(Issue(field, "ungrounded", f"{field} '{value}' does not match any date in the document."))

    zero_ok = set(cfg.get("zero_needs_no_source", []))
    for field in cfg.get("amount_fields", []):
        value = output.get(field)
        if value is None or (field in zero_ok and _is_zero(value)):
            continue
        if not amount_in(value, amounts):
            issues.append(Issue(field, "ungrounded", f"{field} {value} does not appear in the document."))

    currency_field = cfg.get("currency_field")
    if currency_field and output.get(currency_field) not in (None, ""):
        if not currency_in_source(str(output[currency_field]), source):
            issues.append(Issue(currency_field, "ungrounded",
                                f"{currency_field} '{output[currency_field]}' is not shown in the document."))

    items_field = cfg.get("line_items_field")
    items = output.get(items_field) if items_field else None
    if isinstance(items, list):
        for n, item in enumerate(items):
            if not isinstance(item, dict):
                continue
            prefix = f"{items_field}[{n}]"
            description = item.get("description")
            if description not in (None, "") and not text_in_source(str(description), source):
                issues.append(Issue(f"{prefix}.description", "ungrounded",
                                    f"{prefix}.description '{description}' does not appear in the document."))
            for key in ("quantity", "unit_price", "amount"):
                value = item.get(key)
                if value is not None and not amount_in(value, amounts):
                    issues.append(Issue(f"{prefix}.{key}", "ungrounded",
                                        f"{prefix}.{key} {value} does not appear in the document."))
            if cfg.get("line_items_same_line") and description not in (None, "") and item.get("amount") is not None:
                desc_lines = [line for line in source_lines if text_in_source(str(description), line)]
                if desc_lines and not any(amount_in(item.get("amount"), amount_candidates(line)) for line in desc_lines):
                    issues.append(Issue(f"{prefix}.amount", "ungrounded",
                                        f"{prefix}: amount {item.get('amount')} is not on the same line as '{description}'."))

    for field in cfg.get("text_list_fields", []):
        values = output.get(field)
        if isinstance(values, list):
            for n, value in enumerate(values):
                if value not in (None, "") and not text_in_source(str(value), source):
                    issues.append(Issue(f"{field}[{n}]", "ungrounded",
                                        f"{field}[{n}] '{value}' does not appear in the document."))

    for field, keys in cfg.get("object_list_text_fields", {}).items():
        values = output.get(field)
        if isinstance(values, list):
            for n, item in enumerate(values):
                if not isinstance(item, dict):
                    continue
                for key in keys:
                    value = item.get(key)
                    if value not in (None, "") and not text_in_source(str(value), source):
                        issues.append(Issue(f"{field}[{n}].{key}", "ungrounded",
                                            f"{field}[{n}].{key} '{value}' does not appear word for word in the document."))

    for field in cfg.get("no_new_numbers_fields", []):
        value = output.get(field)
        if isinstance(value, str):
            new = sorted(n for n in amount_candidates(value) if n not in amounts)
            if new:
                listed = ", ".join(str(n.normalize()) for n in new)
                issues.append(Issue(field, "ungrounded", f"{field} mentions numbers that are not in the document: {listed}."))

    flag = cfg.get("meaningful_flag")
    if flag and output.get(flag) is False:
        words = re.findall(r"[^\W\d_]{3,}", source)
        if len(words) >= cfg.get("meaningful_min_words", 8):
            issues.append(Issue(flag, "ungrounded",
                                f"{flag} is false, but the text has {len(words)} words and looks like real content."))
    return issues


def _line_numbers_containing(field: str, value: object, lines: list[str], template: dict) -> list[int]:
    cfg = template.get("grounding", {})
    if field in cfg.get("date_fields", []):
        readings = date_candidates(str(value))
        return [n for n, line in enumerate(lines) if readings & date_candidates(line)]
    if field in cfg.get("amount_fields", []):
        return [n for n, line in enumerate(lines) if amount_in(value, amount_candidates(line))]
    return [n for n, line in enumerate(lines) if text_in_source(str(value), line)]


def context_issues(output: dict, source: str, template: dict) -> list[Issue]:
    """A value must appear on at least one line where neither that line nor the
    `lookback` lines above it carry a forbidden label (e.g. 'Due Date', 'Bill To')."""
    issues = []
    lines = source.splitlines()
    for field, rule in template.get("context_rules", {}).items():
        if isinstance(rule, list):
            rule = {"forbidden": rule, "lookback": 0}
        forbidden, lookback = rule["forbidden"], rule.get("lookback", 0)
        value = output.get(field)
        if value in (None, ""):
            continue
        hits = _line_numbers_containing(field, value, lines, template)
        if not hits:
            continue  # already reported as ungrounded

        def labelled(n: int) -> bool:
            window = " ".join(norm_text(lines[i]) for i in range(max(0, n - lookback), n + 1))
            return any(word in window for word in forbidden)

        if all(labelled(n) for n in hits):
            labels = ", ".join(f"'{w}'" for w in forbidden)
            issues.append(Issue(field, "context",
                                f"{field} '{value}' only appears next to labels {labels}; it is probably the wrong value."))
    return issues


def arithmetic_issues(output: dict, template: dict) -> list[Issue]:
    tolerance = Decimal(str(template.get("arithmetic", {}).get("tolerance", 0.01)))
    issues = []
    items = output.get("line_items")
    if isinstance(items, list):
        for n, item in enumerate(items):
            if not isinstance(item, dict):
                continue
            qty, unit, amount = (to_decimal(item.get(k)) for k in ("quantity", "unit_price", "amount"))
            if None not in (qty, unit, amount) and abs(qty * unit - amount) > tolerance:
                issues.append(Issue(f"line_items[{n}]", "arithmetic",
                                    f"line_items[{n}]: quantity x unit_price = {(qty * unit).quantize(CENT)}, not {amount}."))
        line_amounts = [to_decimal(i.get("amount")) for i in items if isinstance(i, dict)]
        subtotal = to_decimal(output.get("subtotal"))
        if subtotal is not None and line_amounts and None not in line_amounts:
            line_sum = sum(line_amounts, Decimal("0"))
            if abs(line_sum - subtotal) > tolerance:
                issues.append(Issue("subtotal", "arithmetic",
                                    f"Line item amounts add up to {line_sum.quantize(CENT)}, but subtotal is {subtotal}."))
    subtotal, discount, tax, total = (to_decimal(output.get(k)) for k in ("subtotal", "discount", "tax", "total"))
    if None not in (subtotal, discount, tax, total):
        expected = subtotal - discount + tax
        if abs(expected - total) > tolerance:
            issues.append(Issue("total", "arithmetic",
                                f"subtotal - discount + tax = {expected.quantize(CENT)}, but total is {total}."))
    return issues


def validate_output(output: dict, source: str, template: dict) -> list[Issue]:
    """Run every check. Schema failures stop further checks because types are unreliable."""
    issues = schema_issues(output, template["output_schema"])
    if issues:
        return issues
    arithmetic = arithmetic_issues(output, template) if "arithmetic" in template else []
    return (grounding_issues(output, source, template)
            + context_issues(output, source, template)
            + arithmetic)


def check_report(output: dict | None, source: str, template: dict) -> list[dict]:
    """Every check as {name, group, passed, details}, for display.

    Unlike validate_output, all groups run even when the schema fails, so a
    viewer can see what a fuller check would have found.
    """
    if not isinstance(output, dict):
        return [{"name": "Answer is valid JSON", "group": "format", "passed": False,
                 "details": ["The answer could not be read as a JSON object."]}]

    schema = schema_issues(output, template["output_schema"])
    grounding = grounding_issues(output, source, template)
    context = context_issues(output, source, template)
    arithmetic = arithmetic_issues(output, template) if "arithmetic" in template else []

    def item(name: str, group: str, found: list[Issue], skipped: bool = False) -> dict:
        passed = False if found else (None if skipped else True)
        details = [i.message for i in found] or (["No value to check."] if skipped else [])
        return {"name": name, "group": group, "passed": passed, "details": details}

    def missing(value: object) -> bool:
        return value is None or value == "" or value == [] or value == {}

    items = output.get(template.get("grounding", {}).get("line_items_field") or "line_items")
    item_dicts = [i for i in items if isinstance(i, dict)] if isinstance(items, list) else []
    amounts = {k: to_decimal(output.get(k)) for k in ("subtotal", "discount", "tax", "total")}

    report = [item("Answer is valid JSON", "format", []),
              item("Matches the required format", "format", schema)]
    cfg = template.get("grounding", {})
    for field in [*cfg.get("text_fields", []), *cfg.get("date_fields", []), *cfg.get("amount_fields", [])]:
        report.append(item(f"{field} appears in the document", "grounding",
                           [i for i in grounding if i.field == field], skipped=missing(output.get(field))))
    if cfg.get("currency_field"):
        cur = cfg["currency_field"]
        report.append(item(f"{cur} appears in the document", "grounding",
                           [i for i in grounding if i.field == cur], skipped=missing(output.get(cur))))
    if cfg.get("line_items_field"):
        prefix = f"{cfg['line_items_field']}["
        report.append(item("Every line item appears in the document", "grounding",
                           [i for i in grounding if i.field.startswith(prefix)], skipped=not item_dicts))
    for field, rule in template.get("context_rules", {}).items():
        name = rule.get("check", f"{field} is taken from the right line") if isinstance(rule, dict) else f"{field} context"
        report.append(item(name, "context", [i for i in context if i.field == field], skipped=missing(output.get(field))))
    for field in cfg.get("text_list_fields", []):
        report.append(item(f"Every item in {field} appears in the document", "grounding",
                           [i for i in grounding if i.field.startswith(f"{field}[")], skipped=missing(output.get(field))))
    for field, keys in cfg.get("object_list_text_fields", {}).items():
        for key in keys:
            report.append(item(f"Every {field} {key} appears word for word in the document", "grounding",
                               [i for i in grounding if i.field.startswith(f"{field}[") and i.field.endswith(f".{key}")],
                               skipped=missing(output.get(field))))
    for field in cfg.get("no_new_numbers_fields", []):
        report.append(item(f"{field} mentions no numbers that are not in the document", "grounding",
                           [i for i in grounding if i.field == field], skipped=missing(output.get(field))))
    if cfg.get("meaningful_flag"):
        flag = cfg["meaningful_flag"]
        report.append(item("'No meaningful content' is only used for text without real content", "grounding",
                           [i for i in grounding if i.field == flag], skipped=output.get(flag) is None))
    if "arithmetic" not in template:
        return report
    report.append(item("Each line: quantity × unit price = amount", "arithmetic",
                       [i for i in arithmetic if i.field.startswith("line_items[")], skipped=not item_dicts))
    report.append(item("Line items add up to the subtotal", "arithmetic", [i for i in arithmetic if i.field == "subtotal"],
                       skipped=not item_dicts or amounts["subtotal"] is None))
    report.append(item("Total = subtotal − discount + tax", "arithmetic", [i for i in arithmetic if i.field == "total"],
                       skipped=any(v is None for v in amounts.values())))
    return report
