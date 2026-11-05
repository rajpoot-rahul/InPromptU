"""Build the ~5-minute submission video: app screenshots + slides + narration -> MP4.

Usage (the web app must be running, e.g. `taskharness serve --port 8767 --aws-profile <profile>`):
    .venv/bin/python slides/make_video.py --app http://127.0.0.1:8767 [--voice Samantha] [--rate 165] [--skip-shots]

Writes into ../video/: shots/*.png, scenes/*.png|wav|mp4, TaskHarness-video-script.txt,
TaskHarness-video.srt and ../TaskHarness-5min-Video.mp4.
Live screenshots call the AI twice (Claude Haiku, a fraction of a cent).
"""

from __future__ import annotations

import argparse
import html
import re
import subprocess
import sys
import wave
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT.parent / "video"
FINAL = ROOT.parent / "TaskHarness-5min-Video.mp4"
sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(Path(__file__).resolve().parent))

from make_slides import load_results  # noqa: E402

TEAM_LINE = "Team Impromptu: Rahul Rajpoot (team leader), Surekha Jaknalli, Vivek Chaturvedi · Task Harness by Surekha Jaknalli"

CSS = """
*{box-sizing:border-box;margin:0}body{width:1920px;height:1080px;font-family:-apple-system,"Segoe UI",system-ui,sans-serif;
background:#f3f6fa;color:#1b2b3c;overflow:hidden}
.slide{width:1920px;height:1080px;position:relative;overflow:hidden}
.bar{background:#14304d;color:#fff;padding:34px 80px 30px}.kicker{font-size:22px;letter-spacing:.12em;color:#a9c8e6;font-weight:700}
.bar h1{font-size:56px;margin-top:6px}.body{height:918px;display:flex;flex-direction:column;justify-content:center;padding:40px 80px}
.cards{display:grid;gap:34px}.c3{grid-template-columns:repeat(3,1fr)}.c2{grid-template-columns:repeat(2,1fr)}
.card{background:#fff;border:2px solid #d8e1ec;border-radius:22px;padding:40px 42px}
.card h2{font-size:44px;margin-bottom:18px}.card p{font-size:33px;line-height:1.45}
.red{color:#c0392b}.blue{color:#1765a8}.teal{color:#0f8b8d}.green{color:#1f8a4c}.navy{color:#14304d}.grey{color:#5b6b7f}
.alert{margin-top:40px;background:#fdecea;border:2px solid #f2c4be;border-radius:18px;padding:30px 38px;font-size:34px;color:#c0392b}
.note{margin-top:36px;background:#eef5fc;border:2px solid #c9ddf1;border-radius:18px;padding:28px 38px;font-size:34px;font-weight:700;color:#14304d}
.flow{display:flex;gap:18px}.step{flex:1;background:#fff;border:2px solid #d8e1ec;border-radius:20px;padding:34px 14px;text-align:center}
.step.key{background:#0f8b8d;border-color:#0f8b8d;color:#fff}.num{width:66px;height:66px;border-radius:50%;background:#0f8b8d;color:#fff;
font-size:32px;font-weight:800;line-height:66px;margin:0 auto 18px}.step.key .num{background:#fff;color:#0f8b8d}
.step b{display:block;font-size:33px;margin-bottom:12px}.step span{font-size:25px;color:#5b6b7f}.step.key span{color:#e6fbfb}
.rows .row{display:grid;grid-template-columns:420px 1fr 520px;gap:30px;align-items:center;background:#fff;border:2px solid #d8e1ec;
border-radius:18px;padding:32px 38px;margin-bottom:24px;font-size:31px}.row b{font-size:34px}.row.ours{background:#e6f4f4;border-color:#0f8b8d}
.shot{position:absolute;top:150px;left:80px;right:80px;bottom:40px;display:flex;align-items:center;justify-content:center;gap:30px}
.shot img{max-width:100%;max-height:100%;border-radius:16px;border:2px solid #d8e1ec;box-shadow:0 18px 50px rgba(20,48,77,.18)}
.shot.two img{max-width:49%}
.caption{position:absolute;right:80px;top:40px;font-size:24px;color:#a9c8e6}
.stats{display:grid;grid-template-columns:repeat(4,1fr);gap:26px;margin-top:40px}.stat{background:#0f8b8d;color:#fff;border-radius:22px;
padding:34px 20px;text-align:center}.stat b{display:block;font-size:90px}.stat span{font-size:30px}
table{width:100%;border-collapse:collapse;font-size:32px;background:#fff;border-radius:18px;overflow:hidden}
th{background:#14304d;color:#fff;text-align:left;padding:22px 26px}td{padding:22px 26px;border-top:2px solid #e3e9f1}
tr.win td{background:#e8f6ee;color:#1f8a4c;font-weight:800}.small{font-size:24px;color:#5b6b7f;margin-top:26px}
.title{background:#14304d;color:#fff;padding:200px 140px;height:1080px;position:relative}.title .kicker{font-size:28px}.title h1{font-size:120px;margin:22px 0 30px}
.title .accent{width:170px;height:10px;background:#0f8b8d;margin-bottom:40px}.title p{font-size:46px;line-height:1.4}
.title .who{position:absolute;bottom:110px;left:140px;right:140px;font-size:34px;color:#fff;border-left:8px solid #0f8b8d;padding-left:24px}
"""


