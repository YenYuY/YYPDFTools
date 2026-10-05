import test from 'node:test';
import assert from 'node:assert/strict';
import * as core from '../pdf-redaction-core.js';

test('maps the same viewed-page location across responsive preview sizes and quarter-turn dimensions', () => {
    const portrait = core.pointOnPage(220, 360, { left: 20, top: 60, width: 400, height: 600 }, 600, 900);
    const resized = core.pointOnPage(120, 210, { left: 20, top: 60, width: 200, height: 300 }, 600, 900);
    assert.deepEqual(portrait, { x: 300, y: 450 });
    assert.deepEqual(resized, portrait);
    assert.deepEqual(core.pointOnPage(320, 260, { left: 20, top: 60, width: 600, height: 400 }, 900, 600), { x: 450, y: 300 });
    assert.deepEqual(core.pointOnPage(-10, 1000, { left: 20, top: 60, width: 400, height: 600 }, 600, 900), { x: 0, y: 900 });
});

test('ignores pointer input with invalid coordinates, rectangles or page dimensions', () => {
    const rect = { left: 10, top: 20, width: 300, height: 400 };
    for (const value of [NaN, Infinity, -Infinity, undefined, null, '10']) {
        assert.equal(core.pointOnPage(value, 30, rect, 600, 800), null);
        assert.equal(core.pointOnPage(20, value, rect, 600, 800), null);
        for (const key of ['left', 'top', 'width', 'height']) {
            assert.equal(core.pointOnPage(20, 30, { ...rect, [key]: value }, 600, 800), null);
        }
    }
    for (const value of [0, -1, NaN, Infinity, undefined, null, '10']) {
        assert.equal(core.pointOnPage(20, 30, rect, value, 800), null);
        assert.equal(core.pointOnPage(20, 30, rect, 600, value), null);
        assert.equal(core.pointOnPage(20, 30, { ...rect, width: value }, 600, 800), null);
        assert.equal(core.pointOnPage(20, 30, { ...rect, height: value }, 600, 800), null);
    }
    assert.equal(core.pointOnPage(20, 30, null, 600, 800), null);
});

test('makes the same filled rectangle in every drag direction, clipped to page edges', () => {
    const expected = { type: 'rect', x: 30, y: 40, width: 170, height: 260 };
    for (const [start, end] of [
        [{ x: 30, y: 40 }, { x: 230, y: 320 }],
        [{ x: 230, y: 320 }, { x: 30, y: 40 }],
        [{ x: 30, y: 320 }, { x: 230, y: 40 }],
        [{ x: 230, y: 40 }, { x: 30, y: 320 }]
    ]) assert.deepEqual(core.makeRedactionRect(start, end, 200, 300), expected);
    assert.deepEqual(core.makeRedactionRect({ x: -100, y: -100 }, { x: 30, y: 40 }, 200, 300), { type: 'rect', x: 0, y: 0, width: 30, height: 40 });
});

test('does not create a rectangle for a click, tiny drag, fully off-page drag or invalid data', () => {
    for (const [start, end] of [
        [{ x: 20, y: 20 }, { x: 20, y: 20 }],
        [{ x: 20, y: 20 }, { x: 20.9, y: 50 }],
        [{ x: 20, y: 20 }, { x: 50, y: 20.9 }],
        [{ x: -20, y: 20 }, { x: -10, y: 50 }],
        [null, { x: 30, y: 40 }],
        [{ x: 20, y: 20 }, { x: NaN, y: 40 }],
        [{ x: Infinity, y: 20 }, { x: 30, y: 40 }]
    ]) assert.equal(core.makeRedactionRect(start, end, 200, 300), null);
    assert.equal(core.makeRedactionRect({ x: 20, y: 20 }, { x: 40, y: 40 }, 0, 300), null);
    assert.deepEqual(core.makeRedactionRect({ x: 20, y: 20 }, { x: 21, y: 21 }, 200, 300), { type: 'rect', x: 20, y: 20, width: 1, height: 1 });
});

