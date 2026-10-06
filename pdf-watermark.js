import {
    validateWatermarkOptions,
    watermarkPageGeometry,
    watermarkOverlayPlacement,
    drawWatermarkOverlay
} from './pdf-watermark-core.js';
import {
    pointOnPage,
    makeRedactionRect,
    drawRedactions,
    chooseRedactionRasterSize
} from './pdf-redaction-core.js';
import {
    calculateFittedCanvasSize,
    constrainCanvasPan,
    zoomCanvasView
} from './canvas-view-core.js';

const byId = id => document.getElementById(id);
const input = byId('file-watermark');
const controls = byId('ctrl-watermark');
const settings = byId('watermark-settings');
const button = byId('do-watermark');
const canvas = byId('watermark-preview');
const previous = byId('watermark-prev');
const next = byId('watermark-next');
const stage = byId('watermark-preview-stage');
const zoomOut = byId('watermark-zoom-out');
const zoomIn = byId('watermark-zoom-in');
const zoomValue = byId('watermark-zoom-value');
const fitButton = byId('watermark-fit');

let file = null;
let sourceBytes = null;
let sourceDocument = null;
let previewDocument = null;
let loadingTask = null;
let renderTask = null;
let rasterCache = null;
let previewPage = 1;
let previewRevision = 0;
let previewTimer = null;
let busy = false;
let exporting = false;
let progress = null;
const redactions = new Map();
let previewBase = null;
let draft = null;
let paintFrame = null;
let resultUrl = null;
let view = { zoom: 1, panX: 0, panY: 0 };
let fittedView = { width: 0, height: 0, scale: 0 };
let panGesture = null;

function t(key, params = {}) {
    return window.YYYTools.t(key, params);
}

function reportError(key, params = {}) {
    window.YYYTools.notify(t(key, params), 'error');
}

function clearResult() {
    if (resultUrl) URL.revokeObjectURL(resultUrl);
    resultUrl = null;
    byId('watermark-download-result').classList.add('hidden');
    byId('watermark-result-link').removeAttribute('href');
}

function downloadResult(bytes, filename) {
    clearResult();
    const blob = new Blob([bytes], { type: 'application/pdf' });
    resultUrl = URL.createObjectURL(blob);
    const link = byId('watermark-result-link');
    link.href = resultUrl;
    link.download = filename;
    byId('watermark-download-result').classList.remove('hidden');
    window.saveAs(blob, filename);
}

function pageCount() {
    return sourceDocument?.getPageCount() || 0;
}

function readSettings() {
    return validateWatermarkOptions({
        text: byId('watermark-text').value,
        font: byId('watermark-font').value,
        fontSize: byId('watermark-size').value,
        color: byId('watermark-color').value,
        opacity: Number(byId('watermark-opacity').value) / 100,
        angle: byId('watermark-angle').value,
        layout: byId('watermark-layout').value,
        position: byId('watermark-position').value,
        spacing: byId('watermark-spacing').value,
        pageMode: byId('watermark-page-mode').value,
        pageRange: byId('watermark-page-range').value
    }, pageCount());
}

function validationMessage(validation) {
    return validation.valid ? '' : t(`err_watermark_${validation.error}`, { total: pageCount() });
}

function currentMarks() {
    return redactions.get(previewPage) || [];
}

function totalMarks() {
    let count = 0;
    for (const marks of redactions.values()) count += marks.length;
    return count;
}

function redactionTool() {
    return document.querySelector('input[name="watermark-redact-tool"]:checked')?.value || 'view';
}

function stageSize() {
    const bounds = stage.getBoundingClientRect();
    return {
        width: Math.max(1, stage.clientWidth || bounds.width || 800),
        height: Math.max(1, stage.clientHeight || bounds.height || 600)
    };
}

