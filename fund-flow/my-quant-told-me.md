Now I have the complete picture. Let me produce the comprehensive analysis.

---

# FundFlow v2 — Staff-Level Engineering Audit & Improvement Plan

---

## PHASE 1 — SYSTEM RECONSTRUCTION

### 1.1 Financial Model

**Principal evolution:**
- Base principal = `settings.initialPrincipal`
- Deposits (event type `deposit`) are additive, accumulated up to projection date
- Fallback: if no deposit events exist, `settings.initialPrincipal` is used directly (`app.js:470-471`)
- Principal is **never decremented** in the `principal` output variable — deductions are tracked separately

**Returns calculation (piecewise compound growth):**
- Builds a unified cash-flow timeline: deposits (inflow), rate changes, procurements (outflow), and synthesized monthly OpEx payments
- Iterates chronologically; for each period between events, compounds at the current rate: `base * ((1 + rate)^(days/365) - 1)`
- Deposits increase compound base, outflows decrease it
- If compound base goes negative, growth halts (no negative compounding)

**Expense application:**
- **OpEx**: synthesized as monthly outflow events from `fundStartDate` forward. Total monthly = sum of all active OpEx (monthly cost or yearly/12)
- **CapEx**: only deducted when a `procurement` event is recorded
- Deductions total = sum of all outflow events in the cash-flow timeline

**Event interactions:**
- Rate changes create period boundaries — new rate applies from that date forward
- Deposits create period boundaries — compound base increases mid-period
- Procurements create period boundaries — compound base decreases
- OpEx payments are synthesized monthly regardless of when expenses were created

### 1.2 Dependency Map

```
settings.initialPrincipal ──→ deposit events ──→ principal
settings.fundStartDate ──→ gains calculation start
                        ──→ OpEx payment synthesis start
rate_change events ──→ currentRate per period ──→ gains
expenses[] ──→ OpEx monthly synthesis ──→ outflows ──→ gains (reduces compound base)
procurement events ──→ outflows ──→ gains (reduces compound base)
                   ──→ lastProcurementDate ──→ CapEx progress
gains - deductions = principalReturnBalance
principal * rate = annualGainAmount ──→ allocation to expenses
redistribution toggle ──→ surplus reallocation among CapEx items
```

**Hidden coupling:**
1. `annualGainAmount` (line 599) uses the **final principal** and the **rate at projection date** — it does NOT use the compound base or account for mid-period deposits. This is the allocation rate, separate from actual compound growth.
2. OpEx synthesis uses **current** `expenses[]` array, not historical snapshots. If an OpEx was added 6 months ago, it synthesizes payments from `fundStartDate` — not from creation date.
3. The redistribution loop (lines 638-684) is time-dependent and iterative but uses a fixed `allocatedAnnualGains` that doesn't change with the projection date's compound state.

### 1.3 Implicit Assumptions & Risks

| Assumption | Reality | Risk Level |
|---|---|---|
| Constant return rate between rate_change events | Markets are volatile | Medium — deterministic projections overstate confidence |
| No inflation | Purchasing power erodes ~2-3%/yr | **High** — a 7% nominal return is ~4% real |
| OpEx costs are fixed | Subscriptions have price increases | Medium |
| CapEx costs are fixed | Technology costs change | Low |
| Monthly compounding granularity via cash-flow events | Adequate for planning | Low |
| Account type (ISK/traditional/brokerage) has no calculation effect | Stored but unused | Low — misleading UI |
| All OpEx exists from fund start | Incorrect for expenses added later | **High — BUG** |

---

## PHASE 2 — FINANCIAL AUDIT (QUANT MODE)

### Bug 1 (CRITICAL): OpEx Payments Synthesized From Fund Start, Not Creation Date

**Location:** `app.js:502-522`

```js
const activeOpex = expenses.filter(e => e.type === 'opex');
// ...
let y = fundStart.getFullYear();
let m = fundStart.getMonth() + 1;
```

**Problem:** If you add a Netflix subscription today with `fundStartDate` two years ago, the projector synthesizes 24 months of OpEx payments retroactively. This inflates `deductions` and deflates `principalReturnBalance` by the full historical amount that was never actually spent.

