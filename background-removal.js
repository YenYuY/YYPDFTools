import {
    backgroundRemovalDownloadName,
    canvasPointFromClient,
    clamp,
    isSupportedImageFile,
    progressPercent,
    strokeBounds,
    unionBounds
} from './background-removal-core.js';

const MODEL_MODULE_URL = 'https://cdn.jsdelivr.net/npm/@imgly/background-removal@1.7.0/+esm';
const MAX_HISTORY = 30;

const section = document.getElementById('sec-removebg');
const fileInput = document.getElementById('file-removebg');
const uploadPanel = document.getElementById('removebg-upload-panel');
const editor = document.getElementById('removebg-editor');
const canvas = document.getElementById('removebg-canvas');
const stage = document.getElementById('removebg-stage');
const statusEl = document.getElementById('removebg-status');
const progressBar = document.getElementById('removebg-progress-bar');
const progressTrack = document.getElementById('removebg-progress-track');
const autoButton = document.getElementById('removebg-auto');
const downloadButton = document.getElementById('removebg-download');
const compareButton = document.getElementById('removebg-compare');
const undoButton = document.getElementById('removebg-undo');
const redoButton = document.getElementById('removebg-redo');
const resetButton = document.getElementById('removebg-reset');
const newButton = document.getElementById('removebg-new');
const brushSize = document.getElementById('removebg-brush-size');
const brushValue = document.getElementById('removebg-brush-value');
const zoomValue = document.getElementById('removebg-zoom-value');
const zoomOutButton = document.getElementById('removebg-zoom-out');
const zoomInButton = document.getElementById('removebg-zoom-in');
const toolButtons = Array.from(document.querySelectorAll('[data-removebg-tool]'));

const context = canvas.getContext('2d', { willReadFrequently: true });
const originalCanvas = document.createElement('canvas');
const originalContext = originalCanvas.getContext('2d', { willReadFrequently: true });

let currentFile = null;
let inputBlob = null;
let originalPixels = null;
let automaticPixels = null;
let automaticSucceeded = false;
let activeTool = 'erase';
let activePointerId = null;
let lastPoint = null;
let activeStroke = null;
let undoStack = [];
let redoStack = [];
let zoom = 1;
let panX = 0;
let panY = 0;
let panStart = null;
let modelModulePromise = null;
let processingGeneration = 0;
let isProcessing = false;
let statusState = { key: 'removebg_status_ready', params: {} };
let comparePixels = null;

function translate(key, params = {}) {
    return window.YYYTools?.t?.(key, params) || key;
}

function setStatus(key, params = {}) {
    statusState = { key, params };
    statusEl.textContent = translate(key, params);
}

function setProgress(value, visible = true) {
    const percent = clamp(Number(value) || 0, 0, 100);
    progressBar.style.width = `${percent}%`;
    progressTrack.classList.toggle('hidden', !visible);
    progressTrack.setAttribute('aria-valuenow', String(percent));
}

function setProcessing(processing) {
    isProcessing = processing;
    autoButton.disabled = processing;
    downloadButton.disabled = processing;
    fileInput.disabled = processing;
    compareButton.disabled = processing;
    resetButton.disabled = processing;
    toolButtons.forEach(button => { button.disabled = processing; });
    stage.classList.toggle('is-processing', processing);
    if (processing) {
        undoButton.disabled = true;
        redoButton.disabled = true;
    } else {
        updateHistoryButtons();
    }
}

function updateHistoryButtons() {
    undoButton.disabled = undoStack.length === 0;
    redoButton.disabled = redoStack.length === 0;
}

function updateBrushLabel() {
    brushValue.textContent = `${brushSize.value} px`;
}

function updateTransform() {
    canvas.style.transform = `translate(${panX}px, ${panY}px) scale(${zoom})`;
    zoomValue.textContent = `${Math.round(zoom * 100)}%`;
}

function resetView() {
    zoom = 1;
    panX = 0;
    panY = 0;
    updateTransform();
}

function setTool(tool) {
    activeTool = tool;
    stage.dataset.tool = tool;
    toolButtons.forEach(button => {
        const selected = button.dataset.removebgTool === tool;
        button.classList.toggle('is-active', selected);
        button.setAttribute('aria-pressed', String(selected));
    });
}

function clearHistory() {
    undoStack = [];
    redoStack = [];
    updateHistoryButtons();
}

function copyImageData(source) {
    return new ImageData(new Uint8ClampedArray(source.data), source.width, source.height);
}

async function decodeToBitmap(blob) {
    if ('createImageBitmap' in window) {
        return createImageBitmap(blob, { imageOrientation: 'from-image' });
    }

    const url = URL.createObjectURL(blob);
    try {
        const image = await new Promise((resolve, reject) => {
            const element = new Image();
            element.onload = () => resolve(element);
            element.onerror = () => reject(new Error(translate('removebg_error_decode')));
            element.src = url;
        });
        return image;
    } finally {
        URL.revokeObjectURL(url);
    }
}

