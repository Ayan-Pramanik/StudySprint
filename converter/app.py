"""Private localhost/container HTTP API. The StudySprint Worker owns user authorization."""

from __future__ import annotations

import asyncio
import hmac
import importlib.util
import json
import logging
import os
import shutil
import signal
import subprocess
import sys
import tempfile
import threading
import time
from dataclasses import dataclass
from pathlib import Path
from uuid import UUID

from fastapi import FastAPI, File, HTTPException, UploadFile
from fastapi.responses import FileResponse, JSONResponse

from .conversion import MAX_INPUT_BYTES, MAX_MARKDOWN_BYTES, MAX_PAGES, SUPPORTED_EXTENSIONS

LOGGER = logging.getLogger("studysprint.converter")
BODY_LIMIT = 56 * 1024 * 1024


@dataclass(frozen=True)
class Settings:
    secret: str
    artifacts: Path
    languages: str = "eng"
    deadline: float = 600

    @classmethod
    def from_environment(cls) -> "Settings":
        return cls(
            secret=os.environ.get("CONVERTER_SECRET", ""),
            artifacts=Path(os.environ.get("CONVERTER_ARTIFACT_DIR", str(Path(__file__).parent / ".artifacts"))).resolve(),
            languages=os.environ.get("OCR_LANGUAGES", "eng"),
        )


class RequestGuard:
    def __init__(self, app, settings: Settings):
        self.app = app
        self.settings = settings

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http":
            return await self.app(scope, receive, send)
        if scope["path"] != "/health":
            if not self.settings.secret:
                return await JSONResponse({"detail": "Converter authentication is not configured."}, status_code=503)(scope, receive, send)
            headers = dict(scope["headers"])
            supplied = headers.get(b"authorization", b"")
            if not hmac.compare_digest(supplied, f"Bearer {self.settings.secret}".encode("utf-8")):
                return await JSONResponse({"detail": "Unauthorized."}, status_code=401, headers={"WWW-Authenticate": "Bearer"})(scope, receive, send)
        content_length = dict(scope["headers"]).get(b"content-length")
        if content_length is not None:
            try:
                if int(content_length) > BODY_LIMIT:
                    return await JSONResponse({"detail": "The private request exceeds the 56 MiB processing limit."}, status_code=413)(scope, receive, send)
            except ValueError:
                return await JSONResponse({"detail": "Invalid Content-Length."}, status_code=400)(scope, receive, send)
        size = 0

        async def limited_receive():
            nonlocal size
            message = await receive()
            if message["type"] == "http.request":
                size += len(message.get("body", b""))
                if size > BODY_LIMIT:
                    raise HTTPException(413, "The private request exceeds the 56 MiB processing limit.")
            return message

        return await self.app(scope, limited_receive, send)


def prerequisites(settings: Settings) -> dict:
    packages = {name: importlib.util.find_spec(module) is not None for name, module in {
        "docling": "docling", "ocrmypdf": "ocrmypdf", "pypdfium2": "pypdfium2", "pikepdf": "pikepdf", "reportlab": "reportlab",
    }.items()}
    soffice = os.environ.get("SOFFICE_PATH") or shutil.which("soffice") or shutil.which("libreoffice")
    tesseract = shutil.which("tesseract")
    languages: list[str] = []
    if tesseract:
        try:
            result = subprocess.run([tesseract, "--list-langs"], capture_output=True, text=True, timeout=5, check=False)
            if result.returncode == 0:
                languages = [line.strip() for line in result.stdout.splitlines()[1:] if line.strip()]
        except (OSError, subprocess.TimeoutExpired):
            pass
    from .models import models_ready
    components = {**packages, "models": models_ready(), "fonts": all((Path(__file__).parent/"fonts"/name).is_file() for name in ["DejaVuSans.ttf","DejaVuSansMono.ttf","NotoSansSC-Regular.ttf"]), "soffice": bool(soffice and Path(soffice).is_file()), "tesseract": bool(tesseract and languages), "ocrLanguages": all(language in languages for language in settings.languages.split("+"))}
    return {
        "ok": True,
        "ready": bool(settings.secret) and all(components.values()),
        "authenticationConfigured": bool(settings.secret),
        "engine": "docling-2.140.0/studysprint-1",
        "components": components,
        "ocrLanguages": settings.languages.split("+"),
        "limits": {"inputBytes": MAX_INPUT_BYTES, "markdownBytes": MAX_MARKDOWN_BYTES, "pdfPages": MAX_PAGES, "deadlineSeconds": settings.deadline,"imageCount":200,"imageBytes":8*1024*1024,"combinedImageBytes":40*1024*1024,"annotations":1000,"annotationBytes":32*1024,"combinedAnnotationBytes":2*1024*1024,"concurrentConversions":1},
    }