def bar(kicker: str, title: str, caption: str = "") -> str:
    cap = f'<div class="caption">{html.escape(caption)}</div>' if caption else ""
    return f'<div class="bar"><div class="kicker">{html.escape(kicker.upper())}</div><h1>{html.escape(title)}</h1>{cap}</div>'


def shot_slide(kicker: str, title: str, image: str, caption: str) -> str:
    return f'{bar(kicker, title, caption)}<div class="shot"><img src="{image}"></div>'


def build_scenes(r: dict) -> list[dict]:
    opus, haiku, harness = r[("opus", "plain")], r[("haiku", "plain")], r[("haiku", "harness")]
    docs = harness["docs"]
    speed = opus["avg_seconds"] / harness["avg_seconds"]
    cheaper = opus["cost"] / harness["cost"]
    shots = (OUT / "shots").as_uri()
    return [
        {"id": "01_title",
         "html": '<div class="title"><div class="kicker">HYLAND HACKATHON</div><h1>Task Harness</h1><div class="accent"></div>'
                 '<p>A reusable quality gate for every AI call at Hyland:<br>checked, consistent and cheaper.</p>'
                 f'<div class="who">{TEAM_LINE}</div></div>',
         "say": "Hi, I'm Surekha Jaknalli, from team Impromptu, with Rahul Rajpoot and Vivek Chaturvedi. This is my part of our work: "
                "Task Harness, a reusable quality gate for every AI call at Hyland. "
                "In the next few minutes, I'll show the problem, the solution, a live demo, and the results."},
        {"id": "02_problem",
         "html": bar("The problem", "AI is usually right, but sometimes quietly wrong")
                 + '<div class="body"><div class="cards c3">'
                 f'<div class="card"><h2 class="blue">Inconsistent</h2><p>Even the most expensive model gave {opus["format_errors"]} of {docs} answers in the wrong format.</p></div>'
                 f'<div class="card"><h2 class="red">Unchecked</h2><p>The cheapest model got {haiku["silent_errors"]} of {docs} invoices wrong, and nobody was warned.</p></div>'
                 '<div class="card"><h2 class="teal">Expensive</h2><p>To be safe, teams reach for the biggest model, paying more and waiting longer.</p></div>'
                 '</div><div class="alert"><b>Real example:</b> the AI wrote a discount as <b>-393.32</b> instead of <b>393.32</b>. '
                 'A finance system would add it instead of subtracting it.</div></div>',
         "say": f"When teams ask a generative AI model to read a document, it is usually right, but sometimes it is quietly wrong. "
                f"In our test, the cheapest Claude model got {haiku['silent_errors']} out of {docs} invoices wrong, and nobody was warned. "
                "For example, it wrote a discount as minus 393 point 32, instead of plus. A finance system would add that discount, "
                f"instead of subtracting it. Even the most expensive model returned {opus['format_errors']} of its {docs} answers in the wrong format. "
                "So today, teams either trust the AI blindly, or pay for the biggest model, just to be safe."},
        {"id": "03_idea",
         "html": bar("The idea", "A quality gate around every AI call") + '<div class="body"><div class="flow">'
                 + "".join(f'<div class="step{" key" if n in (5, 6) else ""}"><div class="num">{n}</div><b>{t}</b><span>{s}</span></div>'
                           for n, t, s in [(1, "Pick a task", "Versioned template"), (2, "Clean", "Normal code tidies the text"),
                                           (3, "Build prompt", "Rules, fields, format"), (4, "AI answers", "Any approved model"),
                                           (5, "Check", "Source, line, sums, format"), (6, "Retry or flag", "One retry, then a person"),
                                           (7, "Log", "Every step recorded")])
                 + '</div><div class="note">The AI is one step. The value is in steps 5 and 6: nothing wrong is passed on silently.</div>'
                   '<div class="note" style="background:#fff;font-weight:400">Analogy: the AI is a fast new employee; '
                   'the harness is the checklist and the supervisor.</div></div>',
         "say": "Task Harness puts a supervisor around the AI. A versioned template defines the task. Normal code cleans the document. "
                "The AI answers. Then simple code checks every answer. If a check fails, the AI gets one retry, with the exact problem as feedback. "
                "If it still fails, the answer goes to a person for review. It is never passed on silently, and every step is logged."},
        {"id": "04_checks",
         "html": bar("How the checks work", "Simple code catches the mistakes AI makes") + '<div class="body"><div class="cards c2">'
                 '<div class="card"><h2 class="teal">✓ Is it in the document?</h2><p>Every value must appear in the source, after normalising formats like 1,20,000.00 or 5 Nov 2026.</p></div>'
                 '<div class="card"><h2 class="teal">✓ Is it from the right line?</h2><p>Not the due date. Not the "Bill To" customer. Not a PO number. Not the amount due.</p></div>'
                 '<div class="card"><h2 class="teal">✓ Do the sums add up?</h2><p>Quantity × price = amount. Lines = subtotal. Subtotal − discount + tax = total.</p></div>'
                 '<div class="card"><h2 class="teal">✓ Is the format right?</h2><p>Exactly the agreed fields and types, every time, so downstream systems can rely on it.</p></div>'
                 '</div></div>',
         "say": "The checks are plain code, not more AI. Is every value really in the document? Is it from the right line: "
                "not the due date, not the customer, not a purchase order number? Do the sums add up? "
                "And is the format exactly what downstream systems expect?"},
        {"id": "05_fit",
         "html": bar("Positioning", "How this fits with what Hyland already has") + '<div class="body rows">'
                 '<div class="row"><b class="navy">Brainware</b><span>Classic capture with validation and human verification</span><b class="red">Invoices are solved here</b></div>'
                 '<div class="row"><b class="navy">Prompt optimizer</b><span>Improves and compresses prompt wording</span><b class="red">Does not check the answer</b></div>'
                 '<div class="row"><b class="navy">LLM extraction POCs</b><span>Extract fields with Claude on Bedrock</span><b class="red">No standard answer checks</b></div>'
                 '<div class="row ours"><b class="teal">Task Harness</b><span>Checks every AI answer, retries, flags, and measures accuracy and cost</span><b class="teal">The missing quality gate for generative AI</b></div>'
                 '<p class="small">Invoices are our test case because their answers are easy to verify, not because invoice capture is new.</p></div>',
         "say": "We checked what already exists at Hyland. Brainware already validates classic invoice capture. An internal prompt optimizer "
                "improves prompt wording, and several proofs of concept extract fields with large language models. But none of them check "
                "generative AI answers in a standard way, or measure which model is good enough. That is the gap Task Harness fills. "
                "Invoices are simply our test case, because their answers are easy to verify."},
        {"id": "06_demo_try",
         "html": shot_slide("Live demo · Try it", "The AI broke a rule. The harness caught it and got it fixed.", f"{shots}/try_harness.png",
                            "Claude Haiku 5.5 · full harness"),
         "say": "Here is the working app. On the Try it screen, I run an invoice through the full harness, and the six stages light up one by one. "
                "On its first attempt, the AI broke the format rules. The harness caught it, sent feedback, and the AI fixed it on the second try. "
                "Every field now matches the correct answer."},
        {"id": "07_demo_flagged",
         "html": shot_slide("Live demo · Not an invoice", "No made-up answer: sent to a person, with the reason", f"{shots}/flagged.png",
                            "Random text, invoice task"),
         "say": "If I paste text that is not an invoice, the harness does not accept a made-up answer. "
                "It sends it for human review, and explains why, in plain English."},
        {"id": "08_demo_side",
         "html": shot_slide("Live demo · Side by side", "Same invoice: AI alone vs AI + harness", f"{shots}/side_by_side.png",
                            "Saved runs · Claude Haiku 5.5"),
         "say": "Side by side shows the same invoice twice. On the left, the AI alone: the discount is wrong, and nobody was warned. "
                "That is a silent error. On the right, the same cheap model inside the harness: every field is correct, and every check passed."},
        {"id": "09_demo_any_text",
         "html": f'{bar("Live demo · Any text", "A new task is just a new template", "Key facts from any text · customer email")}'
                 f'<div class="shot two"><img src="{shots}/key_facts.png"><img src="{shots}/key_facts_checks.png"></div>',
         "say": "And it is not only for invoices. A new task is just a new template. Here, Key facts from any text summarises a customer email. "
                "Every key point must come with an exact quote, and names, dates and numbers are checked against the text."},
        {"id": "10_results",
         "html": bar("The proof", f"Results on {docs} invoices · Claude on Hyland AWS Bedrock") + '<div class="body">'
                 '<table><tr><th>Setup</th><th>Correct</th><th>Format errors</th><th>Silent errors</th><th>Sec / invoice</th></tr>'
                 f'<tr><td>{opus["label"]}, plain prompt</td><td>{opus["fully_correct"]}/{docs}</td><td>{opus["format_errors"]}</td><td>{opus["silent_errors"]}</td><td>{opus["avg_seconds"]:.1f}</td></tr>'
                 f'<tr><td>{haiku["label"]}, plain prompt</td><td>{haiku["fully_correct"]}/{docs}</td><td>{haiku["format_errors"]}</td><td class="red"><b>{haiku["silent_errors"]}</b></td><td>{haiku["avg_seconds"]:.1f}</td></tr>'
                 f'<tr class="win"><td>{harness["label"]} + harness</td><td>{harness["fully_correct"]}/{docs}</td><td>{harness["format_errors"]}</td><td>{harness["silent_errors"]}</td><td>{harness["avg_seconds"]:.1f}</td></tr></table>'
                 '<div class="stats">'
                 f'<div class="stat"><b>{harness["fully_correct"]}/{docs}</b><span>correct, cheapest model</span></div>'
                 f'<div class="stat"><b>{harness["silent_errors"]}</b><span>silent errors</span></div>'
                 f'<div class="stat"><b>{speed:.1f}×</b><span>faster than Opus 5.5</span></div>'
                 f'<div class="stat"><b>~{cheaper:.0f}×</b><span>cheaper than Opus 5.5</span></div></div>'
                 '<p class="small">Synthetic invoices with known answers. Costs estimated from Anthropic list prices; Bedrock prices may differ.</p>'
                 '<div class="note" style="text-align:center">Cheapest model + harness = big-model accuracy, checked, at a fraction of the cost.</div></div>',
         "say": f"Here are the results on {docs} invoices, using Claude on Hyland's AWS account. The cheapest model with the harness got "
                f"{harness['fully_correct']} out of {docs} correct, with {harness['format_errors']} format errors and {harness['silent_errors']} silent errors. "
                f"That is {speed:.1f} times faster, and about {cheaper:.0f} times cheaper, than the most expensive model with a plain prompt."},
        {"id": "11_roadmap",
         "html": bar("Roadmap", "From one task to every Hyland team") + '<div class="body"><div class="cards c3">'
                 '<div class="card"><h2 class="teal">Template library</h2><p>Invoices, contracts, claims, test logs, any text.</p></div>'
                 '<div class="card"><h2 class="teal">Teams add their own</h2><p>Fields, rules and checks, without prompt engineering.</p></div>'
                 '<div class="card"><h2 class="teal">AI gateway check</h2><p>Run after every call, next to the existing security guardrails.</p></div>'
                 '<div class="card"><h2 class="teal">Audit trail</h2><p>Every prompt, answer, check and retry, by template version.</p></div>'
                 '<div class="card"><h2 class="teal">Right-size the model</h2><p>Prove when a cheaper model plus checks is good enough.</p></div>'
                 '<div class="card"><h2 class="teal">Impromptu</h2><p>Check that prompt rewrites never lose or invent facts.</p></div>'
                 '</div></div>',
         "say": "Next, this becomes a template library that any team can extend without prompt engineering. It can run as a check after every "
                "call on Hyland's AI gateway, keep an audit trail, and help each team pick the cheapest model that is good enough. "
                "It also fits our own tools: for example, checking that Impromptu's prompt rewrites never lose or invent facts."},
        {"id": "12_ask",
         "html": bar("Next steps", "Honest limits and the ask") + '<div class="body"><div class="cards c2">'
                 f'<div class="card"><h2 class="red">Limits today</h2><p>• {docs} synthetic invoices, two tasks<br>• General-text checks verify facts, not full meaning<br>'
                 '• Invoice capture itself already exists (Brainware)<br>• Costs are list-price estimates</p></div>'
                 '<div class="card" style="background:#e8f6ee;border-color:#bfe3cd"><h2 class="green">The ask</h2><p>• One pilot team with real, approved documents<br>'
                 '• Time with the Brainware/IDP and AI gateway teams<br>• A sponsor to take it to the AI platform</p></div></div>'
                 '<div class="note" style="text-align:center;font-size:36px">Checked AI answers, with the cheapest model that is good enough.</div></div>',
         "say": f"To be honest about the limits: this is {docs} synthetic invoices and two tasks so far, and the general text checks verify facts, "
                "not the full meaning. Our ask is one pilot team with real, approved documents, time with the Brainware and AI gateway teams, "
                "and a sponsor. Task Harness: checked AI answers, with the cheapest model that is good enough. Thank you."},
    ]


