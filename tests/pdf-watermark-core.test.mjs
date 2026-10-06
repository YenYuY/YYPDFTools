import test from 'node:test';
import assert from 'node:assert/strict';
import * as core from '../pdf-watermark-core.js';

test('normalizes text and supplies complete watermark defaults and zero-based pages', () => {
    const result = core.validateWatermarkOptions({ text: '  機密文件  ' }, 3);
    assert.equal(result.valid, true);
    assert.equal(result.options.text, '機密文件');
    assert.equal(result.options.font, 'sans');
    assert.equal(result.options.fontSize, 48);
    assert.equal(result.options.layout, 'single');
    assert.equal(result.options.position, 'center');
    assert.deepEqual(result.options, { ...core.WATERMARK_DEFAULTS, text: '機密文件' });
    assert.deepEqual(result.pageIndices, [0, 1, 2]);
});

test('rejects blank or overlong text and counts Unicode code points', () => {
    for (const text of ['', '  \n ', null, 123, '字'.repeat(121), '😀'.repeat(121)]) {
        assert.deepEqual(core.validateWatermarkOptions({ text }, 3), { valid: false, error: 'text' });
    }
    assert.equal(core.validateWatermarkOptions({ text: '😀'.repeat(120) }, 3).valid, true);
    assert.equal(core.validateWatermarkOptions({ text: '日本語の透かし' }, 3).valid, true);
});

test('validates every numeric effect and accepts numeric input strings', () => {
    const limits = { fontSize: [10, 144], opacity: [0.05, 1], angle: [-180, 180], spacing: [0, 240] };
    for (const [key, [min, max]] of Object.entries(limits)) {
        for (const value of ['', '  ', null, false, [], {}, NaN, Infinity, 'abc', min - 0.01, max + 0.01]) {
            assert.deepEqual(core.validateWatermarkOptions({ [key]: value }, 3), { valid: false, error: key }, `${key}: ${String(value)}`);
        }
        for (const value of [min, max, String(min), String(max)]) {
            const result = core.validateWatermarkOptions({ [key]: value }, 3);
            assert.equal(result.valid, true);
            assert.equal(result.options[key], Number(value));
        }
    }
});

test('rejects unsupported fonts, layouts, positions, page modes, and malformed colors', () => {
    for (const [key, values] of Object.entries({ font: ['custom', '', null], layout: ['tile', '', null], position: ['left', '', null], color: ['red', '#fff', '#12345678', ' #64748b', null] })) {
        for (const value of values) assert.deepEqual(core.validateWatermarkOptions({ [key]: value }, 3), { valid: false, error: key });
    }
    for (const pageMode of ['some', '', null]) assert.deepEqual(core.validateWatermarkOptions({ pageMode }, 3), { valid: false, error: 'pages' });
    for (const font of ['sans', 'serif', 'mono']) assert.equal(core.validateWatermarkOptions({ font }, 3).valid, true);
    assert.equal(core.validateWatermarkOptions({ color: '#Ab12EF', position: 'top-left', layout: 'repeat' }, 3).valid, true);
});

test('parses inclusive page ranges, whitespace, duplicates, and produces sorted zero-based indices', () => {
    const raw = { pageMode: 'custom', pageRange: ' 5 , 1, 3 - 5, 1 , 7 ' };
    const result = core.validateWatermarkOptions(raw, 7);
    assert.equal(result.valid, true);
    assert.deepEqual(result.pageIndices, [0, 2, 3, 4, 6]);
    assert.equal(result.options.pageRange, raw.pageRange.trim());
    for (const pageRange of ['', ' ', '0', '8', '5-3', '1,', ',1', '1,,3', '1.5', '-1', '1-2-3', '1e0', '2 x', '1-8', '1;3', null, 1]) {
        assert.deepEqual(core.validateWatermarkOptions({ pageMode: 'custom', pageRange }, 7), { valid: false, error: 'pages' }, String(pageRange));
    }
    assert.equal(core.validateWatermarkOptions({ pageRange: 'invalid ignored in all mode' }, 7).valid, true);
});

test('rejects invalid page counts and accepts explicitly undefined fields as missing defaults', () => {
    for (const total of [0, -1, 2.5, NaN, Infinity, '', null, '3']) {
        assert.deepEqual(core.validateWatermarkOptions({}, total), { valid: false, error: 'pages' });
    }
    const result = core.validateWatermarkOptions({ font: undefined, fontSize: undefined, text: undefined }, 2);
    assert.equal(result.valid, true);
    assert.deepEqual(result.options, core.WATERMARK_DEFAULTS);
    assert.deepEqual(core.validateWatermarkOptions(null, 2).options, core.WATERMARK_DEFAULTS);
});