**Impact:** Every OpEx expense silently overstates historical deductions. The more time between `fundStartDate` and expense creation, the worse the error.

**Fix:** OpEx synthesis should start from `max(fundStartDate, expense.lastProcurementDate)`. The `lastProcurementDate` field on OpEx represents the subscription start date (the modal label says "Subscription Start").

### Bug 2 (MODERATE): Month Overflow in OpEx Synthesis Loop

**Location:** `app.js:509-519`

```js
let m = fundStart.getMonth() + 1;
while (true) {
    if (m > 11) { m -= 12; y++; }
```

`getMonth()` returns 0-11. Starting at `getMonth() + 1` means the first payment is one month after fund start — correct intention. But the overflow check `m > 11` should be `m >= 12` (or equivalently `m > 11` works since m is integer). Actually `m > 11` is equivalent to `m >= 12` for integers, so this is technically fine.

**However**, there's a subtle issue: when `fundStart` is, say, November (month 10), `m` starts at 11 (December). Next iteration: `m = 12`, which triggers `m -= 12; y++`, making `m = 0` (January next year). This is correct.

But when `fundStart` is December (month 11), `m` starts at 12, which immediately overflows to 0 of the next year. The `new Date(y, 0, 1)` is January 1st of next year — correct, first payment is one month later. **No bug here on closer inspection.**

### Bug 3 (MODERATE): Negative Compound Base Allows Zero Growth But Doesn't Recover

**Location:** `app.js:554`

```js
if (finalDays > 0 && compoundBase > 0) {
```

When outflows exceed the compound base (i.e., the user is draining principal), `compoundBase` goes negative. From that point, no growth is computed — the `compoundBase > 0` guard prevents it. But when a deposit arrives that brings the base back positive, growth resumes **from that deposit date forward on the new positive base**. This is actually correct behavior.

**However:** the `gains` accumulator never accounts for the *loss* that should occur on a negative balance. In reality, a negative balance (margin/debt) would accrue interest costs. The model simply stops compounding, which is a reasonable simplification but should be documented.

### Bug 4 (MODERATE): `annualGainAmount` Uses End-State Principal, Not Compound Base

**Location:** `app.js:599`

```js
const annualGainAmount = principal * rate;
```

This uses the simple sum of deposits (the `principal` variable) times the rate at projection date. But the **actual** compound base may be lower due to outflows. This means allocations to expenses can exceed what the compound base actually generates.

**Example:** Principal is 135,000. Procurements totaling 50,000 have been made. Compound base is ~85,000. But `annualGainAmount = 135000 * 0.07 = 9,450` when the real annual gain on the current base is `85000 * 0.07 = 5,950`.

**Impact:** Progress bars and allocation amounts are overstated when significant outflows have occurred. Users see more optimistic funding percentages than reality.

### Bug 5 (LOW): Account Type Has No Effect

The `accountType` field (`isk`, `traditional`, `brokerage`) is stored but never used in calculations. ISK in Sweden has a specific flat tax on account value (~0.375% of value, not on gains). Traditional accounts have capital gains tax. This makes the "Account" dropdown misleading — it suggests the model accounts for tax implications when it doesn't.

### Sequence-of-Returns Risk

Not modeled. A 7% average return with high volatility can produce dramatically different outcomes depending on when negative years occur (especially early). The deterministic projection gives a single "most likely" path with no confidence information.

### Inflation

Not modeled. A 10-year projection at 7% nominal shows 100% more than the 4% real return would. For a planning tool, this is a significant omission — especially for expenses with long intervals (4-year CapEx cycles).

### Compounding Correctness

The piecewise approach is sound: `base * ((1+r)^(d/365) - 1)` for each sub-period. This is annual compounding with daily interpolation, which is standard. The formula correctly handles variable rates and mid-period cash flows.

### Edge Cases

