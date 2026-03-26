// Test scenarios for SelfFund allocation and projection calculations

// Mock data for testing
const mockData = {
  settings: {
    principal: 100000,
    annualReturnRate: 0.07,
    accountType: 'isk',
    taxRate: 0.30,
    fundStartDate: '2023-01-01'
  },
  expenses: [
    {
      id: 'exp1',
      type: 'capex',
      name: 'Car Replacement',
      cost: 20000,
      interval: 5,
      lastProcurementDate: '2023-01-01'
    },
    {
      id: 'exp2',
      type: 'opex',
      name: 'Internet Subscription',
      cost: 500,
      billingCycle: 'monthly',
      lastProcurementDate: '2023-01-01'
    }
  ]
};

// Helper functions copied from the app for testing
function yearDiff(start, end) {
  const startDate = new Date(start);
  const endDate = new Date(end);
  return (endDate - startDate) / (365.25 * 24 * 60 * 60 * 1000);
}

function calculateTotalAnnualCost(data) {
  return data.expenses
    .filter(e => e.type === 'capex' || (e.type === 'opex' && !e.cancelledDate))
    .map(e => {
      let annualCost;
      if (e.type === 'capex') {
        annualCost = e.cost / e.interval;
      } else {
        annualCost = e.billingCycle === 'yearly' ? e.cost : e.cost * 12;
      }
      return { ...e, annualCost };
    })
    .reduce((sum, e) => sum + e.annualCost, 0);
}

function calculateAllocation(data, expense) {
  const totalAnnualCost = calculateTotalAnnualCost(data);
  if (totalAnnualCost === 0) return 0;
  
  const annualGains = data.settings.principal * data.settings.annualReturnRate;
  
  let expenseAnnualCost;
  if (expense.type === 'capex') {
    expenseAnnualCost = expense.cost / expense.interval;
  } else {
    expenseAnnualCost = expense.billingCycle === 'yearly' ? expense.cost : expense.cost * 12;
  }
  
  const proportion = expenseAnnualCost / totalAnnualCost;
  return annualGains * proportion;
}

function calculateExpenseRequiredPrincipal(data, expense) {
  const r = data.settings.annualReturnRate;
  if (r <= 0) return 0;
  
  let principal;
  if (expense.type === 'capex') {
    principal = expense.cost / (Math.pow(1 + r, expense.interval) - 1);
  } else {
    if (expense.billingCycle === 'yearly') {
      principal = expense.cost / r;
    } else {
      principal = (expense.cost * 12) / r;
    }
  }
  
  if (data.settings.accountType === 'traditional') {
    principal = principal / (1 - data.settings.taxRate);
  }
  
  return Math.round(principal);
}

function calculateScheduledNextProcurementDate(data, expense) {
  if (expense.type === 'opex') {
    return null;
  }
  
  const lastDate = expense.lastProcurementDate 
      ? new Date(expense.lastProcurementDate)
      : new Date(data.settings.fundStartDate);
  
  const nextDate = new Date(lastDate.getTime() + (expense.interval * 365.25 * 24 * 60 * 60 * 1000));
  return nextDate.toISOString().split('T')[0];
}

function calculateNextProcurementDate(data, expense) {
  if (expense.type === 'opex') {
    return null;
  }
  
  const allocationPerYear = calculateAllocation(data, expense);
  if (allocationPerYear <= 0) {
    return null;
  }
  
  const annualGains = data.settings.principal * data.settings.annualReturnRate;
  if (annualGains <= 0) {
    return null;
  }
  
  const lastDate = expense.lastProcurementDate 
      ? new Date(expense.lastProcurementDate)
      : new Date(data.settings.fundStartDate);
  
  const neededForNextProcurement = expense.cost;
  const yearsSinceLast = yearDiff(lastDate, new Date());
  const accumulatedSinceLast = allocationPerYear * yearsSinceLast;
  
  const stillNeeded = neededForNextProcurement - accumulatedSinceLast;
  
  if (stillNeeded <= 0) {
    return lastDate.toISOString().split('T')[0];
  }
  
  const yearsUntilNext = stillNeeded / allocationPerYear;
  const nextDate = new Date(lastDate.getTime() + (yearsUntilNext * 365.25 * 24 * 60 * 60 * 1000));
  
  return nextDate.toISOString().split('T')[0];
}

