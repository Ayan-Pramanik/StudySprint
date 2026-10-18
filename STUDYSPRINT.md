# StudySprint

A local study workspace for real notes and review history. There are no seeded subjects, canned cards, fake statistics, or demo actions.

## Run locally

The application uses Node 22.13+ and a private Python 3.14 converter. Install Tesseract and LibreOffice for OCR and Office previews; `SOFFICE_PATH` can select an existing LibreOffice executable. The native setup script can install missing Tesseract through Homebrew on macOS.

```sh
npm run install:ci
npm run converter:setup -- --install-native
npm run build
npm start
```

Open http://127.0.0.1:8787. `npm start` applies local migrations, starts the native converter on port 8001, and starts the app on port 8787. Existing notes, revisions, links, cards, and reviews migrate into the normalized storage without changing identifiers. Stop the running preview before rebuilding and restart afterward.

Local D1/R2 data and queue state persist in `.wrangler/state`. The first start creates a private shared converter secret in ignored `.sites-runtime/converter.env`; it is reused across restarts and copied into the built Worker's `.dev.vars`. Keep configuration outside `dist`, which builds replace. Hosted deployments need D1, private R2 (`BUCKET`), a Queue producer/consumer (`IMPORT_QUEUE`), and `CONVERTER_URL` / `CONVERTER_SECRET` runtime secrets. The converter requires a direct service connection whose timeout permits ten-minute OCR requests. Publishing and provisioning remain manual.

See [converter/README.md](converter/README.md) for native/container setup, language packs, service endpoints, and converter tests.

## Upload documents and study the original

Choose **Create note → Upload a file**, select one PDF, DOCX, PPTX, Markdown, or TXT file, then choose a title and subject. Imports run in the background; the Notes screen lists their progress and provides retry/cancel. Reloading or moving between screens does not interrupt an import. A note appears only after Markdown and its required preview are ready.

Notes with a source offer **Original** and **Split view** beside Read/Edit. Split view places the original beside readable/editable Markdown on desktop; narrow screens use the Original tab. PDFs use an in-app PDF.js reader with page navigation, zoom, and text selection. DOCX/PPTX display a labelled, generated PDF preview; Markdown/TXT provide a paginated, annotatable PDF preview and escaped original text. Highlight, underline, comment and drawing tools autosave with local recovery, undo/redo and conflict handling. Download annotated PDF creates a flattened copy after marks are saved. Original bytes remain private and are retained in workspace backups. Editing Markdown never replaces an annotation base.

PDF OCR uses OCRmyPDF/Tesseract before pinned Docling extraction, including image-only pages and image text mixed with existing digital text. English is the default (`OCR_LANGUAGES=eng`); install any additional language packs before changing it. OCR may misread handwriting, equations, columns, or poor scans, so compare extracted notes against the original. Extracted Markdown preserves headings, tables and referenced figure assets, with PDF crops retaining vector diagrams and labels. PowerPoint notes include numbered slide sections, chart images/data and speaker notes. Word uses native semantic structure and recovers floating figures from the PDF preview when possible. Improve conversion offers Review and Apply; Apply creates a revision and rejects stale reviews. ZIP v3 backups retain originals, exact PDF bases, assets, annotations and revisions; v2 ZIP and v1 JSON imports remain compatible.

Limits: 10 MiB per uploaded file, 100 PDF/preview pages, 1 MiB of UTF-8 Markdown per note, and a ten-minute conversion deadline. Unsupported, encrypted, corrupt, empty, oversized, and incomplete conversions fail with an actionable message; content is never silently truncated. Select a saved Markdown passage of at most 24,000 characters to generate cards from longer notes.

Source and preview routes require the same guest workspace cookie as notes; object storage is private. Deleting a note revokes its source immediately and queues file deletion. Existing card excerpts and review history follow the existing deletion choices.

## Backups with files

**Download workspace backup** creates a version-2 ZIP containing workspace metadata, note bodies, complete revisions, originals, and Office previews. Files stream through the app rather than loading the complete archive into memory. Settings accepts this ZIP using 8 MiB upload chunks and background restoration. Import adds fresh records and remaps ownership, stable links, sources, cards, and review history. Existing records remain; importing the same archive as a separate operation creates another copy.

