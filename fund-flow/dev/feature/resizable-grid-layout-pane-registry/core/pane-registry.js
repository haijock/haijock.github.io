/**
 * Pane Registry — self-registering pane system for FundFlow.
 *
 * Integrates with Gridstack so that toggled panes become movable/resizable
 * grid widgets, consistent with the chart and events list.
 *
 * Pane modules call registerPane(descriptor) at import time.
 * The core calls initPanes(host) once during app bootstrap to build toggle
 * buttons. Pane cards are created/destroyed on demand via gridstack's
 * addWidget/removeWidget API when the user clicks a toggle button.
 *
 * refreshPanes(host) re-renders all currently visible panes.
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

// DOM anchor reference for the toggle bar (set during initPanes).
let _toggleBar = null;

// Reference to the FundFlow host (set during initPanes).
let _host = null;

// localStorage key for persisting which panes are visible.
const _STORAGE_KEY = 'fundflow-visible-panes';

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
 * Build toggle buttons and inject pane CSS.
 * Called once by the core during init(), after all pane modules have loaded.
 *
 * Pane card DOM is NOT created here — it is created on demand when the user
 * toggles a pane on, via gridstack's addWidget().
 *
 * @param {Object} host — the FundFlow app object (must have _grid property)
 */
export function initPanes(host) {
    _host = host;
    _toggleBar = document.getElementById('paneToggles');

    if (!_toggleBar) {
        console.warn('pane-registry: missing #paneToggles in DOM');
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
        btn.addEventListener('click', () => _toggle(pane.id));
        _toggleBar.appendChild(btn);
    }

    // --- Restore previously visible panes (or open all by default) ---
    // Pane DOM elements are placed into #gridStack BEFORE gridstack.init()
    // so that gridstack discovers them as first-class items and grid.load()
    // positions them correctly alongside the static widgets (chart, toggles,
    // events).  This avoids the position-drift caused by addWidget() +
    // float:false compaction.
    const saved = localStorage.getItem(_STORAGE_KEY);
    let openIds;
    if (saved) {
        try {
            const parsed = JSON.parse(saved);
            if (Array.isArray(parsed)) openIds = parsed;
        } catch (e) { /* ignore corrupt data */ }
    }
    // Default: open all registered panes on first visit
    if (!openIds) {
        openIds = _panes.map(p => p.id);
    }

    const gridEl = document.getElementById('gridStack');
    const ctx = buildCtx(host);
    const panesToOpen = openIds
        .map(id => _panes.find(p => p.id === id))
        .filter(p => p && !_visible[p.id]);

    for (const pane of panesToOpen) {
        _visible[pane.id] = true;

        // Update toggle button
        if (_toggleBar) {
            const btn = _toggleBar.querySelector('[data-pane="' + pane.id + '"]');
            if (btn) btn.classList.add('active');
        }

        const cardContent = _buildPaneCard(pane, ctx);
        const pos = _getSavedPosition(pane.id);

        // Build a grid-stack-item with gs-* attributes so GridStack.init()
        // picks it up as a pre-existing widget.
        const wrapper = document.createElement('div');
        wrapper.className = 'grid-stack-item';
        wrapper.setAttribute('gs-id', pane.id);
        wrapper.setAttribute('gs-w', String(pos.w));
        wrapper.setAttribute('gs-h', String(pos.h));
        if (pos.x != null) wrapper.setAttribute('gs-x', String(pos.x));
        if (pos.y != null) wrapper.setAttribute('gs-y', String(pos.y));
        if (pos.autoPosition) wrapper.setAttribute('gs-auto-position', 'true');
        wrapper.appendChild(cardContent);
        gridEl.appendChild(wrapper);
    }

    // Render pane content after all elements are in the DOM
    for (const pane of panesToOpen) {
        const contentEl = document.getElementById(pane.id + 'View');
        if (contentEl) pane.render(contentEl, ctx);
    }

    _saveVisibility();
}