function calculateYearsSinceLastProcurement(data, expense) {
  if (expense.type === 'opex') {
    return 0;
  }
  
  const lastDate = expense.lastProcurementDate 
      ? new Date(expense.lastProcurementDate)
      : new Date(data.settings.fundStartDate);
  
  return yearDiff(lastDate, new Date());
}

// Test cases
console.log('=== SelfFund Calculation Tests ===\n');

// Test 1: Basic allocation calculation
console.log('Test 1: Allocation Calculation');
const totalAnnualCost = calculateTotalAnnualCost(mockData);
console.log(`Total Annual Cost: ${totalAnnualCost.toFixed(2)} SEK`);

const carAllocation = calculateAllocation(mockData, mockData.expenses[0]);
console.log(`Car (CapEx) Allocation: ${carAllocation.toFixed(2)} SEK/year`);

const internetAllocation = calculateAllocation(mockData, mockData.expenses[1]);
console.log(`Internet (OpEx) Allocation: ${internetAllocation.toFixed(2)} SEK/year`);

const annualGains = mockData.settings.principal * mockData.settings.annualReturnRate;
console.log(`Annual Gains: ${annualGains.openParentheses} SEK\n`);

// Test 2: Required principal calculation
console.log('Test 2: Required Principal Calculation');
const carRequired = calculateExpenseRequiredPrincipal(mockData, mockData.expenses[0]);
console.log(`Car Required Principal: ${carRequired} SEK`);

const internetRequired = calculateExpenseRequiredPrincipal(mockData, mockData.expenses[1]);
console.log(`Internet Required Principal: ${internetRequired} SEK\n`);

// Test 3: Procurement date calculations
console.log('Test 3: Procurement Date Calculations');
const carScheduledNext = calculateScheduledNextProcurementDate(mockData, mockData.expenses[0]);
console.log(`Car Scheduled Next Procurement: ${carScheduledNext}`);

const carNextProcurement = calculateNextProcurementDate(mockData, mockData.expenses[0]);
console.log(`Car Projected Next Procurement: ${carNextProcurement}`);

const carYearsSince = calculateYearsSinceLastProcurement(mockData, mockData.expenses[0]);
console.log(`Car Years Since Last Procurement: ${carYearsSince.toFixed(2)} years\n`);

// Test 4: Edge case - zero allocation
console.log('Test 4: Edge Case - Zero Allocation');
const zeroReturnData = {...mockData};
zeroReturnData.settings.annualReturnRate = 0;
const zeroAllocation = calculateAllocation(zeroReturnData, mockData.expenses[0]);
console.log(`Allocation with 0% return: ${zeroAllocation} SEK/year`);

const zeroNextDate = calculateNextProcurementDate(zeroReturnData, mockData.expenses[0]);
console.log(`Next procurement date with 0% return: ${zeroNextDate}\n`);

// Test 5: Scenario planning - what if we increase principal?
console.log('Test 5: Scenario Planning - Increased Principal');
const scenarioData = {...mockData};
scenarioData.settings.principal = 200000; // Double the principal

const scenarioCarAllocation = calculateAllocation(scenarioData, mockData.expenses[0]);
console.log(`Car Allocation with 200k principal: ${scenarioCarAllocation.toFixed(2)} SEK/year`);
console.log(`Original allocation was: ${carAllocation.toFixed(2)} SEK/year`);
console.log(`Increase: ${(scenarioCarAllocation - carAllocation).toFixed(2)} SEK/year\n`);

console.log('=== Tests Complete ===');