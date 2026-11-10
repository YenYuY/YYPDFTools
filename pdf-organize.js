import { createPageOrder, movePage, removePage, getExportPageIndices } from './pdf-organize-core.js';
import { calculateFittedCanvasSize } from './canvas-view-core.js';

const byId = id => document.getElementById(id);
const t = (key, params = {}) => window.YYYTools.t(key, params);
const input = byId('file-organize');
const grid = byId('organize-grid');
const dialog = byId('organize-dialog');
const cards = new Map();
let sourceBytes = null;
let sourceFile = null;
let pdfDocument = null;
let loadingTask = null;
let fileRevision = 0;
let renderRevision = 0;
let previewTask = null;
let thumbnailTask = null;
let thumbnailQueue = [];
let pumpingThumbnails = false;
let observer = null;
let order = [];
let selectedPage = null;
let history = [];
let exporting = false;
let message = { key: '', params: {}, error: false };
let previewStatus = '';
let resizeFrame = null;

function announce(key = '', params = {}, error = false) {
    message = { key, params, error };
    const node = byId('organize-message');
    node.textContent = key ? t(key, params) : '';
    node.dataset.state = error ? 'error' : 'status';
}

function refreshControls() {
    const total = pdfDocument?.numPages || 0;
    const positions = new Map(order.map((page, index) => [page, index]));
    const index = positions.get(selectedPage) ?? -1;
    const ready = Boolean(sourceBytes && total && order.length);
    byId('organize-count').textContent = total
        ? t('organize_count', { count: order.length, total, deleted: total - order.length }) : '';
    input.disabled = exporting;
    byId('organize-replace').disabled = exporting;
    byId('do-organize').disabled = !ready || exporting;
    byId('do-organize').textContent = t(exporting ? 'processing' : 'organize_download');
    byId('organize-undo').disabled = !history.length || exporting;
    byId('organize-reset').disabled = !ready || exporting ||
        (order.length === total && order.every((page, position) => page === position + 1));
    byId('organize-expand').disabled = !ready;
    const label = ready ? t('organize_page_label', { position: index + 1, total: order.length, page: selectedPage }) : '';
    for (const prefix of ['organize', 'organize-dialog']) {
        byId(prefix === 'organize' ? 'organize-page-label' : 'organize-dialog-label').textContent = label;
        byId(`${prefix}-prev`).disabled = index <= 0;
        byId(`${prefix}-next`).disabled = index < 0 || index >= order.length - 1;
        byId(`${prefix}-earlier`).disabled = exporting || index <= 0;
        byId(`${prefix}-later`).disabled = exporting || index < 0 || index >= order.length - 1;
        byId(`${prefix}-delete`).disabled = exporting || !ready || order.length <= 1;
    }
    for (const [page, card] of cards) {
        const position = positions.get(page) ?? -1;
        const params = { page, position: position + 1 };
        card.classList.toggle('is-selected', page === selectedPage);
        card.draggable = !exporting;
        const select = card.querySelector('[data-action="select"]');
        select.setAttribute('aria-pressed', String(page === selectedPage));
        select.setAttribute('aria-label', t('organize_thumb_label', params));
        card.querySelector('.organize-position').textContent = t('organize_page', params);
        card.querySelector('.organize-original').textContent = t('organize_original', params);
        for (const action of ['earlier', 'later', 'delete']) {
            const button = card.querySelector(`[data-action="${action}"]`);
            const key = action === 'delete' ? 'organize_delete_page' : `organize_move_${action}`;
            button.setAttribute('aria-label', t(key, params));
            button.title = t(key, params);
            button.disabled = exporting || (action === 'delete' ? order.length <= 1
                : action === 'earlier' ? position <= 0 : position >= order.length - 1);
        }
        const placeholder = card.querySelector('.organize-thumb-placeholder');
        if (placeholder) placeholder.textContent = t(card.dataset.failed ? 'organize_thumbnail_error' : 'organize_preview_loading');
    }
    for (const id of ['organize-preview', 'organize-dialog-canvas']) {
        byId(id).setAttribute('aria-label', label);
    }
    announce(message.key, message.params, message.error);
    setPreviewStatus(previewStatus);
}

function setPreviewStatus(key = '') {
    previewStatus = key;
    for (const [stageId, statusId] of [
        ['organize-preview-stage', 'organize-preview-status'],
        ['organize-dialog-stage', 'organize-dialog-status']
    ]) {
        byId(stageId).setAttribute('aria-busy', String(key === 'organize_preview_loading'));
        const status = byId(statusId);
        status.textContent = key ? t(key) : '';
        status.dataset.state = key === 'organize_preview_error' ? 'error' : 'status';
    }
}

