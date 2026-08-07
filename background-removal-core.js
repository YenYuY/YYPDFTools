export const SUPPORTED_IMAGE_TYPES = new Set([
    'image/jpeg',
    'image/png',
    'image/webp',
    'image/heic',
    'image/heif'
]);

export function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
}

export function isSupportedImageFile(file) {
    if (!file) return false;
    if (SUPPORTED_IMAGE_TYPES.has(String(file.type || '').toLowerCase())) return true;
    return /\.(?:jpe?g|png|webp|heic|heif)$/i.test(String(file.name || ''));
}

export function backgroundRemovalDownloadName(filename) {
    const base = String(filename || 'image')
        .replace(/\.[^.]+$/i, '')
        .replace(/[\\/:*?"<>|]+/g, '_')
        .trim() || 'image';
    return `${base}_no_bg.png`;
}

export function canvasPointFromClient(rect, canvasWidth, canvasHeight, clientX, clientY) {
    if (!rect || rect.width <= 0 || rect.height <= 0) return { x: 0, y: 0 };
    return {
        x: clamp((clientX - rect.left) * canvasWidth / rect.width, 0, canvasWidth),
        y: clamp((clientY - rect.top) * canvasHeight / rect.height, 0, canvasHeight)
    };
}

export function unionBounds(first, second) {
    if (!first) return second ? { ...second } : null;
    if (!second) return { ...first };
    const x = Math.min(first.x, second.x);
    const y = Math.min(first.y, second.y);
    const right = Math.max(first.x + first.width, second.x + second.width);
    const bottom = Math.max(first.y + first.height, second.y + second.height);
    return { x, y, width: right - x, height: bottom - y };
}

export function strokeBounds(from, to, radius, canvasWidth, canvasHeight) {
    const padding = Math.ceil(radius) + 2;
    const left = clamp(Math.floor(Math.min(from.x, to.x) - padding), 0, canvasWidth);
    const top = clamp(Math.floor(Math.min(from.y, to.y) - padding), 0, canvasHeight);
    const right = clamp(Math.ceil(Math.max(from.x, to.x) + padding), 0, canvasWidth);
    const bottom = clamp(Math.ceil(Math.max(from.y, to.y) + padding), 0, canvasHeight);
    return {
        x: left,
        y: top,
        width: Math.max(0, right - left),
        height: Math.max(0, bottom - top)
    };
}

export function progressPercent(current, total) {
    if (!Number.isFinite(current) || !Number.isFinite(total) || total <= 0) return 0;
    return Math.round(clamp(current / total, 0, 1) * 100);
}
