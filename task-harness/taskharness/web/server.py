"""Web app for demonstrating the task harness: replay saved runs or run live."""

from __future__ import annotations

import json
import re
import threading
from dataclasses import dataclass, field
from datetime import datetime
from pathlib import Path
from typing import Callable

from fastapi import FastAPI, HTTPException
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

from ..evaluate import FIELDS, field_correct, score_result
from ..generate import load_dataset
from ..llm import BedrockClient, LLMClient, PROVIDERS, infer_provider
from ..pipeline import MODES, run_document
from ..preprocess import DocumentTooLarge, clean, render_sections, split_sections
from ..template import load_template, template_id
from ..validate import check_report, schema_issues

STATIC = Path(__file__).resolve().parent / "static"

MODE_LABELS = {
    "plain": "Plain prompt",
    "json_mode": "Plain prompt + JSON mode",
    "template": "Template (no checks)",
    "harness": "Full harness (template + checks + retry)",
}

# USD per million tokens, Anthropic list prices (Bedrock pricing may differ). Haiku is a "from" price.
PRICES = {"opus": (4.0, 20.0), "sonnet": (2.0, 10.0), "haiku": (0.10, 0.50), "fable": (10.0, 50.0)}

DEFAULT_LIVE_MODELS = [
    "us.anthropic.claude-haiku-5-5",
    "us.anthropic.claude-sonnet-5-5",
    "us.anthropic.claude-opus-5-5",
]


def model_label(model: str) -> str:
    match = re.search(r"claude-([a-z]+)-(\d+)(?:-(\d+))?", model)
    if match:
        family, major, minor = match.groups()
        version = f"{major}.{minor}" if minor and len(minor) <= 2 else major
        return f"Claude {family.capitalize()} {version}"
    return model


def model_price(model: str) -> tuple[float, float] | None:
    for family, price in PRICES.items():
        if f"claude-{family}" in model:
            return price
    return None


def estimate_cost(model: str, prompt_tokens: int, completion_tokens: int) -> float | None:
    price = model_price(model)
    if price is None:
        return None
    return (prompt_tokens * price[0] + completion_tokens * price[1]) / 1_000_000


@dataclass
class AppConfig:
    data_dir: Path
    runs_dir: Path
    templates_dir: Path
    live_models: list[str] = field(default_factory=lambda: list(DEFAULT_LIVE_MODELS))
    aws_profile: str | None = None
    aws_region: str | None = None
    llm_factory: Callable[[str], LLMClient] | None = None
    examples_dir: Path | None = None


class LiveRequest(BaseModel):
    doc_id: str
    mode: str
    model: str
    task: str | None = None


class OwnTextRequest(BaseModel):
    text: str
    filename: str | None = None
    mode: str = "harness"
    model: str
    task: str | None = None


MAX_UPLOAD_CHARS = 200_000


def _read_jsonl(path: Path) -> list[dict]:
    if not path.exists():
        return []
    rows = []
    for line in path.read_text(encoding="utf-8").splitlines():
        if line.strip():
            try:
                rows.append(json.loads(line))
            except json.JSONDecodeError:
                continue  # a run still being written can end with a partial line
    return rows


def list_runs(runs_dir: Path) -> list[dict]:
    """Every saved (run, mode) folder, oldest first."""
    entries: list[dict] = []
    if not runs_dir.exists():
        return entries
    for run_dir in sorted(p for p in runs_dir.iterdir() if p.is_dir() and p.name != "live"):
        for mode_dir in sorted(p for p in run_dir.iterdir() if p.is_dir()):
            results_path = mode_dir / "results.jsonl"
            if mode_dir.name not in MODES or not results_path.exists():
                continue
            first = results_path.read_text(encoding="utf-8").split("\n", 1)[0]
            try:
                model = json.loads(first)["model"]
            except (json.JSONDecodeError, KeyError):
                continue
            summary_path = mode_dir / "summary.json"
            summary = json.loads(summary_path.read_text(encoding="utf-8")) if summary_path.exists() else None
            entries.append({"model": model, "mode": mode_dir.name, "run": run_dir.name, "dir": mode_dir,
                            "complete": summary is not None, "summary": summary})
    return entries