async function normalizeInputFile(file) {
    const isHeic = /\.(?:heic|heif)$/i.test(file.name) || /image\/hei[cf]/i.test(file.type);
    if (!isHeic) return file;
    if (!window.HeicTo) throw new Error(translate('removebg_error_heic'));
    return window.HeicTo({ blob: file, type: 'image/png', quality: 1 });
}

async function drawBlob(blob, destinationContext, destinationCanvas) {
    const image = await decodeToBitmap(blob);
    destinationCanvas.width = image.width || image.naturalWidth;
    destinationCanvas.height = image.height || image.naturalHeight;
    destinationContext.clearRect(0, 0, destinationCanvas.width, destinationCanvas.height);
    destinationContext.drawImage(image, 0, 0, destinationCanvas.width, destinationCanvas.height);
    image.close?.();
}

async function loadFile(file) {
    if (!isSupportedImageFile(file)) {
        window.YYYTools?.notify?.(translate('removebg_error_type'), 'error');
        return;
    }

    processingGeneration += 1;
    currentFile = file;
    setStatus('removebg_status_decoding');
    setProgress(0, false);

    try {
        inputBlob = await normalizeInputFile(file);
        await drawBlob(inputBlob, originalContext, originalCanvas);

        canvas.width = originalCanvas.width;
        canvas.height = originalCanvas.height;
        context.clearRect(0, 0, canvas.width, canvas.height);
        context.drawImage(originalCanvas, 0, 0);
        originalPixels = context.getImageData(0, 0, canvas.width, canvas.height);
        automaticPixels = copyImageData(originalPixels);
        automaticSucceeded = false;

        uploadPanel.classList.add('hidden');
        editor.classList.remove('hidden');
        resetView();
        clearHistory();
        setTool('erase');
        setStatus('removebg_status_ready');
        downloadButton.disabled = false;
        await runAutomaticRemoval();
    } catch (error) {
        window.YYYTools?.notify?.(
            translate('removebg_error_load', { message: error?.message || String(error) }),
            'error'
        );
        setStatus('removebg_status_failed');
        setProgress(0, false);
    }
}

async function getModelModule() {
    if (!modelModulePromise) modelModulePromise = import(MODEL_MODULE_URL);
    try {
        return await modelModulePromise;
    } catch (error) {
        modelModulePromise = null;
        throw error;
    }
}

async function runAutomaticRemoval() {
    if (!inputBlob) return;
    const generation = ++processingGeneration;
    setProcessing(true);
    clearHistory();
    setProgress(0, true);
    setStatus('removebg_status_model', { percent: 0 });

    try {
        const { removeBackground } = await getModelModule();
        const result = await removeBackground(inputBlob, {
            model: 'small',
            device: 'cpu',
            output: { format: 'image/png', quality: 1 },
            progress: (key, current, total) => {
                if (generation !== processingGeneration) return;
                const percent = progressPercent(current, total);
                setProgress(percent, true);
                setStatus(key.startsWith('compute:') ? 'removebg_status_processing' : 'removebg_status_model', { percent });
            }
        });

        if (generation !== processingGeneration) return;
        const image = await decodeToBitmap(result);
        context.clearRect(0, 0, canvas.width, canvas.height);
        context.drawImage(image, 0, 0, canvas.width, canvas.height);
        image.close?.();
        automaticPixels = context.getImageData(0, 0, canvas.width, canvas.height);
        automaticSucceeded = true;
        clearHistory();
        setProgress(100, true);
        setStatus('removebg_status_done');
        window.YYYTools?.notify?.(translate('removebg_status_done'), 'success');
    } catch (error) {
        if (generation !== processingGeneration) return;
        setStatus('removebg_status_failed');
        setProgress(0, false);
        window.YYYTools?.notify?.(
            translate('removebg_error_auto', { message: error?.message || String(error) }),
            'error'
        );
    } finally {
        if (generation === processingGeneration) setProcessing(false);
    }
}

function mergeBeforeRegion(newBounds) {
    if (!activeStroke) {
        activeStroke = {
            bounds: newBounds,
            before: context.getImageData(newBounds.x, newBounds.y, newBounds.width, newBounds.height)
        };
        return;
    }

    const oldBounds = activeStroke.bounds;
    if (
        newBounds.x === oldBounds.x &&
        newBounds.y === oldBounds.y &&
        newBounds.width === oldBounds.width &&
        newBounds.height === oldBounds.height
    ) return;

    const expanded = context.getImageData(newBounds.x, newBounds.y, newBounds.width, newBounds.height);
    const offsetX = oldBounds.x - newBounds.x;
    const offsetY = oldBounds.y - newBounds.y;
    const source = activeStroke.before.data;
    const destination = expanded.data;

    for (let row = 0; row < oldBounds.height; row += 1) {
        const sourceStart = row * oldBounds.width * 4;
        const sourceEnd = sourceStart + oldBounds.width * 4;
        const destinationStart = ((row + offsetY) * newBounds.width + offsetX) * 4;
        destination.set(source.subarray(sourceStart, sourceEnd), destinationStart);
    }

    activeStroke = { bounds: newBounds, before: expanded };
}