function applyPreviewView() {
    const ready = !!sourceDocument && !!previewBase;
    zoomValue.textContent = `${Math.round(view.zoom * 100)}%`;
    zoomOut.disabled = busy || !ready || view.zoom <= 0.5;
    zoomIn.disabled = busy || !ready || view.zoom >= 8;
    fitButton.disabled = busy || !ready;
    if (!sourceDocument) return;
    const geometry = watermarkPageGeometry(sourceDocument.getPage(previewPage - 1));
    const size = stageSize();
    fittedView = calculateFittedCanvasSize(geometry.displayWidth, geometry.displayHeight,
        size.width, size.height, 12, true);
    const pan = constrainCanvasPan(view.panX, view.panY, fittedView.width, fittedView.height,
        view.zoom, size.width, size.height);
    view.panX = pan.x;
    view.panY = pan.y;
    canvas.style.width = `${fittedView.width * view.zoom}px`;
    canvas.style.height = `${fittedView.height * view.zoom}px`;
    canvas.style.transform = `translate(-50%, -50%) translate(${view.panX}px, ${view.panY}px)`;
}

function resetPreviewView() {
    cancelPan();
    view = { zoom: 1, panX: 0, panY: 0 };
    applyPreviewView();
}

function changeZoom(nextZoom, anchorX = 0, anchorY = 0) {
    if (busy || !sourceDocument || draft) return;
    const zoom = Math.min(8, Math.max(0.5, nextZoom));
    if (!Number.isFinite(zoom) || zoom === view.zoom) return;
    view = zoomCanvasView(view, zoom, anchorX, anchorY);
    applyPreviewView();
    schedulePreview(80);
}

function refreshRedactionControls() {
    const tool = redactionTool();
    canvas.dataset.redactTool = tool;
    stage.dataset.redactTool = tool;
    byId('watermark-redact-size-field').classList.toggle('hidden', tool !== 'brush');
    byId('watermark-redact-size-value').textContent = t('watermark_redact_size_value', {
        size: byId('watermark-redact-size').value
    });
    byId('watermark-redaction-tools').disabled = busy;
    byId('watermark-redact-undo').disabled = busy || currentMarks().length === 0;
    byId('watermark-redact-clear').disabled = busy || currentMarks().length === 0;
    byId('watermark-redact-summary').textContent = t('watermark_redact_summary', {
        current: currentMarks().length, total: totalMarks()
    });
    canvas.setAttribute('aria-label', t(tool === 'view'
        ? 'watermark_preview_canvas_label' : 'watermark_redact_canvas_label', {
        tool: t(tool === 'rect' ? 'watermark_redact_rect' : 'watermark_redact_brush')
    }));
}

function refreshControls() {
    byId('watermark-size-value').textContent = `${byId('watermark-size').value} pt`;
    byId('watermark-opacity-value').textContent = `${byId('watermark-opacity').value}%`;
    byId('watermark-angle-value').textContent = `${byId('watermark-angle').value}°`;
    byId('watermark-spacing-value').textContent = `${byId('watermark-spacing').value} pt`;
    const repeat = byId('watermark-layout').value === 'repeat';
    byId('watermark-position-field').classList.toggle('hidden', repeat);
    byId('watermark-spacing-field').classList.toggle('hidden', !repeat);
    byId('watermark-page-range-field').classList.toggle('hidden', byId('watermark-page-mode').value !== 'custom');

    const validation = sourceDocument ? readSettings() : null;
    byId('watermark-validation').textContent = validation ? validationMessage(validation) : '';
    byId('watermark-text').setAttribute('aria-invalid', String(validation?.error === 'text'));
    byId('watermark-page-range').setAttribute('aria-invalid', String(validation?.error === 'pages'));
    button.disabled = busy || !file || !validation?.valid || !!draft;
    button.textContent = t(exporting ? 'processing'
        : (totalMarks() ? 'btn_watermark_redacted_dl' : 'btn_watermark_dl'));
    previous.disabled = busy || !file || previewPage <= 1;
    next.disabled = busy || !file || previewPage >= pageCount();
    if (sourceDocument) {
        byId('watermark-page-count').textContent = t('watermark_page_count', { count: pageCount() });
        byId('watermark-preview-page').textContent = t('watermark_preview_page', {
            current: previewPage, total: pageCount()
        });
    }
    if (progress) byId('prog-watermark').textContent = t(progress.key, progress);
    refreshRedactionControls();
    applyPreviewView();
    return validation;
}