function drawingCanvas() {
    const paints = [];
    const paths = [];
    const stack = [];
    const context = {
        globalAlpha: 0.15, globalCompositeOperation: 'destination-out', fillStyle: 'red', strokeStyle: 'blue',
        filter: 'blur(5px)', shadowBlur: 9, shadowColor: 'red', shadowOffsetX: 5, shadowOffsetY: 5,
        transform: [10, 0, 0, 10, 400, 500], dash: [12, 12], lineWidth: 1, lineCap: 'butt', lineJoin: 'miter',
        save() { stack.push({ ...this, transform: [...this.transform], dash: [...this.dash] }); },
        restore() { Object.assign(this, stack.pop()); },
        setTransform(...values) { this.transform = values; },
        setLineDash(values) { this.dash = values; },
        clearRect() { throw new Error('existing PDF pixels must be preserved'); },
        fillRect(...values) { paints.push({ type: 'rect', values, state: state(this) }); },
        beginPath() { this.path = []; },
        rect(...values) { this.path.push(['rect', ...values]); },
        clip() { paths.push({ type: 'clip', path: this.path }); },
        moveTo(...values) { this.path.push(['moveTo', ...values]); },
        lineTo(...values) { this.path.push(['lineTo', ...values]); },
        arc(...values) { this.path.push(['arc', ...values]); },
        stroke() { paints.push({ type: 'brush', path: this.path, state: state(this) }); },
        fill() { paints.push({ type: 'dab', path: this.path, state: state(this) }); }
    };
    function state(value) {
        return Object.fromEntries(['globalAlpha', 'globalCompositeOperation', 'fillStyle', 'strokeStyle', 'filter', 'shadowBlur', 'shadowColor', 'shadowOffsetX', 'shadowOffsetY', 'transform', 'dash', 'lineWidth', 'lineCap', 'lineJoin'].map(key => [key, value[key]]));
    }
    const before = state(context);
    return { width: 1200, height: 800, getContext: () => context, context, paints, paths, before };
}

test('fills rectangle interiors with opaque black while preserving raster size and previous drawing state', () => {
    const canvas = drawingCanvas();
    assert.equal(core.drawRedactions(canvas, [{ type: 'rect', x: 20, y: 30, width: 40, height: 50 }], 600, 400), canvas);
    assert.equal(canvas.width, 1200);
    assert.equal(canvas.height, 800);
    assert.equal(canvas.paints.length, 1);
    assert.equal(canvas.paints[0].type, 'rect');
    assert.deepEqual(canvas.paints[0].values, [20, 30, 40, 50]);
    const painted = canvas.paints[0].state;
    assert.equal(painted.globalAlpha, 1);
    assert.equal(painted.globalCompositeOperation, 'source-over');
    assert.equal(painted.fillStyle, '#000000');
    assert.equal(painted.filter, 'none');
    assert.equal(painted.shadowBlur, 0);
    assert.equal(painted.shadowOffsetX, 0);
    assert.equal(painted.shadowOffsetY, 0);
    assert.deepEqual(painted.transform, [2, 0, 0, 2, 0, 0]);
    for (const [key, value] of Object.entries(canvas.before)) assert.deepEqual(canvas.context[key], value, key);
});

test('clips valid rectangles to the page and safely skips malformed marks', () => {
    const canvas = drawingCanvas();
    const valid = { type: 'rect', x: -10, y: 350, width: 50, height: 100 };
    const invalid = [null, undefined, {}, { type: 'unknown' }, { ...valid, x: NaN }, { ...valid, y: Infinity }, { ...valid, width: -1 }, { ...valid, height: 0 }, { ...valid, width: '50' }];
    core.drawRedactions(canvas, [...invalid, valid, { type: 'rect', x: 700, y: 50, width: 20, height: 30 }], 600, 400);
    assert.equal(canvas.paints.length, 1);
    assert.deepEqual(canvas.paints[0].values, [0, 350, 40, 50]);
    assert.deepEqual(canvas.paths.find(path => path.type === 'clip').path, [['rect', 0, 0, 600, 400]]);
    assert.doesNotThrow(() => core.drawRedactions(canvas, null, 600, 400));
    assert.doesNotThrow(() => core.drawRedactions(canvas, [], 0, 400));
});

