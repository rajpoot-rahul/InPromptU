# Task Harness

A reusable **quality gate for AI answers**. A fixed template defines the task, the document is cleaned by normal code, the AI answers, and then **code checks every answer** against the document and the task rules. A failing answer gets **one retry with feedback**; if it still fails it is **sent for human review** instead of being passed on silently. Every step is logged and measured.

> The AI is a fast new employee. The harness is the checklist and the supervisor.

Two tasks are built:

| Task | Template | Use it for |
|---|---|---|
| **Invoice extraction** | `templates/invoice_extraction/v1.json` | Vendor, invoice number, dates, amounts and line items. Has 30 test invoices with known answers, so accuracy can be measured. |
| **Key facts from any text** | `templates/text_key_facts/v1.json` | Any text (emails, meeting notes, articles): summary, key points with exact quotes, names, dates, numbers, action items. Gibberish returns "no meaningful content" instead of invented facts. No answer key yet, so it shows checks only. |

Invoices are the measured test case, not the point: a new task is a new template.

---

## Results (30 synthetic invoices, Claude on Amazon Bedrock)

| Setup | Correct | Format errors | Silent errors | Sec / invoice | Cost for 30* |
|---|---|---|---|---|---|
| Claude Opus 5.5, plain prompt | 30/30 | 15 | 0 | 6.4 | ~$0.45 |
| Claude Haiku 5.5, plain prompt | 24/30 | 27 | **6** | 3.4 | ~$0.01 |
| **Claude Haiku 5.5 + harness** | **30/30** | **0** | **0** | **2.5** | **~$0.01** |

\*Estimated from Anthropic list prices; Bedrock prices may differ. *Silent error* = wrong answer that nobody was warned about. A second Haiku run gave the same picture.

**Honest limits:** synthetic invoices with known answers; one task; the checks were written alongside the test data; invoice capture itself already exists at Hyland (Brainware).

---

## Quick start

Requires Python 3.10+.

```bash
cd task-harness
python3 -m venv .venv
.venv/bin/pip install -e ".[dev,slides]"
.venv/bin/python -m pytest -q          # 69 tests, no AI calls, no credentials needed
```

### Connect a model

The harness picks the provider from the model ID:

| Model ID looks like | Provider | Credentials |
|---|---|---|
| `us.anthropic.claude-…` / `anthropic.…` | Amazon Bedrock | AWS SSO profile (`--aws-profile`) or `AWS_BEARER_TOKEN_BEDROCK` |
| `claude-…` | Anthropic API | `ANTHROPIC_API_KEY` |
| anything else | OpenAI API | `OPENAI_API_KEY` |

For Bedrock with company single sign-on:

```bash
aws sso login --sso-session <your-sso-session>     # opens the browser
.venv/bin/python -m taskharness models --provider bedrock --aws-profile <your-aws-sso-profile>
```

Never paste keys or tokens into chat, files, tickets or slides. Set them only in your own terminal.

### Commands

```bash
# Create the synthetic test set (30 invoices + correct answers) in data/
.venv/bin/python -m taskharness generate --count 30 --seed 7

# Compare all four modes on the test set (writes runs/<timestamp>/)
.venv/bin/python -m taskharness run --model us.anthropic.claude-haiku-5-5 --aws-profile <profile>
.venv/bin/python -m taskharness run --model us.anthropic.claude-haiku-5-5 --aws-profile <profile> --mode harness --limit 3

# Run the harness on one of your own text files
.venv/bin/python -m taskharness extract examples/sample_invoice.txt --model us.anthropic.claude-haiku-5-5 --aws-profile <profile>
.venv/bin/python -m taskharness extract examples/not_an_invoice.txt --template templates/text_key_facts/v1.json --model us.anthropic.claude-haiku-5-5 --aws-profile <profile>

# Start the demo web app on http://127.0.0.1:8000
.venv/bin/python -m taskharness serve --aws-profile <profile>

# Rebuild the slide deck from the latest results (writes ../docs/TaskHarness-Hackathon-Slides.pptx)
.venv/bin/python slides/make_slides.py

# Rebuild the submission videos (needs the "video" extra, Google Chrome and a running web app; writes ../videos/)
.venv/bin/pip install -e ".[video]"
.venv/bin/python slides/make_video.py --app http://127.0.0.1:8000 --rate 160                      # ~4-minute video
.venv/bin/python slides/make_video.py --app http://127.0.0.1:8000 --rate 160 --variant impromptu  # ~75-second Impromptu segment
```

