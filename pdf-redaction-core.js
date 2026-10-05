/** Handwritten masks use the displayed page's top-left coordinate system. */
const clamp = (value, maximum) => Math.min(maximum, Math.max(0, value));
const validDimensions = (width, height) => Number.isFinite(width) && Number.isFinite(height) && width > 0 && height > 0;
const validPoint = point => point && Number.isFinite(point.x) && Number.isFinite(point.y);
const validPoints = points => {
    if (!Array.isArray(points) || points.length === 0) return false;
    for (const point of points) if (!validPoint(point)) return false;
    return true;
};

export function pointOnPage(clientX, clientY, rect, pageWidth, pageHeight) {
    if (!Number.isFinite(clientX) || !Number.isFinite(clientY) || !rect ||
        !Number.isFinite(rect.left) || !Number.isFinite(rect.top) ||
        !validDimensions(rect.width, rect.height) || !validDimensions(pageWidth, pageHeight)) return null;
    return {
        x: clamp((clientX - rect.left) / rect.width * pageWidth, pageWidth),
        y: clamp((clientY - rect.top) / rect.height * pageHeight, pageHeight)
    };
}

export function makeRedactionRect(start, end, pageWidth, pageHeight) {
    if (!validPoint(start) || !validPoint(end) || !validDimensions(pageWidth, pageHeight)) return null;
    const x = clamp(Math.min(start.x, end.x), pageWidth);
    const y = clamp(Math.min(start.y, end.y), pageHeight);
    const width = clamp(Math.max(start.x, end.x), pageWidth) - x;
    const height = clamp(Math.max(start.y, end.y), pageHeight) - y;
    return width >= 1 && height >= 1 ? { type: 'rect', x, y, width, height } : null;
}

/** Paint onto existing PDF pixels. Never clear or resize the canvas here. */
export function drawRedactions(canvas, marks, pageWidth, pageHeight) {
    if (!validDimensions(pageWidth, pageHeight) || !validDimensions(canvas?.width, canvas?.height) || !Array.isArray(marks)) return canvas;
    const context = canvas.getContext('2d');
    if (!context) return canvas;
    context.save();
    try {
        context.setTransform(canvas.width / pageWidth, 0, 0, canvas.height / pageHeight, 0, 0);
        context.globalAlpha = 1;
        context.globalCompositeOperation = 'source-over';
        context.fillStyle = '#000000';
        context.strokeStyle = '#000000';
        context.filter = 'none';
        context.shadowBlur = 0;
        context.shadowColor = 'transparent';
        context.shadowOffsetX = 0;
        context.shadowOffsetY = 0;
        context.lineCap = 'round';
        context.lineJoin = 'round';
        context.setLineDash([]);
        context.beginPath();
        context.rect(0, 0, pageWidth, pageHeight);
        context.clip();
        for (const mark of marks) {
            if (mark?.type === 'rect' && validPoint(mark) && validDimensions(mark.width, mark.height)) {
                const x = clamp(mark.x, pageWidth);
                const y = clamp(mark.y, pageHeight);
                const width = clamp(mark.x + mark.width, pageWidth) - x;
                const height = clamp(mark.y + mark.height, pageHeight) - y;
                if (width > 0 && height > 0) context.fillRect(x, y, width, height);
            } else if (mark?.type === 'brush' && Number.isFinite(mark.size) && mark.size > 0 &&
                validPoints(mark.points)) {
                context.lineWidth = mark.size;
                context.beginPath();
                const first = mark.points[0];
                if (mark.points.length === 1) {
                    context.arc(first.x, first.y, mark.size / 2, 0, Math.PI * 2);
                    context.fill();
                } else {
                    context.moveTo(first.x, first.y);
                    for (const point of mark.points.slice(1)) context.lineTo(point.x, point.y);
                    context.stroke();
                }
            }
        }
    } finally {
        context.restore();
    }
    return canvas;
}

/** Bound export memory while keeping ordinary pages near 144 DPI. */
export function chooseRedactionRasterSize(width, height, preferredScale = 2) {
    if (!validDimensions(width, height)) throw new Error('Invalid page dimensions');
    if (!Number.isFinite(preferredScale) || preferredScale <= 0) throw new Error('Invalid raster scale');
    const scale = Math.min(preferredScale, 4096 / width, 4096 / height, Math.sqrt(8000000) / Math.sqrt(width) / Math.sqrt(height));
    return {
        width: Math.max(1, Math.floor(width * scale)),
        height: Math.max(1, Math.floor(height * scale)),
        scale
    };
}
