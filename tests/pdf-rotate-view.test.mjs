import test from 'node:test';
import assert from 'node:assert/strict';

let instance = 0;
const deferred = () => {
    let resolve;
    let reject;
    const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
    return { promise, resolve, reject };
};

async function controller() {
    const elements = new Map();
    const renders = [];
    const commits = [];
    const downloads = [];
    const notifications = [];
    const openedDocuments = [];
    const exportLoads = [];
    const eventHandlers = new Map();
    const documentSpecs = new Map();
    const byteKey = bytes => Array.from(new Uint8Array(bytes.buffer || bytes, bytes.byteOffset || 0, bytes.byteLength)).join(',');
    const pageBlocks = [];
    const renderBlocks = [];
    let exportBlock = null;
    let currentDocument = null;
    let language = 'zh-TW';

    function element(id = '') {
        const listeners = new Map();
        const classes = new Set();
        const attributes = new Map();
        const node = {
            id, style: {}, dataset: {}, disabled: false, textContent: '', width: 0, height: 0,
            clientWidth: 900, clientHeight: 520,
            classList: {
                add: (...names) => names.forEach(name => classes.add(name)),
                remove: (...names) => names.forEach(name => classes.delete(name)),
                contains: name => classes.has(name),
                toggle(name, force) { if (force ?? !classes.has(name)) classes.add(name); else classes.delete(name); }
            },
            setAttribute(name, value) { attributes.set(name, String(value)); },
            removeAttribute(name) { attributes.delete(name); },
            getAttribute(name) { return attributes.get(name) ?? null; },
            addEventListener(name, handler) {
                if (!listeners.has(name)) listeners.set(name, []);
                listeners.get(name).push(handler);
            },
            emit(name, props = {}) {
                return Promise.all((listeners.get(name) || []).map(handler => handler({ target: node, ...props })));
            },
            getBoundingClientRect: () => ({ width: node.clientWidth, height: node.clientHeight }),
            getContext: () => context
        };
        const context = {
            canvas: node,
            drawImage(image) {
                node.paint = image.paint;
                if (id === 'rotate-preview') commits.push(image.paint);
            },
            clearRect() { node.paint = null; },
            setTransform() {}, fillRect() {}, save() {}, restore() {}
        };
        return node;
    }
    const byId = id => {
        if (!elements.has(id)) elements.set(id, element(id));
        return elements.get(id);
    };
    const options = [90, 180, 270].map(deg => {
        const option = element(`angle-${deg}`);
        option.dataset.deg = String(deg);
        return option;
    });
    const document = {
        getElementById: byId,
        querySelectorAll: selector => selector === '.rotate-opt' ? options : [],
        createElement: () => element(),
        documentElement: { lang: language },
        hidden: false
    };
    function createDocument(spec) {
        const pdf = {
            spec, numPages: spec.rotations.length, destroyed: false,
            async destroy() { pdf.destroyed = true; },
            async getPage(number) {
                assert.ok(number >= 1 && number <= pdf.numPages, `page ${number} is in range`);
                const blockIndex = pageBlocks.findIndex(block => block.number === number && (!block.name || block.name === spec.name));
                if (blockIndex !== -1) await pageBlocks.splice(blockIndex, 1)[0].gate.promise;
                const page = {
                    rotate: spec.rotations[number - 1],
                    getViewport({ scale, rotation = page.rotate }) {
                        const landscape = Math.abs(rotation % 180) === 90;
                        return { width: (landscape ? 800 : 600) * scale, height: (landscape ? 600 : 800) * scale, scale, rotation };
                    },
                    render({ canvasContext, viewport }) {
                        const record = { name: spec.name, number, rotation: viewport.rotation, viewport, canvas: canvasContext.canvas, canceled: false };
                        canvasContext.canvas.paint = record;
                        renders.push(record);
                        const gate = renderBlocks.shift();
                        return { promise: gate?.promise || Promise.resolve(), cancel() { record.canceled = true; } };
                    },
                    cleanup() {}
                };
                return page;
            }
        };
        openedDocuments.push(pdf);
        return pdf;
    }
    const window = {
        document, devicePixelRatio: 2, innerWidth: 1000, innerHeight: 800,
        setTimeout, clearTimeout,
        requestAnimationFrame: callback => setTimeout(callback, 0), cancelAnimationFrame: clearTimeout,
        getComputedStyle: () => ({ paddingLeft: '16px', paddingRight: '16px', paddingTop: '16px', paddingBottom: '16px' }),
        addEventListener(name, handler) {
            if (!eventHandlers.has(name)) eventHandlers.set(name, []);
            eventHandlers.get(name).push(handler);
        },
        pdfjsLib: {
            getDocument({ data }) {
                const spec = documentSpecs.get(byteKey(data));
                assert.ok(data instanceof Uint8Array || data instanceof ArrayBuffer);
                // Model PDF.js transferring the supplied buffer to its worker.
                structuredClone(data, { transfer: [data.buffer || data] });
                const pdf = spec.error ? null : createDocument(spec);
                const promise = spec.loadingGate ? spec.loadingGate.promise.then(() => pdf)
                    : spec.error ? Promise.reject(new Error(spec.error)) : Promise.resolve(pdf);
                return { promise, async destroy() { if (pdf) pdf.destroyed = true; } };
            }
        },
        PDFLib: {
            degrees: angle => ({ angle }),
            PDFDocument: {
                async load(bytes) {
                    const capturedBytes = Array.from(new Uint8Array(bytes.buffer || bytes, bytes.byteOffset || 0, bytes.byteLength));
                    const spec = documentSpecs.get(byteKey(bytes));
                    const pages = spec.rotations.map(angle => ({
                        angle, getRotation() { return { angle: this.angle }; },
                        setRotation(value) { this.angle = value.angle; }
                    }));
                    exportLoads.push({ bytes: capturedBytes, pages });
                    const gate = exportBlock;
                    exportBlock = null;
                    if (gate) await gate.promise;
                    return { getPages: () => pages, save: async () => new Uint8Array([8, 9]) };
                }
            }
        },
        saveAs(blob, name) { downloads.push({ blob, name }); },
        YYYTools: {
            t(key, params = {}) { return `${language}:${key}:${JSON.stringify(params)}`; },
            notify(message, type) { notifications.push({ message, type }); }
        }
    };
    globalThis.document = document;
    globalThis.window = window;
    globalThis.requestAnimationFrame = window.requestAnimationFrame;
    globalThis.cancelAnimationFrame = window.cancelAnimationFrame;
    globalThis.pdfjsLib = window.pdfjsLib;
    globalThis.PDFLib = window.PDFLib;
    globalThis.saveAs = window.saveAs;
    await import(`../pdf-rotate.js?view-test=${++instance}`);
    async function settled() {
        for (let turn = 0; turn < 8; turn += 1) await new Promise(resolve => setTimeout(resolve, 0));
    }
    return {
        byId, options, renders, commits, downloads, notifications, openedDocuments, exportLoads, settled,
        window,
        async select({ name = 'preview.pdf', rotations = [0, 90], bytes = [1, 2, 3], error, loadingGate, bytesGate } = {}) {
            currentDocument = { name, rotations, error, loadingGate };
            documentSpecs.set(bytes.join(','), currentDocument);
            const result = byId('file-rotate').emit('change', { target: { files: [{ name, arrayBuffer: () => bytesGate?.promise || Promise.resolve(new Uint8Array(bytes).buffer) }] } });
            await settled();
            return result;
        },
        blockPage(number, name) { const gate = deferred(); pageBlocks.push({ number, name, gate }); return gate; },
        blockRender() { const gate = deferred(); renderBlocks.push(gate); return gate; },
        blockExport() { exportBlock = deferred(); return exportBlock; },
        async emitWindow(name, detail = {}) {
            await Promise.all((eventHandlers.get(name) || []).map(handler => handler({ detail })));
            await settled();
        },
        setLanguage(value) { language = value; document.documentElement.lang = value; }
    };
}