Archives are validated before publication, including entry paths, references, file sizes, and CRCs. A failed restore publishes no partial notes. Previews are restored directly, without needing the converter again. Existing version-1 JSON backups and Markdown/folder/ZIP note imports remain supported. Markdown exports contain the note text; full workspace ZIP backups include originals.

The supported full-backup archive limit is 256 MiB with up to 200 source files; bounded entry/metadata and processing-operation limits also apply. Export preflight reports over-limit or unavailable files before download. Keep StudySprint-generated archives unchanged; repacked archives with a different file order are not supported. Cancel an unwanted multipart upload before leaving its upload control. Incomplete multipart uploads left by a closed browser do not yet expire automatically.

## Real workflows

- Create a first note and its subject together, or create a manual card immediately.
- Organise subjects; write Markdown with autosave, recovery text, readable preview, stable `[[Note Title]]` links and backlinks.
- Create cloze drafts from any explanatory passage or whole note. This is **extractive generation**, not AI: a phrase is hidden in the original text, the phrase becomes the answer, and the exact passage is saved. Drafts are editable and require approval. Unsupported/insufficient source material produces an error, not canned content. Existing prompts are deduplicated.
- Create basic or single-deletion cloze cards manually, with optional subject and source.
- Practise with FSRS scheduling, keyboard reveal/rating, actual interval previews, per-day introduction limits and persistent immutable review events. Finish a session explicitly to see its summary.
- Inspect a card's saved source, acknowledge note-level change flags, preserve or reset learning on card edits, suspend/archive/delete cards.
- Restore prior note revisions, export Markdown, and download/import a full workspace ZIP backup from workspace Settings (bottom-left profile button).
- Import Markdown notes from **Notes → Import Markdown** (or Settings): choose several `.md` files, a whole folder, or a `.zip`. Titles come from `title:` front matter or the file name; subjects from `subject:` front matter, the parent folder name (optional), or a chosen fallback subject. Existing subjects are matched by name, `[[links]]` are bound after import, and notes identical to an existing note are skipped. **Export all / Export subject (.zip)** writes one `.md` per note with title/subject front matter, in a folder per subject; a note's own **Export Markdown** uses the same format. Bulk imports are limited to 1000 notes and 2.8 MB.
- Import validates data before saving, remaps identifiers and links, preserves schedules/history, and keeps existing records. Importing the same backup twice creates two copies; import it only once.

## AI configuration (optional)

`AI_API_KEY` enables server-side AI card generation; `AI_MODEL` optionally overrides the default `gpt-4.1-mini`. The app shows **Generate with AI** only when the key is configured. Ordinary cloze drafting works without a key and is never presented as an AI result.

For the built local Worker, place these variables in an ignored `dist/server/.dev.vars` file, then restart the server. Keep a secure copy outside `dist`, because rebuilding replaces it. For hosting, set them as runtime secrets rather than source files. Never paste keys into notes or commit them.

The database binding is `DB`; local D1 persists under `.wrangler/state`. Hosted D1 is separately provisioned and does not use an ephemeral production filesystem. Publishing is not configured as an automatic action.

AI requests send only the selected note material (up to 24,000 characters), validate structured output and exact citations, and use a 25-second timeout with at most two HTTP attempts for throttling/server errors. Student approval remains essential.

## Persistence and safety

A server-issued HttpOnly, SameSite=Lax cookie identifies the guest workspace (Secure over HTTPS). Server operations derive ownership from this cookie. Clearing it loses workspace access: export a backup first. This is not account-based cross-device sync; backups can move work between browsers.

D1 stores workspace metadata, separate note bodies and revisions, import records, and immutable review events. R2 stores originals and previews; Queues dispatch background conversions and restores. A version-checked atomic batch commits schedules and events together. Review IDs make retries idempotent; concurrent conflicting mutations return an error. Stale note autosaves include their last saved timestamp and cannot silently overwrite a newer edit.

