"""Build the hackathon slide deck from the saved run results.

Usage:  .venv/bin/python slides/make_slides.py
Writes: ../docs/TaskHarness-Hackathon-Slides.pptx
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

from pptx import Presentation
from pptx.dml.color import RGBColor
from pptx.enum.shapes import MSO_SHAPE
from pptx.enum.text import MSO_ANCHOR, PP_ALIGN
from pptx.util import Inches, Pt

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from taskharness.web.server import estimate_cost, index_runs, model_label  # noqa: E402

OUT = ROOT.parent / "docs" / "TaskHarness-Hackathon-Slides.pptx"

NAVY = RGBColor(0x14, 0x30, 0x4D)
BLUE = RGBColor(0x17, 0x65, 0xA8)
TEAL = RGBColor(0x0F, 0x8B, 0x8D)
LIGHT = RGBColor(0xF3, 0xF6, 0xFA)
LINE = RGBColor(0xD8, 0xE1, 0xEC)
GREY = RGBColor(0x5B, 0x6B, 0x7F)
RED = RGBColor(0xC0, 0x39, 0x2B)
GREEN = RGBColor(0x1F, 0x8A, 0x4C)
WHITE = RGBColor(0xFF, 0xFF, 0xFF)
DARK = RGBColor(0x1B, 0x2B, 0x3C)
PALE = RGBColor(0xA9, 0xC8, 0xE6)


def load_results() -> dict:
    rows = {}
    for (model, mode), entry in index_runs(ROOT / "runs").items():
        if not entry["complete"]:
            continue
        summary = json.loads((entry["dir"] / "summary.json").read_text(encoding="utf-8"))
        raw = [json.loads(line) for line in (entry["dir"] / "results.jsonl").read_text(encoding="utf-8").splitlines() if line]
        prompt = sum(r.get("prompt_tokens", 0) or 0 for r in raw)
        completion = sum(r.get("completion_tokens", 0) or 0 for r in raw)
        family = "opus" if "opus" in model else "haiku" if "haiku" in model else model
        rows[(family, mode)] = {**summary, "label": model_label(model), "cost": estimate_cost(model, prompt, completion)}
    missing = [k for k in [("opus", "plain"), ("haiku", "plain"), ("haiku", "harness")] if k not in rows]
    if missing:
        raise SystemExit(f"Missing completed runs for {missing}. Run the comparisons first.")
    return rows


def text(slide, x, y, w, h, value, size=18, bold=False, color=DARK, align=PP_ALIGN.LEFT, anchor=MSO_ANCHOR.TOP):
    box = slide.shapes.add_textbox(Inches(x), Inches(y), Inches(w), Inches(h))
    frame = box.text_frame
    frame.word_wrap = True
    frame.vertical_anchor = anchor
    for n, line in enumerate(value.split("\n")):
        para = frame.paragraphs[0] if n == 0 else frame.add_paragraph()
        para.alignment = align
        run = para.add_run()
        run.text = line
        run.font.size = Pt(size)
        run.font.bold = bold
        run.font.color.rgb = color
    return box


def bullets(slide, x, y, w, h, items, size=18):
    box = slide.shapes.add_textbox(Inches(x), Inches(y), Inches(w), Inches(h))
    frame = box.text_frame
    frame.word_wrap = True
    for n, item in enumerate(items):
        para = frame.paragraphs[0] if n == 0 else frame.add_paragraph()
        lead_text, has_body, body_text = item.partition("|")
        lead = para.add_run()
        lead.text = "•  " + (lead_text if has_body else "")
        lead.font.size = Pt(size)
        lead.font.bold = bool(has_body)
        lead.font.color.rgb = DARK
        body = para.add_run()
        body.text = body_text if has_body else lead_text
        body.font.size = Pt(size)
        body.font.color.rgb = DARK
        para.space_after = Pt(10)
    return box


def card(slide, x, y, w, h, fill=WHITE, border=LINE):
    box = slide.shapes.add_shape(MSO_SHAPE.ROUNDED_RECTANGLE, Inches(x), Inches(y), Inches(w), Inches(h))
    box.adjustments[0] = 0.06
    box.fill.solid()
    box.fill.fore_color.rgb = fill
    box.line.color.rgb = border
    box.shadow.inherit = False
    return box


def rect(slide, x, y, w, h, fill):
    box = slide.shapes.add_shape(MSO_SHAPE.RECTANGLE, Inches(x), Inches(y), Inches(w), Inches(h))
    box.fill.solid()
    box.fill.fore_color.rgb = fill
    box.line.fill.background()
    box.shadow.inherit = False
    return box


def header(slide, title, kicker):
    rect(slide, 0, 0, 13.333, 1.15, NAVY)
    text(slide, 0.6, 0.12, 12, 0.35, kicker.upper(), size=11, bold=True, color=PALE)
    text(slide, 0.6, 0.4, 12, 0.7, title, size=28, bold=True, color=WHITE)


def new_slide(prs, notes):
    slide = prs.slides.add_slide(prs.slide_layouts[6])
    slide.background.fill.solid()
    slide.background.fill.fore_color.rgb = LIGHT
    slide.notes_slide.notes_text_frame.text = notes
    return slide


def money(value):
    return f"${value:.2f}" if value >= 0.01 else f"${value:.3f}"


def build(r: dict) -> Presentation:
    opus, haiku, harness = r[("opus", "plain")], r[("haiku", "plain")], r[("haiku", "harness")]
    speed = opus["avg_seconds"] / harness["avg_seconds"]
    cheaper = opus["cost"] / harness["cost"]
    docs = harness["docs"]
    big = opus["label"].replace("Claude ", "")

    prs = Presentation()
    prs.slide_width, prs.slide_height = Inches(13.333), Inches(7.5)

    # 1. Title
    s = new_slide(prs, "Hi, I'm Surekha. Our idea is the Task Harness: a simple way to make AI answers trustworthy, "
                       "so any Hyland team can use cheaper models without wrong answers slipping through.")
    rect(s, 0, 0, 13.333, 7.5, NAVY)
    rect(s, 0.8, 3.55, 1.4, 0.08, TEAL)
    text(s, 0.8, 1.6, 11.5, 0.5, "HYLAND HACKATHON", size=14, bold=True, color=PALE)
    text(s, 0.8, 2.1, 11.5, 1.3, "Task Harness", size=54, bold=True, color=WHITE)
    text(s, 0.8, 3.85, 11.5, 1.3, "A reusable quality gate for every AI call at Hyland:\nchecked, consistent and cheaper.",
         size=24, color=WHITE)
    text(s, 0.8, 6.3, 11.5, 0.5, "Team Impromptu: Rahul Rajpoot (team leader), Surekha Jaknalli, Vivek Chaturvedi  ·  November 2026", size=14, color=PALE)

    # 2. Problem
    s = new_slide(prs, "When teams call a generative AI model to read a document, it's usually right, but sometimes it's "
                       "quietly wrong. It picks the due date instead of the invoice date, or flips a sign. Classic capture "
                       "products like Brainware validate their results, but new AI calls usually have no standard check. "
                       "So teams either trust the AI blindly or pay for the biggest model to be safe.")
    header(s, "AI is usually right, but sometimes quietly wrong", "The problem")
    problems = [
        ("Inconsistent", BLUE, f"Same request, different formats. Even the most expensive model gave "
                               f"{opus['format_errors']} of {docs} answers in the wrong format (e.g. 'null' instead of 0)."),
        ("Unchecked", RED, f"Classic capture validates its results, but new generative-AI calls usually don't. The "
                           f"cheapest model got {haiku['silent_errors']} of {docs} invoices wrong, and nobody was warned."),
        ("Expensive", TEAL, "To be safe, teams reach for the biggest model, paying more and waiting longer "
                            "for every document."),
    ]
    for n, (title, colour, body) in enumerate(problems):
        x = 0.6 + n * 4.1
        card(s, x, 1.6, 3.85, 3.7)
        text(s, x + 0.3, 1.85, 3.3, 0.6, title, size=24, bold=True, color=colour)
        text(s, x + 0.3, 2.55, 3.3, 2.7, body, size=16)
    card(s, 0.6, 5.65, 12.1, 1.15, fill=RGBColor(0xFD, 0xEC, 0xEA), border=RGBColor(0xF2, 0xC4, 0xBE))
    text(s, 0.9, 5.75, 11.5, 0.95, "Real example: the AI wrote a discount as -393.32 instead of 393.32. A downstream "
         "system would add the discount instead of subtracting it, and the total would be wrong.",
         size=16, color=RED, anchor=MSO_ANCHOR.MIDDLE)

    # 3. The idea
    s = new_slide(prs, "Instead of trusting the AI, we wrap it in a harness. A fixed template defines the task. Normal "
                       "code cleans the document. The AI answers. Then simple code checks every answer. If a check fails, "
                       "the AI gets one retry with feedback. If it still fails, a person reviews it. Everything is logged.")
    header(s, "A quality gate around every AI call", "The idea")
    steps = [("1", "Pick a task", "Versioned\ntemplate"), ("2", "Clean", "Normal code tidies\nthe document"),
             ("3", "Build prompt", "Rules, fields,\noutput format"), ("4", "AI answers", "Approved\nmodel"),
             ("5", "Check", "Format, source,\nright line, sums"), ("6", "Retry or flag", "One retry, then\nhuman review"),
             ("7", "Log", "Every step\nrecorded")]
    width, gap = 1.62, 0.13
    for n, (num, title, sub) in enumerate(steps):
        x = 0.6 + n * (width + gap)
        key = num in ("5", "6")
        card(s, x, 1.8, width, 2.4, fill=TEAL if key else WHITE, border=TEAL if key else LINE)
        dot = s.shapes.add_shape(MSO_SHAPE.OVAL, Inches(x + width / 2 - 0.25), Inches(2.0), Inches(0.5), Inches(0.5))
        dot.fill.solid()
        dot.fill.fore_color.rgb = WHITE if key else TEAL
        dot.line.fill.background()
        dot.shadow.inherit = False
        frame = dot.text_frame
        frame.text = num
        para = frame.paragraphs[0]
        para.alignment = PP_ALIGN.CENTER
        para.runs[0].font.size = Pt(16)
        para.runs[0].font.bold = True
        para.runs[0].font.color.rgb = TEAL if key else WHITE
        text(s, x + 0.05, 2.65, width - 0.1, 0.5, title, size=16, bold=True, color=WHITE if key else DARK,
             align=PP_ALIGN.CENTER)
        text(s, x + 0.05, 3.2, width - 0.1, 0.9, sub, size=12, color=WHITE if key else GREY, align=PP_ALIGN.CENTER)
    text(s, 0.6, 4.55, 12.1, 0.6, "The AI is one step. The value is in steps 5 and 6.", size=22, bold=True, color=NAVY)
    bullets(s, 0.6, 5.25, 12.1, 2, [
        "Analogy:| the AI is a fast new employee; the harness is the checklist and the supervisor.",
        "Reusable:| a new task (contracts, claims, test logs) is a new template, not a new project.",
    ], size=17)

    # 4. How it fits with existing Hyland work
    s = new_slide(prs, "We checked what already exists. Brainware already does invoice capture with validation for "
                       "classic capture. An internal prompt optimizer improves prompt wording. Several proofs of concept "
                       "extract fields with LLMs, but they don't check the answers in a standard way. The gap is a "
                       "reusable quality gate for AI answers, plus measurement to pick the cheapest good-enough model. "
                       "We'd like to work with those teams, not compete with them.")
    header(s, "How this fits with what Hyland already has", "Positioning")
    fits = [
        ("Brainware", "Classic capture: classify, extract, validate against business systems, human verification.",
         "Invoices are solved here.", GREY),
        ("Prompt optimizer (internal)", "Improves and compresses prompt wording.",
         "Better input, but does not check the answer.", GREY),
        ("LLM extraction proofs of concept", "Extract fields with Claude on Bedrock using a field list.",
         "Answers are not checked or measured in a standard way.", GREY),
        ("Task Harness", "Checks every AI answer, retries with feedback, flags the rest, and measures accuracy and cost.",
         "The missing quality gate for generative AI.", TEAL),
    ]
    for n, (title, does, gap_text, colour) in enumerate(fits):
        y = 1.45 + n * 1.33
        ours = colour == TEAL
        card(s, 0.6, y, 12.1, 1.18, fill=RGBColor(0xE6, 0xF4, 0xF4) if ours else WHITE, border=TEAL if ours else LINE)
        text(s, 0.9, y + 0.12, 3.4, 0.9, title, size=18, bold=True, color=TEAL if ours else NAVY, anchor=MSO_ANCHOR.MIDDLE)
        text(s, 4.3, y + 0.12, 4.6, 0.95, does, size=14, anchor=MSO_ANCHOR.MIDDLE)
        text(s, 9.0, y + 0.12, 3.5, 0.95, gap_text, size=14, bold=True, color=TEAL if ours else RED,
             anchor=MSO_ANCHOR.MIDDLE)
    text(s, 0.6, 6.85, 12.1, 0.45, "Invoices are our test case because answers are easy to verify, not because "
         "invoice capture is new.", size=13, color=GREY)

    # 5. Checks
    s = new_slide(prs, "The checks are plain code, not more AI. Is the value really in the document? Did it come from "
                       "the right line, so not the due date or the customer? Do the sums add up? Is the format right? "
                       "If anything fails, the AI gets one retry with the exact problem, then a person reviews it.")
    header(s, "Simple code checks catch the mistakes AI makes", "How the checks work")
    checks = [
        ("Is it in the document?", "Every value must appear in the source text, after normalising formats "
                                   "(1,20,000.00 · 1.200,00 · 5 Nov 2026)."),
        ("Is it from the right line?", "Vendor is not the 'Bill To' customer. Invoice date is not the 'Due Date'. "
                                       "Total is not the 'Amount Due'."),
        ("Do the sums add up?", "Quantity × price = amount. Lines add up to the subtotal. "
                                "Total = subtotal − discount + tax."),
        ("Is the format right?", "Exactly the agreed fields and types every time, so downstream systems can rely on it."),
    ]
    for n, (title, body) in enumerate(checks):
        x, y = 0.6 + (n % 2) * 6.15, 1.55 + (n // 2) * 2.2
        card(s, x, y, 5.95, 1.95)
        text(s, x + 0.3, y + 0.2, 5.4, 0.5, f"✓  {title}", size=20, bold=True, color=TEAL)
        text(s, x + 0.3, y + 0.8, 5.4, 1.1, body, size=15)
    card(s, 0.6, 6.1, 12.1, 0.9, fill=RGBColor(0xEE, 0xF5, 0xFC), border=RGBColor(0xC9, 0xDD, 0xF1))
    text(s, 0.9, 6.15, 11.5, 0.8, "Fails a check → one retry with the exact problem as feedback → still failing → "
         "sent to a person. Never passed on silently.", size=16, bold=True, color=NAVY, anchor=MSO_ANCHOR.MIDDLE)

    # 5. Results
    s = new_slide(prs, f"We ran {docs} invoices through Claude on our AWS account. The most expensive model, {opus['label']}, "
                       f"got every answer right, but {opus['format_errors']} were in the wrong format. The cheapest model, "
                       f"{haiku['label']}, silently got {haiku['silent_errors']} wrong. With the harness, the cheapest model got "
                       f"{harness['fully_correct']} out of {docs} right with zero silent errors, {speed:.1f} times faster and "
                       f"about {cheaper:.0f} times cheaper than the big model with a plain prompt.")
    header(s, f"Results on {docs} invoices (Claude on Hyland AWS Bedrock)", "The proof")
    rows = [
        ("Setup", "Correct", "Format errors", "Silent errors", "Sec / invoice", f"Cost for {docs}"),
        (f"{opus['label']}, plain prompt", f"{opus['fully_correct']}/{docs}", str(opus["format_errors"]),
         str(opus["silent_errors"]), f"{opus['avg_seconds']:.1f}", money(opus["cost"])),
        (f"{haiku['label']}, plain prompt", f"{haiku['fully_correct']}/{docs}", str(haiku["format_errors"]),
         str(haiku["silent_errors"]), f"{haiku['avg_seconds']:.1f}", money(haiku["cost"])),
        (f"{harness['label']} + harness", f"{harness['fully_correct']}/{docs}", str(harness["format_errors"]),
         str(harness["silent_errors"]), f"{harness['avg_seconds']:.1f}", money(harness["cost"])),
    ]
    table = s.shapes.add_table(len(rows), len(rows[0]), Inches(0.6), Inches(1.5), Inches(12.1), Inches(2.4)).table
    for c, w in enumerate([4.1, 1.5, 1.6, 1.6, 1.6, 1.7]):
        table.columns[c].width = Inches(w)
    for r_i, row in enumerate(rows):
        for c, value in enumerate(row):
            cell = table.cell(r_i, c)
            cell.text = value
            run = cell.text_frame.paragraphs[0].runs[0]
            run.font.size = Pt(16)
            run.font.bold = r_i in (0, 3)
            cell.fill.solid()
            if r_i == 0:
                cell.fill.fore_color.rgb, run.font.color.rgb = NAVY, WHITE
            elif r_i == 3:
                cell.fill.fore_color.rgb, run.font.color.rgb = RGBColor(0xE8, 0xF6, 0xEE), GREEN
            else:
                cell.fill.fore_color.rgb = WHITE
                run.font.color.rgb = RED if (r_i == 2 and c == 3) else DARK
    stats = [(f"{harness['fully_correct']}/{docs}", "correct with the\ncheapest model"),
             (str(harness["silent_errors"]), "silent errors"),
             (f"{speed:.1f}×", f"faster than\n{big}"),
             (f"~{cheaper:.0f}×", f"cheaper than\n{big}")]
    for n, (number, label) in enumerate(stats):
        x = 0.6 + n * 3.08
        card(s, x, 4.3, 2.85, 2.0, fill=TEAL, border=TEAL)
        text(s, x, 4.45, 2.85, 0.9, number, size=40, bold=True, color=WHITE, align=PP_ALIGN.CENTER)
        text(s, x, 5.35, 2.85, 0.9, label, size=14, color=WHITE, align=PP_ALIGN.CENTER)
    text(s, 0.6, 6.55, 12.1, 0.6, "Synthetic invoices with known answers. Costs estimated from Anthropic list prices; "
         "Bedrock prices may differ. A second Haiku run gave the same picture.", size=12, color=GREY)

    # 6. Examples
    s = new_slide(prs, "Switch to the web app here. On 'Try it', run inv_001 with the full harness and show it being fixed "
                       "on retry. On 'Side by side', compare plain and harness on inv_004 and show the silent discount "
                       "error. Optionally upload the not-an-invoice example and show it being flagged.")
    header(s, "What it looks like in practice", "Live demo")
    examples = [
        ("Silent error, caught", RED, "Plain prompt wrote the discount as -393.32. No warning.\n\n"
                                      "Harness: correct (393.32), every check passed."),
        ("Fixed on retry", TEAL, "First answer broke the format rules. The check spotted it, sent feedback, "
                                 "and the AI fixed it on the second try."),
        ("Not an invoice → flagged", BLUE, "Uploaded meeting notes. The AI said 'no invoice found', and the harness "
                                           "sent it for human review instead of inventing values."),
    ]
    for n, (title, colour, body) in enumerate(examples):
        x = 0.6 + n * 4.1
        card(s, x, 1.6, 3.85, 4.1)
        rect(s, x, 1.6, 3.85, 0.12, colour)
        text(s, x + 0.3, 1.95, 3.3, 0.6, title, size=21, bold=True, color=colour)
        text(s, x + 0.3, 2.7, 3.3, 2.9, body, size=16)
    text(s, 0.6, 6.0, 12.1, 0.9, "Demo app: Try it (step by step) · Side by side (plain vs harness) · Results · "
         "Upload your own text file", size=16, bold=True, color=NAVY)

    # 7. Roadmap
    s = new_slide(prs, "Invoices are just the first example. The harness pattern works for any document task. Next would "
                       "be a template library, a simple way for teams to add their own tasks, approved models only, and an "
                       "audit trail. It also lets each team pick the cheapest model that is good enough.")
    header(s, "From one task to every Hyland team", "Roadmap")
    road = [("Template library", "Invoices, contracts, claims, test-log summaries, classification."),
            ("Teams add their own", "Define fields, rules and checks; no prompt engineering needed."),
            ("Approved models only", "Runs through company-approved accounts; no personal keys."),
            ("Audit trail", "Every prompt, answer, check and retry logged against the template version."),
            ("Right-size the model", "Show when a cheaper, faster model plus checks is good enough."),
            ("HS1 as a fast check", "Optional quick yes/no judgments, e.g. 'is this an invoice?', before the pipeline.")]
    for n, (title, body) in enumerate(road):
        x, y = 0.6 + (n % 3) * 4.1, 1.6 + (n // 3) * 2.45
        card(s, x, y, 3.85, 2.2)
        text(s, x + 0.3, y + 0.2, 3.3, 0.5, title, size=19, bold=True, color=TEAL)
        text(s, x + 0.3, y + 0.8, 3.3, 1.3, body, size=15)

    # 8. Limits and ask
    s = new_slide(prs, f"To be upfront: this is {docs} synthetic invoices and two tasks so far, and invoice capture itself "
                       "already exists in Brainware. The next step is a pilot with one team on real, approved documents, "
                       "adding the harness to an existing AI proof of concept, and working with the Brainware/IDP and "
                       "HAIP teams. Thank you, happy to take questions.")
    header(s, "Honest limits and the ask", "Next steps")
    card(s, 0.6, 1.6, 5.95, 4.5)
    text(s, 0.9, 1.8, 5.4, 0.5, "Limits today", size=22, bold=True, color=RED)
    bullets(s, 0.9, 2.45, 5.4, 3.6, [
        f"{docs} synthetic invoices with known answers; two tasks.",
        "Checks are written per task; each new task needs its own.",
        "Invoice capture already exists (Brainware); invoices are only our test case.",
        "Not yet checked: whether HAIP or newer AI products already gate AI answers.",
        "Costs are list-price estimates.",
    ], size=16)
    card(s, 6.75, 1.6, 5.95, 4.5, fill=RGBColor(0xE8, 0xF6, 0xEE), border=RGBColor(0xBF, 0xE3, 0xCD))
    text(s, 7.05, 1.8, 5.4, 0.5, "The ask", size=22, bold=True, color=GREEN)
    bullets(s, 7.05, 2.45, 5.4, 3.6, [
        "One pilot team| with real, approved documents.",
        "Add the harness| to an existing AI proof of concept to prove reuse.",
        "Work with Brainware/IDP and HAIP| to build on, not duplicate.",
        "A sponsor| to connect it to the company AI platform.",
    ], size=16)
    text(s, 0.6, 6.4, 12.1, 0.7, "A standard quality gate for AI answers: checked, measured, and the cheapest model "
         "that is good enough.", size=20, bold=True, color=NAVY, align=PP_ALIGN.CENTER)
    return prs


if __name__ == "__main__":
    build(load_results()).save(OUT)
    print(f"Saved {OUT}")