async function renderPreview() {
    if (!pdfDocument || !selectedPage) return;
    const revision = ++renderRevision;
    const pdf = pdfDocument;
    const pageNumber = selectedPage;
    const expanded = dialog.open;
    const canvas = byId(expanded ? 'organize-dialog-canvas' : 'organize-preview');
    const stage = byId(expanded ? 'organize-dialog-stage' : 'organize-preview-stage');
    previewTask?.cancel();
    previewTask = null;
    canvas.classList.add('hidden');
    setPreviewStatus('organize_preview_loading');
    let page = null;
    let raster = null;
    try {
        page = await pdf.getPage(pageNumber);
        if (revision !== renderRevision || pdf !== pdfDocument) return;
        const natural = page.getViewport({ scale: 1 });
        const fitted = calculateFittedCanvasSize(natural.width, natural.height,
            stage.clientWidth || 600, stage.clientHeight || 480, 16, true);
        const density = Math.min(2, window.devicePixelRatio || 1);
        const viewport = page.getViewport({ scale: fitted.scale * density });
        raster = document.createElement('canvas');
        raster.width = Math.max(1, Math.ceil(viewport.width));
        raster.height = Math.max(1, Math.ceil(viewport.height));
        const task = page.render({ canvasContext: raster.getContext('2d'), viewport });
        previewTask = task;
        try { await task.promise; }
        finally { if (previewTask === task) previewTask = null; }
        if (revision !== renderRevision || pdf !== pdfDocument) return;
        canvas.width = raster.width;
        canvas.height = raster.height;
        canvas.style.width = `${fitted.width}px`;
        canvas.style.height = `${fitted.height}px`;
        canvas.getContext('2d').drawImage(raster, 0, 0);
        canvas.classList.remove('hidden');
        setPreviewStatus();
    } catch (error) {
        if (revision === renderRevision && pdf === pdfDocument) setPreviewStatus('organize_preview_error');
    } finally {
        if (raster) raster.width = raster.height = 0;
        page?.cleanup();
    }
}

async function pumpThumbnails() {
    if (pumpingThumbnails || !pdfDocument) return;
    pumpingThumbnails = true;
    const revision = fileRevision;
    const pdf = pdfDocument;
    try {
        while (thumbnailQueue.length && revision === fileRevision) {
            const pageNumber = thumbnailQueue.shift();
            const card = cards.get(pageNumber);
            if (!card || card.dataset.rendered) continue;
            let page = null;
            let raster = null;
            try {
                page = await pdf.getPage(pageNumber);
                if (revision !== fileRevision) return;
                const natural = page.getViewport({ scale: 1 });
                const viewport = page.getViewport({ scale: Math.min(300 / natural.width, 360 / natural.height) });
                raster = document.createElement('canvas');
                raster.width = Math.max(1, Math.ceil(viewport.width));
                raster.height = Math.max(1, Math.ceil(viewport.height));
                const task = page.render({ canvasContext: raster.getContext('2d'), viewport });
                thumbnailTask = task;
                try { await task.promise; }
                finally { if (thumbnailTask === task) thumbnailTask = null; }
                if (revision !== fileRevision) return;
                raster.setAttribute('aria-hidden', 'true');
                card.querySelector('.organize-thumb').replaceChildren(raster);
                card.dataset.rendered = 'true';
                raster = null;
            } catch (error) {
                if (revision !== fileRevision) return;
                card.dataset.failed = 'true';
                card.querySelector('.organize-thumb-placeholder').textContent = t('organize_thumbnail_error');
            } finally {
                if (raster) raster.width = raster.height = 0;
                page?.cleanup();
            }
        }
    } finally {
        pumpingThumbnails = false;
        if (thumbnailQueue.length) pumpThumbnails();
    }
}

function queueThumbnail(pageNumber) {
    const card = cards.get(pageNumber);
    if (!card || card.dataset.rendered || card.dataset.queued) return;
    card.dataset.queued = 'true';
    thumbnailQueue.push(pageNumber);
    pumpThumbnails();
}

function createCard(pageNumber) {
    const card = document.createElement('li');
    card.className = 'organize-card';
    card.dataset.page = String(pageNumber);
    card.draggable = true;
    // The markup is fixed; file names and translated labels are assigned as text.
    card.innerHTML = `<button type="button" class="organize-select" data-action="select">
        <span class="organize-thumb"><span class="organize-thumb-placeholder"></span></span>
        <span class="organize-card-label"><span class="organize-position"></span><span class="organize-original"></span></span>
        </button><div class="organize-card-actions">
        <button type="button" class="editor-view-button" data-action="earlier">←</button>
        <button type="button" class="editor-view-button" data-action="later">→</button>
        <button type="button" class="editor-view-button organize-danger" data-action="delete"><svg aria-hidden="true" viewBox="0 0 24 24" width="18" height="18" style="margin:auto" fill="none" stroke="currentColor" stroke-width="1.7"><path d="M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7M14 10v7"/></svg></button>
        </div>`;
    return card;
}

