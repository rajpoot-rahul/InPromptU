"""Deterministic text cleaning and sectioning before any LLM call."""

from __future__ import annotations

import re
import unicodedata


class DocumentTooLarge(ValueError):
    """Raised instead of silently truncating a document."""


def clean(text: str) -> str:
    text = unicodedata.normalize("NFKC", text).replace("\r\n", "\n").replace("\r", "\n")
    text = "".join(ch for ch in text if ch in "\n\t" or unicodedata.category(ch)[0] != "C")
    text = text.expandtabs(4)
    text = "\n".join(line.rstrip() for line in text.split("\n"))
    text = re.sub(r"\n{3,}", "\n\n", text)
    return text.strip() + "\n"


def split_sections(text: str, max_chars: int) -> list[str]:
    if len(text) > max_chars:
        raise DocumentTooLarge(f"Document has {len(text)} characters; limit is {max_chars}. Split it before extraction.")
    return [block.strip("\n") for block in re.split(r"\n\s*\n", text) if block.strip()]


def render_sections(sections: list[str]) -> str:
    return "\n\n".join(f"--- section {n} ---\n{body}" for n, body in enumerate(sections, 1))