def build_segment_scenes(r: dict) -> list[dict]:
    """~90-second segment for the team's Impromptu video: Task Harness as Impromptu's quality gate."""
    haiku, harness = r[("haiku", "plain")], r[("haiku", "harness")]
    opus = r[("opus", "plain")]
    docs = harness["docs"]
    cheaper = opus["cost"] / harness["cost"]
    shots = (OUT / "shots").as_uri()
    flow = "".join(
        f'<div class="step{" key" if key else ""}"><div class="num">{n}</div><b>{t}</b><span>{s}</span></div>'
        for n, t, s, key in [(1, "Impromptu", "User asks to improve a prompt", False),
                             (2, "AI rewrite", "Claude rewrites the prompt", False),
                             (3, "Task Harness", "Nothing lost? Nothing invented? Skill followed?", True),
                             (4, "Retry once", "With the exact problem as feedback", True),
                             (5, "Show result", "Passed, or a clear warning", False)])
    return [
        {"id": "s1_intro",
         "html": '<div class="title"><div class="kicker">IMPROMPTU · QUALITY GATE</div><h1 style="font-size:96px">Task Harness</h1>'
                 '<div class="accent"></div><p>Impromptu improves the question.<br>Task Harness checks the answer.</p>'
                 f'<div class="who">{TEAM_LINE}</div></div>',
         "say": "I'm Surekha Jaknalli, from team Impromptu, with Rahul Rajpoot and Vivek Chaturvedi. "
                "Impromptu helps people write better prompts. My part, Task Harness, makes sure the AI's answers can be trusted."},
        {"id": "s2_gap",
         "html": bar("The gap", "AI is usually right, but sometimes quietly wrong") + '<div class="body"><div class="cards c2">'
                 f'<div class="card"><h2 class="red">Silent errors</h2><p>In our test, the cheapest Claude model got {haiku["silent_errors"]} of {docs} invoices wrong, and nobody was warned.</p></div>'
                 '<div class="card"><h2 class="blue">Not checked today</h2><p>Impromptu asks the AI to keep every fact and constraint, but nothing verifies that it did.</p></div>'
                 '</div></div>',
         "say": f"AI is usually right, but sometimes quietly wrong. In our test, the cheapest Claude model got {haiku['silent_errors']} out of "
                f"{docs} invoices wrong, and nobody was warned. Impromptu asks the AI to keep every fact and constraint, "
                "but today nothing checks that it actually did."},
        {"id": "s3_demo",
         "html": shot_slide("Working prototype", "Same model: alone vs inside the harness", f"{shots}/side_by_side.png",
                            f"{harness['fully_correct']}/{docs} correct · {harness['silent_errors']} silent errors · ~{cheaper:.0f}× cheaper than Opus"),
         "say": "Task Harness checks every AI answer with plain code: is each value really in the source, is it from the right place, "
                "do the numbers add up. If not, the AI gets one retry with the exact problem, and otherwise a person reviews it. "
                f"With the harness, the cheapest model got {harness['fully_correct']} out of {docs} correct, with zero silent errors, "
                f"about {cheaper:.0f} times cheaper than the biggest model."},
        {"id": "s4_impromptu",
         "html": bar("Next step · planned integration", "How every Impromptu rewrite will be checked") + f'<div class="body"><div class="flow">{flow}</div>'
                 '<div class="note">Checks: every name, number, date, link and "not" is kept · nothing new is invented · the chosen skill is followed.</div>'
                 '<p class="small">Task Harness is working today as a separate prototype; plugging it into Impromptu (src/provider.cjs) is the next step.</p>'
                 '</div>',
         "say": "Our next step is to plug the same gate into Impromptu, so every prompt rewrite gets checked. Nothing lost: every name, "
                "number, date and every not is kept. Nothing invented. And the chosen skill is followed. If a check fails, the AI "
                "retries once, and the user sees a clear warning instead of a silently changed prompt. Impromptu improves the question; "
                "Task Harness checks the answer."},
    ]