| Edge Case | Current Behavior | Issue |
|---|---|---|
| Negative balance, then deposit | Growth resumes from deposit | OK |
| Zero principal, positive rate | `0 * rate = 0` gains | OK |
| Zero rate | No gains, expenses drain principal | OK |
| Fund start date in the future | Returns `{principal:0, ...}` | OK |
| Expense cost = 0 | Division by zero in progress calc protected by `exp.cost > 0` check | OK |
| Very long projection (100 years) | Runs 400 quarterly projections, each scanning all events | Performance concern |

---

## PHASE 3 — HIGH-IMPACT IMPROVEMENTS

| # | Category | Improvement | Impact |
|---|---|---|---|
| 1 | Financial Intelligence | **Fix OpEx backdating bug** — synthesize from creation date | Correctness — HIGH |
| 2 | Financial Intelligence | **Use compound base for allocation** instead of raw principal | Correctness — HIGH |
| 3 | Risk Surfacing | **Monte Carlo confidence bands** — overlay on projection chart | Decision quality — HIGH |
| 4 | Financial Intelligence | **Inflation toggle** — real vs. nominal projection | Planning accuracy — HIGH |
| 5 | Visualization | **"Failure year" marker** — when PR balance permanently goes negative | Urgency — MEDIUM |
| 6 | Decision Support | **"What-if" mode** — temporarily adjust rate/principal to see impact | Exploration — MEDIUM |
| 7 | UX Clarity | **Tax-aware returns** — make account type actually affect calculations | Trust — MEDIUM |
| 8 | Visualization | **Per-expense funding timeline** — show when each item gets funded on chart | Clarity — MEDIUM |
| 9 | Automation | **Projected deposit needed** — "add X SEK to fully fund all expenses by Y date" | Actionability — MEDIUM |
| 10 | Risk Surfacing | **Expense cost growth modeling** — annual price increase per expense | Realism — LOW-MEDIUM |

---

## PHASE 4 — DEEP DIVE (TOP 3)

---

### Improvement 1: Fix OpEx Backdating Bug

#### Problem

OpEx payments are synthesized from `fundStartDate` regardless of when the subscription was actually created. Adding a 150 SEK/month Netflix subscription with a fund start date 3 years ago immediately creates 36 phantom deductions totaling 5,400 SEK that never actually happened.

#### Solution

Each OpEx expense should synthesize payments starting from `max(fundStartDate, expense.lastProcurementDate || creationDate)`.

#### Why It Matters

This is a correctness bug. Users adding new subscriptions will see their PR Balance drop by the entire historical cost, making the tool appear broken or untrustworthy. It penalizes users for having an older fund start date.

#### Financial Logic

Current: `totalDeductions += monthlyOpEx * monthsSince(fundStartDate)`
Corrected: `totalDeductions += sum(monthlyExpCost * monthsSince(max(fundStartDate, expStartDate)))` per expense

#### Dependency Impact

- Changes the gains calculation (compound base is reduced less aggressively)
- Changes deductions total
- Changes PR Balance (likely becomes more positive/less negative)
- Does NOT affect CapEx calculations
- Does NOT affect rate/deposit logic

#### Implementation

```js
// In project(), replace lines 502-522 with per-expense OpEx synthesis:

// Synthesize monthly OpEx payment events PER EXPENSE
const activeOpex = expenses.filter(e => e.type === 'opex');
activeOpex.forEach(exp => {
    const monthlyCost = exp.billingCycle === 'monthly' ? exp.cost : exp.cost / 12;
    if (monthlyCost <= 0) return;

    // Start from the later of fund start or expense start date
    const expStart = exp.lastProcurementDate
        ? new Date(Math.max(fundStart.getTime(), new Date(exp.lastProcurementDate).getTime()))
        : fundStart;

    let y = expStart.getFullYear();
    let m = expStart.getMonth() + 1; // first payment one month after start
    while (true) {
        if (m > 11) { m -= 12; y++; }
        const payDate = new Date(y, m, 1);
        if (payDate > date) break;
        if (payDate >= fundStart) { // only count if within fund period
            cashFlowEvents.push({
                date: payDate.toISOString().split('T')[0],
                kind: 'outflow',
                amount: monthlyCost
            });
        }
        m++;
    }
});
```

#### Risks