function setBusy(value) {
    if (value) cancelPan();
    busy = value;
    input.disabled = value;
    settings.disabled = value;
    byId('drop-watermark').setAttribute('aria-disabled', String(value));
    controls.setAttribute('aria-busy', String(value));
    refreshControls();
}

function schedulePreview(delay = 120) {
    cancelPan();
    cancelDraft();
    // Invalidate a pending render immediately when its settings or page change.
    previewRevision += 1;
    window.clearTimeout(previewTimer);
    previewTimer = window.setTimeout(renderPreview, delay);
}

async function pageRaster(document, pageNumber, revision) {
    const page = await document.getPage(pageNumber);
    // A zoom or navigation change can overtake PDF.js while it retrieves a page.
    // Discard that request before it touches the latest raster or render task.
    if (revision !== previewRevision || document !== previewDocument || pageNumber !== previewPage) {
        throw new Error('Obsolete preview');
    }
    const natural = page.getViewport({ scale: 1 });
    const density = Math.max(1, Number(window.devicePixelRatio) || 1);
    const requestedScale = Math.max(0.01,
        fittedView.width * view.zoom * density / natural.width,
        fittedView.height * view.zoom * density / natural.height);
    const dimensions = chooseRedactionRasterSize(natural.width, natural.height, requestedScale);
    if (rasterCache?.document === document && rasterCache.pageNumber === pageNumber &&
        rasterCache.width >= dimensions.width && rasterCache.height >= dimensions.height) {
        return rasterCache.promise;
    }
    renderTask?.cancel();
    const entry = { document, pageNumber, width: dimensions.width, height: dimensions.height, promise: null };
    rasterCache = entry;
    entry.promise = (async () => {
        if (rasterCache !== entry) throw new Error('Obsolete preview');
        const raster = window.document.createElement('canvas');
        raster.width = dimensions.width;
        raster.height = dimensions.height;
        const task = page.render({ canvasContext: raster.getContext('2d'), viewport: natural,
            transform: [raster.width / natural.width, 0, 0, raster.height / natural.height, 0, 0] });
        renderTask = task;
        try {
            await task.promise;
            return raster;
        } finally {
            if (renderTask === task) renderTask = null;
            page.cleanup();
        }
    })();
    return entry.promise;
}

async function renderPreview() {
    if (!previewDocument || !sourceDocument) return;
    const revision = ++previewRevision;
    const document = previewDocument;
    const pageNumber = previewPage;
    const validation = refreshControls();
    const status = byId('watermark-preview-status');
    byId('watermark-preview-stage').setAttribute('aria-busy', 'true');
    status.textContent = t('watermark_preview_loading');
    if (!previewBase || previewBase.pageNumber !== pageNumber) canvas.classList.add('hidden');
    try {
        const raster = await pageRaster(document, pageNumber, revision);
        if (revision !== previewRevision || document !== previewDocument) return;
        const base = window.document.createElement('canvas');
        base.width = raster.width;
        base.height = raster.height;
        const context = base.getContext('2d');
        context.drawImage(raster, 0, 0);
        const geometry = watermarkPageGeometry(sourceDocument.getPage(pageNumber - 1));
        const selected = validation.valid && validation.pageIndices.includes(pageNumber - 1);
        if (selected) {
            const overlay = window.document.createElement('canvas');
            drawWatermarkOverlay(overlay, geometry.displayWidth, geometry.displayHeight, validation.options);
            context.drawImage(overlay, 0, 0, base.width, base.height);
            overlay.width = overlay.height = 0;
        }
        if (previewBase) previewBase.canvas.width = previewBase.canvas.height = 0;
        previewBase = { canvas: base, geometry, pageNumber, revision };
        composePreview();
        canvas.classList.remove('hidden');
        status.textContent = !validation.valid
            ? validationMessage(validation)
            : (selected ? '' : t('watermark_preview_unmarked'));
    } catch (error) {
        if (revision !== previewRevision || document !== previewDocument) return;
        rasterCache = null;
        status.textContent = t('watermark_preview_failed');
    } finally {
        if (revision === previewRevision) {
            byId('watermark-preview-stage').setAttribute('aria-busy', 'false');
        }
    }
}