def capture_shots(app: str) -> None:
    from playwright.sync_api import sync_playwright

    shots = OUT / "shots"
    shots.mkdir(parents=True, exist_ok=True)
    with sync_playwright() as p:
        browser = p.chromium.launch(channel="chrome", headless=True)
        page = browser.new_page(viewport={"width": 1600, "height": 900}, device_scale_factor=2)

        def run_and_wait(timeout=90_000):
            page.click("#try-run")
            page.wait_for_function("document.querySelectorAll('#try-steps li.done').length === 6"
                                   " || !document.querySelector('#try-error').hidden", timeout=timeout)
            page.wait_for_timeout(700)
            error = page.eval_on_selector("#try-error", "e => e.hidden ? '' : e.innerText")
            if error:
                raise SystemExit(f"App error while capturing: {error}")

        def scroll_to(selector: str, offset: int = 70):
            page.evaluate("([s, o]) => { const e = document.querySelector(s); window.scrollTo(0, e.getBoundingClientRect().top + window.scrollY - o); }",
                          [selector, offset])
            page.wait_for_timeout(400)

        def change(selector: str, value: str):
            page.select_option(selector, value)
            page.dispatch_event(selector, "change")

        # 1. Try it: saved run where the harness fixed the answer on retry (default selection).
        page.goto(f"{app}/#try")
        page.wait_for_selector("#try-model option", state="attached")
        run_and_wait()
        scroll_to("#try-steps")
        page.screenshot(path=str(shots / "try_harness.png"))

        # 2. Not an invoice: random text with the invoice task, live.
        page.goto(f"{app}/#try")
        page.reload()
        page.wait_for_selector("#try-model option", state="attached")
        change("#try-doc", "__own__")
        page.fill("#own-text", "sdcxhjhdsajlwsijjtest")
        run_and_wait()
        scroll_to("#try-steps")
        page.screenshot(path=str(shots / "flagged.png"))

        # 3. Side by side: default Plain vs Harness on a starred invoice.
        page.goto(f"{app}/#compare")
        page.wait_for_selector("#cmp-left option", state="attached")
        page.wait_for_timeout(800)
        page.click("#cmp-run")
        page.wait_for_selector("#cmp-output:not([hidden])")
        page.wait_for_timeout(600)
        scroll_to("#cmp-note", 60)
        page.screenshot(path=str(shots / "side_by_side.png"))

        # 4. Key facts from any text on the example customer email, live.
        page.goto(f"{app}/#try")
        page.reload()
        page.wait_for_selector("#try-model option", state="attached")
        change("#try-task", "text_key_facts@1.0.0")
        change("#try-doc", "ex_customer_email")
        run_and_wait()
        page.evaluate("document.querySelector('#try-checks-note').hidden = true")
        box = page.locator("#try-ai-panel").bounding_box()
        scroll_y = page.evaluate("window.scrollY")
        page.screenshot(path=str(shots / "key_facts.png"), full_page=True,
                        clip={"x": box["x"], "y": box["y"] + scroll_y, "width": box["width"], "height": min(box["height"], 1100)})
        page.locator("#try-checks-panel").screenshot(path=str(shots / "key_facts_checks.png"))
        browser.close()


