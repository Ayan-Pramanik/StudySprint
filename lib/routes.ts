export const sectionPaths = {
    Today: '/', Focus: '/focus', Notes: '/notes', Graph: '/graph',
    Cards: '/cards', Quiz: '/quiz', Insights: '/insights', Review: '/review', Progress: '/progress', Settings: '/settings',
} as const;
export type WorkspaceSection = keyof typeof sectionPaths;
export type WorkspaceRoute = { section: WorkspaceSection; noteId?: string };

/** IDs are opaque, stable identifiers; titles and folder names are never URLs. */
export function notePath(id: string) { return '/notes/' + encodeURIComponent(id); }
export function workspaceRoute(pathname: string): WorkspaceRoute | undefined {
    if (!pathname.startsWith('/') || pathname.includes('//')) return;
    const path = pathname.length > 1 ? pathname.replace(/\/$/, '') : pathname;
    for (const [section, href] of Object.entries(sectionPaths)) {
        if (href === path) return { section: section as WorkspaceSection };
    }
    const match = /^\/notes\/([^/]+)$/.exec(path);
    if (match) {
        try { return { section: 'Notes', noteId: decodeURIComponent(match[1]) }; }
        catch { /* Malformed URLs are not valid workspace routes. */ }
    }
}