async function clearDocument() {
    clearResult();
    cancelDraft();
    redactions.clear();
    if (previewBase) previewBase.canvas.width = previewBase.canvas.height = 0;
    previewBase = null;
    previewRevision += 1;
    window.clearTimeout(previewTimer);
    renderTask?.cancel();
    renderTask = null;
    rasterCache = null;
    const previousLoading = loadingTask;
    loadingTask = null;
    previewDocument = null;
    file = sourceBytes = sourceDocument = null;
    previewPage = 1;
    resetPreviewView();
    progress = null;
    canvas.width = canvas.height = 0;
    canvas.classList.add('hidden');
    controls.classList.add('hidden');
    byId('prog-watermark').classList.add('hidden');
    byId('watermark-preview-status').textContent = '';
    byId('watermark-preview-stage').setAttribute('aria-busy', 'false');
    if (previousLoading) await previousLoading.destroy().catch(() => {});
}

input.addEventListener('change', async event => {
    const nextFile = event.target.files[0];
    if (!nextFile || busy) return;
    setBusy(true);
    try {
        await clearDocument();
        const bytes = new Uint8Array(await nextFile.arrayBuffer());
        // PDF.js transfers its buffer to a worker; retain an independent source.
        const pdf = await window.PDFLib.PDFDocument.load(bytes);
        if (!pdf.getPageCount()) throw new Error('PDF contains no pages');
        loadingTask = window.pdfjsLib.getDocument({ data: bytes.slice() });
        const preview = await loadingTask.promise;
        file = nextFile;
        sourceBytes = bytes;
        sourceDocument = pdf;
        previewDocument = preview;
        resetPreviewView();
        byId('name-watermark').textContent = file.name;
        controls.classList.remove('hidden');
        schedulePreview(0);
    } catch (error) {
        await clearDocument();
        const encrypted = /encrypt|password/i.test(`${error?.name} ${error?.message}`);
        reportError(encrypted ? 'err_watermark_encrypted' : 'err_watermark_load');
    } finally {
        // Permit choosing the same file again, including after an invalid file.
        input.value = '';
        setBusy(false);
    }
});

function draftMark() {
    if (!draft) return null;
    if (draft.tool === 'brush') return draft.mark;
    return makeRedactionRect(draft.start, draft.end,
        previewBase.geometry.displayWidth, previewBase.geometry.displayHeight);
}

function composePreview() {
    if (!previewBase || previewBase.pageNumber !== previewPage) return;
    const base = previewBase.canvas;
    if (canvas.width !== base.width || canvas.height !== base.height) {
        canvas.width = base.width;
        canvas.height = base.height;
    }
    const context = canvas.getContext('2d');
    context.setTransform(1, 0, 0, 1, 0, 0);
    context.globalAlpha = 1;
    context.globalCompositeOperation = 'source-over';
    context.clearRect(0, 0, canvas.width, canvas.height);
    context.drawImage(base, 0, 0);
    const mark = draftMark();
    drawRedactions(canvas, mark ? [...currentMarks(), mark] : currentMarks(),
        previewBase.geometry.displayWidth, previewBase.geometry.displayHeight);
    applyPreviewView();
}

function queuePaint() {
    if (paintFrame !== null) return;
    paintFrame = window.requestAnimationFrame(() => {
        paintFrame = null;
        composePreview();
    });
}

function cancelDraft() {
    if (paintFrame !== null) window.cancelAnimationFrame(paintFrame);
    paintFrame = null;
    if (!draft) return;
    const pointerId = draft.pointerId;
    draft = null;
    if (canvas.hasPointerCapture(pointerId)) canvas.releasePointerCapture(pointerId);
    composePreview();
    refreshControls();
}

function eventPoint(event) {
    if (!previewBase) return null;
    return pointOnPage(event.clientX, event.clientY, canvas.getBoundingClientRect(),
        previewBase.geometry.displayWidth, previewBase.geometry.displayHeight);
}

