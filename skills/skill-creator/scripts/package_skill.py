#!/usr/bin/env python3
"""
Skill Packager - Creates a distributable .skill file of a skill folder

Usage:
    python utils/package_skill.py <path/to/skill-folder> [output-directory] [--version X.Y.Z]

Example:
    python utils/package_skill.py skills/public/my-skill
    python utils/package_skill.py skills/public/my-skill ./dist
"""

import argparse
import json
import re
import sys
import time
import zipfile
from pathlib import Path
from typing import Optional

from quick_validate import validate_skill
SEMVER_PATTERN = re.compile(r"^\d+\.\d+\.\d+$")


def _is_within(path: Path, root: Path) -> bool:
    try:
        path.relative_to(root)
        return True
    except ValueError:
        return False


def _ensure_meta(skill_path: Path, skill_name: str, version_override: Optional[str]):
    meta_path = skill_path / "_meta.json"
    created_or_updated = False

    if meta_path.exists():
        try:
            meta = json.loads(meta_path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError) as e:
            print(f"[ERROR] Invalid _meta.json: {e}")
            return None
        if not isinstance(meta, dict):
            print("[ERROR] _meta.json must contain a JSON object")
            return None
    else:
        meta = {"slug": skill_name, "version": "1.0.0", "publishedAt": int(time.time() * 1000)}
        created_or_updated = True

    if not isinstance(meta.get("slug"), str) or not meta.get("slug"):
        meta["slug"] = skill_name
        created_or_updated = True

    current_version = meta.get("version")
    if version_override is not None:
        meta["version"] = version_override
        meta["publishedAt"] = int(time.time() * 1000)
        created_or_updated = True
    elif not isinstance(current_version, str) or not SEMVER_PATTERN.match(current_version):
        meta["version"] = "1.0.0"
        if not isinstance(meta.get("publishedAt"), int):
            meta["publishedAt"] = int(time.time() * 1000)
        created_or_updated = True

    if not isinstance(meta.get("publishedAt"), int) or meta.get("publishedAt", 0) <= 0:
        meta["publishedAt"] = int(time.time() * 1000)
        created_or_updated = True

    if created_or_updated:
        meta_path.write_text(json.dumps(meta, ensure_ascii=True, indent=2) + "\n", encoding="utf-8")
        print(f"[OK] Wrote _meta.json (version={meta['version']})")

    return meta_path


def package_skill(skill_path, output_dir=None, version_override=None):
    """
    Package a skill folder into a .skill file.

    Args:
        skill_path: Path to the skill folder
        output_dir: Optional output directory for the .skill file (defaults to current directory)

    Returns:
        Path to the created .skill file, or None if error
    """
    skill_path = Path(skill_path).resolve()

    # Validate skill folder exists
    if not skill_path.exists():
        print(f"[ERROR] Skill folder not found: {skill_path}")
        return None

    if not skill_path.is_dir():
        print(f"[ERROR] Path is not a directory: {skill_path}")
        return None

    # Validate SKILL.md exists
    skill_md = skill_path / "SKILL.md"
    if not skill_md.exists():
        print(f"[ERROR] SKILL.md not found in {skill_path}")
        return None

    # Run validation before packaging
    print("Validating skill...")
    valid, message = validate_skill(skill_path)
    if not valid:
        print(f"[ERROR] Validation failed: {message}")
        print("   Please fix the validation errors before packaging.")
        return None
    print(f"[OK] {message}\n")

    # Determine output location
    skill_name = skill_path.name

    if version_override and not SEMVER_PATTERN.match(version_override):
        print(f"[ERROR] Invalid version '{version_override}'. Use semantic version X.Y.Z")
        return None

    # Ensure _meta.json exists before validation.
    meta_result = _ensure_meta(skill_path, skill_name, version_override)
    if meta_result is None:
        return None

    if output_dir:
        output_path = Path(output_dir).resolve()
        output_path.mkdir(parents=True, exist_ok=True)
    else:
        output_path = Path.cwd()

    skill_filename = output_path / f"{skill_name}.skill"

    EXCLUDED_DIRS = {".git", ".svn", ".hg", "__pycache__", "node_modules"}

    # Create the .skill file (zip format)
    try:
        with zipfile.ZipFile(skill_filename, "w", zipfile.ZIP_DEFLATED) as zipf:
            # Walk through the skill directory
            for file_path in skill_path.rglob("*"):
                # Security: never follow or package symlinks.
                if file_path.is_symlink():
                    print(f"[WARN] Skipping symlink: {file_path}")
                    continue

                rel_parts = file_path.relative_to(skill_path).parts
                if any(part in EXCLUDED_DIRS for part in rel_parts):
                    continue

                if file_path.is_file():
                    resolved_file = file_path.resolve()
                    if not _is_within(resolved_file, skill_path):
                        print(f"[ERROR] File escapes skill root: {file_path}")
                        return None
                    # If output lives under skill_path, avoid writing archive into itself.
                    if resolved_file == skill_filename.resolve():
                        print(f"[WARN] Skipping output archive: {file_path}")
                        continue

                    # Calculate the relative path within the zip.
                    arcname = Path(skill_name) / file_path.relative_to(skill_path)
                    zipf.write(file_path, arcname)
                    print(f"  Added: {arcname}")

        print(f"\n[OK] Successfully packaged skill to: {skill_filename}")
        return skill_filename

    except Exception as e:
        print(f"[ERROR] Error creating .skill file: {e}")
        return None


def main():
    parser = argparse.ArgumentParser(
        description="Package a skill directory into a .skill archive.",
    )
    parser.add_argument("skill_path", help="Path to the skill folder")
    parser.add_argument("output_dir", nargs="?", default=None, help="Optional output directory")
    parser.add_argument(
        "--version",
        default=None,
        help="Optional semantic version X.Y.Z to write into _meta.json",
    )
    args = parser.parse_args()

    skill_path = args.skill_path
    output_dir = args.output_dir

    print(f"Packaging skill: {skill_path}")
    if output_dir:
        print(f"   Output directory: {output_dir}")
    if args.version:
        print(f"   Set version: {args.version}")
    print()

    result = package_skill(skill_path, output_dir, args.version)

    if result:
        sys.exit(0)
    else:
        sys.exit(1)


if __name__ == "__main__":
    main()