def index_runs(runs_dir: Path) -> dict[tuple[str, str], dict]:
    """Latest saved run per (model, mode). Completed runs win over newer partial ones."""
    index: dict[tuple[str, str], dict] = {}
    for entry in list_runs(runs_dir):
        key = (entry["model"], entry["mode"])
        current = index.get(key)
        if current is None or entry["complete"] or not current["complete"]:
            index[key] = entry
    return index


def find_run(runs_dir: Path, model: str, mode: str, run: str | None) -> dict | None:
    if not run:
        return index_runs(runs_dir).get((model, mode))
    return next((e for e in list_runs(runs_dir) if (e["model"], e["mode"], e["run"]) == (model, mode, run)), None)


def run_time(run: str) -> str:
    try:
        return datetime.strptime(run, "%Y%m%d-%H%M%S").strftime("%d %b %H:%M")
    except ValueError:
        return run


def create_app(config: AppConfig) -> FastAPI:
    app = FastAPI(title="Task Harness demo")

    @app.middleware("http")
    async def revalidate_static(request, call_next):
        response = await call_next(request)
        if request.url.path == "/" or request.url.path.startswith("/static/"):
            response.headers["Cache-Control"] = "no-cache"  # always pick up updated page files on reload
        return response
    templates = {}
    for path in sorted(config.templates_dir.glob("*/*.json")):
        template = load_template(path)
        templates[template_id(template)] = template
    if not templates:
        raise RuntimeError(f"No templates found in {config.templates_dir}")
    default_task = next(iter(templates))
    dataset = {d["doc_id"]: d for d in load_dataset(config.data_dir)}
    examples = {}
    if config.examples_dir and config.examples_dir.is_dir():
        for path in sorted(config.examples_dir.glob("*.txt")):
            doc_id = f"ex_{path.stem}"
            examples[doc_id] = {"doc_id": doc_id, "text": path.read_text(encoding="utf-8"), "label": None,
                                "name": path.stem.replace("_", " ").capitalize()}
    clients: dict[str, LLMClient] = {}
    clients_lock = threading.Lock()

    def get_template(task: str | None) -> dict:
        template = templates.get(task or default_task)
        if template is None:
            raise HTTPException(404, f"Unknown task {task}")
        return template

    def get_doc(doc_id: str) -> dict:
        doc = dataset.get(doc_id) or examples.get(doc_id)
        if doc is None:
            raise HTTPException(404, f"Unknown document {doc_id}")
        return doc

    def make_client(model: str) -> LLMClient:
        if config.llm_factory:
            return config.llm_factory(model)
        provider = infer_provider(model)
        if provider == "bedrock":
            return BedrockClient(model, aws_profile=config.aws_profile, aws_region=config.aws_region)
        return PROVIDERS[provider][1](model)

    def view(result: dict, doc: dict, template: dict, source: str) -> dict:
        """Screen data for one result. Documents without a matching label (your own files,
        or a task the label was not written for) get checks only."""
        field_names = list(template["output_schema"].get("properties", {})) or FIELDS
        label = doc.get("label")
        if label and set(label.get("expected", {})) != set(field_names):
            label = None
        expected = label["expected"] if label else None
        output = result.get("output") if isinstance(result.get("output"), dict) else None
        cleaned = clean(doc["text"])
        fields = []
        for name in field_names:
            got = output.get(name) if output else None
            fields.append({
                "name": name, "got": got,
                "expected": expected[name] if expected else None,
                "correct": (bool(output) and field_correct(name, got, expected[name])) if expected else None,
            })
        if label:
            score = score_result(result, label, doc["text"], template)
            all_correct, schema_ok = score["all_correct"], score["schema_ok"]
        else:
            all_correct = None
            schema_ok = output is not None and not schema_issues(output, template["output_schema"])
        attempts = result.get("attempts", [])
        status = result.get("status")
        if status == "passed" and len(attempts) > 1:
            status = "fixed_on_retry"
        prompt_tokens = result.get("prompt_tokens", 0) or 0
        completion_tokens = result.get("completion_tokens", 0) or 0
        return {
            "source": source,
            "doc_id": doc["doc_id"],
            "has_answer_key": label is not None,
            "mode": result["mode"],
            "mode_label": MODE_LABELS.get(result["mode"], result["mode"]),
            "model": result.get("model"),
            "model_label": model_label(result.get("model") or ""),
            "template": result.get("template"),
            "status": status,
            "checks_run": result["mode"] == "harness",
            "attempts": attempts,
            "issues": result.get("issues", []),
            "output": result.get("output"),
            "fields": fields,
            "all_correct": all_correct,
            "schema_ok": schema_ok,
            "checks": check_report(output, cleaned, template),
            "latency_ms": result.get("latency_ms", 0.0),
            "prompt_tokens": prompt_tokens,
            "completion_tokens": completion_tokens,
            "cost_usd": estimate_cost(result.get("model") or "", prompt_tokens, completion_tokens),
            "document": None if label else {"raw": doc["text"], "cleaned": cleaned},
        }

    def live_run(doc: dict, mode: str, model: str, task: str | None) -> dict:
        if model not in config.live_models:
            raise HTTPException(400, "Model is not enabled for live runs")
        if mode not in MODES:
            raise HTTPException(400, f"Unknown mode {mode}")
        template = get_template(task)
        try:
            with clients_lock:
                if model not in clients:
                    clients[model] = make_client(model)
                llm = clients[model]
            result = run_document(doc["doc_id"], doc["text"], mode, llm, template)
        except Exception as error:  # expired login, bad model, missing region
            raise HTTPException(503, f"Live run failed: {error}. Sign in again or switch to Saved run.") from error
        live_dir = config.runs_dir / "live"
        live_dir.mkdir(parents=True, exist_ok=True)
        with (live_dir / "live.jsonl").open("a", encoding="utf-8") as handle:
            handle.write(json.dumps({"at": datetime.now().isoformat(), **result}, ensure_ascii=False) + "\n")
        return view(result, doc, template, source="live")

    @app.get("/api/overview")
    def overview() -> dict:
        entries = sorted(list_runs(config.runs_dir),
                         key=lambda e: (model_label(e["model"]), MODES.index(e["mode"]), e["run"]))
        sources = [
            {"model": e["model"], "model_label": model_label(e["model"]), "mode": e["mode"],
             "mode_label": MODE_LABELS[e["mode"]], "complete": e["complete"], "run": e["run"],
             "run_label": run_time(e["run"]), "retries": (e["summary"] or {}).get("retries"),
             "docs": len(_read_jsonl(e["dir"] / "results.jsonl")),
             "retried_docs": [r["doc_id"] for r in _read_jsonl(e["dir"] / "results.jsonl") if len(r.get("attempts", [])) > 1],
             "wrong_docs": [s["doc_id"] for s in _read_jsonl(e["dir"] / "scores.jsonl") if not s.get("all_correct")]}
            for e in entries
        ]
        label_fields = {frozenset(d["label"]["expected"]) for d in dataset.values()}
        return {
            "tasks": [{"id": tid, "task": t["task"], "title": t.get("title") or t["task"].replace("_", " ").capitalize(),
                       "version": t["version"], "rules": t["rules"], "fields": t["fields"],
                       "has_examples": frozenset(t["output_schema"].get("properties", {})) in label_fields}
                      for tid, t in templates.items()],
            "documents": [{"doc_id": d["doc_id"], **d["label"].get("meta", {})} for d in dataset.values()],
            "examples": [{"doc_id": e["doc_id"], "name": e["name"]} for e in examples.values()],
            "modes": [{"id": m, "label": MODE_LABELS[m]} for m in MODES],
            "sources": sources,
            "live_models": [{"model": m, "model_label": model_label(m)} for m in config.live_models],
        }

    @app.get("/api/documents/{doc_id}")
    def document(doc_id: str, task: str | None = None) -> dict:
        doc, template = get_doc(doc_id), get_template(task)
        cleaned = clean(doc["text"])
        try:
            sectioned = render_sections(split_sections(cleaned, template.get("max_document_chars", 20000)))
        except DocumentTooLarge:
            sectioned = None
        return {
            "doc_id": doc_id,
            "raw": doc["text"],
            "cleaned": cleaned,
            "sectioned": sectioned,
            "expected": doc["label"]["expected"] if doc.get("label") else None,
            "meta": doc["label"].get("meta", {}) if doc.get("label") else {"example": True},
        }

    @app.get("/api/replay")
    def replay(model: str, mode: str, doc_id: str, task: str | None = None, run: str | None = None) -> dict:
        doc, template = get_doc(doc_id), get_template(task)
        entry = find_run(config.runs_dir, model, mode, run)
        if entry is None:
            raise HTTPException(404, f"No saved run for {model_label(model)} / {MODE_LABELS.get(mode, mode)}")
        result = next((r for r in _read_jsonl(entry["dir"] / "results.jsonl") if r["doc_id"] == doc_id), None)
        if result is None:
            raise HTTPException(404, f"{doc_id} is not in the saved run yet")
        return view(result, doc, template, source=f"replay:{entry['run']}")

    @app.post("/api/live")
    def live(request: LiveRequest) -> dict:
        return live_run(get_doc(request.doc_id), request.mode, request.model, request.task)

    @app.post("/api/live-text")
    def live_text(request: OwnTextRequest) -> dict:
        """Run the harness on text the user uploaded or pasted. There is no answer key, so only checks are shown."""
        text = request.text
        if not text.strip():
            raise HTTPException(400, "The document is empty.")
        if len(text) > MAX_UPLOAD_CHARS:
            raise HTTPException(413, f"The document is too long ({len(text)} characters; limit {MAX_UPLOAD_CHARS}).")
        name = re.sub(r"[^\w.\-]+", "_", request.filename or "your_document")[:80] or "your_document"
        return live_run({"doc_id": name, "text": text, "label": None}, request.mode, request.model, request.task)

    @app.get("/api/results")
    def results() -> dict:
        rows = []
        for (model, mode), entry in index_runs(config.runs_dir).items():
            if not entry["complete"]:
                continue
            summary = json.loads((entry["dir"] / "summary.json").read_text(encoding="utf-8"))
            raw = _read_jsonl(entry["dir"] / "results.jsonl")
            prompt = sum(r.get("prompt_tokens", 0) or 0 for r in raw)
            completion = sum(r.get("completion_tokens", 0) or 0 for r in raw)
            rows.append({**summary, "model": model, "model_label": model_label(model), "mode": mode,
                         "mode_label": MODE_LABELS[mode], "run": entry["run"],
                         "cost_usd": estimate_cost(model, prompt, completion)})
        rows.sort(key=lambda r: (r["model_label"], MODES.index(r["mode"])))
        return {"rows": rows,
                "price_note": "Estimated at Anthropic list prices per million tokens; Bedrock prices may differ."}

    @app.get("/api/differences")
    def differences(left_model: str, left_mode: str, right_model: str, right_mode: str,
                    left_run: str | None = None, right_run: str | None = None) -> dict:
        """Documents where the left setup was wrong and the right one was right."""
        left = find_run(config.runs_dir, left_model, left_mode, left_run)
        right = find_run(config.runs_dir, right_model, right_mode, right_run)
        if not left or not right:
            return {"doc_ids": []}
        ok = lambda e: {s["doc_id"]: s["all_correct"] for s in _read_jsonl(e["dir"] / "scores.jsonl")}  # noqa: E731
        lscores, rscores = ok(left), ok(right)
        return {"doc_ids": [d for d in lscores if not lscores[d] and rscores.get(d)]}

    @app.get("/")
    def home() -> FileResponse:
        return FileResponse(STATIC / "index.html")

    app.mount("/static", StaticFiles(directory=STATIC), name="static")
    return app
