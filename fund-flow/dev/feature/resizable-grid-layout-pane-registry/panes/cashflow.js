/**
 * Cash Flow Pane — 24-month ledger showing projected inflows and outflows.
 *
 * Pure DOM render (no chart). Displays a table with monthly breakdown
 * of deposits, estimated gains, OpEx payments, and CapEx procurements.
 */

import { registerPane } from 'fundflow/panes';

function render(container, ctx) {
    const settings = ctx.data.settings;
    const fundStart = new Date(settings.fundStartDate);
    const expenses = ctx.data.expenses;
    const events = ctx.data.events;

    // Generate 24 months of cash flow from current timeline date
    const startDate = new Date(ctx.timelineDate);
    const months = [];

    for (let i = 0; i < 24; i++) {
        const mDate = new Date(startDate.getFullYear(), startDate.getMonth() + i, 1);
        const mEnd = new Date(startDate.getFullYear(), startDate.getMonth() + i + 1, 0);
        const mStr = mDate.toISOString().split('T')[0].slice(0, 7); // YYYY-MM

        let inflows = 0;
        let outflows = 0;
        const details = [];

        // Deposits in this month
        events.forEach(ev => {
            if (ev.type !== 'deposit') return;
            const evDate = new Date(ev.date);
            if (evDate >= mDate && evDate <= mEnd) {
                inflows += ev.amount;
                details.push({ type: 'deposit', label: 'Deposit', amount: ev.amount });
            }
        });

        // Estimate monthly gains (simplified: principal * rate / 12)
        const proj = ctx.project(mDate);
        const monthlyGain = proj.effectiveBase * proj.rate / 12;
        if (monthlyGain > 0) {
            inflows += monthlyGain;
            details.push({ type: 'gain', label: 'Est. gains', amount: monthlyGain });
        }

        // OpEx payments this month
        expenses.forEach(exp => {
            if (exp.type !== 'opex') return;
            const expStart = exp.lastProcurementDate ? new Date(exp.lastProcurementDate) : fundStart;
            if (mDate >= expStart) {
                const monthlyCost = exp.billingCycle === 'monthly' ? exp.cost : exp.cost / 12;
                outflows += monthlyCost;
                details.push({ type: 'opex', label: exp.name, amount: -monthlyCost });
            }
        });

        // Scheduled CapEx procurements this month
        expenses.forEach(exp => {
            if (exp.type !== 'capex') return;
            const lastProc = exp.lastProcurementDate ? new Date(exp.lastProcurementDate) : fundStart;
            const scheduled = new Date(lastProc.getTime() + (exp.interval * 365.25 * 24 * 60 * 60 * 1000));
            if (scheduled >= mDate && scheduled <= mEnd) {
                outflows += exp.cost;
                details.push({ type: 'capex', label: exp.name + ' (CapEx)', amount: -exp.cost });
            }
        });

        // Recorded procurements this month (already happened)
        events.forEach(ev => {
            if (ev.type !== 'procurement') return;
            const evDate = new Date(ev.date);
            if (evDate >= mDate && evDate <= mEnd) {
                // Don't double-count with scheduled above
                const alreadyCounted = details.some(d => d.type === 'capex' && d.label.startsWith(ev.expenseName || ''));
                if (!alreadyCounted) {
                    outflows += ev.cost;
                    details.push({ type: 'procurement', label: (ev.expenseName || 'Purchase') + ' (recorded)', amount: -ev.cost });
                }
            }
        });

        const net = inflows - outflows;
        months.push({ month: mStr, inflows, outflows, net, details });
    }

    // Render as table
    let html = '<div style="padding: 0 8px; font-size: 0.75rem;">';
    html += '<table style="width: 100%; border-collapse: collapse;">';
    html += '<thead><tr style="color: var(--text-muted); text-transform: uppercase; font-size: 0.65rem; letter-spacing: 0.3px;">';
    html += '<th style="text-align: left; padding: 4px 6px; border-bottom: 1px solid var(--border);">Month</th>';
    html += '<th style="text-align: right; padding: 4px 6px; border-bottom: 1px solid var(--border);">Inflows</th>';
    html += '<th style="text-align: right; padding: 4px 6px; border-bottom: 1px solid var(--border);">Outflows</th>';
    html += '<th style="text-align: right; padding: 4px 6px; border-bottom: 1px solid var(--border);">Net</th>';
    html += '<th style="text-align: left; padding: 4px 6px; border-bottom: 1px solid var(--border);">Events</th>';
    html += '</tr></thead><tbody>';

    months.forEach(m => {
        const netColor = m.net >= 0 ? 'var(--accent-primary)' : 'var(--accent-danger)';
        const hasCapex = m.details.some(d => d.type === 'capex' || d.type === 'procurement');
        const rowBg = hasCapex ? 'background: rgba(245, 158, 11, 0.04);' : '';

        html += '<tr style="border-bottom: 1px solid var(--border); ' + rowBg + '">';
        html += '<td style="padding: 5px 6px; font-family: \'JetBrains Mono\', monospace; color: var(--text-muted);">' + m.month + '</td>';
        html += '<td style="padding: 5px 6px; text-align: right; font-family: \'JetBrains Mono\', monospace; color: var(--accent-success);">' + ctx.formatNumber(m.inflows) + '</td>';
        html += '<td style="padding: 5px 6px; text-align: right; font-family: \'JetBrains Mono\', monospace; color: var(--accent-danger);">' + ctx.formatNumber(m.outflows) + '</td>';
        html += '<td style="padding: 5px 6px; text-align: right; font-family: \'JetBrains Mono\', monospace; color: ' + netColor + ';">' + (m.net >= 0 ? '+' : '') + ctx.formatNumber(m.net) + '</td>';

        // Compact event labels
        const eventLabels = m.details
            .filter(d => d.type !== 'gain') // skip routine gains
            .map(d => d.label)
            .join(', ');
        html += '<td style="padding: 5px 6px; color: var(--text-muted); font-size: 0.65rem; max-width: 200px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">' + eventLabels + '</td>';
        html += '</tr>';
    });

    html += '</tbody></table></div>';
    container.innerHTML = html;
}

registerPane({
    id: 'cashflow',
    label: 'Cash Flow',
    render,
});