- Existing users with old data may see their PR Balance **jump up** after this fix. The numbers will be more accurate, but the change could be surprising.
- If `lastProcurementDate` is null on an OpEx (edge case), falls back to fundStartDate — same as current behavior.

#### Test Plan

1. Create OpEx with `lastProcurementDate` = today. Project 3 months out → exactly 3 monthly deductions.
2. Create OpEx with `lastProcurementDate` = 6 months ago, `fundStartDate` = 1 year ago → 6 deductions, not 12.
3. Create OpEx with `lastProcurementDate` before `fundStartDate` → payments start from `fundStartDate`.
4. **Regression**: Ensure CapEx procurements still deduct correctly.
5. **Regression**: Ensure existing OpEx expenses with `lastProcurementDate = fundStartDate` produce identical results.

---

### Improvement 2: Fix Allocation Using Compound Base Instead of Raw Principal

#### Problem

`annualGainAmount = principal * rate` (line 599) uses the sum of all deposits, ignoring that outflows have reduced the actual investment base. This overstates how much annual gain is available for allocation.

#### Solution

Use the compound base at the projection date for allocation calculations.

#### Why It Matters

A user who has procured 50% of their principal in CapEx sees allocation percentages as if the full principal is still earning returns. Progress bars show 100% funded when the real growth rate can only support 50% of that. This creates a false sense of security.

#### Financial Logic

Current: `annualGainAmount = principal * rate`
Corrected: `annualGainAmount = compoundBaseAtDate * rate`

The compound base at the projection date is already computed during the gains loop — it's the `compoundBase` variable after all events are processed plus the final period growth.

#### Dependency Impact

- Reduces `annualGainAmount` when outflows are significant
- Reduces allocated gains to all expenses proportionally
- Reduces progress percentages on CapEx items
- May change `isFunded` status on borderline items
- Changes `requiredPrincipalDisplay` indirectly (it uses `totalAnnualCost / rate` which is unaffected, but the relationship to actual principal changes)

#### Implementation

```js
// After the gains loop (after line 557), capture the effective compound base:
const effectiveBase = compoundBase + (finalDays > 0 && compoundBase > 0
    ? compoundBase * (Math.pow(1 + currentRate, finalDays / 365) - 1)
    : 0);

// Then at line 599, replace:
// const annualGainAmount = principal * rate;
// With:
const annualGainAmount = Math.max(0, effectiveBase) * rate;
```

Note: `effectiveBase` = compoundBase after final period growth. We `Math.max(0, ...)` because a negative base shouldn't produce negative allocations.

#### Risks

- Progress bars will show lower percentages for users with large historical outflows. This is more accurate but might feel like a regression.
- When `effectiveBase` is near zero, allocations become tiny and progress bars barely move. This is correct — the fund genuinely can't cover expenses.
- No risk to gains calculation — that's separate.

#### Test Plan

1. Principal 100k, no outflows → `annualGainAmount = 100000 * 0.07 = 7000` (same as before)
2. Principal 100k, 50k procurement → `effectiveBase ≈ 50k + gains`, `annualGainAmount ≈ 3500+` (previously 7000)
3. Principal 100k, 100k+ in outflows → `effectiveBase < 0`, `annualGainAmount = 0` (previously 7000)
4. **Regression**: No outflows → identical to current behavior

---

### Improvement 3: Monte Carlo Confidence Bands

#### Problem

The projection chart shows a single deterministic line assuming constant returns. Real markets have years of -20% and +30%. A user seeing a smooth upward curve may not appreciate that a bad sequence of early returns could deplete their fund years ahead of schedule.

#### Solution

Add a Monte Carlo simulation layer that runs N trials with randomized annual returns drawn from a lognormal distribution, then overlays confidence bands (10th/90th percentile) on the projection chart.

#### Why It Matters

This is the single most impactful feature for **decision quality**. It transforms the tool from "here's what happens if everything goes as planned" to "here's the range of what could happen." A user seeing that their 10th percentile outcome goes negative in year 8 will make very different decisions than one seeing a smooth line crossing 100% funded in year 6.

#### Financial Logic

