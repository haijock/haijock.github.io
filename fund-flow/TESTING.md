# FundFlow v2 — Comprehensive Manual Testing Plan

## About This Document

This document provides step-by-step manual testing scenarios for FundFlow v2, a self-funded procurement planner. Each scenario includes purpose, background, steps, and expected outcomes. A tester with no prior knowledge of the application should be able to execute these tests unaided.

**How to run the application:** Open `alt/index.html` in a modern web browser (Chrome, Firefox, Safari, Edge). No build step or server is required — it is a static single-page application.

**How to reset between tests:** Use the gear icon (top-right) > "Reset All Data" to clear all state. Alternatively, open browser DevTools > Application > Local Storage and delete the `fundflow_data` key.

---

## Table of Contents

1. [Application Overview](#1-application-overview)
2. [Test Environment Setup](#2-test-environment-setup)
3. [Scenario Group A: Core Data Entry](#3-scenario-group-a-core-data-entry)
4. [Scenario Group B: Calculation Engine](#4-scenario-group-b-calculation-engine)
5. [Scenario Group C: P0 Bug Fix Verification](#5-scenario-group-c-p0-bug-fix-verification)
6. [Scenario Group D: Chart & Visualization](#6-scenario-group-d-chart--visualization)
7. [Scenario Group E: Monte Carlo Simulation](#7-scenario-group-e-monte-carlo-simulation)
8. [Scenario Group F: Quick Wins & UX Enhancements](#8-scenario-group-f-quick-wins--ux-enhancements)
9. [Scenario Group G: Advanced Features](#9-scenario-group-g-advanced-features)
10. [Scenario Group H: Data Management](#10-scenario-group-h-data-management)
11. [Scenario Group I: Edge Cases & Regression](#11-scenario-group-i-edge-cases--regression)
12. [Scenario Group J: Responsive & Cross-Browser](#12-scenario-group-j-responsive--cross-browser)

---

## 1. Application Overview

### What is FundFlow?

FundFlow is a financial planning tool that helps users determine how much money to invest so that the **investment returns** (gains) can fund their recurring purchases and subscriptions — ideally without touching the invested capital (principal).

### Key Concepts

| Term | Meaning |
|------|---------|
| **Principal** | The total amount of money deposited into the investment fund |
| **Rate** | The expected annual return rate on the investment (e.g., 7% per year) |
| **Gains** | The cumulative investment returns earned since the fund started |
| **Principal Return (PR) Balance** | `Gains - Deductions`. Positive = gains cover expenses. Negative = eating into principal |
| **CapEx (Capital Expenditure)** | A one-time purchase funded over time (e.g., a phone every 4 years for 12,000 SEK) |
| **OpEx (Operating Expenditure)** | A recurring subscription cost deducted monthly/yearly from gains (e.g., Netflix at 150 SEK/month) |
| **Procurement** | Recording an actual purchase of a CapEx item, which deducts its cost and resets the funding cycle |
| **Required Principal** | The minimum investment needed so annual gains cover ALL expenses |
| **Effective Base** | The actual invested capital after gains and outflows — used for allocation instead of raw principal |
| **Redistribute Surplus** | When enabled, a fully-funded CapEx item's excess gains flow to underfunded items |

### UI Layout

- **Header**: Shows PR Balance (color-coded), Principal, Gains, Required Principal
- **Chart Area**: Has 4 tabs — Projection (line chart), Breakdown (bar chart), Priority (sorted list), Cash Flow (table)
- **Settings Row**: Principal amount, Rate slider, Account type, Start date, Redistribute toggle
- **Unified List**: Shows all expenses and events with filter tabs (All, Expenses, CapEx, OpEx, Deposits, Rates)
- **Modals**: Add/Edit Expense, Record Procurement, Add/Edit Event

---

## 2. Test Environment Setup

### Prerequisites
- Modern browser with JavaScript enabled
- Browser DevTools accessible (F12 or Cmd+Option+I)
- Screen resolution at least 1024x768 for desktop tests

### Before Each Test Group
1. Open `alt/index.html` in the browser
2. Click the gear icon (top-right) > **Reset All Data** and confirm
3. Verify the page shows "No events or expenses yet" in the list area
4. Verify the PR Balance shows "0 SEK"
5. Verify the Fund Start Date is set to today's date

### Notation
- `[Button Text]` = click a button with that label
- `{field}` = an input field
- `=>` = the expected result after performing the action
- **VERIFY:** = something the tester must confirm

---

## 3. Scenario Group A: Core Data Entry

### A1: Set Initial Principal

**Purpose:** Verify that the initial principal investment can be set and is reflected across the UI.

**Background:** The principal is the foundational investment. All gain calculations start from this amount. Changing it should immediately update gains, PR balance, required principal, and the projection chart.

**Steps:**
1. Locate the **Principal** input field in the settings row (below the chart, inside the "Events & Expenses" card)
2. Clear the field and type `200000`
3. **VERIFY:** The "Principal" stat in the header updates to "200 000 SEK"
4. **VERIFY:** The "Gains" stat shows some positive value (the rate defaults to 7%, so at today's date gains should be approximately 0 since fund just started)
5. **VERIFY:** The PR Balance updates accordingly
6. Change the value to `500000`
7. **VERIFY:** Principal stat updates to "500 000 SEK"
8. **VERIFY:** The monthly gain hint next to the principal input shows approximately `500000 * 0.07 / 12 ≈ 2 917 SEK/month`

**Expected Outcome:** Principal changes are reflected immediately in all stats and the projection chart redraws.

---

### A2: Adjust Return Rate

**Purpose:** Verify the rate slider works and updates calculations in real-time.

**Background:** The expected return rate (default 7%) determines how fast the investment grows. Higher rates mean faster funding of expenses but may be unrealistic.

**Steps:**
1. Set principal to `200000`
2. Locate the **Rate** slider in the settings row
3. Drag the slider to **10%**
4. **VERIFY:** The rate label next to the slider shows "10.0%"
5. **VERIFY:** The monthly gain hint updates to approximately `200000 * 0.10 / 12 ≈ 1 667 SEK/month`
6. **VERIFY:** If any expenses exist, their funding progress updates
7. Drag the slider to **12%**
8. **VERIFY:** A warning appears: "Sustained returns above 10% are historically rare" (in amber/orange text)
9. Drag back to **7%**
10. **VERIFY:** The warning disappears

**Expected Outcome:** Rate changes propagate immediately. Warning appears above 10%.

---

### A3: Change Fund Start Date

**Purpose:** Verify that changing the fund start date recalculates all projections from the new start.

**Background:** The fund start date determines when the investment began earning returns. An earlier start date means more time for compound growth (and more OpEx deductions if subscriptions exist).

**Steps:**
1. Set principal to `200000`, rate to 7%
2. Change the **Start** date to exactly 2 years ago from today
3. **VERIFY:** The Gains stat in the header now shows a positive value (approximately `200000 * ((1.07)^2 - 1) ≈ 29 000 SEK`)
4. **VERIFY:** The PR Balance shows approximately the same as Gains (no expenses yet)
5. **VERIFY:** The projection chart redraws, starting from the new earlier date
6. Change the start date back to today
7. **VERIFY:** Gains return to approximately 0

**Expected Outcome:** Fund start date changes recalculate all gains and the chart projection window.

---

### A4: Add a CapEx Expense

**Purpose:** Verify the full lifecycle of creating a Capital Expenditure item.

**Background:** A CapEx item is a one-time purchase that repeats on a cycle (e.g., a phone every 4 years). The fund accumulates gains over the interval period to cover the cost. Progress bars show how much of the next purchase is funded.

**Steps:**
1. Set principal to `200000`, rate to 7%, start date to 2 years ago
2. Click **[+ Expense]** button (top-right of the list card)
3. **VERIFY:** The expense modal opens with "Add Expense" title
4. **VERIFY:** "Capital" type is selected by default (highlighted button)
5. Fill in:
   - Name: `Mobile Phone`
   - Cost: `12000`
   - Interval: `4` (years)
   - Last Procured: set to 2 years ago (same as fund start)
6. Click **[Save]**
7. **VERIFY:** Modal closes
8. **VERIFY:** A new row appears in the list with:
   - Name "Mobile Phone" with a "CapEx" badge
   - "Every 4 years" in the metadata
   - Cost shows "12 000 SEK"
   - A progress bar showing some percentage (gains allocated over 2 years toward the 12,000 cost)
   - "Sched:" date shown (4 years after last procurement)
   - "Proj:" date shown (when funding will reach 100%)
   - Three action buttons: cart (Procure), pencil (Edit), X (Delete)
9. **VERIFY:** The "Required" stat in the header now shows a value (`12000 / 4 / 0.07 ≈ 42 857 SEK`)
10. **VERIFY:** The chart now shows the effect of this expense on the PR Balance line

**Expected Outcome:** CapEx item is created, visible in the list with funding progress, and affects all projections.

---

### A5: Add an OpEx (Subscription) Expense

**Purpose:** Verify creating a recurring subscription expense.

**Background:** OpEx items represent ongoing costs (subscriptions) that are deducted from gains monthly. They get first priority in gain allocation — before any CapEx items.

**Steps:**
1. Continue from A4 (Mobile Phone exists)
2. Click **[+ Expense]**
3. Click **[Subscription]** type button
4. **VERIFY:** The form changes: "Interval" field hides, "Billing" dropdown appears
5. **VERIFY:** The date label changes to "Subscription Start"
6. Fill in:
   - Name: `Netflix`
   - Cost: `150` (monthly cost)
   - Billing: `Monthly`
   - Subscription Start: set to 1 year ago
7. Click **[Save]**
8. **VERIFY:** A new row appears with:
   - Name "Netflix" with an "Sub" badge (amber colored)
   - Shows "Yearly: 1 800 SEK | Allocated: X SEK/yr | Since: [date]"
   - A progress bar showing coverage percentage
   - Cost shows "150 SEK/mo"
   - Opportunity cost text: "This costs 1 800 SEK/yr in gains unavailable for CapEx"
   - Two action buttons: pencil (Edit), X (Delete) — no procurement button for OpEx
9. **VERIFY:** The PR Balance decreased (OpEx deductions for the past year reduce gains)
10. **VERIFY:** The "Required" stat increased (now needs to cover both CapEx and OpEx)

**Expected Outcome:** OpEx subscription is created with correct annual cost calculation and gain allocation.

---

### A6: Add a Yearly OpEx

**Purpose:** Verify that yearly-billed subscriptions are handled correctly.

**Steps:**
1. Click **[+ Expense]** > select **[Subscription]**
2. Fill in:
   - Name: `Annual Cloud Storage`
   - Cost: `1200` (yearly cost)
   - Billing: `Yearly`
   - Subscription Start: 6 months ago
3. Click **[Save]**
4. **VERIFY:** Row shows "1 200 SEK/yr"
5. **VERIFY:** The annual cost shown is 1,200 SEK (not 14,400)
6. **VERIFY:** Monthly deduction used in calculations is `1200 / 12 = 100 SEK/month`

**Expected Outcome:** Yearly billing cycle correctly calculates annual cost without multiplication error.

---

### A7: Record a Procurement

**Purpose:** Verify recording an actual purchase of a CapEx item.

**Background:** When you actually buy the item (e.g., purchase a new phone), you "procure" it. This deducts the cost from gains, resets the funding cycle, and the item starts accumulating gains again toward the next purchase.

**Steps:**
1. Ensure "Mobile Phone" CapEx exists from A4
2. Click the **cart icon** on the Mobile Phone row
3. **VERIFY:** Procurement modal opens showing "Mobile Phone" name
4. **VERIFY:** Date defaults to today (or timeline date)
5. **VERIFY:** Cost defaults to 12,000 (the expense cost)
6. **VERIFY:** If the item is not 100% funded, a warning appears in amber: "This item is only X% funded..."
7. Optionally change cost to `11500` and add note: `Samsung Galaxy S25`
8. Click **[Record]**
9. **VERIFY:** Modal closes
10. **VERIFY:** A new "Procure" event appears in the event list showing the procurement
11. **VERIFY:** The Mobile Phone progress bar resets to near 0% (funding cycle restarted)
12. **VERIFY:** The Mobile Phone "Last:" date updates to today
13. **VERIFY:** The Mobile Phone "Sched:" date updates to 4 years from today
14. **VERIFY:** PR Balance dropped by 11,500 (the procurement cost deducted)

**Expected Outcome:** Procurement deducts cost, resets funding cycle, creates audit trail event.

---

### A8: Add a Deposit Event

**Purpose:** Verify adding additional money to the investment fund.

**Background:** Deposits increase the principal. More principal means more gains, which means expenses are funded faster.

**Steps:**
1. Click **[+ Event]** button
2. **VERIFY:** Event modal opens with "Deposit" type selected
3. Fill in:
   - Date: today
   - Amount: `50000`
4. Click **[Save]**
5. **VERIFY:** A new "Deposit" event row appears showing "+50 000 SEK"
6. **VERIFY:** The Principal stat increases by 50,000
7. **VERIFY:** All expense progress percentages increase (more gains available)
8. **VERIFY:** The projection chart shows a step up at the deposit date

**Expected Outcome:** Deposit increases principal and recalculates all projections.

---

### A9: Add a Rate Change Event

**Purpose:** Verify creating a rate change event for a specific future or past date.

**Background:** Rate change events allow modeling different expected returns over time. For example, switching from aggressive to conservative investments.

**Steps:**
1. Click **[+ Event]**
2. Click **[Rate Change]** type button
3. **VERIFY:** The "Amount" field hides, "Rate (%)" field appears
4. Fill in:
   - Date: 1 year from now
   - Rate: `5`
5. Click **[Save]**
6. **VERIFY:** A "Rate" event appears in the list showing "5.0%"
7. **VERIFY:** The rate slider updates to 5% (latest rate)
8. **VERIFY:** The projection chart shows a change in trajectory at the rate change date (slower growth from that point)

**Expected Outcome:** Rate change events modify future projections from their effective date.

---

### A10: Edit an Expense

**Purpose:** Verify that expense properties can be modified after creation.

**Steps:**
1. Ensure "Mobile Phone" CapEx exists
2. Click the **pencil icon** on the Mobile Phone row
3. **VERIFY:** The expense modal opens with "Edit Expense" title and all fields pre-filled
4. Change cost to `15000`
5. Click **[Save]**
6. **VERIFY:** The row now shows "15 000 SEK"
7. **VERIFY:** Progress percentage recalculates based on new cost (lower % since cost increased)
8. **VERIFY:** Required principal updates

**Expected Outcome:** Expense edits are saved and immediately reflected in all calculations.

---

### A11: Edit an Event

**Purpose:** Verify that past events can be modified.

**Steps:**
1. Ensure at least one deposit event exists
2. Click the **pencil icon** on the deposit event row
3. **VERIFY:** Event modal opens with "Edit Event" title, fields pre-filled
4. Change the amount to a different value
5. Click **[Save]**
6. **VERIFY:** The event row updates with the new amount
7. **VERIFY:** Principal and all projections recalculate

**Expected Outcome:** Event edits propagate through all calculations.

---

### A12: Delete an Expense

**Purpose:** Verify expense deletion and its effect on projections.

**Steps:**
1. Note the current PR Balance and Required Principal values
2. Click the **X icon** on an expense row
3. **VERIFY:** A confirmation dialog appears: "Delete this expense?"
4. Click OK/Confirm
5. **VERIFY:** The expense row disappears
6. **VERIFY:** PR Balance increases (fewer deductions)
7. **VERIFY:** Required Principal decreases

**Expected Outcome:** Deletion removes the expense and recalculates all projections.

---

### A13: Delete an Event

**Purpose:** Verify event deletion.

**Steps:**
1. Ensure a deposit event exists; note the Principal value
2. Click the **X icon** on the deposit event
3. Confirm the deletion
4. **VERIFY:** The event row disappears
5. **VERIFY:** Principal decreases by the deleted deposit amount

**Expected Outcome:** Event deletion recalculates from the modified event log.

---

## 4. Scenario Group B: Calculation Engine

### B1: Compound Growth Verification

**Purpose:** Verify that gains compound correctly over time.

**Background:** FundFlow uses piecewise compound growth: `base * ((1 + rate)^(days/365) - 1)`. This means gains earn gains (compound interest).

**Steps:**
1. Reset all data
2. Set principal to `100000`, rate to 7%, start date to exactly 1 year ago
3. **VERIFY:** Gains display shows approximately `100000 * 0.07 = 7 000 SEK` (slight variation due to daily compounding)
4. Change start date to exactly 2 years ago
5. **VERIFY:** Gains show approximately `100000 * ((1.07)^2 - 1) ≈ 14 490 SEK` (NOT 14,000 — compound, not simple)
6. Change start date to exactly 5 years ago
7. **VERIFY:** Gains show approximately `100000 * ((1.07)^5 - 1) ≈ 40 255 SEK`

**Expected Outcome:** Gains grow exponentially (compound), not linearly.

---

### B2: OpEx Deduction from Gains

**Purpose:** Verify that OpEx subscriptions correctly reduce gains over time.

**Steps:**
1. Reset all data
2. Set principal to `200000`, rate to 7%, start date to exactly 1 year ago
3. Note the Gains value (should be around 14,000)
4. Note the PR Balance (should equal Gains since no expenses)
5. Add an OpEx: Name: `Test Sub`, Cost: `1000`, Billing: Monthly, Start: 1 year ago (same as fund start)
6. **VERIFY:** PR Balance decreased significantly
7. **VERIFY:** PR Balance ≈ Gains - (1000 * 12 months) = Gains - 12,000
8. The Gains value itself may have changed slightly (OpEx deductions reduce the compound base, meaning there's less capital earning returns)

**Expected Outcome:** Monthly OpEx payments are deducted from gains and reduce the compound base.

---

### B3: CapEx Allocation Proportional Split

**Purpose:** Verify that gains are allocated proportionally among CapEx items.

**Steps:**
1. Reset all data
2. Set principal to `300000`, rate to 7%, start date to 2 years ago
3. Add CapEx: `Phone`, Cost: `12000`, Interval: `4` years, Last Procured: 2 years ago
4. Add CapEx: `Laptop`, Cost: `24000`, Interval: `4` years, Last Procured: 2 years ago
5. **VERIFY:** Laptop's progress percentage is approximately the same as Phone's (same interval, proportional allocation)
6. **VERIFY:** The allocated amounts differ: Laptop gets 2x the allocation of Phone (because its annual cost is 2x: 6000 vs 3000)
7. Both should show similar percentage progress because Laptop needs 2x the money but gets 2x the allocation

**Expected Outcome:** CapEx items with higher annual costs get proportionally more allocation.

---

### B4: OpEx Priority Over CapEx

**Purpose:** Verify that OpEx subscriptions get first claim on gains before CapEx.

**Background:** OpEx items are mandatory ongoing costs (you can't skip Netflix). CapEx items are discretionary timing-wise. So the allocation engine funds OpEx first, then gives remaining gains to CapEx.

**Steps:**
1. Reset all data
2. Set principal to `50000`, rate to 7% (annual gains ≈ 3,500 SEK)
3. Add OpEx: `Streaming`, Cost: `250`, Billing: Monthly, Start: today (annual cost: 3,000 SEK)
4. Add CapEx: `Gadget`, Cost: `10000`, Interval: `3` years, Last Procured: today
5. **VERIFY:** The OpEx item shows close to 100% coverage (3,000 of 3,500 gains)
6. **VERIFY:** The CapEx item shows very low progress (only ~500 SEK/year allocated, from the remaining gains after OpEx)
7. Now increase principal to `200000` (annual gains ≈ 14,000 SEK)
8. **VERIFY:** OpEx shows 100% coverage
9. **VERIFY:** CapEx progress jumps significantly (now has ~11,000 SEK/year allocated)

**Expected Outcome:** OpEx is fully funded before any gains flow to CapEx.

---

### B5: Redistribute Surplus Toggle

**Purpose:** Verify the surplus redistribution mechanism for fully-funded CapEx items.

**Background:** When a CapEx item reaches 100% funding (enough gains have accumulated to cover its cost), it doesn't need all its allocated gains anymore. With redistribution enabled, the excess flows to underfunded items.

**Steps:**
1. Reset all data
2. Set principal to `300000`, rate to 7%, start date to 3 years ago
3. Add CapEx: `Phone`, Cost: `8000`, Interval: `4` years, Last Procured: 3 years ago
4. Add CapEx: `Laptop`, Cost: `30000`, Interval: `5` years, Last Procured: 3 years ago
5. **VERIFY:** Phone might be fully funded (100%+) and Laptop partially funded
6. Note the Laptop progress percentage (with redistribution ON — checkbox should be checked)
7. **Uncheck** the "Redistribute surplus" checkbox
8. **VERIFY:** Laptop progress percentage decreases (it no longer receives Phone's excess)
9. Re-check the checkbox
10. **VERIFY:** Laptop progress returns to the higher value

**Expected Outcome:** Redistribution transfers excess from fully-funded to underfunded items.

---

### B6: Required Principal Calculation

**Purpose:** Verify the "Required" stat shows the minimum principal to fund all expenses.

**Background:** Required Principal = Total Annual Cost / Rate. This is the principal needed so that `principal * rate >= total annual expense cost`.

**Steps:**
1. Reset all data
2. Set rate to 7%
3. Add OpEx: `Sub A`, Cost: `200`, Billing: Monthly (annual: 2,400)
4. Add CapEx: `Item B`, Cost: `16000`, Interval: `4` years (annual: 4,000)
5. Total annual cost = 2,400 + 4,000 = 6,400
6. **VERIFY:** Required Principal ≈ 6,400 / 0.07 ≈ 91,429 SEK
7. Set principal to exactly `91429`
8. **VERIFY:** Required stat turns green (principal >= required)
9. Set principal to `80000`
10. **VERIFY:** Required stat turns red (principal < required)

**Expected Outcome:** Required principal correctly indicates the break-even investment amount.

---

## 5. Scenario Group C: P0 Bug Fix Verification

### C1: OpEx Backdating Fix — New Subscription Doesn't Create Phantom Deductions

**Purpose:** Verify that adding a new OpEx subscription does NOT retroactively synthesize payments from the fund start date.

**Background:** **This was a critical bug.** Previously, adding a Netflix subscription today would create phantom monthly deductions going back to the fund start date (potentially years). This inflated deductions and made the PR Balance incorrectly negative. The fix ensures payments only start from `max(fundStartDate, subscriptionStartDate)`.

**Steps:**
1. Reset all data
2. Set principal to `200000`, rate to 7%
3. Set fund start date to **3 years ago** from today
4. Note the PR Balance (should be positive — pure gains, no expenses)
5. Note the exact Gains value
6. Add OpEx: `New Netflix`, Cost: `150`, Billing: Monthly, **Subscription Start: TODAY** (not 3 years ago)
7. **VERIFY:** PR Balance decreased by only a tiny amount (at most 1-2 monthly deductions if any time has passed since start of current month)
8. **VERIFY:** PR Balance did NOT decrease by `150 * 36 = 5,400 SEK` (which would be the bug behavior — 3 years of phantom payments)
9. **VERIFY:** The OpEx row shows "Since: [today's date]"
10. Now add another OpEx: `Old Spotify`, Cost: `100`, Billing: Monthly, **Subscription Start: 1 year ago**
11. **VERIFY:** PR Balance decreases by approximately `100 * 12 = 1,200 SEK` in deductions (12 months of payments)
12. **VERIFY:** It did NOT decrease by `100 * 36 = 3,600 SEK` (3 years' worth)

**Expected Outcome:** OpEx deductions only count from the subscription start date, not from the fund start date.

---

### C2: OpEx Backdating — Edge Case: Start Before Fund

**Purpose:** Verify that an OpEx with a start date before the fund start date uses the fund start date for deductions.

**Steps:**
1. Reset all data
2. Set principal to `100000`, rate to 7%
3. Set fund start date to **1 year ago**
4. Add OpEx: `Ancient Sub`, Cost: `200`, Billing: Monthly, **Subscription Start: 5 years ago**
5. **VERIFY:** Deductions are calculated from the fund start (1 year ago), not from 5 years ago
6. **VERIFY:** PR Balance reflects approximately `200 * 12 = 2,400 SEK` in deductions (12 months), not `200 * 60 = 12,000 SEK`

**Expected Outcome:** Deductions never extend before the fund start date, even if the subscription is older.

---

### C3: Allocation Uses Effective Base, Not Raw Principal

**Purpose:** Verify that gain allocation uses the actual compound base (after outflows) rather than the raw sum of deposits.

**Background:** **This was a P0 bug.** Previously, if you deposited 200,000 SEK and then procured 100,000 SEK in items, the allocation still used 200,000 as the base, overstating how much annual gain was available. The fix uses the effective compound base (200,000 - 100,000 + gains - expenses ≈ actual invested amount).

**Steps:**
1. Reset all data
2. Set principal to `200000`, rate to 7%, start date to 1 year ago
3. Add CapEx: `Expensive Item`, Cost: `100000`, Interval: `5` years, Last Procured: 1 year ago
4. Note the monthly gain hint (should show `≈ X SEK/month`)
5. Record a procurement on `Expensive Item`: date = today, cost = `100000`
6. **VERIFY:** The monthly gain hint **decreases** significantly
7. **VERIFY:** Before procurement: monthly gain ≈ `effectiveBase * 0.07 / 12` where effectiveBase ≈ 200,000 + gains - opex
8. **VERIFY:** After procurement: monthly gain ≈ `(effectiveBase - 100000) * 0.07 / 12` — noticeably lower
9. **VERIFY:** The CapEx progress bar for Expensive Item reset to near 0% AND the allocation rate is now based on the reduced base

**Old (buggy) behavior would show:** Monthly gain unchanged after procurement (still based on 200,000 raw principal).

**Expected Outcome:** Procuring an item reduces the effective base, which reduces gain allocation and monthly gain estimates.

---

### C4: Allocation With Multiple Outflows

**Purpose:** Verify that multiple outflows cumulatively reduce the effective base.

**Steps:**
1. Reset all data
2. Set principal to `300000`, rate to 7%, start date to 2 years ago
3. Add CapEx: `Item A`, Cost: `50000`, Interval: `4` years, Last Procured: 2 years ago
4. Add CapEx: `Item B`, Cost: `50000`, Interval: `4` years, Last Procured: 2 years ago
5. Note the monthly gain hint value
6. Procure `Item A` for `50000` today
7. **VERIFY:** Monthly gain hint decreased
8. Note the new value
9. Procure `Item B` for `50000` today
10. **VERIFY:** Monthly gain hint decreased again
11. **VERIFY:** Total decrease roughly corresponds to removing `100000` from the compound base

**Expected Outcome:** Each procurement further reduces the effective base and subsequent gain allocation.

---

## 6. Scenario Group D: Chart & Visualization

### D1: Projection Chart Displays Correctly

**Purpose:** Verify the projection chart renders with correct data and visual elements.

**Steps:**
1. Reset all data
2. Set principal to `200000`, rate to 7%, start date to 1 year ago
3. Add CapEx: `Phone`, Cost: `12000`, Interval: `4` years, Last Procured: 1 year ago
4. Add OpEx: `Netflix`, Cost: `150`, Billing: Monthly, Start: 1 year ago
5. **VERIFY:** The "Projection" tab is active (default)
6. **VERIFY:** Chart shows a line graph starting from the fund start date
7. **VERIFY:** There is a solid teal/green line (PR Balance)
8. **VERIFY:** There is a dashed purple line (Gains — cumulative gains without deductions)
9. **VERIFY:** The PR Balance line is below the Gains line (because deductions reduce it)
10. **VERIFY:** A red dashed horizontal line appears at y=0 with "Break-even" label (if the chart y-axis includes 0)
11. **VERIFY:** The chart extends approximately 20 years into the future
12. **VERIFY:** Shaded bands appear around the PR Balance line (Monte Carlo confidence bands)

**Expected Outcome:** Chart renders all visual elements correctly.

---

### D2: Chart Timeline Interaction

**Purpose:** Verify the interactive timeline feature on the projection chart.

**Background:** Clicking or dragging on the chart sets the "timeline date." All numbers in the UI update to reflect the projection at that selected date. This lets users explore "what will things look like in 5 years?"

**Steps:**
1. From D1 setup
2. Note the current PR Balance value and the date shown above the chart
3. Click somewhere in the **middle** of the chart (approximately 10 years in the future)
4. **VERIFY:** A vertical teal dashed line appears at the click position
5. **VERIFY:** A date label appears on the line
6. **VERIFY:** The timeline date display (above the chart) updates to the clicked date
7. **VERIFY:** The PR Balance, Gains, and all expense data update to the projected values at that date
8. **VERIFY:** Expense progress bars show higher values (more time has passed)
9. Now **drag** the mouse left and right across the chart while holding the mouse button
10. **VERIFY:** The timeline scrubs smoothly and numbers update during the drag
11. **Double-click** anywhere on the chart
12. **VERIFY:** The timeline resets to today
13. **VERIFY:** The vertical line disappears
14. Click **[Today]** button (header)
15. **VERIFY:** Same reset behavior

**Expected Outcome:** Chart interaction allows date exploration with real-time projection updates.

---

### D3: Event Markers on Chart

**Purpose:** Verify that deposit, rate change, and procurement events are shown as dots on the projection line.

**Steps:**
1. From previous setup, ensure deposits and procurements exist
2. Look at the projection chart
3. **VERIFY:** Small colored dots appear on the PR Balance line at event dates:
   - Green dots at deposit dates
   - Purple dots at rate change dates
   - Amber dots at procurement dates
4. Hover over a dot (or nearby on the chart)
5. **VERIFY:** The tooltip shows event details (e.g., "Deposit: +50 000 SEK")

**Expected Outcome:** Events are visually marked on the chart with tooltip details.

---

### D4: Breakdown Chart

**Purpose:** Verify the bar chart breakdown view.

**Steps:**
1. Ensure multiple expenses exist
2. Click the **[Breakdown]** chart tab
3. **VERIFY:** Chart changes to a bar chart
4. **VERIFY:** Each bar represents an expense with its annual cost
5. **VERIFY:** Different colors for each expense
6. Hover over a bar
7. **VERIFY:** Tooltip shows the expense name and annual cost in SEK

**Expected Outcome:** Breakdown chart shows per-expense annual cost comparison.

---

### D5: Zero Line Plugin

**Purpose:** Verify the break-even line appears at y=0 on the projection chart.

**Steps:**
1. Set up data where the PR Balance goes negative at some point (high expenses, low principal)
2. Click the **[Projection]** tab
3. **VERIFY:** A red dashed horizontal line is drawn at y=0
4. **VERIFY:** The line is labeled "Break-even" on the left side
5. **VERIFY:** The PR Balance line crosses this zero line at some point

**Expected Outcome:** The zero line provides a clear visual indicator of when gains stop covering expenses.

---

## 7. Scenario Group E: Monte Carlo Simulation

### E1: Monte Carlo Confidence Bands Appear

**Purpose:** Verify that Monte Carlo simulation bands overlay on the projection chart.

**Background:** Monte Carlo simulation runs 300 trials with randomized annual returns (drawn from a lognormal distribution) to show the range of possible outcomes. The bands show the 10th and 90th percentile outcomes — meaning "in 80% of simulated scenarios, the actual result falls within these bands."

**Steps:**
1. Reset all data
2. Set principal to `200000`, rate to 7%, start date to today
3. Add CapEx: `Phone`, Cost: `12000`, Interval: `4` years, Last Procured: today
4. Click **[Projection]** tab
5. **VERIFY:** In addition to the solid PR Balance line, there are two faint dashed lines:
   - Upper line (teal/faint): 90th percentile (optimistic scenario)
   - Lower line (red/faint): 10th percentile (pessimistic scenario)
6. **VERIFY:** A shaded region exists between the two dashed lines
7. **VERIFY:** The solid PR Balance line falls approximately in the middle of the band
8. **VERIFY:** The bands fan out over time (wider in future years — more uncertainty)

**Expected Outcome:** Monte Carlo bands provide visual uncertainty range around the deterministic projection.

---

### E2: Monte Carlo Bands Respond to Settings Changes

**Purpose:** Verify bands update when financial parameters change.

**Steps:**
1. From E1 setup
2. Change rate to **12%**
3. **VERIFY:** All three lines (PR Balance, 90th, 10th) shift upward
4. **VERIFY:** The bands may also widen (higher expected returns often come with higher volatility in practice, though the default volatility is fixed at 15%)
5. Change principal to `500000`
6. **VERIFY:** Bands shift upward and the scale of the chart changes
7. Add a large OpEx: `Expensive Sub`, Cost: `5000`, Billing: Monthly
8. **VERIFY:** All lines shift downward, and the 10th percentile may go significantly negative

**Expected Outcome:** Monte Carlo simulation reflects current settings in real-time.

---

### E3: Monte Carlo Bands Don't Appear in Non-Projection Views

**Purpose:** Verify MC bands only show on the projection chart.

**Steps:**
1. Click **[Breakdown]** tab
2. **VERIFY:** Bar chart appears, no MC bands visible
3. Click **[Priority]** tab
4. **VERIFY:** Priority list appears, no chart elements
5. Click **[Cash Flow]** tab
6. **VERIFY:** Table appears, no chart elements
7. Click **[Projection]** tab
8. **VERIFY:** MC bands reappear

**Expected Outcome:** MC bands are exclusive to the projection view.

---

### E4: Monte Carlo Tooltip Filtering

**Purpose:** Verify that MC band values don't clutter the chart tooltip.

**Steps:**
1. On the projection chart, hover over a data point
2. **VERIFY:** The tooltip shows "PR Balance: X SEK" and "Gains: X SEK"
3. **VERIFY:** The tooltip does NOT show "90th Percentile" or "10th Percentile" values (they are filtered out for clarity)

**Expected Outcome:** MC band datasets are hidden from tooltips.

---

## 8. Scenario Group F: Quick Wins & UX Enhancements

### F1: Balance Hint — Funding From Principal Warning

**Purpose:** Verify the warning message when the fund is draining principal.

**Background:** When PR Balance is negative, it means gains are insufficient and the user is eating into their invested capital. The balance hint makes this explicit.

**Steps:**
1. Reset all data
2. Set principal to `50000`, rate to 7%, start date to 2 years ago
3. Add OpEx: `Expensive`, Cost: `500`, Billing: Monthly, Start: 2 years ago
   (Annual: 6,000 SEK — much more than gains of ~3,500/year)
4. **VERIFY:** PR Balance shows a negative value in red
5. **VERIFY:** Below the PR Balance, a red text appears: "Funding X SEK from principal"
6. Increase principal to `500000`
7. **VERIFY:** PR Balance becomes positive
8. **VERIFY:** The "Funding from principal" hint disappears

**Expected Outcome:** Clear warning when expenses exceed gains.

---

### F2: Required Principal Tooltip

**Purpose:** Verify the tooltip on the "Required" stat explains its meaning.

**Steps:**
1. Hover over the **"Required"** stat item in the header (the label or value area)
2. **VERIFY:** A browser tooltip appears: "The minimum principal needed so annual gains (at current rate) cover all expenses without touching capital"

**Expected Outcome:** Informative tooltip helps users understand the Required metric.

---

### F3: CapEx SEK Accumulated Display

**Purpose:** Verify CapEx progress shows SEK amounts alongside percentages.

**Steps:**
1. Ensure a CapEx item exists with some progress
2. Look at the progress info line below the progress bar
3. **VERIFY:** Shows text like "45% funded · 5 400 of 12 000 SEK"
4. **VERIFY:** The accumulated amount is capped at the cost (never shows more than 12,000 of 12,000)

**Expected Outcome:** Users see concrete SEK amounts, not just abstract percentages.

---

### F4: Required Principal Color Coding

**Purpose:** Verify the Required stat changes color based on funding adequacy.

**Steps:**
1. Reset all data, add an OpEx costing 200/month (annual: 2,400)
2. Set rate to 7%
3. Required ≈ 2,400 / 0.07 ≈ 34,286 SEK
4. Set principal to `50000`
5. **VERIFY:** Required stat text color is **green** (teal) — principal exceeds required
6. Set principal to `20000`
7. **VERIFY:** Required stat text color is **red** — principal below required
8. Delete all expenses
9. **VERIFY:** Required stat text color becomes **muted/grey** (no meaningful required value)

**Expected Outcome:** Color indicates at-a-glance whether the investment is sufficient.

---

### F5: Rate Warning Above 10%

**Purpose:** Verify the warning for unrealistically high return rates.

**Steps:**
1. Set rate slider to `7%`
2. **VERIFY:** No rate warning visible
3. Move slider to `10%`
4. **VERIFY:** Still no warning (10% is the threshold, not exceeded)
5. Move slider to `10.5%` or `11%`
6. **VERIFY:** Warning text appears next to the rate: "Sustained returns above 10% are historically rare" (in amber)
7. Move slider back below 10%
8. **VERIFY:** Warning disappears

**Expected Outcome:** Warning at unrealistic rates prevents overconfident planning.

---

### F6: OpEx Opportunity Cost Display

**Purpose:** Verify the opportunity cost message on subscription items.

**Steps:**
1. Add OpEx: `Premium Service`, Cost: `300`, Billing: Monthly (annual: 3,600)
2. Look at the OpEx row
3. **VERIFY:** Below the progress bar, text reads: "This costs 3 600 SEK/yr in gains unavailable for CapEx"
4. Add another OpEx: `Cheap Service`, Cost: `50`, Billing: Monthly (annual: 600)
5. **VERIFY:** Its message reads: "This costs 600 SEK/yr in gains unavailable for CapEx"

**Expected Outcome:** Each subscription shows its impact on CapEx funding capacity.

---

### F7: Redistribute Tooltip

**Purpose:** Verify the tooltip on the Redistribute Surplus checkbox.

**Steps:**
1. Hover over the **"Redistribute surplus"** label or checkbox area
2. **VERIFY:** Tooltip appears: "When a CapEx item is 100% funded, its excess allocated gains flow to other unfunded items, helping them fund faster"

**Expected Outcome:** Tooltip explains the redistribution mechanism.

---

### F8: Underfunded CapEx Warning

**Purpose:** Verify the warning when a CapEx item's projected completion is after its scheduled date.

**Steps:**
1. Set principal to `100000`, rate to 7%, start date to 1 year ago
2. Add CapEx: `Big Purchase`, Cost: `50000`, Interval: `2` years, Last Procured: 1 year ago
   (This is a tight scenario — scheduled in 1 year, but needs 50k)
3. **VERIFY:** If the projected date is after the scheduled date, the row shows:
   "Underfunded — projected completion X months late" in amber/orange text
4. Increase principal to `800000` (much more capital)
5. **VERIFY:** The warning disappears (projected date now before or at scheduled date)

**Expected Outcome:** Clear warning for items that won't be funded in time.

---

### F9: Procurement Funding Warning

**Purpose:** Verify the warning in the procurement modal for underfunded items.

**Steps:**
1. Ensure a CapEx item exists that is NOT 100% funded
2. Click the **cart icon** to procure it
3. **VERIFY:** An amber warning box appears in the modal: "This item is only X% funded (Y of Z SEK). Proceeding will deduct the full cost from your gains/principal."
4. Now set up a fully-funded item (high principal, long time, low cost)
5. Click procure
6. **VERIFY:** No warning appears in the modal (item is fully funded)

**Expected Outcome:** Users are warned before recording a premature procurement.

---

### F10: Future Event Dimming

**Purpose:** Verify that events with dates in the future are visually dimmed.

**Steps:**
1. Add a deposit event with **today's date** and another with a **future date** (1 year from now)
2. Look at the event list
3. **VERIFY:** The future event row has reduced opacity (appears dimmed/faded)
4. **VERIFY:** The future event has a "Scheduled" label in purple/secondary color
5. **VERIFY:** The past/today event appears at normal opacity without the "Scheduled" label

**Expected Outcome:** Future events are visually distinct from past/current events.

---

### F11: Monthly Gain Display

**Purpose:** Verify the monthly gain estimate next to the principal input.

**Steps:**
1. Set principal to `200000`, rate to 7%
2. **VERIFY:** Next to the principal input, text shows: "≈ 1 167 SEK/month in gains" (200000 * 0.07 / 12)
   (Note: the actual value uses effective base, which may differ slightly from raw principal)
3. Change principal to `500000`
4. **VERIFY:** Monthly gain updates to approximately `≈ 2 917 SEK/month`
5. Change rate to `10%`
6. **VERIFY:** Monthly gain updates accordingly

**Expected Outcome:** Users see the tangible monthly benefit of their investment.

---

## 9. Scenario Group G: Advanced Features

### G1: Priority Queue — Fund This First

**Purpose:** Verify the priority ranking of CapEx items by urgency.

**Background:** The Priority view ranks CapEx items by how far behind (or ahead) their funding schedule is. Items that won't be funded in time are ranked highest (most urgent). This helps users decide where to focus — e.g., whether to add more principal or adjust expectations.

**Steps:**
1. Reset all data
2. Set principal to `200000`, rate to 7%, start date to 2 years ago
3. Add CapEx: `Phone`, Cost: `12000`, Interval: `4` years, Last Procured: 2 years ago
4. Add CapEx: `Laptop`, Cost: `25000`, Interval: `4` years, Last Procured: 3 years ago (more urgent — due sooner!)
5. Add CapEx: `TV`, Cost: `8000`, Interval: `6` years, Last Procured: 2 years ago
6. Click the **[Priority]** chart tab
7. **VERIFY:** The chart area changes to a list view (not a chart)
8. **VERIFY:** Header text: "Fund These First"
9. **VERIFY:** Items are ranked #1, #2, #3
10. **VERIFY:** The most urgent item (highest "months behind" or lowest "months ahead") is ranked #1
11. **VERIFY:** Each item shows:
    - Rank number
    - Item name
    - Urgency label with color:
      - Red: "X months behind" (underfunded)
      - Amber: "Tight — X months buffer"
      - Green: "X months ahead"
      - Teal: "Fully funded"
    - Progress bar
    - Percentage + cost
    - Due date
12. **VERIFY:** If an item is fully funded (100%), it appears at the bottom with "Fully funded" in teal
13. Click the **[Projection]** tab
14. **VERIFY:** Returns to the chart view

**Expected Outcome:** Priority view clearly communicates which items need attention.

---

### G2: Priority Queue — Empty State

**Purpose:** Verify behavior when no CapEx items exist.

**Steps:**
1. Reset all data (or delete all CapEx items)
2. Optionally add OpEx items only
3. Click **[Priority]** tab
4. **VERIFY:** Message: "No CapEx items to prioritize"

**Expected Outcome:** Graceful empty state message.

---

### G3: Cash Flow Ledger

**Purpose:** Verify the monthly cash flow schedule view.

**Background:** The Cash Flow view shows a concrete month-by-month table of inflows (gains, deposits) and outflows (subscriptions, scheduled CapEx purchases) for the next 24 months. This transforms the abstract projection curve into a specific payment schedule.

**Steps:**
1. Reset all data
2. Set principal to `200000`, rate to 7%, start date to 1 year ago
3. Add OpEx: `Netflix`, Cost: `150`, Billing: Monthly, Start: 1 year ago
4. Add CapEx: `Phone`, Cost: `12000`, Interval: `4` years, Last Procured: 3 years ago (due in ~1 year)
5. Add a future deposit: Date = 6 months from now, Amount = 50,000
6. Click **[Cash Flow]** tab
7. **VERIFY:** A table appears with columns: Month, Inflows, Outflows, Net, Events
8. **VERIFY:** 24 rows (months) are shown
9. **VERIFY:** Each month shows:
   - **Inflows** (green): Estimated gains + any deposits in that month
   - **Outflows** (red): OpEx payments + any scheduled CapEx in that month
   - **Net** (teal if positive, red if negative): Inflows - Outflows
   - **Events**: Labels like "Deposit", expense names
10. **VERIFY:** The month where the Phone is scheduled to be procured shows a large outflow
11. **VERIFY:** That month's row has a subtle amber background highlight (CapEx event)
12. **VERIFY:** The month with the future deposit shows it in the Events column
13. **VERIFY:** Months with negative net (outflows > inflows) are shown in red

**Expected Outcome:** Concrete month-by-month cash flow visibility.

---

### G4: Cash Flow Ledger — Gain Estimates

**Purpose:** Verify that monthly gain estimates in the cash flow are reasonable.

**Steps:**
1. From G3 setup
2. In the Cash Flow table, look at the "Inflows" column
3. **VERIFY:** Each month shows estimated gains (approximately `effectiveBase * rate / 12`)
4. **VERIFY:** Gains are similar across months (slight variation is expected due to compounding)
5. **VERIFY:** The gains do NOT show as a huge lump sum — they are distributed monthly

**Expected Outcome:** Monthly gains in the ledger are consistent and realistic.

---

## 10. Scenario Group H: Data Management

### H1: Export Data

**Purpose:** Verify JSON export contains all data.

**Steps:**
1. Set up some expenses and events
2. Click gear icon > **[Export JSON]**
3. **VERIFY:** A file named `fundflow-data.json` is downloaded
4. Open the file in a text editor
5. **VERIFY:** It contains valid JSON with:
   - `settings` object (principal, rate, fund start date, etc.)
   - `expenses` array (all created expenses with their properties)
   - `events` array (all events — deposits, rate changes, procurements, expense creates, etc.)

**Expected Outcome:** Complete data export as JSON file.

---

### H2: Import Data

**Purpose:** Verify importing previously exported data.

**Steps:**
1. Export data from H1
2. Reset all data
3. **VERIFY:** Application is empty
4. Click gear icon > **[Import JSON]**
5. Select the exported file
6. **VERIFY:** Alert shows "Data imported!"
7. **VERIFY:** All expenses reappear
8. **VERIFY:** All events reappear
9. **VERIFY:** All stats (PR Balance, Principal, Gains, Required) match the values before export

**Expected Outcome:** Import fully restores application state.

---

### H3: Copy State to Clipboard

**Purpose:** Verify the clipboard copy functionality.

**Steps:**
1. Set up some data
2. Click the **clipboard icon** (top-right, looks like `📋`)
3. **VERIFY:** The icon briefly changes to a checkmark `✓`
4. Open a text editor and paste
5. **VERIFY:** Valid JSON is pasted, matching the application state

**Expected Outcome:** Quick clipboard copy for debugging or sharing.

---

### H4: Data Persistence

**Purpose:** Verify that data survives page reloads.

**Steps:**
1. Set up expenses, events, change principal and rate
2. Note all current values
3. Refresh the page (F5 or Cmd+R)
4. **VERIFY:** All expenses still exist
5. **VERIFY:** All events still exist
6. **VERIFY:** Principal, rate, start date, account type all retained
7. **VERIFY:** PR Balance and other stats match pre-refresh values

**Expected Outcome:** LocalStorage persistence works correctly.

---

### H5: Reset All Data

**Purpose:** Verify the reset function clears everything.

**Steps:**
1. Set up expenses and events
2. Click gear icon > **[Reset All Data]**
3. **VERIFY:** Confirmation dialog appears
4. Click OK
5. **VERIFY:** List shows "No events or expenses yet"
6. **VERIFY:** Principal reset to 135,000 (default)
7. **VERIFY:** Fund start date reset to today
8. **VERIFY:** PR Balance shows 0 SEK
9. Refresh the page
10. **VERIFY:** Reset state persists — data was deleted from storage

**Expected Outcome:** Clean reset to factory defaults.

---

## 11. Scenario Group I: Edge Cases & Regression

### I1: Zero Principal

**Purpose:** Verify behavior with no investment.

**Steps:**
1. Set principal to `0`
2. **VERIFY:** Gains show 0
3. **VERIFY:** PR Balance shows 0
4. Add expenses
5. **VERIFY:** All progress bars show 0% (no gains to allocate)
6. **VERIFY:** Application does not crash or show NaN

**Expected Outcome:** Graceful handling of zero principal.

---

### I2: Zero Rate

**Purpose:** Verify behavior with 0% return rate.

**Steps:**
1. Set principal to `200000`
2. Use the rate slider — try to set to 1% (the minimum)
3. Add a rate change event manually: Date = today, Rate = 0% 
   (Note: the event modal may not accept 0 — if so, set to 0.5%)
4. **VERIFY:** Gains show 0 or near-0
5. **VERIFY:** All expense progress shows 0% (no gains)
6. **VERIFY:** Required principal shows very large number or infinity indication (totalCost / 0)
7. **VERIFY:** No errors in browser console

**Expected Outcome:** Application handles edge-case rates without crashing.

---

### I3: No Expenses

**Purpose:** Verify clean behavior with no expenses.

**Steps:**
1. Reset all data
2. Set principal and rate to non-zero values
3. **VERIFY:** PR Balance equals Gains (nothing to deduct)
4. **VERIFY:** Required Principal shows 0 SEK
5. **VERIFY:** The projection chart shows an upward curve (pure growth)
6. **VERIFY:** All filter tabs show counts of 0 for expense-related filters

**Expected Outcome:** Application works correctly with no expenses.

---

### I4: Many Expenses

**Purpose:** Verify performance and display with many items.

**Steps:**
1. Add 10+ CapEx items with varied costs and intervals
2. Add 5+ OpEx items with varied costs
3. **VERIFY:** All items display correctly in the list
4. **VERIFY:** Filter tabs show correct counts
5. **VERIFY:** Chart renders without significant lag
6. **VERIFY:** Switching between chart tabs works smoothly
7. **VERIFY:** The priority queue shows all CapEx items ranked
8. **VERIFY:** Cash flow ledger includes all expense impacts

**Expected Outcome:** Application handles moderate data volumes without issues.

---

### I5: Fund Start Date in the Future

**Purpose:** Verify behavior when the fund hasn't started yet.

**Steps:**
1. Set fund start date to **1 year from now**
2. **VERIFY:** Principal shows 0 (or the set amount depending on deposits)
3. **VERIFY:** Gains show 0
4. **VERIFY:** PR Balance shows 0
5. **VERIFY:** The projection chart starts from the future date
6. **VERIFY:** No errors or NaN values appear

**Expected Outcome:** Future start dates are handled gracefully.

---

### I6: Very Long Projection

**Purpose:** Verify the 20-year projection doesn't break.

**Steps:**
1. Set up normal data
2. **VERIFY:** The projection chart extends 20 years from start date
3. Click/drag to a date far in the future (15+ years out)
4. **VERIFY:** Numbers update correctly (large Gains values, high CapEx progress)
5. **VERIFY:** No performance degradation or display glitches

**Expected Outcome:** Long-term projections work correctly.

---

### I7: Large Numbers

**Purpose:** Verify display with large monetary amounts.

**Steps:**
1. Set principal to `10000000` (10 million)
2. Add CapEx: `Yacht`, Cost: `5000000`, Interval: `10` years
3. **VERIFY:** Numbers display with proper formatting (10 000 000 SEK, using Swedish locale spaces)
4. **VERIFY:** Chart axes are properly scaled
5. **VERIFY:** No overflow or truncation in the UI

**Expected Outcome:** Large numbers display and calculate correctly.

---

### I8: Rapid Settings Changes

**Purpose:** Verify the application handles rapid input changes without breaking.

**Steps:**
1. Quickly drag the rate slider back and forth multiple times
2. **VERIFY:** No errors in console, values update smoothly
3. Rapidly change the principal value (type fast, delete, retype)
4. **VERIFY:** No errors, values update correctly when typing stops
5. Rapidly switch between chart tabs
6. **VERIFY:** Each tab renders correctly without residual content from other tabs

**Expected Outcome:** UI remains responsive and correct under rapid changes.

---

### I9: Filter Tabs

**Purpose:** Verify list filtering works correctly.

**Steps:**
1. Set up: 2 CapEx items, 2 OpEx items, 2 deposit events, 1 rate change event
2. Click **[All]** filter tab
3. **VERIFY:** All items visible; count shows total
4. Click **[Expenses]**
5. **VERIFY:** Only the 4 expenses visible (2 CapEx + 2 OpEx)
6. Click **[CapEx]**
7. **VERIFY:** Only 2 CapEx items visible
8. Click **[OpEx]**
9. **VERIFY:** Only 2 OpEx items visible
10. Click **[Deposits]**
11. **VERIFY:** Only deposit events visible
12. Click **[Rates]**
13. **VERIFY:** Only rate change events visible
14. **VERIFY:** Each tab shows the correct count in its badge

**Expected Outcome:** Filters correctly isolate item types.

---

### I10: Edit Procurement Event

**Purpose:** Verify that existing procurement events can be edited.

**Steps:**
1. Ensure a procurement event exists in the list
2. Click the **pencil icon** on the procurement event row
3. **VERIFY:** The procurement modal opens (not the event modal) with pre-filled values
4. Change the cost or date
5. Click **[Record]**
6. **VERIFY:** The event updates in the list
7. **VERIFY:** All projections recalculate based on the updated procurement

**Expected Outcome:** Procurement edits work correctly.

---

## 12. Scenario Group J: Responsive & Cross-Browser

### J1: Mobile/Narrow Viewport

**Purpose:** Verify the application is usable on small screens.

**Steps:**
1. Open browser DevTools and enable device simulation (or resize window to ~375px width)
2. **VERIFY:** Header stacks vertically (no horizontal overflow)
3. **VERIFY:** Balance display is readable
4. **VERIFY:** Settings row fields stack vertically
5. **VERIFY:** Expense rows stack into a single column
6. **VERIFY:** Filter tabs wrap to a second line if needed
7. **VERIFY:** Chart is visible and interactive
8. **VERIFY:** Modals fit within the viewport
9. **VERIFY:** No horizontal scrollbar appears

**Expected Outcome:** Application is usable (though not optimal) on mobile-width screens.

---

### J2: Cross-Browser Verification

**Purpose:** Verify basic functionality across browsers.

**Steps (repeat in Chrome, Firefox, Safari, Edge):**
1. Open the application
2. Add a CapEx and OpEx expense
3. **VERIFY:** Both render correctly
4. View the projection chart
5. **VERIFY:** Chart renders with MC bands
6. Click the chart to set a timeline date
7. **VERIFY:** Timeline interaction works
8. Switch to Priority and Cash Flow tabs
9. **VERIFY:** Both render correctly
10. Export and re-import data
11. **VERIFY:** Round-trip preserves all data

**Expected Outcome:** Core functionality works in all modern browsers.

---

## Appendix: Test Data Presets

### Quick Setup for Most Tests

To quickly set up a representative data set, create the following:

```
Settings:
  Principal: 200,000 SEK
  Rate: 7%
  Start: 2 years ago
  Account: ISK
  Redistribute: ON

Expenses:
  1. Mobile Phone  (CapEx)  12,000 SEK   every 4 years   last procured: 2 years ago
  2. Laptop        (CapEx)  22,000 SEK   every 4 years   last procured: 1 year ago
  3. TV            (CapEx)  15,000 SEK   every 6 years   last procured: 3 years ago
  4. Netflix       (OpEx)   150 SEK/mo   since: 2 years ago
  5. Spotify       (OpEx)   120 SEK/mo   since: 1 year ago
  6. Cloud Storage (OpEx)   1,200 SEK/yr since: 2 years ago

Events:
  1. Deposit:  200,000 SEK  on fund start date
  2. Deposit:  50,000 SEK   on 1 year ago
  3. Rate Change: 7% on fund start date
```

### Minimal Stress Test Setup

```
Settings:
  Principal: 30,000 SEK (intentionally low)
  Rate: 5%
  Start: 3 years ago

Expenses:
  1. Expensive Thing (CapEx) 50,000 SEK every 2 years  last: 1 year ago
  2. Sub A           (OpEx)  500 SEK/mo  since: 3 years ago
  3. Sub B           (OpEx)  300 SEK/mo  since: 2 years ago
```

This setup should trigger: negative PR Balance, draining principal warning, balance hint, underfunded CapEx warning, red Required stat, and low progress bars.

---

## Checklist Summary

| # | Test | Status |
|---|------|--------|
| **A1** | Set Initial Principal | ☐ |
| **A2** | Adjust Return Rate | ☐ |
| **A3** | Change Fund Start Date | ☐ |
| **A4** | Add CapEx Expense | ☐ |
| **A5** | Add OpEx Expense | ☐ |
| **A6** | Add Yearly OpEx | ☐ |
| **A7** | Record Procurement | ☐ |
| **A8** | Add Deposit Event | ☐ |
| **A9** | Add Rate Change Event | ☐ |
| **A10** | Edit Expense | ☐ |
| **A11** | Edit Event | ☐ |
| **A12** | Delete Expense | ☐ |
| **A13** | Delete Event | ☐ |
| **B1** | Compound Growth Verification | ☐ |
| **B2** | OpEx Deduction from Gains | ☐ |
| **B3** | CapEx Allocation Proportional Split | ☐ |
| **B4** | OpEx Priority Over CapEx | ☐ |
| **B5** | Redistribute Surplus Toggle | ☐ |
| **B6** | Required Principal Calculation | ☐ |
| **C1** | OpEx Backdating Fix | ☐ |
| **C2** | OpEx Backdating Edge Case | ☐ |
| **C3** | Allocation Uses Effective Base | ☐ |
| **C4** | Multiple Outflows Reduce Base | ☐ |
| **D1** | Projection Chart Display | ☐ |
| **D2** | Chart Timeline Interaction | ☐ |
| **D3** | Event Markers on Chart | ☐ |
| **D4** | Breakdown Chart | ☐ |
| **D5** | Zero Line Plugin | ☐ |
| **E1** | Monte Carlo Bands Appear | ☐ |
| **E2** | MC Bands Respond to Changes | ☐ |
| **E3** | MC Bands Only in Projection | ☐ |
| **E4** | MC Tooltip Filtering | ☐ |
| **F1** | Balance Hint Warning | ☐ |
| **F2** | Required Principal Tooltip | ☐ |
| **F3** | CapEx SEK Accumulated | ☐ |
| **F4** | Required Color Coding | ☐ |
| **F5** | Rate Warning Above 10% | ☐ |
| **F6** | OpEx Opportunity Cost | ☐ |
| **F7** | Redistribute Tooltip | ☐ |
| **F8** | Underfunded CapEx Warning | ☐ |
| **F9** | Procurement Funding Warning | ☐ |
| **F10** | Future Event Dimming | ☐ |
| **F11** | Monthly Gain Display | ☐ |
| **G1** | Priority Queue | ☐ |
| **G2** | Priority Queue Empty State | ☐ |
| **G3** | Cash Flow Ledger | ☐ |
| **G4** | Cash Flow Gain Estimates | ☐ |
| **H1** | Export Data | ☐ |
| **H2** | Import Data | ☐ |
| **H3** | Copy to Clipboard | ☐ |
| **H4** | Data Persistence | ☐ |
| **H5** | Reset All Data | ☐ |
| **I1** | Zero Principal | ☐ |
| **I2** | Zero Rate | ☐ |
| **I3** | No Expenses | ☐ |
| **I4** | Many Expenses | ☐ |
| **I5** | Future Start Date | ☐ |
| **I6** | Very Long Projection | ☐ |
| **I7** | Large Numbers | ☐ |
| **I8** | Rapid Settings Changes | ☐ |
| **I9** | Filter Tabs | ☐ |
| **I10** | Edit Procurement Event | ☐ |
| **J1** | Mobile/Narrow Viewport | ☐ |
| **J2** | Cross-Browser | ☐ |

**Total: 52 test scenarios across 10 groups**
