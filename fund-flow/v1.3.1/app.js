/**
 * FundFlow v2 — Self-Funded Procurement Planner
 *
 * Architecture:
 *   Event-sourced model with append-only event log.
 *   All state is derived from the event log via the project() method.
 *   Chart.js with custom plugins for interactive timeline visualization.
 *   LocalStorage persistence.
 *
 * Key calculation flow:
 *   project(atDate)
 *     → _computePrincipalAndRate()     — sum deposits, find effective rate
 *     → _buildCashFlowTimeline()       — unify deposits/rates/procurements/OpEx into sorted events
 *     → _computeCompoundGrowth()       — piecewise compound growth through cash-flow events
 *     → _computeExpenseData()          — annual costs, last proc dates, scheduled dates
 *     → _allocateGains()               — OpEx first, then CapEx proportional
 *     → _redistributeSurplus()         — fully-funded CapEx excess → underfunded
 *     → _buildProjectedExpenses()      — progress, projected dates, isFunded flags
 *
 * @version 2.1.0
 */

// ========== Chart.js Timeline Plugin ==========
// Draws a vertical indicator line on the projection chart.
// Click sets timeline date, drag scrubs, double-click resets to today.

const TimelinePlugin = {
    id: 'timelineIndicator',

    _state: {
        xPixel: null,    // current pixel position
        dragging: false,
        dateLabel: null,
        bound: false,    // prevent duplicate listeners on chart recreate
        chartRef: null,  // reference to current chart for event handlers
    },

    afterInit(chart) {
        const state = TimelinePlugin._state;
        // Only track the projection (line) chart — ignore bar charts etc.
        if (chart.config.type === 'line') {
            state.chartRef = chart;
        }

        // Only bind DOM listeners once (canvas element is reused across chart recreations)
        if (state.bound) return;
        state.bound = true;

        const canvas = chart.canvas;

        const getDateFromX = (x) => {
            const c = state.chartRef;
            if (!c || !c.scales || !c.scales.x) return null;
            const val = c.scales.x.getValueForPixel(x);
            if (val == null) return null;
            return new Date(val);
        };

        const setFromX = (x) => {
            const date = getDateFromX(x);
            if (!date || isNaN(date.getTime())) return;
            state.xPixel = x;
            state.dateLabel = date.toISOString().split('T')[0];
            if (state.chartRef) state.chartRef.draw();
            if (typeof FundFlow !== 'undefined') {
                FundFlow.setTimelineDate(date);
            }
        };

        canvas.addEventListener('mousedown', (e) => {
            const c = state.chartRef;
            if (!c || c.config.type !== 'line') return;
            const rect = canvas.getBoundingClientRect();
            const x = e.clientX - rect.left;
            state.dragging = true;
            setFromX(x);
        });

        canvas.addEventListener('mousemove', (e) => {
            if (!state.dragging) return;
            const c = state.chartRef;
            if (!c || c.config.type !== 'line') return;
            const rect = canvas.getBoundingClientRect();
            const x = e.clientX - rect.left;
            setFromX(x);
        });

        window.addEventListener('mouseup', () => {
            state.dragging = false;
        });

        canvas.addEventListener('dblclick', (e) => {
            const c = state.chartRef;
            if (!c || c.config.type !== 'line') return;
            state.xPixel = null;
            state.dateLabel = null;
            if (state.chartRef) state.chartRef.draw();
            if (typeof FundFlow !== 'undefined') {
                FundFlow.resetToToday();
            }
        });
    },

    afterDraw(chart) {
        const state = TimelinePlugin._state;
        if (state.xPixel == null) return;
        if (chart.config.type !== 'line') return;

        const ctx = chart.ctx;
        const area = chart.chartArea;
        const x = state.xPixel;

        if (x < area.left || x > area.right) return;

        ctx.save();
        ctx.beginPath();
        ctx.moveTo(x, area.top);
        ctx.lineTo(x, area.bottom);
        ctx.lineWidth = 1.5;
        ctx.strokeStyle = 'rgba(0, 212, 170, 0.7)';
        ctx.setLineDash([4, 3]);
        ctx.stroke();
        ctx.setLineDash([]);

        // Date label at bottom of chart area, above the X axis
        if (state.dateLabel) {
            ctx.font = '11px "JetBrains Mono", monospace';
            ctx.fillStyle = '#00d4aa';
            ctx.textAlign = 'center';
            ctx.fillText(state.dateLabel, x, area.bottom - 8);
        }

        // Small circle at top of the line
        ctx.beginPath();
        ctx.arc(x, area.top, 3, 0, Math.PI * 2);
        ctx.fillStyle = '#00d4aa';
        ctx.fill();

        ctx.restore();
    }
};

Chart.register(TimelinePlugin);


// ========== Event Markers Plugin ==========
// Draws small coloured dots on the projection chart at event dates.
// Event details are shown in Chart.js's built-in tooltip via afterBody callback.

const EventMarkersPlugin = {
    id: 'eventMarkers',

    _colors: {
        deposit: '#10b981',       // green
        rate_change: '#7c3aed',   // purple
        procurement: '#f59e0b',   // amber
    },

    _labels: {
        deposit: 'Deposit',
        rate_change: 'Rate Change',
        procurement: 'Procurement',
    },

    afterDatasetsDraw(chart) {
        if (chart.config.type !== 'line') return;
        const markers = chart.options.plugins.eventMarkers?.markers;
        if (!markers || markers.length === 0) return;

        const ctx = chart.ctx;
        const area = chart.chartArea;
        const xScale = chart.scales.x;
        if (!xScale || !area) return;

        const meta = chart.getDatasetMeta(0);
        if (!meta || !meta.data || meta.data.length === 0) return;

        ctx.save();

        for (const m of markers) {
            const xPixel = xScale.getPixelForValue(new Date(m.date).getTime());
            if (xPixel < area.left || xPixel > area.right) continue;

            // Find y on the PR Balance line (nearest data point)
            let yPixel = null;
            let minDist = Infinity;
            for (const pt of meta.data) {
                const dist = Math.abs(pt.x - xPixel);
                if (dist < minDist) {
                    minDist = dist;
                    yPixel = pt.y;
                }
            }
            if (yPixel == null) continue;

            const color = EventMarkersPlugin._colors[m.type] || '#a1a1aa';

            // Dot
            ctx.beginPath();
            ctx.arc(xPixel, yPixel, 4, 0, Math.PI * 2);
            ctx.fillStyle = color;
            ctx.fill();

            // Border for visibility
            ctx.strokeStyle = 'rgba(10, 10, 15, 0.6)';
            ctx.lineWidth = 1.5;
            ctx.stroke();
        }

        ctx.restore();
    }
};

Chart.register(EventMarkersPlugin);


// ========== Zero Line Plugin ==========
// Draws a horizontal dashed line at y=0 on the projection chart with a "Break-even" label.

const ZeroLinePlugin = {
    id: 'zeroLine',

    afterDraw(chart) {
        const opts = chart.options.plugins.zeroLine;
        if (!opts || !opts.enabled) return;
        if (chart.config.type !== 'line') return;

        const yScale = chart.scales.y;
        const area = chart.chartArea;
        if (!yScale || !area) return;

        // Only draw if 0 is within the visible y range
        if (yScale.min > 0 || yScale.max < 0) return;

        const yPixel = yScale.getPixelForValue(0);
        if (yPixel < area.top || yPixel > area.bottom) return;

        const ctx = chart.ctx;
        ctx.save();
        ctx.beginPath();
        ctx.moveTo(area.left, yPixel);
        ctx.lineTo(area.right, yPixel);
        ctx.lineWidth = 1;
        ctx.strokeStyle = 'rgba(239, 68, 68, 0.35)';
        ctx.setLineDash([6, 4]);
        ctx.stroke();
        ctx.setLineDash([]);

        // Label
        ctx.font = '10px "DM Sans", sans-serif';
        ctx.fillStyle = 'rgba(239, 68, 68, 0.5)';
        ctx.textAlign = 'left';
        ctx.fillText('Break-even', area.left + 6, yPixel - 4);

        ctx.restore();
    }
};

Chart.register(ZeroLinePlugin);


// ========== FundFlow Application ==========

