import {
    chunkPageRanges,
    firstUnassignedPage,
    validateSplitRanges
} from './pdf-split-core.js';

const fileInput = document.getElementById('file-split');
const splitName = document.getElementById('name-split');
const splitPageCount = document.getElementById('split-page-count');
const splitCtrl = document.getElementById('ctrl-split');
const splitStartInput = document.getElementById('split-start');
const splitEndInput = document.getElementById('split-end');
const splitAfterInput = document.getElementById('split-after');
const splitTwoOptions = document.getElementById('split-two-options');
const splitPageOptions = document.getElementById('split-page-options');
const splitSimplePanel = document.getElementById('split-simple-panel');
const splitAdvancedPanel = document.getElementById('split-advanced-panel');
const splitRangeList = document.getElementById('split-range-list');
const splitRangeSummary = document.getElementById('split-range-summary');
const splitPreviewGrid = document.getElementById('split-preview-grid');
const splitPreviewProgress = document.getElementById('split-preview-progress');
const splitButton = document.getElementById('do-split');

let splitFile = null;
let splitPdfDoc = null;
let splitRanges = [];
let previewDocument = null;
let previewFile = null;
let previewGeneration = 0;

function translate(key, params = {}) {
    return window.YYYTools?.t?.(key, params) || key;
}

function reportError(key, params = {}) {
    window.YYYTools?.notify?.(translate(key, params), 'error');
}

function safeName(file, fallback = 'split') {
    return window.YYYTools?.safeBaseName?.(file, fallback) || fallback;
}

function currentWorkflow() {
    return document.querySelector('input[name="split-workflow"]:checked')?.value || 'simple';
}

function currentSimpleMode() {
    return document.querySelector('input[name="split-mode"]:checked')?.value || 'two';
}

function totalPages() {
    return splitPdfDoc ? splitPdfDoc.getPageCount() : 0;
}

function formatPageList(pages) {
    if (!pages.length) return '';
    const groups = [];
    let start = pages[0];
    let end = pages[0];
    for (let index = 1; index <= pages.length; index += 1) {
        const page = pages[index];
        if (page === end + 1) {
            end = page;
            continue;
        }
        groups.push(start === end ? String(start) : `${start}-${end}`);
        start = page;
        end = page;
    }
    return groups.join(', ');
}

function validationMessage(validation) {
    const number = (validation.rangeIndex ?? 0) + 1;
    if (validation.error === 'missing') return translate('err_split_ranges_missing');
    if (validation.error === 'invalid_number') return translate('err_split_range_invalid', { number });
    if (validation.error === 'out_of_bounds') {
        return translate('err_split_range_bounds', { number, totalPages: totalPages() });
    }
    if (validation.error === 'reversed') return translate('err_split_range_reversed', { number });
    if (validation.error === 'overlap') return translate('err_split_range_overlap', { page: validation.page });
    return translate('err_invalid_page_number');
}

function updateRangeSummary() {
    if (!splitPdfDoc) {
        splitRangeSummary.textContent = '';
        delete splitRangeSummary.dataset.state;
        return;
    }

    const validation = validateSplitRanges(splitRanges, totalPages());
    if (!validation.valid) {
        splitRangeSummary.textContent = validationMessage(validation);
        splitRangeSummary.dataset.state = 'error';
        return;
    }

    let summary = translate('split_summary', { count: validation.ranges.length });
    if (validation.unassignedPages.length) {
        summary += translate('split_summary_omitted', { pages: formatPageList(validation.unassignedPages) });
    }
    splitRangeSummary.textContent = summary;
    splitRangeSummary.dataset.state = 'valid';
}

function rangeForPage(pageNumber) {
    for (let index = 0; index < splitRanges.length; index += 1) {
        const start = Number(splitRanges[index].start);
        const end = Number(splitRanges[index].end);
        if (Number.isInteger(start) && Number.isInteger(end) && pageNumber >= start && pageNumber <= end) {
            return index;
        }
    }
    return null;
}

function updatePreviewAssignments() {
    splitPreviewGrid.querySelectorAll('.split-preview-card').forEach(card => {
        const pageNumber = Number(card.dataset.page);
        const rangeIndex = rangeForPage(pageNumber);
        const badge = card.querySelector('.split-preview-output');
        badge.textContent = rangeIndex === null
            ? ''
            : translate('split_output_badge', { number: rangeIndex + 1 });
        card.setAttribute('aria-label', rangeIndex === null
            ? translate('split_page_label', { page: pageNumber })
            : `${translate('split_page_label', { page: pageNumber })}, ${badge.textContent}`);
        const pageLabel = card.querySelector('.split-preview-page');
        if (pageLabel) pageLabel.textContent = translate('split_page_label', { page: pageNumber });
    });
}