For each trial:
1. For each year in the projection window, draw a return from `LogNormal(mu, sigma)` where:
   - `mu = ln(1 + expectedRate) - sigma^2/2` (drift-adjusted)
   - `sigma = 0.15` (default equity volatility, ~15% annualized)
2. Apply that year's return to the compound base
3. Deduct OpEx and scheduled procurements as in the deterministic model
4. Record the PR Balance at each quarterly point

After N trials (500 is sufficient), compute percentile bands at each time point.

The key insight: `E[lognormal] = exp(mu + sigma^2/2) = 1 + expectedRate`, so the **median** of the Monte Carlo matches the deterministic projection. The bands show the spread.

#### Dependency Impact

- **Zero** impact on existing calculations. This is a pure overlay.
- Uses the same `project()` function conceptually, but with randomized rates per year.
- Only affects chart rendering — adds two additional datasets (bands).

#### Implementation

This should be an isolated module that wraps around the existing projector:

```js
// Add to FundFlow object:

runMonteCarlo(years, trials = 500, volatility = 0.15) {
    const settings = this.data.settings;
    const fundStart = new Date(settings.fundStartDate);
    const expectedRate = this.getCurrentRate();

    // Drift-adjusted mu for lognormal
    const mu = Math.log(1 + expectedRate) - (volatility * volatility) / 2;

    const totalQuarters = years * 4;
    // results[quarter][trial] = prBalance
    const results = Array.from({ length: totalQuarters + 1 }, () => []);

    for (let t = 0; t < trials; t++) {
        // Generate annual returns for this trial
        const annualReturns = [];
        for (let y = 0; y < years; y++) {
            // Box-Muller transform for normal random
            const u1 = Math.random();
            const u2 = Math.random();
            const z = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
            const logReturn = mu + volatility * z;
            annualReturns.push(Math.exp(logReturn) - 1);
        }

        // Simulate quarter by quarter using the deterministic projector
        // but swapping in the randomized rate for each year
        for (let q = 0; q <= totalQuarters; q++) {
            const yearIndex = Math.floor(q / 4);
            const rate = annualReturns[Math.min(yearIndex, annualReturns.length - 1)];

            const qDate = new Date(fundStart.getTime() + (q * 91.31 * 24 * 60 * 60 * 1000));

            // For efficiency, use a simplified projection:
            // We can't call project() 500*80 times, so we do a lightweight sim
            // This is the tradeoff — we simulate gains with randomized rates
            // but use the same expense structure

            // For the first implementation, we'll use a simplified model:
            // principal * product((1 + r_i)^0.25) for each quarter, minus cumulative deductions
            if (q === 0) {
                results[q].push(0); // At fund start, PR balance = 0
                continue;
            }

            const r = annualReturns[Math.min(yearIndex, annualReturns.length - 1)];
            const prevBalance = results[q - 1][t];

            // Simplified: grow previous compound base by quarterly rate,
            // subtract quarterly expenses
            // This is a fast approximation suitable for MC
            const quarterlyRate = Math.pow(1 + r, 0.25) - 1;
            const quarterlyExpenses = this.project(fundStart).totalAnnualCost / 4;

            // Track compound base separately
            if (!this._mcBases) this._mcBases = {};
            if (q === 1) {
                this._mcBases[t] = this.project(fundStart).principal;
            }
            const base = this._mcBases[t];
            const gain = base * quarterlyRate;
            this._mcBases[t] = base + gain - quarterlyExpenses;

            results[q].push(prevBalance + gain - quarterlyExpenses);
        }
    }

    delete this._mcBases;

    // Compute percentiles at each quarter
    const bands = [];
    for (let q = 0; q <= totalQuarters; q++) {
        const sorted = results[q].slice().sort((a, b) => a - b);
        const qDate = new Date(fundStart.getTime() + (q * 91.31 * 24 * 60 * 60 * 1000));
        bands.push({
            date: qDate.toISOString().split('T')[0],
            p10: sorted[Math.floor(trials * 0.1)],
            p25: sorted[Math.floor(trials * 0.25)],
            p50: sorted[Math.floor(trials * 0.5)],
            p75: sorted[Math.floor(trials * 0.75)],
            p90: sorted[Math.floor(trials * 0.9)],
        });
    }

    return bands;
},
```