If the web app says "address already in use", an older copy is still running: stop it with Ctrl+C in its terminal (or `kill <PID>` from `lsof -nP -iTCP:8000 -sTCP:LISTEN`).

---

## How it works

```
Pick task ─▶ Clean ─▶ Build prompt ─▶ AI answers ─▶ Check ─▶ Retry once or flag ─▶ Log
(template)   (code)    (template)      (any model)   (code)   (feedback / human)
```

1. **Task template** (`templates/<task>/v<N>.json`): role, rules, field meanings, the exact JSON output schema, grounding and context rules, retry count, size limit. Versioned like code.
2. **Clean** (`preprocess.py`): normalise Unicode, remove invisible characters, tidy whitespace, split into sections. Oversized documents are **rejected, never silently cut**.
3. **Build prompt** (`template.py`): instructions first (system message), document in the middle, the critical reminder last.
4. **AI answers** (`llm.py`): OpenAI, Anthropic or Bedrock behind one small interface (`complete(messages, json_mode)`).
5. **Check** (`validate.py`), all deterministic code:
   - **Format:** the answer matches the JSON schema exactly; unreadable replies (including infinite/NaN numbers) count as format failures.
   - **In the document:** every text, date and amount appears in the source after normalising formats (`1,20,000.00`, `1.200,00`, `5 Nov 2026`, `05/11/2026` …). Identifiers listed in `exact_text_fields` (e.g. invoice numbers) must match punctuation exactly.
   - **From the right line:** e.g. vendor is not on a "Bill To" line, invoice number is not on a "PO Number" line, invoice date is not on a "Due Date" line, total is not the "Amount Due"; each line item's description and amount are on the same line.
   - **Sums add up:** quantity × price = amount; lines = subtotal; subtotal − discount + tax = total.
6. **Retry or flag** (`pipeline.py`): failing checks are sent back to the AI as feedback once; if still failing, status is `flagged` (human review).
7. **Log and measure** (`evaluate.py`): prompts, raw replies, checks, retries, time, tokens; scoring against known answers, including **silent errors**.

### Modes (each adds one step, so each step's value can be measured)

| Mode | What it does |
|---|---|
| `plain` | One-line prompt, raw document |
| `json_mode` | Same prompt with the provider's JSON mode (Claude has none, so it equals `plain`) |
| `template` | Cleaned document + versioned template, no checks |
| `harness` | Template + checks + one retry + flag for review |

### Result statuses

`passed` · `fixed on retry` · `flagged` (human review) · `rejected` (too large) · `unchecked` (non-harness modes) · `parse_error` · `api_error`

---

## Project layout

```
task-harness/
├── taskharness/
│   ├── cli.py          # generate | run | compare | models | extract | serve
│   ├── generate.py     # synthetic invoices + correct answers (with traps)
│   ├── preprocess.py   # cleaning and sectioning
│   ├── template.py     # load templates, build prompts and retry feedback
│   ├── llm.py          # OpenAI / Anthropic / Bedrock clients
│   ├── validate.py     # schema, grounding, context and arithmetic checks; check report
│   ├── normalize.py    # number/date/currency normalisation for fair comparison
│   ├── pipeline.py     # run one document in a mode (retry, flag)
│   ├── evaluate.py     # scoring, summaries, comparison table
│   └── web/            # FastAPI demo app (server.py + static/ index.html, app.js, styles.css)
├── templates/
│   ├── invoice_extraction/v1.json
│   └── text_key_facts/v1.json
├── data/               # 30 synthetic invoices (invoices/) + answers (labels/)
├── examples/           # sample texts listed in the web app's Document menu ("📝 Example text: …"):
│                       #   sample_invoice, not_an_invoice (meeting notes), customer_email, support_ticket,
│                       #   test_run_log, policy_excerpt, contract_clause, release_notes (all synthetic)
├── runs/               # saved run results used by the web app (runs/live/ is not committed)
├── slides/make_slides.py   # builds ../docs/TaskHarness-Hackathon-Slides.pptx
├── slides/make_video.py    # builds ../videos/*.mp4 (screenshots + slides + narration)
└── tests/              # 69 tests
```

---

## Adding a new task