function pdfPage(crop, rotation, media) {
    return { getCropBox: () => crop, getRotation: () => ({ angle: rotation }), ...(media ? { getMediaBox: () => media } : {}) };
}

test('reads crop origins and normalizes all quarter-turn page orientations', () => {
    for (const rotation of [0, 90, 180, 270, -90, 450]) {
        const normalized = ((rotation % 360) + 360) % 360;
        assert.deepEqual(core.watermarkPageGeometry(pdfPage({ x: 30, y: -10, width: 400, height: 600 }, rotation)), {
            x: 30, y: -10, width: 400, height: 600, rotation: normalized,
            displayWidth: normalized % 180 ? 600 : 400,
            displayHeight: normalized % 180 ? 400 : 600
        });
    }
});

test('clips the crop rectangle to the media box and falls back to media for a disjoint crop', () => {
    assert.deepEqual(core.watermarkPageGeometry(pdfPage(
        { x: -20, y: 30, width: 500, height: 700 }, 90,
        { x: 0, y: 0, width: 400, height: 600 }
    )), { x: 0, y: 30, width: 400, height: 570, rotation: 90, displayWidth: 570, displayHeight: 400 });
    const disjointCrop = { x: 800, y: 900, width: 400, height: 600 };
    assert.deepEqual(core.watermarkPageGeometry(pdfPage(disjointCrop, 0, { x: 0, y: 0, width: 400, height: 600 })), {
        x: 0, y: 0, width: 400, height: 600, rotation: 0, displayWidth: 400, displayHeight: 600
    });
});

function rotatePoint(x, y, degrees) {
    const radians = degrees * Math.PI / 180;
    return { x: x * Math.cos(radians) - y * Math.sin(radians), y: x * Math.sin(radians) + y * Math.cos(radians) };
}

function displayedPoint(point, geometry) {
    const x = point.x - geometry.x;
    const y = point.y - geometry.y;
    switch (geometry.rotation) {
        case 0: return [x, geometry.height - y];
        case 90: return [y, x];
        case 180: return [geometry.width - x, y];
        case 270: return [geometry.height - y, geometry.width - x];
    }
}

test('places the four overlay corners at the same visible-page corners for every rotation and crop origin', () => {
    for (const rotation of [0, 90, 180, 270]) {
        const geometry = core.watermarkPageGeometry(pdfPage({ x: -32, y: 75, width: 400, height: 600 }, rotation));
        const placement = core.watermarkOverlayPlacement(geometry);
        assert.equal(placement.width, geometry.displayWidth);
        assert.equal(placement.height, geometry.displayHeight);
        const corners = [[0, 0], [placement.width, 0], [0, placement.height], [placement.width, placement.height]];
        const expected = [[0, geometry.displayHeight], [geometry.displayWidth, geometry.displayHeight], [0, 0], [geometry.displayWidth, 0]];
        corners.forEach(([x, y], index) => {
            const rotated = rotatePoint(x, y, placement.angle);
            const displayed = displayedPoint({ x: rotated.x + placement.x, y: rotated.y + placement.y }, geometry);
            displayed.forEach((coordinate, axis) => assert.ok(Math.abs(coordinate - expected[index][axis]) < 1e-8, `rotation ${rotation}, corner ${index}, axis ${axis}`));
        });
    }
});

function fakeCanvas() {
    const calls = [];
    const context = {
        font: '', fillStyle: '', globalAlpha: 1,
        setTransform: (...args) => calls.push(['setTransform', ...args]),
        clearRect: (...args) => calls.push(['clearRect', ...args]),
        save: () => calls.push(['save']), restore: () => calls.push(['restore']),
        translate: (...args) => calls.push(['translate', ...args]),
        rotate: (...args) => calls.push(['rotate', ...args]),
        fillText: (...args) => calls.push(['fillText', ...args]),
        measureText(text) { return { width: Array.from(text).length * parseFloat(this.font) * 0.6 }; }
    };
    return { width: 0, height: 0, calls, context, getContext: () => context };
}

