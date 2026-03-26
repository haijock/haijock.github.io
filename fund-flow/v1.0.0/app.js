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
        state.chartRef = chart;

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
    currentView: 'projection',
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
    },

    saveToStorage() {
        localStorage.setItem('fundflow_data', JSON.stringify(this.data));
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
        document.getElementById('copyStateBtn').addEventListener('click', () => this.copyStateToClipboard());
        document.getElementById('exportBtn').addEventListener('click', () => this.exportData());
        document.getElementById('importBtn').addEventListener('click', () => document.getElementById('fileInput').click());
        document.getElementById('fileInput').addEventListener('change', (e) => this.importData(e));
        document.getElementById('resetBtn').addEventListener('click', () => this.resetData());

        // Chart tabs
        document.querySelectorAll('.chart-tab').forEach(tab => {
            tab.addEventListener('click', (e) => this.switchView(e.target.dataset.view));
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
        // Throttle rendering during drag to avoid jank
        if (this._renderTimer) return;
        this._renderTimer = requestAnimationFrame(() => {
            this._renderTimer = null;
            this.renderProjection();
        });
    },

    resetToToday() {
        this.timelineDate = new Date();
        TimelinePlugin._state.xPixel = null;
        TimelinePlugin._state.dateLabel = null;
        if (this.chart) this.chart.draw();
        this.renderProjection();
    },

    // ========== PROJECTOR ==========

    project(atDate) {
        const settings = this.data.settings;
        const events = this.data.events;
        const expenses = this.data.expenses;

        const fundStart = new Date(settings.fundStartDate);
        const date = new Date(atDate);
        const dateStr = date.toISOString().split('T')[0];

        if (date < fundStart) {
            return {
                principal: 0, rate: 0.07, gains: 0, deductions: 0,
                principalReturnBalance: 0, expenses: [],
                totalAnnualCost: 0, isDrainingPrincipal: false
            };
        }

        const sortedEvents = [...events].sort((a, b) => new Date(a.date) - new Date(b.date));

        // Principal at date — all deposits are additive
        let principal = 0;
        sortedEvents.forEach(ev => {
            if (ev.date <= dateStr) {
                if (ev.type === 'deposit') principal += ev.amount;
            }
        });
        // If no deposit events exist yet, use settings as fallback
        if (principal === 0 && settings.initialPrincipal > 0) {
            principal = settings.initialPrincipal;
        }

        // Rate at date
        let rate = 0.07;
        sortedEvents.forEach(ev => {
            if (ev.type === 'rate_change' && ev.date <= dateStr) {
                rate = ev.rate;
            }
        });

        // Piecewise compound gains — gains compound on the available balance.
        // Deposits increase the base, procurements and OpEx payments decrease it.
        // When deductions exceed gains, they eat into principal (reducing the compound base).
        let gains = 0;

        // Build a unified timeline of all cash-flow boundary events
        const cashFlowEvents = [];

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

        // Synthesize monthly OpEx payment events from fund start to projection date
        const activeOpex = expenses.filter(e => e.type === 'opex');
        if (activeOpex.length > 0) {
            const totalMonthly = activeOpex.reduce((sum, exp) => {
                return sum + (exp.billingCycle === 'monthly' ? exp.cost : exp.cost / 12);
            }, 0);
            if (totalMonthly > 0) {
                let y = fundStart.getFullYear();
                let m = fundStart.getMonth() + 1; // first payment one month after start
                while (true) {
                    if (m > 11) { m -= 12; y++; }
                    const payDate = new Date(y, m, 1);
                    if (payDate > date) break;
                    cashFlowEvents.push({
                        date: payDate.toISOString().split('T')[0],
                        kind: 'outflow',
                        amount: totalMonthly
                    });
                    m++;
                }
            }
        }

        cashFlowEvents.sort((a, b) => a.date.localeCompare(b.date));

        let currentRate = 0.07;
        // Start compound base from the principal (handles fallback when no deposit events exist)
        const hasDepositEvents = cashFlowEvents.some(ev => ev.kind === 'deposit');
        let compoundBase = hasDepositEvents ? 0 : principal;
        let currentStart = fundStart;

        for (const ev of cashFlowEvents) {
            const evDate = new Date(ev.date);
            if (evDate > fundStart && evDate <= date) {
                const days = (evDate - currentStart) / (1000 * 60 * 60 * 24);
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
                // compoundBase can go negative (eating into principal)
            }
        }

        const finalDays = (date - currentStart) / (1000 * 60 * 60 * 24);
        if (finalDays > 0 && compoundBase > 0) {
            const periodGrowth = compoundBase * (Math.pow(1 + currentRate, finalDays / 365) - 1);
            gains += periodGrowth;
        }

        // Deductions (total outflows, for PR balance display)
        let deductions = 0;
        cashFlowEvents.forEach(ev => {
            if (ev.kind === 'outflow') deductions += ev.amount;
        });

        const principalReturnBalance = gains - deductions;

        // Project expenses — compute annual costs and base data
        const expenseData = expenses.map(exp => {
            let annualCost;
            if (exp.type === 'capex') {
                annualCost = exp.cost / exp.interval;
            } else {
                annualCost = exp.billingCycle === 'yearly' ? exp.cost : exp.cost * 12;
            }

            const lastProcEvents = sortedEvents
                .filter(ev => ev.type === 'procurement' && ev.expenseId === exp.id)
                .sort((a, b) => new Date(b.date) - new Date(a.date));

            let lastProcDate = exp.lastProcurementDate ? new Date(exp.lastProcurementDate) : fundStart;
            if (lastProcEvents.length > 0) {
                lastProcDate = new Date(lastProcEvents[0].date);
            }

            // Gains can only accumulate from when the fund started earning,
            // so clamp the effective start for gain calculations
            const gainStartDate = lastProcDate < fundStart ? fundStart : lastProcDate;

            let scheduledDate = null;
            if (exp.type === 'capex') {
                const nextDate = new Date(lastProcDate.getTime() + (exp.interval * 365.25 * 24 * 60 * 60 * 1000));
                scheduledDate = nextDate.toISOString().split('T')[0];
            }

            return { exp, annualCost, lastProcDate, gainStartDate, scheduledDate, allocatedAnnualGains: 0 };
        });

        // Annual gain amount from the principal at the current rate
        const annualGainAmount = principal * rate;

        // === Allocation strategy ===
        // 1. OpEx (subscriptions) are mandatory — they get first claim on gains
        // 2. Remaining gains go to CapEx items proportionally
        // 3. Optionally, fully-funded CapEx surplus is redistributed to unfunded ones

        const totalOpExAnnual = expenseData
            .filter(d => d.exp.type === 'opex')
            .reduce((sum, d) => sum + d.annualCost, 0);

        // OpEx coverage ratio: what fraction of subscription costs can gains cover?
        const opexCoverageRatio = totalOpExAnnual > 0
            ? Math.min(1, annualGainAmount / totalOpExAnnual)
            : 1;

        // Allocate to OpEx — each gets its fair share (all equally covered/underfunded)
        const gainsAfterOpex = Math.max(0, annualGainAmount - totalOpExAnnual);

        expenseData.forEach(d => {
            if (d.exp.type === 'opex') {
                d.allocatedAnnualGains = d.annualCost * opexCoverageRatio;
            }
        });

        // Allocate remaining gains to CapEx proportionally by annual cost
        const capexItems = expenseData.filter(d => d.exp.type === 'capex');
        const totalCapExAnnual = capexItems.reduce((sum, d) => sum + d.annualCost, 0);

        capexItems.forEach(d => {
            const share = totalCapExAnnual > 0 ? d.annualCost / totalCapExAnnual : 0;
            d.allocatedAnnualGains = share * gainsAfterOpex;
        });

        // Optionally redistribute fully-funded CapEx surplus to unfunded CapExs.
        // "Fully funded" is time-dependent: an item is fully funded when
        // allocatedAnnualGains * yearsSinceLastProc >= cost.
        // When that happens, the item only needs (cost / yearsSinceLastProc) per year,
        // and the excess annual allocation flows to unfunded items.
        if (settings.redistributeFullyFunded) {
            // Precompute yearsSinceProc for each capex item (clamped to fund start)
            capexItems.forEach(d => {
                const daysSinceProc = Math.max(0, (date - d.gainStartDate) / (1000 * 60 * 60 * 24));
                d._yearsSinceProc = daysSinceProc / 365.25;
            });

            // Iteratively redistribute: items that become fully funded after
            // receiving surplus may themselves have excess to give back
            const maxIterations = capexItems.length + 1;
            for (let iter = 0; iter < maxIterations; iter++) {
                let surplus = 0;
                const funded = [];
                const unfunded = [];

                capexItems.forEach(d => {
                    if (d._yearsSinceProc > 0) {
                        const accumulated = d.allocatedAnnualGains * d._yearsSinceProc;
                        if (accumulated >= d.exp.cost) {
                            // This item is fully funded — it only needs enough to reach 100%
                            const needed = d.exp.cost / d._yearsSinceProc;
                            surplus += d.allocatedAnnualGains - needed;
                            d.allocatedAnnualGains = needed;
                            funded.push(d);
                        } else {
                            unfunded.push(d);
                        }
                    } else {
                        // No time elapsed — can't be funded, keep allocation as-is
                        unfunded.push(d);
                    }
                });

                if (surplus <= 0 || unfunded.length === 0) break;

                // Distribute surplus proportionally by annual cost among unfunded items
                const unfundedTotal = unfunded.reduce((sum, d) => sum + d.annualCost, 0);
                unfunded.forEach(d => {
                    const proportion = unfundedTotal > 0
                        ? d.annualCost / unfundedTotal
                        : 1 / unfunded.length;
                    d.allocatedAnnualGains += surplus * proportion;
                });
            }

            // Clean up temp property
            capexItems.forEach(d => { delete d._yearsSinceProc; });
        }

        // Build projected expense objects
        const projectedExpenses = expenseData.map(d => {
            const { exp, annualCost, lastProcDate, gainStartDate, scheduledDate, allocatedAnnualGains } = d;

            // Progress: for CapEx, how much of the next cost has been accumulated
            // since last procurement via allocated gains (clamped to fund start)
            let allocatedGains = 0;
            let progress = 0;

            if (exp.type === 'capex') {
                const daysSinceProc = Math.max(0, (date - gainStartDate) / (1000 * 60 * 60 * 24));
                const yearsSinceProc = daysSinceProc / 365.25;
                allocatedGains = allocatedAnnualGains * yearsSinceProc;
                progress = exp.cost > 0 ? (allocatedGains / exp.cost) * 100 : 0;
            } else {
                // OpEx: allocated vs needed annually
                allocatedGains = allocatedAnnualGains;
                progress = annualCost > 0 ? (allocatedAnnualGains / annualCost) * 100 : 0;
            }

            // Projected date: when will accumulated gains reach the cost?
            let projectedDate = null;
            if (exp.type === 'capex' && allocatedAnnualGains > 0) {
                const yearsToFund = exp.cost / allocatedAnnualGains;
                const projDate = new Date(gainStartDate.getTime() + (yearsToFund * 365.25 * 24 * 60 * 60 * 1000));
                projectedDate = projDate.toISOString().split('T')[0];
            }

            // isFunded: CapEx — progress >= 100%; OpEx — annual gains cover annual cost
            const isFunded = exp.type === 'capex'
                ? progress >= 100
                : allocatedAnnualGains >= annualCost;

            return {
                ...exp,
                annualCost,
                allocatedGains,
                allocatedAnnualGains,
                progress: Math.max(0, progress),
                scheduledDate,
                projectedDate,
                lastProcurementDate: lastProcDate.toISOString().split('T')[0],
                isFunded
            };
        });

        const totalAnnualCost = projectedExpenses.reduce((sum, e) => sum + e.annualCost, 0);

        return {
            principal,
            rate,
            gains,
            deductions,
            principalReturnBalance,
            expenses: projectedExpenses,
            totalAnnualCost,
            isDrainingPrincipal: principalReturnBalance < 0
        };
    },

    // ========== RENDER ==========

    renderProjection() {
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

        // Header stats
        document.getElementById('principalDisplay').textContent = this.formatNumber(proj.principal) + ' SEK';
        document.getElementById('gainsDisplay').textContent = this.formatNumber(proj.gains) + ' SEK';

        // Required principal: the minimum principal that fully funds all expenses at current rate
        const requiredPrincipal = proj.rate > 0 ? proj.totalAnnualCost / proj.rate : 0;
        const reqEl = document.getElementById('requiredPrincipalDisplay');
        reqEl.textContent = this.formatNumber(requiredPrincipal) + ' SEK';
        if (proj.principal >= requiredPrincipal && requiredPrincipal > 0) {
            reqEl.style.color = 'var(--accent-primary)';
        } else {
            reqEl.style.color = 'var(--text-secondary)';
        }

        // Draining warning
        document.getElementById('drainingWarning').style.display = proj.isDrainingPrincipal ? 'inline-flex' : 'none';

        // Timeline date display
        document.getElementById('timelineDateDisplay').textContent = this.timelineDate.toISOString().split('T')[0];

        // Unified list
        this.renderUnifiedList(proj);
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
                expense: exp
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
                event: ev
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

        container.innerHTML = filtered.map(item => {
            if (item.kind === 'expense') {
                return this.renderExpenseRow(item.expense);
            } else {
                return this.renderEventRow(item.event);
            }
        }).join('');
    },

    updateFilterCounts(items) {
        const counts = {
            all: items.length,
            expenses: items.filter(i => i.kind === 'expense').length,
            capex: items.filter(i => i.kind === 'expense' && i.subtype === 'capex').length,
            opex: items.filter(i => i.kind === 'expense' && i.subtype === 'opex').length,
            deposits: items.filter(i => i.kind === 'event' && i.subtype === 'deposit').length,
            rates: items.filter(i => i.kind === 'event' && i.subtype === 'rate_change').length,
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

        return '<div class="expense-row">' +
            '<div class="expense-info">' +
                '<div class="expense-name-row">' +
                    '<span class="expense-name">' + this.escapeHtml(exp.name) + '</span>' +
                    '<span class="expense-type capex">CapEx</span>' +
                '</div>' +
                '<div class="expense-meta">' +
                    '<span>Every ' + exp.interval + ' years</span>' +
                    '<span>Last: ' + exp.lastProcurementDate + '</span>' +
                '</div>' +
                '<div class="progress-section">' +
                    '<div class="progress-bar">' +
                        '<div class="progress-fill ' + progressClass + '" style="width: ' + Math.min(exp.progress, 100) + '%"></div>' +
                    '</div>' +
                    '<div class="progress-info">' +
                        '<span class="progress-percent">' + exp.progress.toFixed(0) + '% funded</span>' +
                        '<span class="progress-dates">' +
                            (exp.scheduledDate ? 'Sched: ' + exp.scheduledDate : '') +
                            (exp.projectedDate ? ' &rarr; Proj: ' + exp.projectedDate : '') +
                        '</span>' +
                    '</div>' +
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

        return '<div class="expense-row">' +
            '<div class="expense-info">' +
                '<div class="expense-name-row">' +
                    '<span class="expense-name">' + this.escapeHtml(exp.name) + '</span>' +
                    '<span class="expense-type opex">Sub</span>' +
                '</div>' +
                '<div class="opex-info">' +
                    'Yearly: ' + this.formatNumber(exp.annualCost) + ' SEK | Allocated: ' + this.formatNumber(exp.allocatedGains) + ' SEK/yr | Since: ' + exp.lastProcurementDate +
                '</div>' +
                '<div class="progress-section">' +
                    '<div class="progress-bar">' +
                        '<div class="progress-fill ' + progressClass + '" style="width: ' + Math.min(exp.progress, 100) + '%"></div>' +
                    '</div>' +
                    '<div class="progress-info">' +
                        '<span class="progress-percent">' + exp.progress.toFixed(0) + '% covered</span>' +
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

        return '<div class="event-row">' +
            '<span class="event-date">' + ev.date + '</span>' +
            '<span class="event-icon">' + (icons[ev.type] || '&bull;') + '</span>' +
            (badges[ev.type] || '') +
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

    getChartConfig() {
        if (this.currentView === 'projection') {
            const projections = this.calculateProjection(20);
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

            return {
                type: 'line',
                data: {
                    labels: projections.map(p => p.date),
                    datasets: [
                        {
                            label: 'PR Balance',
                            data: projections.map(p => p.balance),
                            borderColor: '#00d4aa',
                            backgroundColor: 'rgba(0, 212, 170, 0.08)',
                            fill: true,
                            tension: 0.4,
                            pointRadius: 2,
                            pointHoverRadius: 5
                        },
                        {
                            label: 'Gains',
                            data: projections.map(p => p.gains),
                            borderColor: 'rgba(124, 58, 237, 0.6)',
                            backgroundColor: 'transparent',
                            borderDash: [5, 3],
                            tension: 0.4,
                            pointRadius: 0
                        }
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
                    callbacks: {
                        label: (ctx) => ctx.dataset.label + ': ' + this.formatNumber(ctx.raw) + ' SEK',
                        afterBody: (tooltipItems) => {
                            const chart = tooltipItems[0]?.chart;
                            if (!chart) return [];
                            const markers = chart.options.plugins.eventMarkers?.markers;
                            if (!markers || markers.length === 0) return [];

                            // Use the raw parsed x value (timestamp) from the time scale
                            const tipTime = tooltipItems[0].parsed.x;
                            if (!tipTime) return [];
                            const threshold = 46 * 24 * 60 * 60 * 1000; // half a quarter

                            const matched = markers.filter(m => {
                                const d = new Date(m.date).getTime();
                                return Math.abs(d - tipTime) < threshold;
                            });
                            if (matched.length === 0) return [];

                            const lines = [''];  // blank line separator
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
                    grid: { color: '#27272a' },
                    ticks: { color: '#71717a', font: { size: 11 } }
                },
                y: {
                    grid: { color: '#27272a' },
                    ticks: {
                        color: '#71717a',
                        callback: (v) => this.formatNumber(v),
                        font: { size: 11 }
                    }
                }
            }
        };

        if (isTimeSeries) {
            opts.scales.x.type = 'time';
            opts.scales.x.time = {
                unit: 'year',
                displayFormats: { year: 'yyyy' }
            };
        }

        return opts;
    },

    calculateProjection(years) {
        const projections = [];
        const start = new Date(this.data.settings.fundStartDate);
        // Monthly points for smoother chart
        const totalMonths = years * 12;

        for (let i = 0; i <= totalMonths; i += 3) { // quarterly
            const date = new Date(start.getTime() + (i * 30.44 * 24 * 60 * 60 * 1000));
            const proj = this.project(date);
            projections.push({
                date: date.toISOString().split('T')[0],
                balance: proj.principalReturnBalance,
                principal: proj.principal,
                gains: proj.gains
            });
        }

        return projections;
    },

    updateChart() {
        // Clear timeline indicator position — pixel offset won't match new scale
        TimelinePlugin._state.xPixel = null;
        TimelinePlugin._state.dateLabel = null;

        if (this.chart) {
            this.chart.destroy();
        }
        const ctx = document.getElementById('mainChart').getContext('2d');
        this.chart = new Chart(ctx, this.getChartConfig());
    },

    switchView(view) {
        this.currentView = view;
        document.querySelectorAll('.chart-tab').forEach(tab => {
            tab.classList.toggle('active', tab.dataset.view === view);
        });
        this.updateChart();
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
        }
    },

    openEventModal(eventId) {
        eventId = eventId || null;
        this.editingEventId = eventId;
        const modal = document.getElementById('eventModal');

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
                alert('Data imported!');
            } catch (err) {
                alert('Import failed: ' + err.message);
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
        this.updateChart();
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