def render_scenes(scenes: list[dict]) -> None:
    from playwright.sync_api import sync_playwright

    folder = OUT / "scenes"
    folder.mkdir(parents=True, exist_ok=True)
    with sync_playwright() as p:
        browser = p.chromium.launch(channel="chrome", headless=True)
        page = browser.new_page(viewport={"width": 1920, "height": 1080})
        for scene in scenes:
            page_file = folder / f"{scene['id']}.html"
            page_file.write_text(f"<!doctype html><meta charset='utf-8'><style>{CSS}</style><div class='slide'>{scene['html']}</div>",
                                 encoding="utf-8")
            page.goto(page_file.as_uri())
            page.wait_for_timeout(300)
            page.screenshot(path=str(folder / f"{scene['id']}.png"))
        browser.close()


def ffmpeg() -> str:
    import imageio_ffmpeg

    return imageio_ffmpeg.get_ffmpeg_exe()


def narrate(scenes: list[dict], voice: str, rate: int) -> None:
    folder = OUT / "scenes"
    for scene in scenes:
        aiff, wav = folder / f"{scene['id']}.aiff", folder / f"{scene['id']}.wav"
        subprocess.run(["say", "-v", voice, "-r", str(rate), "-o", str(aiff), scene["say"]], check=True)
        subprocess.run([ffmpeg(), "-y", "-loglevel", "error", "-i", str(aiff), "-ar", "44100", "-ac", "2", str(wav)], check=True)
        aiff.unlink()
        with wave.open(str(wav)) as w:
            scene["seconds"] = w.getnframes() / w.getframerate()