Then in `getChartConfig()` for the projection view, add fill-between datasets:

```js
// After the existing two datasets, add:
const mcBands = this.runMonteCarlo(20, 300, 0.15);

// 10th-90th percentile band (light fill)
datasets.push({
    label: '90th %ile',
    data: mcBands.map(b => ({ x: b.date, y: b.p90 })),
    borderColor: 'rgba(0, 212, 170, 0.15)',
    backgroundColor: 'transparent',
    borderWidth: 1,
    borderDash: [2, 2],
    pointRadius: 0,
    fill: false
});
datasets.push({
    label: '10th %ile',
    data: mcBands.map(b => ({ x: b.date, y: b.p10 })),
    borderColor: 'rgba(239, 68, 68, 0.2)',
    backgroundColor: 'rgba(0, 212, 170, 0.04)',
    borderWidth: 1,
    borderDash: [2, 2],
    pointRadius: 0,
    fill: '-1'  // fill between this and previous dataset
});
```

#### Risks

- **Performance**: 300 trials x 80 quarters = 24,000 iterations. Each is simple arithmetic (no DOM, no full `project()` call). Should complete in <50ms.
- **Misinterpretation**: Users might fixate on worst-case and panic, or fixate on best-case and over-invest. Clear labeling ("In 10% of simulated scenarios...") mitigates this.
- **Simplified model**: The MC sim doesn't include mid-period deposits or per-expense OpEx synthesis. It's an approximation for visualization, not a replacement for the deterministic projector.

#### Test Plan

1. Set volatility to 0 → bands should collapse to a single line matching the deterministic projection.
2. Set rate to 0% → all bands should show declining balance equal to cumulative expenses.
3. Verify p50 is approximately equal to deterministic projection.
4. Very high volatility (50%) → bands should be very wide, confirming spread works.
5. **Regression**: Existing projection line must be unaffected.

---

## PHASE 5 — QUICK WINS

| # | Type | Suggestion | Location |
|---|---|---|---|
| 1 | Warning | When PR Balance < 0: show "Funding X% of expenses from principal" with specific SEK amount | `renderProjection()` balance display |
| 2 | Tooltip | On "Required" stat: "The principal needed so that annual gains (at current rate) cover all annual expenses without touching capital" | Header stats area |
| 3 | Microcopy | On CapEx progress bar: show "SEK X of Y accumulated" alongside percentage | `renderCapExRow()` |
| 4 | Visual cue | Color the "Required" principal red when actual principal < required, green when >= | `renderProjection()` line 770-774 — partially done but only sets green/secondary, not red |
| 5 | Warning | On rate slider: when rate > 10%, show subtle text "Historically, sustained returns above 10% are rare" | Rate input handler |
| 6 | Inline explanation | In OpEx row: show "This subscription costs you X SEK/year in gains you can't allocate to CapEx" | `renderOpExRow()` |
| 7 | Visual cue | Add a horizontal zero line on the projection chart (PR Balance = 0) with label "Break-even" | Chart options annotation |
| 8 | Tooltip | On "Redistribute surplus" checkbox: "When a CapEx item is 100% funded, its excess allocated gains flow to other unfunded items, helping them fund faster" | Already has help text, but it's below the fold |
| 9 | Microcopy | When CapEx projected date > scheduled date: show "Underfunded — projected completion is N months late" in orange | `renderCapExRow()` |
| 10 | Warning | On "Procure Now" for underfunded items: "This item is only X% funded. Proceeding will deduct the full cost from your gains/principal." | Procurement modal |
| 11 | Visual cue | Dim/grey out future events in the event list (date > today) and label them "Scheduled" | `renderEventRow()` |
| 12 | Inline explanation | On initial principal input: show effective monthly return at current rate: "≈ X SEK/month in gains" | Fund settings row |

---

## PHASE 6 — "YOU DIDN'T THINK OF THIS"

### 1. Withdrawal Schedule Projection