function refreshGrid() {
    const focused = document.activeElement;
    const focusedPage = focused?.closest('.organize-card')?.dataset.page;
    const focusedAction = focused?.dataset.action;
    const wanted = new Set(order);
    for (const [pageNumber, card] of cards) {
        if (!wanted.has(pageNumber)) {
            observer?.unobserve(card);
            card.remove();
            cards.delete(pageNumber);
        }
    }
    for (const pageNumber of order) {
        if (!cards.has(pageNumber)) cards.set(pageNumber, createCard(pageNumber));
        const card = cards.get(pageNumber);
        grid.append(card);
        if (!card.dataset.queued) {
            if (observer) observer.observe(card);
            else queueThumbnail(pageNumber);
        }
    }
    refreshControls();
    if (focusedPage && focusedAction) {
        const card = cards.get(Number(focusedPage)) || cards.get(selectedPage);
        const target = card?.querySelector(`[data-action="${focusedAction}"]:not(:disabled)`) || card?.querySelector('[data-action="select"]');
        target?.focus({ preventScroll: true });
    }
}

function commit(nextOrder, nextSelected, key, params = {}) {
    if (exporting || nextOrder.every((page, index) => page === order[index]) && nextOrder.length === order.length) return;
    history.push({ order: order.slice(), selectedPage });
    if (history.length > 50) history.shift();
    order = nextOrder;
    selectedPage = nextSelected;
    announce(key, params);
    refreshGrid();
    renderPreview();
}

function move(pageNumber, targetIndex) {
    const fromIndex = order.indexOf(pageNumber);
    commit(movePage(order, fromIndex, targetIndex), pageNumber, 'organize_moved', { page: pageNumber, position: targetIndex + 1 });
}

function remove(pageNumber) {
    const index = order.indexOf(pageNumber);
    if (index < 0 || order.length <= 1) return;
    const nextOrder = removePage(order, pageNumber);
    const nextSelected = selectedPage === pageNumber ? nextOrder[Math.min(index, nextOrder.length - 1)] : selectedPage;
    commit(nextOrder, nextSelected, 'organize_deleted', { page: pageNumber });
}

function select(pageNumber) {
    if (!order.includes(pageNumber)) return;
    selectedPage = pageNumber;
    refreshControls();
    renderPreview();
}

input.addEventListener('change', async event => {
    const file = event.target.files?.[0];
    if (!file || exporting) return;
    const revision = ++fileRevision;
    renderRevision += 1;
    previewTask?.cancel();
    thumbnailTask?.cancel();
    previewTask = thumbnailTask = null;
    observer?.disconnect();
    thumbnailQueue = [];
    const previousTask = loadingTask;
    loadingTask = null;
    pdfDocument = null;
    sourceBytes = null;
    sourceFile = file;
    order = [];
    selectedPage = null;
    history = [];
    cards.clear();
    grid.replaceChildren();
    if (dialog.open) dialog.close();
    for (const id of ['organize-preview', 'organize-dialog-canvas']) {
        const canvas = byId(id);
        canvas.width = canvas.height = 0;
        canvas.classList.add('hidden');
    }
    byId('name-organize').textContent = file.name;
    byId('ctrl-organize').classList.remove('hidden');
    byId('organize-workbench').classList.add('hidden');
    byId('drop-organize').classList.remove('hidden');
    announce('organize_loading');
    refreshControls();
    input.value = '';
    previousTask?.destroy().catch(() => {});
    try {
        const bytes = new Uint8Array(await file.arrayBuffer());
        if (revision !== fileRevision) return;
        // PDF.js transfers its buffer to the worker. Export retains its own copy.
        const task = window.pdfjsLib.getDocument({ data: bytes.slice() });
        loadingTask = task;
        const pdf = await task.promise;
        if (revision !== fileRevision) return;
        if (!pdf.numPages) throw new Error('PDF contains no pages');
        sourceBytes = bytes;
        pdfDocument = pdf;
        order = createPageOrder(pdf.numPages);
        selectedPage = order[0];
        byId('drop-organize').classList.add('hidden');
        byId('organize-workbench').classList.remove('hidden');
        if ('IntersectionObserver' in window) {
            observer = new IntersectionObserver(entries => {
                for (const entry of entries) {
                    if (!entry.isIntersecting) continue;
                    observer.unobserve(entry.target);
                    queueThumbnail(Number(entry.target.dataset.page));
                }
            }, { rootMargin: '300px' });
        }
        announce();
        refreshGrid();
        renderPreview();
    } catch (error) {
        if (revision !== fileRevision) return;
        announce(error?.name === 'PasswordException' ? 'organize_password_error' : 'organize_load_error', {}, true);
        refreshControls();
    }
});

