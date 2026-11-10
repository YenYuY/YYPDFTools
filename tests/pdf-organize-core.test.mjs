import test from 'node:test';
import assert from 'node:assert/strict';
import * as organizer from '../pdf-organize-core.js';

test('creates a page order using original one-based page numbers', () => {
    assert.deepEqual(organizer.createPageOrder(4), [1, 2, 3, 4]);
    assert.deepEqual(organizer.createPageOrder(1), [1]);
});

test('invalid page counts create an empty order', () => {
    for (const count of [0, -1, 1.5, NaN, Infinity, '3', null, undefined]) {
        assert.deepEqual(organizer.createPageOrder(count), []);
    }
});

test('moving pages uses their final destination index without mutating the source', () => {
    const order = Object.freeze([1, 2, 3, 4]);
    assert.deepEqual(organizer.movePage(order, 0, 3), [2, 3, 4, 1]);
    assert.deepEqual(organizer.movePage(order, 3, 0), [4, 1, 2, 3]);
    assert.deepEqual(organizer.movePage(order, 1, 2), [1, 3, 2, 4]);
    assert.deepEqual(order, [1, 2, 3, 4]);
});

test('invalid or unchanged move positions return an independent unchanged order', () => {
    const order = Object.freeze([3, 1, 4]);
    for (const [from, to] of [[-1, 0], [0, -1], [3, 0], [0, 3], [0.5, 1], [1, NaN], ['0', 1], [1, 1]]) {
        const next = organizer.movePage(order, from, to);
        assert.deepEqual(next, order);
        assert.notEqual(next, order);
    }
    assert.deepEqual(organizer.movePage([], 0, 0), []);
});

test('deleting identifies the original page after sorting and leaves other pages unchanged', () => {
    const order = Object.freeze([4, 1, 3, 2]);
    assert.deepEqual(organizer.removePage(order, 1), [4, 3, 2]);
    assert.deepEqual(organizer.removePage(order, 4), [1, 3, 2]);
    assert.deepEqual(organizer.removePage(order, 2), [4, 1, 3]);
    assert.deepEqual(order, [4, 1, 3, 2]);
});

test('deleting the final page or a missing page keeps an independent unchanged order', () => {
    const finalPage = Object.freeze([7]);
    assert.deepEqual(organizer.removePage(finalPage, 7), [7]);
    assert.notEqual(organizer.removePage(finalPage, 7), finalPage);
    const order = Object.freeze([3, 1]);
    assert.deepEqual(organizer.removePage(order, 2), [3, 1]);
    assert.notEqual(organizer.removePage(order, 2), order);
});

test('export maps reordered remaining pages to zero-based source indices', () => {
    const order = Object.freeze([4, 1, 3]);
    assert.deepEqual(organizer.getExportPageIndices(order, 5), [3, 0, 2]);
    assert.deepEqual(organizer.getExportPageIndices([1], 1), [0]);
    assert.deepEqual(order, [4, 1, 3]);
});

test('export rejects missing pages, duplicates, noninteger pages and out-of-range pages', () => {
    for (const order of [[], null, undefined, '1,2', [1, 1], [0, 2], [-1], [4], [1.5], ['1'], [NaN], [Infinity]]) {
        assert.throws(() => organizer.getExportPageIndices(order, 3));
    }
});

test('export requires a positive integer source page count', () => {
    for (const count of [0, -1, 1.5, NaN, Infinity, '3', null, undefined]) {
        assert.throws(() => organizer.getExportPageIndices([1], count));
    }
});

test('a sequence of sort and delete edits exports exactly the visible surviving order', () => {
    const original = organizer.createPageOrder(6);
    const sorted = organizer.movePage(original, 5, 0);
    const deleted = organizer.removePage(sorted, 2);
    const final = organizer.movePage(deleted, 3, 1);
    assert.deepEqual(final, [6, 4, 1, 3, 5]);
    assert.deepEqual(organizer.getExportPageIndices(final, 6), [5, 3, 0, 2, 4]);
    assert.deepEqual(original, [1, 2, 3, 4, 5, 6]);
    assert.deepEqual(sorted, [6, 1, 2, 3, 4, 5]);
    assert.deepEqual(deleted, [6, 1, 3, 4, 5]);
});