def run_worker(source: Path, work: Path, settings: Settings, mode: str = "convert") -> dict:
    env = {name: value for name, value in os.environ.items() if name in {"PATH", "SYSTEMROOT", "WINDIR", "LANG", "LC_ALL", "SOFFICE_PATH", "TESSDATA_PREFIX", "DYLD_LIBRARY_PATH", "CONVERTER_MODEL_DIR"}}
    env.update({"HOME": str(work), "TMPDIR": str(work), "OMP_THREAD_LIMIT": "1", "PYTHONUNBUFFERED": "1", "ORT_DISABLE_TELEMETRY": "1", "HF_HUB_OFFLINE":"1", "HF_HUB_DISABLE_TELEMETRY":"1", "TOKENIZERS_PARALLELISM":"false"})
    with (work / "worker.log").open("wb") as log:
        process = subprocess.Popen([sys.executable, "-m", "converter.worker", str(source), str(work), settings.languages, mode], cwd=Path(__file__).parent.parent, stdin=subprocess.DEVNULL, stdout=log, stderr=log, env=env, start_new_session=True)
        try:
            process.wait(timeout=settings.deadline)
        except subprocess.TimeoutExpired as error:
            try:
                os.killpg(process.pid, signal.SIGKILL)
            except ProcessLookupError:
                pass
            process.wait()
            raise HTTPException(422, "Conversion exceeded the 10 minute limit. Split the document into smaller files and retry.") from error
    result_path = work / "result.json"
    if process.returncode != 0 or not result_path.is_file():
        error_path = work / "error.json"
        detail = json.loads(error_path.read_text(encoding="utf-8"))["error"] if error_path.is_file() else "The converter stopped unexpectedly. Retry the upload."
        LOGGER.warning("Conversion failed: %s", detail)
        raise HTTPException(422, detail)
    return json.loads(result_path.read_text(encoding="utf-8"))