canvas.addEventListener('pointerdown', event => {
    if (busy || draft || redactionTool() === 'view' || event.button !== 0 || !event.isPrimary) return;
    if (!previewBase || previewBase.pageNumber !== previewPage
        || previewBase.revision !== previewRevision || canvas.classList.contains('hidden')) {
        byId('watermark-preview-status').textContent = t('watermark_redact_preview_required');
        return;
    }
    const point = eventPoint(event);
    if (!point) return;
    clearResult();
    event.preventDefault();
    canvas.focus({ preventScroll: true });
    const tool = redactionTool();
    draft = { pointerId: event.pointerId, tool, pageNumber: previewPage,
        start: point, end: point,
        mark: { type: 'brush', size: Number(byId('watermark-redact-size').value), points: [point] }
    };
    canvas.setPointerCapture(event.pointerId);
    refreshControls();
    queuePaint();
});

function extendDraft(event) {
    const point = eventPoint(event);
    if (!point || !draft) return;
    draft.end = point;
    if (draft.tool === 'brush') {
        const last = draft.mark.points.at(-1);
        if (Math.hypot(point.x - last.x, point.y - last.y) >= 0.25) draft.mark.points.push(point);
    }
}

canvas.addEventListener('pointermove', event => {
    if (!draft || draft.pointerId !== event.pointerId) return;
    event.preventDefault();
    for (const sample of event.getCoalescedEvents?.() || [event]) extendDraft(sample);
    extendDraft(event);
    queuePaint();
});

canvas.addEventListener('pointerup', event => {
    if (!draft || draft.pointerId !== event.pointerId) return;
    event.preventDefault();
    extendDraft(event);
    const mark = draftMark();
    const pageNumber = draft.pageNumber;
    draft = null;
    if (mark) redactions.set(pageNumber, [...(redactions.get(pageNumber) || []), mark]);
    if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId);
    composePreview();
    refreshControls();
});
canvas.addEventListener('pointercancel', cancelDraft);
canvas.addEventListener('lostpointercapture', cancelDraft);
canvas.addEventListener('keydown', event => {
    if (event.key === 'Escape' && draft) {
        event.preventDefault();
        cancelDraft();
    }
});

byId('watermark-redaction-tools').addEventListener('input', () => {
    cancelPan();
    cancelDraft();
    refreshControls();
});
byId('watermark-redaction-tools').addEventListener('change', () => {
    cancelPan();
    cancelDraft();
    refreshControls();
});
byId('watermark-redact-undo').addEventListener('click', () => {
    if (busy) return;
    clearResult();
    cancelDraft();
    const marks = currentMarks().slice(0, -1);
    if (marks.length) redactions.set(previewPage, marks);
    else redactions.delete(previewPage);
    composePreview();
    refreshControls();
});
byId('watermark-redact-clear').addEventListener('click', () => {
    if (busy) return;
    clearResult();
    cancelDraft();
    redactions.delete(previewPage);
    composePreview();
    refreshControls();
});

settings.addEventListener('input', () => {
    clearResult();
    refreshControls();
    schedulePreview();
});
settings.addEventListener('change', () => {
    clearResult();
    refreshControls();
    schedulePreview();
});

previous.addEventListener('click', () => {
    if (busy || previewPage <= 1) return;
    previewPage -= 1;
    resetPreviewView();
    refreshControls();
    schedulePreview(0);
});
next.addEventListener('click', () => {
    if (busy || previewPage >= pageCount()) return;
    previewPage += 1;
    resetPreviewView();
    refreshControls();
    schedulePreview(0);
});

zoomOut.addEventListener('click', () => changeZoom(view.zoom - 0.25));
zoomIn.addEventListener('click', () => changeZoom(view.zoom + 0.25));
fitButton.addEventListener('click', () => {
    if (busy || !sourceDocument) return;
    cancelDraft();
    resetPreviewView();
    schedulePreview(0);
});

function cancelPan() {
    const pointerId = panGesture?.pointerId;
    panGesture = null;
    stage.dataset.panning = 'false';
    if (pointerId !== undefined && stage.hasPointerCapture(pointerId)) stage.releasePointerCapture(pointerId);
}