1. Copy `templates/invoice_extraction/v1.json` to `templates/<new_task>/v1.json`.
2. Edit `task`, `role`, `rules`, `fields` and `output_schema` (JSON Schema). Keep `additionalProperties: false`.
3. Tell the checks what to verify in `grounding` (all optional, mix as needed):

   | Key | Checks that… | Example |
   |---|---|---|
   | `text_fields` | each text value appears in the source | `["vendor_name"]` |
   | `date_fields` / `amount_fields` | dates / amounts appear, after normalising formats | `["invoice_date"]` |
   | `text_list_fields` | every item of a list of strings appears | `["names", "dates", "numbers"]` |
   | `object_list_text_fields` | chosen keys inside a list of objects appear word for word | `{"key_points": ["evidence_quote"]}` |
   | `no_new_numbers_fields` | free text contains no numbers that are not in the source | `["summary"]` |
   | `exact_text_fields` | listed text fields must match punctuation exactly (case/spacing ignored) | `["invoice_number"]` |
   | `line_items_same_line` | each line item's description and amount appear on the same source line | `true` |
   | `meaningful_flag` + `meaningful_min_words` | a "no meaningful content" answer is rejected when the text has at least N real words | `"is_meaningful_text"`, `8` |

   Add a task-specific one-line `plain_prompt` so the baseline modes ask the right question.

   Add `context_rules` such as `"field": {"forbidden": ["due"], "lookback": 0, "check": "Plain-English check name"}`.
   `templates/text_key_facts/v1.json` is a complete example of a general task built only from these keys.
4. Collect 20–30 examples with correct answers (public or synthetic; never confidential data) in the same `data/invoices` + `data/labels` layout, or point `--data` at another folder.
5. Run `run --mode all` and compare plain vs harness.

Current limitations:
- The **arithmetic checks are invoice-specific** (`subtotal`, `discount`, `tax`, `total`, `line_items`) and run only when the template has an `arithmetic` section.
- For **Key facts from any text**, the checks prove that quotes, names, dates and numbers are really in the text and that real text is not dismissed as "no meaningful content". They do **not** prove that the *meaning* of the summary or a key point is correct (e.g. "launch approved" next to a quote saying it was cancelled). A meaning check (for example HS1 or a second model as judge) is future work.
- Scoring against known answers (`evaluate.py`, `run` command) needs a labelled test set; `run` refuses templates without one. The web app and `extract` work with any template.

---

## Using it from code

### Python

```python
from pathlib import Path
from taskharness.llm import BedrockClient
from taskharness.pipeline import run_document
from taskharness.template import load_template
from taskharness.validate import check_report
from taskharness.preprocess import clean

template = load_template(Path("templates/invoice_extraction/v1.json"))
llm = BedrockClient("us.anthropic.claude-haiku-5-5", aws_profile="<your-aws-sso-profile>")
text = Path("examples/sample_invoice.txt").read_text(encoding="utf-8")

result = run_document("my-invoice", text, "harness", llm, template)
print(result["status"])        # passed | flagged | ...
print(result["output"])        # extracted fields
print(result["issues"])        # failed checks (empty when passed)
for check in check_report(result["output"], clean(text), template):
    print(check["passed"], check["name"])   # True / False / None (skipped)
```

### HTTP (for other languages, e.g. a Node/Electron app)

Start `serve`, then:

```bash
curl -s -X POST http://127.0.0.1:8000/api/live-text \
  -H 'Content-Type: application/json' \
  -d '{"text": "…document text…", "filename": "doc.txt", "mode": "harness", "model": "us.anthropic.claude-haiku-5-5"}'
```

Response fields: `status`, `output`, `fields`, `checks` (`passed` = true / false / null for skipped), `attempts` (prompt, raw reply, issues per attempt), `latency_ms`, `prompt_tokens`, `completion_tokens`, `cost_usd`.

Other endpoints: `GET /api/overview`, `GET /api/documents/{id}`, `GET /api/replay`, `POST /api/live`, `GET /api/results`, `GET /api/differences`.

The demo server binds to `127.0.0.1`, has **no authentication**, and allows only the models listed with `--live-model`. Treat it as a local prototype, not a shared service.

---

## Bringing the harness pattern to another repo (e.g. Impromptu)

The pattern is language-agnostic. Its core is about 100 lines:

