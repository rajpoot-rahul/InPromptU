import copy

import pytest

from taskharness.preprocess import clean
from taskharness.validate import parse_json_output, validate_output

DOC = clean("""TAX INVOICE

Bill To:
Orbit Retail Pvt. Ltd.
22 Anna Salai, Chennai 600002

From:
Sharma Tech Solutions Pvt. Ltd.
14 MG Road, Bengaluru 560001

Due Date: 28/10/2026
Invoice Date: 28/09/2026
PO Number: PO-86750
Invoice Number: A/2026/576

Description                           Qty    Unit Price        Amount
A4 copier paper (box of 5 reams)        2      2,399.20      4,798.40
Cloud storage 1 TB plan                 8      4,241.60     33,932.80

Subtotal: INR 38,731.20
Discount (10%): -INR 3,873.12
GST (5%): INR 1,742.90
Total: INR 36,600.98
Previous Balance: INR 5,000.00
Amount Due: INR 41,600.98
""")

GOOD = {
    "vendor_name": "Sharma Tech Solutions Pvt. Ltd.",
    "invoice_number": "A/2026/576",
    "invoice_date": "2026-09-28",
    "currency": "INR",
    "subtotal": 38731.20,
    "discount": 3873.12,
    "tax": 1742.90,
    "total": 36600.98,
    "line_items": [
        {"description": "A4 copier paper (box of 5 reams)", "quantity": 2, "unit_price": 2399.20, "amount": 4798.40},
        {"description": "Cloud storage 1 TB plan", "quantity": 8, "unit_price": 4241.60, "amount": 33932.80},
    ],
}


def with_change(**changes):
    out = copy.deepcopy(GOOD)
    out.update(changes)
    return out


def kinds(issues, field=None):
    return {(i.field, i.kind) for i in issues if field is None or i.field == field}


def test_correct_output_passes(template):
    assert validate_output(GOOD, DOC, template) == []


def test_due_date_instead_of_invoice_date_is_caught(template):
    issues = validate_output(with_change(invoice_date="2026-10-28"), DOC, template)
    assert ("invoice_date", "context") in kinds(issues)


def test_amount_due_instead_of_total_is_caught(template):
    issues = validate_output(with_change(total=41600.98), DOC, template)
    assert ("total", "context") in kinds(issues)
    assert ("total", "arithmetic") in kinds(issues)


def test_customer_instead_of_vendor_is_caught(template):
    issues = validate_output(with_change(vendor_name="Orbit Retail Pvt. Ltd."), DOC, template)
    assert ("vendor_name", "context") in kinds(issues)


def test_po_number_is_not_mistaken_for_grounding_failure_but_invented_number_is(template):
    issues = validate_output(with_change(invoice_number="INV-2026-0001"), DOC, template)
    assert ("invoice_number", "ungrounded") in kinds(issues)


def test_invented_line_item_and_bad_arithmetic_are_caught(template):
    items = copy.deepcopy(GOOD["line_items"])
    items[1]["amount"] = 33000.00
    issues = validate_output(with_change(line_items=items), DOC, template)
    assert ("line_items[1].amount", "ungrounded") in kinds(issues)
    assert ("line_items[1]", "arithmetic") in kinds(issues)
    assert ("subtotal", "arithmetic") in kinds(issues)


def test_wrong_formats_fail_schema_before_other_checks(template):
    issues = validate_output(with_change(invoice_date="28/09/2026", total="INR 36,600.98"), DOC, template)
    assert {i.kind for i in issues} == {"schema"}
    assert {"invoice_date", "total"} <= {i.field for i in issues}


def test_zero_discount_needs_no_source(template):
    doc = DOC.replace("Discount (10%): -INR 3,873.12\n", "")
    out = with_change(discount=0, tax=1936.56, total=40667.76)
    doc = doc.replace("1,742.90", "1,936.56").replace("36,600.98", "40,667.76")
    assert validate_output(out, doc, template) == []


@pytest.mark.parametrize("text, ok", [
    ('{"a": 1}', True),
    ('```json\n{"a": 1}\n```', True),
    ('Here is the data: {"a": 1} hope it helps', True),
    ("[1, 2]", False),
    ("not json", False),
])
def test_parse_json_output(text, ok):
    value, error = parse_json_output(text)
    assert (value is not None) == ok
    assert (error is None) == ok


def test_key_facts_template_grounds_quotes_names_and_numbers():
    from pathlib import Path
    from taskharness.template import load_template
    from taskharness.validate import check_report, validate_output

    template = load_template(Path(__file__).resolve().parent.parent / "templates/text_key_facts/v1.json")
    text = clean("Team sync - 4 November 2026\nRahul to update the test plan.\nBudget is about 50,000 rupees.\n")
    good = {"is_meaningful_text": True, "summary": "Rahul will update the test plan; the budget is about 50,000 rupees.",
            "key_points": [{"point": "Budget", "evidence_quote": "Budget is about 50,000 rupees"}],
            "names": ["Rahul"], "dates": ["4 November 2026"], "numbers": ["50,000 rupees"],
            "action_items": [{"action": "Update the test plan", "owner": "Rahul", "evidence_quote": "Rahul to update the test plan"}]}
    assert validate_output(good, text, template) == []
    report = check_report(good, text, template)
    assert all(c["passed"] for c in report) and not any(c["group"] == "arithmetic" for c in report)

    bad = dict(good, names=["Priya"], summary="Budget is 70,000.",
               key_points=[{"point": "x", "evidence_quote": "the budget doubled"}])
    fields = {i.field for i in validate_output(bad, text, template)}
    assert {"names[0]", "summary", "key_points[0].evidence_quote"} <= fields

    gibberish = {"is_meaningful_text": False, "summary": "No meaningful content.", "key_points": [], "names": [],
                 "dates": [], "numbers": [], "action_items": []}
    assert validate_output(gibberish, clean("saxbbhsazbjass"), template) == []


def test_non_finite_numbers_are_unreadable_not_a_crash(template):
    value, error = parse_json_output('{"total": 1e999, "subtotal": NaN}')
    assert value is None and "infinity" in error
    assert validate_output(with_change(total=float("inf")), DOC, template)  # no exception


def test_po_number_is_not_accepted_as_invoice_number(template):
    issues = validate_output(with_change(invoice_number="PO-86750"), DOC, template)
    assert ("invoice_number", "context") in kinds(issues)


def test_invoice_number_must_match_punctuation(template):
    issues = validate_output(with_change(invoice_number="A-2026-576"), DOC, template)
    assert ("invoice_number", "ungrounded") in kinds(issues)


def test_line_item_description_and_amount_must_share_a_line(template):
    items = copy.deepcopy(GOOD["line_items"])
    items[1]["description"] = items[0]["description"]
    issues = validate_output(with_change(line_items=items), DOC, template)
    assert ("line_items[1].amount", "ungrounded") in kinds(issues)


def test_key_facts_cannot_call_real_text_meaningless():
    from pathlib import Path
    from taskharness.template import load_template

    template = load_template(Path(__file__).resolve().parent.parent / "templates/text_key_facts/v1.json")
    empty = {"is_meaningful_text": False, "summary": "No meaningful content.", "key_points": [], "names": [],
             "dates": [], "numbers": [], "action_items": []}
    real = clean("Alice cancelled the product launch and notified Bob about the new plan today.")
    assert {i.field for i in validate_output(empty, real, template)} == {"is_meaningful_text"}
    assert validate_output(empty, clean("saxbbhsazbjassxsasxasa"), template) == []