def create_app(settings: Settings | None = None) -> FastAPI:
    settings = settings or Settings.from_environment()
    app = FastAPI(title="StudySprint private converter", docs_url=None, redoc_url=None, openapi_url=None)
    app.add_middleware(RequestGuard, settings=settings)
    lock = threading.Lock()
    app.state.conversion_lock = lock
    settings.artifacts.mkdir(mode=0o700, parents=True, exist_ok=True)

    def acquire():
        if not lock.acquire(blocking=False):
            raise HTTPException(503, "The converter is busy. Retry shortly.", headers={"Retry-After": "3"})

    def reap():
        cutoff = time.time() - 3600
        for child in settings.artifacts.iterdir():
            if child.is_dir() and child.stat().st_mtime < cutoff:
                shutil.rmtree(child, ignore_errors=True)

    @app.get("/health")
    async def health():
        return await asyncio.to_thread(prerequisites, settings)

    async def perform(job_id, file, base=None, annotations=None, mode="convert"):
        acquire()
        try:
            reap()
            filename = (file.filename or "").replace("\\", "/").rsplit("/", 1)[-1]
            suffix = Path(filename).suffix.lower()
            if suffix not in SUPPORTED_EXTENSIONS or (mode == "export" and suffix != ".pdf"):
                raise HTTPException(415, "Upload a PDF, DOCX, PPTX, Markdown, or text file.")
            async def receive(upload, destination, limit):
                size = 0
                with destination.open("wb") as target:
                    while chunk := await upload.read(65536):
                        size += len(chunk)
                        if size > limit:
                            raise HTTPException(413, "The document part exceeds its supported size.")
                        target.write(chunk)
                if not size:
                    raise HTTPException(422, "The uploaded document part is empty.")
            with tempfile.TemporaryDirectory(prefix=f".work-{job_id}-", dir=settings.artifacts) as directory:
                work = Path(directory); source = work / f"source{suffix}"
                await receive(file, source, 40*1024*1024 if mode == "export" else MAX_INPUT_BYTES)
                if base:
                    await receive(base, work / "base.pdf", 40*1024*1024)
                if mode == "export":
                    if not annotations:
                        raise HTTPException(422, "The annotation snapshot is missing.")
                    await receive(annotations, work / "annotations.json", 3*1024*1024)
                conversion = asyncio.create_task(asyncio.to_thread(run_worker, source, work, settings, mode))
                try:
                    result = await asyncio.shield(conversion)
                except asyncio.CancelledError:
                    try:
                        await conversion
                    except Exception:
                        pass
                    raise
                artifact_directory = settings.artifacts / str(job_id)
                if artifact_directory.exists():
                    shutil.rmtree(artifact_directory)
                artifact_directory.mkdir(mode=0o700)
                for name in ("preview.pdf", "annotated.pdf"):
                    if (work / name).is_file():
                        (work / name).replace(artifact_directory / name)
                if (work / "assets").is_dir():
                    (work / "assets").replace(artifact_directory / "assets")
                return result
        finally:
            await file.close()
            if base: await base.close()
            if annotations: await annotations.close()
            lock.release()

    @app.post("/convert/{job_id}")
    async def convert_upload(job_id: UUID, file: UploadFile = File(...), base: UploadFile | None = File(None)):
        return await perform(job_id, file, base=base)

    @app.post("/prepare/{job_id}")
    async def prepare_upload(job_id: UUID, file: UploadFile = File(...), base: UploadFile | None = File(None)):
        return await perform(job_id, file, base=base, mode="prepare")

    @app.post("/export/{job_id}")
    async def export_upload(job_id: UUID, file: UploadFile = File(...), annotations: UploadFile = File(...)):
        return await perform(job_id, file, annotations=annotations, mode="export")

    @app.get("/artifacts/{job_id}/files/{asset_id}")
    async def get_asset(job_id: UUID, asset_id: UUID):
        path = settings.artifacts / str(job_id) / "assets" / f"{asset_id}.png"
        if not path.is_file():
            raise HTTPException(404, "Image not found or expired.")
        return FileResponse(path, media_type="image/png", headers={"Cache-Control":"no-store", "X-Content-Type-Options":"nosniff"})

    @app.get("/artifacts/{job_id}/export")
    async def get_export(job_id: UUID):
        path = settings.artifacts / str(job_id) / "annotated.pdf"
        if not path.is_file():
            raise HTTPException(404, "Export not found or expired.")
        return FileResponse(path, media_type="application/pdf", headers={"Cache-Control":"no-store", "X-Content-Type-Options":"nosniff"})

    @app.get("/artifacts/{job_id}/preview")
    async def get_preview(job_id: UUID):
        preview = settings.artifacts / str(job_id) / "preview.pdf"
        if not preview.is_file():
            raise HTTPException(404, "Preview not found or expired.")
        return FileResponse(preview, media_type="application/pdf", headers={"Cache-Control": "no-store", "X-Content-Type-Options": "nosniff"})

    @app.delete("/artifacts/{job_id}", status_code=204)
    async def delete_artifact(job_id: UUID):
        acquire()
        try:
            shutil.rmtree(settings.artifacts / str(job_id), ignore_errors=True)
        finally:
            lock.release()

    return app


app = create_app()
