/**
 * Pane Registry — self-registering pane system for FundFlow.
 *
 * Pane modules call registerPane(descriptor) at import time.
 * The core calls initPanes() once during app bootstrap to build the DOM,
 * and refreshPanes(ctx) whenever data changes.
 *
 * Testability:
 *   - buildCtx(host) is exported so tests can create mock contexts.
 *   - _reset() clears the registry between test runs.
 *   - getPanes() / getVisible() expose internal state for assertions.
 *   - Pane render functions are pure: (container, ctx) => void.
 *     Pass a detached div and a mock ctx to test in isolation.
 */

// Internal registry — order of registration determines toggle button order.
const _panes = [];

// Visibility state — keyed by pane id.
const _visible = {};

// DOM anchor references (set during initPanes).
let _toggleBar = null;
let _paneContainer = null;

// ---- Public API ----

/**
 * Register a pane with the system.
 *
 * @param {Object} descriptor
 * @param {string}   descriptor.id       — unique key (e.g. 'milestones')
 * @param {string}   descriptor.label    — toggle button text
 * @param {Function} descriptor.render   — (container: HTMLElement, ctx: Object) => void
 * @param {Function} [descriptor.destroy] — called when pane is hidden
 * @param {Function} [descriptor.header]  — (ctx: Object) => string — extra header HTML
 * @param {string}   [descriptor.css]     — CSS string injected once
 */
export function registerPane(descriptor) {
    if (!descriptor.id || !descriptor.label || typeof descriptor.render !== 'function') {
        throw new Error('registerPane: id, label, and render are required');
    }
    if (_panes.some(p => p.id === descriptor.id)) {
        throw new Error('registerPane: duplicate pane id "' + descriptor.id + '"');
    }
    _panes.push(descriptor);
    _visible[descriptor.id] = false;
}

/**
 * Build toggle buttons, pane card containers, and inject CSS.
 * Called once by the core during init(), after all pane modules have loaded.
 *
 * @param {Object} host — the FundFlow app object (used to build ctx)
 */
export function initPanes(host) {
    _toggleBar = document.getElementById('paneToggles');
    _paneContainer = document.getElementById('paneContainer');

    if (!_toggleBar || !_paneContainer) {
        console.warn('pane-registry: missing #paneToggles or #paneContainer in DOM');
        return;
    }

    for (const pane of _panes) {
        // --- Inject pane CSS (once) ---
        if (pane.css) {
            const style = document.createElement('style');
            style.setAttribute('data-pane', pane.id);
            style.textContent = pane.css;
            document.head.appendChild(style);
        }

        // --- Toggle button ---
        const btn = document.createElement('button');
        btn.className = 'pane-toggle';
        btn.dataset.pane = pane.id;
        btn.textContent = pane.label;
        btn.addEventListener('click', () => _toggle(pane.id, host));
        _toggleBar.appendChild(btn);

        // --- Pane card container ---
        const card = document.createElement('div');
        card.className = 'chart-card pane-card';
        card.id = pane.id + 'Pane';
        card.style.display = 'none';

        // Header
        const header = document.createElement('div');
        header.className = 'chart-header';

        const headerLeft = document.createElement('div');
        headerLeft.className = 'chart-header-left';
        const title = document.createElement('span');
        title.className = 'card-title';
        title.textContent = pane.label;
        headerLeft.appendChild(title);
        header.appendChild(headerLeft);

        // Custom header content (legends, mode toggles, etc.)
        if (typeof pane.header === 'function') {
            const headerExtra = document.createElement('div');
            headerExtra.className = 'pane-header-extra';
            headerExtra.id = pane.id + 'HeaderExtra';
            header.appendChild(headerExtra);
        }

        card.appendChild(header);

        // Content area
        const content = document.createElement('div');
        content.id = pane.id + 'View';
        content.style.cssText = 'overflow-y: auto; max-height: 400px; padding: 8px 0;';
        card.appendChild(content);

        _paneContainer.appendChild(card);
    }
}

/**
 * Refresh all currently visible panes. Called by the core after data changes
 * (replaces _refreshVisiblePanes).
 *
 * @param {Object} host — the FundFlow app object
 */
export function refreshPanes(host) {
    const ctx = buildCtx(host);
    for (const pane of _panes) {
        if (_visible[pane.id]) {
            const container = document.getElementById(pane.id + 'View');
            if (container) pane.render(container, ctx);
        }
    }
}

/**
 * Check if a specific pane is currently visible.
 *
 * @param {string} paneId
 * @returns {boolean}
 */
export function isPaneVisible(paneId) {
    return !!_visible[paneId];
}

/**
 * Build the context object that panes receive.
 * Exported so that tests can construct mock contexts using the same shape.
 *
 * @param {Object} host — the FundFlow app object (or a test mock)
 * @returns {Object} ctx — the pane context
 */
export function buildCtx(host) {
    return {
        // Data
        project: (date) => host.project(date),
        get data() { return host.data; },
        get timelineDate() { return host.timelineDate; },

        // Chart config (for panes that need to create charts)
        getChartConfig: (type) => host.getChartConfig(type),

        // Utilities
        formatNumber: (n) => host.formatNumber(n),
        escapeHtml: (s) => host.escapeHtml(s),
        getCurrentRate: () => host.getCurrentRate(),
        showToast: (msg, type) => host.showToast(msg, type),

        // Constants
        MS_PER_DAY: host.MS_PER_DAY,
        DAYS_PER_YEAR: host.DAYS_PER_YEAR,
    };
}

// ---- Test helpers ----

/**
 * Return a shallow copy of the registered panes array.
 * For test assertions only.
 */
export function getPanes() {
    return [..._panes];
}

/**
 * Return a shallow copy of the visibility state.
 * For test assertions only.
 */
export function getVisible() {
    return { ..._visible };
}

/**
 * Clear all registry state. For test isolation between runs.
 * Also removes any injected pane <style> tags from the DOM.
 */
export function _reset() {
    // Remove injected styles
    for (const pane of _panes) {
        const style = document.querySelector('style[data-pane="' + pane.id + '"]');
        if (style) style.remove();
    }
    _panes.length = 0;
    for (const key of Object.keys(_visible)) delete _visible[key];
    if (_toggleBar) _toggleBar.innerHTML = '';
    if (_paneContainer) _paneContainer.innerHTML = '';
    _toggleBar = null;
    _paneContainer = null;
}

// ---- Internal ----

/**
 * Toggle a pane on or off.
 */
function _toggle(paneId, host) {
    _visible[paneId] = !_visible[paneId];

    // Update all toggle button active states
    if (_toggleBar) {
        _toggleBar.querySelectorAll('.pane-toggle').forEach(btn => {
            btn.classList.toggle('active', !!_visible[btn.dataset.pane]);
        });
    }

    const card = document.getElementById(paneId + 'Pane');
    if (!card) return;

    const pane = _panes.find(p => p.id === paneId);
    if (!pane) return;

    if (_visible[paneId]) {
        card.style.display = '';
        const ctx = buildCtx(host);

        // Render custom header if provided
        if (typeof pane.header === 'function') {
            const headerExtra = document.getElementById(paneId + 'HeaderExtra');
            if (headerExtra) {
                const headerHtml = pane.header(ctx);
                if (typeof headerHtml === 'string') {
                    headerExtra.innerHTML = headerHtml;
                }
            }
        }

        const container = document.getElementById(paneId + 'View');
        if (container) pane.render(container, ctx);
    } else {
        card.style.display = 'none';
        if (typeof pane.destroy === 'function') {
            pane.destroy();
        }
    }
}
