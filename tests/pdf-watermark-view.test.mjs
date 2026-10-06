import test from 'node:test';
import assert from 'node:assert/strict';

let instance = 0;
function assertCoordinates(actual, expected) {
    assert.equal(actual.length, expected.length);
    actual.forEach((value, index) => assert.ok(Math.abs(value - expected[index]) < 1e-7, `${value} ≈ ${expected[index]}`));
}

async function controller() {
    const elements = new Map();
    const renders = [];
    const paintedMasks = [];
    const windowEvents = new Map();
    const stageBounds = { left: 0, top: 0, width: 1200, height: 900 };
    let tool = 'view';
    let blockedRequest = null;
    function element(id = '') {
        const classes = new Set(id === 'watermark-preview' ? ['hidden'] : []);
        const listeners = new Map();
        const captures = new Set();
        const attributes = new Map();
        const node = {
            id, value: '', style: {}, dataset: {}, width: 0, height: 0, disabled: false,
            clientWidth: stageBounds.width, clientHeight: stageBounds.height,
            classList: {
                add: (...names) => names.forEach(name => classes.add(name)),
                remove: (...names) => names.forEach(name => classes.delete(name)),
                contains: name => classes.has(name),
                toggle(name, force) { if (force ?? !classes.has(name)) classes.add(name); else classes.delete(name); }
            },
            addEventListener(name, handler) { if (!listeners.has(name)) listeners.set(name, []); listeners.get(name).push(handler); },
            async emit(name, props = {}) {
                const event = { target: node, button: 0, isPrimary: true, pointerId: 1, preventDefault() {}, ...props };
                for (const handler of listeners.get(name) || []) await handler(event);
            },
            setAttribute(name, value) { attributes.set(name, value); },
            removeAttribute(name) { attributes.delete(name); },
            attributes, focus() {},
            setPointerCapture(id) { captures.add(id); },
            hasPointerCapture(id) { return captures.has(id); },
            releasePointerCapture(id) { captures.delete(id); },
            getBoundingClientRect() {
                if (id !== 'watermark-preview') return { ...stageBounds };
                const width = parseFloat(node.style.width) || 600;
                const height = parseFloat(node.style.height) || 800;
                const pan = /translate\(([-.\d]+)px,\s*([-.\d]+)px\)/.exec(node.style.transform || '');
                return { left: (stageBounds.width - width) / 2 + Number(pan?.[1] || 0), top: (stageBounds.height - height) / 2 + Number(pan?.[2] || 0), width, height };
            },
            getContext() { return context; }
        };
        const stack = [];
        const context = {
            canvas: node, font: '', globalAlpha: 1,
            save() { stack.push({ ...this }); }, restore() { Object.assign(this, stack.pop()); },
            setTransform() {}, clearRect() {}, drawImage() {}, beginPath() {}, rect() {}, clip() {},
            setLineDash() {}, moveTo() {}, lineTo() {}, arc() {}, fill() {}, stroke() {},
            translate() {}, rotate() {}, fillText() {},
            fillRect(...values) { if (id === 'watermark-preview') paintedMasks.push(values); },
            measureText(text) { return { width: text.length * parseFloat(this.font) * 0.6 }; }
        };
        return node;
    }
    const byId = id => {
        if (!elements.has(id)) elements.set(id, element(id));
        return elements.get(id);
    };
    const geometry = { x: 0, y: 0, width: 600, height: 800 };
    const sourcePage = { getCropBox: () => geometry, getMediaBox: () => geometry, getRotation: () => ({ angle: 0 }) };
    const sourceDocument = { getPageCount: () => 2, getPage: () => sourcePage };
    const pdfjsDocument = {
        async getPage(number) {
            if (blockedRequest?.number === number) {
                const request = blockedRequest;
                blockedRequest = null;
                await request.promise;
            }
            return {
                getViewport: ({ scale }) => ({ width: 600 * scale, height: 800 * scale, scale }),
                render({ canvasContext, viewport, transform }) {
                    renders.push({ number, width: canvasContext.canvas.width, height: canvasContext.canvas.height, viewport, transform });
                    return { promise: Promise.resolve(), cancel() {} };
                }, cleanup() {}
            };
        }
    };
    const document = {
        getElementById: byId,
        querySelector: () => ({ value: tool }),
        createElement: () => element(),
        fonts: { ready: Promise.resolve() }
    };
    globalThis.document = document;
    globalThis.window = {
        document, devicePixelRatio: 1, innerWidth: 1400, innerHeight: 1000,
        getComputedStyle: () => ({ paddingLeft: '12px', paddingRight: '12px', paddingTop: '12px', paddingBottom: '12px' }),
        PDFLib: { PDFDocument: { load: async () => sourceDocument } },
        pdfjsLib: { getDocument: () => ({ promise: Promise.resolve(pdfjsDocument), destroy: async () => {} }) },
        setTimeout, clearTimeout, requestAnimationFrame: callback => setTimeout(callback, 0), cancelAnimationFrame: clearTimeout,
        addEventListener(name, handler) {
            if (!windowEvents.has(name)) windowEvents.set(name, []);
            windowEvents.get(name).push(handler);
        },
        YYYTools: { t: key => key, notify(message) { throw new Error(message); } }
    };
    for (const [id, value] of Object.entries({
        'watermark-text': 'Preview', 'watermark-font': 'sans', 'watermark-size': '48',
        'watermark-color': '#64748b', 'watermark-opacity': '20', 'watermark-angle': '-35',
        'watermark-layout': 'single', 'watermark-position': 'center', 'watermark-spacing': '80',
        'watermark-page-mode': 'all', 'watermark-page-range': '', 'watermark-redact-size': '24'
    })) byId(id).value = value;
    await import(`../pdf-watermark.js?view-test=${++instance}`);
    await byId('file-watermark').emit('change', { target: { files: [{ name: 'preview.pdf', arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer }] } });
    async function settled() { await new Promise(resolve => setTimeout(resolve, 180)); }
    await settled();
    return { byId, renders, paintedMasks, stageBounds, settled, setTool: value => { tool = value; },
        async resize(width, height) {
            stageBounds.width = width;
            stageBounds.height = height;
            byId('watermark-preview-stage').clientWidth = width;
            byId('watermark-preview-stage').clientHeight = height;
            for (const handler of windowEvents.get('resize') || []) await handler();
        },
        blockNextPage(number) {
            let release;
            const promise = new Promise(resolve => { release = resolve; });
            blockedRequest = { number, promise };
            return release;
        }
    };
}

