export const WATERMARK_DEFAULTS = Object.freeze({
    text: 'CONFIDENTIAL',
    font: 'sans',
    fontSize: 48,
    color: '#64748b',
    opacity: 0.2,
    angle: -35,
    layout: 'single',
    position: 'center',
    spacing: 80,
    pageMode: 'all',
    pageRange: ''
});

export function validateWatermarkOptions(raw = {}, totalPages) {
    if (!Number.isSafeInteger(totalPages) || totalPages < 1) return { valid: false, error: 'pages' };
    const options = Object.fromEntries(Object.entries(WATERMARK_DEFAULTS).map(([key, fallback]) => [key, raw?.[key] === undefined ? fallback : raw[key]]));
    if (typeof options.text !== 'string' || !options.text.trim() || Array.from(options.text.trim()).length > 120) {
        return { valid: false, error: 'text' };
    }
    options.text = options.text.trim();
    const limits = { fontSize: [10, 144], opacity: [0.05, 1], angle: [-180, 180], spacing: [0, 240] };
    for (const [key, [min, max]] of Object.entries(limits)) {
        const rawValue = options[key];
        if (!['string', 'number'].includes(typeof rawValue) || (typeof rawValue === 'string' && !rawValue.trim())) {
            return { valid: false, error: key };
        }
        const value = Number(rawValue);
        if (!Number.isFinite(value) || value < min || value > max) return { valid: false, error: key };
        options[key] = value;
    }
    const choices = {
        font: ['sans', 'serif', 'mono'],
        layout: ['single', 'repeat'],
        position: ['center', 'top-left', 'top-right', 'bottom-left', 'bottom-right']
    };
    for (const [key, allowed] of Object.entries(choices)) {
        if (!allowed.includes(options[key])) return { valid: false, error: key };
    }
    if (typeof options.color !== 'string' || !/^#[0-9a-f]{6}$/i.test(options.color)) return { valid: false, error: 'color' };
    if (!['all', 'custom'].includes(options.pageMode)) return { valid: false, error: 'pages' };
    if (options.pageMode === 'custom') {
        if (typeof options.pageRange !== 'string' || !options.pageRange.trim()) return { valid: false, error: 'pages' };
        options.pageRange = options.pageRange.trim();
        const pages = new Set();
        for (const segment of options.pageRange.split(',')) {
            const match = /^\s*(\d+)\s*(?:-\s*(\d+)\s*)?$/.exec(segment);
            if (!match) return { valid: false, error: 'pages' };
            const start = Number(match[1]);
            const end = Number(match[2] || match[1]);
            if (start < 1 || end > totalPages || start > end) return { valid: false, error: 'pages' };
            for (let page = start; page <= end; page += 1) pages.add(page - 1);
        }
        return { valid: true, options, pageIndices: [...pages].sort((first, second) => first - second) };
    }
    return { valid: true, options, pageIndices: Array.from({ length: totalPages }, (_, index) => index) };
}

/** Dimensions use PDF points; display dimensions follow the page's visible orientation. */
export function watermarkPageGeometry(page) {
    let crop = page.getCropBox();
    if (typeof page.getMediaBox === 'function') {
        const media = page.getMediaBox();
        const x = Math.max(crop.x, media.x);
        const y = Math.max(crop.y, media.y);
        const right = Math.min(crop.x + crop.width, media.x + media.width);
        const top = Math.min(crop.y + crop.height, media.y + media.height);
        crop = right > x && top > y ? { x, y, width: right - x, height: top - y } : media;
    }
    const rawRotation = page.getRotation().angle;
    const rotation = Number.isFinite(rawRotation) && rawRotation % 90 === 0 ? ((rawRotation % 360) + 360) % 360 : 0;
    return {
        ...crop, rotation,
        displayWidth: rotation % 180 ? crop.height : crop.width,
        displayHeight: rotation % 180 ? crop.width : crop.height
    };
}

/** PDF drawImage rotates counterclockwise; rotate the overlay with the page to keep its viewed orientation. */
export function watermarkOverlayPlacement(geometry) {
    const { x, y, width, height, rotation, displayWidth, displayHeight } = geometry;
    const origins = {
        0: [x, y],
        90: [x + width, y],
        180: [x + width, y + height],
        270: [x, y + height]
    };
    const [originX, originY] = origins[rotation];
    return { x: originX, y: originY, width: displayWidth, height: displayHeight, angle: rotation };
}

const WATERMARK_FONTS = {
    sans: '"Noto Sans TC", "PingFang TC", "Microsoft JhengHei", Arial, sans-serif',
    serif: '"Noto Serif TC", "Songti TC", PMingLiU, Georgia, serif',
    mono: '"SFMono-Regular", Consolas, "Noto Sans Mono", "Noto Sans TC", monospace'
};

/** Paint only watermark pixels so embedding preserves the original PDF content. */
export function drawWatermarkOverlay(canvas, width, height, options) {
    if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) throw new Error('Invalid page dimensions');
    const rasterScale = Math.min(2, 4096 / width, 4096 / height, Math.sqrt(8000000 / width / height));
    canvas.width = Math.max(1, Math.floor(width * rasterScale));
    canvas.height = Math.max(1, Math.floor(height * rasterScale));
    const context = canvas.getContext('2d');
    context.setTransform(canvas.width / width, 0, 0, canvas.height / height, 0, 0);
    context.clearRect(0, 0, width, height);
    context.font = `${options.fontSize}px ${WATERMARK_FONTS[options.font]}`;
    context.fillStyle = options.color;
    context.globalAlpha = options.opacity;
    context.textAlign = 'center';
    context.textBaseline = 'middle';
    const measured = context.measureText(options.text);
    const layout = watermarkLayout(width, height, options, {
        width: Math.max(measured.width, Math.abs(measured.actualBoundingBoxLeft || 0) * 2, Math.abs(measured.actualBoundingBoxRight || 0) * 2),
        height: Math.max(options.fontSize * 1.2, Math.abs(measured.actualBoundingBoxAscent || 0) * 2, Math.abs(measured.actualBoundingBoxDescent || 0) * 2)
    });
    context.font = `${options.fontSize * layout.fontScale}px ${WATERMARK_FONTS[options.font]}`;
    for (const mark of layout.marks) {
        context.save();
        context.translate(mark.x, mark.y);
        context.rotate(options.angle * Math.PI / 180);
        context.fillText(options.text, 0, 0);
        context.restore();
    }
    return canvas;
}

