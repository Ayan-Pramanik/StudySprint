/** Pasted note images: format detection and dimensions, shared by the upload route and its tests. */
export const PASTED_IMAGE_TYPES = ['image/png', 'image/jpeg'] as const;
export type PastedImageType = typeof PASTED_IMAGE_TYPES[number];

/** Identifies PNG/JPEG by their signature, never by the declared Content-Type. */
export function sniffImage(bytes: Uint8Array): { mediaType: PastedImageType; width: number; height: number } | undefined {
    if (bytes.length >= 24 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47 && bytes[12] === 0x49 && bytes[13] === 0x48 && bytes[14] === 0x44 && bytes[15] === 0x52) {
        const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
        return { mediaType: 'image/png', width: view.getUint32(16), height: view.getUint32(20) };
    }
    if (bytes.length >= 4 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
        // Walk JPEG segments to the first start-of-frame marker, which holds the dimensions.
        let i = 2;
        while (i + 9 < bytes.length) {
            if (bytes[i] !== 0xff) { i++; continue; }
            const marker = bytes[i + 1];
            if (marker === 0xff) { i++; continue; }
            if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) { i += 2; continue; }
            const length = (bytes[i + 2] << 8) | bytes[i + 3];
            if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc)
                return { mediaType: 'image/jpeg', height: (bytes[i + 5] << 8) | bytes[i + 6], width: (bytes[i + 7] << 8) | bytes[i + 8] };
            i += 2 + length;
        }
    }
    return undefined;
}