grid.addEventListener('click', event => {
    const button = event.target.closest('button[data-action]');
    const card = button?.closest('.organize-card');
    if (!card || button.disabled) return;
    const page = Number(card.dataset.page);
    if (button.dataset.action === 'select') select(page);
    if (button.dataset.action === 'earlier') move(page, order.indexOf(page) - 1);
    if (button.dataset.action === 'later') move(page, order.indexOf(page) + 1);
    if (button.dataset.action === 'delete') remove(page);
});

let draggedPage = null;
function clearDrag() {
    draggedPage = null;
    for (const card of cards.values()) card.classList.remove('is-dragging', 'is-drop-target');
}
grid.addEventListener('dragstart', event => {
    const card = event.target.closest('.organize-card');
    if (!card || exporting) { event.preventDefault(); return; }
    draggedPage = Number(card.dataset.page);
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData('text/plain', String(draggedPage));
    card.classList.add('is-dragging');
});
grid.addEventListener('dragover', event => {
    const card = event.target.closest('.organize-card');
    if (!card || draggedPage === null || exporting) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
    for (const node of cards.values()) node.classList.toggle('is-drop-target', node === card && Number(card.dataset.page) !== draggedPage);
});
grid.addEventListener('dragleave', event => {
    const card = event.target.closest('.organize-card');
    if (card && !card.contains(event.relatedTarget)) card.classList.remove('is-drop-target');
});
grid.addEventListener('drop', event => {
    if (draggedPage === null) return;
    event.preventDefault();
    const card = event.target.closest('.organize-card');
    if (card && !exporting) move(draggedPage, order.indexOf(Number(card.dataset.page)));
    clearDrag();
});
grid.addEventListener('dragend', clearDrag);

for (const prefix of ['organize', 'organize-dialog']) {
    byId(`${prefix}-prev`).addEventListener('click', () => select(order[order.indexOf(selectedPage) - 1]));
    byId(`${prefix}-next`).addEventListener('click', () => select(order[order.indexOf(selectedPage) + 1]));
    byId(`${prefix}-earlier`).addEventListener('click', () => move(selectedPage, order.indexOf(selectedPage) - 1));
    byId(`${prefix}-later`).addEventListener('click', () => move(selectedPage, order.indexOf(selectedPage) + 1));
    byId(`${prefix}-delete`).addEventListener('click', () => remove(selectedPage));
}
byId('organize-replace').addEventListener('click', () => input.click());
byId('organize-undo').addEventListener('click', () => {
    if (!history.length || exporting) return;
    const snapshot = history.pop();
    order = snapshot.order;
    selectedPage = snapshot.selectedPage;
    announce('organize_undone');
    refreshGrid();
    renderPreview();
});
byId('organize-reset').addEventListener('click', () => {
    if (pdfDocument) commit(createPageOrder(pdfDocument.numPages), 1, 'organize_reset_done');
});
byId('organize-expand').addEventListener('click', () => {
    if (!pdfDocument) return;
    dialog.showModal();
    renderPreview();
});
byId('organize-dialog-close').addEventListener('click', () => dialog.close());
dialog.addEventListener('close', () => renderPreview());

byId('do-organize').addEventListener('click', async () => {
    if (!sourceBytes || !pdfDocument || exporting || !order.length) return;
    const bytes = sourceBytes.slice();
    const indices = getExportPageIndices(order, pdfDocument.numPages);
    const filename = `organized_${window.YYYTools.safeBaseName(sourceFile)}.pdf`;
    exporting = true;
    clearDrag();
    refreshControls();
    try {
        const { PDFDocument } = window.PDFLib;
        const source = await PDFDocument.load(bytes);
        const output = await PDFDocument.create();
        // Copy original PDF page objects in the visible order, preserving vector text and rotation.
        const pages = await output.copyPages(source, indices);
        pages.forEach(page => output.addPage(page));
        window.saveAs(new Blob([await output.save()], { type: 'application/pdf' }), filename);
        window.YYYTools.notify(t('status_done'), 'success');
    } catch (error) {
        window.YYYTools.notify(t('organize_export_error', { message: error?.message || String(error) }), 'error');
    } finally {
        exporting = false;
        refreshControls();
    }
});

function resizePreview() {
    window.cancelAnimationFrame(resizeFrame);
    resizeFrame = window.requestAnimationFrame(() => {
        if (!byId('sec-organize').classList.contains('hidden')) renderPreview();
    });
}
window.addEventListener('resize', resizePreview);
window.addEventListener('yyy:tabchange', event => {
    if (event.detail?.tab === 'organize') resizePreview();
    else if (dialog.open) dialog.close();
});
window.addEventListener('yyy:languagechange', refreshControls);
refreshControls();