Note autosave debounces 700ms and preserves pending text in session storage. Reopen the note in the same tab to recover it. Note-body version changes conservatively flag related cards without resetting schedules. Deleted notes leave saved card excerpts/history intact. Three saved Again ratings flag a difficult card; there are no mastery or retention claims.

## Verification

```sh
npm run typecheck
npm test
npm run test:storage
npm run test:queue
npm run test:graph
npm run test:pomodoro
npm run test:backups
npm run test:converter
npm run build
# With the server running:
npm run test:assets
npm run test:api
npm run test:imports
npm run test:backups-api
```

Tests cover FSRS preview/commit agreement, persistence, repeated/concurrent rating requests, draft approval, suspension, daily limits, stable links, source flags, extractive drafting and insufficient sources. API tests start with an empty workspace, create real records through the API, check isolation, generation, editing, note history/stale writes, backup restoration, and deletion behavior. The asset test validates every JavaScript/CSS reference, not just the HTML response.

Workspace responses contain lightweight note summaries and graph link metadata; current note bodies and revision contents load on demand. Legacy JSON imports keep their 2.9 MB limit. Successful live AI calls still require a configured key. Accounts and automatic cross-device sync are not implemented.

## Quick walkthrough

Create a note and subject → write a few explanatory sentences → wait for Saved → Create cloze drafts → edit/approve → Today → Start review → Space → 1–4 → Finish session → inspect Progress. Edit the supporting note to see source-change flags. Export a backup through Settings and restore it into a separate browser workspace to verify portability.

Settings is available from the main navigation on desktop and mobile, including subject management. Subject-filtered reviews enforce the daily new-card limit without rejecting cards simply because another subject appears earlier in the global queue.

## Graph View

Open **Graph** in the navigation, or **View local graph** in a saved note. Local views include both incoming and outgoing neighbours, with a one/two-hop selector. Switch to the global view to see the whole workspace.

- Graph nodes are existing accessible notes; relationships come from `links()` and `resolveLink()` using saved stable bindings. Repeated links collapse. Backlinks do not create new relationships. Reciprocal links share one line with arrowheads at both ends, but count as two directed connections.
- Subject and isolated-note filters restrict visible endpoints. Search spans all workspace notes; a hidden match offers **Reveal in global graph**, which clears hiding filters. Counts always describe the visible graph, not search results.
- Select a node to inspect its plain-text preview, incoming/outgoing links, unresolved titles, and existing editor/create actions. Opening a note preserves graph state while navigating within the current app session. Graph filters and positions are not persisted across a browser reload.
- Pan, zoom, drag nodes, fit, and reset layout. Subjects use colours and shapes with a legend and textual subject labels in search, details, and the accessible list.
- **Accessible list** provides keyboard-accessible selection, connection traversal, note opening, and local focus. Mobile uses a full-width graph and collapsible details below it.
- Cytoscape.js is dynamically loaded only after visiting Graph. CoSE layout runs in a dedicated worker, without animation (including under reduced-motion preferences), then stops. Workers are terminated after use or invalidation; renderer listeners and resize observers are cleaned up on unmount. Dragged positions are retained for the current graph session.
- Graph data is derived from the same server-authorised workspace response as notes. There is no graph database, separate edge index, cross-workspace fetch, or AI-derived connection. No notes were added or modified to populate the graph.

Run `npm run test:graph` for relationship direction/deduplication, reciprocity, isolates, hop traversal, subject filters, stable renames/deletions, newly resolved and ambiguous titles, code exclusions, plain previews, and a 300-node force layout fixture. The existing API suite also checks that another guest sees no graph nodes or relationships.

Graph implementation references: [Cytoscape.js](https://js.cytoscape.org/) and [Vite workers](https://vite.dev/guide/features.html#web-workers). Graph drag, pinch/zoom, visual arrow readability, and keyboard interactions should be checked in a browser after graph changes.

The production worker bundle is additionally exercised with `npm run test:graph-build`. With the preview running, `TEST_URL=http://127.0.0.1:8787 npm run test:graph-build` also checks that the graph/renderer/worker assets return JavaScript successfully and that Graph is absent from the initial dashboard's preloaded scripts. Vite's `?worker` import is used to avoid server-side `import.meta.url` rewriting in the framework.
