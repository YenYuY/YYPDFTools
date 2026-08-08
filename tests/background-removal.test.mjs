import test from 'node:test';
import assert from 'node:assert/strict';
import {
    backgroundRemovalDownloadName,
    calculateFittedCanvasSize,
    canvasPointFromClient,
    constrainCanvasPan,
    createModelSessionLoader,
    isSupportedImageFile,
    progressPercent,
    strokeBounds,
    unionBounds
} from '../background-removal-core.js';

test('accepts supported image MIME types and extensions', () => {
    assert.equal(isSupportedImageFile({ type: 'image/png', name: 'photo.bin' }), true);
    assert.equal(isSupportedImageFile({ type: '', name: 'photo.HEIC' }), true);
    assert.equal(isSupportedImageFile({ type: 'application/pdf', name: 'file.pdf' }), false);
});

test('builds a safe transparent PNG download name', () => {
    assert.equal(backgroundRemovalDownloadName('portrait.final.jpg'), 'portrait.final_no_bg.png');
    assert.equal(backgroundRemovalDownloadName('bad:name.png'), 'bad_name_no_bg.png');
});

test('maps a transformed canvas rectangle back to intrinsic pixels', () => {
    const point = canvasPointFromClient(
        { left: 10, top: 20, width: 200, height: 100 },
        1000,
        500,
        110,
        70
    );
    assert.deepEqual(point, { x: 500, y: 250 });
});

test('calculates clipped stroke bounds and unions edit regions', () => {
    assert.deepEqual(
        strokeBounds({ x: 2, y: 2 }, { x: 20, y: 10 }, 5, 100, 80),
        { x: 0, y: 0, width: 27, height: 17 }
    );
    assert.deepEqual(
        unionBounds({ x: 10, y: 10, width: 20, height: 20 }, { x: 0, y: 15, width: 20, height: 30 }),
        { x: 0, y: 10, width: 30, height: 35 }
    );
});

test('normalizes model progress values', () => {
    assert.equal(progressPercent(1, 4), 25);
    assert.equal(progressPercent(8, 4), 100);
    assert.equal(progressPercent(1, 0), 0);
});

test('fits portrait and landscape canvases inside both stage dimensions', () => {
    const portrait = calculateFittedCanvasSize(1152, 1536, 568, 446, 12);
    assert.equal(Math.round(portrait.width), 317);
    assert.equal(portrait.height, 422);
    assert.ok(portrait.width <= 544);

    const landscape = calculateFittedCanvasSize(1536, 1152, 568, 446, 12);
    assert.equal(landscape.width, 544);
    assert.equal(Math.round(landscape.height), 408);
    assert.ok(landscape.height <= 422);

    assert.deepEqual(
        calculateFittedCanvasSize(200, 100, 568, 446, 12),
        { width: 200, height: 100, scale: 1 }
    );
});

test('keeps a fitted canvas centered and bounds a zoomed canvas while panning', () => {
    assert.deepEqual(
        constrainCanvasPan(80, -90, 317, 422, 1, 568, 446),
        { x: 0, y: 0 }
    );

    const zoomed = constrainCanvasPan(1000, -1000, 317, 422, 2, 568, 446, 48);
    assert.deepEqual(zoomed, { x: 553, y: -597 });
});

test('preloads the AI model once and reuses it for later images', async () => {
    let moduleLoads = 0;
    let preloads = 0;
    const modelModule = {
        async preload() { preloads += 1; },
        async removeBackground() {}
    };
    const loader = createModelSessionLoader(async () => {
        moduleLoads += 1;
        return modelModule;
    }, { model: 'small', fetchArgs: { cache: 'force-cache' } });

    const [first, second] = await Promise.all([
        loader.ensureReady(() => {}),
        loader.ensureReady(() => {})
    ]);
    const third = await loader.ensureReady(() => {});

    assert.equal(first, modelModule);
    assert.equal(second, modelModule);
    assert.equal(third, modelModule);
    assert.equal(moduleLoads, 1);
    assert.equal(preloads, 1);
    assert.equal(loader.isReady(), true);
});
