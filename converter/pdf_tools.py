"""Stable PDF bases and flattened annotations. Coordinates always use PDF units."""
from __future__ import annotations

import hashlib
import io
import json
import math
from functools import lru_cache
from pathlib import Path

import pikepdf
from reportlab.pdfgen import canvas
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont

MAX_EXPORT_BYTES = 80 * 1024 * 1024
FONT_ROOT = Path(__file__).parent / "fonts"


def _error(message):
    from .conversion import ConversionError
    raise ConversionError(message)


@lru_cache(maxsize=1)
def fonts():
    result = []
    for name, filename in [("StudyMono", "DejaVuSansMono.ttf"), ("StudySans", "DejaVuSans.ttf"), ("StudyCJK", "NotoSansSC-Regular.ttf")]:
        path = FONT_ROOT / filename
        if path.is_file():
            font = TTFont(name, str(path))
            pdfmetrics.registerFont(font)
            result.append((name, set(font.face.charToGlyph)))
    if not result:
        _error("The bundled document fonts are missing. Run converter setup.")
    return result


@lru_cache(maxsize=8192)
def font_for(character: str, mono: bool = False):
    choices = fonts() if mono else sorted(fonts(), key=lambda item: item[0] == "StudyMono")
    for name, characters in choices:
        if ord(character) in characters:
            return name
    if character.isspace():
        return choices[0][0]
    _error(f"The document font cannot display U+{ord(character):04X}. Use a supported text character and retry.")


def text_runs(text: str, mono=False):
    runs = []
    for character in text:
        name = font_for(character, mono)
        if runs and runs[-1][0] == name:
            runs[-1] = (name, runs[-1][1] + character)
        else:
            runs.append((name, character))
    return runs


def draw_text(c, text, x, y, size=9, mono=False):
    for name, run in text_runs(text, mono):
        c.setFont(name, size)
        c.drawString(x, y, run)
        x += pdfmetrics.stringWidth(run, name, size)


def wrap_lines(text: str, width: float, size=9, mono=False):
    for original in text.replace("\r\n", "\n").replace("\r", "\n").expandtabs(4).split("\n"):
        line, current = "", 0.0
        for character in original:
            advance = pdfmetrics.stringWidth(character, font_for(character, mono), size)
            if line and current + advance > width:
                yield line
                line, current = "", 0.0
            line += character
            current += advance
        yield line


def text_pdf(text: str, destination: Path):
    from .conversion import MAX_PAGES
    width, height, margin, leading = 595.276, 841.89, 42, 13
    c = canvas.Canvas(str(destination), pagesize=(width, height), pageCompression=1)
    y, pages = height - margin, 1
    for line in wrap_lines(text, width - 2 * margin, mono=True):
        if y < margin:
            c.showPage(); pages += 1; y = height - margin
            if pages > MAX_PAGES:
                _error("The original text preview exceeds 100 pages. Split the file into smaller documents.")
        draw_text(c, line, margin, y, mono=True)
        y -= leading
    c.save()


def describe_pdf(path: Path, kind: str):
    from .conversion import inspect_pdf, MAX_PREVIEW_BYTES
    inspect_pdf(path)
    if path.stat().st_size > MAX_PREVIEW_BYTES:
        _error("The annotation PDF exceeds the 40 MiB preview limit.")
    pages = []
    with pikepdf.open(path) as pdf:
        for page in pdf.pages:
            parent = page.obj
            rotation = 0
            while parent:
                if "/Rotate" in parent:
                    rotation = int(parent["/Rotate"]) % 360
                    break
                parent = parent.get("/Parent")
            pages.append({"mediaBox": list(map(float, page.mediabox)), "cropBox": list(map(float, page.cropbox)), "rotation": rotation, "userUnit": float(page.obj.get("/UserUnit", 1))})
    return {"sha256": hashlib.sha256(path.read_bytes()).hexdigest(), "size": path.stat().st_size, "kind": kind, "pages": pages}