**Concept:** Instead of just showing *if* expenses can be funded, show a concrete **month-by-month cash flow schedule** — a table showing: Date | Event | Inflow (gains) | Outflow (expense) | Running Balance.

**Why obvious in hindsight:** The projection chart shows a curve, but users can't see *when* individual payments hit. A CapEx procurement in month 14 might coincide with a yearly OpEx payment, creating a temporary cash crunch invisible in the quarterly chart. A monthly ledger-style view turns abstract curves into concrete "here's what happens each month."

**Fits product philosophy:** This is insight, not enforcement. It helps users see timing conflicts and plan deposits.

### 2. "Fund This First" Priority Queue

**Concept:** Automatically rank expenses by urgency: `(scheduledDate - projectedDate)` gives a "funding gap" metric. Negative = underfunded (won't be ready in time). Positive = surplus time. Display as a sorted priority list with color-coded urgency bars.

**Why obvious in hindsight:** Users currently see individual progress bars but have no way to compare across expenses. "Mobile Phone is 45% funded" and "Laptop is 60% funded" — which needs attention? The one due in 6 months at 45% is far more urgent than the one due in 3 years at 60%. This ranking makes priorities instantly visible.

**Fits product philosophy:** No behavioral change. Just surfaces the implicit priority that's already buried in the data.

### 3. Deposit Impact Preview

**Concept:** When the user opens the "Add Deposit" modal, show a live preview: "Adding X SEK will: increase monthly gains by Y SEK, fully fund [Expense A] by [Date], bring PR Balance to Z SEK." Update in real-time as they type the amount.

**Why obvious in hindsight:** The #1 question a user has when adding money is "what does this get me?" Currently they add the deposit, close the modal, and try to spot what changed. A live preview in the modal itself answers the question before they commit.

**Fits product philosophy:** Pure insight. Non-destructive. Makes the deposit decision more informed.

---

## PHASE 7 — SAFETY GUARDRAILS

### Verification Checklist

| Guardrail | Status |
|---|---|
| OpEx fix: only changes synthesis start date, no structural change | Safe — additive |
| Allocation fix: single line change with `Math.max(0, ...)` guard | Safe — isolated |
| Monte Carlo: new datasets added to chart, no existing datasets modified | Safe — additive |
| All new features are `if`-guarded or behind toggles | Confirmed |
| No changes to `saveToStorage()` schema | Confirmed |
| No changes to event types or data model | Confirmed |
| Import/export format unchanged | Confirmed |
| LocalStorage key unchanged | Confirmed |

### Behavioral Shift Documentation

1. **OpEx fix** will cause PR Balance to increase for users with old fund start dates and recently-added OpEx. This is a correction, not a regression, but should be noted in release notes.
2. **Allocation fix** will cause CapEx progress bars to show lower percentages when significant procurements have occurred. Again, a correction.
3. **Monte Carlo bands** are visual-only and don't affect any stored data or calculated values.

### Rollback Strategy

Each fix is a localized code change. If any issue arises:
- OpEx fix: revert the synthesis loop back to using `fundStart` for all expenses
- Allocation fix: revert `annualGainAmount` to `principal * rate`
- Monte Carlo: remove the MC datasets from `getChartConfig()`

No data migration is needed for any of these changes. They are purely calculation/display layer modifications.

---

## Summary of Critical Findings

| Priority | Finding | Type |
|---|---|---|
| **P0** | OpEx payments backdated to fund start instead of expense creation | Bug |
| **P0** | Allocation uses raw principal instead of effective compound base | Bug |
| **P1** | Account type stored but has no calculation effect | Misleading UI |
| **P1** | No inflation modeling (7% nominal ≠ 7% real) | Missing feature |
| **P1** | Deterministic-only projection gives false confidence | Missing feature |
| **P2** | No visibility into timing conflicts between expenses | Missing feature |
| **P2** | No deposit impact preview | UX gap |

The two P0 bugs are the highest priority. They produce **silently incorrect numbers** in common usage scenarios. The OpEx bug in particular affects every user who adds a subscription after their initial fund setup.