function renderRangeRows() {
    splitRangeList.replaceChildren();
    const pageCount = Math.max(1, totalPages());

    splitRanges.forEach((range, index) => {
        const row = document.createElement('div');
        row.className = 'split-range-row';
        row.setAttribute('role', 'listitem');

        const name = document.createElement('span');
        name.className = 'split-range-name';
        name.textContent = translate('split_output_file', { number: index + 1 });

        const createField = (key, value, property) => {
            const field = document.createElement('div');
            field.className = 'split-range-field';
            const inputId = `split-range-${property}-${index}`;
            const label = document.createElement('label');
            label.htmlFor = inputId;
            label.textContent = translate(key);
            const input = document.createElement('input');
            input.type = 'number';
            input.id = inputId;
            input.min = '1';
            input.max = String(pageCount);
            input.value = value;
            input.inputMode = 'numeric';
            input.addEventListener('input', () => {
                splitRanges[index][property] = input.value;
                updateRangeSummary();
                updatePreviewAssignments();
            });
            field.append(label, input);
            return field;
        };

        const separator = document.createElement('span');
        separator.className = 'split-range-separator';
        separator.setAttribute('aria-hidden', 'true');
        separator.textContent = '–';

        const remove = document.createElement('button');
        remove.type = 'button';
        remove.className = 'split-remove-range';
        remove.textContent = '×';
        remove.setAttribute('aria-label', translate('split_remove_range', { number: index + 1 }));
        remove.addEventListener('click', () => {
            splitRanges.splice(index, 1);
            refreshRangeUI();
        });

        row.append(
            name,
            createField('lbl_start_page', range.start, 'start'),
            separator,
            createField('lbl_end_page', range.end, 'end'),
            remove
        );
        splitRangeList.appendChild(row);
    });
}

function refreshRangeUI() {
    renderRangeRows();
    updateRangeSummary();
    updatePreviewAssignments();
}

function updateSimpleMode() {
    const mode = currentSimpleMode();
    splitTwoOptions.classList.toggle('hidden', mode !== 'two');
    splitPageOptions.classList.toggle('hidden', mode !== 'pages');
    document.querySelectorAll('input[name="split-mode"]').forEach(input => {
        const label = input.closest('label');
        const activeClasses = ['border-blue-200', 'dark:border-blue-900', 'bg-blue-50', 'dark:bg-blue-900/20'];
        const idleClasses = ['border-gray-200', 'dark:border-gray-600', 'bg-gray-50', 'dark:bg-gray-700'];
        activeClasses.forEach(className => label.classList.toggle(className, input.checked));
        idleClasses.forEach(className => label.classList.toggle(className, !input.checked));
    });
}

async function renderPreview() {
    if (!splitFile || currentWorkflow() !== 'advanced') return;
    if (previewFile === splitFile && splitPreviewGrid.children.length === totalPages()) {
        updatePreviewAssignments();
        return;
    }

    const generation = ++previewGeneration;
    splitPreviewGrid.replaceChildren();
    splitPreviewProgress.textContent = translate('split_preview_loading', {
        current: 0,
        total: totalPages()
    });

    try {
        if (previewDocument) await previewDocument.destroy();
        previewDocument = await window.pdfjsLib.getDocument({ data: await splitFile.arrayBuffer() }).promise;
        previewFile = splitFile;

        for (let pageNumber = 1; pageNumber <= previewDocument.numPages; pageNumber += 1) {
            if (generation !== previewGeneration) return;
            const page = await previewDocument.getPage(pageNumber);
            const originalViewport = page.getViewport({ scale: 1 });
            const cssScale = Math.min(1, 150 / originalViewport.width, 190 / originalViewport.height);
            const viewport = page.getViewport({ scale: cssScale });
            const outputScale = Math.min(2, window.devicePixelRatio || 1);

            const card = document.createElement('div');
            card.className = 'split-preview-card';
            card.dataset.page = String(pageNumber);
            card.setAttribute('role', 'group');

            const canvasWrap = document.createElement('div');
            canvasWrap.className = 'split-preview-canvas-wrap';
            const canvas = document.createElement('canvas');
            canvas.width = Math.max(1, Math.floor(viewport.width * outputScale));
            canvas.height = Math.max(1, Math.floor(viewport.height * outputScale));
            canvas.style.width = `${viewport.width}px`;
            canvas.style.height = `${viewport.height}px`;
            canvas.setAttribute('aria-hidden', 'true');
            canvasWrap.appendChild(canvas);

            const meta = document.createElement('div');
            meta.className = 'split-preview-meta';
            const pageLabel = document.createElement('span');
            pageLabel.className = 'split-preview-page';
            const outputBadge = document.createElement('span');
            outputBadge.className = 'split-preview-output';
            meta.append(pageLabel, outputBadge);
            card.append(canvasWrap, meta);
            splitPreviewGrid.appendChild(card);

            await page.render({
                canvasContext: canvas.getContext('2d'),
                viewport,
                transform: outputScale === 1 ? null : [outputScale, 0, 0, outputScale, 0, 0]
            }).promise;
            page.cleanup();
            updatePreviewAssignments();
            splitPreviewProgress.textContent = translate('split_preview_loading', {
                current: pageNumber,
                total: previewDocument.numPages
            });
        }

        splitPreviewProgress.textContent = translate('split_page_count', { count: previewDocument.numPages });
    } catch (error) {
        if (generation !== previewGeneration) return;
        splitPreviewProgress.textContent = '';
        reportError('err_split_failed', { message: error && error.message ? error.message : String(error) });
    }
}

