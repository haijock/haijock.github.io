/**
 * Priority Queue Pane — ranks CapEx expenses by funding urgency.
 *
 * Has two display modes: "full" (detailed cards) and "compact" (single-line rows).
 * The mode toggle is rendered via the header() descriptor function.
 */

import { registerPane } from 'fundflow/panes';

let priorityMode = 'full';

// ---- Header: mode toggle buttons ----

function header(ctx) {
    return '<div class="pane-mode-toggle">' +
        '<button class="pane-mode-btn' + (priorityMode === 'full' ? ' active' : '') + '" data-priority-mode="full">Full</button>' +
        '<button class="pane-mode-btn' + (priorityMode === 'compact' ? ' active' : '') + '" data-priority-mode="compact">Compact</button>' +
        '</div>';
}

// ---- Render dispatcher ----

function render(container, ctx) {
    // Bind mode toggle clicks (delegated).
    // Always re-bind because the DOM element is destroyed/recreated each time
    // the pane is toggled off and back on via gridstack removeWidget/addWidget.
    const headerExtra = document.getElementById('priorityHeaderExtra');
    if (headerExtra) {
        // Replace node to strip old listeners (idempotent for fresh nodes)
        const fresh = headerExtra.cloneNode(true);
        headerExtra.parentNode.replaceChild(fresh, headerExtra);
        fresh.addEventListener('click', (e) => {
            const btn = e.target.closest('[data-priority-mode]');
            if (!btn) return;
            priorityMode = btn.dataset.priorityMode;
            // Update button active states
            fresh.querySelectorAll('.pane-mode-btn').forEach(b => {
                b.classList.toggle('active', b.dataset.priorityMode === priorityMode);
            });
            render(container, ctx);
        });
    }

    if (priorityMode === 'compact') {
        renderCompact(container, ctx);
    } else {
        renderFull(container, ctx);
    }
}

// ---- Compact mode: single-line rows ----

function renderCompact(container, ctx) {
    const proj = ctx.project(ctx.timelineDate);
    const capexItems = proj.expenses.filter(e => e.type === 'capex');

    if (capexItems.length === 0) {
        container.innerHTML = '<div class="empty-state">No CapEx items to prioritize</div>';
        return;
    }

    const ranked = capexItems.map(exp => {
        let urgencyDays = Infinity;
        let urgencyLabel = '';
        let urgencyColor = 'var(--text-muted)';

        if (exp.progress >= 100) {
            urgencyLabel = 'Fully funded';
            urgencyColor = 'var(--accent-primary)';
            urgencyDays = Infinity;
        } else if (exp.scheduledDate && exp.projectedDate) {
            const schedMs = new Date(exp.scheduledDate).getTime();
            const projMs = new Date(exp.projectedDate).getTime();
            urgencyDays = (schedMs - projMs) / (24 * 60 * 60 * 1000);

            if (urgencyDays < 0) {
                urgencyLabel = Math.abs(Math.round(urgencyDays)) + 'd behind';
                urgencyColor = 'var(--accent-danger)';
            } else if (urgencyDays < 90) {
                urgencyLabel = Math.round(urgencyDays) + 'd margin';
                urgencyColor = 'var(--accent-warning)';
            } else {
                urgencyLabel = Math.round(urgencyDays) + 'd margin';
                urgencyColor = 'var(--accent-primary)';
            }
        } else {
            urgencyLabel = 'No schedule';
        }

        return { ...exp, urgencyDays, urgencyLabel, urgencyColor };
    }).sort((a, b) => a.urgencyDays - b.urgencyDays);

    container.innerHTML = ranked.map((item, i) => {
        const pct = Math.min(100, Math.round(item.progress || 0));
        return '<div class="priority-row" style="display: flex; align-items: center; gap: 10px; padding: 8px 12px; border-bottom: 1px solid var(--border-subtle);">' +
            '<span style="font-size: 0.7rem; color: var(--text-muted); min-width: 18px;">#' + (i + 1) + '</span>' +
            '<span style="flex: 1; font-size: 0.8rem; font-weight: 500;">' + item.name + '</span>' +
            '<span style="font-size: 0.7rem; color: ' + item.urgencyColor + '; font-weight: 600; min-width: 80px; text-align: right;">' + item.urgencyLabel + '</span>' +
            '<div style="width: 60px; height: 4px; background: var(--bg-input); border-radius: 2px; overflow: hidden;">' +
                '<div style="width: ' + pct + '%; height: 100%; background: ' + item.urgencyColor + '; border-radius: 2px;"></div>' +
            '</div>' +
            '<span style="font-size: 0.65rem; color: var(--text-muted); min-width: 32px; text-align: right;">' + pct + '%</span>' +
        '</div>';
    }).join('');
}

