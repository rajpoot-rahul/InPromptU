"""Command line: generate data, run modes, compare results."""

from __future__ import annotations

import argparse
import json
import os
import sys
from datetime import datetime
from pathlib import Path

from .evaluate import format_table, score_result, summarize, write_csv
from .generate import generate_dataset, load_dataset
from .llm import PROVIDERS, BedrockClient, FatalLLMError, LLMClient, infer_provider, list_models

PROVIDER_CHOICES = sorted([*PROVIDERS, "bedrock"])
from .pipeline import MODES, run_document
from .preprocess import clean
from .template import load_template
from .validate import check_report

ROOT = Path(__file__).resolve().parent.parent
DEFAULT_DATA = ROOT / "data"
DEFAULT_TEMPLATE = ROOT / "templates" / "invoice_extraction" / "v1.json"
DEFAULT_RUNS = ROOT / "runs"


def run_mode(mode: str, dataset: list[dict], llm: LLMClient, template: dict, out_dir: Path) -> dict:
    out_dir.mkdir(parents=True, exist_ok=True)
    scores = []
    with (out_dir / "results.jsonl").open("w", encoding="utf-8") as results_file, \
         (out_dir / "scores.jsonl").open("w", encoding="utf-8") as scores_file:
        for n, item in enumerate(dataset, 1):
            result = run_document(item["doc_id"], item["text"], mode, llm, template)
            score = score_result(result, item["label"], item["text"], template)
            results_file.write(json.dumps(result, ensure_ascii=False) + "\n")
            scores_file.write(json.dumps(score, ensure_ascii=False) + "\n")
            results_file.flush()
            scores.append(score)
            mark = "OK " if score["all_correct"] else "BAD"
            print(f"  [{mode}] {n}/{len(dataset)} {item['doc_id']} {mark} status={result['status']}", flush=True)
    summary = summarize(scores)
    (out_dir / "summary.json").write_text(json.dumps(summary, indent=2) + "\n", encoding="utf-8")
    return summary


def cmd_generate(args: argparse.Namespace) -> int:
    ids = generate_dataset(Path(args.out), args.count, args.seed)
    print(f"Wrote {len(ids)} invoices and labels to {args.out}")
    return 0


def build_llm(args: argparse.Namespace) -> LLMClient | None:
    """Create the client from --model/--provider/--aws-*; print a reason and return None on failure."""
    model = args.model or os.environ.get("OPENAI_MODEL")
    if not model:
        print("Set --model (or the OPENAI_MODEL environment variable).", file=sys.stderr)
        return None
    provider = args.provider or infer_provider(model)
    if provider == "bedrock":
        try:
            return BedrockClient(model, aws_profile=args.aws_profile, aws_region=args.aws_region)
        except Exception as error:  # missing region, bad profile
            print(f"Could not set up Bedrock: {error}", file=sys.stderr)
            return None
    key_var, client_cls = PROVIDERS[provider]
    if not os.environ.get(key_var):
        print(f"Set the {key_var} environment variable for provider '{provider}'.", file=sys.stderr)
        return None
    return client_cls(model)