test('paints a transparent Unicode overlay with native font, opacity, clockwise angle and a centered anchor', () => {
    const canvas = fakeCanvas();
    assert.equal(core.drawWatermarkOverlay(canvas, 400, 600, { ...core.WATERMARK_DEFAULTS, text: '你好日本語', angle: 30, color: '#aabbcc', opacity: 0.4 }), canvas);
    assert.equal(canvas.width, 800);
    assert.equal(canvas.height, 1200);
    assert.match(canvas.context.font, /48px.*sans-serif/);
    assert.equal(canvas.context.fillStyle, '#aabbcc');
    assert.equal(canvas.context.globalAlpha, 0.4);
    assert.equal(canvas.context.textAlign, 'center');
    assert.equal(canvas.context.textBaseline, 'middle');
    assert.deepEqual(canvas.calls[0], ['setTransform', 2, 0, 0, 2, 0, 0]);
    assert.deepEqual(canvas.calls[1], ['clearRect', 0, 0, 400, 600]);
    assert.deepEqual(canvas.calls.find(call => call[0] === 'translate'), ['translate', 200, 300]);
    assert.deepEqual(canvas.calls.find(call => call[0] === 'rotate'), ['rotate', Math.PI / 6]);
    assert.deepEqual(canvas.calls.find(call => call[0] === 'fillText'), ['fillText', '你好日本語', 0, 0]);
});

test('positions each single watermark inside its page margins including rotated long text', () => {
    for (const angle of [0, 35, -35, 90, 180, -180]) {
        for (const position of ['center', 'top-left', 'top-right', 'bottom-left', 'bottom-right']) {
            const options = { ...core.WATERMARK_DEFAULTS, angle, position };
            const layout = core.watermarkLayout(220, 120, options, { width: 1600, height: 60 });
            assert.equal(layout.marks.length, 1);
            assert.ok(layout.fontScale > 0 && layout.fontScale <= 1);
            const mark = layout.marks[0];
            assert.ok(mark.x - layout.boundsWidth / 2 >= layout.margin - 1e-8);
            assert.ok(mark.y - layout.boundsHeight / 2 >= layout.margin - 1e-8);
            assert.ok(mark.x + layout.boundsWidth / 2 <= 220 - layout.margin + 1e-8);
            assert.ok(mark.y + layout.boundsHeight / 2 <= 120 - layout.margin + 1e-8);
            if (position.includes('left')) assert.ok(Math.abs(mark.x - layout.boundsWidth / 2 - layout.margin) < 1e-8);
            if (position.includes('right')) assert.ok(Math.abs(mark.x + layout.boundsWidth / 2 - 220 + layout.margin) < 1e-8);
            if (position.includes('top')) assert.ok(Math.abs(mark.y - layout.boundsHeight / 2 - layout.margin) < 1e-8);
            if (position.includes('bottom')) assert.ok(Math.abs(mark.y + layout.boundsHeight / 2 - 120 + layout.margin) < 1e-8);
        }
    }
});

test('drawing uses fitted size and the chosen corner for a long watermark', () => {
    const canvas = fakeCanvas();
    const options = { ...core.WATERMARK_DEFAULTS, text: '機密文件'.repeat(30), angle: 90, position: 'bottom-right' };
    const metrics = { width: 120 * 48 * 0.6, height: 48 * 1.2 };
    const layout = core.watermarkLayout(300, 200, options, metrics);
    core.drawWatermarkOverlay(canvas, 300, 200, options);
    assert.ok(Math.abs(parseFloat(canvas.context.font) - options.fontSize * layout.fontScale) < 1e-8);
    assert.deepEqual(canvas.calls.find(call => call[0] === 'translate'), ['translate', layout.marks[0].x, layout.marks[0].y]);
});

function watermarkAxisCoordinates(layout, width, height, angle) {
    const radians = angle * Math.PI / 180;
    const cosine = Math.cos(radians);
    const sine = Math.sin(radians);
    const points = layout.marks.map(mark => {
        const x = mark.x - width / 2;
        const y = mark.y - height / 2;
        return { x: x * cosine + y * sine, y: -x * sine + y * cosine };
    });
    const unique = axis => [...new Set(points.map(point => Number(point[axis].toFixed(7))))].sort((a, b) => a - b);
    return { points, xs: unique('x'), ys: unique('y') };
}

test('repeated long Chinese and English watermarks have many diagonal rows with text-axis spacing', () => {
    for (const angle of [-35, 35]) {
        for (const [text, metrics] of [['僅供文件審閱使用', { width: 700, height: 58 }], ['CONFIDENTIAL DOCUMENT FOR INTERNAL REVIEW ONLY', { width: 2400, height: 58 }]]) {
            const options = { ...core.WATERMARK_DEFAULTS, text, layout: 'repeat', angle, spacing: 20 };
            const layout = core.watermarkLayout(595, 842, options, metrics);
            const { xs, ys } = watermarkAxisCoordinates(layout, 595, 842, angle);
            assert.ok(ys.length >= 10, `angle ${angle}, text ${text}: ${ys.length} rows`);
            assert.equal(xs.length * ys.length, layout.marks.length);
            for (let index = 1; index < ys.length; index += 1) {
                assert.ok(Math.abs(ys[index] - ys[index - 1] - metrics.height * layout.fontScale - options.spacing) < 1e-6);
            }
        }
    }
});