test('renders a continuous round freehand stroke and a visible black dab for one-point gestures', () => {
    const canvas = drawingCanvas();
    core.drawRedactions(canvas, [
        { type: 'brush', size: 18, points: [{ x: 10, y: 20 }, { x: 40, y: 50 }, { x: 90, y: 50 }] },
        { type: 'brush', size: 12, points: [{ x: 300, y: 200 }] }
    ], 600, 400);
    assert.equal(canvas.paints.length, 2);
    const stroke = canvas.paints[0];
    assert.equal(stroke.type, 'brush');
    assert.deepEqual(stroke.path, [['moveTo', 10, 20], ['lineTo', 40, 50], ['lineTo', 90, 50]]);
    assert.equal(stroke.state.lineWidth, 18);
    assert.equal(stroke.state.lineCap, 'round');
    assert.equal(stroke.state.lineJoin, 'round');
    assert.deepEqual(stroke.state.dash, []);
    assert.equal(stroke.state.strokeStyle, '#000000');
    assert.equal(stroke.state.globalAlpha, 1);
    assert.equal(stroke.state.globalCompositeOperation, 'source-over');
    const dab = canvas.paints[1];
    assert.equal(dab.type, 'dab');
    assert.deepEqual(dab.path, [['arc', 300, 200, 6, 0, Math.PI * 2]]);
    assert.equal(dab.state.fillStyle, '#000000');
    assert.deepEqual(canvas.context.dash, canvas.before.dash);
});

test('skips an entire malformed brush while valid off-page strokes remain clipped to page bounds', () => {
    const canvas = drawingCanvas();
    const valid = { type: 'brush', size: 20, points: [{ x: -30, y: 60 }, { x: 650, y: 60 }] };
    const invalid = [
        { ...valid, points: [] }, { ...valid, points: null }, { ...valid, points: {} },
        { ...valid, points: [{ x: 10, y: 20 }, null] },
        { ...valid, points: [{ x: 10, y: NaN }] },
        { ...valid, points: [{ x: Infinity, y: 20 }] },
        { ...valid, points: [{ x: '10', y: 20 }] },
        ...[0, -1, NaN, Infinity, '20', null].map(size => ({ ...valid, size }))
    ];
    core.drawRedactions(canvas, [...invalid, valid], 600, 400);
    assert.equal(canvas.paints.length, 1);
    assert.deepEqual(canvas.paints[0].path, [['moveTo', -30, 60], ['lineTo', 650, 60]]);
    assert.deepEqual(canvas.paths.find(path => path.type === 'clip').path, [['rect', 0, 0, 600, 400]]);
});

test('chooses a document raster at the requested scale within edge and memory limits', () => {
    assert.deepEqual(core.chooseRedactionRasterSize(600, 800), { width: 1200, height: 1600, scale: 2 });
    assert.deepEqual(core.chooseRedactionRasterSize(600, 800, 1.5), { width: 900, height: 1200, scale: 1.5 });
    for (const [width, height] of [[10000, 10000], [1000000, 100], [100, 1000000], [2048.5, 2048.5], [0.5, 0.25], [1e308, 1e308]]) {
        const raster = core.chooseRedactionRasterSize(width, height);
        assert.ok(raster.width >= 1 && raster.width <= 4096);
        assert.ok(raster.height >= 1 && raster.height <= 4096);
        assert.ok(raster.width * raster.height <= 8000000);
        assert.ok(raster.scale > 0 && raster.scale <= 2);
        assert.equal(raster.width, Math.max(1, Math.floor(width * raster.scale)));
        assert.equal(raster.height, Math.max(1, Math.floor(height * raster.scale)));
    }
});

test('rejects invalid raster dimensions and render scales before allocating a canvas', () => {
    for (const value of [0, -1, NaN, Infinity, undefined, null, '600']) {
        assert.throws(() => core.chooseRedactionRasterSize(value, 800), /page dimensions/i);
        assert.throws(() => core.chooseRedactionRasterSize(600, value), /page dimensions/i);
    }
    for (const value of [0, -1, NaN, Infinity, null, '2']) {
        assert.throws(() => core.chooseRedactionRasterSize(600, 800, value), /raster scale/i);
    }
});

test('ignores sparse brush point arrays instead of drawing incomplete or invalid geometry', () => {
    const canvas = drawingCanvas();
    const sparse = [{ x: 10, y: 20 }, , { x: 40, y: 50 }];
    assert.doesNotThrow(() => core.drawRedactions(canvas, [
        { type: 'brush', size: 12, points: Array(1) },
        { type: 'brush', size: 12, points: sparse },
        { type: 'brush', size: 12, points: [{ x: 50, y: 50 }] }
    ], 600, 400));
    assert.equal(canvas.paints.length, 1);
});