def assemble(scenes: list[dict], final: Path, pause: float = 0.8) -> float:
    folder = OUT / "scenes"
    parts = []
    for scene in scenes:
        clip = folder / f"{scene['id']}.mp4"
        length = scene["seconds"] + pause
        subprocess.run([ffmpeg(), "-y", "-loglevel", "error", "-loop", "1", "-framerate", "30", "-i", str(folder / f"{scene['id']}.png"),
                        "-i", str(folder / f"{scene['id']}.wav"), "-af", f"apad=pad_dur={pause}",
                        "-vf", "scale=1920:1080,format=yuv420p", "-c:v", "libx264", "-tune", "stillimage", "-r", "30",
                        "-c:a", "aac", "-b:a", "160k", "-ar", "44100", "-t", f"{length:.3f}", str(clip)], check=True)
        parts.append(clip)
        scene["clip_seconds"] = length
    listing = folder / "concat.txt"
    listing.write_text("".join(f"file '{p.name}'\n" for p in parts), encoding="utf-8")
    subprocess.run([ffmpeg(), "-y", "-loglevel", "error", "-f", "concat", "-safe", "0", "-i", str(listing), "-c", "copy",
                    "-movflags", "+faststart", str(final)], check=True)
    return sum(s["clip_seconds"] for s in scenes)


