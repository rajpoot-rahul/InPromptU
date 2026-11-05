from __future__ import annotations

import json
from pathlib import Path

import pytest

from taskharness.generate import generate_dataset, load_dataset
from taskharness.llm import LLMResponse
from taskharness.template import load_template

ROOT = Path(__file__).resolve().parent.parent


@pytest.fixture(scope="session")
def template() -> dict:
    return load_template(ROOT / "templates" / "invoice_extraction" / "v1.json")


@pytest.fixture(scope="session")
def dataset(tmp_path_factory) -> list[dict]:
    out = tmp_path_factory.mktemp("data")
    generate_dataset(out, count=30, seed=7)
    return load_dataset(out)


class FakeLLM:
    """Returns scripted outputs in order and records every call."""

    def __init__(self, outputs: list[object], model: str = "fake-model"):
        self.outputs = list(outputs)
        self.model = model
        self.calls: list[dict] = []

    def complete(self, messages: list[dict], json_mode: bool) -> LLMResponse:
        self.calls.append({"messages": messages, "json_mode": json_mode})
        out = self.outputs.pop(0)
        if isinstance(out, Exception):
            raise out
        text = out if isinstance(out, str) else json.dumps(out)
        return LLMResponse(text=text, latency_ms=10.0, prompt_tokens=100, completion_tokens=50)


@pytest.fixture
def fake_llm():
    return FakeLLM
