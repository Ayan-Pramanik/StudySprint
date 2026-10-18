"""Document conversion primitives. Run in a disposable subprocess, never in the API process."""

from __future__ import annotations

import os
import re
import shutil
import subprocess
import zipfile
from pathlib import Path, PurePosixPath

from defusedxml.ElementTree import fromstring

MAX_INPUT_BYTES = 10 * 1024 * 1024
MAX_MARKDOWN_BYTES = 1024 * 1024
MAX_PAGES = 100
MAX_PREVIEW_BYTES = 40 * 1024 * 1024
SUPPORTED_EXTENSIONS = {".pdf", ".docx", ".pptx", ".md", ".txt"}


class ConversionError(Exception):
    """An actionable, safe-to-display input/conversion failure."""


def validate_input(path: Path) -> None:
    extension = path.suffix.lower()
    if extension not in SUPPORTED_EXTENSIONS:
        raise ConversionError("Upload a PDF, DOCX, PPTX, Markdown, or text file.")
    if not 0 < path.stat().st_size <= MAX_INPUT_BYTES:
        raise ConversionError("The file must be nonempty and no larger than 10 MiB.")
    if extension in {".md", ".txt"}:
        try:
            text = path.read_bytes().decode("utf-8")
        except UnicodeDecodeError as error:
            raise ConversionError("Text and Markdown files must use UTF-8 encoding.") from error
        if "\x00" in text:
            raise ConversionError("The uploaded file contains binary data, not UTF-8 text.")
        return
    if extension == ".pdf":
        if not re.match(rb"%PDF-(?:1\.[0-7]|2\.0)", path.read_bytes()[:16]):
            raise ConversionError("The file does not have a valid PDF signature.")
        inspect_pdf(path)
        return
    _validate_office(path, extension)


def _validate_office(path: Path, extension: str) -> None:
    main_part, content_type = {
        ".docx": ("word/document.xml", "application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"),
        ".pptx": ("ppt/presentation.xml", "application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"),
    }[extension]
    try:
        with zipfile.ZipFile(path) as archive:
            entries = archive.infolist()
            if len(entries) > 10000 or sum(item.file_size for item in entries) > 100 * 1024 * 1024:
                raise ConversionError("The Office document expands beyond the supported size.")
            names = set()
            for entry in entries:
                name = PurePosixPath(entry.filename)
                if name.is_absolute() or ".." in name.parts or "\\" in entry.filename:
                    raise ConversionError("The Office document contains an unsafe archive path.")
                if entry.filename in names or entry.flag_bits & 1:
                    raise ConversionError("Encrypted or duplicate Office archive entries are unsupported.")
                names.add(entry.filename)
                if entry.file_size > 32 * 1024 * 1024 or (entry.file_size > 1024 * 1024 and entry.file_size > max(entry.compress_size, 1) * 1000):
                    raise ConversionError("The Office document contains an oversized archive entry.")
                if "vbaproject" in entry.filename.lower():
                    raise ConversionError("Documents containing macros are unsupported.")
                if entry.filename.endswith(".rels"):
                    relationships = fromstring(archive.read(entry))
                    for relationship in relationships:
                        # Hyperlinks are content; external images/templates/OLE are active imports.
                        if relationship.get("TargetMode") == "External" and not (relationship.get("Type") or "").endswith("/hyperlink"):
                            raise ConversionError("Documents containing linked external resources are unsupported. Embed the resources and upload again.")
            if main_part not in names or "[Content_Types].xml" not in names:
                raise ConversionError("The file is not a valid document of the selected Office type.")
            content_types = fromstring(archive.read("[Content_Types].xml"))
            if not any(part.get("PartName") == f"/{main_part}" and part.get("ContentType") == content_type for part in content_types):
                raise ConversionError("The Office document signature does not match its extension.")
            # Parse the main XML now so malformed documents fail before LibreOffice starts.
            fromstring(archive.read(main_part))
    except ConversionError:
        raise
    except Exception as error:
        raise ConversionError("The Office document is corrupt or has an invalid archive signature.") from error


def inspect_pdf(path: Path) -> int:
    import pikepdf

    try:
        with pikepdf.open(path) as document:
            if document.is_encrypted:
                raise ConversionError("Password-protected PDFs are unsupported. Upload an unlocked copy.")
            pages = len(document.pages)
            if not 0 < pages <= MAX_PAGES:
                raise ConversionError("PDFs must contain between 1 and 100 pages.")
            return pages
    except ConversionError:
        raise
    except pikepdf.PasswordError as error:
        raise ConversionError("Password-protected PDFs are unsupported. Upload an unlocked copy.") from error
    except Exception as error:
        raise ConversionError("The PDF is corrupt or cannot be read.") from error


def _run(arguments: list[str], cwd: Path) -> subprocess.CompletedProcess[str]:
    # The API owns the outer process group and the overall timeout. Children inherit it.
    completed = subprocess.run(arguments, cwd=cwd, stdin=subprocess.DEVNULL, capture_output=True, text=True, errors="replace", check=False)
    return completed