test('zoom renders more PDF detail and keeps manual masks in displayed page coordinates', async () => {
    const env = await controller();
    const canvas = env.byId('watermark-preview');
    const initialRender = env.renders.at(-1);
    env.setTool('rect');
    await env.byId('watermark-redaction-tools').emit('change');
    const firstBounds = canvas.getBoundingClientRect();
    await canvas.emit('pointerdown', { clientX: firstBounds.left + firstBounds.width * 0.2, clientY: firstBounds.top + firstBounds.height * 0.2 });
    await canvas.emit('pointerup', { clientX: firstBounds.left + firstBounds.width * 0.4, clientY: firstBounds.top + firstBounds.height * 0.4 });
    assertCoordinates(env.paintedMasks.at(-1), [120, 160, 120, 160]);
    await env.byId('watermark-zoom-in').emit('click');
    await env.settled();
    assert.equal(env.byId('watermark-zoom-value').textContent, '125%');
    assert.ok(env.renders.at(-1).width > initialRender.width);
    assert.ok(env.renders.at(-1).height > initialRender.height);
    assertCoordinates(env.paintedMasks.at(-1), [120, 160, 120, 160]);
    const zoomedBounds = canvas.getBoundingClientRect();
    await canvas.emit('pointerdown', { clientX: zoomedBounds.left + zoomedBounds.width * 0.5, clientY: zoomedBounds.top + zoomedBounds.height * 0.5 });
    await canvas.emit('pointerup', { clientX: zoomedBounds.left + zoomedBounds.width * 0.7, clientY: zoomedBounds.top + zoomedBounds.height * 0.7 });
    assertCoordinates(env.paintedMasks.at(-1), [300, 400, 120, 160]);
});

