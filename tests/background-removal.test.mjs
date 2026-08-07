import test from 'node:test';
import assert from 'node:assert/strict';
import {
    backgroundRemovalDownloadName,
    canvasPointFromClient,
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
