from types import SimpleNamespace

import pytest

from taskharness.llm import AnthropicClient, FatalLLMError, infer_provider


class FakeMessages:
    def __init__(self, error=None):
        self.kwargs = None
        self.error = error

    def create(self, **kwargs):
        self.kwargs = kwargs
        if self.error:
            raise self.error
        return SimpleNamespace(
            content=[SimpleNamespace(type="thinking", thinking="..."), SimpleNamespace(type="text", text='{"a": 1}')],
            usage=SimpleNamespace(input_tokens=120, output_tokens=30),
        )


def make_client(error=None) -> tuple[AnthropicClient, FakeMessages]:
    import anthropic

    client = AnthropicClient.__new__(AnthropicClient)
    client._anthropic = anthropic
    client.model = "claude-test"
    client.max_tokens = 4096
    messages = FakeMessages(error)
    client.client = SimpleNamespace(messages=messages)
    return client, messages


def test_infer_provider():
    assert infer_provider("claude-opus-5-5") == "anthropic"
    assert infer_provider("Claude-x") == "anthropic"
    assert infer_provider("gpt-4o-mini") == "openai"


def test_anthropic_client_moves_system_prompt_and_reads_text_blocks():
    client, fake = make_client()
    response = client.complete(
        [{"role": "system", "content": "RULES"}, {"role": "user", "content": "DOC"}], json_mode=True)
    assert fake.kwargs["system"] == "RULES"
    assert fake.kwargs["messages"] == [{"role": "user", "content": "DOC"}]
    assert fake.kwargs["model"] == "claude-test" and fake.kwargs["max_tokens"] == 4096
    assert "temperature" not in fake.kwargs
    assert response.text == '{"a": 1}'
    assert (response.prompt_tokens, response.completion_tokens) == (120, 30)


def test_anthropic_client_keeps_retry_conversation_order():
    client, fake = make_client()
    turns = [{"role": "system", "content": "S"}, {"role": "user", "content": "U1"},
             {"role": "assistant", "content": "A1"}, {"role": "user", "content": "U2"}]
    client.complete(turns, json_mode=True)
    assert [m["role"] for m in fake.kwargs["messages"]] == ["user", "assistant", "user"]


def test_anthropic_auth_error_is_fatal():
    import anthropic

    error = anthropic.AuthenticationError.__new__(anthropic.AuthenticationError)
    Exception.__init__(error, "bad key")
    error.message = "bad key"
    client, _ = make_client(error)
    with pytest.raises(FatalLLMError):
        client.complete([{"role": "user", "content": "x"}], json_mode=False)