function extendPan(event) {
    if (!panGesture || panGesture.pointerId !== event.pointerId) return;
    view.panX = panGesture.panX + event.clientX - panGesture.startX;
    view.panY = panGesture.panY + event.clientY - panGesture.startY;
    applyPreviewView();
}

stage.addEventListener('pointerdown', event => {
    if (busy || panGesture || draft || redactionTool() !== 'view' || event.button !== 0 || !event.isPrimary) return;
    if (!previewBase || canvas.classList.contains('hidden')) return;
    if (!Number.isFinite(event.clientX) || !Number.isFinite(event.clientY)) return;
    event.preventDefault();
    panGesture = { pointerId: event.pointerId, startX: event.clientX, startY: event.clientY,
        panX: view.panX, panY: view.panY };
    stage.dataset.panning = 'true';
    stage.setPointerCapture(event.pointerId);
});
stage.addEventListener('pointermove', event => {
    if (!panGesture || panGesture.pointerId !== event.pointerId) return;
    event.preventDefault();
    extendPan(event);
});
stage.addEventListener('pointerup', event => {
    if (!panGesture || panGesture.pointerId !== event.pointerId) return;
    event.preventDefault();
    extendPan(event);
    cancelPan();
});
stage.addEventListener('pointercancel', cancelPan);
stage.addEventListener('lostpointercapture', cancelPan);
stage.addEventListener('wheel', event => {
    if ((!event.ctrlKey && !event.metaKey) || busy || draft || !previewBase) return;
    if (!Number.isFinite(event.deltaY) || !Number.isFinite(event.clientX) || !Number.isFinite(event.clientY)) return;
    event.preventDefault();
    const bounds = stage.getBoundingClientRect();
    changeZoom(view.zoom * Math.exp(-Math.max(-200, Math.min(200, event.deltaY)) * 0.002),
        event.clientX - bounds.left - bounds.width / 2,
        event.clientY - bounds.top - bounds.height / 2);
}, { passive: false });

function refreshViewportSize() {
    if (!sourceDocument) return;
    applyPreviewView();
    schedulePreview(80);
}

if (typeof ResizeObserver === 'function') {
    const observer = new ResizeObserver(refreshViewportSize);
    observer.observe(stage);
}
window.addEventListener('resize', refreshViewportSize);

function pngBytes(overlay) {
    return new Promise((resolve, reject) => {
        overlay.toBlob(async blob => {
            try {
                if (!blob) throw new Error('Unable to create watermark image');
                resolve(new Uint8Array(await blob.arrayBuffer()));
            } catch (error) {
                reject(error);
            }
        }, 'image/png');
    });
}

async function exportRedactedPdf(validation) {
    // Build a new document containing only rendered pixels. Copying source pages
    // would retain the sensitive text, annotations, attachments or hidden content.
    const pdf = await window.PDFLib.PDFDocument.create();
    // Use a separate PDF.js document so preview cleanup/cancellation cannot
    // interrupt an export render and produce a partially drawn page.
    const loading = window.pdfjsLib.getDocument({ data: sourceBytes.slice() });
    try {
        const exportDocument = await loading.promise;
        const watermarkedPages = new Set(validation.pageIndices);
        for (let pageNumber = 1; pageNumber <= pageCount(); pageNumber += 1) {
            const page = await exportDocument.getPage(pageNumber);
            const viewport = page.getViewport({ scale: 1 });
            // PDF.js 3.x exposes UserUnit separately from viewport coordinates.
            const userUnit = Number.isFinite(page.userUnit) && page.userUnit > 0 ? page.userUnit : 1;
            const dimensions = chooseRedactionRasterSize(viewport.width * userUnit, viewport.height * userUnit);
            const raster = window.document.createElement('canvas');
            raster.width = dimensions.width;
            raster.height = dimensions.height;
            const geometry = watermarkPageGeometry(sourceDocument.getPage(pageNumber - 1));
            try {
                await page.render({
                    canvasContext: raster.getContext('2d'), viewport,
                    transform: [raster.width / viewport.width, 0, 0, raster.height / viewport.height, 0, 0],
                    background: 'rgb(255, 255, 255)'
                }).promise;
                if (watermarkedPages.has(pageNumber - 1)) {
                    const overlay = window.document.createElement('canvas');
                    drawWatermarkOverlay(overlay, geometry.displayWidth, geometry.displayHeight, validation.options);
                    const context = raster.getContext('2d');
                    context.save();
                    context.setTransform(1, 0, 0, 1, 0, 0);
                    context.globalAlpha = 1;
                    context.drawImage(overlay, 0, 0, raster.width, raster.height);
                    context.restore();
                    overlay.width = overlay.height = 0;
                }
                // Masks are applied last and at full opacity, including on pages
                // excluded from the watermark's selected-page range.
                drawRedactions(raster, redactions.get(pageNumber) || [],
                    geometry.displayWidth, geometry.displayHeight);
                const image = await pdf.embedPng(await pngBytes(raster));
                const width = geometry.displayWidth * userUnit;
                const height = geometry.displayHeight * userUnit;
                const outputPage = pdf.addPage([width, height]);
                outputPage.drawImage(image, { x: 0, y: 0, width, height });
            } finally {
                raster.width = raster.height = 0;
                page.cleanup();
            }
            progress.current = pageNumber;
            byId('prog-watermark').textContent = t(progress.key, progress);
            await new Promise(resolve => window.setTimeout(resolve, 0));
        }
        return await pdf.save({ updateFieldAppearances: false });
    } finally {
        await loading.destroy().catch(() => {});
    }
}

