# FundFlow v2 - Event-Sourced Implementation Specification

## Overview

FundFlow v2 reimagines the self-funded procurement planner using an event-sourced model. All application state is derived from an ordered event log, enabling timeline-based projections, historical analysis, and accurate expense tracking.

---

## Core Concepts

### Principal Return Balance

The central concept is tracking a "principal return" balance that:
- **Grows** from investment gains (compound growth on principal)
- **Depletes** from OpEx deductions and CapEx procurements
- **Funds** recurring expenses without touching principal (ideal state)

When balance goes negative, the UI shows a warning indicating "draining principal".

### Timeline Projection

The application displays state at a selected date:
- **Past dates**: Historical state (what was allocated at that time)
- **Today (default)**: Current state
- **Future dates**: Projected based on current trajectory

---

## Data Model

### Root Structure

```js
{
  settings: {
    initialPrincipal: Number,    // First deposit amount
    accountType: String,         // 'isk' | 'traditional' | 'brokerage'
    fundStartDate: String        // ISO date 'YYYY-MM-DD'
  },
  expenses: [
    // Current state snapshot (derived from events)
    {
      id: String,
      type: String,              // 'capex' | 'opex'
      name: String,
      cost: Number,              // Current cost
      interval: Number,           // Years (capex) or 1 (opex)
      billingCycle: String,      // 'monthly' | 'yearly' (opex only)
      lastProcurementDate: String | null
    }
  ],
  events: [
    // Append-only event log
    {
      id: String,                // UUID
      type: String,
      date: String,              // ISO date
      createdAt: String,         // ISO timestamp
      ...payload                 // Event-specific fields
    }
  ]
}
```

### Event Types

| Event Type | Payload Fields | Description |
|------------|----------------|-------------|
| `deposit` | `amount` | Add to principal |
| `rate_change` | `rate` | New expected annual return (0.07 = 7%) |
| `expense_create` | `expenseId`, `name`, `type`, `cost`, `interval`, `billingCycle` | Create new expense |
| `expense_update` | `expenseId`, `cost`, `interval` | Modify expense (not type) |
| `procurement` | `expenseId`, `date`, `cost`, `note` (optional) | Record procurement with its cost and optional note |
| `expense_delete` | `expenseId` | Remove expense |

---

## Calculation Engine

### Projector Function

`project(state, atDate)` returns:

```js
{
  principal: Number,           // Total principal at date
  rate: Number,                // Rate in effect at date
  gains: Number,               // Cumulative gains from fundStartDate to date
  deductions: Number,         // Cumulative OpEx + procurements to date
  principalReturnBalance: Number, // gains - deductions

  // Per-expense allocation
  expenses: [
    {
      ...expense,
      annualCost: Number,      // Annual cost in SEK
      allocatedGains: Number,  // Gains allocated to this expense
      progress: Number,       // (allocatedGains / cost) * 100
      scheduledDate: String | null,  // Based on lastProcurementDate + interval
      projectedDate: String | null, // When balance will cover it
      isFunded: Boolean        // principalReturnBalance >= required
    }
  ],

  // Aggregate metrics
  totalAnnualCost: Number,
  isDrainingPrincipal: Boolean
}
```

### Calculation Steps

1. **Load events sorted by date**
2. **Calculate principal at date**: initialPrincipal + sum(deposits where date ≤ atDate)
3. **Calculate rate at date**: find last rate_change ≤ atDate, default 7%
4. **Calculate gains**: compound using piecewise rates
   - For each period between events, apply rate in effect for that period
   - Sum all period gains
5. **Calculate deductions**:
   - OpEx: sum of (monthly × 12 or yearly) for each month from fundStartDate to atDate
   - CapEx: sum of procurement costs where date ≤ atDate
6. **Calculate balance**: gains - deductions
7. **Allocate balance to expenses**:
   - Proportional to annualCost
   - CapEx also considers cycle position

### Key Formulas

**Compound Growth with Variable Rate:**
```
gains = principal × (e^(sum(ln(1+rate_i)) × days_i/total_days) - 1)
```
Simplified: iterate through periods, apply each period's rate

**CapEx Required Principal:**
```
required = cost / ((1 + rate)^interval - 1)
```

**OpEx Required Principal:**
```
required = (monthly × 12) / rate  // or just cost/rate for yearly
```

---

## UI Components

### 1. Header Bar
- Logo + "FundFlow" title
- Principal Return Balance (large, color-coded)
- Status indicator: "Funding OK" | "Draining Principal"
- Timeline date selector (date input + range slider)

### 2. Sidebar - Settings
- Initial Principal input
- Expected Return Rate slider (1-15%)
- Account Type dropdown
- Fund Start Date picker

### 3. Sidebar - Data Management
- Export JSON button
- Import JSON button
- Reset button

### 4. Main Content - Chart
- Tab 1: **Projection** - Line chart showing balance over time
- Tab 2: **Breakdown** - Bar chart of expense allocations
- Tab 3: **Analysis** - Monte Carlo results

### 5. Main Content - Expenses
- Section header with "Add Expense" button
- List of expense cards:

