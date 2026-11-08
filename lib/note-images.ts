'use client';
import { isMermaidSvgAttributes } from './pasted-diagrams';
import { markdownImage } from './markdown-images';

/** Uploads one PNG/JPEG to the note; returns Markdown that shows it. */
export async function uploadNoteImage(noteId: string, image: Blob, alt: string): Promise<string> {
    const response = await fetch(`/api/notes/${encodeURIComponent(noteId)}/assets?alt=${encodeURIComponent(alt)}`, { method: 'POST', body: image, headers: { 'Content-Type': image.type || 'application/octet-stream' }, credentials: 'same-origin' });
    const result = await response.json().catch(() => ({})) as { url?: string; error?: string };
    if (!response.ok || !result.url) throw new Error(result.error || 'The image could not be saved.');
    return markdownImage(alt, result.url);
}

const canvasBlob = (canvas: HTMLCanvasElement) => new Promise<Blob>((resolve, reject) => canvas.toBlob(b => b ? resolve(b) : reject(new Error('The image could not be encoded.')), 'image/png'));
const loadImage = (url: string) => new Promise<HTMLImageElement>((resolve, reject) => { const img = new Image(); img.onload = () => resolve(img); img.onerror = () => reject(new Error('The image could not be read.')); img.src = url; });

/** Re-encodes GIF/WebP/BMP/etc. as PNG; PNG and JPEG pass through. Images are capped at 4096px on their long side. */
export async function normaliseImage(file: Blob): Promise<Blob> {
    if ((file.type === 'image/png' || file.type === 'image/jpeg') && file.size <= 8 * 1024 * 1024) return file;
    const url = URL.createObjectURL(file);
    try {
        const img = await loadImage(url);
        const scale = Math.min(1, 4096 / Math.max(img.naturalWidth, img.naturalHeight));
        const canvas = document.createElement('canvas');
        canvas.width = Math.max(1, Math.round(img.naturalWidth * scale)); canvas.height = Math.max(1, Math.round(img.naturalHeight * scale));
        canvas.getContext('2d')!.drawImage(img, 0, 0, canvas.width, canvas.height);
        return await canvasBlob(canvas);
    } finally { URL.revokeObjectURL(url); }
}

/** The pasted diagram SVGs, in the order pasted-diagrams numbers them. */
export function pastedSvgs(html: string): SVGSVGElement[] {
    const doc = new DOMParser().parseFromString(html, 'text/html');
    return [...doc.querySelectorAll('svg')].filter(svg => isMermaidSvgAttributes(svg.getAttribute('id'), svg.getAttribute('aria-roledescription'))) as SVGSVGElement[];
}

const luminance = (color: string) => { const m = color.match(/\d+(\.\d+)?/g)?.map(Number) || [0, 0, 0]; return (0.299 * m[0] + 0.587 * m[1] + 0.114 * m[2]) / 255; };

/**
 * Draws a rendered diagram SVG to a PNG. HTML labels (<foreignObject>) would make the canvas
 * unreadable, so each is replaced with SVG <text> using the label's computed style first.
 */
export async function svgToPng(source: SVGSVGElement, scale = 2): Promise<Blob> {
    const svg = document.importNode(source, true) as SVGSVGElement;
    const host = document.createElement('div');
    host.style.cssText = 'position:fixed;left:-100000px;top:0;visibility:hidden;pointer-events:none';
    host.appendChild(svg); document.body.appendChild(host);
    try {
        const viewBox = svg.viewBox.baseVal;
        const box = viewBox && viewBox.width ? viewBox : svg.getBBox();
        const NS = 'http://www.w3.org/2000/svg';
        let labelColor = '';
        for (const fo of [...svg.querySelectorAll('foreignObject')]) {
            // The innermost element holding text carries the label's own colour and font.
            const inner = ([...fo.querySelectorAll('*')].reverse().find(e => e.textContent?.trim()) || fo) as HTMLElement;
            const style = getComputedStyle(inner);
            const width = Number(fo.getAttribute('width')) || 0, height = Number(fo.getAttribute('height')) || 0;
            const x0 = Number(fo.getAttribute('x')) || 0, y0 = Number(fo.getAttribute('y')) || 0;
            const lines = (fo.textContent || '').split(/\n/).map(l => l.trim()).filter(Boolean);
            const text = document.createElementNS(NS, 'text');
            const size = parseFloat(style.fontSize) || 14;
            text.setAttribute('x', String(x0 + width / 2)); text.setAttribute('text-anchor', 'middle');
            const transform = fo.getAttribute('transform'); if (transform) text.setAttribute('transform', transform);
            text.setAttribute('fill', style.color); text.setAttribute('font-size', String(size));
            text.setAttribute('font-weight', style.fontWeight); text.setAttribute('font-family', style.fontFamily || 'sans-serif');
            const top = y0 + height / 2 - ((lines.length - 1) * size * 1.2) / 2;
            lines.forEach((line, i) => { const t = document.createElementNS(NS, 'tspan'); t.setAttribute('x', String(x0 + width / 2)); t.setAttribute('y', String(top + i * size * 1.2)); t.setAttribute('dominant-baseline', 'central'); t.textContent = line; text.appendChild(t); });
            labelColor ||= style.color;
            fo.replaceWith(text);
        }
        svg.setAttribute('xmlns', NS);
        svg.setAttribute('width', String(box.width)); svg.setAttribute('height', String(box.height));
        svg.style.maxWidth = 'none';
        const markup = new XMLSerializer().serializeToString(svg);
        const url = URL.createObjectURL(new Blob([markup], { type: 'image/svg+xml' }));
        try {
            const img = await loadImage(url);
            const canvas = document.createElement('canvas');
            const pad = 24;
            canvas.width = Math.ceil((box.width + pad * 2) * scale); canvas.height = Math.ceil((box.height + pad * 2) * scale);
            const ctx = canvas.getContext('2d')!;
            // Light labels were drawn for a dark page; keep that contrast in the saved image.
            ctx.fillStyle = labelColor && luminance(labelColor) > 0.6 ? '#212121' : '#ffffff';
            ctx.fillRect(0, 0, canvas.width, canvas.height);
            ctx.drawImage(img, pad * scale, pad * scale, box.width * scale, box.height * scale);
            return await canvasBlob(canvas);
        } finally { URL.revokeObjectURL(url); }
    } finally { host.remove(); }
}
