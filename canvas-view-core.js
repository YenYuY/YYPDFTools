const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

/** Images fit without enlarging their pixels; vector pages may opt into upscaling. */
export function calculateFittedCanvasSize(imageWidth, imageHeight, stageWidth, stageHeight, padding = 0, allowUpscale = false) {
    const width = Math.max(0, Number(imageWidth) || 0);
    const height = Math.max(0, Number(imageHeight) || 0);
    const inset = Math.max(0, Number(padding) || 0) * 2;
    const availableWidth = Math.max(0, (Number(stageWidth) || 0) - inset);
    const availableHeight = Math.max(0, (Number(stageHeight) || 0) - inset);
    if (!width || !height || !availableWidth || !availableHeight) return { width: 0, height: 0, scale: 0 };
    const scale = Math.min(allowUpscale ? Infinity : 1, availableWidth / width, availableHeight / height);
    return { width: width * scale, height: height * scale, scale };
}

/** Keep a recoverable part of a zoomed canvas inside its centered viewport. */
export function constrainCanvasPan(panX, panY, canvasWidth, canvasHeight, zoom, stageWidth, stageHeight, minimumVisible = 48) {
    const scaledWidth = Math.max(0, Number(canvasWidth) || 0) * Math.max(0, Number(zoom) || 0);
    const scaledHeight = Math.max(0, Number(canvasHeight) || 0) * Math.max(0, Number(zoom) || 0);
    const visible = Math.max(0, Number(minimumVisible) || 0);
    const constrainAxis = (value, scaledSize, stageSize) => {
        if (scaledSize <= stageSize) return 0;
        const limit = Math.max(0, (stageSize + scaledSize) / 2 - Math.min(visible, stageSize));
        return clamp(Number(value) || 0, -limit, limit);
    };
    return {
        x: constrainAxis(panX, scaledWidth, Math.max(0, Number(stageWidth) || 0)),
        y: constrainAxis(panY, scaledHeight, Math.max(0, Number(stageHeight) || 0))
    };
}

/** Anchor coordinates are CSS pixels relative to the viewport's center. */
export function zoomCanvasView({ zoom, panX, panY }, nextZoom, anchorX = 0, anchorY = 0) {
    const ratio = nextZoom / zoom;
    return {
        zoom: nextZoom,
        panX: anchorX - (anchorX - panX) * ratio,
        panY: anchorY - (anchorY - panY) * ratio
    };
}
