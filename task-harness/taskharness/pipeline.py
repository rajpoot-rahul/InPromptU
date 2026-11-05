"""Run one document through a chosen mode.

Modes form a ladder so each step's contribution can be measured:
  plain     - one-line prompt, raw document
  json_mode - same one-line prompt with the model's JSON output mode
  template  - cleaned + sectioned document, versioned template, JSON mode (no checks)
  harness   - template + validation + one retry + flag for review when checks still fail
"""

from __future__ import annotations

from .llm import FatalLLMError, LLMClient
from .preprocess import DocumentTooLarge, clean, render_sections, split_sections
from .template import compile_messages, retry_message, template_id
from .validate import parse_json_output, validate_output

MODES = ("plain", "json_mode", "template", "harness")

PLAIN_PROMPT = (
    "Extract vendor_name, invoice_number, invoice_date, currency, subtotal, discount, tax, total and "
    "line_items (description, quantity, unit_price, amount) from this invoice as JSON."
)


def build_messages(mode: str, raw_text: str, template: dict) -> list[dict]:
    if mode in ("plain", "json_mode"):
        return [{"role": "user", "content": f"{template.get('plain_prompt', PLAIN_PROMPT)}\n\n{raw_text}"}]
    sections = split_sections(clean(raw_text), template.get("max_document_chars", 20000))
    return compile_messages(template, render_sections(sections))


def run_document(doc_id: str, raw_text: str, mode: str, llm: LLMClient, template: dict) -> dict:
    if mode not in MODES:
        raise ValueError(f"Unknown mode {mode!r}; choose from {MODES}")
    source = clean(raw_text)
    result: dict = {
        "doc_id": doc_id,
        "mode": mode,
        "model": llm.model,
        "template": template_id(template) if mode in ("template", "harness") else None,
        "status": None,
        "output": None,
        "issues": [],
        "attempts": [],
        "latency_ms": 0.0,
        "prompt_tokens": 0,
        "completion_tokens": 0,
    }

    try:
        messages = build_messages(mode, raw_text, template)
    except DocumentTooLarge as error:
        result.update(status="rejected", issues=[{"field": "(document)", "kind": "size", "message": str(error)}])
        return result

    max_attempts = 1 + (template.get("max_retries", 1) if mode == "harness" else 0)
    json_mode = mode != "plain"
    output, issues = None, []

    for attempt_no in range(1, max_attempts + 1):
        try:
            response = llm.complete(messages, json_mode=json_mode)
        except FatalLLMError:
            raise
        except Exception as error:  # network errors, rate limits, timeouts
            result["attempts"].append({"attempt": attempt_no, "messages": messages, "error": repr(error)})
            result["status"] = "api_error"
            return result

        result["latency_ms"] += response.latency_ms
        result["prompt_tokens"] += response.prompt_tokens or 0
        result["completion_tokens"] += response.completion_tokens or 0

        output, parse_error = parse_json_output(response.text)
        if output is None:
            issues = [{"field": "(root)", "kind": "parse", "message": parse_error}]
        elif mode == "harness":
            issues = [issue.to_dict() for issue in validate_output(output, source, template)]
        else:
            issues = []

        result["attempts"].append({
            "attempt": attempt_no,
            "messages": messages,
            "raw_output": response.text,
            "issues": issues,
            "latency_ms": response.latency_ms,
        })
        if not issues or attempt_no == max_attempts:
            break
        messages = messages + [{"role": "assistant", "content": response.text},
                               retry_message([i["message"] for i in issues])]

    result["output"] = output
    result["issues"] = issues
    if mode == "harness":
        result["status"] = "passed" if not issues else "flagged"
    else:
        result["status"] = "unchecked" if output is not None else "parse_error"
    return result
