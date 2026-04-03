"""Extract readable plain text from a DOCX or unpacked DOCX directory.

This script is designed for analysis/summarization workflows where downstream
tools (such as read_file) need a plain text file.
"""

from __future__ import annotations

import argparse
import sys
import zipfile
from pathlib import Path
from xml.etree import ElementTree as ET

W_NS = "http://schemas.openxmlformats.org/wordprocessingml/2006/main"
NS = {"w": W_NS}


def _text_of_elem(elem: ET.Element | None) -> str:
    if elem is None:
        return ""
    parts: list[str] = []
    for node in elem.iter(f"{{{W_NS}}}t"):
        if node.text:
            parts.append(node.text)
    return "".join(parts).strip()


def _is_footnote_marker(run: ET.Element) -> bool:
    rpr = run.find("w:rPr", NS)
    if rpr is None:
        return False
    vert = rpr.find("w:vertAlign", NS)
    if vert is None or vert.get(f"{{{W_NS}}}val") != "superscript":
        return False
    txt = _text_of_elem(run)
    return bool(txt) and txt.isdigit()


def _paragraph_text(paragraph: ET.Element) -> str:
    parts: list[str] = []
    for run in paragraph.findall("w:r", NS):
        if _is_footnote_marker(run):
            continue
        txt = _text_of_elem(run)
        if txt:
            parts.append(txt)
    return "".join(parts).strip()


def _table_lines(table: ET.Element) -> list[str]:
    lines: list[str] = []
    for row in table.findall("w:tr", NS):
        cells: list[str] = []
        for cell in row.findall("w:tc", NS):
            para_texts: list[str] = []
            for para in cell.findall("w:p", NS):
                text = _paragraph_text(para)
                if text:
                    para_texts.append(text)
            cell_text = " ".join(para_texts).strip()
            cells.append(cell_text)
        if any(cells):
            lines.append(" | ".join(cells).strip())
    return lines


def _extract_lines(root: ET.Element) -> list[str]:
    body = root.find("w:body", NS)
    if body is None:
        return []

    lines: list[str] = []
    for child in list(body):
        tag = child.tag
        if tag == f"{{{W_NS}}}p":
            text = _paragraph_text(child)
            if text:
                lines.append(text)
            continue
        if tag == f"{{{W_NS}}}tbl":
            lines.extend(_table_lines(child))
    return lines


def _root_from_docx(docx_path: Path) -> ET.Element:
    with zipfile.ZipFile(docx_path, "r") as zf:
        with zf.open("word/document.xml") as f:
            return ET.parse(f).getroot()


def _root_from_unpacked(unpacked: Path) -> ET.Element:
    xml_path = unpacked / "word" / "document.xml"
    if not xml_path.exists():
        raise FileNotFoundError(f"Missing file: {xml_path}")
    return ET.parse(xml_path).getroot()


def _default_output(input_docx: Path | None, unpacked: Path | None) -> Path:
    if input_docx is not None:
        return input_docx.parent / "derived" / f"{input_docx.stem}.txt"

    assert unpacked is not None
    name = unpacked.name if unpacked.name else "document"
    return unpacked.parent / "derived" / f"{name}.txt"


def _workspace_relative(path: Path) -> str | None:
    """Return a workspace-relative path (e.g. .files/derived/x.txt) when possible."""
    try:
        rel = path.resolve().relative_to(Path.cwd().resolve())
    except Exception:
        return None
    return rel.as_posix()


def main() -> int:
    parser = argparse.ArgumentParser(description="Extract plain text from DOCX")
    parser.add_argument("--input-docx", help="Path to .docx file")
    parser.add_argument("--from-unpacked", help="Path to unpacked DOCX directory")
    parser.add_argument(
        "--output",
        help="Output text file path. If omitted, writes to a sibling derived/ directory.",
    )
    args = parser.parse_args()

    if not args.input_docx and not args.from_unpacked:
        print("Error: provide --input-docx or --from-unpacked")
        return 1
    if args.input_docx and args.from_unpacked:
        print("Error: use only one of --input-docx or --from-unpacked")
        return 1

    input_docx = Path(args.input_docx).resolve() if args.input_docx else None
    unpacked = Path(args.from_unpacked).resolve() if args.from_unpacked else None

    try:
        if input_docx is not None:
            root = _root_from_docx(input_docx)
        else:
            root = _root_from_unpacked(unpacked)
    except Exception as exc:
        print(f"Error: failed to load document: {exc}")
        return 1

    lines = _extract_lines(root)
    output_path = Path(args.output).resolve() if args.output else _default_output(input_docx, unpacked)
    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text("\n".join(lines) + "\n", encoding="utf-8")

    rel_path = _workspace_relative(output_path)
    print(f"Extracted text lines: {len(lines)}")
    print(f"Output: {output_path}")
    if rel_path:
        print(f"READ_FILE_PATH_REL: {rel_path}")
        print(f"READ_FILE_PATH_ABS: {output_path}")
        # Backward-compatible key for downstream tools: prefer relative path when available.
        print(f"READ_FILE_PATH: {rel_path}")
    else:
        print(f"READ_FILE_PATH_ABS: {output_path}")
        print(f"READ_FILE_PATH: {output_path}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
