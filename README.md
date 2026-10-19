# StudySprint

**Connect your notes. Remember what matters.**
<img width="1720" height="1228" alt="image" src="https://github.com/user-attachments/assets/6a9f4d6d-da12-4fee-97fc-f306a3d29fe7" />


A persistent study application for your own material: document uploads with OCR, original-file and split readers, linked Markdown notes, source-based flashcard drafts, approval, FSRS reviews, version history, and portable backups including original files. No sample workspace or canned generation is included.

Requires Node 22.13+, Python 3.14, Tesseract, and LibreOffice for document conversion. See [STUDYSPRINT.md](STUDYSPRINT.md) for setup, configuration, test commands and current limitations.

### Document conversion and annotations

The Original reader supports highlights, underlines, comments and freehand drawing with recoverable autosave, undo/redo and flattened annotated-PDF downloads. Converted notes retain private image assets; Improve conversion offers a review before saving a new Markdown revision. ZIP backups now use v3 and retain originals, PDF bases, images, annotations and revisions; v2 ZIP and v1 JSON restores remain supported. Markdown note bundles carry PNG/JPEG image files. See [converter setup and verification](converter/README.md).
Requires Node 22.13+. See [STUDYSPRINT.md](STUDYSPRINT.md) for setup, configuration, test commands and current limitations.

For live English dictation on an Apple Silicon Mac and a free public judges’ link, see [JUDGES.md](JUDGES.md). Speech recognition runs locally through WhisperLiveKit/MLX; no paid transcription API is required.
