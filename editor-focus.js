const editors = [
    { button: document.getElementById('watermark-expand'), selector: '.watermark-workbench' },
    { button: document.getElementById('removebg-expand'), selector: '.removebg-workbench' }
];
let active = null;
const t = key => window.YYYTools.t(key);

function refreshLabels() {
    for (const { button } of editors) {
        button.textContent = t(active?.button === button ? 'editor_collapse' : 'editor_expand');
    }
    if (active) active.element.setAttribute('aria-label', t(active.element.dataset.editorLabel));
}

function restoreAttribute(element, key, value) {
    if (value === null) element.removeAttribute(key);
    else element.setAttribute(key, value);
}

function closeEditor() {
    if (!active) return;
    const { element, button, attributes, inertElements, overflow, scrollX, scrollY } = active;
    active = null;
    element.classList.remove('editor-expanded');
    button.setAttribute('aria-expanded', 'false');
    for (const [key, value] of attributes) restoreAttribute(element, key, value);
    for (const [sibling, wasInert] of inertElements) sibling.inert = wasInert;
    document.body.style.overflow = overflow;
    refreshLabels();
    button.focus({ preventScroll: true });
    window.scrollTo({ left: scrollX, top: scrollY, behavior: 'instant' });
}

function openEditor(element, button) {
    closeEditor();
    const attributes = ['role', 'aria-modal', 'aria-label'].map(key => [key, element.getAttribute(key)]);
    const inertElements = [];
    // Leave the editor's ancestor path active and make surrounding app controls inert.
    for (let node = element; node && node !== document.body; node = node.parentElement) {
        for (const sibling of node.parentElement.children) {
            if (sibling === node || !(sibling instanceof HTMLElement) || sibling.id === 'toast') continue;
            inertElements.push([sibling, sibling.inert]);
            sibling.inert = true;
        }
    }
    active = { element, button, attributes, inertElements, overflow: document.body.style.overflow,
        scrollX: window.scrollX, scrollY: window.scrollY };
    element.classList.add('editor-expanded');
    element.setAttribute('role', 'dialog');
    element.setAttribute('aria-modal', 'true');
    document.body.style.overflow = 'hidden';
    button.setAttribute('aria-expanded', 'true');
    refreshLabels();
    button.focus({ preventScroll: true });
}

for (const { button, selector } of editors) {
    button.addEventListener('click', () => {
        if (active?.button === button) closeEditor();
        else openEditor(button.closest(selector), button);
    });
}

document.addEventListener('keydown', event => {
    if (!active || event.defaultPrevented) return;
    if (event.key === 'Escape') {
        event.preventDefault();
        closeEditor();
    } else if (event.key === 'Tab') {
        const controls = [...active.element.querySelectorAll('button, input, select, summary, a[href], canvas[tabindex]')]
            .filter(element => {
                const closedDetails = element.closest('details:not([open])');
                return !element.matches(':disabled') && !element.closest('[inert]') &&
                    (!closedDetails || element.tagName === 'SUMMARY') && element.getClientRects().length;
            });
        const first = controls[0];
        const last = controls.at(-1);
        if (event.shiftKey && document.activeElement === first) {
            event.preventDefault();
            last?.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
            event.preventDefault();
            first?.focus();
        }
    }
});

window.addEventListener('yyy:languagechange', refreshLabels);
window.addEventListener('yyy:tabchange', closeEditor);
window.addEventListener('yyy:editorreset', closeEditor);
refreshLabels();