button.addEventListener('click', async () => {
    if (busy || !file || !sourceBytes) return;
    const validation = readSettings();
    if (!validation.valid) {
        reportError(`err_watermark_${validation.error}`, { total: pageCount() });
        return;
    }
    cancelDraft();
    const redacted = totalMarks() > 0;
    clearResult();
    exporting = true;
    progress = { current: 0, total: redacted ? pageCount() : validation.pageIndices.length,
        key: redacted ? 'watermark_redact_processing' : 'watermark_processing' };
    setBusy(true);
    byId('prog-watermark').classList.remove('hidden');
    try {
        await window.document.fonts?.ready;
        if (redacted) {
            const bytes = await exportRedactedPdf(validation);
            downloadResult(bytes,
                `${window.YYYTools.safeBaseName(file)}_watermarked_redacted.pdf`);
            window.YYYTools.notify(t('status_done'), 'success');
            return;
        }
        // Reload the original for every export so repeated downloads never stack stamps.
        const pdf = await window.PDFLib.PDFDocument.load(sourceBytes);
        const images = new Map();
        for (const pageIndex of validation.pageIndices) {
            const page = pdf.getPage(pageIndex);
            const geometry = watermarkPageGeometry(page);
            const key = `${geometry.displayWidth},${geometry.displayHeight}`;
            let image = images.get(key);
            if (!image) {
                const overlay = window.document.createElement('canvas');
                drawWatermarkOverlay(overlay, geometry.displayWidth, geometry.displayHeight, validation.options);
                try {
                    image = await pdf.embedPng(await pngBytes(overlay));
                    images.set(key, image);
                } finally {
                    overlay.width = overlay.height = 0;
                }
            }
            const placement = watermarkOverlayPlacement(geometry);
            page.drawImage(image, {
                x: placement.x, y: placement.y,
                width: placement.width, height: placement.height,
                rotate: window.PDFLib.degrees(placement.angle)
            });
            progress.current += 1;
            byId('prog-watermark').textContent = t(progress.key, progress);
            await new Promise(resolve => window.setTimeout(resolve, 0));
        }
        const bytes = await pdf.save({ updateFieldAppearances: false });
        downloadResult(bytes,
            `${window.YYYTools.safeBaseName(file)}_watermarked.pdf`);
        window.YYYTools.notify(t('status_done'), 'success');
    } catch (error) {
        const message = String(error?.message || error).slice(0, 200);
        reportError(redacted ? 'err_watermark_redact_render' : 'err_watermark_failed', { message });
    } finally {
        exporting = false;
        progress = null;
        byId('prog-watermark').classList.add('hidden');
        setBusy(false);
    }
});

window.addEventListener('yyy:languagechange', () => {
    refreshControls();
    schedulePreview(0);
});

refreshControls();
