import { calculateFittedCanvasSize } from './canvas-view-core.js';

const byId = id => document.getElementById(id);
const input = byId('file-rotate');
const controls = byId('ctrl-rotate');
const button = byId('do-rotate');
const canvas = byId('rotate-preview');
const stage = byId('rotate-preview-stage');
const status = byId('rotate-preview-status');
const previous = byId('rotate-prev');
const next = byId('rotate-next');

let sourceBytes = null;
let previewDocument = null;
let loadingTask = null;
let renderTask = null;
let pageNumber = 1;
let angle = 90;
let fileRevision = 0;
let renderRevision = 0;
let exporting = false;
let statusKey = '';
let resizeFrame = null;

const t = (key, params = {}) => window.YYYTools.t(key, params);
const normalizedRotation = value => ((value % 360) + 360) % 360;

function refreshLabels() {
    const pages = previewDocument?.numPages || 0;
    byId('rotate-page-label').textContent = pages
        ? t('rotate_page_label', { page: pageNumber, total: pages }) : '';
    byId('rotate-angle-label').textContent = t('rotate_angle_label', { angle });
    canvas.setAttribute('aria-label', t('rotate_preview_canvas_label', { page: pageNumber, angle }));
    previous.disabled = !pages || pageNumber <= 1;
    next.disabled = !pages || pageNumber >= pages;
    button.disabled = !sourceBytes || exporting;
    button.textContent = t(exporting ? 'processing' : 'btn_rotate_dl');
    status.textContent = statusKey ? t(statusKey) : '';
}

function setStatus(key = '') {
    statusKey = key;
    status.dataset.state = key === 'rotate_preview_error' ? 'error' : 'loading';
    stage.setAttribute('aria-busy', String(key === 'rotate_preview_loading'));
    status.textContent = key ? t(key) : '';
}

async function renderPreview() {
    if (!previewDocument) return;
    const revision = ++renderRevision;
    const pdf = previewDocument;
    const selectedPage = pageNumber;
    const selectedAngle = angle;
    renderTask?.cancel();
    renderTask = null;
    canvas.classList.add('hidden');
    setStatus('rotate_preview_loading');
    refreshLabels();
    let page = null;
    let raster = null;

    try {
        page = await pdf.getPage(selectedPage);
        if (revision !== renderRevision || pdf !== previewDocument) return;
        // Match export: add the chosen angle to each page's original rotation.
        const rotation = normalizedRotation((page.rotate || 0) + selectedAngle);
        const natural = page.getViewport({ scale: 1, rotation });
        const fitted = calculateFittedCanvasSize(natural.width, natural.height,
            stage.clientWidth || 640, stage.clientHeight || 420, 16, true);
        const density = Math.min(2, window.devicePixelRatio || 1);
        const viewport = page.getViewport({ scale: fitted.scale * density, rotation });
        // Render separately so a cancelled request cannot overwrite the current preview.
        raster = document.createElement('canvas');
        raster.width = Math.max(1, Math.ceil(viewport.width));
        raster.height = Math.max(1, Math.ceil(viewport.height));
        const task = page.render({ canvasContext: raster.getContext('2d'), viewport });
        renderTask = task;
        try {
            await task.promise;
        } finally {
            if (renderTask === task) renderTask = null;
        }
        if (revision !== renderRevision || pdf !== previewDocument) return;
        canvas.width = raster.width;
        canvas.height = raster.height;
        canvas.style.width = `${fitted.width}px`;
        canvas.style.height = `${fitted.height}px`;
        canvas.getContext('2d').drawImage(raster, 0, 0);
        canvas.classList.remove('hidden');
        setStatus();
    } catch (error) {
        if (revision !== renderRevision || pdf !== previewDocument) return;
        setStatus('rotate_preview_error');
    } finally {
        if (raster) raster.width = raster.height = 0;
        page?.cleanup();
    }
}

input.addEventListener('change', async event => {
    const file = event.target.files?.[0];
    if (!file) return;
    const revision = ++fileRevision;
    renderRevision += 1;
    renderTask?.cancel();
    renderTask = null;
    const oldLoadingTask = loadingTask;
    loadingTask = null;
    previewDocument = null;
    sourceBytes = null;
    pageNumber = 1;
    canvas.width = canvas.height = 0;
    canvas.classList.add('hidden');
    byId('name-rotate').textContent = file.name;
    controls.classList.remove('hidden');
    setStatus('rotate_preview_loading');
    refreshLabels();
    // Allow reselecting the same file, even after a failed preview.
    input.value = '';
    if (oldLoadingTask) oldLoadingTask.destroy().catch(() => {});

    try {
        const bytes = new Uint8Array(await file.arrayBuffer());
        if (revision !== fileRevision) return;
        sourceBytes = bytes;
        refreshLabels();
        // PDF.js transfers its buffer to a worker; keep independent bytes for export.
        const task = window.pdfjsLib.getDocument({ data: bytes.slice() });
        loadingTask = task;
        const pdf = await task.promise;
        if (revision !== fileRevision) return;
        if (!pdf.numPages) throw new Error('PDF contains no pages');
        previewDocument = pdf;
        await renderPreview();
    } catch (error) {
        if (revision !== fileRevision) return;
        setStatus('rotate_preview_error');
        refreshLabels();
    }
});

window.setRotate = value => {
    if (![90, 180, 270].includes(value)) return;
    angle = value;
    document.querySelectorAll('.rotate-opt').forEach(option => {
        const selected = Number(option.dataset.deg) === angle;
        option.classList.toggle('is-selected', selected);
        option.setAttribute('aria-pressed', String(selected));
    });
    refreshLabels();
    renderPreview();
};

previous.addEventListener('click', () => {
    if (!previewDocument || pageNumber <= 1) return;
    pageNumber -= 1;
    renderPreview();
});

next.addEventListener('click', () => {
    if (!previewDocument || pageNumber >= previewDocument.numPages) return;
    pageNumber += 1;
    renderPreview();
});

button.addEventListener('click', async () => {
    if (!sourceBytes || exporting) return;
    const bytes = sourceBytes.slice();
    const selectedAngle = angle;
    exporting = true;
    refreshLabels();
    try {
        const { PDFDocument, degrees } = window.PDFLib;
        const pdf = await PDFDocument.load(bytes);
        pdf.getPages().forEach(page => {
            page.setRotation(degrees(normalizedRotation(page.getRotation().angle + selectedAngle)));
        });
        window.saveAs(new Blob([await pdf.save()], { type: 'application/pdf' }), 'rotated.pdf');
        window.YYYTools.notify(t('status_done'), 'success');
    } catch (error) {
        window.YYYTools.notify(t('err_rotate_failed', { message: error?.message || String(error) }), 'error');
    } finally {
        exporting = false;
        refreshLabels();
    }
});

function resizePreview() {
    window.cancelAnimationFrame(resizeFrame);
    resizeFrame = window.requestAnimationFrame(() => {
        if (!byId('sec-rotate').classList.contains('hidden')) renderPreview();
    });
}

window.addEventListener('resize', resizePreview);
window.addEventListener('yyy:tabchange', event => {
    if (event.detail?.tab === 'rotate') resizePreview();
});
window.addEventListener('yyy:languagechange', refreshLabels);
window.setRotate(90);
