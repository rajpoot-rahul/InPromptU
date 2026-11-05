import pytest

from taskharness.llm import FatalLLMError
from taskharness.pipeline import PLAIN_PROMPT, run_document
from taskharness.preprocess import DocumentTooLarge, clean, split_sections
from taskharness.template import compile_messages


def test_clean_removes_noise():
    raw = "Total:\u00a0₹100.00  \r\n\r\n\r\n\r\nVendor\u200b Ltd\r\n"
    assert clean(raw) == "Total: ₹100.00\n\nVendor Ltd\n"


def test_split_sections_refuses_to_truncate():
    with pytest.raises(DocumentTooLarge):
        split_sections("x" * 101, max_chars=100)


def test_compiled_prompt_puts_rules_first_and_reminder_last(template):
    messages = compile_messages(template, "DOC")
    assert messages[0]["role"] == "system"
    assert messages[0]["content"].startswith(template["role"])
    assert all(rule in messages[0]["content"] for rule in template["rules"])
    assert '"required"' in messages[0]["content"]
    assert messages[-1]["content"].endswith(template["final_reminder"])
    assert messages[-1]["content"].index("DOC") < messages[-1]["content"].index(template["final_reminder"])


def test_plain_mode_uses_one_line_prompt_without_json_mode(dataset, template, fake_llm):
    doc = dataset[0]
    llm = fake_llm(["```json\n" + '{"vendor_name": "x"}' + "\n```"])
    result = run_document(doc["doc_id"], doc["text"], "plain", llm, template)
    assert llm.calls[0]["json_mode"] is False
    assert llm.calls[0]["messages"][0]["content"].startswith(PLAIN_PROMPT)
    assert result["status"] == "unchecked"
    assert result["output"] == {"vendor_name": "x"}
    assert result["template"] is None


def test_harness_passes_correct_output_first_time(dataset, template, fake_llm):
    doc = dataset[0]
    llm = fake_llm([doc["label"]["expected"]])
    result = run_document(doc["doc_id"], doc["text"], "harness", llm, template)
    assert result["status"] == "passed"
    assert len(llm.calls) == 1
    assert llm.calls[0]["json_mode"] is True
    assert result["template"] == "invoice_extraction@1.0.0"


def test_harness_retries_once_with_feedback_and_recovers(dataset, template, fake_llm):
    doc = dataset[0]
    wrong = dict(doc["label"]["expected"], total=1.23)
    llm = fake_llm([wrong, doc["label"]["expected"]])
    result = run_document(doc["doc_id"], doc["text"], "harness", llm, template)
    assert result["status"] == "passed"
    assert len(result["attempts"]) == 2
    feedback = llm.calls[1]["messages"][-1]["content"]
    assert "total" in feedback and "failed these automatic checks" in feedback
    assert result["prompt_tokens"] == 200


def test_harness_flags_for_review_when_retry_still_fails(dataset, template, fake_llm):
    doc = dataset[0]
    wrong = dict(doc["label"]["expected"], total=1.23)
    llm = fake_llm([wrong, wrong])
    result = run_document(doc["doc_id"], doc["text"], "harness", llm, template)
    assert result["status"] == "flagged"
    assert len(llm.calls) == 2
    assert any(i["field"] == "total" for i in result["issues"])


def test_template_mode_does_not_validate_or_retry(dataset, template, fake_llm):
    doc = dataset[0]
    llm = fake_llm([dict(doc["label"]["expected"], total=1.23)])
    result = run_document(doc["doc_id"], doc["text"], "template", llm, template)
    assert result["status"] == "unchecked"
    assert len(llm.calls) == 1


def test_harness_retries_unparseable_output(dataset, template, fake_llm):
    doc = dataset[0]
    llm = fake_llm(["sorry, no JSON", doc["label"]["expected"]])
    result = run_document(doc["doc_id"], doc["text"], "harness", llm, template)
    assert result["status"] == "passed"


def test_transient_api_error_is_recorded_not_raised(dataset, template, fake_llm):
    doc = dataset[0]
    llm = fake_llm([TimeoutError("slow")])
    result = run_document(doc["doc_id"], doc["text"], "harness", llm, template)
    assert result["status"] == "api_error"
    assert "slow" in result["attempts"][0]["error"]


def test_fatal_api_error_stops_the_run(dataset, template, fake_llm):
    doc = dataset[0]
    llm = fake_llm([FatalLLMError("bad key")])
    with pytest.raises(FatalLLMError):
        run_document(doc["doc_id"], doc["text"], "harness", llm, template)


def test_oversized_document_is_rejected_not_truncated(template, fake_llm):
    small = dict(template, max_document_chars=10)
    llm = fake_llm([])
    result = run_document("big", "x" * 50, "harness", llm, small)
    assert result["status"] == "rejected"
    assert llm.calls == []
