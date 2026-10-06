import test from 'node:test';
import assert from 'node:assert/strict';
import { calculateFittedCanvasSize, constrainCanvasPan, zoomCanvasView } from '../canvas-view-core.js';

test('fits images without upscaling while vector pages can fill a large stage', () => {
    assert.deepEqual(calculateFittedCanvasSize(600, 800, 1800, 1600, 16),
        { width: 600, height: 800, scale: 1 });
    assert.deepEqual(calculateFittedCanvasSize(600, 800, 1800, 1600, 16, true),
        { width: 1176, height: 1568, scale: 1.96 });
    assert.deepEqual(calculateFittedCanvasSize(600, 800, 0, 0),
        { width: 0, height: 0, scale: 0 });
});

test('keeps the same image point under the pointer through repeated zoom changes', () => {
    const anchor = { x: 120, y: -80 };
    const state = { zoom: 2, panX: 35, panY: -22 };
    const point = { x: (anchor.x - state.panX) / state.zoom, y: (anchor.y - state.panY) / state.zoom };
    let next = state;
    for (const zoom of [4, 8, 0.5, 2]) {
        next = zoomCanvasView(next, zoom, anchor.x, anchor.y);
        assert.equal((anchor.x - next.panX) / next.zoom, point.x);
        assert.equal((anchor.y - next.panY) / next.zoom, point.y);
    }
    assert.deepEqual(next, state);
});

test('centered zoom scales pan and keeps a fit page centered', () => {
    assert.deepEqual(zoomCanvasView({ zoom: 1, panX: 0, panY: 0 }, 8),
        { zoom: 8, panX: 0, panY: 0 });
    assert.deepEqual(zoomCanvasView({ zoom: 2, panX: 120, panY: -80 }, 4),
        { zoom: 4, panX: 240, panY: -160 });
    assert.deepEqual(constrainCanvasPan(9999, -9999, 800, 600, 8, 1200, 900),
        { x: 3752, y: -2802 });
});