function updateWorkflow() {
    const advanced = currentWorkflow() === 'advanced';
    splitSimplePanel.classList.toggle('hidden', advanced);
    splitAdvancedPanel.classList.toggle('hidden', !advanced);
    if (advanced) renderPreview();
}

function resetSplitState() {
    previewGeneration += 1;
    if (previewDocument) previewDocument.destroy().catch(() => {});
    splitFile = null;
    splitPdfDoc = null;
    splitRanges = [];
    previewDocument = null;
    previewFile = null;
    splitName.textContent = '';
    splitPageCount.textContent = '';
    splitRangeList.replaceChildren();
    splitRangeSummary.textContent = '';
    splitPreviewGrid.replaceChildren();
    splitPreviewProgress.textContent = '';
    splitCtrl.classList.add('hidden');
    splitAfterInput.value = 1;
    splitAfterInput.max = 1;
    splitStartInput.value = 1;
    splitEndInput.value = 1;
    splitStartInput.max = 1;
    splitEndInput.max = 1;
}

async function buildPdfFromIndices(pageIndices) {
    const pdf = await window.PDFLib.PDFDocument.create();
    const pages = await pdf.copyPages(splitPdfDoc, pageIndices);
    pages.forEach(page => pdf.addPage(page));
    return pdf.save();
}

async function runSimpleSplit() {
    const pageCount = totalPages();
    const baseName = safeName(splitFile);

    if (currentSimpleMode() === 'two') {
        if (pageCount < 2) return reportError('err_split_requires_two_pages');
        const splitAfter = Number(splitAfterInput.value);
        const lastSplitPage = pageCount - 1;
        if (!Number.isInteger(splitAfter)) return reportError('err_invalid_page_number');
        if (splitAfter < 1 || splitAfter > lastSplitPage) {
            return reportError('err_split_after_range', { lastSplitPage });
        }

        const zip = new window.JSZip();
        zip.file(
            `${baseName}_part_1_pages_1-${splitAfter}.pdf`,
            await buildPdfFromIndices(Array.from({ length: splitAfter }, (_, index) => index))
        );
        zip.file(
            `${baseName}_part_2_pages_${splitAfter + 1}-${pageCount}.pdf`,
            await buildPdfFromIndices(Array.from({ length: pageCount - splitAfter }, (_, index) => index + splitAfter))
        );
        window.saveAs(await zip.generateAsync({ type: 'blob' }), `${baseName}_split_two_parts.zip`);
        window.notify(translate('status_done'), 'success');
        return;
    }

    const start = Number(splitStartInput.value);
    const end = Number(splitEndInput.value);
    if (!Number.isInteger(start) || !Number.isInteger(end)) return reportError('err_invalid_page_number');
    if (start < 1 || end < 1 || start > pageCount || end > pageCount) {
        return reportError('err_page_range', { totalPages: pageCount });
    }
    if (start > end) return reportError('err_start_greater_than_end');

    if (start === end) {
        window.saveAs(
            new Blob([await buildPdfFromIndices([start - 1])], { type: 'application/pdf' }),
            `${baseName}_page_${start}.pdf`
        );
        window.notify(translate('status_done'), 'success');
        return;
    }

    const zip = new window.JSZip();
    for (let pageNumber = start; pageNumber <= end; pageNumber += 1) {
        zip.file(`${baseName}_page_${pageNumber}.pdf`, await buildPdfFromIndices([pageNumber - 1]));
    }
    window.saveAs(await zip.generateAsync({ type: 'blob' }), `${baseName}_pages_${start}-${end}.zip`);
    window.notify(translate('status_done'), 'success');
}