def ocr_pdf(source: Path, destination: Path, work: Path, languages: str) -> bool:
    import sys

    if not re.fullmatch(r"[a-zA-Z0-9_]+(?:\+[a-zA-Z0-9_]+)*", languages):
        raise ConversionError("The server OCR language configuration is invalid.")
    result = _run([
        sys.executable, "-m", "ocrmypdf", "--redo-ocr", "--output-type", "pdf",
        "--optimize", "0", "--rasterizer", "pypdfium", "--jobs", "2",
        "--language", languages, "--tesseract-timeout", "30", "--skip-big", "25",
        "--max-image-mpixels", "50", str(source), str(destination),
    ], work)
    log = result.stdout + "\n" + result.stderr
    if result.returncode != 0:
        if "signed" in log.lower():
            raise ConversionError("This signed PDF cannot be OCR processed. Upload an unsigned copy.")
        raise ConversionError("PDF text recognition failed. Check that the file is readable and uses the configured OCR language.")
    # OCRmyPDF can exit successfully after omitting pages. Never accept silent data loss.
    if re.search(r"(?:timed?\s*out|timeout|took too long|skipping.*(?:ocr|page|large)|(?:page|ocr).*(?:skipped|skipping)|image too large|too big)", log, re.IGNORECASE):
        raise ConversionError("Text recognition could not process every page within the resource limits. Split the PDF into smaller files and retry.")
    if not destination.is_file():
        raise ConversionError("PDF text recognition did not produce an output file.")
    # A successful redo pass can be useful on both digital and scanned content.
    return bool(re.search(r"(?:OCR|recogniz|rasteriz)", log, re.IGNORECASE))


def office_preview(source: Path, destination: Path, work: Path) -> None:
    executable = os.environ.get("SOFFICE_PATH") or shutil.which("soffice") or shutil.which("libreoffice")
    if not executable:
        raise ConversionError("The document preview service is unavailable: LibreOffice is not installed.")
    profile = work / "office-profile"
    profile.mkdir()
    (profile / "user").mkdir()
    (profile / "user" / "registrymodifications.xcu").write_text(
        '<?xml version="1.0"?><oor:items xmlns:oor="http://openoffice.org/2001/registry">'
        '<item oor:path="/org.openoffice.Office.Common/Security/Scripting"><prop oor:name="MacroSecurityLevel" oor:op="fuse"><value>3</value></prop></item>'
        '<item oor:path="/org.openoffice.Office.Common/Load"><prop oor:name="UpdateDocMode" oor:op="fuse"><value>0</value></prop></item>'
        '</oor:items>', encoding="utf-8",
    )
    result = _run([
        executable, f"-env:UserInstallation={profile.as_uri()}", "--headless", "--nologo",
        "--nodefault", "--nofirststartwizard", "--norestore", "--convert-to", "pdf",
        "--outdir", str(work), str(source),
    ], work)
    generated = work / f"{source.stem}.pdf"
    # LibreOffice sometimes returns zero even when conversion fails.
    if result.returncode != 0 or not generated.is_file():
        raise ConversionError("The Office document could not be rendered. Open it locally, save a fresh copy, and retry.")
    inspect_pdf(generated)
    if generated.stat().st_size > MAX_PREVIEW_BYTES:
        raise ConversionError("The document's PDF preview exceeds the 40 MiB preview limit.")
    generated.replace(destination)


def clean_markdown(markdown: str) -> str:
    if len(markdown.encode("utf-8")) > MAX_MARKDOWN_BYTES:
        raise ConversionError("The converted note exceeds the 1 MiB Markdown limit. Split the source into smaller files.")
    if not markdown.strip():
        raise ConversionError("No readable text was found. Check the scan quality and OCR language, or create a note manually.")
    return markdown


def convert(source: Path, work: Path, languages: str = "eng", base: Path | None = None, prepare_only: bool = False) -> dict:
    validate_input(source)
    from .pdf_tools import text_pdf, describe_pdf
    from .layout import extract_document, ENGINE
    extension = source.suffix.lower()
    used_ocr = False
    preview = work / "preview.pdf"
    kind = "pdf" if extension == ".pdf" else "text-pdf" if extension in {".md", ".txt"} else "office-pdf"
    if base:
        inspect_pdf(base)
        shutil.copyfile(base, preview)
    elif extension in {".md", ".txt"}:
        text_pdf(source.read_bytes().decode("utf-8"), preview)
    elif extension == ".pdf":
        ocr_pdf(source, preview, work, languages)
        used_ocr = True
        kind = "searchable-pdf"
    else:
        office_preview(source, preview, work)
    descriptor = describe_pdf(preview, kind)
    if prepare_only:
        return {"markdown": "", "ocr": used_ocr, "preview": True, "base": descriptor, "assets": [], "conversion": {"engine": ENGINE, "warnings": []}}
    if extension in {".md", ".txt"}:
        markdown = source.read_bytes().decode("utf-8")
        if extension == ".txt":
            markdown = re.sub(r"([\\`*_\[\]<>])", r"\\\1", markdown)
            markdown = re.sub(r"(?m)^(\s*)([#>+\-]|\d+[.)])(\s)", r"\1\\\2\3", markdown)
        warnings=[]
        if extension in {".md",".markdown"}:
            from markdown_it import MarkdownIt
            for token in MarkdownIt().parse(markdown):
                for child in token.children or []:
                    if child.type=="image":
                        url=child.attrGet("src") or ""
                        if not re.match(r"https?://",url,re.I):warnings.append("Missing local image: "+url+". Import a folder or ZIP with its image files.")
        assets, conversion = [], {"engine": ENGINE, "warnings": warnings}
    else:
        markdown, assets, conversion = extract_document(source, preview, work)
    markdown = clean_markdown(markdown)
    return {"markdown": markdown, "ocr": used_ocr, "preview": True, "base": descriptor, "assets": assets, "conversion": conversion}
