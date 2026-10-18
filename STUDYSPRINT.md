# StudySprint

A local study workspace for real notes and review history. There are no seeded subjects, canned cards, fake statistics, or demo actions.

## Run locally

The application runs on Node 22.13+. `npm install` includes a project-local Node 22 runtime, and the npm scripts select it automatically when your system Node is older. `.nvmrc` also selects Node 22.

```sh
npm install
npm run build
# First setup only:
node scripts/local-run.mjs --import ./scripts/sites-env.mjs node_modules/wrangler/bin/wrangler.js d1 execute DB --local --config dist/server/wrangler.json --persist-to .wrangler/state --file drizzle/0000_fearless_the_hand.sql
npm start
```

Open http://127.0.0.1:8787. Stop the preview before rebuilding and restart afterward: a running Wrangler process can retain old asset references when `dist/` is replaced.

## Real workflows

- Create a first note and its subject together, or create a manual card immediately.
- Organise subjects; write Markdown with autosave, recovery text, readable preview, stable `[[Note Title]]` links and backlinks.
- Create cloze drafts from any explanatory passage or whole note. This is **extractive generation**, not AI: a phrase is hidden in the original text, the phrase becomes the answer, and the exact passage is saved. Drafts are editable and require approval. Unsupported/insufficient source material produces an error, not canned content. Existing prompts are deduplicated.
- Create basic or single-deletion cloze cards manually, with optional subject and source.
- Practise with FSRS scheduling, keyboard reveal/rating, actual interval previews, per-day introduction limits and persistent immutable review events. Finish a session explicitly to see its summary.
- Explore **Adventure** to battle monsters drawn from your own active cards, choose subject-themed zones, spend HP on clue skills, earn XP and collect concepts. Battles use the normal self-rated FSRS review flow; Adventure progress and skill loot are included in workspace backups.
- Inspect a card's saved source, acknowledge note-level change flags, preserve or reset learning on card edits, suspend/archive/delete cards.
- Restore prior note revisions, export Markdown, and download/import a full workspace backup from workspace Settings (bottom-left profile button).
- Import files from **Notes → Import files** (or Settings): choose PDF, Word `.docx`, Markdown, text, HTML, CSV, JSON, XML, or log files, a whole folder, or a `.zip` of Markdown notes. PDF and Word text is extracted in the browser and saved as note text; original binary files are not stored, and scanned PDFs need OCR before import. Titles come from `title:` front matter or the file name; subjects from `subject:` front matter, the parent folder name (optional), or a chosen fallback subject. Existing subjects are matched by name, `[[links]]` are bound after import, and notes identical to an existing note are skipped. **Export all / Export subject (.zip)** writes one `.md` per note with title/subject front matter, in a folder per subject; a note's own **Export Markdown** uses the same format. Bulk imports are limited to 1000 notes and 2.8 MB of extracted text; individual source files may be up to 25 MB.
- Import validates data before saving, remaps identifiers and links, preserves schedules/history, and keeps existing records. Importing the same backup twice creates two copies; import it only once.

## AI configuration (optional)

`AI_API_KEY` enables server-side AI card generation; `AI_MODEL` optionally overrides the default `gpt-4.1-mini`. The app shows **Generate with AI** only when the key is configured. Ordinary cloze drafting works without a key and is never presented as an AI result.

For the built local Worker, place these variables in an ignored `dist/server/.dev.vars` file, then restart the server. Keep a secure copy outside `dist`, because rebuilding replaces it. For hosting, set them as runtime secrets rather than source files. Never paste keys into notes or commit them.

The database binding is `DB`; local D1 persists under `.wrangler/state`. Hosted D1 is separately provisioned and does not use an ephemeral production filesystem. Publishing is not configured as an automatic action.

AI requests send only the selected note material (up to 24,000 characters), validate structured output and exact citations, and use a 25-second timeout with at most two HTTP attempts for throttling/server errors. Student approval remains essential.

## Persistence and safety

A server-issued HttpOnly, SameSite=Lax cookie identifies the guest workspace (Secure over HTTPS). Server operations derive ownership from this cookie. Clearing it loses workspace access: export a backup first. This is not account-based cross-device sync; backups can move work between browsers.

D1 stores workspace data and separate immutable review events. A version-checked atomic batch commits schedules and events together. Review IDs make retries idempotent; concurrent conflicting mutations return an error. Stale note autosaves include their last saved timestamp and cannot silently overwrite a newer edit.

Note autosave debounces 700ms and preserves pending text in session storage. Reopen the note in the same tab to recover it. Note-body version changes conservatively flag related cards without resetting schedules. Deleted notes leave saved card excerpts/history intact. Three saved Again ratings flag a difficult card; there are no mastery or retention claims.

## Verification

```sh
npm run typecheck
npm test
npm run build
# With the server running:
npm run test:assets
npm run test:api
```

Tests cover FSRS preview/commit agreement, persistence, repeated/concurrent rating requests, draft approval, suspension, daily limits, stable links, source flags, extractive drafting and insufficient sources. API tests start with an empty workspace, create real records through the API, check isolation, generation, editing, note history/stale writes, backup restoration, and deletion behavior. The asset test validates every JavaScript/CSS reference, not just the HTML response.

Browser visual/click/keyboard verification remains unavailable because no browser connection is present. Successful live AI calls remain unverified without a configured key. Workspace data currently loads as a full document rather than paginated records. Import has a 2.9 MB file limit. Accounts and automatic cross-device sync are not implemented.

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

Graph implementation references: [Cytoscape.js](https://js.cytoscape.org/) and [Vite workers](https://vite.dev/guide/features.html#web-workers). Browser drag, pinch/zoom, visual arrow readability and mobile/keyboard interactions remain manual-QA limitations while no browser connection is available.

The production worker bundle is additionally exercised with `npm run test:graph-build`. With the preview running, `TEST_URL=http://127.0.0.1:8787 npm run test:graph-build` also checks that the graph/renderer/worker assets return JavaScript successfully and that Graph is absent from the initial dashboard's preloaded scripts. Vite's `?worker` import is used to avoid server-side `import.meta.url` rewriting in the framework.