function drawBrushSegment(from, to) {
    const displayRect = canvas.getBoundingClientRect();
    const intrinsicScale = displayRect.width > 0 ? canvas.width / displayRect.width : 1;
    const radius = Number(brushSize.value) * intrinsicScale / 2;
    const segmentBounds = strokeBounds(from, to, radius, canvas.width, canvas.height);
    const combinedBounds = unionBounds(activeStroke?.bounds, segmentBounds);
    mergeBeforeRegion(combinedBounds);

    if (activeTool === 'erase') {
        context.save();
        context.globalCompositeOperation = 'destination-out';
        context.strokeStyle = '#000';
        context.lineWidth = radius * 2;
        context.lineCap = 'round';
        context.lineJoin = 'round';
        context.beginPath();
        context.moveTo(from.x, from.y);
        context.lineTo(to.x + 0.01, to.y + 0.01);
        context.stroke();
        context.restore();
        return;
    }

    const patchCanvas = document.createElement('canvas');
    patchCanvas.width = segmentBounds.width;
    patchCanvas.height = segmentBounds.height;
    const patchContext = patchCanvas.getContext('2d');
    patchContext.drawImage(
        originalCanvas,
        segmentBounds.x,
        segmentBounds.y,
        segmentBounds.width,
        segmentBounds.height,
        0,
        0,
        segmentBounds.width,
        segmentBounds.height
    );
    patchContext.globalCompositeOperation = 'destination-in';
    patchContext.strokeStyle = '#000';
    patchContext.lineWidth = radius * 2;
    patchContext.lineCap = 'round';
    patchContext.lineJoin = 'round';
    patchContext.beginPath();
    patchContext.moveTo(from.x - segmentBounds.x, from.y - segmentBounds.y);
    patchContext.lineTo(to.x - segmentBounds.x + 0.01, to.y - segmentBounds.y + 0.01);
    patchContext.stroke();
    context.drawImage(patchCanvas, segmentBounds.x, segmentBounds.y);
}

function pointFromPointer(event) {
    return canvasPointFromClient(
        canvas.getBoundingClientRect(),
        canvas.width,
        canvas.height,
        event.clientX,
        event.clientY
    );
}

function finishStroke() {
    if (!activeStroke) return;
    const { bounds, before } = activeStroke;
    const after = context.getImageData(bounds.x, bounds.y, bounds.width, bounds.height);
    undoStack.push({ bounds, before, after });
    if (undoStack.length > MAX_HISTORY) undoStack.shift();
    redoStack = [];
    activeStroke = null;
    updateHistoryButtons();
    setStatus('removebg_status_manual');
}

function applyHistoryEntry(entry, imageData) {
    context.putImageData(imageData, entry.bounds.x, entry.bounds.y);
}

function undo() {
    const entry = undoStack.pop();
    if (!entry) return;
    applyHistoryEntry(entry, entry.before);
    redoStack.push(entry);
    updateHistoryButtons();
}

function redo() {
    const entry = redoStack.pop();
    if (!entry) return;
    applyHistoryEntry(entry, entry.after);
    undoStack.push(entry);
    updateHistoryButtons();
}

function resetToAutomatic() {
    if (!automaticPixels) return;
    context.putImageData(automaticPixels, 0, 0);
    clearHistory();
    setStatus(automaticSucceeded ? 'removebg_status_done' : 'removebg_status_ready');
}

function startCompare() {
    if (!originalPixels || comparePixels || activePointerId !== null) return;
    comparePixels = context.getImageData(0, 0, canvas.width, canvas.height);
    context.putImageData(originalPixels, 0, 0);
    compareButton.classList.add('is-active');
}

function stopCompare() {
    if (!comparePixels) return;
    context.putImageData(comparePixels, 0, 0);
    comparePixels = null;
    compareButton.classList.remove('is-active');
}

function changeZoom(delta) {
    zoom = clamp(zoom + delta, 0.5, 4);
    updateTransform();
}

function resetEditor() {
    processingGeneration += 1;
    currentFile = null;
    inputBlob = null;
    originalPixels = null;
    automaticPixels = null;
    automaticSucceeded = false;
    canvas.width = 0;
    canvas.height = 0;
    fileInput.value = '';
    clearHistory();
    resetView();
    setProcessing(false);
    setProgress(0, false);
    setStatus('removebg_status_ready');
    editor.classList.add('hidden');
    uploadPanel.classList.remove('hidden');
}