def timestamp(seconds: float) -> str:
    ms = int(round(seconds * 1000))
    return f"{ms // 3600000:02d}:{ms // 60000 % 60:02d}:{ms // 1000 % 60:02d},{ms % 1000:03d}"


def write_texts(scenes: list[dict], stem: str) -> None:
    cues, start, n = [], 0.0, 1
    script = ["Task Harness - 5-minute submission video script", ""]
    for scene in scenes:
        sentences = [s for s in re.split(r"(?<=[.?!])\s+", scene["say"]) if s]
        total_chars = sum(len(s) for s in sentences)
        t = start
        for sentence in sentences:
            length = scene["seconds"] * len(sentence) / total_chars
            cues.append(f"{n}\n{timestamp(t)} --> {timestamp(t + length)}\n{sentence}\n")
            t += length
            n += 1
        script += [f"[{timestamp(start)[:8]}] {scene['id'][3:].replace('_', ' ').upper()}", scene["say"], ""]
        start += scene["clip_seconds"]
    (OUT / f"{stem}.srt").write_text("\n".join(cues), encoding="utf-8")
    (OUT / f"{stem}-script.txt").write_text("\n".join(script), encoding="utf-8")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--app", default="http://127.0.0.1:8000")
    parser.add_argument("--voice", default="Samantha")
    parser.add_argument("--rate", type=int, default=165)
    parser.add_argument("--skip-shots", action="store_true", help="Reuse existing screenshots in video/shots/.")
    parser.add_argument("--variant", choices=["full", "impromptu"], default="full",
                        help="full = ~4-minute Task Harness video; impromptu = ~90-second segment for the team's Impromptu video.")
    args = parser.parse_args()

    results = load_results()
    if args.variant == "impromptu":
        scenes, final, stem = build_segment_scenes(results), ROOT.parent / "Impromptu-TaskHarness-Segment.mp4", "Impromptu-TaskHarness-segment"
    else:
        scenes, final, stem = build_scenes(results), FINAL, "TaskHarness-video"
    if not args.skip_shots:
        print("Capturing app screenshots…")
        capture_shots(args.app)
    print("Rendering slides…")
    render_scenes(scenes)
    print("Recording narration…")
    narrate(scenes, args.voice, args.rate)
    print("Assembling video…")
    total = assemble(scenes, final)
    write_texts(scenes, stem)
    print(f"Saved {final} ({int(total // 60)} min {int(total % 60)} s)")


if __name__ == "__main__":
    main()
