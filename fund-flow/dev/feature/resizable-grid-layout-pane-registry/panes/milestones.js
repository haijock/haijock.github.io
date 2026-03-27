/**
 * Milestones Pane — Gantt-style horizontal timeline showing when each expense
 * is projected to become fully funded, plotted against its scheduled purchase date.
 *
 * Pure DOM render (no chart). Includes a legend in the header via header().
 * CSS is co-located in this file and injected by the registry.
 */

import { registerPane } from 'fundflow/panes';

// ---- Pane-scoped CSS (moved from index.html) ----

const css = `
    .milestone-legend {
        display: flex; gap: 10px; align-items: center; flex-wrap: wrap;
    }
    .milestone-legend-item {
        display: flex; align-items: center; gap: 4px;
        font-size: 0.6rem; color: var(--text-muted); white-space: nowrap;
    }
    .milestone-legend-dot {
        width: 8px; height: 8px; border-radius: 50%; flex-shrink: 0;
    }
    .milestone-legend-diamond {
        width: 7px; height: 7px; background: var(--text-secondary);
        transform: rotate(45deg); flex-shrink: 0;
    }
    .milestone-legend-circle {
        width: 8px; height: 8px; border-radius: 50%;
        border: 2px solid var(--text-secondary); flex-shrink: 0;
    }
    .milestone-axis {
        position: relative; padding: 0 12px;
    }
    .milestone-axis-labels {
        display: flex; justify-content: space-between; align-items: center;
        padding: 4px 140px 8px 140px;
        font-size: 0.6rem; color: var(--text-muted);
        font-family: var(--font-mono); border-bottom: 1px solid var(--border);
    }
    .milestone-row {
        display: flex; align-items: center; gap: 0;
        padding: 6px 12px; border-bottom: 1px solid var(--border);
        position: relative;
    }
    .milestone-row:hover { background: rgba(255,255,255,0.02); }
    .milestone-label {
        width: 128px; min-width: 128px; padding-right: 12px;
        overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
    }
    .milestone-label-name {
        font-size: 0.8rem; font-weight: 500; display: block;
        overflow: hidden; text-overflow: ellipsis;
    }
    .milestone-label-cost {
        font-size: 0.6rem; color: var(--text-muted);
        font-family: var(--font-mono);
    }
    .milestone-track {
        flex: 1; height: 28px; position: relative;
        background: var(--bg-tertiary); border-radius: var(--radius-sm);
        overflow: visible;
    }
    .milestone-fill {
        position: absolute; top: 6px; left: 0; height: 16px;
        border-radius: var(--radius-sm); min-width: 2px;
        transition: width 0.3s ease;
    }
    .milestone-zone {
        position: absolute; top: 4px; height: 20px;
        border-radius: 2px; pointer-events: none;
    }
    .milestone-zone-margin { background: rgba(16, 185, 129, 0.12); }
    .milestone-zone-danger { background: rgba(239, 68, 68, 0.12); }
    .milestone-marker {
        position: absolute; top: 50%; transform: translate(-50%, -50%);
        z-index: 2; pointer-events: none;
    }
    .milestone-marker-scheduled {
        width: 8px; height: 8px; background: var(--text-secondary);
        transform: translate(-50%, -50%) rotate(45deg);
    }
    .milestone-marker-projected {
        width: 10px; height: 10px; border-radius: 50%;
        border: 2px solid; background: var(--bg-primary);
    }
    .milestone-check {
        font-size: 0.7rem; color: var(--accent-primary); margin-left: 4px;
    }
    .milestone-opex-track {
        flex: 1; height: 28px; position: relative;
        display: flex; align-items: center;
    }
    .milestone-opex-bar {
        height: 3px; border-radius: 2px; min-width: 2px;
    }
    .milestone-opex-label {
        font-size: 0.6rem; color: var(--text-muted); margin-left: 6px;
        white-space: nowrap;
    }
    .milestone-tooltip {
        position: absolute; z-index: 100; top: 100%; left: 50%;
        transform: translateX(-50%); margin-top: 4px;
        background: var(--bg-card); border: 1px solid var(--border-light);
        border-radius: var(--radius-md); padding: 8px 10px;
        font-size: 0.7rem; line-height: 1.5; color: var(--text-secondary);
        box-shadow: var(--shadow-lg); white-space: nowrap;
        pointer-events: none; display: none;
    }
    .milestone-tooltip strong { color: var(--text-primary); }
    .milestone-row:hover .milestone-tooltip { display: block; }
`;

// ---- Header: legend ----

