# Task Harness: a quality gate for AI answers

**Team Impromptu** · Rahul Rajpoot (team leader), Surekha Jaknalli, Vivek Chaturvedi · Hyland Hackathon, November 2026
Task Harness built by Surekha Jaknalli.

> Impromptu improves the question. **Task Harness checks the answer.**

AI is usually right but sometimes **quietly wrong**. Task Harness wraps any AI call in a quality gate: a versioned template defines the task, plain code checks every answer against the source (is each value really there, taken from the right line, do the sums add up, is the format right), the AI gets **one retry** with the exact problem, and anything still failing is **sent to a person** instead of passing silently. Every step is logged and measured.

**Result** (30 synthetic invoices, Claude on Hyland AWS Bedrock): the cheapest model with the harness got **30/30 correct with 0 silent errors**, about **2.6× faster and ~38× cheaper** than the most expensive model with a plain prompt. Without the harness, the same cheap model silently got 6/30 wrong.

## Where to start

| You want to… | Open |
|---|---|
| **Watch the demo** (4 min) | [`videos/TaskHarness-5min-Video.mp4`](videos/TaskHarness-5min-Video.mp4) |
| Add Task Harness to the **Impromptu** team video (1 min 17 s) | [`videos/Impromptu-TaskHarness-Segment.mp4`](videos/Impromptu-TaskHarness-Segment.mp4) |
| Read the **one-page summary** for the team (incl. text for the submission form) | [`docs/TaskHarness-for-Team-Impromptu.html`](docs/TaskHarness-for-Team-Impromptu.html) |
| **Present or demo** it (what to say, demo steps, likely questions) | [`docs/TaskHarness-Presenter-Notes.html`](docs/TaskHarness-Presenter-Notes.html) |
| See the **slides** | [`docs/TaskHarness-Hackathon-Slides.pptx`](docs/TaskHarness-Hackathon-Slides.pptx) |
| **Run the code**, add a task, or reuse it in another repo | [`task-harness/README.md`](task-harness/README.md) |

## What is in this repository

```
├── task-harness/            the working project (Python): engine, web app, CLI, templates, test data, saved runs, tests
│   └── README.md            setup, commands, how it works, adding a task, Impromptu integration steps
├── docs/                    one-page team summary, presenter notes, slides
│   └── archive/             an earlier version of the idea (superseded; kept for history)
└── videos/                  submission videos, narration scripts, subtitles and app screenshots
```

## Quick start (about 5 minutes)

```bash
cd task-harness
python3 -m venv .venv
.venv/bin/pip install -e ".[dev]"
.venv/bin/python -m pytest -q                                   # 69 tests, no AI calls needed
.venv/bin/python -m taskharness serve                           # open http://127.0.0.1:8000
```

The web app replays saved results without internet. For **Live** runs, sign in to AWS and add `--aws-profile <your-aws-sso-profile>` (Claude on Bedrock), or use an Anthropic/OpenAI key; see `task-harness/README.md`.

## Status and honest limits

- Working prototype: web app (Try it, Side by side, Results), CLI, two tasks (invoice extraction; key facts from any text), 69 automated tests, real results.
- Test data is synthetic (no customer data). Costs are list-price estimates.
- For general text, checks verify quotes, names, dates and numbers, not the full meaning of a summary.
- **Not yet integrated into Impromptu**; the exact plug-in point and steps are in `task-harness/README.md`.