```
answer = model(prompt_from_template(task, cleaned_input))
problems = deterministic_checks(answer, input, task)        # never another AI call by default
if problems:
    answer = model(previous_messages + feedback(problems))   # exactly one retry
    problems = deterministic_checks(answer, input, task)
status = "passed" if not problems else "needs human review"
log(task_version, prompt, answer, problems, attempts, cost)
```

Two ways to use it in another project:

1. **Port the pattern** into that codebase (recommended for a Node/Electron app). Reuse the ideas from `validate.py`: schema check, "is every value in the source", "is it from the right line", task-specific consistency rules, one feedback retry, explicit review status, and a small evaluation set that counts **silent errors**.
2. **Call this project over HTTP** (`POST /api/live-text`) as a local sidecar while prototyping.

### Ideas for Impromptu specifically

Impromptu already validates part of its knowledge answers (it rejects unknown source IDs and quotes that are not in the retrieved excerpts). The harness can extend that to its **prompt-coaching** flow:

| Impromptu step | Harness check to add | On failure |
|---|---|---|
| "Improve prompt" returns a rewrite | **Nothing lost:** every name, number, date and constraint in the original still appears in the rewrite | Retry once with "you dropped: …" |
| | **Nothing invented:** no new requirements, numbers or facts that are not in the original or the supplied context | Retry once, then show a warning |
| | **Skill followed:** sections required by the selected skill (e.g. audience, output format) are present | Retry once |
| Knowledge reply draft | **Every claim cited:** each sentence that states a fact has a supporting quote | Mark unsupported sentences for review |
| Both | **Measure:** a small set of example prompts with expected key facts; compare "rewrite only" vs "rewrite + harness" on facts lost / invented | Use the numbers in the demo |

Agree any integration with the Impromptu owners before changing their repository.

#### Where it plugs in (Impromptu source as of November 2026)

- `src/provider.cjs` → `requestImprovement(raw, config, …)` sends the prompt to the model. Its system message already asks the model to *"preserve intent and all explicit constraints, negations, identifiers and facts"*, but `parseSuggestion()` only checks the **shape** of the reply (`improved`, `changes`, `questions`). Nothing verifies that facts were actually preserved.
- The original prompt is `input.prompt` (from `normalizeInput` in `src/engine.cjs`); the rewrite is `result.improved`.

#### Step by step

1. **Agree it with the owner** of `rajpoot-rahul/InPromptU` and create a branch.
2. **Add `src/harness.cjs`** with one function, `checkRewrite(original, improved)`, returning a list of plain-English problems:
   - every number, date, URL, email, issue key (`ABC-123`), quoted phrase and negation word (`not`, `never`, `don't`) in `original` still appears in `improved`;
   - `improved` contains no numbers, dates or issue keys that are not in `original` (or the supplied context).
3. **Call it in `requestImprovement`** right after `parseSuggestion(...)` for each provider path. If it returns problems, send the model one follow-up message ("Your rewrite dropped: …; added: …. Return the corrected JSON.") and check again.
4. **Return the outcome** with the result, e.g. `{ ...result, harness: { status: 'passed' | 'fixed_on_retry' | 'needs_review', problems } }`, and show a small warning in `src/renderer.js` when status is `needs_review`.
5. **Add tests** in `tests/` with fixed sample prompts (a dropped number, an added deadline, a removed "not") so the checks are proven without calling a model.
6. **Measure:** run 20–30 sample prompts through "rewrite only" vs "rewrite + harness" and count facts lost or invented. Put those numbers in the demo.
7. Open a pull request; keep the offline mode unchanged.

---

## Related work at Hyland (checked 5 November 2026, repository names and READMEs only)

- **Brainware** (product): classic capture with validation and human verification; overlaps the invoice *example*.
- **promptoptimizer**: improves/compresses prompts; overlaps the earlier "prompt compiler" idea, does not check answers.
- **swf-blueprints**: 203-check rubric + trial harness for AI-generated code; same approach, different domain.
- **litellm-secure-setup**: security guardrails before/after LLM calls; the harness could become a post-call correctness check there.
- **poc-idp-complex-table-extraction**: LLM invoice table extraction without visible answer checks; a good reuse candidate.

Private code, Confluence and Jira were not searched; confirm with those teams before claiming the idea is unique.

---

## Security and data

- Use only synthetic, public or approved documents. Text sent in live mode goes to the configured model provider.
- Credentials come from the environment or AWS SSO; nothing is written to disk by the harness.
- `runs/live/` (live demo calls) is git-ignored.
