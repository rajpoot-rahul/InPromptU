"""Load versioned task templates and compile them into chat messages."""

from __future__ import annotations

import json
from pathlib import Path

REQUIRED_KEYS = {"task", "version", "role", "rules", "fields", "output_schema", "final_reminder"}


def load_template(path: Path) -> dict:
    template = json.loads(Path(path).read_text(encoding="utf-8"))
    missing = REQUIRED_KEYS - template.keys()
    if missing:
        raise ValueError(f"Template {path} is missing keys: {sorted(missing)}")
    return template


def template_id(template: dict) -> str:
    return f"{template['task']}@{template['version']}"


def compile_messages(template: dict, document: str) -> list[dict]:
    """Instructions go first (system) and the critical reminder goes last, after the document."""
    rules = "\n".join(f"- {rule}" for rule in template["rules"])
    fields = "\n".join(f"- {name}: {meaning}" for name, meaning in template["fields"].items())
    system = (
        f"{template['role']}\n\n"
        f"Rules:\n{rules}\n\n"
        f"Fields:\n{fields}\n\n"
        f"Output JSON schema:\n{json.dumps(template['output_schema'], indent=2)}"
    )
    user = f"Document:\n<document>\n{document}\n</document>\n\n{template['final_reminder']}"
    return [{"role": "system", "content": system}, {"role": "user", "content": user}]


def retry_message(issues: list[str]) -> dict:
    problems = "\n".join(f"- {issue}" for issue in issues)
    return {
        "role": "user",
        "content": (
            "Your JSON failed these automatic checks:\n"
            f"{problems}\n\n"
            "Re-read the document and fix only what is wrong. "
            "Return the complete corrected JSON object and nothing else."
        ),
    }