const FundFlow = {
    data: {
        settings: {
            initialPrincipal: 135000,
            accountType: 'isk',
            fundStartDate: new Date().toISOString().split('T')[0],
            redistributeFullyFunded: true
        },
        expenses: [],
        events: []
    },

    chart: null,
    breakdownChart: null,
    visiblePanes: { breakdown: false, priority: false, cashflow: false },
    priorityMode: 'full', // 'full' or 'compact'
    timelineDate: new Date(),
    editingEventId: null,
    editingExpenseId: null,
    activeFilter: 'all',
    _renderTimer: null,

    // ========== INIT ==========

    init() {
        this.loadFromStorage();
        this.bindEvents();
        this.initChart();
        this.render();
    },

    loadFromStorage() {
        const stored = localStorage.getItem('fundflow_data');
        if (stored) {
            try {
                this.data = JSON.parse(stored);
            } catch (e) {
                console.error('Failed to load data:', e);
            }
        }

        if (!this.data.settings) {
            this.data.settings = {
                initialPrincipal: 135000,
                accountType: 'isk',
                fundStartDate: new Date().toISOString().split('T')[0]
            };
        }
        if (!this.data.events) this.data.events = [];
        if (!this.data.expenses) this.data.expenses = [];

        // Migrate: convert legacy initial_deposit events to regular deposits
        this.data.events.forEach(ev => {
            if (ev.type === 'initial_deposit') {
                ev.type = 'deposit';
                ev.isInitial = true;
            }
        });

        // Ensure settings have defaults
        if (this.data.settings.redistributeFullyFunded === undefined) {
            this.data.settings.redistributeFullyFunded = true;
        }
        if (this.data.settings.inflationRate === undefined) {
            this.data.settings.inflationRate = 0.02;
        }
        if (this.data.settings.showRealValues === undefined) {
            this.data.settings.showRealValues = false;
        }
        if (this.data.settings.projectionYears === undefined) {
            this.data.settings.projectionYears = 20;
        }
        if (this.data.settings.listDebounceMs === undefined) {
            this.data.settings.listDebounceMs = 300;
        }
    },

    saveToStorage() {
        localStorage.setItem('fundflow_data', JSON.stringify(this.data));
    },

    showToast(message, type = 'success') {
        let toast = document.getElementById('toastNotification');
        if (!toast) {
            toast = document.createElement('div');
            toast.id = 'toastNotification';
            toast.className = 'toast';
            document.body.appendChild(toast);
        }
        toast.textContent = message;
        toast.className = 'toast ' + type;
        requestAnimationFrame(() => {
            toast.classList.add('show');
        });
        setTimeout(() => {
            toast.classList.remove('show');
        }, 2500);
    },

    generateId() {
        return Date.now().toString(36) + Math.random().toString(36).slice(2);
    },

    // ========== EVENT BINDING ==========

    bindEvents() {
        // Settings (pinned row)
        document.getElementById('initialPrincipal').addEventListener('input', (e) => {
            const amount = parseFloat(e.target.value) || 0;
            this.data.settings.initialPrincipal = amount;
            // Find or create the initial deposit event (first deposit at fund start date)
            const existing = this.data.events.find(ev =>
                ev.type === 'deposit' && ev.date === this.data.settings.fundStartDate && ev.isInitial
            );
            if (existing) {
                existing.amount = amount;
            } else {
                this.data.events.push({
                    id: this.generateId(),
                    type: 'deposit',
                    date: this.data.settings.fundStartDate,
                    amount: amount,
                    isInitial: true,
                    createdAt: new Date().toISOString()
                });
            }
            this.saveToStorage();
            this.renderProjection();
            this.updateChart();
        });

        document.getElementById('returnRate').addEventListener('input', (e) => {
            document.getElementById('returnRateValue').textContent = e.target.value + '%';
            const rate = parseFloat(e.target.value) / 100;
            this.addOrUpdateRateChange(rate);
        });

        document.getElementById('accountType').addEventListener('change', (e) => {
            this.data.settings.accountType = e.target.value;
            this.saveToStorage();
            this.render();
            this.updateChart();
        });

        document.getElementById('fundStartDate').addEventListener('change', (e) => {
            this.data.settings.fundStartDate = e.target.value;
            this.timelineDate = new Date(e.target.value);
            this.saveToStorage();
            this.render();
            this.updateChart();
        });

        document.getElementById('redistributeToggle').addEventListener('change', (e) => {
            this.data.settings.redistributeFullyFunded = e.target.checked;
            this.saveToStorage();
            this.renderProjection();
            this.updateChart();
        });

        document.getElementById('inflationToggle').addEventListener('change', (e) => {
            this.data.settings.showRealValues = e.target.checked;
            this.saveToStorage();
            this.updateChart();
        });

        document.getElementById('inflationRate').addEventListener('input', (e) => {
            this.data.settings.inflationRate = (parseFloat(e.target.value) || 2) / 100;
            this.saveToStorage();
            if (this.data.settings.showRealValues) {
                this.updateChart();
            }
        });

        document.getElementById('projectionYears').addEventListener('input', (e) => {
            const years = Math.max(1, Math.min(50, parseInt(e.target.value) || 20));
            this.data.settings.projectionYears = years;
            this.saveToStorage();
            this.updateChart();
        });

        document.getElementById('listDebounceMs').addEventListener('input', (e) => {
            const ms = Math.max(0, Math.min(2000, parseInt(e.target.value) || 0));
            this.data.settings.listDebounceMs = ms;
            this.saveToStorage();
        });

        // Today button
        document.getElementById('todayBtn').addEventListener('click', () => {
            this.resetToToday();
        });

        // Dropdown menu
        document.getElementById('menuToggle').addEventListener('click', (e) => {
            e.stopPropagation();
            document.getElementById('menuDropdown').classList.toggle('open');
        });
        document.addEventListener('click', () => {
            document.getElementById('menuDropdown').classList.remove('open');
        });

        // Data actions
        document.getElementById('copyStateBtn').addEventListener('click', () => {
            this.copyStateToClipboard();
            this.showToast('State copied to clipboard');
        });
        document.getElementById('exportBtn').addEventListener('click', () => {
            this.exportData();
            this.showToast('Data exported successfully');
        });
        document.getElementById('importBtn').addEventListener('click', () => document.getElementById('fileInput').click());
        document.getElementById('fileInput').addEventListener('change', (e) => this.importData(e));
        document.getElementById('resetBtn').addEventListener('click', () => this.resetData());
        document.getElementById('loadExampleBtn').addEventListener('click', () => this.loadExampleData());
        document.getElementById('toggleHelpBtn').addEventListener('click', () => this.toggleHelp());

        // Pane toggle buttons
        document.querySelectorAll('.pane-toggle').forEach(btn => {
            btn.addEventListener('click', (e) => this.togglePane(e.target.dataset.pane));
        });

        // Priority mode toggle (full/compact)
        document.querySelectorAll('.pane-mode-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                this.priorityMode = e.target.dataset.mode;
                document.querySelectorAll('.pane-mode-btn').forEach(b => b.classList.toggle('active', b.dataset.mode === this.priorityMode));
                if (this.visiblePanes.priority) this._renderPriorityPane();
            });
        });

        // Filter tabs
        document.querySelectorAll('.filter-tab').forEach(tab => {
            tab.addEventListener('click', (e) => {
                document.querySelectorAll('.filter-tab').forEach(t => t.classList.remove('active'));
                e.target.classList.add('active');
                this.activeFilter = e.target.dataset.filter;
                this.renderUnifiedList();
            });
        });

        // Add expense
        document.getElementById('addExpenseBtn').addEventListener('click', () => this.openExpenseModal());
        document.getElementById('closeExpenseModal').addEventListener('click', () => this.closeExpenseModal());
        document.getElementById('cancelExpense').addEventListener('click', () => this.closeExpenseModal());
        document.getElementById('saveExpense').addEventListener('click', () => this.saveExpense());

        document.querySelectorAll('.type-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                document.querySelectorAll('.type-btn').forEach(b => b.classList.remove('active'));
                e.target.classList.add('active');
                this.toggleExpenseType(e.target.dataset.type);
            });
        });

        // Procurement
        document.getElementById('closeProcurementModal').addEventListener('click', () => this.closeProcurementModal());
        document.getElementById('cancelProcurement').addEventListener('click', () => this.closeProcurementModal());
        document.getElementById('saveProcurement').addEventListener('click', () => this.saveProcurement());

        // Events
        document.getElementById('addEventBtn').addEventListener('click', () => this.openEventModal());
        document.getElementById('closeEventModal').addEventListener('click', () => this.closeEventModal());
        document.getElementById('cancelEvent').addEventListener('click', () => this.closeEventModal());
        document.getElementById('saveEvent').addEventListener('click', () => this.saveEvent());

        document.querySelectorAll('.event-type-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                document.querySelectorAll('.event-type-btn').forEach(b => b.classList.remove('active'));
                e.target.classList.add('active');
                this.toggleEventType(e.target.dataset.type);
            });
        });

        // Deposit impact preview — live update on amount/date change
        document.getElementById('eventAmount').addEventListener('input', () => this._updateDepositPreview());
        document.getElementById('eventDate').addEventListener('change', () => this._updateDepositPreview());

        // Click overlay to dismiss modals
        document.querySelectorAll('.modal-overlay').forEach(overlay => {
            overlay.addEventListener('click', (e) => {
                if (e.target === overlay) {
                    overlay.classList.remove('open');
                    this.editingEventId = null;
                    this.editingExpenseId = null;
                }
            });
        });
    },

    addOrUpdateRateChange(rate) {
        const today = new Date().toISOString().split('T')[0];
        const existing = this.data.events.find(ev => ev.type === 'rate_change' && ev.date === today);
        if (existing) {
            existing.rate = rate;
        } else {
            this.data.events.push({
                id: this.generateId(),
                type: 'rate_change',
                date: today,
                rate: rate,
                createdAt: new Date().toISOString()
            });
        }
        this.saveToStorage();
        this.renderProjection();
        this.updateChart();
    },

    // ========== TIMELINE (from chart plugin) ==========

    setTimelineDate(date) {
        this.timelineDate = date;
        const debounceMs = this.data.settings.listDebounceMs || 0;
        // Throttle rendering during drag to avoid jank
        if (this._renderTimer) return;
        this._renderTimer = requestAnimationFrame(() => {
            this._renderTimer = null;
            this.renderProjection({ skipList: debounceMs > 0 });
        });
        // Debounce the expensive list re-render and visible panes
        if (debounceMs > 0) {
            if (this._listRenderTimer) clearTimeout(this._listRenderTimer);
            this._listRenderTimer = setTimeout(() => {
                this._listRenderTimer = null;
                this.renderUnifiedList();
                this._refreshVisiblePanes();
            }, debounceMs);
        } else {
            this._refreshVisiblePanes();
        }
    },

    // Refresh all currently visible panes (called during timeline scrub).
    _refreshVisiblePanes() {
        if (this.visiblePanes.breakdown) this._renderBreakdownPane();
        if (this.visiblePanes.priority) this._renderPriorityPane();
        if (this.visiblePanes.cashflow) this._renderCashFlowPane();
    },

    resetToToday() {
        const today = new Date();
        const todayStr = today.toISOString().split('T')[0];
        const currentStr = this.timelineDate.toISOString().split('T')[0];
        const state = TimelinePlugin._state;

        if (currentStr === todayStr && state.xPixel != null) {
            // Already on today with bar visible → hide the bar
            state.xPixel = null;
            state.dateLabel = null;
            if (this.chart) this.chart.draw();
        } else if (currentStr === todayStr && state.xPixel == null) {
            // Already on today with bar hidden → show bar on today
            this._showTimelineBarAtDate(today);
        } else {
            // Different date → jump to today and show bar
            this.timelineDate = today;
            this.renderProjection();
            // Need to show bar after chart is drawn so scales exist
            this._showTimelineBarAtDate(today);
        }
    },

    _showTimelineBarAtDate(date) {
        const state = TimelinePlugin._state;
        const chart = this.chart;
        if (!chart || !chart.scales || !chart.scales.x) return;
        const xPixel = chart.scales.x.getPixelForValue(date.getTime());
        if (xPixel != null && !isNaN(xPixel)) {
            state.xPixel = xPixel;
            state.dateLabel = date.toISOString().split('T')[0];
            chart.draw();
        }
    },

    _restoreTimelineBar() {
        const todayStr = new Date().toISOString().split('T')[0];
        const currentStr = this.timelineDate.toISOString().split('T')[0];
        if (currentStr !== todayStr) {
            this._showTimelineBarAtDate(this.timelineDate);
        }
    },

    // ========== PROJECTOR ==========

    /** Milliseconds in one day — used throughout date arithmetic. */
    MS_PER_DAY: 86400000,

    /** Average days per year (accounts for leap years). */
    DAYS_PER_YEAR: 365.25,

    /**
     * Master projection function — computes the full financial state at a given date.
     *
     * Orchestrates the sub-steps:
     *   1. Compute principal and rate at date
     *   2. Build unified cash-flow timeline
     *   3. Run piecewise compound growth
     *   4. Compute per-expense data and allocate gains
     *   5. Optionally redistribute surplus
     *   6. Build projected expense result objects
     *
     * @param {Date|string} atDate — the date to project to
     * @returns {Object} — full projection result (see SPEC.md for shape)
     */
    project(atDate) {
        const settings = this.data.settings;
        const events = this.data.events;
        const expenses = this.data.expenses;

        const fundStart = new Date(settings.fundStartDate);
        const date = new Date(atDate);
        const dateStr = date.toISOString().split('T')[0];

        // Before fund start: nothing exists yet
        if (date < fundStart) {
            return {
                principal: 0, rate: 0.07, gains: 0, deductions: 0,
                principalReturnBalance: 0, expenses: [],
                totalAnnualCost: 0, isDrainingPrincipal: false,
                effectiveBase: 0, annualGainAmount: 0
            };
        }

        const sortedEvents = [...events].sort((a, b) => new Date(a.date) - new Date(b.date));

        // Step 1: Principal and rate at projection date
        const { principal, rate } = this._computePrincipalAndRate(sortedEvents, dateStr, settings);

        // Step 2: Build unified cash-flow timeline
        const cashFlowEvents = this._buildCashFlowTimeline(sortedEvents, expenses, fundStart, date, dateStr);

        // Step 3: Piecewise compound growth
        const { gains, compoundBase } = this._computeCompoundGrowth(cashFlowEvents, principal, fundStart, date);
        const effectiveBase = Math.max(0, compoundBase);

        // Step 4: Compute deductions and PR balance
        let deductions = 0;
        cashFlowEvents.forEach(ev => {
            if (ev.kind === 'outflow') deductions += ev.amount;
        });
        const principalReturnBalance = gains - deductions;

        // Step 5: Compute per-expense data
        const expenseData = this._computeExpenseData(expenses, sortedEvents, fundStart, date);

        // Step 6: Allocate gains (OpEx first, CapEx proportional, redistribute)
        const annualGainAmount = effectiveBase * rate;
        this._allocateGains(expenseData, annualGainAmount);
        if (settings.redistributeFullyFunded) {
            this._redistributeSurplus(expenseData, date);
        }

        // Step 7: Build projected expense result objects
        const projectedExpenses = this._buildProjectedExpenses(expenseData, date);
        const totalAnnualCost = projectedExpenses.reduce((sum, e) => sum + e.annualCost, 0);

        return {
            principal,
            effectiveBase,
            rate,
            gains,
            deductions,
            annualGainAmount,
            principalReturnBalance,
            expenses: projectedExpenses,
            totalAnnualCost,
            isDrainingPrincipal: principalReturnBalance < 0
        };
    },

    /**
     * Compute total principal (sum of deposits) and the rate in effect at the given date.
     *
     * @param {Array} sortedEvents — events sorted by date ascending
     * @param {string} dateStr — ISO date string to compute at
     * @param {Object} settings — app settings (for initialPrincipal fallback)
     * @returns {{ principal: number, rate: number }}
     */
    _computePrincipalAndRate(sortedEvents, dateStr, settings) {
        let principal = 0;
        let rate = 0.07;

        sortedEvents.forEach(ev => {
            if (ev.date > dateStr) return;
            if (ev.type === 'deposit') principal += ev.amount;
            if (ev.type === 'rate_change') rate = ev.rate;
        });

        // Fallback: if no deposit events exist, use settings.initialPrincipal
        if (principal === 0 && settings.initialPrincipal > 0) {
            principal = settings.initialPrincipal;
        }

        return { principal, rate };
    },

    /**
     * Build a unified, sorted timeline of all cash-flow events up to the projection date.
     *
     * Includes: deposits (inflow), rate changes, procurements (outflow),
     * and synthesized monthly OpEx payments per expense.
     *
     * OpEx synthesis starts from max(fundStartDate, expense.lastProcurementDate)
     * to prevent the backdating bug.
     *
     * @param {Array} sortedEvents — raw events sorted by date
     * @param {Array} expenses — current expense definitions
     * @param {Date} fundStart — fund start date
     * @param {Date} date — projection date
     * @param {string} dateStr — ISO date string of projection date
     * @returns {Array} — sorted cash-flow events with { date, kind, amount?, rate? }
     */
    _buildCashFlowTimeline(sortedEvents, expenses, fundStart, date, dateStr) {
        const cashFlowEvents = [];

        // Real events: deposits, rate changes, procurements
        sortedEvents.forEach(ev => {
            if (ev.date > dateStr) return;
            if (ev.type === 'deposit') {
                cashFlowEvents.push({ date: ev.date, kind: 'deposit', amount: ev.amount });
            } else if (ev.type === 'rate_change') {
                cashFlowEvents.push({ date: ev.date, kind: 'rate_change', rate: ev.rate });
            } else if (ev.type === 'procurement') {
                cashFlowEvents.push({ date: ev.date, kind: 'outflow', amount: ev.cost });
            }
        });

        // Synthesized OpEx payments — per expense, starting from the correct date
        expenses.filter(e => e.type === 'opex').forEach(exp => {
            const monthlyCost = exp.billingCycle === 'monthly' ? exp.cost : exp.cost / 12;
            if (monthlyCost <= 0) return;

            const expStartRaw = exp.lastProcurementDate ? new Date(exp.lastProcurementDate) : fundStart;
            const expStart = expStartRaw > fundStart ? expStartRaw : fundStart;

            let y = expStart.getFullYear();
            let m = expStart.getMonth() + 1; // first payment one month after start
            while (true) {
                if (m > 11) { m -= 12; y++; }
                const payDate = new Date(y, m, 1);
                if (payDate > date) break;
                if (payDate >= fundStart) {
                    cashFlowEvents.push({
                        date: payDate.toISOString().split('T')[0],
                        kind: 'outflow',
                        amount: monthlyCost
                    });
                }
                m++;
            }
        });

        cashFlowEvents.sort((a, b) => a.date.localeCompare(b.date));
        return cashFlowEvents;
    },

    /**
     * Compute piecewise compound growth through the cash-flow timeline.
     *
     * For each period between events, compounds at the current rate:
     *   growth = base * ((1 + rate)^(days/365) - 1)
     *
     * Deposits increase the compound base; outflows decrease it.
     * When the base goes negative (draining principal), growth halts.
     *
     * @param {Array} cashFlowEvents — sorted cash-flow events
     * @param {number} principal — total principal (for fallback when no deposit events)
     * @param {Date} fundStart — fund start date
     * @param {Date} date — projection date
     * @returns {{ gains: number, compoundBase: number }}
     */
    _computeCompoundGrowth(cashFlowEvents, principal, fundStart, date) {
        let gains = 0;
        let currentRate = 0.07;
        const hasDepositEvents = cashFlowEvents.some(ev => ev.kind === 'deposit');
        let compoundBase = hasDepositEvents ? 0 : principal;
        let currentStart = fundStart;

        for (const ev of cashFlowEvents) {
            const evDate = new Date(ev.date);
            if (evDate > fundStart && evDate <= date) {
                const days = (evDate - currentStart) / this.MS_PER_DAY;
                if (days > 0 && compoundBase > 0) {
                    const periodGrowth = compoundBase * (Math.pow(1 + currentRate, days / 365) - 1);
                    gains += periodGrowth;
                    compoundBase += periodGrowth;
                }
                currentStart = evDate;
            }
            if (ev.kind === 'rate_change') {
                currentRate = ev.rate;
            } else if (ev.kind === 'deposit') {
                compoundBase += ev.amount;
            } else if (ev.kind === 'outflow') {
                compoundBase -= ev.amount;
            }
        }

        // Final period: from last event to projection date
        const finalDays = (date - currentStart) / this.MS_PER_DAY;
        if (finalDays > 0 && compoundBase > 0) {
            const periodGrowth = compoundBase * (Math.pow(1 + currentRate, finalDays / 365) - 1);
            gains += periodGrowth;
            compoundBase += periodGrowth;
        }

        return { gains, compoundBase };
    },

    /**
     * Compute per-expense metadata: annual cost, last procurement date,
     * gain start date, scheduled date.
     *
     * @param {Array} expenses — expense definitions
     * @param {Array} sortedEvents — events sorted by date
     * @param {Date} fundStart — fund start date
     * @param {Date} date — projection date
     * @returns {Array} — expense data objects with allocation slots
     */
    _computeExpenseData(expenses, sortedEvents, fundStart, date) {
        return expenses.map(exp => {
            // Annual cost: CapEx = cost/interval, OpEx = yearly or monthly*12
            let annualCost;
            if (exp.type === 'capex') {
                annualCost = exp.cost / exp.interval;
            } else {
                annualCost = exp.billingCycle === 'yearly' ? exp.cost : exp.cost * 12;
            }

            // Find last procurement date from events
            const lastProcEvents = sortedEvents
                .filter(ev => ev.type === 'procurement' && ev.expenseId === exp.id)
                .sort((a, b) => new Date(b.date) - new Date(a.date));

            let lastProcDate = exp.lastProcurementDate ? new Date(exp.lastProcurementDate) : fundStart;
            if (lastProcEvents.length > 0) {
                lastProcDate = new Date(lastProcEvents[0].date);
            }

            // Clamp gain start to fund start (gains can't accumulate before the fund existed)
            const gainStartDate = lastProcDate < fundStart ? fundStart : lastProcDate;

            // Scheduled date: when the next procurement is due (CapEx only)
            let scheduledDate = null;
            if (exp.type === 'capex') {
                const nextDate = new Date(lastProcDate.getTime() + (exp.interval * this.DAYS_PER_YEAR * this.MS_PER_DAY));
                scheduledDate = nextDate.toISOString().split('T')[0];
            }

            return { exp, annualCost, lastProcDate, gainStartDate, scheduledDate, allocatedAnnualGains: 0 };
        });
    },

    /**
     * Allocate annual gains to expenses: OpEx first (mandatory), then CapEx (proportional).
     *
     * Modifies expenseData in place (sets allocatedAnnualGains on each item).
     *
     * @param {Array} expenseData — from _computeExpenseData()
     * @param {number} annualGainAmount — effective base * rate
     */
    _allocateGains(expenseData, annualGainAmount) {
        // OpEx gets first claim
        const totalOpExAnnual = expenseData
            .filter(d => d.exp.type === 'opex')
            .reduce((sum, d) => sum + d.annualCost, 0);

        const opexCoverageRatio = totalOpExAnnual > 0
            ? Math.min(1, annualGainAmount / totalOpExAnnual)
            : 1;

        const gainsAfterOpex = Math.max(0, annualGainAmount - totalOpExAnnual);

        expenseData.forEach(d => {
            if (d.exp.type === 'opex') {
                d.allocatedAnnualGains = d.annualCost * opexCoverageRatio;
            }
        });

        // Remaining gains to CapEx proportionally by annual cost
        const capexItems = expenseData.filter(d => d.exp.type === 'capex');
        const totalCapExAnnual = capexItems.reduce((sum, d) => sum + d.annualCost, 0);

        capexItems.forEach(d => {
            const share = totalCapExAnnual > 0 ? d.annualCost / totalCapExAnnual : 0;
            d.allocatedAnnualGains = share * gainsAfterOpex;
        });
    },

    /**
     * Redistribute surplus from fully-funded CapEx items to underfunded ones.
     *
     * A CapEx item is "fully funded" when:
     *   allocatedAnnualGains * yearsSinceLastProc >= cost
     *
     * The excess (allocatedAnnualGains - cost/yearsSinceLastProc) flows to
     * unfunded items proportionally by annual cost. Iterates until stable.
     *
     * Modifies expenseData in place.
     *
     * @param {Array} expenseData — from _computeExpenseData() with allocations set
     * @param {Date} date — projection date
     */
    _redistributeSurplus(expenseData, date) {
        const capexItems = expenseData.filter(d => d.exp.type === 'capex');

        // Precompute years since last procurement for each item
        capexItems.forEach(d => {
            const daysSinceProc = Math.max(0, (date - d.gainStartDate) / this.MS_PER_DAY);
            d._yearsSinceProc = daysSinceProc / this.DAYS_PER_YEAR;
        });

        // Iterative redistribution (converges in at most N+1 iterations)
        const maxIterations = capexItems.length + 1;
        for (let iter = 0; iter < maxIterations; iter++) {
            let surplus = 0;
            const unfunded = [];

            capexItems.forEach(d => {
                if (d._yearsSinceProc > 0) {
                    const accumulated = d.allocatedAnnualGains * d._yearsSinceProc;
                    if (accumulated >= d.exp.cost) {
                        const needed = d.exp.cost / d._yearsSinceProc;
                        surplus += d.allocatedAnnualGains - needed;
                        d.allocatedAnnualGains = needed;
                    } else {
                        unfunded.push(d);
                    }
                } else {
                    unfunded.push(d);
                }
            });

            if (surplus <= 0 || unfunded.length === 0) break;

            const unfundedTotal = unfunded.reduce((sum, d) => sum + d.annualCost, 0);
            unfunded.forEach(d => {
                const proportion = unfundedTotal > 0
                    ? d.annualCost / unfundedTotal
                    : 1 / unfunded.length;
                d.allocatedAnnualGains += surplus * proportion;
            });
        }

        // Cleanup
        capexItems.forEach(d => { delete d._yearsSinceProc; });
    },

    /**
     * Build the final projected expense objects from expense data.
     *
     * Computes: progress %, allocated gains, projected date, isFunded flag.
     *
     * @param {Array} expenseData — with allocations set
     * @param {Date} date — projection date
     * @returns {Array} — projected expense objects for the result
     */
    _buildProjectedExpenses(expenseData, date) {
        return expenseData.map(d => {
            const { exp, annualCost, lastProcDate, gainStartDate, scheduledDate, allocatedAnnualGains } = d;

            let allocatedGains = 0;
            let progress = 0;

            if (exp.type === 'capex') {
                const daysSinceProc = Math.max(0, (date - gainStartDate) / this.MS_PER_DAY);
                const yearsSinceProc = daysSinceProc / this.DAYS_PER_YEAR;
                allocatedGains = allocatedAnnualGains * yearsSinceProc;
                progress = exp.cost > 0 ? (allocatedGains / exp.cost) * 100 : 0;
            } else {
                allocatedGains = allocatedAnnualGains;
                progress = annualCost > 0 ? (allocatedAnnualGains / annualCost) * 100 : 0;
            }

            // Projected date: when accumulated gains reach the cost
            let projectedDate = null;
            if (exp.type === 'capex' && allocatedAnnualGains > 0) {
                const yearsToFund = exp.cost / allocatedAnnualGains;
                const projDate = new Date(gainStartDate.getTime() + (yearsToFund * this.DAYS_PER_YEAR * this.MS_PER_DAY));
                projectedDate = projDate.toISOString().split('T')[0];
            }

            const isFunded = exp.type === 'capex'
                ? progress >= 100
                : allocatedAnnualGains >= annualCost;

            const notYetStarted = gainStartDate > date;

            return {
                ...exp,
                annualCost,
                allocatedGains,
                allocatedAnnualGains,
                progress: Math.max(0, progress),
                scheduledDate,
                projectedDate,
                lastProcurementDate: lastProcDate.toISOString().split('T')[0],
                gainStartDate: gainStartDate.toISOString().split('T')[0],
                notYetStarted,
                isFunded
            };
        });
    },

    // ========== MONTE CARLO SIMULATION ==========

    /**
     * Run a Monte Carlo simulation to produce confidence bands for the projection chart.
     *
     * Isolated layer — does NOT modify any existing state or calculations.
     *
     * For each trial, generates randomized annual returns from a lognormal distribution
     * (Box-Muller transform), then simulates quarterly compound growth with expense
     * deductions. Produces percentile bands (p10, p25, p50, p75, p90) at each quarter.
     *
     * Lognormal parameters:
     *   mu = ln(1 + expectedRate) - sigma^2/2  (drift-adjusted so median matches expected)
     *   sigma = volatility (default 0.15 for equity-like assets)
     *
     * @param {number} years — projection horizon
     * @param {number} [trials=300] — number of simulation paths
     * @param {number} [volatility=0.15] — annualized volatility (standard deviation of log returns)
     * @returns {Array<{ date: string, p10: number, p25: number, p50: number, p75: number, p90: number }>}
     */
    runMonteCarlo(years, trials, volatility) {
        trials = trials || 300;
        volatility = volatility || 0.15;

        const settings = this.data.settings;
        const fundStart = new Date(settings.fundStartDate);
        const expectedRate = this.getCurrentRate();

        // Baseline projection to get starting values
        const baseProj = this.project(fundStart);
        const startPrincipal = baseProj.principal || settings.initialPrincipal;
        const quarterlyExpense = baseProj.totalAnnualCost / 4;

        // Drift-adjusted mu for lognormal: E[exp(mu + sigma*Z)] = 1 + expectedRate
        const mu = Math.log(1 + expectedRate) - (volatility * volatility) / 2;

        const totalQuarters = years * 4;

        // results[quarter] = array of PR balances across trials
        const results = [];
        for (let q = 0; q <= totalQuarters; q++) {
            results.push([]);
        }

        for (let t = 0; t < trials; t++) {
            // Generate annual returns for this trial
            const annualReturns = [];
            for (let y = 0; y < years; y++) {
                // Box-Muller transform for standard normal
                const u1 = Math.random() || 0.0001; // avoid log(0)
                const u2 = Math.random();
                const z = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
                const logReturn = mu + volatility * z;
                annualReturns.push(Math.exp(logReturn) - 1);
            }

            // Simulate quarterly: track compound base and cumulative gains/deductions
            let base = startPrincipal;
            let cumGains = 0;
            let cumDeductions = 0;

            results[0].push(0); // At fund start, PR balance = 0

            // Include future deposits (events with date > fundStart)
            const futureDeposits = this.data.events
                .filter(ev => ev.type === 'deposit' && new Date(ev.date) > fundStart)
                .sort((a, b) => new Date(a.date) - new Date(b.date));

            for (let q = 1; q <= totalQuarters; q++) {
                const yearIndex = Math.min(Math.floor((q - 1) / 4), annualReturns.length - 1);
                const r = annualReturns[yearIndex];
                const quarterlyRate = Math.pow(1 + r, 0.25) - 1;

                // Check for deposits in this quarter
                const qStart = new Date(fundStart.getTime() + ((q - 1) * 91.31 * 24 * 60 * 60 * 1000));
                const qEnd = new Date(fundStart.getTime() + (q * 91.31 * 24 * 60 * 60 * 1000));
                for (const dep of futureDeposits) {
                    const depDate = new Date(dep.date);
                    if (depDate > qStart && depDate <= qEnd) {
                        base += dep.amount;
                    }
                }

                // Grow base (only if positive)
                const gain = base > 0 ? base * quarterlyRate : 0;
                cumGains += gain;
                base += gain;

                // Deduct expenses
                base -= quarterlyExpense;
                cumDeductions += quarterlyExpense;

                results[q].push(cumGains - cumDeductions);
            }
        }

        // Compute percentile bands at each quarter
        const bands = [];
        for (let q = 0; q <= totalQuarters; q++) {
            const sorted = results[q].slice().sort((a, b) => a - b);
            const len = sorted.length;
            const qDate = new Date(fundStart.getTime() + (q * 91.31 * 24 * 60 * 60 * 1000));
            bands.push({
                date: qDate.toISOString().split('T')[0],
                p10: sorted[Math.floor(len * 0.10)] || 0,
                p25: sorted[Math.floor(len * 0.25)] || 0,
                p50: sorted[Math.floor(len * 0.50)] || 0,
                p75: sorted[Math.floor(len * 0.75)] || 0,
                p90: sorted[Math.floor(len * 0.90)] || 0,
            });
        }

        return bands;
    },

    // ========== RENDER ==========

    renderProjection(opts) {
        const skipList = opts && opts.skipList;
        const proj = this.project(this.timelineDate);

        // Balance display
        const balanceEl = document.getElementById('prBalance');
        balanceEl.textContent = this.formatNumber(proj.principalReturnBalance) + ' SEK';
        balanceEl.className = 'balance-value';
        if (proj.principalReturnBalance < 0) {
            balanceEl.classList.add('danger');
        } else if (proj.principalReturnBalance < proj.totalAnnualCost) {
            balanceEl.classList.add('warning');
        }

        // Quick Win 1: Show what fraction of expenses is funded from principal
        const balanceHintEl = document.getElementById('balanceHint');
        if (balanceHintEl) {
            if (proj.isDrainingPrincipal) {
                const pctFromPrincipal = proj.totalAnnualCost > 0
                    ? Math.min(100, Math.round((-proj.principalReturnBalance / (proj.totalAnnualCost * ((this.timelineDate - new Date(this.data.settings.fundStartDate)) / (365.25 * 24 * 60 * 60 * 1000)))) * 100))
                    : 0;
                balanceHintEl.textContent = 'Funding ' + this.formatNumber(-proj.principalReturnBalance) + ' SEK from principal';
                balanceHintEl.style.color = 'var(--accent-danger)';
                balanceHintEl.style.display = '';
            } else {
                balanceHintEl.textContent = '';
                balanceHintEl.style.display = 'none';
            }
        }

        // Header stats
        document.getElementById('principalDisplay').textContent = this.formatNumber(proj.principal) + ' SEK';
        document.getElementById('gainsDisplay').textContent = this.formatNumber(proj.gains) + ' SEK';

        // Required principal: the minimum principal that fully funds all expenses at current rate
        const requiredPrincipal = proj.rate > 0 ? proj.totalAnnualCost / proj.rate : 0;
        const reqEl = document.getElementById('requiredPrincipalDisplay');
        reqEl.textContent = this.formatNumber(requiredPrincipal) + ' SEK';
        // Quick Win 4: Color required red when underfunded, green when OK
        if (proj.principal >= requiredPrincipal && requiredPrincipal > 0) {
            reqEl.style.color = 'var(--accent-primary)';
        } else if (requiredPrincipal > 0) {
            reqEl.style.color = 'var(--accent-danger)';
        } else {
            reqEl.style.color = 'var(--text-secondary)';
        }

        // Quick Win 12: Show monthly gain from effective base
        const monthlyGainEl = document.getElementById('monthlyGainHint');
        if (monthlyGainEl) {
            const monthlyGain = proj.annualGainAmount / 12;
            monthlyGainEl.textContent = '\u2248 ' + this.formatNumber(monthlyGain) + ' SEK/month in gains';
        }

        // Draining warning
        document.getElementById('drainingWarning').style.display = proj.isDrainingPrincipal ? 'inline-flex' : 'none';

        // Quick Win 5: Rate warning for unrealistic rates
        const rateWarningEl = document.getElementById('rateWarning');
        if (rateWarningEl) {
            if (proj.rate > 0.10) {
                rateWarningEl.textContent = 'Sustained returns above 10% are historically rare';
                rateWarningEl.style.display = '';
            } else {
                rateWarningEl.style.display = 'none';
            }
        }

        // Timeline date display
        document.getElementById('timelineDateDisplay').textContent = this.timelineDate.toISOString().split('T')[0];

        // Unified list — skip during drag to avoid flicker
        if (!skipList) {
            this.renderUnifiedList(proj);
        }
    },

    render() {
        this.renderProjection();

        // Settings inputs (avoid fighting active focus)
        const principalEl = document.getElementById('initialPrincipal');
        if (document.activeElement !== principalEl) {
            principalEl.value = this.data.settings.initialPrincipal;
        }
        const fundStartEl = document.getElementById('fundStartDate');
        if (document.activeElement !== fundStartEl) {
            fundStartEl.value = this.data.settings.fundStartDate;
        }
        document.getElementById('accountType').value = this.data.settings.accountType;

        const currentRate = this.getCurrentRate();
        const returnRateEl = document.getElementById('returnRate');
        if (document.activeElement !== returnRateEl) {
            returnRateEl.value = currentRate * 100;
        }
        document.getElementById('returnRateValue').textContent = (currentRate * 100).toFixed(1) + '%';

        // Redistribute toggle
        document.getElementById('redistributeToggle').checked = this.data.settings.redistributeFullyFunded !== false;

        // Inflation toggle
        document.getElementById('inflationToggle').checked = this.data.settings.showRealValues === true;
        const inflRateEl = document.getElementById('inflationRate');
        if (document.activeElement !== inflRateEl) {
            inflRateEl.value = ((this.data.settings.inflationRate || 0.02) * 100).toFixed(1);
        }

        // Projection horizon
        const projYearsEl = document.getElementById('projectionYears');
        if (document.activeElement !== projYearsEl) {
            projYearsEl.value = this.data.settings.projectionYears || 20;
        }

        // List debounce
        const debounceEl = document.getElementById('listDebounceMs');
        if (document.activeElement !== debounceEl) {
            debounceEl.value = this.data.settings.listDebounceMs ?? 300;
        }
    },

    getCurrentRate() {
        const events = this.data.events.filter(ev => ev.type === 'rate_change');
        events.sort((a, b) => new Date(b.date) - new Date(a.date));
        return events.length > 0 ? events[0].rate : 0.07;
    },

    // ========== UNIFIED LIST ==========

    renderUnifiedList(proj) {
        if (!proj) proj = this.project(this.timelineDate);

        const container = document.getElementById('unifiedList');
        const filter = this.activeFilter;

        // Build unified items array
        const items = [];

        // 1. Expenses (as rich cards)
        proj.expenses.forEach(exp => {
            items.push({
                kind: 'expense',
                subtype: exp.type, // capex or opex
                date: exp.lastProcurementDate || this.data.settings.fundStartDate,
                sortDate: exp.scheduledDate || exp.lastProcurementDate || this.data.settings.fundStartDate,
                expense: exp,
                key: 'exp-' + exp.id
            });
        });

        // 2. Events (as simple rows) —
        //    exclude expense_create/expense_update/expense_delete (represented by expense rows)
        this.data.events.forEach(ev => {
            if (ev.type === 'expense_create' || ev.type === 'expense_update' || ev.type === 'expense_delete') return;

            items.push({
                kind: 'event',
                subtype: ev.type, // deposit, rate_change, procurement
                date: ev.date,
                sortDate: ev.date,
                event: ev,
                key: 'ev-' + ev.id
            });
        });

        // Apply filter
        const filtered = items.filter(item => {
            switch (filter) {
                case 'all': return true;
                case 'expenses': return item.kind === 'expense';
                case 'capex': return item.kind === 'expense' && item.subtype === 'capex';
                case 'opex': return item.kind === 'expense' && item.subtype === 'opex';
                case 'deposits': return item.kind === 'event' && (item.subtype === 'deposit');
                case 'rates': return item.kind === 'event' && item.subtype === 'rate_change';
                case 'procurements': return item.kind === 'event' && item.subtype === 'procurement';
                default: return true;
            }
        });

        // Sort: newest first
        filtered.sort((a, b) => {
            if (b.sortDate < a.sortDate) return -1;
            if (b.sortDate > a.sortDate) return 1;
            return 0;
        });

        // Update filter tab counts
        this.updateFilterCounts(items);

        if (filtered.length === 0) {
            const msg = filter === 'all' ? 'No events or expenses yet' : 'No items match this filter';
            container.innerHTML = '<div class="empty-state">' + msg + '</div>';
            return;
        }

        // Keyed DOM update: reuse existing nodes, patch expenses in place, remove stale
        const existingNodes = {};
        Array.from(container.children).forEach(child => {
            const key = child.getAttribute('data-item-key');
            if (key) existingNodes[key] = child;
        });

        // Remove nodes whose keys are no longer present
        const newKeySet = new Set(filtered.map(item => item.key));
        Object.keys(existingNodes).forEach(key => {
            if (!newKeySet.has(key)) {
                existingNodes[key].remove();
                delete existingNodes[key];
            }
        });

        // Update or insert nodes in order
        let prevNode = null;
        for (let i = 0; i < filtered.length; i++) {
            const item = filtered[i];
            const key = item.key;
            let node = existingNodes[key];

            if (node) {
                // Existing node — patch dynamic values without rebuilding DOM
                if (item.kind === 'expense') {
                    this._updateExpenseInPlace(node, item.expense);
                }
                // Event rows are static — nothing to patch
            } else {
                // New item — build full DOM node
                const html = item.kind === 'expense'
                    ? this.renderExpenseRow(item.expense)
                    : this.renderEventRow(item.event);
                node = document.createElement('div');
                node.setAttribute('data-item-key', key);
                node.innerHTML = html;
                existingNodes[key] = node;
            }

            // Ensure correct order: node should come after prevNode
            const expectedNext = prevNode ? prevNode.nextSibling : container.firstChild;
            if (node !== expectedNext) {
                if (prevNode) {
                    prevNode.after(node);
                } else {
                    container.prepend(node);
                }
            }

            prevNode = node;
        }

        // Remove any leftover non-keyed children (e.g. empty-state div)
        Array.from(container.children).forEach(child => {
            if (!child.getAttribute('data-item-key')) {
                child.remove();
            }
        });
    },

    updateFilterCounts(items) {
        const counts = {
            all: items.length,
            expenses: items.filter(i => i.kind === 'expense').length,
            capex: items.filter(i => i.kind === 'expense' && i.subtype === 'capex').length,
            opex: items.filter(i => i.kind === 'expense' && i.subtype === 'opex').length,
            deposits: items.filter(i => i.kind === 'event' && i.subtype === 'deposit').length,
            rates: items.filter(i => i.kind === 'event' && i.subtype === 'rate_change').length,
            procurements: items.filter(i => i.kind === 'event' && i.subtype === 'procurement').length,
        };

        document.querySelectorAll('.filter-tab').forEach(tab => {
            const f = tab.dataset.filter;
            const count = counts[f] || 0;
            const countSpan = tab.querySelector('.count');
            if (countSpan) {
                countSpan.textContent = count;
            } else {
                const label = tab.textContent.trim();
                tab.innerHTML = label + ' <span class="count">' + count + '</span>';
            }
        });
    },

    renderExpenseRow(exp) {
        if (exp.type === 'capex') {
            return this.renderCapExRow(exp);
        } else {
            return this.renderOpExRow(exp);
        }
    },

    renderCapExRow(exp) {
        const progressClass = exp.progress >= 100 ? '' : exp.progress >= 50 ? 'warning' : 'danger';

        // Quick Win 3: Show SEK accumulated vs cost
        const accumulatedStr = this.formatNumber(Math.min(exp.allocatedGains, exp.cost)) + ' of ' + this.formatNumber(exp.cost) + ' SEK';

        // Quick Win 9: Underfunded warning when projected date > scheduled date
        let underfundedWarning = '';
        if (!exp.notYetStarted && exp.scheduledDate && exp.projectedDate && exp.projectedDate > exp.scheduledDate && exp.progress < 100) {
            const schedMs = new Date(exp.scheduledDate).getTime();
            const projMs = new Date(exp.projectedDate).getTime();
            const monthsLate = Math.round((projMs - schedMs) / (30.44 * 24 * 60 * 60 * 1000));
            if (monthsLate > 0) {
                underfundedWarning = 'Underfunded \u2014 projected completion ' + monthsLate + ' month' + (monthsLate !== 1 ? 's' : '') + ' late';
            }
        }

        // Dim expenses that haven't started yet at the current timeline date
        const futureStyle = exp.notYetStarted ? ' style="opacity: 0.45;"' : '';
        const futureLabel = exp.notYetStarted ? ' <span class="expense-future-label" data-role="future-label" style="font-size: 0.6rem; color: var(--accent-secondary); text-transform: uppercase; letter-spacing: 0.3px;">Starts ' + exp.gainStartDate + '</span>' : '';

        return '<div class="expense-row"' + futureStyle + ' data-not-started="' + (exp.notYetStarted ? '1' : '0') + '">' +
            '<div class="expense-info">' +
                '<div class="expense-name-row">' +
                    '<span class="expense-name">' + this.escapeHtml(exp.name) + '</span>' +
                    '<span class="expense-type capex">CapEx</span>' +
                    futureLabel +
                '</div>' +
                '<div class="expense-meta">' +
                    '<span>Every ' + exp.interval + ' years</span>' +
                    '<span>Last: ' + exp.lastProcurementDate + '</span>' +
                '</div>' +
                '<div class="progress-section">' +
                    '<div class="progress-bar">' +
                        '<div class="progress-fill ' + progressClass + '" data-role="progress-fill" style="width: ' + Math.min(exp.progress, 100) + '%"></div>' +
                    '</div>' +
                    '<div class="progress-info">' +
                        '<span class="progress-percent" data-role="progress-pct">' + exp.progress.toFixed(0) + '% funded &middot; ' + accumulatedStr + '</span>' +
                        '<span class="progress-dates" data-role="progress-dates">' +
                            (exp.scheduledDate ? 'Sched: ' + exp.scheduledDate : '') +
                            (exp.projectedDate ? ' &rarr; Proj: ' + exp.projectedDate : '') +
                        '</span>' +
                    '</div>' +
                    '<div data-role="underfunded-warn" style="font-size: 0.7rem; color: var(--accent-warning); margin-top: 2px;">' + underfundedWarning + '</div>' +
                '</div>' +
            '</div>' +
            '<div class="expense-cost">' + this.formatNumber(exp.cost) + ' SEK</div>' +
            '<div class="expense-actions">' +
                '<button class="icon-btn" onclick="FundFlow.openProcurementModal(\'' + exp.id + '\')" title="Procure">&#x1F6D2;</button>' +
                '<button class="icon-btn" onclick="FundFlow.openExpenseModal(\'' + exp.id + '\')" title="Edit">&#x270E;</button>' +
                '<button class="icon-btn danger" onclick="FundFlow.deleteExpense(\'' + exp.id + '\')" title="Delete">&#x2715;</button>' +
            '</div>' +
        '</div>';
    },

    renderOpExRow(exp) {
        const progressClass = exp.progress >= 100 ? '' : exp.progress >= 50 ? 'warning' : 'danger';

        // Quick Win 6: Show opportunity cost — gains consumed by this subscription
        const opportunityCost = 'This costs ' + this.formatNumber(exp.annualCost) + ' SEK/yr in gains unavailable for CapEx';

        // Dim expenses that haven't started yet at the current timeline date
        const futureStyle = exp.notYetStarted ? ' style="opacity: 0.45;"' : '';
        const futureLabel = exp.notYetStarted ? ' <span class="expense-future-label" data-role="future-label" style="font-size: 0.6rem; color: var(--accent-secondary); text-transform: uppercase; letter-spacing: 0.3px;">Starts ' + exp.gainStartDate + '</span>' : '';

        return '<div class="expense-row"' + futureStyle + ' data-not-started="' + (exp.notYetStarted ? '1' : '0') + '">' +
            '<div class="expense-info">' +
                '<div class="expense-name-row">' +
                    '<span class="expense-name">' + this.escapeHtml(exp.name) + '</span>' +
                    '<span class="expense-type opex">Sub</span>' +
                    futureLabel +
                '</div>' +
                '<div data-role="opex-info" class="opex-info">' +
                    'Yearly: ' + this.formatNumber(exp.annualCost) + ' SEK | Allocated: ' + this.formatNumber(exp.allocatedGains) + ' SEK/yr | Since: ' + exp.lastProcurementDate +
                '</div>' +
                '<div class="progress-section">' +
                    '<div class="progress-bar">' +
                        '<div class="progress-fill ' + progressClass + '" data-role="progress-fill" style="width: ' + Math.min(exp.progress, 100) + '%"></div>' +
                    '</div>' +
                    '<div class="progress-info">' +
                        '<span class="progress-percent" data-role="progress-pct">' + exp.progress.toFixed(0) + '% covered</span>' +
                        '<span class="progress-dates" data-role="progress-dates" style="color: var(--text-muted); font-size: 0.65rem;">' + opportunityCost + '</span>' +
                    '</div>' +
                '</div>' +
            '</div>' +
            '<div class="expense-cost">' + this.formatNumber(exp.cost) + ' SEK/' + (exp.billingCycle === 'monthly' ? 'mo' : 'yr') + '</div>' +
            '<div class="expense-actions">' +
                '<button class="icon-btn" onclick="FundFlow.openExpenseModal(\'' + exp.id + '\')" title="Edit">&#x270E;</button>' +
                '<button class="icon-btn danger" onclick="FundFlow.deleteExpense(\'' + exp.id + '\')" title="Delete">&#x2715;</button>' +
            '</div>' +
        '</div>';
    },

    // Patch only the dynamic values inside an existing expense DOM node
    _updateExpenseInPlace(node, exp) {
        const fill = node.querySelector('[data-role="progress-fill"]');
        if (fill) {
            const pct = Math.min(exp.progress, 100);
            fill.style.width = pct + '%';
            fill.className = 'progress-fill ' + (exp.progress >= 100 ? '' : exp.progress >= 50 ? 'warning' : 'danger');
        }

        const pctSpan = node.querySelector('[data-role="progress-pct"]');
        if (pctSpan) {
            if (exp.type === 'capex') {
                const accStr = this.formatNumber(Math.min(exp.allocatedGains, exp.cost)) + ' of ' + this.formatNumber(exp.cost) + ' SEK';
                pctSpan.innerHTML = exp.progress.toFixed(0) + '% funded &middot; ' + accStr;
            } else {
                pctSpan.textContent = exp.progress.toFixed(0) + '% covered';
            }
        }

        const dates = node.querySelector('[data-role="progress-dates"]');
        if (dates) {
            if (exp.type === 'capex') {
                dates.innerHTML =
                    (exp.scheduledDate ? 'Sched: ' + exp.scheduledDate : '') +
                    (exp.projectedDate ? ' &rarr; Proj: ' + exp.projectedDate : '');
            } else {
                dates.textContent = 'This costs ' + this.formatNumber(exp.annualCost) + ' SEK/yr in gains unavailable for CapEx';
            }
        }

        const warn = node.querySelector('[data-role="underfunded-warn"]');
        if (warn) {
            let msg = '';
            if (!exp.notYetStarted && exp.scheduledDate && exp.projectedDate && exp.projectedDate > exp.scheduledDate && exp.progress < 100) {
                const schedMs = new Date(exp.scheduledDate).getTime();
                const projMs = new Date(exp.projectedDate).getTime();
                const monthsLate = Math.round((projMs - schedMs) / (30.44 * 24 * 60 * 60 * 1000));
                if (monthsLate > 0) {
                    msg = 'Underfunded \u2014 projected completion ' + monthsLate + ' month' + (monthsLate !== 1 ? 's' : '') + ' late';
                }
            }
            warn.textContent = msg;
        }

        const opexInfo = node.querySelector('[data-role="opex-info"]');
        if (opexInfo) {
            opexInfo.textContent = 'Yearly: ' + this.formatNumber(exp.annualCost) + ' SEK | Allocated: ' + this.formatNumber(exp.allocatedGains) + ' SEK/yr | Since: ' + exp.lastProcurementDate;
        }

        // Toggle not-yet-started dimming and label
        const row = node.querySelector('.expense-row') || node;
        const wasNotStarted = row.getAttribute('data-not-started') === '1';
        const isNotStarted = !!exp.notYetStarted;
        if (wasNotStarted !== isNotStarted) {
            row.style.opacity = isNotStarted ? '0.45' : '';
            row.setAttribute('data-not-started', isNotStarted ? '1' : '0');
            const existingLabel = row.querySelector('[data-role="future-label"]');
            if (isNotStarted && !existingLabel) {
                const nameRow = row.querySelector('.expense-name-row');
                if (nameRow) {
                    const span = document.createElement('span');
                    span.className = 'expense-future-label';
                    span.setAttribute('data-role', 'future-label');
                    span.style.cssText = 'font-size: 0.6rem; color: var(--accent-secondary); text-transform: uppercase; letter-spacing: 0.3px;';
                    span.textContent = 'Starts ' + exp.gainStartDate;
                    nameRow.appendChild(span);
                }
            } else if (!isNotStarted && existingLabel) {
                existingLabel.remove();
            }
        } else if (isNotStarted) {
            // Update the date text even if the flag hasn't toggled
            const label = row.querySelector('[data-role="future-label"]');
            if (label) label.textContent = 'Starts ' + exp.gainStartDate;
        }
    },

    renderEventRow(ev) {
        const icons = {
            'deposit': '+',
            'rate_change': '~',
            'procurement': '&#x2713;'
        };
        const badges = {
            'deposit': '<span class="event-badge deposit">Deposit</span>',
            'rate_change': '<span class="event-badge rate">Rate</span>',
            'procurement': '<span class="event-badge deposit">Procure</span>'
        };

        let desc = '';
        let value = '';
        if (ev.type === 'deposit') {
            desc = 'Added to principal';
            value = '+ ' + this.formatNumber(ev.amount) + ' SEK';
        } else if (ev.type === 'rate_change') {
            desc = 'Rate changed';
            value = (ev.rate * 100).toFixed(1) + '%';
        } else if (ev.type === 'procurement') {
            desc = ev.expenseName || 'Expense';
            if (ev.note) desc += ' — ' + this.escapeHtml(ev.note);
            value = this.formatNumber(ev.cost) + ' SEK';
        }

        // Edit button: procurement uses its own modal; deposit/rate_change use the event modal
        let editBtn = '';
        if (ev.type === 'procurement') {
            editBtn = '<button class="icon-btn" onclick="FundFlow.editProcurementEvent(\'' + ev.id + '\')" title="Edit">&#x270E;</button>';
        } else {
            editBtn = '<button class="icon-btn" onclick="FundFlow.editEvent(\'' + ev.id + '\')" title="Edit">&#x270E;</button>';
        }

        // Quick Win 11: Dim future events and label them "Scheduled"
        const today = new Date().toISOString().split('T')[0];
        const isFuture = ev.date > today;
        const futureStyle = isFuture ? ' style="opacity: 0.5;"' : '';
        const futureLabel = isFuture ? ' <span style="font-size: 0.6rem; color: var(--accent-secondary); text-transform: uppercase; letter-spacing: 0.3px;">Scheduled</span>' : '';

        return '<div class="event-row"' + futureStyle + '>' +
            '<span class="event-date">' + ev.date + '</span>' +
            '<span class="event-icon">' + (icons[ev.type] || '&bull;') + '</span>' +
            (badges[ev.type] || '') +
            futureLabel +
            '<span class="event-desc">' + desc + '</span>' +
            '<span class="event-value">' + value + '</span>' +
            '<div class="event-actions">' +
                editBtn +
                '<button class="icon-btn danger" onclick="FundFlow.deleteEvent(\'' + ev.id + '\')" title="Delete">&#x2715;</button>' +
            '</div>' +
        '</div>';
    },

    // ========== CHART ==========

    initChart() {
        const ctx = document.getElementById('mainChart').getContext('2d');
        this.chart = new Chart(ctx, this.getChartConfig());
    },

    getChartConfig(type) {
        if (!type) type = 'projection';
        if (type === 'projection') {
            const projYears = this.data.settings.projectionYears || 20;
            const projections = this.calculateProjection(projYears);
            const opts = this.getChartOptions(true);

            // Build event markers for the projection chart
            const markers = [];
            const chartTypes = ['deposit', 'rate_change', 'procurement'];
            if (this.data.events) {
                for (const ev of this.data.events) {
                    if (!chartTypes.includes(ev.type)) continue;
                    let detail = '';
                    if (ev.type === 'deposit') {
                        detail = '+ ' + this.formatNumber(ev.amount) + ' SEK';
                    } else if (ev.type === 'rate_change') {
                        detail = 'Rate → ' + (ev.rate * 100).toFixed(1) + '%';
                    } else if (ev.type === 'procurement') {
                        detail = (ev.expenseName || 'Item') + ': ' + this.formatNumber(ev.cost) + ' SEK';
                    }
                    markers.push({ date: ev.date, type: ev.type, detail });
                }
            }

            if (!opts.plugins) opts.plugins = {};
            opts.plugins.eventMarkers = { markers };

            // Monte Carlo confidence bands (additive overlay — no effect on deterministic line)
            const mcBands = this.runMonteCarlo(projYears, 300, 0.15);
            const showReal = this.data.settings.showRealValues;
            const inflRate = this.data.settings.inflationRate || 0.02;
            const fundStartMs = new Date(this.data.settings.fundStartDate).getTime();
            const mcDatasets = [
                {
                    label: '90th Percentile',
                    data: mcBands.map(b => {
                        let discount = 1;
                        if (showReal) {
                            const yrs = (new Date(b.date).getTime() - fundStartMs) / (365.25 * 24 * 60 * 60 * 1000);
                            discount = Math.pow(1 + inflRate, yrs);
                        }
                        return { x: b.date, y: b.p90 / discount };
                    }),
                    borderColor: 'rgba(0, 212, 170, 0.2)',
                    backgroundColor: 'transparent',
                    borderWidth: 1,
                    borderDash: [3, 3],
                    pointRadius: 0,
                    pointHoverRadius: 0,
                    fill: false,
                    tension: 0.4,
                    order: 10
                },
                {
                    label: '10th Percentile',
                    data: mcBands.map(b => {
                        let discount = 1;
                        if (showReal) {
                            const yrs = (new Date(b.date).getTime() - fundStartMs) / (365.25 * 24 * 60 * 60 * 1000);
                            discount = Math.pow(1 + inflRate, yrs);
                        }
                        return { x: b.date, y: b.p10 / discount };
                    }),
                    borderColor: 'rgba(239, 68, 68, 0.25)',
                    backgroundColor: 'rgba(124, 58, 237, 0.04)',
                    borderWidth: 1,
                    borderDash: [3, 3],
                    pointRadius: 0,
                    pointHoverRadius: 0,
                    fill: '-1',  // fill between this and previous (90th) dataset
                    tension: 0.4,
                    order: 10
                }
            ];

            return {
                type: 'line',
                data: {
                    labels: projections.map(p => p.date),
                    datasets: [
                        {
                            label: showReal ? 'PR Balance (real)' : 'PR Balance',
                            data: projections.map(p => p.balance),
                            borderColor: showReal ? '#00b4d8' : '#00d4aa',
                            backgroundColor: showReal ? 'rgba(0, 180, 216, 0.08)' : 'rgba(0, 212, 170, 0.08)',
                            fill: true,
                            tension: 0.4,
                            pointRadius: 2,
                            pointHoverRadius: 5,
                            order: 1
                        },
                        {
                            label: 'Gains',
                            data: projections.map(p => p.gains),
                            borderColor: 'rgba(124, 58, 237, 0.6)',
                            backgroundColor: 'transparent',
                            borderDash: [5, 3],
                            tension: 0.4,
                            pointRadius: 0,
                            order: 2
                        },
                        ...mcDatasets
                    ]
                },
                options: opts
            };
        } else {
            const proj = this.project(this.timelineDate);
            const colors = ['#00d4aa', '#7c3aed', '#f59e0b', '#ef4444', '#3b82f6', '#10b981', '#f97316'];

            return {
                type: 'bar',
                data: {
                    labels: proj.expenses.map(e => e.name),
                    datasets: [{
                        label: 'Annual Cost',
                        data: proj.expenses.map(e => e.annualCost),
                        backgroundColor: colors.slice(0, proj.expenses.length),
                        borderRadius: 4
                    }]
                },
                options: this.getChartOptions(false)
            };
        }
    },

    getChartOptions(isTimeSeries) {
        const opts = {
            responsive: true,
            maintainAspectRatio: false,
            interaction: {
                intersect: false,
                mode: 'index'
            },
            plugins: {
                legend: { display: false },
                tooltip: {
                    backgroundColor: '#1a1a24',
                    titleColor: '#f4f4f5',
                    bodyColor: '#a1a1aa',
                    borderColor: '#27272a',
                    borderWidth: 1,
                    padding: 12,
                    cornerRadius: 8,
                    titleFont: { family: "'DM Sans', sans-serif", size: 12, weight: '600' },
                    bodyFont: { family: "'JetBrains Mono', monospace", size: 11 },
                    displayColors: false,
                    filter: (tooltipItem) => {
                        const label = tooltipItem.dataset.label || '';
                        return label !== '90th Percentile' && label !== '10th Percentile';
                    },
                    callbacks: {
                        label: (ctx) => {
                            const val = typeof ctx.raw === 'object' && ctx.raw !== null ? ctx.raw.y : ctx.raw;
                            return ctx.dataset.label + ': ' + this.formatNumber(val) + ' SEK';
                        },
                        afterBody: (tooltipItems) => {
                            const chart = tooltipItems[0]?.chart;
                            if (!chart) return [];
                            const markers = chart.options.plugins.eventMarkers?.markers;
                            if (!markers || markers.length === 0) return [];

                            const tipTime = tooltipItems[0].parsed.x;
                            if (!tipTime) return [];
                            const threshold = 46 * 24 * 60 * 60 * 1000;

                            const matched = markers.filter(m => {
                                const d = new Date(m.date).getTime();
                                return Math.abs(d - tipTime) < threshold;
                            });
                            if (matched.length === 0) return [];

                            const lines = [''];
                            matched.forEach(m => {
                                const lbl = EventMarkersPlugin._labels[m.type] || m.type;
                                lines.push(lbl + ': ' + m.detail);
                            });
                            return lines;
                        }
                    }
                }
            },
            scales: {
                x: {
                    grid: { color: 'rgba(39, 39, 42, 0.5)', drawBorder: false },
                    ticks: { color: '#71717a', font: { size: 11, family: "'JetBrains Mono', monospace" } }
                },
                y: {
                    grid: { color: 'rgba(39, 39, 42, 0.5)', drawBorder: false },
                    ticks: {
                        color: '#71717a',
                        callback: (v) => this.formatNumber(v),
                        font: { size: 11, family: "'JetBrains Mono', monospace" }
                    }
                }
            }
        };

        // Quick Win 7: Zero line on projection chart (break-even indicator)
        if (isTimeSeries) {
            opts.scales.x.type = 'time';
            opts.scales.x.time = {
                unit: 'year',
                displayFormats: { year: 'yyyy' }
            };

            // Add zero line as a custom plugin annotation via afterDraw
            // We use the y scale to draw at y=0
            opts.plugins.zeroLine = { enabled: true };
        }

        return opts;
    },

    calculateProjection(years) {
        const projections = [];
        const start = new Date(this.data.settings.fundStartDate);
        const showReal = this.data.settings.showRealValues;
        const inflRate = this.data.settings.inflationRate || 0.02;
        // Monthly points for smoother chart
        const totalMonths = years * 12;

        for (let i = 0; i <= totalMonths; i += 3) { // quarterly
            const date = new Date(start.getTime() + (i * 30.44 * 24 * 60 * 60 * 1000));
            const proj = this.project(date);

            // Inflation discount: deflate future values to today's purchasing power
            let discount = 1;
            if (showReal) {
                const yearsFromStart = i / 12;
                discount = Math.pow(1 + inflRate, yearsFromStart);
            }

            projections.push({
                date: date.toISOString().split('T')[0],
                balance: proj.principalReturnBalance / discount,
                principal: proj.principal / discount,
                gains: proj.gains / discount
            });
        }

        return projections;
    },

    updateChart() {
        // Always render the projection in the main chart
        TimelinePlugin._state.xPixel = null;
        TimelinePlugin._state.dateLabel = null;

        const canvas = document.getElementById('mainChart');
        if (this.chart) {
            this.chart.destroy();
        }
        const ctx = canvas.getContext('2d');
        this.chart = new Chart(ctx, this.getChartConfig('projection'));
        this._restoreTimelineBar();

        // Refresh all visible panes
        this._refreshVisiblePanes();
    },

    // Toggle a pane on/off
    togglePane(pane) {
        this.visiblePanes[pane] = !this.visiblePanes[pane];

        // Update toggle button state
        document.querySelectorAll('.pane-toggle').forEach(btn => {
            btn.classList.toggle('active', this.visiblePanes[btn.dataset.pane]);
        });

        // Show/hide pane card
        const paneIds = { breakdown: 'breakdownPane', priority: 'priorityPane', cashflow: 'cashflowPane' };
        const card = document.getElementById(paneIds[pane]);
        if (card) card.style.display = this.visiblePanes[pane] ? '' : 'none';

        // Render or destroy pane content
        if (this.visiblePanes[pane]) {
            if (pane === 'breakdown') this._renderBreakdownPane();
            else if (pane === 'priority') this._renderPriorityPane();
            else if (pane === 'cashflow') this._renderCashFlowPane();
        } else {
            // Destroy breakdown chart when hiding to free resources
            if (pane === 'breakdown' && this.breakdownChart) {
                this.breakdownChart.destroy();
                this.breakdownChart = null;
            }
        }
    },

    // Render breakdown bar chart into its pane
    _renderBreakdownPane() {
        const canvas = document.getElementById('breakdownChart');
        if (!canvas) return;
        if (this.breakdownChart) {
            this.breakdownChart.destroy();
        }
        const ctx = canvas.getContext('2d');
        this.breakdownChart = new Chart(ctx, this.getChartConfig('breakdown'));
    },

    // Render priority queue into its pane
    _renderPriorityPane() {
        const container = document.getElementById('priorityView');
        if (!container) return;
        if (this.priorityMode === 'compact') {
            this._renderPriorityCompact(container);
        } else {
            this._renderPriorityFull(container);
        }
    },

    // Render cash flow ledger into its pane (uses full table version)
    _renderCashFlowPane() {
        const container = document.getElementById('cashflowView');
        if (container) this._renderCashFlowFull(container);
    },

    // Render priority queue — compact single-line rows (rank | name | urgency | mini bar | %)
    _renderPriorityCompact(container) {
        if (!container) return;

        const proj = this.project(this.timelineDate);
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
    },

    // ========== PRIORITY QUEUE ==========
    // Advanced Feature: "Fund This First" — ranks CapEx expenses by urgency.
    // Urgency = how far behind the funding schedule an item is.

    // Render priority queue — full view with progress bars, cost, due date
    _renderPriorityFull(container) {

        const proj = this.project(this.timelineDate);
        const capexItems = proj.expenses.filter(e => e.type === 'capex');

        if (capexItems.length === 0) {
            container.innerHTML = '<div class="empty-state">No CapEx items to prioritize</div>';
            return;
        }

        // Compute urgency: (scheduledDate - projectedDate) in days
        // Negative = underfunded (projected AFTER scheduled), most urgent
        // Positive = surplus time, least urgent
        // Already funded (progress >= 100) = sorted to bottom
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
                    urgencyLabel = 'Tight — ' + Math.round(urgencyDays / 30.44) + ' months buffer';
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

        // Sort: most urgent first (lowest urgencyDays)
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
            html += '<span style="font-weight: 500; font-size: 0.85rem;">' + this.escapeHtml(exp.name) + '</span>';
            html += '<span style="font-size: 0.7rem; color: ' + item.urgencyColor + '; font-weight: 600;">' + item.urgencyLabel + '</span>';
            html += '</div>';
            html += '<div class="progress-bar" style="margin-top: 4px;">';
            html += '<div class="progress-fill ' + progressClass + '" style="width: ' + Math.min(exp.progress, 100) + '%"></div>';
            html += '</div>';
            html += '<div style="display: flex; justify-content: space-between; font-size: 0.65rem; color: var(--text-muted); margin-top: 2px;">';
            html += '<span>' + exp.progress.toFixed(0) + '% \u2014 ' + this.formatNumber(exp.cost) + ' SEK</span>';
            html += '<span>' + (exp.scheduledDate ? 'Due: ' + exp.scheduledDate : '') + '</span>';
            html += '</div>';
            html += '</div>';
            html += '</div>';
        });

        html += '</div>';
        container.innerHTML = html;
    },

    // ========== CASH FLOW LEDGER ==========
    // Advanced Feature: Monthly cash flow schedule showing concrete inflows/outflows.

    // Render cash flow — full table with events column, CapEx row highlighting
    _renderCashFlowFull(container) {

        const settings = this.data.settings;
        const fundStart = new Date(settings.fundStartDate);
        const expenses = this.data.expenses;
        const events = this.data.events;
        const rate = this.getCurrentRate();

        // Generate 24 months of cash flow from current timeline date
        const startDate = new Date(this.timelineDate);
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
            const proj = this.project(mDate);
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
                    // Don't double-count with scheduled above — check if already counted
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

        let runningBalance = 0;
        months.forEach(m => {
            runningBalance += m.net;
            const netColor = m.net >= 0 ? 'var(--accent-primary)' : 'var(--accent-danger)';
            const hasCapex = m.details.some(d => d.type === 'capex' || d.type === 'procurement');
            const rowBg = hasCapex ? 'background: rgba(245, 158, 11, 0.04);' : '';

            html += '<tr style="border-bottom: 1px solid var(--border); ' + rowBg + '">';
            html += '<td style="padding: 5px 6px; font-family: \'JetBrains Mono\', monospace; color: var(--text-muted);">' + m.month + '</td>';
            html += '<td style="padding: 5px 6px; text-align: right; font-family: \'JetBrains Mono\', monospace; color: var(--accent-success);">' + this.formatNumber(m.inflows) + '</td>';
            html += '<td style="padding: 5px 6px; text-align: right; font-family: \'JetBrains Mono\', monospace; color: var(--accent-danger);">' + this.formatNumber(m.outflows) + '</td>';
            html += '<td style="padding: 5px 6px; text-align: right; font-family: \'JetBrains Mono\', monospace; color: ' + netColor + ';">' + (m.net >= 0 ? '+' : '') + this.formatNumber(m.net) + '</td>';

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
    },

    // ========== MODALS ==========

    openExpenseModal(expenseId) {
        expenseId = expenseId || null;
        this.editingExpenseId = expenseId;
        const modal = document.getElementById('expenseModal');
        const title = document.getElementById('expenseModalTitle');

        if (expenseId) {
            const exp = this.data.expenses.find(e => e.id === expenseId);
            if (exp) {
                title.textContent = 'Edit Expense';
                document.querySelector('.type-btn[data-type="' + exp.type + '"]').click();
                document.getElementById('expenseName').value = exp.name;
                document.getElementById('expenseCost').value = exp.cost;
                document.getElementById('expenseInterval').value = exp.interval || '';
                document.getElementById('billingCycle').value = exp.billingCycle || 'monthly';
                document.getElementById('expenseDate').value = exp.lastProcurementDate || this.data.settings.fundStartDate;
            }
        } else {
            title.textContent = 'Add Expense';
            document.querySelector('.type-btn[data-type="capex"]').click();
            document.getElementById('expenseName').value = '';
            document.getElementById('expenseCost').value = '';
            document.getElementById('expenseInterval').value = '';
            document.getElementById('expenseDate').value = new Date().toISOString().split('T')[0];
        }

        modal.classList.add('open');
    },

    closeExpenseModal() {
        document.getElementById('expenseModal').classList.remove('open');
        this.editingExpenseId = null;
    },

    toggleExpenseType(type) {
        document.getElementById('intervalGroup').style.display = type === 'capex' ? 'block' : 'none';
        document.getElementById('billingGroup').style.display = type === 'opex' ? 'block' : 'none';
        // Update date label contextually
        document.getElementById('expenseDateLabel').textContent =
            type === 'capex' ? 'Last Procured' : 'Subscription Start';
    },

    saveExpense() {
        const type = document.querySelector('.type-btn.active').dataset.type;
        const name = document.getElementById('expenseName').value.trim();
        const cost = parseFloat(document.getElementById('expenseCost').value);
        const expenseDate = document.getElementById('expenseDate').value;

        if (!name || isNaN(cost) || cost <= 0) {
            alert('Please enter name and valid cost');
            return;
        }
        if (!expenseDate) {
            alert('Please select a date');
            return;
        }

        let interval, billingCycle;

        if (type === 'opex') {
            billingCycle = document.getElementById('billingCycle').value;
            interval = 1;
        } else {
            interval = parseFloat(document.getElementById('expenseInterval').value) || 1;
            billingCycle = null;
        }

        if (this.editingExpenseId) {
            const exp = this.data.expenses.find(e => e.id === this.editingExpenseId);
            if (exp) {
                this.data.events.push({
                    id: this.generateId(),
                    type: 'expense_update',
                    date: new Date().toISOString().split('T')[0],
                    expenseId: exp.id,
                    name: name,
                    cost: cost,
                    interval: interval,
                    billingCycle: billingCycle,
                    lastProcurementDate: expenseDate,
                    createdAt: new Date().toISOString()
                });
                exp.name = name;
                exp.cost = cost;
                exp.interval = interval;
                exp.billingCycle = billingCycle;
                exp.lastProcurementDate = expenseDate;
            }
        } else {
            const newExpense = {
                id: this.generateId(),
                type: type,
                name: name,
                cost: cost,
                interval: interval,
                billingCycle: billingCycle,
                lastProcurementDate: expenseDate
            };

            this.data.expenses.push(newExpense);

            this.data.events.push({
                id: this.generateId(),
                type: 'expense_create',
                date: new Date().toISOString().split('T')[0],
                expenseId: newExpense.id,
                name: name,
                expenseType: type,
                cost: cost,
                interval: interval,
                billingCycle: billingCycle,
                lastProcurementDate: expenseDate,
                createdAt: new Date().toISOString()
            });
        }

        this.closeExpenseModal();
        this.saveToStorage();
        this.render();
        this.updateChart();
        this.showToast(this.editingExpenseId ? 'Expense updated' : 'Expense added');
    },

    openProcurementModal(expenseId) {
        const exp = this.data.expenses.find(e => e.id === expenseId);
        if (!exp) return;

        this.editingExpenseId = expenseId;
        this.editingEventId = null; // new procurement, not editing existing
        document.getElementById('procurementExpenseName').textContent = exp.name;
        document.getElementById('procurementDate').value = this.timelineDate.toISOString().split('T')[0];
        document.getElementById('procurementCost').value = exp.cost;
        document.getElementById('procurementNote').value = '';

        // Quick Win 10: Show warning if item is underfunded
        const warningEl = document.getElementById('procurementFundingWarning');
        if (warningEl) {
            const proj = this.project(this.timelineDate);
            const projExp = proj.expenses.find(e => e.id === expenseId);
            if (projExp && projExp.progress < 100 && projExp.type === 'capex') {
                warningEl.textContent = 'This item is only ' + projExp.progress.toFixed(0) + '% funded (' +
                    this.formatNumber(projExp.allocatedGains) + ' of ' + this.formatNumber(exp.cost) +
                    ' SEK). Proceeding will deduct the full cost from your gains/principal.';
                warningEl.style.display = '';
            } else {
                warningEl.style.display = 'none';
            }
        }

        document.getElementById('procurementModal').classList.add('open');
    },

    closeProcurementModal() {
        document.getElementById('procurementModal').classList.remove('open');
        this.editingExpenseId = null;
        this.editingEventId = null;
    },

    editProcurementEvent(eventId) {
        const ev = this.data.events.find(e => e.id === eventId);
        if (!ev || ev.type !== 'procurement') return;

        const exp = this.data.expenses.find(e => e.id === ev.expenseId);
        this.editingExpenseId = ev.expenseId;
        this.editingEventId = eventId;

        document.getElementById('procurementExpenseName').textContent = exp ? exp.name : (ev.expenseName || 'Expense');
        document.getElementById('procurementDate').value = ev.date;
        document.getElementById('procurementCost').value = ev.cost;
        document.getElementById('procurementNote').value = ev.note || '';
        document.getElementById('procurementModal').classList.add('open');
    },

    saveProcurement() {
        const date = document.getElementById('procurementDate').value;
        const cost = parseFloat(document.getElementById('procurementCost').value);
        const note = document.getElementById('procurementNote').value.trim();

        if (!date || isNaN(cost) || cost <= 0) {
            alert('Please enter date and cost');
            return;
        }

        if (this.editingEventId) {
            // Editing an existing procurement event
            const ev = this.data.events.find(e => e.id === this.editingEventId);
            if (ev) {
                ev.date = date;
                ev.cost = cost;
                ev.note = note || undefined;
            }
            // Update the expense's lastProcurementDate if this was the most recent procurement
            const exp = this.data.expenses.find(e => e.id === this.editingExpenseId);
            if (exp) {
                const latestProc = this.data.events
                    .filter(e => e.type === 'procurement' && e.expenseId === exp.id)
                    .sort((a, b) => b.date.localeCompare(a.date))[0];
                if (latestProc) {
                    exp.lastProcurementDate = latestProc.date;
                }
            }
        } else {
            // Creating a new procurement event
            const exp = this.data.expenses.find(e => e.id === this.editingExpenseId);
            if (!exp) return;

            const event = {
                id: this.generateId(),
                type: 'procurement',
                date: date,
                expenseId: exp.id,
                expenseName: exp.name,
                cost: cost,
                createdAt: new Date().toISOString()
            };
            if (note) event.note = note;

            this.data.events.push(event);

            exp.lastProcurementDate = date;
            if (cost !== exp.cost) {
                exp.cost = cost;
            }
        }

        this.closeProcurementModal();
        this.saveToStorage();
        this.render();
        this.updateChart();
        this.showToast('Procurement recorded');
    },

    deleteExpense(id) {
        if (!confirm('Delete this expense?')) return;

        const exp = this.data.expenses.find(e => e.id === id);
        if (exp) {
            this.data.events.push({
                id: this.generateId(),
                type: 'expense_delete',
                date: new Date().toISOString().split('T')[0],
                expenseId: id,
                expenseName: exp.name,
                createdAt: new Date().toISOString()
            });

            this.data.expenses = this.data.expenses.filter(e => e.id !== id);
            this.saveToStorage();
            this.render();
            this.updateChart();
            this.showToast('Expense deleted');
        }
    },

    openEventModal(eventId) {
        eventId = eventId || null;
        this.editingEventId = eventId;
        const modal = document.getElementById('eventModal');

        // Clear deposit preview
        const previewEl = document.getElementById('depositPreview');
        if (previewEl) previewEl.style.display = 'none';

        if (eventId) {
            const ev = this.data.events.find(e => e.id === eventId);
            if (ev) {
                document.getElementById('eventModalTitle').textContent = 'Edit Event';
                const typeBtn = document.querySelector('.event-type-btn[data-type="' + ev.type + '"]');
                if (typeBtn) {
                    typeBtn.click();
                } else {
                    // Event type has no matching button (e.g. procurement) — show deposit as default
                    document.querySelector('.event-type-btn[data-type="deposit"]').click();
                }
                document.getElementById('eventDate').value = ev.date;
                if (ev.amount !== undefined) document.getElementById('eventAmount').value = ev.amount;
                if (ev.rate !== undefined) document.getElementById('eventRate').value = ev.rate * 100;
            }
        } else {
            document.getElementById('eventModalTitle').textContent = 'Add Event';
            document.querySelector('.event-type-btn[data-type="deposit"]').click();
            document.getElementById('eventDate').value = new Date().toISOString().split('T')[0];
            document.getElementById('eventAmount').value = '';
            document.getElementById('eventRate').value = '';
        }

        modal.classList.add('open');
    },

    closeEventModal() {
        document.getElementById('eventModal').classList.remove('open');
        this.editingEventId = null;
    },

    toggleEventType(type) {
        const showAmount = type === 'deposit';
        const showRate = type === 'rate_change';
        document.getElementById('eventAmountGroup').style.display = showAmount ? 'block' : 'none';
        document.getElementById('eventRateGroup').style.display = showRate ? 'block' : 'none';

        // Show/hide deposit preview
        const previewEl = document.getElementById('depositPreview');
        if (previewEl) {
            previewEl.style.display = showAmount ? '' : 'none';
            if (showAmount) this._updateDepositPreview();
        }
    },

    /**
     * Live deposit impact preview — shows what adding X SEK will do.
     *
     * Computes the difference between current state and state-with-deposit,
     * showing: monthly gain increase, newly funded items, and new PR balance.
     *
     * Called on every keystroke in the deposit amount field.
     */
    _updateDepositPreview() {
        const previewEl = document.getElementById('depositPreview');
        if (!previewEl) return;

        const activeType = document.querySelector('.event-type-btn.active');
        if (!activeType || activeType.dataset.type !== 'deposit') {
            previewEl.style.display = 'none';
            return;
        }

        const amount = parseFloat(document.getElementById('eventAmount').value);
        if (isNaN(amount) || amount <= 0) {
            previewEl.innerHTML = '<span style="color: var(--text-muted); font-size: 0.72rem;">Enter an amount to see impact preview</span>';
            previewEl.style.display = '';
            return;
        }

        // Project current state
        const currentProj = this.project(this.timelineDate);

        // Project with the deposit added (temporarily add a synthetic deposit event)
        const date = document.getElementById('eventDate').value || new Date().toISOString().split('T')[0];
        const tempEvent = {
            id: '__preview__',
            type: 'deposit',
            date: date,
            amount: amount,
            createdAt: new Date().toISOString()
        };
        this.data.events.push(tempEvent);
        const newProj = this.project(this.timelineDate);
        // Remove the temporary event
        this.data.events = this.data.events.filter(e => e.id !== '__preview__');

        // Compute diffs
        const monthlyGainDiff = (newProj.annualGainAmount - currentProj.annualGainAmount) / 12;
        const balanceDiff = newProj.principalReturnBalance - currentProj.principalReturnBalance;

        // Check which items become newly funded
        const newlyFunded = [];
        newProj.expenses.forEach((newExp, i) => {
            if (i < currentProj.expenses.length) {
                const oldExp = currentProj.expenses[i];
                if (newExp.isFunded && !oldExp.isFunded) {
                    newlyFunded.push(newExp.name);
                }
            }
        });

        let html = '<div style="font-size: 0.72rem; color: var(--text-secondary); line-height: 1.6;">';
        html += '<div style="font-weight: 600; color: var(--accent-primary); margin-bottom: 4px;">Impact Preview</div>';
        html += '<div>Monthly gains: <strong>+' + this.formatNumber(monthlyGainDiff) + ' SEK/mo</strong></div>';
        html += '<div>PR Balance: <strong>' + (balanceDiff >= 0 ? '+' : '') + this.formatNumber(balanceDiff) + ' SEK</strong></div>';
        if (newlyFunded.length > 0) {
            html += '<div style="color: var(--accent-success);">Fully funds: <strong>' + newlyFunded.join(', ') + '</strong></div>';
        }
        if (newProj.isDrainingPrincipal && !currentProj.isDrainingPrincipal) {
            // Shouldn't happen with a deposit, but safety check
        } else if (currentProj.isDrainingPrincipal && !newProj.isDrainingPrincipal) {
            html += '<div style="color: var(--accent-success);">Stops principal drain!</div>';
        }
        html += '</div>';

        previewEl.innerHTML = html;
        previewEl.style.display = '';
    },

    saveEvent() {
        const type = document.querySelector('.event-type-btn.active').dataset.type;
        const date = document.getElementById('eventDate').value;

        if (!date) {
            alert('Please select a date');
            return;
        }

        if (type === 'deposit') {
            const amount = parseFloat(document.getElementById('eventAmount').value);
            if (isNaN(amount) || amount <= 0) {
                alert('Please enter amount');
                return;
            }

            if (this.editingEventId) {
                const ev = this.data.events.find(e => e.id === this.editingEventId);
                if (ev) {
                    ev.date = date;
                    ev.amount = amount;
                }
            } else {
                this.data.events.push({
                    id: this.generateId(),
                    type: type,
                    date: date,
                    amount: amount,
                    createdAt: new Date().toISOString()
                });
            }
        } else if (type === 'rate_change') {
            const rate = parseFloat(document.getElementById('eventRate').value) / 100;
            if (isNaN(rate) || rate <= 0) {
                alert('Please enter rate');
                return;
            }

            if (this.editingEventId) {
                const ev = this.data.events.find(e => e.id === this.editingEventId);
                if (ev) {
                    ev.date = date;
                    ev.rate = rate;
                }
            } else {
                this.data.events.push({
                    id: this.generateId(),
                    type: type,
                    date: date,
                    rate: rate,
                    createdAt: new Date().toISOString()
                });
            }

            document.getElementById('returnRate').value = rate * 100;
            document.getElementById('returnRateValue').textContent = (rate * 100).toFixed(1) + '%';
        }

        this.closeEventModal();
        this.saveToStorage();
        this.render();
        this.updateChart();
        this.showToast(this.editingEventId ? 'Event updated' : 'Event added');
    },

    editEvent(id) {
        this.openEventModal(id);
    },

    deleteEvent(id) {
        if (!confirm('Delete this event?')) return;
        this.data.events = this.data.events.filter(e => e.id !== id);
        this.saveToStorage();
        this.render();
        this.updateChart();
        this.showToast('Event deleted');
    },

    // ========== DATA ==========

    copyStateToClipboard() {
        const json = JSON.stringify(this.data, null, 2);
        navigator.clipboard.writeText(json).then(() => {
            const btn = document.getElementById('copyStateBtn');
            const orig = btn.textContent;
            btn.textContent = '\u2713';
            setTimeout(() => { btn.textContent = orig; }, 1200);
        }).catch(() => {
            // Fallback: select from a temporary textarea
            const ta = document.createElement('textarea');
            ta.value = json;
            ta.style.position = 'fixed';
            ta.style.opacity = '0';
            document.body.appendChild(ta);
            ta.select();
            document.execCommand('copy');
            document.body.removeChild(ta);
        });
    },

    exportData() {
        const blob = new Blob([JSON.stringify(this.data, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'fundflow-data.json';
        a.click();
        URL.revokeObjectURL(url);
    },

    importData(event) {
        const file = event.target.files[0];
        if (!file) return;

        const reader = new FileReader();
        reader.onload = (e) => {
            try {
                this.data = JSON.parse(e.target.result);
                this.saveToStorage();
                this.render();
                this.updateChart();
                this.showToast('Data imported successfully');
            } catch (err) {
                this.showToast('Import failed: ' + err.message, 'error');
            }
        };
        reader.readAsText(file);
        event.target.value = '';
    },

    resetData() {
        if (!confirm('Reset all data?')) return;

        this.data = {
            settings: {
                initialPrincipal: 135000,
                accountType: 'isk',
                fundStartDate: new Date().toISOString().split('T')[0],
                redistributeFullyFunded: true
            },
            expenses: [],
            events: []
        };
        this.timelineDate = new Date();
        this.saveToStorage();
        this.render();
        this.showToast('All data has been reset', 'success');
        this.updateChart();
    },

    // ========== EXAMPLE DATA ==========

    loadExampleData() {
        if (this.data.expenses.length > 0 || this.data.events.length > 1) {
            if (!confirm('This will replace your current data with example data. Continue?')) return;
        }

        const today = new Date();
        const todayStr = today.toISOString().split('T')[0];
        const oneYearAgo = new Date(today.getFullYear() - 1, today.getMonth(), today.getDate()).toISOString().split('T')[0];
        const twoYearsAgo = new Date(today.getFullYear() - 2, today.getMonth(), today.getDate()).toISOString().split('T')[0];
        const sixMonthsAgo = new Date(today.getFullYear(), today.getMonth() - 6, today.getDate()).toISOString().split('T')[0];
        const threeMonthsFuture = new Date(today.getFullYear(), today.getMonth() + 3, today.getDate()).toISOString().split('T')[0];
        const oneYearFuture = new Date(today.getFullYear() + 1, today.getMonth(), today.getDate()).toISOString().split('T')[0];

        // Pre-generate IDs for expenses referenced by procurement events
        const macbookId = this.generateId();
        const iphoneId = this.generateId();

        this.data = {
            settings: {
                initialPrincipal: 250000,
                accountType: 'isk',
                fundStartDate: twoYearsAgo,
                redistributeFullyFunded: true,
                showRealValues: false,
                inflationRate: 0.02,
                projectionYears: 20,
                listDebounceMs: 300
            },
            expenses: [
                {
                    id: macbookId,
                    name: 'MacBook Pro',
                    type: 'capex',
                    cost: 35000,
                    interval: 4,
                    lastProcurementDate: oneYearAgo,
                    createdAt: twoYearsAgo
                },
                {
                    id: iphoneId,
                    name: 'iPhone',
                    type: 'capex',
                    cost: 18000,
                    interval: 3,
                    lastProcurementDate: sixMonthsAgo,
                    createdAt: twoYearsAgo
                },
                {
                    id: this.generateId(),
                    name: 'Headphones (AirPods Max)',
                    type: 'capex',
                    cost: 6500,
                    interval: 5,
                    lastProcurementDate: twoYearsAgo,
                    createdAt: twoYearsAgo
                },
                {
                    id: this.generateId(),
                    name: 'Monitor (4K)',
                    type: 'capex',
                    cost: 12000,
                    interval: 6,
                    lastProcurementDate: oneYearAgo,
                    createdAt: oneYearAgo
                },
                {
                    id: this.generateId(),
                    name: 'GitHub Copilot',
                    type: 'opex',
                    cost: 1200,
                    billingCycle: 'yearly',
                    createdAt: twoYearsAgo
                },
                {
                    id: this.generateId(),
                    name: 'Cloud Hosting (VPS)',
                    type: 'opex',
                    cost: 250,
                    billingCycle: 'monthly',
                    createdAt: twoYearsAgo
                },
                {
                    id: this.generateId(),
                    name: 'Domain Renewals',
                    type: 'opex',
                    cost: 800,
                    billingCycle: 'yearly',
                    createdAt: twoYearsAgo
                }
            ],
            events: [
                {
                    id: this.generateId(),
                    type: 'deposit',
                    date: twoYearsAgo,
                    amount: 250000,
                    isInitial: true,
                    createdAt: twoYearsAgo
                },
                {
                    id: this.generateId(),
                    type: 'deposit',
                    date: oneYearAgo,
                    amount: 50000,
                    createdAt: oneYearAgo
                },
                {
                    id: this.generateId(),
                    type: 'deposit',
                    date: threeMonthsFuture,
                    amount: 30000,
                    createdAt: todayStr
                },
                {
                    id: this.generateId(),
                    type: 'rate_change',
                    date: twoYearsAgo,
                    rate: 0.07,
                    createdAt: twoYearsAgo
                },
                {
                    id: this.generateId(),
                    type: 'rate_change',
                    date: sixMonthsAgo,
                    rate: 0.065,
                    createdAt: sixMonthsAgo
                },
                {
                    id: this.generateId(),
                    type: 'procurement',
                    date: oneYearAgo,
                    expenseId: macbookId,
                    expenseName: 'MacBook Pro',
                    cost: 33000,
                    createdAt: oneYearAgo
                },
                {
                    id: this.generateId(),
                    type: 'procurement',
                    date: sixMonthsAgo,
                    expenseId: iphoneId,
                    expenseName: 'iPhone',
                    cost: 17500,
                    createdAt: sixMonthsAgo
                }
            ]
        };

        this.timelineDate = new Date();
        this.saveToStorage();
        this.loadFromStorage(); // Re-run migration/defaults
        this.render();
        this.updateChart();
        this.showToast('Example data loaded — explore the app!', 'success');
    },

    // ========== CONTEXTUAL HELP ==========

    toggleHelp() {
        document.body.classList.toggle('help-visible');
        const isVisible = document.body.classList.contains('help-visible');
        this.showToast(isVisible ? 'Help cards visible — click Toggle Help again to hide' : 'Help cards hidden', 'success');
    },

    // ========== UTILS ==========

    formatNumber(num) {
        return new Intl.NumberFormat('sv-SE').format(Math.round(num));
    },

    escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }
};

document.addEventListener('DOMContentLoaded', () => FundFlow.init());
