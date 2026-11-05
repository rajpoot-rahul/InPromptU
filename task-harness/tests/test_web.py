import json
from argparse import Namespace
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from taskharness.cli import cmd_run
from taskharness.generate import generate_dataset
from taskharness.preprocess import clean
from taskharness.validate import check_report
from taskharness.web.server import AppConfig, create_app, model_label

ROOT = Path(__file__).resolve().parent.parent
MODEL = "us.anthropic.claude-haiku-5-5"


@pytest.fixture
def app_setup(tmp_path, template, fake_llm):
    data = tmp_path / "data"
    generate_dataset(data, count=3, seed=11)
    labels = [json.loads(p.read_text())["expected"] for p in sorted((data / "labels").glob("*.json"))]
    wrong_first = dict(labels[0], discount=-1.0)
    # plain gets doc 1 wrong; harness gets it wrong, then fixes it on retry.
    outputs = [wrong_first, labels[1], labels[2]] * 3 + [wrong_first, labels[0], labels[1], labels[2]]
    llm = fake_llm(outputs, model=MODEL)
    args = Namespace(model=None, template=str(ROOT / "templates/invoice_extraction/v1.json"), data=str(data),
                     limit=0, mode="all", runs_dir=str(tmp_path / "runs"))
    assert cmd_run(args, llm=llm) == 0
    live_llm = fake_llm([labels[0]] * 5, model=MODEL)
    config = AppConfig(data_dir=data, runs_dir=tmp_path / "runs", templates_dir=ROOT / "templates",
                       live_models=[MODEL], llm_factory=lambda model: live_llm)
    return TestClient(create_app(config)), tmp_path


def test_model_label():
    assert model_label("us.anthropic.claude-opus-5-5") == "Claude Opus 5.5"
    assert model_label("anthropic.claude-haiku-4-5-20251001-v1:0") == "Claude Haiku 4.5"
    assert model_label("gpt-6-luna") == "gpt-6-luna"


def test_home_and_static_assets(app_setup):
    client, _ = app_setup
    assert "Task Harness" in client.get("/").text
    assert client.get("/static/app.js").status_code == 200
    assert client.get("/static/styles.css").status_code == 200


def test_overview_lists_tasks_documents_and_saved_runs(app_setup):
    client, _ = app_setup
    data = client.get("/api/overview").json()
    assert data["tasks"][0]["id"] == "invoice_extraction@1.0.0"
    assert len(data["documents"]) == 3
    assert {(s["model_label"], s["mode"]) for s in data["sources"]} == {
        ("Claude Haiku 5.5", m) for m in ("plain", "json_mode", "template", "harness")}


def test_document_shows_raw_and_cleaned(app_setup):
    client, _ = app_setup
    doc = client.get("/api/documents/inv_001").json()
    assert doc["cleaned"] and doc["raw"] and "--- section 1 ---" in doc["sectioned"]
    assert client.get("/api/documents/nope").status_code == 404


def test_replay_plain_shows_silent_error_and_what_checks_would_catch(app_setup):
    client, _ = app_setup
    view = client.get("/api/replay", params={"model": MODEL, "mode": "plain", "doc_id": "inv_001"}).json()
    assert view["status"] == "unchecked" and not view["checks_run"]
    assert not view["all_correct"]
    assert [f["name"] for f in view["fields"] if not f["correct"]] == ["discount"]
    assert any(not c["passed"] for c in view["checks"])


def test_replay_harness_shows_fixed_on_retry(app_setup):
    client, _ = app_setup
    view = client.get("/api/replay", params={"model": MODEL, "mode": "harness", "doc_id": "inv_001"}).json()
    assert view["status"] == "fixed_on_retry"
    assert view["all_correct"] and view["checks_run"]
    assert len(view["attempts"]) == 2
    assert all(c["passed"] for c in view["checks"])


def test_replay_missing_run_is_404(app_setup):
    client, _ = app_setup
    r = client.get("/api/replay", params={"model": "us.anthropic.claude-opus-5-5", "mode": "plain", "doc_id": "inv_001"})
    assert r.status_code == 404


def test_results_and_differences(app_setup):
    client, _ = app_setup
    rows = client.get("/api/results").json()["rows"]
    by_mode = {r["mode"]: r for r in rows}
    assert by_mode["plain"]["fully_correct"] == 2 and by_mode["plain"]["silent_errors"] == 1
    assert by_mode["harness"]["fully_correct"] == 3 and by_mode["harness"]["retries"] == 1
    assert by_mode["harness"]["cost_usd"] is not None
    diff = client.get("/api/differences", params={"left_model": MODEL, "left_mode": "plain",
                                                  "right_model": MODEL, "right_mode": "harness"}).json()
    assert diff["doc_ids"] == ["inv_001"]


def test_live_run_is_logged(app_setup):
    client, tmp_path = app_setup
    view = client.post("/api/live", json={"doc_id": "inv_001", "mode": "harness", "model": MODEL}).json()
    assert view["source"] == "live" and view["status"] == "passed"
    assert (tmp_path / "runs" / "live" / "live.jsonl").exists()
    assert client.post("/api/live", json={"doc_id": "inv_001", "mode": "harness", "model": "other"}).status_code == 400