/** Pure layout in viewed-page coordinates, shared by preview and PDF output. */
export function watermarkLayout(width, height, options, metrics) {
    const margin = Math.min(24, width * 0.08, height * 0.08);
    const innerWidth = width - margin * 2;
    const innerHeight = height - margin * 2;
    const radians = options.angle * Math.PI / 180;
    const cosine = Math.abs(Math.cos(radians));
    const sine = Math.abs(Math.sin(radians));
    const rotatedWidth = cosine * metrics.width + sine * metrics.height;
    const rotatedHeight = sine * metrics.width + cosine * metrics.height;
    const fontScale = Math.min(1, innerWidth / Math.max(1, rotatedWidth), innerHeight / Math.max(1, rotatedHeight));
    const boundsWidth = rotatedWidth * fontScale;
    const boundsHeight = rotatedHeight * fontScale;
    if (options.layout === 'repeat') {
        const textWidth = metrics.width * fontScale;
        const textHeight = metrics.height * fontScale;
        const signedCosine = Math.cos(radians);
        const signedSine = Math.sin(radians);
        // Project the page corners into the text's rotated axes. Include complete
        // tiles beyond these limits so clipping, rather than a margin, sets the edge.
        const halfWidth = cosine * width / 2 + sine * height / 2 + textWidth / 2;
        const halfHeight = sine * width / 2 + cosine * height / 2 + textHeight / 2;
        let stepX = Math.max(1, textWidth + options.spacing);
        let stepY = Math.max(1, textHeight + options.spacing);
        let columnRadius = Math.ceil(halfWidth / stepX);
        let rowRadius = Math.ceil(halfHeight / stepY);
        // Reduce density across both axes before drawing, retaining a complete,
        // centered grid even for oversized pages instead of truncating at 500.
        while ((columnRadius * 2 + 1) * (rowRadius * 2 + 1) > 500) {
            const densityScale = Math.max(1.05, Math.sqrt((columnRadius * 2 + 1) * (rowRadius * 2 + 1) / 500));
            stepX *= densityScale;
            stepY *= densityScale;
            columnRadius = Math.ceil(halfWidth / stepX);
            rowRadius = Math.ceil(halfHeight / stepY);
        }
        const marks = [];
        for (let row = -rowRadius; row <= rowRadius; row += 1) {
            for (let column = -columnRadius; column <= columnRadius; column += 1) {
                const x = column * stepX;
                const y = row * stepY;
                marks.push({
                    x: width / 2 + signedCosine * x - signedSine * y,
                    y: height / 2 + signedSine * x + signedCosine * y
                });
            }
        }
        return { margin, fontScale, boundsWidth, boundsHeight, marks };
    }
    let x = width / 2;
    let y = height / 2;
    if (options.position.includes('left')) x = margin + boundsWidth / 2;
    if (options.position.includes('right')) x = width - margin - boundsWidth / 2;
    if (options.position.includes('top')) y = margin + boundsHeight / 2;
    if (options.position.includes('bottom')) y = height - margin - boundsHeight / 2;
    return { margin, fontScale, boundsWidth, boundsHeight, marks: [{ x, y }] };
}