def cmd_extract(args: argparse.Namespace, llm: LLMClient | None = None) -> int:
    path = Path(args.file).expanduser()
    if not path.is_file():
        print(f"File not found: {path}", file=sys.stderr)
        return 2
    try:
        text = path.read_text(encoding="utf-8")
    except UnicodeDecodeError:
        print(f"{path.name} is not a UTF-8 text file. Save it as plain text (.txt) and try again.", file=sys.stderr)
        return 2
    llm = llm or build_llm(args)
    if llm is None:
        return 2
    template = load_template(Path(args.template))
    try:
        result = run_document(path.name, text, args.mode, llm, template)
    except FatalLLMError as error:
        print(f"Stopped: {error}", file=sys.stderr)
        return 1

    status = result["status"]
    if status == "passed" and len(result["attempts"]) > 1:
        status = "fixed on retry"
    print(f"File:   {path.name}")
    print(f"Model:  {llm.model}   Mode: {args.mode}   Attempts: {len(result['attempts'])}   "
          f"Time: {result['latency_ms'] / 1000:.1f} s")
    print(f"Result: {status.upper()}")
    if status == "api_error":
        print(f"Error:  {result['attempts'][-1].get('error')}")
    print("\nAI answer:")
    print(json.dumps(result["output"], indent=2, ensure_ascii=False) if result["output"] is not None else "  (none)")
    report = check_report(result["output"], clean(text), template)
    passed = sum(c["passed"] is True for c in report)
    skipped = sum(c["passed"] is None for c in report)
    print(f"\nChecks: {passed}/{len(report)} passed" + (f", {skipped} skipped (no value to check)" if skipped else "")
          + ("" if args.mode == "harness" else " (shown for information; this mode does not act on them)"))
    for check in report:
        mark = {True: "PASS", False: "FAIL", None: "SKIP"}[check["passed"]]
        print(f"  {mark}  {check['name']}")
        for detail in check["details"]:
            if check["passed"] is False:
                print(f"        - {detail}")
    return 0 if status in ("passed", "fixed on retry", "unchecked") else 3


def cmd_run(args: argparse.Namespace, llm: LLMClient | None = None) -> int:
    model = args.model or os.environ.get("OPENAI_MODEL")
    if llm is None:
        llm = build_llm(args)
        if llm is None:
            return 2
        provider = args.provider or infer_provider(model)
        if provider in ("anthropic", "bedrock") and args.mode in ("all", "json_mode"):
            print("Note: Claude has no schema-free JSON mode, so 'json_mode' behaves like 'plain'.")

    template = load_template(Path(args.template))
    dataset = load_dataset(Path(args.data))
    if not dataset:
        print(f"No invoices with labels found in {args.data}. Run 'generate' first.", file=sys.stderr)
        return 2
    fields = set(template["output_schema"].get("properties", {}))
    if any(set(item["label"]["expected"]) != fields for item in dataset):
        print(f"The test set in {args.data} has no correct answers for task '{template['task']}'. "
              "Use 'extract' or the web app for this task, or add a labelled test set for it.", file=sys.stderr)
        return 2
    if args.limit:
        dataset = dataset[: args.limit]

    modes = list(MODES) if args.mode == "all" else [args.mode]
    run_dir = Path(args.runs_dir) / datetime.now().strftime("%Y%m%d-%H%M%S")
    summaries = []
    try:
        for mode in modes:
            print(f"Running {mode} on {len(dataset)} documents with {llm.model}...")
            summaries.append(run_mode(mode, dataset, llm, template, run_dir / mode))
    except FatalLLMError as error:
        print(f"Stopped: {error}", file=sys.stderr)
        return 1

    table = format_table(summaries)
    (run_dir / "comparison.txt").write_text(table + "\n", encoding="utf-8")
    write_csv(summaries, run_dir / "comparison.csv")
    print("\n" + table)
    print(f"\nSaved logs, scores and comparison to {run_dir}")
    return 0


def cmd_compare(args: argparse.Namespace) -> int:
    summaries = []
    for path in args.runs:
        for summary_path in sorted(Path(path).glob("**/summary.json")):
            summaries.append(json.loads(summary_path.read_text(encoding="utf-8")))
    if not summaries:
        print("No summary.json files found.", file=sys.stderr)
        return 2
    print(format_table(summaries))
    return 0


def cmd_models(args: argparse.Namespace) -> int:
    if args.provider != "bedrock":
        key_var, _ = PROVIDERS[args.provider]
        if not os.environ.get(key_var):
            print(f"Set the {key_var} environment variable first.", file=sys.stderr)
            return 2
    try:
        names = list_models(args.provider, aws_profile=args.aws_profile, aws_region=args.aws_region)
    except Exception as error:  # surface auth/network problems plainly
        print(f"Could not list models: {error}", file=sys.stderr)
        return 1
    print("\n".join(names))
    return 0