test('repeated row pitch follows unrotated text height and changes smoothly with spacing', () => {
    const metrics = { width: 300, height: 48 };
    for (const angle of [0, 35, -35, 90, 180, -180]) {
        for (const spacing of [0, 20, 80, 81, 240]) {
            const options = { ...core.WATERMARK_DEFAULTS, layout: 'repeat', angle, spacing };
            const layout = core.watermarkLayout(595, 842, options, metrics);
            assert.equal(layout.fontScale, 1);
            const { ys } = watermarkAxisCoordinates(layout, 595, 842, angle);
            assert.ok(ys.length > 1);
            assert.ok(Math.abs(ys[1] - ys[0] - metrics.height - spacing) < 1e-6, `angle ${angle}, spacing ${spacing}`);
        }
    }
});

test('repeated grids extend beyond every page edge without duplicate or non-finite centers', () => {
    const metrics = { width: 420, height: 58 };
    for (const [width, height] of [[595, 842], [842, 595], [220, 120], [100, 20]]) {
        for (const angle of [0, 35, -35, 90, 180, -180]) {
            const options = { ...core.WATERMARK_DEFAULTS, layout: 'repeat', angle, spacing: 20 };
            const layout = core.watermarkLayout(width, height, options, metrics);
            const radians = angle * Math.PI / 180;
            const halfWidth = Math.abs(Math.cos(radians)) * width / 2 + Math.abs(Math.sin(radians)) * height / 2;
            const halfHeight = Math.abs(Math.sin(radians)) * width / 2 + Math.abs(Math.cos(radians)) * height / 2;
            const { xs, ys } = watermarkAxisCoordinates(layout, width, height, angle);
            assert.ok(xs[0] <= -halfWidth - metrics.width * layout.fontScale / 2 + 1e-6);
            assert.ok(xs.at(-1) >= halfWidth + metrics.width * layout.fontScale / 2 - 1e-6);
            assert.ok(ys[0] <= -halfHeight - metrics.height * layout.fontScale / 2 + 1e-6);
            assert.ok(ys.at(-1) >= halfHeight + metrics.height * layout.fontScale / 2 - 1e-6);
            assert.ok(Math.abs(xs[0] + xs.at(-1)) < 1e-6);
            assert.ok(Math.abs(ys[0] + ys.at(-1)) < 1e-6);
            assert.equal(new Set(layout.marks.map(mark => `${mark.x.toFixed(7)},${mark.y.toFixed(7)}`)).size, layout.marks.length);
            assert.ok(layout.marks.every(mark => Number.isFinite(mark.x) && Number.isFinite(mark.y)));
            assert.ok(layout.marks.some(mark => mark.x < 0));
            assert.ok(layout.marks.some(mark => mark.x > width));
            assert.ok(layout.marks.some(mark => mark.y < 0));
            assert.ok(layout.marks.some(mark => mark.y > height));
        }
    }
});

test('zero-gap copies reach and clip at each page edge for positive and negative rotations', () => {
    const width = 595;
    const height = 842;
    const metrics = { width: 420, height: 58 };
    const edgePoints = [{ x: 0, y: height / 2 }, { x: width, y: height / 2 }, { x: width / 2, y: 0 }, { x: width / 2, y: height }];
    for (const angle of [0, 35, -35, 90, -90, 180, -180]) {
        const options = { ...core.WATERMARK_DEFAULTS, layout: 'repeat', angle, spacing: 0 };
        const layout = core.watermarkLayout(width, height, options, metrics);
        const radians = angle * Math.PI / 180;
        const cosine = Math.cos(radians);
        const sine = Math.sin(radians);
        const halfWidth = metrics.width * layout.fontScale / 2;
        const halfHeight = metrics.height * layout.fontScale / 2;
        for (const edge of edgePoints) {
            assert.ok(layout.marks.some(mark => {
                const x = edge.x - mark.x;
                const y = edge.y - mark.y;
                return Math.abs(cosine * x + sine * y) <= halfWidth + 1e-7 && Math.abs(-sine * x + cosine * y) <= halfHeight + 1e-7;
            }), `angle ${angle}, edge (${edge.x}, ${edge.y})`);
        }
        const mirrored = core.watermarkLayout(width, height, { ...options, angle: -angle }, metrics);
        assert.equal(mirrored.marks.length, layout.marks.length);
    }
});

