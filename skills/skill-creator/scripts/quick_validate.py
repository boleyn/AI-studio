#!/usr/bin/env python3
"""
Quick validation script for skills - minimal version
"""

import json
import re
import sys
from pathlib import Path
from typing import Optional

try:
    import yaml
except ModuleNotFoundError:
    yaml = None

MAX_SKILL_NAME_LENGTH = 64
SEMVER_PATTERN = re.compile(r"^\d+\.\d+\.\d+$")


def _extract_frontmatter(content: str) -> Optional[str]:
    lines = content.splitlines()
    if not lines or lines[0].strip() != "---":
        return None
    for i in range(1, len(lines)):
        if lines[i].strip() == "---":
            return "\n".join(lines[1:i])
    return None


def _parse_simple_frontmatter(frontmatter_text: str) -> Optional[dict[str, str]]:
    parsed: dict[str, str] = {}
    current_key: Optional[str] = None
    for raw_line in frontmatter_text.splitlines():
        stripped = raw_line.strip()
        if not stripped or stripped.startswith("#"):
            continue

        is_indented = raw_line[:1].isspace()
        if is_indented:
            if current_key is None:
                return None
            current_value = parsed[current_key]
            parsed[current_key] = (
                f"{current_value}\n{stripped}" if current_value else stripped
            )
            continue

        if ":" not in stripped:
            return None
        key, value = stripped.split(":", 1)
        key = key.strip()
        value = value.strip()
        if not key:
            return None
        if (value.startswith('"') and value.endswith('"')) or (
            value.startswith("'") and value.endswith("'")
        ):
            value = value[1:-1]
        parsed[key] = value
        current_key = key
    return parsed


def _validate_meta(skill_path, expected_slug):
    meta_path = skill_path / "_meta.json"
    if not meta_path.exists():
        return False, "_meta.json not found"

    try:
        meta = json.loads(meta_path.read_text(encoding="utf-8"))
    except OSError as e:
        return False, f"Could not read _meta.json: {e}"
    except json.JSONDecodeError as e:
        return False, f"Invalid JSON in _meta.json: {e}"

    if not isinstance(meta, dict):
        return False, "_meta.json must contain a JSON object"

    required = {"slug", "version", "publishedAt"}
    missing = sorted(required - set(meta.keys()))
    if missing:
        return False, f"_meta.json missing required key(s): {', '.join(missing)}"

    slug = meta.get("slug")
    if not isinstance(slug, str) or not slug.strip():
        return False, "_meta.json slug must be a non-empty string"
    if slug != expected_slug:
        return False, f"_meta.json slug '{slug}' does not match skill name '{expected_slug}'"

    version = meta.get("version")
    if not isinstance(version, str) or not SEMVER_PATTERN.match(version):
        return False, "_meta.json version must be semantic version X.Y.Z"

    published_at = meta.get("publishedAt")
    if not isinstance(published_at, int) or published_at <= 0:
        return False, "_meta.json publishedAt must be a positive integer timestamp in milliseconds"

    return True, "ok"


def validate_skill(skill_path):
    """Basic validation of a skill"""
    skill_path = Path(skill_path)

    skill_md = skill_path / "SKILL.md"
    if not skill_md.exists():
        return False, "SKILL.md not found"

    content = skill_md.read_text()
    frontmatter_text = _extract_frontmatter(content)
    if frontmatter_text is None:
        return False, "Invalid frontmatter format"
    if yaml is not None:
        try:
            frontmatter = yaml.safe_load(frontmatter_text)
            if not isinstance(frontmatter, dict):
                return False, "Frontmatter must be a YAML dictionary"
        except yaml.YAMLError as e:
            return False, f"Invalid YAML in frontmatter: {e}"
    else:
        frontmatter = _parse_simple_frontmatter(frontmatter_text)
        if frontmatter is None:
            return (
                False,
                "Invalid YAML in frontmatter: unsupported syntax without PyYAML installed",
            )

    allowed_properties = {"name", "description", "license", "allowed-tools", "metadata"}

    unexpected_keys = set(frontmatter.keys()) - allowed_properties
    if unexpected_keys:
        allowed = ", ".join(sorted(allowed_properties))
        unexpected = ", ".join(sorted(unexpected_keys))
        return (
            False,
            f"Unexpected key(s) in SKILL.md frontmatter: {unexpected}. Allowed properties are: {allowed}",
        )

    if "name" not in frontmatter:
        return False, "Missing 'name' in frontmatter"
    if "description" not in frontmatter:
        return False, "Missing 'description' in frontmatter"

    name = frontmatter.get("name", "")
    if not isinstance(name, str):
        return False, f"Name must be a string, got {type(name).__name__}"
    name = name.strip()
    if name:
        if not re.match(r"^[a-z0-9-]+$", name):
            return (
                False,
                f"Name '{name}' should be hyphen-case (lowercase letters, digits, and hyphens only)",
            )
        if name.startswith("-") or name.endswith("-") or "--" in name:
            return (
                False,
                f"Name '{name}' cannot start/end with hyphen or contain consecutive hyphens",
            )
        if len(name) > MAX_SKILL_NAME_LENGTH:
            return (
                False,
                f"Name is too long ({len(name)} characters). "
                f"Maximum is {MAX_SKILL_NAME_LENGTH} characters.",
            )

    description = frontmatter.get("description", "")
    if not isinstance(description, str):
        return False, f"Description must be a string, got {type(description).__name__}"
    description = description.strip()
    if description:
        if "<" in description or ">" in description:
            return False, "Description cannot contain angle brackets (< or >)"
        if len(description) > 1024:
            return (
                False,
                f"Description is too long ({len(description)} characters). Maximum is 1024 characters.",
            )

    meta_ok, meta_message = _validate_meta(skill_path, name)
    if not meta_ok:
        return False, meta_message

    return True, "Skill is valid!"


if __name__ == "__main__":
    if len(sys.argv) != 2:
        print("Usage: python quick_validate.py <skill_directory>")
        sys.exit(1)

    valid, message = validate_skill(sys.argv[1])
    print(message)
    sys.exit(0 if valid else 1)
