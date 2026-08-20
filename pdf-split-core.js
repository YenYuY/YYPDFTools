function integerPage(value) {
    if (typeof value === 'string' && value.trim() === '') return null;
    const page = Number(value);
    return Number.isInteger(page) ? page : null;
}

export function chunkPageRanges(totalPages, chunkSize = 2) {
    const total = integerPage(totalPages);
    const size = integerPage(chunkSize);
    if (!total || total < 1 || !size || size < 1) return [];

    const ranges = [];
    for (let start = 1; start <= total; start += size) {
        ranges.push({ start, end: Math.min(total, start + size - 1) });
    }
    return ranges;
}

export function validateSplitRanges(rawRanges, totalPages) {
    const total = integerPage(totalPages);
    if (!Array.isArray(rawRanges) || rawRanges.length === 0) {
        return { valid: false, error: 'missing' };
    }

    const ranges = [];
    const assigned = new Set();

    for (let rangeIndex = 0; rangeIndex < rawRanges.length; rangeIndex += 1) {
        const rawRange = rawRanges[rangeIndex] || {};
        const start = integerPage(rawRange.start);
        const end = integerPage(rawRange.end);

        if (start === null || end === null) {
            return { valid: false, error: 'invalid_number', rangeIndex };
        }
        if (!total || total < 1 || start < 1 || end < 1 || start > total || end > total) {
            return { valid: false, error: 'out_of_bounds', rangeIndex };
        }
        if (start > end) {
            return { valid: false, error: 'reversed', rangeIndex };
        }

        for (let page = start; page <= end; page += 1) {
            if (assigned.has(page)) {
                return { valid: false, error: 'overlap', rangeIndex, page };
            }
            assigned.add(page);
        }
        ranges.push({ start, end });
    }

    const assignedPages = [...assigned].sort((first, second) => first - second);
    const unassignedPages = [];
    for (let page = 1; page <= total; page += 1) {
        if (!assigned.has(page)) unassignedPages.push(page);
    }

    return { valid: true, ranges, assignedPages, unassignedPages };
}

export function firstUnassignedPage(rawRanges, totalPages) {
    const total = integerPage(totalPages);
    if (!total || total < 1) return null;

    const assigned = new Set();
    for (const rawRange of Array.isArray(rawRanges) ? rawRanges : []) {
        const start = integerPage(rawRange && rawRange.start);
        const end = integerPage(rawRange && rawRange.end);
        if (start === null || end === null || start > end) continue;
        for (let page = Math.max(1, start); page <= Math.min(total, end); page += 1) assigned.add(page);
    }

    for (let page = 1; page <= total; page += 1) {
        if (!assigned.has(page)) return page;
    }
    return null;
}