test('view-mode dragging pans an enlarged page and keeps coordinate mapping accurate', async () => {
    const env = await controller();
    for (let step = 0; step < 4; step++) await env.byId('watermark-zoom-in').emit('click');
    await env.settled();
    const stage = env.byId('watermark-preview-stage');
    const canvas = env.byId('watermark-preview');
    const before = canvas.getBoundingClientRect();
    await stage.emit('pointerdown', { clientX: 600, clientY: 450 });
    await stage.emit('pointermove', { clientX: 720, clientY: 520 });
    await stage.emit('pointerup', { clientX: 720, clientY: 520 });
    const after = canvas.getBoundingClientRect();
    assert.ok(Math.abs(after.left - before.left - 120) < 1e-7);
    assert.ok(Math.abs(after.top - before.top - 70) < 1e-7);
    env.setTool('rect');
    await env.byId('watermark-redaction-tools').emit('change');
    await canvas.emit('pointerdown', { clientX: after.left + after.width * 0.2, clientY: after.top + after.height * 0.2 });
    await canvas.emit('pointerup', { clientX: after.left + after.width * 0.4, clientY: after.top + after.height * 0.4 });
    assertCoordinates(env.paintedMasks.at(-1), [120, 160, 120, 160]);
    await env.byId('watermark-fit').emit('click');
    await env.settled();
    assert.equal(env.byId('watermark-zoom-value').textContent, '100%');
    assertCoordinates(env.paintedMasks.at(-1), [120, 160, 120, 160]);
});

test('settings retain the viewport while page changes reset fit and raster memory stays bounded', async () => {
    const env = await controller();
    for (let step = 0; step < 40; step++) await env.byId('watermark-zoom-in').emit('click');
    await env.settled();
    assert.equal(env.byId('watermark-zoom-value').textContent, '800%');
    assert.equal(env.byId('watermark-zoom-in').disabled, true);
    for (const render of env.renders) {
        assert.ok(render.width <= 4096 && render.height <= 4096);
        assert.ok(render.width * render.height <= 8000000);
    }
    env.byId('watermark-text').value = 'Changed watermark';
    await env.byId('watermark-settings').emit('input');
    await env.settled();
    assert.equal(env.byId('watermark-zoom-value').textContent, '800%');
    await env.byId('watermark-next').emit('click');
    await env.settled();
    assert.equal(env.byId('watermark-zoom-value').textContent, '100%');
    for (let step = 0; step < 10; step++) await env.byId('watermark-zoom-out').emit('click');
    await env.settled();
    assert.equal(env.byId('watermark-zoom-value').textContent, '50%');
    assert.equal(env.byId('watermark-zoom-out').disabled, true);
});

test('a larger viewport fills the available height and requests sharper PDF pixels without resetting zoom', async () => {
    const env = await controller();
    await env.byId('watermark-zoom-in').emit('click');
    await env.settled();
    const before = env.renders.at(-1);
    await env.resize(1600, 1300);
    await env.settled();
    assert.equal(env.byId('watermark-zoom-value').textContent, '125%');
    assert.ok(env.renders.at(-1).height > before.height);
    assert.ok(Math.abs(parseFloat(env.byId('watermark-preview').style.height) - 1276 * 1.25) < 1e-7);
});

test('modifier-wheel zoom keeps the page point under the pointer and normal wheel scrolling is untouched', async () => {
    const env = await controller();
    for (let step = 0; step < 4; step++) await env.byId('watermark-zoom-in').emit('click');
    await env.settled();
    const stage = env.byId('watermark-preview-stage');
    const canvas = env.byId('watermark-preview');
    const before = canvas.getBoundingClientRect();
    const anchor = { clientX: 700, clientY: 550 };
    const pagePoint = { x: (anchor.clientX - before.left) / before.width, y: (anchor.clientY - before.top) / before.height };
    let prevented = false;
    await stage.emit('wheel', { ...anchor, deltaY: -100, preventDefault: () => { prevented = true; } });
    assert.equal(prevented, false);
    assert.equal(env.byId('watermark-zoom-value').textContent, '200%');
    await stage.emit('wheel', { ...anchor, deltaY: -100, ctrlKey: true, preventDefault: () => { prevented = true; } });
    await env.settled();
    assert.equal(prevented, true);
    const after = canvas.getBoundingClientRect();
    assert.ok(Math.abs((anchor.clientX - after.left) / after.width - pagePoint.x) < 1e-7);
    assert.ok(Math.abs((anchor.clientY - after.top) / after.height - pagePoint.y) < 1e-7);
    assert.ok(parseInt(env.byId('watermark-zoom-value').textContent) > 200);
});

test('a stale page request cannot replace or cancel the newest page raster', async () => {
    const env = await controller();
    const releaseOldPage = env.blockNextPage(1);
    await env.byId('watermark-settings').emit('input');
    await new Promise(resolve => setTimeout(resolve, 130));
    await env.byId('watermark-next').emit('click');
    await env.settled();
    assert.equal(env.renders.at(-1).number, 2);
    releaseOldPage();
    await env.settled();
    assert.equal(env.renders.at(-1).number, 2);
});
