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

export function calculateFittedCanvasSize(
    imageWidth,
    imageHeight,
    stageWidth,
    stageHeight,
    padding = 0
) {
    const safeImageWidth = Math.max(0, Number(imageWidth) || 0);
    const safeImageHeight = Math.max(0, Number(imageHeight) || 0);
    const availableWidth = Math.max(0, (Number(stageWidth) || 0) - Math.max(0, Number(padding) || 0) * 2);
    const availableHeight = Math.max(0, (Number(stageHeight) || 0) - Math.max(0, Number(padding) || 0) * 2);

    if (!safeImageWidth || !safeImageHeight || !availableWidth || !availableHeight) {
        return { width: 0, height: 0, scale: 0 };
    }

    const scale = Math.min(1, availableWidth / safeImageWidth, availableHeight / safeImageHeight);
    return {
        width: safeImageWidth * scale,
        height: safeImageHeight * scale,
        scale
    };
}

export function constrainCanvasPan(
    panX,
    panY,
    canvasWidth,
    canvasHeight,
    zoom,
    stageWidth,
    stageHeight,
    minimumVisible = 48
) {
    const scaledWidth = Math.max(0, Number(canvasWidth) || 0) * Math.max(0, Number(zoom) || 0);
    const scaledHeight = Math.max(0, Number(canvasHeight) || 0) * Math.max(0, Number(zoom) || 0);
    const safeStageWidth = Math.max(0, Number(stageWidth) || 0);
    const safeStageHeight = Math.max(0, Number(stageHeight) || 0);
    const visible = Math.max(0, Number(minimumVisible) || 0);

    const constrainAxis = (value, scaledSize, stageSize) => {
        if (scaledSize <= stageSize) return 0;
        const limit = Math.max(0, (stageSize + scaledSize) / 2 - Math.min(visible, stageSize));
        return clamp(Number(value) || 0, -limit, limit);
    };

    return {
        x: constrainAxis(panX, scaledWidth, safeStageWidth),
        y: constrainAxis(panY, scaledHeight, safeStageHeight)
    };
}

export function createModelSessionLoader(loadModule, baseConfig = {}) {
    if (typeof loadModule !== 'function') throw new TypeError('loadModule must be a function');

    let modulePromise = null;
    let readyPromise = null;
    let ready = false;

    const getModule = () => {
        if (!modulePromise) {
            modulePromise = Promise.resolve()
                .then(loadModule)
                .catch(error => {
                    modulePromise = null;
                    throw error;
                });
        }
        return modulePromise;
    };

    return {
        ensureReady(progress) {
            if (!readyPromise) {
                readyPromise = getModule()
                    .then(async modelModule => {
                        if (typeof modelModule?.preload !== 'function') {
                            throw new TypeError('The background-removal module does not provide preload()');
                        }
                        await modelModule.preload({ ...baseConfig, progress });
                        ready = true;
                        return modelModule;
                    })
                    .catch(error => {
                        ready = false;
                        readyPromise = null;
                        throw error;
                    });
            }
            return readyPromise;
        },
        isReady() {
            return ready;
        }
    };
}