test('selecting a PDF immediately previews 90 degrees and angle buttons update the displayed page', async () => {
    const env = await controller();
    await env.select();
    assert.equal(env.renders.at(-1).number, 1);
    assert.equal(env.renders.at(-1).rotation, 90);
    assert.equal(env.byId('rotate-preview').classList.contains('hidden'), false);
    assert.equal(env.byId('ctrl-rotate').classList.contains('hidden'), false);
    assert.equal(env.byId('name-rotate').textContent, 'preview.pdf');
    for (const angle of [180, 270, 90]) {
        env.window.setRotate(angle);
        await env.settled();
        assert.equal(env.renders.at(-1).rotation, angle);
        assert.equal(env.byId('rotate-preview').paint.rotation, angle);
        for (const option of env.options) assert.equal(option.getAttribute('aria-pressed'), String(Number(option.dataset.deg) === angle));
    }
});

test('page navigation preserves chosen rotation, adds the original orientation and stops at document bounds', async () => {
    const env = await controller();
    await env.select({ rotations: [270, 90] });
    assert.equal(env.renders.at(-1).rotation, 0);
    assert.equal(env.byId('rotate-prev').disabled, true);
    assert.equal(env.byId('rotate-next').disabled, false);
    env.window.setRotate(270);
    await env.settled();
    await env.byId('rotate-next').emit('click');
    await env.settled();
    assert.equal(env.renders.at(-1).number, 2);
    assert.equal(env.renders.at(-1).rotation, 0);
    assert.equal(env.byId('rotate-next').disabled, true);
    assert.equal(env.byId('rotate-prev').disabled, false);
    await env.byId('rotate-prev').emit('click');
    await env.settled();
    assert.equal(env.renders.at(-1).number, 1);
    assert.equal(env.renders.at(-1).rotation, 180);
});