async function runAdvancedSplit() {
    const validation = validateSplitRanges(splitRanges, totalPages());
    if (!validation.valid) {
        window.notify(validationMessage(validation), 'error');
        return;
    }

    const baseName = safeName(splitFile);
    const outputs = [];
    for (let index = 0; index < validation.ranges.length; index += 1) {
        const range = validation.ranges[index];
        const pageIndices = Array.from(
            { length: range.end - range.start + 1 },
            (_, pageIndex) => range.start + pageIndex - 1
        );
        outputs.push({
            name: `${baseName}_part_${index + 1}_pages_${range.start}-${range.end}.pdf`,
            bytes: await buildPdfFromIndices(pageIndices)
        });
    }

    if (outputs.length === 1) {
        window.saveAs(new Blob([outputs[0].bytes], { type: 'application/pdf' }), outputs[0].name);
    } else {
        const zip = new window.JSZip();
        outputs.forEach(output => zip.file(output.name, output.bytes));
        window.saveAs(await zip.generateAsync({ type: 'blob' }), `${baseName}_custom_split.zip`);
    }
    window.notify(translate('status_done'), 'success');
}

document.querySelectorAll('input[name="split-mode"]').forEach(input => {
    input.addEventListener('change', updateSimpleMode);
});

document.querySelectorAll('input[name="split-workflow"]').forEach(input => {
    input.addEventListener('change', updateWorkflow);
});

document.getElementById('split-add-range').addEventListener('click', () => {
    const page = firstUnassignedPage(splitRanges, totalPages());
    if (page === null) return reportError('err_split_no_unassigned_page');
    splitRanges.push({ start: page, end: page });
    refreshRangeUI();
    splitRangeList.lastElementChild?.querySelector('input')?.focus();
});

document.getElementById('split-pair-ranges').addEventListener('click', () => {
    splitRanges = chunkPageRanges(totalPages(), 2);
    refreshRangeUI();
});

fileInput.addEventListener('change', async event => {
    const nextFile = event.target.files[0];
    if (!nextFile) return;

    previewGeneration += 1;
    if (previewDocument) await previewDocument.destroy().catch(() => {});
    previewDocument = null;
    previewFile = null;
    splitPreviewGrid.replaceChildren();
    splitPreviewProgress.textContent = '';

    try {
        const bytes = await nextFile.arrayBuffer();
        const nextPdfDoc = await window.PDFLib.PDFDocument.load(bytes);
        const pageCount = nextPdfDoc.getPageCount();

        splitFile = nextFile;
        splitPdfDoc = nextPdfDoc;
        splitRanges = [{ start: 1, end: 1 }];
        splitName.textContent = nextFile.name;
        splitPageCount.textContent = translate('split_page_count', { count: pageCount });
        splitAfterInput.value = Math.max(1, Math.floor(pageCount / 2));
        splitAfterInput.max = Math.max(1, pageCount - 1);
        splitStartInput.value = 1;
        splitEndInput.value = pageCount;
        splitStartInput.max = pageCount;
        splitEndInput.max = pageCount;
        splitCtrl.classList.remove('hidden');
        refreshRangeUI();
        updateWorkflow();
    } catch (error) {
        resetSplitState();
        event.target.value = '';
        reportError('err_split_failed', { message: error && error.message ? error.message : String(error) });
    }
});

splitButton.addEventListener('click', async () => {
    if (!splitFile || !splitPdfDoc) return;
    if (currentWorkflow() === 'advanced') {
        const validation = validateSplitRanges(splitRanges, totalPages());
        if (!validation.valid) {
            window.notify(validationMessage(validation), 'error');
            return;
        }
    }

    window.setBusy(splitButton, true);
    try {
        if (currentWorkflow() === 'advanced') await runAdvancedSplit();
        else await runSimpleSplit();
    } catch (error) {
        reportError('err_split_failed', { message: error && error.message ? error.message : String(error) });
    } finally {
        window.setBusy(splitButton, false, 'btn_split_dl');
    }
});

window.addEventListener('yyy:languagechange', () => {
    if (splitPdfDoc) splitPageCount.textContent = translate('split_page_count', { count: totalPages() });
    refreshRangeUI();
    if (previewFile) splitPreviewProgress.textContent = translate('split_page_count', { count: totalPages() });
});

updateSimpleMode();
updateWorkflow();
