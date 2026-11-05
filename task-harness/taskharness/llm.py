"""LLM client interface and the OpenAI implementation."""

from __future__ import annotations

import time
from dataclasses import dataclass
from typing import Protocol


@dataclass
class LLMResponse:
    text: str
    latency_ms: float
    prompt_tokens: int | None = None
    completion_tokens: int | None = None


class LLMClient(Protocol):
    model: str

    def complete(self, messages: list[dict], json_mode: bool) -> LLMResponse: ...


class FatalLLMError(RuntimeError):
    """An error that will affect every document (bad key, unknown model), so the run should stop."""


class OpenAIClient:
    provider = "openai"

    def __init__(self, model: str, temperature: float | None = 0.0, timeout: float = 60.0):
        import openai

        self._openai = openai
        self.client = openai.OpenAI(timeout=timeout)
        self.model = model
        self.temperature = temperature

    def complete(self, messages: list[dict], json_mode: bool) -> LLMResponse:
        kwargs: dict = {"model": self.model, "messages": messages}
        if self.temperature is not None:
            kwargs["temperature"] = self.temperature
        if json_mode:
            kwargs["response_format"] = {"type": "json_object"}
        start = time.perf_counter()
        try:
            response = self.client.chat.completions.create(**kwargs)
        except self._openai.BadRequestError as error:
            # Some models only accept their default temperature; retry once without it.
            if self.temperature is not None and "temperature" in str(error).lower():
                self.temperature = None
                return self.complete(messages, json_mode)
            raise
        except (self._openai.AuthenticationError, self._openai.PermissionDeniedError, self._openai.NotFoundError) as error:
            raise FatalLLMError(str(error)) from error
        latency_ms = (time.perf_counter() - start) * 1000
        usage = getattr(response, "usage", None)
        return LLMResponse(
            text=response.choices[0].message.content or "",
            latency_ms=latency_ms,
            prompt_tokens=getattr(usage, "prompt_tokens", None),
            completion_tokens=getattr(usage, "completion_tokens", None),
        )


class AnthropicClient:
    """Claude via the Anthropic API. Claude has no schema-free JSON mode, so
    json_mode is ignored and JSON is requested by the prompt alone."""

    provider = "anthropic"

    def __init__(self, model: str, max_tokens: int = 16000, timeout: float = 300.0):
        import anthropic

        self._anthropic = anthropic
        self.client = anthropic.Anthropic(timeout=timeout)
        self.model = model
        self.max_tokens = max_tokens

    @staticmethod
    def split_system(messages: list[dict]) -> tuple[str | None, list[dict]]:
        system = "\n\n".join(m["content"] for m in messages if m["role"] == "system") or None
        return system, [m for m in messages if m["role"] != "system"]

    def complete(self, messages: list[dict], json_mode: bool) -> LLMResponse:
        system, chat = self.split_system(messages)
        kwargs: dict = {"model": self.model, "max_tokens": self.max_tokens, "messages": chat}
        if system:
            kwargs["system"] = system
        start = time.perf_counter()
        try:
            response = self.client.messages.create(**kwargs)
        except (self._anthropic.AuthenticationError, self._anthropic.PermissionDeniedError,
                self._anthropic.NotFoundError) as error:
            raise FatalLLMError(str(error)) from error
        latency_ms = (time.perf_counter() - start) * 1000
        text = "".join(getattr(block, "text", "") for block in response.content if block.type == "text")
        usage = getattr(response, "usage", None)
        return LLMResponse(
            text=text,
            latency_ms=latency_ms,
            prompt_tokens=getattr(usage, "input_tokens", None),
            completion_tokens=getattr(usage, "output_tokens", None),
        )


PROVIDERS = {
    "openai": ("OPENAI_API_KEY", OpenAIClient),
    "anthropic": ("ANTHROPIC_API_KEY", AnthropicClient),
}


class BedrockClient(AnthropicClient):
    """Claude via Amazon Bedrock. Authenticates with an AWS profile (e.g. SSO) or,
    if set, the AWS_BEARER_TOKEN_BEDROCK API key."""

    provider = "bedrock"

    def __init__(self, model: str, aws_profile: str | None = None, aws_region: str | None = None,
                 max_tokens: int = 16000, timeout: float = 300.0):
        import os

        import anthropic

        self._anthropic = anthropic
        use_token = bool(os.environ.get("AWS_BEARER_TOKEN_BEDROCK"))
        self.client = anthropic.AnthropicBedrock(
            aws_profile=None if use_token else aws_profile, aws_region=aws_region, timeout=timeout)
        self.model = model
        self.max_tokens = max_tokens


def infer_provider(model: str) -> str:
    lowered = model.lower()
    if "anthropic." in lowered or lowered.startswith("arn:aws:bedrock"):
        return "bedrock"
    return "anthropic" if lowered.startswith("claude") else "openai"


def list_models(provider: str, aws_profile: str | None = None, aws_region: str | None = None) -> list[str]:
    if provider == "bedrock":
        import boto3

        bedrock = boto3.Session(profile_name=aws_profile, region_name=aws_region).client("bedrock")
        profiles = bedrock.list_inference_profiles(maxResults=1000)["inferenceProfileSummaries"]
        ids = [p["inferenceProfileId"] for p in profiles if "anthropic" in p["inferenceProfileId"]]
        models = bedrock.list_foundation_models(byProvider="Anthropic")["modelSummaries"]
        ids += [m["modelId"] for m in models]
        return sorted(set(ids))
    if provider == "anthropic":
        import anthropic

        return [m.id for m in anthropic.Anthropic().models.list(limit=100)]
    import openai

    return sorted(m.id for m in openai.OpenAI().models.list())