function header() {
    return '<div class="milestone-legend">' +
        '<span class="milestone-legend-item"><span class="milestone-legend-dot" style="background: var(--accent-danger);"></span>Behind</span>' +
        '<span class="milestone-legend-item"><span class="milestone-legend-dot" style="background: var(--accent-warning);"></span>Tight</span>' +
        '<span class="milestone-legend-item"><span class="milestone-legend-dot" style="background: var(--accent-success);"></span>Ahead</span>' +
        '<span class="milestone-legend-item"><span class="milestone-legend-dot" style="background: var(--accent-primary);"></span>Funded</span>' +
        '<span class="milestone-legend-item"><span class="milestone-legend-diamond"></span>Due</span>' +
        '<span class="milestone-legend-item"><span class="milestone-legend-circle"></span>Projected</span>' +
        '</div>';
}

// ---- Render ----

function render(container, ctx) {
    const proj = ctx.project(ctx.timelineDate);
    const expenses = proj.expenses;

    if (expenses.length === 0) {
        container.innerHTML = '<div class="empty-state">Add expenses to see funding milestones</div>';
        return;
    }

    const settings = ctx.data.settings;
    const projYears = settings.projectionYears || 20;
    const axisStart = new Date(ctx.timelineDate);
    const axisEnd = new Date(axisStart);
    axisEnd.setFullYear(axisEnd.getFullYear() + projYears);
    const axisStartMs = axisStart.getTime();
    const axisEndMs = axisEnd.getTime();
    const axisRange = axisEndMs - axisStartMs;

    // Map a date to a percentage position on the axis (clamped 0-100)
    const dateToPercent = (d) => {
        if (!d) return null;
        const ms = new Date(d).getTime();
        const pct = ((ms - axisStartMs) / axisRange) * 100;
        return Math.max(0, Math.min(100, pct));
    };

    // Generate axis year labels
    const startYear = axisStart.getFullYear();
    const endYear = axisEnd.getFullYear();
    const labelYears = [];
    const yearSpan = endYear - startYear;
    const step = yearSpan <= 8 ? 1 : yearSpan <= 16 ? 2 : Math.ceil(yearSpan / 8);
    for (let y = startYear; y <= endYear; y += step) {
        labelYears.push(y);
    }
    if (labelYears[labelYears.length - 1] !== endYear) labelYears.push(endYear);

    // Separate CapEx and OpEx, sort CapEx by scheduled date
    const capexItems = expenses.filter(e => e.type === 'capex');
    const opexItems = expenses.filter(e => e.type === 'opex');

    capexItems.sort((a, b) => {
        const aDate = a.scheduledDate ? new Date(a.scheduledDate).getTime() : Infinity;
        const bDate = b.scheduledDate ? new Date(b.scheduledDate).getTime() : Infinity;
        return aDate - bDate;
    });

    // Compute urgency colour for a CapEx item
    const getStatusColor = (exp) => {
        if (exp.progress >= 100) return 'var(--accent-primary)';
        if (exp.scheduledDate && exp.projectedDate) {
            const schedMs = new Date(exp.scheduledDate).getTime();
            const projMs = new Date(exp.projectedDate).getTime();
            const urgencyDays = (schedMs - projMs) / ctx.MS_PER_DAY;
            if (urgencyDays < 0) return 'var(--accent-danger)';
            if (urgencyDays < 90) return 'var(--accent-warning)';
            return 'var(--accent-success)';
        }
        return 'var(--text-muted)';
    };

    const getMarginDays = (exp) => {
        if (!exp.scheduledDate || !exp.projectedDate) return null;
        const schedMs = new Date(exp.scheduledDate).getTime();
        const projMs = new Date(exp.projectedDate).getTime();
        return Math.round((schedMs - projMs) / ctx.MS_PER_DAY);
    };

    const formatDate = (d) => d ? new Date(d).toLocaleDateString('sv-SE') : '\u2014';

    // Build axis labels HTML
    let html = '<div class="milestone-axis">';
    html += '<div class="milestone-axis-labels">';
    labelYears.forEach(y => {
        html += '<span>' + y + '</span>';
    });
    html += '</div>';

    // CapEx section header
    if (capexItems.length > 0) {
        html += '<div style="font-size: 0.65rem; color: var(--text-muted); text-transform: uppercase; letter-spacing: 0.5px; padding: 8px 12px 2px; font-weight: 600;">Capital Expenses</div>';

        capexItems.forEach(exp => {
            const color = getStatusColor(exp);
            const marginDays = getMarginDays(exp);
            const projPct = dateToPercent(exp.projectedDate);
            const schedPct = dateToPercent(exp.scheduledDate);
            const isFunded = exp.progress >= 100;

            // Tooltip content
            let tooltipContent = '<strong>' + ctx.escapeHtml(exp.name) + '</strong><br>';
            tooltipContent += 'Cost: ' + ctx.formatNumber(exp.cost) + ' SEK every ' + (exp.interval || '?') + ' yr<br>';
            tooltipContent += 'Annual: ' + ctx.formatNumber(exp.annualCost) + ' SEK/yr<br>';
            tooltipContent += 'Progress: ' + Math.round(exp.progress) + '%<br>';
            tooltipContent += 'Due: ' + formatDate(exp.scheduledDate) + '<br>';
            tooltipContent += 'Projected: ' + formatDate(exp.projectedDate);
            if (marginDays !== null) {
                const absDays = Math.abs(marginDays);
                const months = Math.round(absDays / 30.44);
                tooltipContent += '<br><span style="color: ' + color + '; font-weight: 600;">';
                if (marginDays < 0) {
                    tooltipContent += months + ' month' + (months !== 1 ? 's' : '') + ' behind schedule';
                } else {
                    tooltipContent += months + ' month' + (months !== 1 ? 's' : '') + ' ahead of schedule';
                }
                tooltipContent += '</span>';
            }

            html += '<div class="milestone-row">';
            // Label column
            html += '<div class="milestone-label">';
            html += '<span class="milestone-label-name">' + ctx.escapeHtml(exp.name);
            if (isFunded) html += ' <span class="milestone-check">\u2713</span>';
            html += '</span>';
            html += '<span class="milestone-label-cost">' + ctx.formatNumber(exp.annualCost) + ' SEK/yr</span>';
            html += '</div>';

            // Track column
            html += '<div class="milestone-track">';

            // Progress fill bar
            const fillWidth = Math.min(100, exp.progress);
            html += '<div class="milestone-fill" style="width: ' + fillWidth + '%; background: ' + color + '; opacity: 0.7;"></div>';

            // Margin/danger zone between scheduled and projected markers
            if (schedPct !== null && projPct !== null && !isFunded) {
                const leftPct = Math.min(schedPct, projPct);
                const rightPct = Math.max(schedPct, projPct);
                const zoneClass = marginDays < 0 ? 'milestone-zone-danger' : 'milestone-zone-margin';
                html += '<div class="milestone-zone ' + zoneClass + '" style="left: ' + leftPct + '%; width: ' + (rightPct - leftPct) + '%;"></div>';
            }

            // Scheduled date diamond marker
            if (schedPct !== null) {
                html += '<div class="milestone-marker milestone-marker-scheduled" style="left: ' + schedPct + '%;"></div>';
            }

            // Projected date circle marker
            if (projPct !== null && !isFunded) {
                html += '<div class="milestone-marker milestone-marker-projected" style="left: ' + projPct + '%; border-color: ' + color + ';"></div>';
            }

            html += '</div>'; // .milestone-track

            // Tooltip
            html += '<div class="milestone-tooltip">' + tooltipContent + '</div>';

            html += '</div>'; // .milestone-row
        });
    }

    // OpEx section
    if (opexItems.length > 0) {
        html += '<div style="font-size: 0.65rem; color: var(--text-muted); text-transform: uppercase; letter-spacing: 0.5px; padding: 10px 12px 2px; font-weight: 600;">Subscriptions</div>';

        opexItems.forEach(exp => {
            const coverage = exp.annualCost > 0 ? Math.min(100, (exp.allocatedAnnualGains / exp.annualCost) * 100) : 0;
            const isCovered = coverage >= 100;
            const color = isCovered ? 'var(--accent-primary)' : coverage >= 50 ? 'var(--accent-warning)' : 'var(--accent-danger)';

            let tooltipContent = '<strong>' + ctx.escapeHtml(exp.name) + '</strong><br>';
            tooltipContent += 'Annual cost: ' + ctx.formatNumber(exp.annualCost) + ' SEK/yr<br>';
            tooltipContent += 'Allocated: ' + ctx.formatNumber(exp.allocatedAnnualGains) + ' SEK/yr<br>';
            tooltipContent += 'Coverage: ' + Math.round(coverage) + '%';

            html += '<div class="milestone-row">';
            html += '<div class="milestone-label">';
            html += '<span class="milestone-label-name">' + ctx.escapeHtml(exp.name);
            if (isCovered) html += ' <span class="milestone-check">\u2713</span>';
            html += '</span>';
            html += '<span class="milestone-label-cost">' + ctx.formatNumber(exp.annualCost) + ' SEK/yr</span>';
            html += '</div>';

            // OpEx bar
            html += '<div class="milestone-opex-track">';
            html += '<div class="milestone-opex-bar" style="width: ' + coverage + '%; background: ' + color + ';"></div>';
            html += '<span class="milestone-opex-label">' + Math.round(coverage) + '% covered</span>';
            html += '</div>';

            html += '<div class="milestone-tooltip">' + tooltipContent + '</div>';
            html += '</div>'; // .milestone-row
        });
    }

    html += '</div>'; // .milestone-axis
    container.innerHTML = html;
}

registerPane({
    id: 'milestones',
    label: 'Milestones',
    render,
    header,
    css,
});
