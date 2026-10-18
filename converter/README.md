# StudySprint document service

The private Python service uses pinned Docling 2.140.0 for structured PDF, DOCX and PPTX extraction. OCRmyPDF/Tesseract recognizes scanned and mixed PDF content in redo mode. LibreOffice renders Office previews. ReportLab and pikepdf create stable text previews and flattened annotated PDFs. Uploaded originals remain unchanged in private object storage.

## Native setup

Use Python 3.14, Tesseract (English data) and LibreOffice. On this Mac the available `soffice` executable is resolved from PATH; `SOFFICE_PATH` can override it.

```sh
npm run converter:setup
# Install missing macOS Tesseract with Homebrew when requested:
bash scripts/converter-setup.sh --install-native
npm run build
npm start
```

Setup installs `requirements.lock` and downloads layout/table models at pinned repository revisions. Model files and their checksummed manifest live in `.sites-runtime/docling-models`, outside temporary jobs. Set `CONVERTER_MODEL_DIR` to override this persistent location. Startup verifies model hashes. Processing is offline and makes no external model/API calls.

`npm start` migrates local D1, starts the native converter on port 8001, then starts the app on 8787. It stores the local converter URL, shared secret and OCR language in `.sites-runtime/converter.env` with private file permissions; generated build output receives a runtime copy. Configure production secrets independently. Never publish this file or expose the converter publicly.

## Container

```sh
docker build -t studysprint-converter ./converter
docker run --rm --init --read-only --tmpfs /tmp:rw,nosuid,nodev,size=2g \
  --memory=4g --cpus=2 --cap-drop=ALL --security-opt=no-new-privileges \
  -p 127.0.0.1:8001:8001 --env CONVERTER_SECRET --env OCR_LANGUAGES=eng \
  studysprint-converter
```

The image downloads pinned models at build time under `/opt/studysprint-models`. Restrict runtime outbound traffic at the hosting layer. Run one Uvicorn worker per instance; the conversion lock is process-local. Cloudflare Queues/D1 own durable job state, retries and publication. Docker/native library dependencies are pinned in the Python lock; operating-system packages follow the base distribution's security updates.

## Private HTTP contract

Every endpoint except `/health` requires `Authorization: Bearer <CONVERTER_SECRET>`.

| Request | Result |
| --- | --- |
| GET `/health` | Readiness, local tools/models/fonts and limits; no credentials or paths |
| POST `/convert/{uuid}` | Multipart `file`, optional pinned PDF `base`; Markdown, asset manifest, base geometry/checksum, warnings, engine version and metrics |
| POST `/prepare/{uuid}` | Build an annotation PDF base without replacing Markdown |
| POST `/export/{uuid}` | Multipart PDF `file` and saved `annotations` JSON; flattened PDF artifact |
| GET `/artifacts/{uuid}/preview` | Stable PDF base |
| GET `/artifacts/{uuid}/files/{asset-uuid}` | Extracted figure PNG |
| GET `/artifacts/{uuid}/export` | Flattened annotated PDF |
| DELETE `/artifacts/{uuid}` | Idempotent temporary-artifact cleanup |

A busy service returns 503 with Retry-After. Jobs run in disposable subprocesses with a ten-minute deadline. Uploads accept 10 MiB; PDF bases accept 100 pages and 40 MiB. Markdown is bounded to 1 MiB UTF-8. Image output is bounded to 200 assets, 8 MiB each and 40 MiB total. No text, OCR pages or required figures are silently truncated. Extracted chart values retain source number formatting where supported; charts also retain their rendered appearance.

PDF coordinate annotations are independent of Markdown versions. The service preserves media/crop boxes, rotation, user units, selectable text and graphics while composing marks directly in PDF coordinates. Comments use numbered page markers and a Unicode appendix. The app retains editable annotation records; exported marks are flattened. Export size is bounded to 80 MiB. Cached private downloads expire after 24 hours.

MD/TXT previews render literal source text using bundled DejaVu and Noto CJK Unicode fonts and wrap long lines. Unsupported glyphs and previews exceeding 100 pages fail clearly. TXT Markdown escapes formatting characters. Folder/ZIP Markdown imports support portable PNG/JPEG images; unresolved local references become labelled warnings. Exact page layout belongs in Original view; Markdown is editable structured content.

## Verification

```sh
npm run test:converter
npm run test:annotations
npm run test:queue
npm run test:documents-api  # running local app required
converter/.venv/bin/python scripts/benchmark-documents.py
```

The benchmark uses the supplied `somatosensory.pdf` and `Dickinson_Sample_Slides.pptx` from the repository's parent folder. It checks figure/table/slide/bullet/speaker-note preservation and writes timing and peak-memory results to `.sites-runtime/document-benchmark.json`. Generated fixtures cover scanned/mixed PDFs, Office documents, Unicode text, long lines, text-preview limits and flattened marks on rotated/cropped pages.
