import json
from argparse import Namespace

from taskharness.cli import cmd_run
from taskharness.evaluate import field_correct, score_result, summarize
from taskharness.generate import generate_dataset


def test_field_correct_is_lenient_on_format_strict_on_meaning():
    assert field_correct("total", "₹1,57,520.16", 157520.16)
    assert field_correct("invoice_date", "28/09/2026", "2026-09-28")
    assert not field_correct("invoice_date", "2026-10-28", "2026-09-28")
    assert field_correct("currency", "₹", "INR")
    assert field_correct("discount", None, 0)
    assert field_correct("vendor_name", "sharma tech solutions pvt ltd", "Sharma Tech Solutions Pvt. Ltd.")
    items = [{"description": "A", "quantity": 1, "unit_price": 2.0, "amount": 2.0},
             {"description": "B", "quantity": 2, "unit_price": 1.0, "amount": 2.0}]
    assert field_correct("line_items", list(reversed(items)), items)
    assert not field_correct("line_items", items[:1], items)


def test_score_and_summary(dataset, template):
    doc = dataset[0]
    good = {"doc_id": doc["doc_id"], "mode": "harness", "status": "passed",
            "output": doc["label"]["expected"], "attempts": [{}], "latency_ms": 1000.0,
            "prompt_tokens": 100, "completion_tokens": 20}
    bad_output = dict(doc["label"]["expected"], total=1.23)
    bad = dict(good, status="flagged", output=bad_output, attempts=[{}, {}])
    silent = dict(good, status="passed", output=bad_output)

    scores = [score_result(r, doc["label"], doc["text"], template) for r in (good, bad, silent)]
    assert scores[0]["all_correct"] and not scores[0]["silent_error"]
    assert scores[1]["flagged"] and not scores[1]["silent_error"]
    assert scores[2]["silent_error"]
    assert scores[1]["invented_values"] == 1

    summary = summarize(scores)
    assert summary["fully_correct"] == 1
    assert summary["wrong_and_flagged"] == 1
    assert summary["silent_errors"] == 1
    assert summary["retries"] == 1
    assert summary["format_errors"] == 0
    assert summary["avg_seconds"] == 1.0


def test_unparseable_output_counts_as_format_error(dataset, template):
    doc = dataset[0]
    result = {"doc_id": doc["doc_id"], "mode": "plain", "status": "parse_error", "output": None, "attempts": [{}]}
    score = score_result(result, doc["label"], doc["text"], template)
    assert not score["schema_ok"] and not score["all_correct"]
    assert not score["silent_error"]  # the user got an error, not a wrong answer


def test_cli_run_all_modes_end_to_end(tmp_path, template, fake_llm, capsys):
    data = tmp_path / "data"
    generate_dataset(data, count=3, seed=11)
    labels = [json.loads(p.read_text())["expected"] for p in sorted((data / "labels").glob("*.json"))]
    # plain + json_mode + template: one call per doc; harness: one call per doc (all correct)
    llm = fake_llm(labels * 4)
    args = Namespace(model=None, template=str(tmp_path / "t.json"), data=str(data), limit=0,
                     mode="all", runs_dir=str(tmp_path / "runs"))
    (tmp_path / "t.json").write_text(json.dumps(template))

    assert cmd_run(args, llm=llm) == 0
    run_dir = next((tmp_path / "runs").iterdir())
    for mode in ("plain", "json_mode", "template", "harness"):
        summary = json.loads((run_dir / mode / "summary.json").read_text())
        assert summary["docs"] == 3 and summary["fully_correct"] == 3
        assert len((run_dir / mode / "results.jsonl").read_text().splitlines()) == 3
    assert (run_dir / "comparison.csv").exists()
    assert "Silent errors" in capsys.readouterr().out


def test_cli_extract_on_own_file(tmp_path, template, fake_llm, capsys):
    from taskharness.cli import cmd_extract

    doc = tmp_path / "invoice.txt"
    doc.write_text("Vendor Co\nInvoice No.: 1\nInvoice Date: 2026-01-15\nItem A   1   10.00   10.00\n"
                   "Subtotal: $10.00\nTax: $1.00\nTotal: $11.00\n", encoding="utf-8")
    answer = {"vendor_name": "Vendor Co", "invoice_number": "1", "invoice_date": "2026-01-15", "currency": "USD",
              "subtotal": 10.0, "discount": 0, "tax": 1.0, "total": 11.0,
              "line_items": [{"description": "Item A", "quantity": 1, "unit_price": 10.0, "amount": 10.0}]}
    tpl = tmp_path / "t.json"
    tpl.write_text(json.dumps(template))
    args = Namespace(file=str(doc), mode="harness", template=str(tpl))
    assert cmd_extract(args, llm=fake_llm([answer])) == 0
    out = capsys.readouterr().out
    assert "Result: PASSED" in out and "PASS  Total = subtotal" in out

    args_missing = Namespace(file=str(tmp_path / "nope.txt"), mode="harness", template=str(tpl))
    assert cmd_extract(args_missing, llm=fake_llm([])) == 2


def test_api_error_is_not_a_silent_error(dataset, template):
    doc = dataset[0]
    result = {"doc_id": doc["doc_id"], "mode": "harness", "status": "api_error", "output": None, "attempts": [{}]}
    assert not score_result(result, doc["label"], doc["text"], template)["silent_error"]