def _validate_annotations(items, geometry):
    if not isinstance(items, list) or not 0 < len(items) <= 1000 or sum(len(json.dumps(item.get("data",item),ensure_ascii=False,separators=(",",":")).encode()) for item in items) > 2 * 1024 * 1024:
        _error("Choose between one and 1,000 saved annotations within the 2 MiB limit.")
    for item in items:
        data = item.get("data", item)
        if not isinstance(data, dict) or len(json.dumps(data,ensure_ascii=False,separators=(",",":")).encode()) > 32 * 1024:
            _error("An annotation exceeds the supported size.")
        page = data.get("page")
        if not isinstance(page, int) or not 1 <= page <= len(geometry):
            _error("An annotation references an unavailable page.")
        import re
        if data.get("type") not in {"highlight", "underline", "ink", "comment"} or not re.fullmatch(r"#[a-fA-F0-9]{6}", data.get("color", "")):
            _error("An annotation has an unsupported type or color.")
        coordinates = []
        if data["type"] in {"highlight", "underline"}:
            quads = data.get("quads")
            if not isinstance(quads, list) or not 0 < len(quads) <= 200 or any(len(q) != 8 for q in quads):
                _error("An annotation contains invalid text regions.")
            coordinates = [p for q in quads for p in zip(q[::2], q[1::2])]
        elif data["type"] == "ink":
            coordinates = data.get("points", [])
            if not 2 <= len(coordinates) <= 1500:
                _error("A drawing contains an invalid number of points.")
        else:
            coordinates = [data.get("anchor", [])]
            if not isinstance(data.get("text"), str) or not data["text"].strip() or len(data["text"]) > 4000:
                _error("A comment must contain between one and 4,000 characters.")
        left, bottom, right, top = geometry[page - 1]["cropBox"]
        for point in coordinates:
            if len(point) != 2 or any(not isinstance(n, (int, float)) or not math.isfinite(n) for n in point):
                _error("An annotation contains invalid coordinates.")
            x, y = point
            if not left - 1 <= x <= right + 1 or not bottom - 1 <= y <= top + 1:
                _error("An annotation lies outside its document page.")
        width = data.get("width", 1)
        if not isinstance(width, (int, float)) or not math.isfinite(width) or not .25 <= width <= 20:
            _error("An annotation has an invalid stroke width.")


def export_annotated(source: Path, destination: Path, annotations: list):
    geometry = describe_pdf(source, "pdf")["pages"]
    _validate_annotations(annotations, geometry)
    items = sorted(annotations, key=lambda item: (item.get("data", item)["page"], item.get("id", "")))
    comments = [item for item in items if item.get("data", item)["type"] == "comment"]
    numbers = {id(item): index + 1 for index, item in enumerate(comments)}
    with pikepdf.open(source) as pdf:
        for page_index, page in enumerate(pdf.pages):
            page_items = [item for item in items if item.get("data", item)["page"] == page_index + 1]
            if not page_items:
                continue
            left, bottom, right, top = geometry[page_index]["mediaBox"]
            stream = io.BytesIO()
            c = canvas.Canvas(stream, pagesize=(right - left, top - bottom), pageCompression=1)
            c.translate(-left, -bottom)
            for item in page_items:
                data = item.get("data", item)
                color = tuple(int(data["color"][i:i + 2], 16) / 255 for i in (1, 3, 5))
                c.saveState(); c.setStrokeColorRGB(*color); c.setFillColorRGB(*color); c.setLineCap(1); c.setLineJoin(1); c.setLineWidth(data.get("width", 1.5))
                if data["type"] in {"highlight", "underline"}:
                    for quad in data["quads"]:
                        if data["type"] == "underline":
                            c.line(quad[4], quad[5], quad[6], quad[7])
                        else:
                            c.setFillAlpha(.28)
                            path = c.beginPath(); path.moveTo(quad[0], quad[1])
                            for i in (2, 4, 6): path.lineTo(quad[i], quad[i + 1])
                            path.close(); c.drawPath(path, fill=1, stroke=0)
                elif data["type"] == "ink":
                    path = c.beginPath(); path.moveTo(*data["points"][0])
                    for point in data["points"][1:]: path.lineTo(*point)
                    c.drawPath(path)
                else:
                    x, y = data["anchor"]; c.circle(x, y, 7, fill=1, stroke=0)
                    c.setFillColorRGB(1, 1, 1); c.setFont("Helvetica", 8); c.drawCentredString(x, y - 3, str(numbers[id(item)]))
                c.restoreState()
            c.showPage(); c.save(); stream.seek(0)
            with pikepdf.open(stream) as overlay:
                # add_overlay's placement helper compensates for target rotation.
                # Our coordinates already use the target's unrotated PDF space,
                # so compose the form directly and let /Rotate apply once.
                form = pdf.copy_foreign(overlay.pages[0].as_form_xobject())
                name = page.add_resource(form, pikepdf.Name.XObject, prefix="SSMarks")
                page.contents_add(b"q", prepend=True)
                page.contents_add(f"Q q 1 0 0 1 {left} {bottom} cm {name} Do Q".encode("ascii"))
        if comments:
            stream = io.BytesIO(); c = canvas.Canvas(stream, pagesize=(595.276, 841.89), pageCompression=1)
            y = 795
            draw_text(c, "Annotation notes", 42, y, 16); y -= 30
            for item in comments:
                data = item.get("data", item)
                lines = list(wrap_lines(f'{numbers[id(item)]}. Page {data["page"]}: {data["text"]}', 510, size=10))
                for line in lines:
                    if y < 45:
                        c.showPage(); y = 795
                    draw_text(c, line, 42, y, 10); y -= 15
                y -= 12
            c.save(); stream.seek(0)
            with pikepdf.open(stream) as appendix:
                pdf.pages.extend(appendix.pages)
        pdf.save(destination)
    if destination.stat().st_size > MAX_EXPORT_BYTES:
        _error("The annotated PDF exceeds the 80 MiB export limit.")
