/**
 * Breakdown Pane — Chart.js bar chart showing cost breakdown.
 *
 * Owns a Chart.js instance and destroys it on hide.
 * Uses ctx.getChartConfig('breakdown') to obtain the chart configuration
 * from the core, keeping all chart config logic centralized.
 */

import { registerPane } from 'fundflow/panes';

let breakdownChart = null;

function render(container, ctx) {
    // The container from the registry is a plain div.
    // We need a canvas inside it for Chart.js.
    let canvas = container.querySelector('canvas');
    if (!canvas) {
        container.innerHTML = '';
        const wrapper = document.createElement('div');
        wrapper.className = 'chart-container';
        wrapper.style.height = '240px';
        canvas = document.createElement('canvas');
        wrapper.appendChild(canvas);
        container.appendChild(wrapper);
    }

    if (breakdownChart) {
        breakdownChart.destroy();
        breakdownChart = null;
    }

    const canvasCtx = canvas.getContext('2d');
    breakdownChart = new Chart(canvasCtx, ctx.getChartConfig('breakdown'));
}

function destroy() {
    if (breakdownChart) {
        breakdownChart.destroy();
        breakdownChart = null;
    }
}

registerPane({
    id: 'breakdown',
    label: 'Breakdown',
    render,
    destroy,
});