// ---- Full mode: detailed cards with progress bars ----

function renderFull(container, ctx) {
    const proj = ctx.project(ctx.timelineDate);
    const capexItems = proj.expenses.filter(e => e.type === 'capex');

    if (capexItems.length === 0) {
        container.innerHTML = '<div class="empty-state">No CapEx items to prioritize</div>';
        return;
    }

    const ranked = capexItems.map(exp => {
        let urgencyDays = Infinity;
        let urgencyLabel = '';
        let urgencyColor = 'var(--text-muted)';

        if (exp.progress >= 100) {
            urgencyLabel = 'Fully funded';
            urgencyColor = 'var(--accent-primary)';
            urgencyDays = Infinity;
        } else if (exp.scheduledDate && exp.projectedDate) {
            const schedMs = new Date(exp.scheduledDate).getTime();
            const projMs = new Date(exp.projectedDate).getTime();
            urgencyDays = (schedMs - projMs) / (24 * 60 * 60 * 1000);
            if (urgencyDays < 0) {
                const monthsLate = Math.round(-urgencyDays / 30.44);
                urgencyLabel = monthsLate + ' month' + (monthsLate !== 1 ? 's' : '') + ' behind';
                urgencyColor = 'var(--accent-danger)';
            } else if (urgencyDays < 180) {
                urgencyLabel = 'Tight \u2014 ' + Math.round(urgencyDays / 30.44) + ' months buffer';
                urgencyColor = 'var(--accent-warning)';
            } else {
                urgencyLabel = Math.round(urgencyDays / 30.44) + ' months ahead';
                urgencyColor = 'var(--accent-success)';
            }
        } else if (exp.scheduledDate && !exp.projectedDate) {
            urgencyLabel = 'No gains allocated';
            urgencyColor = 'var(--accent-danger)';
            urgencyDays = -Infinity;
        } else {
            urgencyLabel = 'No schedule';
            urgencyDays = 0;
        }

        return { exp, urgencyDays, urgencyLabel, urgencyColor };
    });

    ranked.sort((a, b) => a.urgencyDays - b.urgencyDays);

    let html = '<div style="padding: 0 12px;">';
    html += '<div style="font-size: 0.7rem; color: var(--text-muted); text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 8px; padding: 0 4px;">Fund These First</div>';

    ranked.forEach((item, idx) => {
        const exp = item.exp;
        const rank = idx + 1;
        const progressClass = exp.progress >= 100 ? '' : exp.progress >= 50 ? 'warning' : 'danger';

        html += '<div style="display: flex; align-items: center; gap: 10px; padding: 8px 4px; border-bottom: 1px solid var(--border);">';
        html += '<span style="font-family: \'JetBrains Mono\', monospace; color: var(--text-muted); font-size: 0.75rem; min-width: 20px;">#' + rank + '</span>';
        html += '<div style="flex: 1;">';
        html += '<div style="display: flex; justify-content: space-between; align-items: center;">';
        html += '<span style="font-weight: 500; font-size: 0.85rem;">' + ctx.escapeHtml(exp.name) + '</span>';
        html += '<span style="font-size: 0.7rem; color: ' + item.urgencyColor + '; font-weight: 600;">' + item.urgencyLabel + '</span>';
        html += '</div>';
        html += '<div class="progress-bar" style="margin-top: 4px;">';
        html += '<div class="progress-fill ' + progressClass + '" style="width: ' + Math.min(exp.progress, 100) + '%"></div>';
        html += '</div>';
        html += '<div style="display: flex; justify-content: space-between; font-size: 0.65rem; color: var(--text-muted); margin-top: 2px;">';
        html += '<span>' + exp.progress.toFixed(0) + '% \u2014 ' + ctx.formatNumber(exp.cost) + ' SEK</span>';
        html += '<span>' + (exp.scheduledDate ? 'Due: ' + exp.scheduledDate : '') + '</span>';
        html += '</div>';
        html += '</div>';
        html += '</div>';
    });

    html += '</div>';
    container.innerHTML = html;
}

registerPane({
    id: 'priority',
    label: 'Priority',
    render,
    header,
});