test('zero-gap repetition is denser and increasing spacing never adds rows or columns', () => {
    const metrics = { width: 400, height: 58 };
    for (const angle of [0, 35, -35, 90, 180]) {
        let previousCount = Infinity;
        let denseCount;
        for (const spacing of [0, 20, 40, 80, 120, 180, 240]) {
            const layout = core.watermarkLayout(595, 842, { ...core.WATERMARK_DEFAULTS, layout: 'repeat', angle, spacing }, metrics);
            if (spacing === 0) denseCount = layout.marks.length;
            assert.ok(layout.marks.length <= previousCount);
            previousCount = layout.marks.length;
        }
        assert.ok(denseCount > previousCount);
    }
    const canvas = fakeCanvas();
    core.drawWatermarkOverlay(canvas, 400, 600, { ...core.WATERMARK_DEFAULTS, layout: 'repeat', spacing: 0 });
    assert.ok(canvas.calls.filter(call => call[0] === 'fillText').length > 1);
});

test('very large and narrow pages spread at most 500 repeated marks across the complete grid', () => {
    const metrics = { width: 40, height: 12 };
    for (const [width, height] of [[1000000, 1000000], [1000000, 100], [100, 1000000]]) {
        for (const angle of [0, 35, -35, 90, 180]) {
            const layout = core.watermarkLayout(width, height, { ...core.WATERMARK_DEFAULTS, layout: 'repeat', angle, spacing: 0 }, metrics);
            const { xs, ys } = watermarkAxisCoordinates(layout, width, height, angle);
            const radians = angle * Math.PI / 180;
            const halfWidth = Math.abs(Math.cos(radians)) * width / 2 + Math.abs(Math.sin(radians)) * height / 2;
            const halfHeight = Math.abs(Math.sin(radians)) * width / 2 + Math.abs(Math.cos(radians)) * height / 2;
            assert.ok(layout.marks.length > 1 && layout.marks.length <= 500);
            assert.equal(xs.length * ys.length, layout.marks.length);
            assert.ok(xs[0] <= -halfWidth && xs.at(-1) >= halfWidth);
            assert.ok(ys[0] <= -halfHeight && ys.at(-1) >= halfHeight);
            assert.ok(Math.abs(xs[0] + xs.at(-1)) < 1e-6);
            assert.ok(Math.abs(ys[0] + ys.at(-1)) < 1e-6);
            assert.ok(layout.marks.every(mark => Number.isFinite(mark.x) && Number.isFinite(mark.y)));
        }
    }
});

test('limits raster dimensions and pixels while scaling both axes consistently', () => {
    for (const [width, height] of [[10000, 10000], [1000000, 100], [100, 1000000], [2048.5, 2048.5], [0.5, 0.25]]) {
        const canvas = fakeCanvas();
        core.drawWatermarkOverlay(canvas, width, height, core.WATERMARK_DEFAULTS);
        assert.ok(canvas.width >= 1 && canvas.width <= 4096);
        assert.ok(canvas.height >= 1 && canvas.height <= 4096);
        assert.ok(canvas.width * canvas.height <= 8000000);
        const transform = canvas.calls[0];
        assert.equal(transform[1], canvas.width / width);
        assert.equal(transform[4], canvas.height / height);
        assert.ok(Math.abs(canvas.width / canvas.height - width / height) <= Math.max(width / height, 1) / Math.min(canvas.width, canvas.height));
    }
    for (const [width, height] of [[0, 100], [100, -10], [NaN, 100], [100, Infinity]]) {
        assert.throws(() => core.drawWatermarkOverlay(fakeCanvas(), width, height, core.WATERMARK_DEFAULTS), /page dimensions/i);
    }
});

test('treats invalid page rotation as zero like PDF.js instead of failing overlay placement', () => {
    for (const rotation of [45, -45, 1, NaN, Infinity, undefined]) {
        const geometry = core.watermarkPageGeometry(pdfPage({ x: 10, y: 20, width: 300, height: 400 }, rotation));
        assert.equal(geometry.rotation, 0);
        assert.deepEqual(core.watermarkOverlayPlacement(geometry), { x: 10, y: 20, width: 300, height: 400, angle: 0 });
    }
});
