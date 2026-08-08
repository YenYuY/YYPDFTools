import test from 'node:test';
import assert from 'node:assert/strict';
import {
    VIDEO_OUTPUT_PROFILES,
    VIDEO_COMPRESSION_PROFILES,
    buildVideoCompressionArgs,
    buildVideoConvertArgs,
    buildVideoTrimArgs,
    formatVideoBytes,
    formatVideoTime,
    normalizeVideoTrimRange,
    videoFileExtension,
    videoOutputName,
    videoReductionPercent
} from '../video-tools-core.js';

test('creates safe video output names and extensions', () => {
    assert.equal(videoFileExtension('camera.MOV'), 'mov');
    assert.equal(videoFileExtension('untitled'), 'mp4');
    assert.equal(videoOutputName('trip:day?.mov', 'converted', 'mp4'), 'trip_day__converted.mp4');
});

test('formats media duration and file sizes', () => {
    assert.equal(formatVideoTime(3661.987), '01:01:01');
    assert.equal(formatVideoTime(61.125, true), '00:01:01.125');
    assert.equal(formatVideoBytes(1024 * 1024 * 1.5), '1.50 MB');
});

test('builds format-specific conversion commands', () => {
    const mp4 = buildVideoConvertArgs('mp4', 'input.mov', 'output.mp4');
    assert.deepEqual(mp4.slice(0, 2), ['-i', 'input.mov']);
    assert.ok(mp4.includes('libx264'));
    assert.equal(mp4.at(-1), 'output.mp4');
    assert.equal(VIDEO_OUTPUT_PROFILES.webm.mime, 'video/webm');
    assert.throws(() => buildVideoConvertArgs('bad', 'in', 'out'), /Unsupported output/);
});

test('builds compression commands from quality and resolution', () => {
    const args = buildVideoCompressionArgs('small', '720', 'input.mov', 'output.mp4');
    assert.ok(args.includes('32'));
    assert.ok(args.includes('scale=-2:min(720\\,ih)'));
    assert.equal(args.at(-1), 'output.mp4');
    const vp9 = buildVideoCompressionArgs('balanced', 'original', 'input.mov', 'output.webm', 'vp9');
    assert.ok(vp9.includes('libvpx-vp9'));
    assert.ok(vp9.includes('libopus'));
    assert.equal(VIDEO_COMPRESSION_PROFILES.vp9.extension, 'webm');
    const h265 = buildVideoCompressionArgs('small', '480', 'input.mov', 'output.mp4', 'h265');
    assert.ok(h265.includes('libx265'));
    assert.ok(h265.includes('hvc1'));
    assert.match(VIDEO_COMPRESSION_PROFILES.h265.previewMime, /hvc1/);
});

test('normalizes trim ranges and builds accurate re-encode commands', () => {
    assert.deepEqual(normalizeVideoTrimRange(-1, 7, 5), { start: 0, end: 5, duration: 5 });
    const args = buildVideoTrimArgs(1.25, 3.5, 10, 'input.webm', 'output.mp4');
    assert.deepEqual(args.slice(0, 6), ['-i', 'input.webm', '-ss', '1.250', '-t', '2.250']);
    assert.ok(args.includes('libx264'));
    assert.throws(() => normalizeVideoTrimRange(2, 2.01, 10), /at least/);
});

test('calculates compression reduction without hiding growth', () => {
    assert.equal(videoReductionPercent(1000, 400), 60);
    assert.equal(videoReductionPercent(1000, 1200), -20);
    assert.equal(videoReductionPercent(0, 10), 0);
});
