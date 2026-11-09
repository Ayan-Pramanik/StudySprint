/*
 * Shared handling for "choose files" and "choose folder" uploads (quizzes, flashcards): picks the
 * readable files, notes which folder each came from, and splits large imports into requests
 * the workspace API accepts.
 */
export type PickedFile = { name: string; path: string; folder: string; text: string };
export type Picked = { files: PickedFile[]; skipped: string[] };

/** Hidden files and macOS archive leftovers in a chosen folder are never imports. */
const hidden = (path: string) => /(^|\/)(\.|__MACOSX\/)/.test(path);

/**
 * The folder a file sits in, from a folder pick ("Quizzes/Week 1/a.csv" → "Week 1",
 * "Quizzes/a.csv" → "Quizzes"). Files picked individually have none.
 */
export function folderOf(path: string) {
    const parts = path.split('/').filter(Boolean);
    return parts.length >= 2 ? parts[parts.length - 2].trim().slice(0, 100) : '';
}

export async function readPicked(list: Iterable<File>, accept: RegExp, maxEach: number, maxTotal = 40 * 1024 * 1024): Promise<Picked> {
    const files: PickedFile[] = [], skipped: string[] = [];
    let total = 0;
    for (const file of list) {
        const path = (file as File & { webkitRelativePath?: string }).webkitRelativePath || file.name;
        if (hidden(path)) continue;
        if (!accept.test(file.name)) { skipped.push(`${path}: not a supported file type`); continue; }
        if (file.size > maxEach) { skipped.push(`${path}: larger than ${(maxEach / 1024 / 1024).toFixed(1)} MB`); continue; }
        if (total + file.size > maxTotal) { skipped.push(`${path}: over the ${maxTotal / 1024 / 1024} MB limit for one upload`); continue; }
        total += file.size;
        files.push({ name: file.name, path, folder: folderOf(path), text: await file.text() });
    }
    files.sort((a, b) => a.path.localeCompare(b.path, undefined, { numeric: true }));
    return { files, skipped };
}

/** Splits items into batches under a JSON size and count, so each request stays within the API's limits. */
export function batches<T>(items: T[], maxCount: number, maxBytes = 2_400_000): T[][] {
    const out: T[][] = [];
    let current: T[] = [], size = 0;
    for (const item of items) {
        const bytes = new TextEncoder().encode(JSON.stringify(item)).length + 1;
        if (current.length && (current.length >= maxCount || size + bytes > maxBytes)) { out.push(current); current = []; size = 0; }
        current.push(item); size += bytes;
    }
    if (current.length) out.push(current);
    return out;
}