**CapEx Card:**
```
┌─────────────────────────────────────────────────────┐
│ Mobile Phone          [CapEx]          SEK 12,000   │
│ Every 4 years         Last: 2024-01-01              │
│                                                      │
│ ████████████░░░░░░░  45% funded                     │
│ Scheduled: 2028-01-01  Projected: 2028-06-15       │
│                                                      │
│ [Procure Now] [Edit] [Delete]                      │
└─────────────────────────────────────────────────────┘
```

**OpEx Card:**
```
┌─────────────────────────────────────────────────────┐
│ Netflix               [Sub]           SEK 150/mo   │
│ Yearly: SEK 1,800     Allocated: SEK 1,200/yr      │
│                                                      │
│ [Edit] [Delete]                                     │
└─────────────────────────────────────────────────────┘
```

### 6. Event Log Panel (Expandable)
```
┌─────────────────────────────────────────────────────┐
│ Event Log                              [Expand ▼] │
├─────────────────────────────────────────────────────┤
│ 2024-01-01  + Deposit        SEK 135,000           │
│ 2024-01-01  + Expense Create Mobile Phone         │
│ 2025-06-15  ~ Rate Change    7% → 8%              │
│ 2025-03-20  ✓ Procurement   Mobile Phone SEK 12000│
│                              [Edit] [Delete]       │
└─────────────────────────────────────────────────────┘
```

### 7. Modal - Add/Edit Event
- Event type selector (deposit, rate_change, expense_create, etc.)
- Date picker
- Dynamic fields based on event type

---

## User Interactions

### Adding an Expense
1. Click "+ Add Expense"
2. Select type (CapEx/OpEx)
3. Enter name, cost, interval (capex) or billing cycle (opex)
4. Save → creates `expense_create` event

### Recording a Procurement (Early or On-Time)
1. Click "Procure Now" on expense card
2. Modal shows: expense name, date (default today), cost (default current, editable)
3. Save → creates `procurement` event
4. Next scheduled date recalculates: procurement_date + interval

### Changing Expense Cost/Interval
1. Click "Edit" on expense card
2. Modal shows: new cost, new interval
3. Save → creates `expense_update` event
4. Does NOT affect past procurements (they keep their recorded cost)

### Adding a Deposit
1. Open event log or settings
2. Click "Add Deposit"
3. Enter date, amount
4. Save → creates `deposit` event

### Changing Expected Return Rate
1. Open event log or settings
2. Click "Add Rate Change"
3. Enter date, new rate
4. Save → creates `rate_change` event

### Editing Past Event
1. Open event log
2. Click "Edit" on event
3. Modify fields
4. Save → updates event in place (recalculates all projections)

---

## Implementation Files

### alt/index.html
- Dark theme with CSS embedded
- DM Sans + JetBrains Mono fonts
- Chart.js for visualization
- All UI components defined

### alt/app.js
- `FundFlow` namespace
- Event projector function
- Chart rendering
- UI event handlers
- LocalStorage persistence

---

## Acceptance Criteria

1. ✓ Can add deposit events and see principal update
2. ✓ Can add rate_change events and see gains recalculate
3. ✓ Can create CapEx and OpEx expenses
4. ✓ Can record procurement with custom cost
5. ✓ Timeline slider shows state at different dates
6. ✓ CapEx shows progress bar (allocated/cost)
7. ✓ CapEx shows scheduled and projected dates
8. ✓ OpEx shows annual cost vs. allocated gains
9. ✓ Warning shown when principal return balance < 0
10. ✓ Can edit any event and see projection update
11. ✓ Export/Import works with full event log
12. ✓ Data persists in LocalStorage

---

## Color Scheme

```css
:root {
  --bg-primary: #0a0a0f;
  --bg-secondary: #12121a;
  --bg-tertiary: #1a1a24;
  --bg-card: #16161f;
  --accent-primary: #00d4aa;    /* Teal - main accent */
  --accent-secondary: #7c3aed; /* Purple - secondary */
  --accent-warning: #f59e0b;   /* Amber - warning */
  --accent-danger: #ef4444;    /* Red - danger */
  --accent-success: #10b981;  /* Green - success */
  --text-primary: #f4f4f5;
  --text-secondary: #a1a1aa;
  --text-muted: #71717a;
  --border: #27272a;
}
```

---

## Bug Fixes (v2.1)

1. **Duplicate `type` property in expense_create event** — The event object had `type: 'expense_create'` overwritten by `type: type` (capex/opex), breaking event log rendering and projector filtering. Fixed by renaming to `expenseType`.
2. **Event editing created duplicates** — `saveEvent()` always pushed a new event even when `editingEventId` was set. Fixed to update existing events in-place.
3. **String vs Date comparison in projector** — `ev.date <= atDate` compared ISO date strings against Date objects, producing unreliable coercion. Fixed by normalizing to ISO date strings throughout.
4. **Initial principal not synced to settings** — Changing principal created an `initial_deposit` event but never updated `settings.initialPrincipal`, causing stale input values after reload.
5. **Chart type switching broken** — `updateChart()` tried to change `chart.config.type` after creation, which Chart.js doesn't support. Fixed by destroying and recreating the chart.
6. **Gains calculation ignored mid-period deposits** — Piecewise compound growth only iterated over `rate_change` events, using the final principal for all periods. Fixed by incorporating deposits as period boundaries.
7. **Input focus fighting** — `render()` unconditionally set input values on every call, resetting cursor position during typing. Split into `renderProjection()` (display-only) and `render()` with `activeElement` guards.