def test_live_failure_returns_helpful_503(tmp_path, template):
    data = tmp_path / "data"
    generate_dataset(data, count=1, seed=1)

    def broken(model):
        raise RuntimeError("Token has expired")

    config = AppConfig(data_dir=data, runs_dir=tmp_path / "runs", templates_dir=ROOT / "templates",
                       live_models=[MODEL], llm_factory=broken)
    client = TestClient(create_app(config))
    r = client.post("/api/live", json={"doc_id": "inv_001", "mode": "plain", "model": MODEL})
    assert r.status_code == 503 and "Saved run" in r.json()["detail"]


def test_check_report_lists_every_check(dataset, template):
    doc = dataset[0]
    good = check_report(doc["label"]["expected"], clean(doc["text"]), template)
    assert good and all(c["passed"] for c in good)
    names = {c["name"] for c in good}
    assert {"Invoice date is not the due date", "Total = subtotal − discount + tax"} <= names
    bad = check_report(dict(doc["label"]["expected"], total=1.23), clean(doc["text"]), template)
    assert {c["name"] for c in bad if not c["passed"]} >= {"total appears in the document", "Total = subtotal − discount + tax"}
    assert check_report(None, "", template)[0]["passed"] is False


SAMPLE = (ROOT / "examples" / "sample_invoice.txt").read_text(encoding="utf-8")
SAMPLE_ANSWER = {
    "vendor_name": "DECCAN DIGITAL SERVICES PVT. LTD.", "invoice_number": "DDS/2026/0457",
    "invoice_date": "2026-10-18", "currency": "INR", "subtotal": 104100.00, "discount": 5205.00,
    "tax": 17801.10, "total": 116696.10, "line_items": [
        {"description": "Cloud hosting (monthly)", "quantity": 3, "unit_price": 12500.00, "amount": 37500.00},
        {"description": "Security audit", "quantity": 1, "unit_price": 45000.00, "amount": 45000.00},
        {"description": "Support hours", "quantity": 12, "unit_price": 1800.00, "amount": 21600.00}],
}


def own_text_client(tmp_path, outputs, fake_llm):
    data = tmp_path / "data"
    generate_dataset(data, count=1, seed=1)
    llm = fake_llm(outputs, model=MODEL)
    config = AppConfig(data_dir=data, runs_dir=tmp_path / "runs", templates_dir=ROOT / "templates",
                       live_models=[MODEL], llm_factory=lambda model: llm)
    return TestClient(create_app(config))


def test_own_text_passes_with_checks_only(tmp_path, fake_llm):
    client = own_text_client(tmp_path, [SAMPLE_ANSWER], fake_llm)
    view = client.post("/api/live-text", json={"text": SAMPLE, "filename": "my invoice.txt", "model": MODEL}).json()
    assert view["status"] == "passed" and view["has_answer_key"] is False
    assert view["all_correct"] is None and view["schema_ok"] is True
    assert all(f["expected"] is None and f["correct"] is None for f in view["fields"])
    assert all(c["passed"] for c in view["checks"])
    assert view["doc_id"] == "my_invoice.txt" and view["document"]["raw"] == SAMPLE


def test_own_text_wrong_answer_is_flagged(tmp_path, fake_llm):
    wrong = dict(SAMPLE_ANSWER, total=124696.10)
    client = own_text_client(tmp_path, [wrong, wrong], fake_llm)
    view = client.post("/api/live-text", json={"text": SAMPLE, "model": MODEL}).json()
    assert view["status"] == "flagged"
    failed = {c["name"] for c in view["checks"] if not c["passed"]}
    assert "Total is not the subtotal or amount due" in failed


def test_own_text_rejects_empty_and_huge(tmp_path, fake_llm):
    client = own_text_client(tmp_path, [], fake_llm)
    assert client.post("/api/live-text", json={"text": "   ", "model": MODEL}).status_code == 400
    assert client.post("/api/live-text", json={"text": "x" * 200_001, "model": MODEL}).status_code == 413
    assert client.post("/api/live-text", json={"text": "hi", "model": "not-allowed"}).status_code == 400


def test_overview_lists_general_task_without_examples(app_setup):
    client, _ = app_setup
    tasks = {t["task"]: t for t in client.get("/api/overview").json()["tasks"]}
    assert tasks["invoice_extraction"]["has_examples"] is True
    assert tasks["text_key_facts"]["has_examples"] is False
    assert tasks["text_key_facts"]["title"] == "Key facts from any text"


def test_own_text_with_general_task(tmp_path, fake_llm):
    answer = {"is_meaningful_text": True, "summary": "A short note.", "key_points": [], "names": [],
              "dates": [], "numbers": [], "action_items": []}
    client = own_text_client(tmp_path, [answer], fake_llm)
    view = client.post("/api/live-text", json={"text": "A short note.", "model": MODEL,
                                               "task": "text_key_facts@1.0.0"}).json()
    assert view["status"] == "passed"
    assert [f["name"] for f in view["fields"]][:2] == ["is_meaningful_text", "summary"]


def test_oversized_example_document_does_not_crash(tmp_path):
    data = tmp_path / "data"
    generate_dataset(data, count=1, seed=1)
    examples = tmp_path / "examples"
    examples.mkdir()
    (examples / "huge.txt").write_text("word " * 6000, encoding="utf-8")
    client = TestClient(create_app(AppConfig(data_dir=data, runs_dir=tmp_path / "runs", templates_dir=ROOT / "templates",
                                             live_models=[MODEL], examples_dir=examples)))
    r = client.get("/api/documents/ex_huge")
    assert r.status_code == 200 and r.json()["sectioned"] is None