def cmd_serve(args: argparse.Namespace) -> int:
    import uvicorn

    from .web.server import DEFAULT_LIVE_MODELS, AppConfig, create_app

    config = AppConfig(
        data_dir=Path(args.data), runs_dir=Path(args.runs_dir), templates_dir=Path(args.templates),
        live_models=args.live_model or list(DEFAULT_LIVE_MODELS),
        aws_profile=args.aws_profile, aws_region=args.aws_region,
        examples_dir=ROOT / "examples",
    )
    print(f"Open http://{args.host}:{args.port} in your browser. Press Ctrl+C to stop.")
    uvicorn.run(create_app(config), host=args.host, port=args.port, log_level="warning")
    return 0


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="taskharness", description=__doc__)
    sub = parser.add_subparsers(dest="command", required=True)

    gen = sub.add_parser("generate", help="Create synthetic invoices with known answers.")
    gen.add_argument("--out", default=str(DEFAULT_DATA))
    gen.add_argument("--count", type=int, default=30)
    gen.add_argument("--seed", type=int, default=7)

    run = sub.add_parser("run", help="Run one mode (or all) on the dataset and score it.")
    run.add_argument("--mode", choices=[*MODES, "all"], default="all")
    run.add_argument("--model", help="Model ID, e.g. from the 'models' command (or set OPENAI_MODEL).")
    run.add_argument("--provider", choices=PROVIDER_CHOICES,
                     help="Inferred from the model ID: 'anthropic.*' -> bedrock, 'claude*' -> anthropic, else openai.")
    run.add_argument("--aws-profile", help="AWS profile for Bedrock (e.g. an SSO profile).")
    run.add_argument("--aws-region", help="AWS region for Bedrock (defaults to the profile's region).")
    run.add_argument("--data", default=str(DEFAULT_DATA))
    run.add_argument("--template", default=str(DEFAULT_TEMPLATE))
    run.add_argument("--runs-dir", default=str(DEFAULT_RUNS))
    run.add_argument("--limit", type=int, default=0, help="Only use the first N documents.")

    cmp_ = sub.add_parser("compare", help="Print a table from existing run folders.")
    cmp_.add_argument("runs", nargs="+")

    ext = sub.add_parser("extract", help="Run the harness on one of your own text files.")
    ext.add_argument("file", help="Path to a plain-text file, e.g. ~/Desktop/invoice.txt")
    ext.add_argument("--mode", choices=MODES, default="harness")
    ext.add_argument("--model", help="Model ID (or set OPENAI_MODEL).")
    ext.add_argument("--provider", choices=PROVIDER_CHOICES)
    ext.add_argument("--aws-profile")
    ext.add_argument("--aws-region")
    ext.add_argument("--template", default=str(DEFAULT_TEMPLATE))

    models = sub.add_parser("models", help="List the exact model IDs your API key can use.")
    models.add_argument("--provider", choices=PROVIDER_CHOICES, default="anthropic")
    models.add_argument("--aws-profile")
    models.add_argument("--aws-region")

    serve = sub.add_parser("serve", help="Start the demo web app.")
    serve.add_argument("--host", default="127.0.0.1")
    serve.add_argument("--port", type=int, default=8000)
    serve.add_argument("--data", default=str(DEFAULT_DATA))
    serve.add_argument("--runs-dir", default=str(DEFAULT_RUNS))
    serve.add_argument("--templates", default=str(DEFAULT_TEMPLATE.parent.parent))
    serve.add_argument("--aws-profile", help="AWS profile for live Bedrock calls.")
    serve.add_argument("--aws-region")
    serve.add_argument("--live-model", action="append", help="Model ID allowed for live runs (repeatable).")
    return parser


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    if args.command == "generate":
        return cmd_generate(args)
    if args.command == "run":
        return cmd_run(args)
    if args.command == "models":
        return cmd_models(args)
    if args.command == "serve":
        return cmd_serve(args)
    if args.command == "extract":
        return cmd_extract(args)
    return cmd_compare(args)
