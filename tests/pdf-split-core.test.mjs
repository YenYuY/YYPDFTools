import test from 'node:test';
import assert from 'node:assert/strict';
import {
    chunkPageRanges,
    firstUnassignedPage,
    validateSplitRanges
} from '../pdf-split-core.js';

test('creates one output range for every two pages', () => {
    assert.deepEqual(chunkPageRanges(6, 2), [
        { start: 1, end: 2 },
        { start: 3, end: 4 },
        { start: 5, end: 6 }
    ]);
    assert.deepEqual(chunkPageRanges(5, 2), [
        { start: 1, end: 2 },
        { start: 3, end: 4 },
        { start: 5, end: 5 }
    ]);
});

test('normalizes valid custom ranges and reports omitted pages', () => {
    assert.deepEqual(validateSplitRanges([
        { start: '1', end: '2' },
        { start: 4, end: 5 }
    ], 6), {
        valid: true,
        ranges: [
            { start: 1, end: 2 },
            { start: 4, end: 5 }
        ],
        assignedPages: [1, 2, 4, 5],
        unassignedPages: [3, 6]
    });
});

test('rejects malformed, out-of-bounds, reversed, and overlapping ranges', () => {
    assert.deepEqual(validateSplitRanges([], 6), { valid: false, error: 'missing' });
    assert.deepEqual(validateSplitRanges([{ start: 'x', end: 2 }], 6), {
        valid: false,
        error: 'invalid_number',
        rangeIndex: 0
    });
    assert.deepEqual(validateSplitRanges([{ start: 0, end: 2 }], 6), {
        valid: false,
        error: 'out_of_bounds',
        rangeIndex: 0
    });
    assert.deepEqual(validateSplitRanges([{ start: 4, end: 2 }], 6), {
        valid: false,
        error: 'reversed',
        rangeIndex: 0
    });
    assert.deepEqual(validateSplitRanges([
        { start: 1, end: 3 },
        { start: 3, end: 5 }
    ], 6), {
        valid: false,
        error: 'overlap',
        rangeIndex: 1,
        page: 3
    });
});

test('finds the first page not already assigned to an output', () => {
    assert.equal(firstUnassignedPage([{ start: 1, end: 2 }, { start: 4, end: 4 }], 5), 3);
    assert.equal(firstUnassignedPage([{ start: 1, end: 5 }], 5), null);
});