async function downloadResult() {
    if (!currentFile || !canvas.width) return;
    downloadButton.disabled = true;
    try {
        const blob = await new Promise((resolve, reject) => {
            canvas.toBlob(result => result ? resolve(result) : reject(new Error(translate('err_canvas_export_failed'))), 'image/png');
        });
        const filename = backgroundRemovalDownloadName(currentFile.name);
        if (window.saveAs) window.saveAs(blob, filename);
        else {
            const url = URL.createObjectURL(blob);
            const link = document.createElement('a');
            link.href = url;
            link.download = filename;
            link.click();
            setTimeout(() => URL.revokeObjectURL(url), 1000);
        }
        window.YYYTools?.notify?.(translate('status_done'), 'success');
    } catch (error) {
        window.YYYTools?.notify?.(error?.message || String(error), 'error');
    } finally {
        downloadButton.disabled = false;
    }
}

canvas.addEventListener('pointerdown', event => {
    if (!canvas.width || activePointerId !== null || isProcessing) return;
    event.preventDefault();
    activePointerId = event.pointerId;
    canvas.setPointerCapture(event.pointerId);
    stage.classList.add('is-dragging');

    if (activeTool === 'pan') {
        panStart = { clientX: event.clientX, clientY: event.clientY, panX, panY };
        return;
    }

    activeStroke = null;
    lastPoint = pointFromPointer(event);
    drawBrushSegment(lastPoint, lastPoint);
});

canvas.addEventListener('pointermove', event => {
    if (event.pointerId !== activePointerId) return;
    event.preventDefault();

    if (activeTool === 'pan') {
        panX = panStart.panX + event.clientX - panStart.clientX;
        panY = panStart.panY + event.clientY - panStart.clientY;
        updateTransform();
        return;
    }

    const point = pointFromPointer(event);
    drawBrushSegment(lastPoint, point);
    lastPoint = point;
});

function endPointer(event) {
    if (event.pointerId !== activePointerId) return;
    if (activeTool !== 'pan') finishStroke();
    activePointerId = null;
    lastPoint = null;
    panStart = null;
    stage.classList.remove('is-dragging');
    canvas.releasePointerCapture?.(event.pointerId);
}

canvas.addEventListener('pointerup', endPointer);
canvas.addEventListener('pointercancel', endPointer);

fileInput.addEventListener('change', event => {
    const [file] = event.target.files || [];
    if (file) loadFile(file);
});

toolButtons.forEach(button => {
    button.addEventListener('click', () => setTool(button.dataset.removebgTool));
});

brushSize.addEventListener('input', updateBrushLabel);
autoButton.addEventListener('click', runAutomaticRemoval);
downloadButton.addEventListener('click', downloadResult);
undoButton.addEventListener('click', undo);
redoButton.addEventListener('click', redo);
resetButton.addEventListener('click', resetToAutomatic);
newButton.addEventListener('click', resetEditor);
zoomOutButton.addEventListener('click', () => changeZoom(-0.25));
zoomInButton.addEventListener('click', () => changeZoom(0.25));

compareButton.addEventListener('pointerdown', event => {
    event.preventDefault();
    startCompare();
});
compareButton.addEventListener('pointerup', stopCompare);
compareButton.addEventListener('pointercancel', stopCompare);
compareButton.addEventListener('pointerleave', stopCompare);
compareButton.addEventListener('keydown', event => {
    if (event.key === ' ' || event.key === 'Enter') startCompare();
});
compareButton.addEventListener('keyup', stopCompare);
compareButton.addEventListener('blur', stopCompare);

document.addEventListener('keydown', event => {
    if (section.classList.contains('hidden') || !canvas.width) return;
    const modifier = event.ctrlKey || event.metaKey;
    if (modifier && event.key.toLowerCase() === 'z') {
        event.preventDefault();
        if (event.shiftKey) redo();
        else undo();
    }
    if (event.key === '[' || event.key === ']') {
        event.preventDefault();
        const direction = event.key === '[' ? -5 : 5;
        brushSize.value = String(clamp(Number(brushSize.value) + direction, Number(brushSize.min), Number(brushSize.max)));
        updateBrushLabel();
    }
});

document.addEventListener('paste', event => {
    if (section.classList.contains('hidden') || isProcessing) return;
    const imageItem = Array.from(event.clipboardData?.items || []).find(item => item.type.startsWith('image/'));
    const file = imageItem?.getAsFile();
    if (file) {
        event.preventDefault();
        loadFile(file);
    }
});

window.addEventListener('yyy:languagechange', () => setStatus(statusState.key, statusState.params));

updateBrushLabel();
updateHistoryButtons();
updateTransform();
setTool('erase');
setProgress(0, false);
