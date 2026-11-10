export function createPageOrder(totalPages) {
    if (!Number.isInteger(totalPages) || totalPages < 1) return [];
    return Array.from({ length: totalPages }, (_, index) => index + 1);
}

export function movePage(order, fromIndex, toIndex) {
    const next = [...order];
    if (!Number.isInteger(fromIndex) || !Number.isInteger(toIndex) ||
        fromIndex < 0 || toIndex < 0 || fromIndex >= next.length || toIndex >= next.length ||
        fromIndex === toIndex) return next;
    const [page] = next.splice(fromIndex, 1);
    next.splice(toIndex, 0, page);
    return next;
}

export function removePage(order, pageNumber) {
    if (order.length <= 1) return [...order];
    return order.filter(page => page !== pageNumber);
}

export function getExportPageIndices(order, totalPages) {
    if (!Number.isInteger(totalPages) || totalPages < 1) throw new Error('Invalid source page count');
    if (!Array.isArray(order) || order.length === 0) throw new Error('At least one page is required');
    const pages = new Set();
    for (const page of order) {
        if (!Number.isInteger(page) || page < 1 || page > totalPages || pages.has(page)) {
            throw new Error('Page order contains an invalid or duplicate page');
        }
        pages.add(page);
    }
    return order.map(page => page - 1);
}