/**
 * Refresh all currently visible panes. Called by the core after data changes.
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
    // Remove any pane widgets still in the grid
    const grid = _host && _host._grid;
    if (grid) {
        for (const pane of _panes) {
            const paneCard = document.getElementById(pane.id + 'Pane');
            const widgetEl = paneCard && paneCard.closest('.grid-stack-item');
            if (widgetEl) {
                grid.removeWidget(widgetEl);
            }
        }
    }
    _panes.length = 0;
    for (const key of Object.keys(_visible)) delete _visible[key];
    if (_toggleBar) _toggleBar.innerHTML = '';
    _toggleBar = null;
    _host = null;
    localStorage.removeItem(_STORAGE_KEY);
}

// ---- Internal ----

/**
 * Persist current pane visibility to localStorage.
 */
function _saveVisibility() {
    const open = _panes.filter(p => _visible[p.id]).map(p => p.id);
    localStorage.setItem(_STORAGE_KEY, JSON.stringify(open));
}

/**
 * Build the pane card DOM element (not yet added to the grid).
 * Returns the outer grid-stack-item-content div.
 */
function _buildPaneCard(pane, ctx) {
    const card = document.createElement('div');
    card.className = 'grid-stack-item-content';

    const inner = document.createElement('div');
    inner.className = 'chart-card pane-card';
    inner.id = pane.id + 'Pane';

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
        const headerHtml = pane.header(ctx);
        if (typeof headerHtml === 'string') {
            headerExtra.innerHTML = headerHtml;
        }
        header.appendChild(headerExtra);
    }

    inner.appendChild(header);

    // Content area
    const content = document.createElement('div');
    content.id = pane.id + 'View';
    content.style.cssText = 'overflow-y: auto; flex: 1 1 auto; min-height: 0; padding: 8px 0;';
    inner.appendChild(content);

    card.appendChild(inner);
    return card;
}

/**
 * Try to find saved grid position for a pane from localStorage.
 * Returns widget options or defaults.
 */
function _getSavedPosition(paneId) {
    const defaults = { w: 6, h: 4, id: paneId, autoPosition: true };
    const saved = localStorage.getItem('fundflow-layout');
    if (saved) {
        try {
            const items = JSON.parse(saved);
            const match = items.find(i => i.id === paneId);
            if (match) return { ...match, id: paneId };
        } catch (e) { /* use defaults */ }
    }
    return defaults;
}

/**
 * Toggle a pane on or off via gridstack addWidget/removeWidget.
 */
function _toggle(paneId) {
    _visible[paneId] = !_visible[paneId];

    // Update all toggle button active states
    if (_toggleBar) {
        _toggleBar.querySelectorAll('.pane-toggle').forEach(btn => {
            btn.classList.toggle('active', !!_visible[btn.dataset.pane]);
        });
    }

    const pane = _panes.find(p => p.id === paneId);
    if (!pane) return;

    const grid = _host && _host._grid;

    if (_visible[paneId]) {
        // --- Show: create card and add as gridstack widget ---
        const ctx = buildCtx(_host);
        const cardContent = _buildPaneCard(pane, ctx);

        if (grid) {
            // Create a wrapper element for gridstack
            const wrapper = document.createElement('div');
            wrapper.className = 'grid-stack-item';
            wrapper.appendChild(cardContent);

            const opts = _getSavedPosition(paneId);
            grid.addWidget(wrapper, opts);
            _host._saveGridLayout();
        } else {
            // Fallback if no grid (shouldn't happen in production)
            const container = document.getElementById('gridStack');
            if (container) container.appendChild(cardContent);
        }

        // Render pane content
        const contentEl = document.getElementById(paneId + 'View');
        if (contentEl) pane.render(contentEl, ctx);
    } else {
        // --- Hide: remove widget from grid ---
        if (typeof pane.destroy === 'function') {
            pane.destroy();
        }

        if (grid) {
            // Find the widget element by its pane card id
            const paneCard = document.getElementById(paneId + 'Pane');
            const widgetEl = paneCard && paneCard.closest('.grid-stack-item');
            if (widgetEl) {
                grid.removeWidget(widgetEl);
                _host._saveGridLayout();
            }
        }
    }

    _saveVisibility();
}