test('a delayed page or paint cannot overwrite a newer angle selection', async () => {
    const env = await controller();
    await env.select();
    const pageGate = env.blockPage(1);
    env.window.setRotate(180);
    await env.settled();
    env.window.setRotate(270);
    await env.settled();
    assert.equal(env.byId('rotate-preview').paint.rotation, 270);
    const commits = env.commits.length;
    pageGate.resolve();
    await env.settled();
    assert.equal(env.byId('rotate-preview').paint.rotation, 270);
    assert.equal(env.commits.length, commits);
    const renderGate = env.blockRender();
    env.window.setRotate(180);
    await env.settled();
    env.window.setRotate(90);
    await env.settled();
    renderGate.resolve();
    await env.settled();
    assert.equal(env.byId('rotate-preview').paint.rotation, 90);
});

test('replacing a document discards delayed work from the previous file and resets to its first page', async () => {
    const env = await controller();
    await env.select({ name: 'old.pdf' });
    const gate = env.blockPage(2, 'old.pdf');
    const navigation = env.byId('rotate-next').emit('click');
    await env.settled();
    await env.select({ name: 'new.pdf', rotations: [180], bytes: [4, 5, 6] });
    gate.resolve();
    await navigation;
    await env.settled();
    assert.equal(env.byId('rotate-preview').paint.name, 'new.pdf');
    assert.equal(env.byId('rotate-preview').paint.number, 1);
    assert.equal(env.byId('rotate-preview').paint.rotation, 270);
    assert.equal(env.byId('rotate-prev').disabled, true);
    assert.equal(env.byId('rotate-next').disabled, true);
    assert.equal(env.openedDocuments[0].destroyed, true);
});

test('a slow file read cannot replace a newer selected document', async () => {
    const env = await controller();
    const bytesGate = deferred();
    const oldSelection = env.select({ name: 'slow.pdf', bytes: [7, 8, 9], bytesGate });
    await env.settled();
    await env.select({ name: 'latest.pdf', bytes: [4, 5, 6], rotations: [180] });
    bytesGate.resolve(new Uint8Array([7, 8, 9]).buffer);
    await oldSelection;
    await env.settled();
    assert.equal(env.byId('name-rotate').textContent, 'latest.pdf');
    assert.equal(env.byId('rotate-preview').paint.name, 'latest.pdf');
});

test('a failed replacement hides the old preview and reports an actionable preview error', async () => {
    const env = await controller();
    await env.select();
    await env.select({ name: 'broken.pdf', error: 'Invalid PDF structure' });
    assert.equal(env.byId('rotate-preview').classList.contains('hidden'), true);
    assert.match(env.byId('rotate-preview-status').textContent, /preview|預覽/i);
    assert.equal(env.byId('rotate-prev').disabled, true);
    assert.equal(env.byId('rotate-next').disabled, true);
});

test('download rotates every page and captures the selected angle before asynchronous export', async () => {
    const env = await controller();
    await env.select({ rotations: [0, 90, 270], bytes: [10, 20, 30] });
    env.window.setRotate(180);
    await env.settled();
    const gate = env.blockExport();
    const exporting = env.byId('do-rotate').emit('click');
    await env.settled();
    env.window.setRotate(270);
    gate.resolve();
    await exporting;
    await env.settled();
    assert.deepEqual(env.exportLoads[0].bytes, [10, 20, 30]);
    assert.deepEqual(env.exportLoads[0].pages.map(page => ((page.angle % 360) + 360) % 360), [180, 270, 90]);
    assert.equal(env.downloads.length, 1);
    assert.equal(env.downloads[0].blob.type, 'application/pdf');
    assert.equal(env.byId('do-rotate').disabled, false);
});

test('dynamic page and angle labels follow language changes', async () => {
    const env = await controller();
    await env.select();
    env.setLanguage('ja');
    await env.emitWindow('yyy:languagechange');
    assert.match(env.byId('rotate-page-label').textContent, /^ja:/);
    assert.match(env.byId('rotate-angle-label').textContent, /^ja:/);
});


test('portrait and landscape previews fit a narrow stage after resizing', async () => {
    const env = await controller();
    await env.select();
    const stage = env.byId('rotate-preview-stage');
    stage.clientWidth = 240;
    stage.clientHeight = 300;
    await env.emitWindow('resize');
    for (const angle of [90, 180, 270]) {
        env.window.setRotate(angle);
        await env.settled();
        const canvas = env.byId('rotate-preview');
        const width = parseFloat(canvas.style.width);
        const height = parseFloat(canvas.style.height);
        assert.ok(width > 0 && width <= 208);
        assert.ok(height > 0 && height <= 268);
        assert.equal(width > height, angle !== 180);
        assert.ok(Math.abs(canvas.width - width * 2) <= 1);
        assert.ok(Math.abs(canvas.height - height * 2) <= 1);
    }
});
