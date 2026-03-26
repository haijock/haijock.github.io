const App = {
    data: {
        settings: {
            principal: 135000,
            annualReturnRate: 0.07,
            accountType: 'isk',
            taxRate: 0.30,
            fundStartDate: new Date().toISOString().split('T')[0]
        },
        expenses: []
    },
    token: null,
    owner: null,
    repo: null,
    fileSha: null,
    timelineYear: 0,
    animationInterval: null,
    editingExpenseId: null,

    init() {
        this.loadTokenFromStorage();
        this.bindEvents();
        this.setDefaultDate();
        this.render();
    },

    loadTokenFromStorage() {
        const stored = localStorage.getItem('selffund_token');
        if (stored) {
            this.token = stored;
            this.updateAuthStatus('Token loaded', 'success');
        }
        this.owner = localStorage.getItem('selffund_owner');
        this.repo = localStorage.getItem('selffund_repo');
        if (this.owner) document.getElementById('githubOwner').value = this.owner;
        if (this.repo) document.getElementById('githubRepo').value = this.repo;
    },

    setDefaultDate() {
        const today = new Date().toISOString().split('T')[0];
        document.getElementById('fundStartDate').value = this.data.settings.fundStartDate || today;
    },

    bindEvents() {
        document.getElementById('principal').addEventListener('input', (e) => {
            this.data.settings.principal = parseFloat(e.target.value) || 0;
            this.render();
        });

        document.getElementById('returnRate').addEventListener('input', (e) => {
            this.data.settings.annualReturnRate = e.target.value / 100;
            document.getElementById('returnRateValue').textContent = e.target.value + '%';
            this.render();
        });

        document.getElementById('accountType').addEventListener('change', (e) => {
            this.data.settings.accountType = e.target.value;
            this.render();
        });

        document.getElementById('fundStartDate').addEventListener('change', (e) => {
            this.data.settings.fundStartDate = e.target.value;
            this.render();
        });

        document.getElementById('menuBtn').addEventListener('click', () => this.openSettings());
        document.getElementById('settingsBtn').addEventListener('click', () => this.openSettings());
        document.getElementById('closeSettingsBtn').addEventListener('click', () => this.closeSettings());

        document.getElementById('addExpenseBtn').addEventListener('click', () => this.openExpenseModal());
        document.getElementById('closeExpenseBtn').addEventListener('click', () => this.closeExpenseModal());
        document.getElementById('cancelExpense').addEventListener('click', () => this.closeExpenseModal());
        document.getElementById('saveExpense').addEventListener('click', () => this.saveExpense());

        document.getElementById('closeRenewalBtn').addEventListener('click', () => this.closeRenewalModal());
        document.getElementById('saveRenewal').addEventListener('click', () => this.saveRenewal());

        document.querySelectorAll('input[name="expenseType"]').forEach(radio => {
            radio.addEventListener('change', (e) => this.toggleExpenseType(e.target.value));
        });

        document.getElementById('authSave').addEventListener('click', () => this.saveToken());
        document.getElementById('loadData').addEventListener('click', () => this.loadFromGitHub());
        document.getElementById('saveToGithub').addEventListener('click', () => this.saveToGitHub());
        document.getElementById('resetData').addEventListener('click', () => this.resetData());
        document.getElementById('exportData').addEventListener('click', () => this.exportData());
        document.getElementById('exportDebug').addEventListener('click', () => this.exportDebug());
        document.getElementById('importData').addEventListener('click', () => document.getElementById('fileInput').click());
        document.getElementById('fileInput').addEventListener('change', (e) => this.importData(e));

        document.getElementById('playBtn').addEventListener('click', () => this.playTimeline());
        document.getElementById('resetTimelineBtn').addEventListener('click', () => this.resetTimeline());
    },

    calculateAnnualCosts() {
        return this.data.expenses
            .filter(e => e.type === 'capex' || (e.type === 'opex' && !e.cancelledDate))
            .map(e => {
                let annualCost;
                if (e.type === 'capex') {
                    annualCost = e.cost / e.interval;
                } else {
                    annualCost = e.billingCycle === 'yearly' ? e.cost : e.cost * 12;
                }
                return { ...e, annualCost };
            });
    },

    calculateTotalAnnualCost() {
        return this.calculateAnnualCosts().reduce((sum, e) => sum + e.annualCost, 0);
    },

    calculateAllocation(expense) {
        const totalAnnualCost = this.calculateTotalAnnualCost();
        if (totalAnnualCost === 0) return 0;
        
        const annualGains = this.data.settings.principal * this.data.settings.annualReturnRate;
        
        let expenseAnnualCost;
        if (expense.type === 'capex') {
            expenseAnnualCost = expense.cost / expense.interval;
        } else {
            expenseAnnualCost = expense.billingCycle === 'yearly' ? expense.cost : expense.cost * 12;
        }
        
        const proportion = expenseAnnualCost / totalAnnualCost;
        return annualGains * proportion;
    },

    calculateExpenseRequiredPrincipal(expense) {
        const r = this.data.settings.annualReturnRate;
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
        
        if (this.data.settings.accountType === 'traditional') {
            principal = principal / (1 - this.data.settings.taxRate);
        }
        
        return Math.round(principal);
    },
    
    /**
     * Calculate allocation for a given expense with custom parameters (for scenario planning)
     */
    calculateAllocationWithParameters(expense, principal, annualReturnRate, taxRate, accountType) {
        const r = annualReturnRate;
        const totalAnnualCost = this.calculateTotalAnnualCostWithParameters(expense, principal, annualReturnRate, taxRate, accountType);
        if (totalAnnualCost === 0) return 0;
        
        let expenseAnnualCost;
        if (expense.type === 'capex') {
            expenseAnnualCost = expense.cost / expense.interval;
        } else {
            expenseAnnualCost = expense.billingCycle === 'yearly' ? expense.cost : expense.cost * 12;
        }
        
        const proportion = expenseAnnualCost / totalAnnualCost;
        const annualGains = principal * r;
        return annualGains * proportion;
    },
    
    /**
     * Calculate total annual cost with custom parameters (for scenario planning)
     */
    calculateTotalAnnualCostWithParameters(expense, principal, annualReturnRate, taxRate, accountType) {
        // Temporarily override settings for calculation
        const originalSettings = {...this.data.settings};
        this.data.settings.principal = principal;
        this.data.settings.annualReturnRate = annualReturnRate;
        this.data.settings.taxRate = taxRate;
        this.data.settings.accountType = accountType;
        
        const total = this.calculateTotalAnnualCost();
        
        // Restore original settings
        this.data.settings = originalSettings;
        return total;
    },
    
    /**
     * Calculate scenario projection for what-if analysis
     */
    calculateScenarioProjection(principal, annualReturnRate, taxRate, accountType, years) {
        const annualGains = principal * annualReturnRate;
        const totalAnnualCost = this.calculateTotalAnnualCost(); // Uses current settings
        
        if (totalAnnualCost === 0) {
            return {
                yearsUntilSelfFunding: 0,
                annualShortfall: 0,
                cumulativeSurplus: 0
            };
        }
        
        const annualShortfall = totalAnnualCost - annualGains;
        const yearsUntilSelfFunding = annualShortfall > 0 ? 
            (this.calculateTotalRequiredWithParameters(principal, annualReturnRate, taxRate, accountType) - principal) / annualGains : 0;
        const cumulativeSurplus = Math.max(0, -annualShortfall * years);
        
        return {
            yearsUntilSelfFunding: Math.max(0, yearsUntilSelfFunding),
            annualShortfall,
            cumulativeSurplus
        };
    },
    
    /**
     * Calculate total required principal with custom parameters
     */
    calculateTotalRequiredWithParameters(principal, annualReturnRate, taxRate, accountType) {
        // Temporarily override settings for calculation
        const originalSettings = {...this.data.settings};
        this.data.settings.principal = principal;
        this.data.settings.annualReturnRate = annualReturnRate;
        this.data.settings.taxRate = taxRate;
        this.data.settings.accountType = accountType;
        
        const total = this.calculateTotalRequired();
        
        // Restore original settings
        this.data.settings = originalSettings;
        return total;
    },
     
      calculateScheduledNextProcurementDate(expense) {
          if (expense.type === 'opex') {
              return null;
          }
          
          const lastDate = expense.lastProcurementDate 
              ? new Date(expense.lastProcurementDate)
              : new Date(this.data.settings.fundStartDate);
          
          const nextDate = new Date(lastDate.getTime() + (expense.interval * 365.25 * 24 * 60 * 60 * 1000));
          return nextDate.toISOString().split('T')[0];
      },

      calculateNextProcurementDate(expense) {
          if (expense.type === 'opex') {
              return null;
          }
          
          const allocationPerYear = this.calculateAllocation(expense);
          if (allocationPerYear <= 0) {
              return null;
          }
          
          const annualGains = this.data.settings.principal * this.data.settings.annualReturnRate;
          if (annualGains <= 0) {
              return null;
          }
          
          const neededForNextProcurement = expense.cost;
          
          // Use the later of: last procurement date OR fund start date
          // because you can't accumulate before the fund existed
          const lastProcurementDate = expense.lastProcurementDate 
              ? new Date(expense.lastProcurementDate)
              : new Date(this.data.settings.fundStartDate);
          const fundStartDate = new Date(this.data.settings.fundStartDate);
          
          const startDate = lastProcurementDate > fundStartDate ? lastProcurementDate : fundStartDate;
          
          // Calculate how much has been accumulated since the relevant start date
          const yearsSinceStart = this.yearDiff(startDate, new Date());
          const accumulatedSinceStart = allocationPerYear * yearsSinceStart;
          
          const stillNeeded = neededForNextProcurement - accumulatedSinceStart;
          
          // If we've already accumulated enough, the next procurement can happen at the scheduled time
          if (stillNeeded <= 0) {
              // Return scheduled date - but only if we're within the cycle
              const scheduledDate = this.calculateScheduledNextProcurementDate(expense);
              if (scheduledDate) {
                  return scheduledDate;
              }
          }
          
          // Otherwise, calculate when we'll have enough (from today)
          const yearsUntilNext = stillNeeded / allocationPerYear;
          const nextDate = new Date(new Date().getTime() + (yearsUntilNext * 365.25 * 24 * 60 * 60 * 1000));
          
          return nextDate.toISOString().split('T')[0];
      },
     
     calculateYearsSinceLastProcurement(expense) {
         if (expense.type === 'opex') {
             // For OpEx, we consider it continuously renewed
             return 0;
         }
         
         const lastDate = expense.lastProcurementDate 
             ? new Date(expense.lastProcurementDate)
             : new Date(this.data.settings.fundStartDate);
         
         return this.yearDiff(lastDate, new Date());
     },

    calculateProjection(expense, years) {
        const allocationPerYear = this.calculateAllocation(expense);
        
        if (expense.type === 'opex') {
            if (expense.cancelledDate) {
                const cancelYear = this.yearDiff(expense.startDate, expense.cancelledDate);
                if (years <= cancelYear) {
                    return allocationPerYear * years;
                }
                return allocationPerYear * cancelYear;
            }
            return allocationPerYear * years;
        }

        const startDate = expense.lastRenewalDate || this.data.settings.fundStartDate;
        const yearsSinceRenewal = this.yearDiff(startDate, this.data.settings.fundStartDate) + years;
        
        const cyclePosition = yearsSinceRenewal % expense.interval;
        return allocationPerYear * cyclePosition;
    },

    yearDiff(start, end) {
        const startDate = new Date(start);
        const endDate = new Date(end);
        return (endDate - startDate) / (365.25 * 24 * 60 * 60 * 1000);
    },

    daysUntil(dateString) {
        if (!dateString) return 0;
        const target = new Date(dateString);
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        target.setHours(0, 0, 0, 0);
        return Math.ceil((target - today) / (24 * 60 * 60 * 1000));
    },

    // Helper function for scenario planning calculations
    calculateAllocationForExpense(expense, settings) {
        const totalAnnualCost = this.calculateTotalAnnualCostForSettings(settings);
        if (totalAnnualCost === 0) return 0;
        
        let expenseAnnualCost;
        if (expense.type === 'capex') {
            expenseAnnualCost = expense.cost / expense.interval;
        } else {
            expenseAnnualCost = expense.billingCycle === 'yearly' ? expense.cost : expense.cost * 12;
        }
        
        const proportion = expenseAnnualCost / totalAnnualCost;
        const annualGains = settings.principal * settings.annualReturnRate;
        return annualGains * proportion;
    },

    // Helper function for scenario planning calculations
    calculateTotalAnnualCostForSettings(settings) {
        return settings.expenses
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
    },

    getMaxInterval() {
        const maxCapex = Math.max(...this.data.expenses.filter(e => e.type === 'capex').map(e => e.interval || 0), 10);
        return maxCapex;
    },

    calculateTotalRequired() {
        return this.calculateAnnualCosts().reduce((sum, e) => {
            let principal;
            if (e.type === 'capex') {
                principal = e.cost / (Math.pow(1 + this.data.settings.annualReturnRate, e.interval) - 1);
            } else {
                principal = e.billingCycle === 'yearly' ? e.cost / this.data.settings.annualReturnRate : (e.cost * 12) / this.data.settings.annualReturnRate;
            }
            if (this.data.settings.accountType === 'traditional') {
                principal = principal / (1 - this.data.settings.taxRate);
            }
            return sum + Math.round(principal);
        }, 0);
    },

    isPrincipalSufficient() {
        const totalRequired = this.calculateTotalRequired();
        return this.data.settings.principal >= totalRequired;
    },

    render() {
        const total = this.calculateTotalRequired();
        const totalEl = document.getElementById('totalRequired');
        totalEl.textContent = this.formatNumber(total) + ' SEK';
        
        const labelEl = document.getElementById('totalLabel');
        if (this.isPrincipalSufficient()) {
            labelEl.textContent = 'Portfolio Sufficient';
            labelEl.style.color = 'var(--success)';
            totalEl.style.color = 'var(--success)';
        } else {
            labelEl.textContent = 'Portfolio Insufficient';
            labelEl.style.color = 'var(--danger)';
            totalEl.style.color = 'var(--danger)';
        }
        
        this.renderExpenseSummary();
        this.renderExpenses();
        this.renderTimeline();
    },

    renderExpenseSummary() {
        const capexExpenses = this.data.expenses.filter(e => e.type === 'capex');
        const opexExpenses = this.data.expenses.filter(e => e.type === 'opex' && !e.cancelledDate);
        
        const capexAnnual = capexExpenses.reduce((sum, e) => sum + (e.cost / e.interval), 0);
        const opexAnnual = opexExpenses.reduce((sum, e) => sum + (e.billingCycle === 'yearly' ? e.cost : e.cost * 12), 0);
        
        const summaryEl = document.getElementById('expenseSummary');
        if (!summaryEl) return;
        
        summaryEl.innerHTML = `
            <div class="summary-item">
                <span class="summary-label">CapEx</span>
                <span class="summary-value">${this.formatNumber(Math.round(capexAnnual))} SEK/yr</span>
            </div>
            <div class="summary-item">
                <span class="summary-label">OpEx</span>
                <span class="summary-value">${this.formatNumber(Math.round(opexAnnual))} SEK/yr</span>
            </div>
        `;
    },

    renderExpenses() {
        const container = document.getElementById('expensesList');
        
        if (this.data.expenses.length === 0) {
            container.innerHTML = '<p class="empty-state">No expenses added. Click "+ Add" to get started.</p>';
            return;
        }

        const totalAnnualCost = this.calculateTotalAnnualCost();

        container.innerHTML = this.data.expenses.map(expense => {
            const allocation = this.calculateAllocation(expense);
            const isOpEx = expense.type === 'opex';
            const isCancelled = expense.cancelledDate;
            
             let costDisplay, intervalDisplay, progressPercent, status, statusClass;
             let procurementInfo = '';
             let daysUntilNext = '';
             
              if (isOpEx) {
                  costDisplay = `${this.formatNumber(expense.cost)} SEK/${expense.billingCycle === 'yearly' ? 'yr' : 'mo'}`;
                  intervalDisplay = isCancelled ? `Cancelled ${expense.cancelledDate}` : 'Recurring';
                  
                  if (isCancelled) {
                      progressPercent = 0;
                      status = 'Cancelled';
                      statusClass = '';
                  } else {
                      progressPercent = 100;
                      status = 'Active';
                      statusClass = '';
                  }
                  
                  procurementInfo = `${expense.billingCycle === 'yearly' ? 'Yearly' : 'Monthly'} billing`;
              } else {
                  costDisplay = `${this.formatNumber(expense.cost)} SEK`;
                  intervalDisplay = `${expense.interval} years`;
                  
                  const yearsSinceRenewal = expense.lastProcurementDate 
                      ? this.yearDiff(expense.lastProcurementDate, new Date())
                      : this.yearDiff(this.data.settings.fundStartDate, new Date());
                  const cyclePosition = yearsSinceRenewal % expense.interval;
                  progressPercent = (cyclePosition / expense.interval) * 100;
                  
                  const lastProcurementDate = expense.lastProcurementDate 
                      ? expense.lastProcurementDate 
                      : this.data.settings.fundStartDate;
                  const scheduledNextDate = this.calculateScheduledNextProcurementDate(expense);
                  const projectedNextDate = this.calculateNextProcurementDate(expense);
                  
                  // Determine status based on both cycle position AND funding adequacy
                  status = '';
                  statusClass = '';
                  
                  if (projectedNextDate && scheduledNextDate) {
                      const scheduledDate = new Date(scheduledNextDate);
                      const projectedDate = new Date(projectedNextDate);
                      const daysDifference = Math.floor((projectedDate - scheduledDate) / (1000 * 60 * 60 * 24));
                      
                      // Also check if the expense is actually affordable with current portfolio
                      const requiredPrincipal = this.calculateExpenseRequiredPrincipal(expense);
                      const isAffordable = this.data.settings.principal >= requiredPrincipal;
                      
                      if (!isAffordable) {
                          status = 'At Risk';
                          statusClass = 'at-risk';
                      } else if (daysDifference > 90) {
                          status = 'At Risk';
                          statusClass = 'at-risk';
                      } else if (daysDifference > 0) {
                          status = 'Tight';
                          statusClass = 'tight';
                      } else {
                          // Projected date is on or before scheduled - On Track
                          status = 'On Track';
                          statusClass = '';
                      }
                  } else if (progressPercent < 50) {
                      status = 'On Track';
                      statusClass = '';
                  } else if (progressPercent < 80) {
                      status = 'Tight';
                      statusClass = 'tight';
                  } else {
                      status = 'At Risk';
                      statusClass = 'at-risk';
                  }
                  
                  const yearsSinceLast = this.calculateYearsSinceLastProcurement(expense);
                  
                  // Format dates for display
                  const formattedLast = this.formatDate(lastProcurementDate);
                  const formattedScheduled = this.formatDate(scheduledNextDate);
                  const formattedProjected = this.formatDate(projectedNextDate);
                  
                  procurementInfo = `
                    <div class="procurement-info-row">
                      <span class="label">Last:</span> <span class="value">${formattedLast} (${yearsSinceLast.toFixed(1)} yrs)</span>
                    </div>
                    <div class="procurement-info-row">
                      <span class="label">Scheduled:</span> <span class="value">${formattedScheduled}</span>
                    </div>
                    <div class="procurement-info-row projected">
                      <span class="label">Projected:</span> <span class="value">${formattedProjected || 'N/A'}</span>
                    </div>
                  `;
                  
                  // Add days until next procurement with urgency styling
                  if (scheduledNextDate) {
                      const daysUntil = this.daysUntil(scheduledNextDate);
                      let urgencyClass = 'days-normal';
                      let urgencyText = '';
                      
                      if (daysUntil < 0) {
                          urgencyClass = 'days-overdue';
                          urgencyText = `Overdue by ${Math.abs(daysUntil)} days`;
                      } else if (daysUntil < 30) {
                          urgencyClass = 'days-urgent';
                          urgencyText = `${daysUntil} days`;
                      } else if (daysUntil < 90) {
                          urgencyClass = 'days-warning';
                          urgencyText = `${daysUntil} days`;
                      } else {
                          urgencyClass = 'days-normal';
                          urgencyText = `${daysUntil} days`;
                      }
                      
                      daysUntilNext = `<div class="days-until-badge ${urgencyClass}" title="${urgencyText}">${urgencyText} until next</div>`;
                  }
              }
              
              const requiredPrincipal = this.calculateExpenseRequiredPrincipal(expense);
  
              return `
                 <div class="expense-card ${statusClass}">
                     <div class="expense-main">
                         <div class="expense-name">
                             ${this.escapeHtml(expense.name)}
                             <span class="expense-type ${expense.type}">${isOpEx ? 'Sub' : 'CapEx'}</span>
                         </div>
                         <div class="expense-meta">
                             <span>${costDisplay}</span>
                             <span>${intervalDisplay}</span>
                             <span class="required-principal">Portfolio: ${this.formatNumber(requiredPrincipal)} SEK</span>
                         </div>
                         <div class="expense-procurement-info">
                             ${procurementInfo}
                         </div>
                         ${daysUntilNext}
                         <div class="expense-progress">
                             <div class="progress-bar">
                                 <div class="progress-fill ${statusClass}" style="width: ${Math.min(progressPercent, 100)}%"></div>
                             </div>
                             <span class="progress-text">${this.formatNumber(Math.round(allocation))} SEK/yr</span>
                         </div>
                         <div class="allocation-amount">
                             Allocation: ${this.formatNumber(Math.round(allocation))} SEK/yr
                             (${this.data.settings.principal * this.data.settings.annualReturnRate > 0 ? Math.round(allocation * 100 / (this.data.settings.principal * this.data.settings.annualReturnRate)) : 0}% of gains)
                         </div>
                         <span class="expense-status ${statusClass}">${status}</span>
                     </div>
                     <div class="expense-actions">
                         ${!isOpEx ? `<button class="renew-btn" onclick="App.openRenewalModal('${expense.id}')">Renew</button>` : ''}
                         ${isOpEx && !isCancelled ? `<button class="cancel-btn" onclick="App.cancelSubscription('${expense.id}')">Cancel</button>` : ''}
                         <button onclick="App.editExpense('${expense.id}')">Edit</button>
                         <button onclick="App.deleteExpense('${expense.id}')">Delete</button>
                     </div>
                 </div>
             `;
        }).join('');
    },

    renderTimeline() {
        const container = document.getElementById('timelineChart');
        const legend = document.getElementById('timelineLegend');
        
        container.innerHTML = '';
        
        if (this.data.expenses.length === 0) {
            legend.innerHTML = '';
            return;
        }
        
        const maxYears = this.getMaxInterval();
        const expenses = this.data.expenses.filter(e => e.type === 'capex' || (e.type === 'opex' && !e.cancelledDate));
        
        if (expenses.length === 0) {
            legend.innerHTML = '';
            return;
        }
        
        const maxValue = Math.max(...expenses.map(e => this.calculateAllocation(e) * maxYears), 1);
        
        const colors = ['#2563eb', '#16a34a', '#f59e0b', '#dc2626', '#8b5cf6', '#06b6d4'];
        const expenseColors = {};
        expenses.forEach((e, i) => expenseColors[e.id] = colors[i % colors.length]);
        
        const margin = { top: 20, right: 20, bottom: 50, left: 50 };
        const width = container.clientWidth || 600;
        const height = 200;
        const innerWidth = width - margin.left - margin.right;
        const innerHeight = height - margin.top - margin.bottom;
        
        const svg = d3.select(container)
            .append('svg')
            .attr('width', width)
            .attr('height', height)
            .style('cursor', 'pointer');
        
        const g = svg.append('g')
            .attr('transform', `translate(${margin.left},${margin.top})`);
        
        const fundStart = new Date(this.data.settings.fundStartDate);
        
        const xScale = d3.scaleLinear()
            .domain([0, maxYears])
            .range([0, innerWidth]);
        
        const xAxis = d3.axisBottom(xScale).ticks(Math.min(maxYears, 10)).tickFormat(tick => {
            const date = new Date(fundStart.getTime() + (tick * 365.25 * 24 * 60 * 60 * 1000));
            return date.getFullYear();
        });
        
        g.append('g')
            .attr('transform', `translate(0,${innerHeight})`)
            .call(xAxis)
            .selectAll('text')
            .style('font-size', '0.7rem')
            .style('fill', '#64748b');
        
        const yScale = d3.scaleLinear()
            .domain([0, maxValue])
            .range([innerHeight, 0]);
        
        g.append('g')
            .call(d3.axisLeft(yScale).ticks(5).tickFormat(d => this.formatNumber(Math.round(d))))
            .selectAll('text')
            .style('font-size', '0.7rem')
            .style('fill', '#64748b');
        
        // Add today marker
        const today = new Date();
        const yearsSinceStart = this.yearDiff(fundStart, today);
        if (yearsSinceStart > 0 && yearsSinceStart <= maxYears) {
            g.append('line')
                .attr('x1', xScale(yearsSinceStart))
                .attr('x2', xScale(yearsSinceStart))
                .attr('y1', 0)
                .attr('y2', innerHeight)
                .attr('stroke', '#dc2626')
                .attr('stroke-width', 1)
                .attr('stroke-dasharray', '4,4')
                .attr('class', 'today-marker');
            
            g.append('text')
                .attr('x', xScale(yearsSinceStart))
                .attr('y', -5)
                .attr('text-anchor', 'middle')
                .attr('font-size', '0.65rem')
                .attr('fill', '#dc2626')
                .text('Today');
        }
        
        // Add expense lines and interactive points
        expenses.forEach(expense => {
            const allocation = this.calculateAllocation(expense);
            const color = expenseColors[expense.id];
            
            if (expense.type === 'opex' && !expense.cancelledDate) {
                const y = yScale(allocation);
                const opexRect = g.append('rect')
                    .attr('x', 0)
                    .attr('y', y)
                    .attr('width', innerWidth)
                    .attr('height', innerHeight - y)
                    .attr('fill', 'rgba(245, 158, 11, 0.1)')
                    .attr('class', 'opex-area');
                
                const opexLine = g.append('line')
                    .attr('x1', 0)
                    .attr('x2', innerWidth)
                    .attr('y1', y)
                    .attr('y2', y)
                    .attr('stroke', '#f59e0b')
                    .attr('stroke-width', 2)
                    .attr('class', 'opex-line');
                
                // Add tooltip for OpEx
                opexRect.on('mouseover', function() {
                        d3.select(this).attr('fill', 'rgba(245, 158, 11, 0.2)');
                        showTooltip(event, `${expense.name}: ${allocation.toFixed(0)} SEK/year allocated`);
                    })
                    .on('mouseout', function() {
                        d3.select(this).attr('fill', 'rgba(245, 158, 11, 0.1)');
                        hideTooltip();
                    });
                
                opexLine.on('mouseover', function() {
                        d3.select(this).attr('stroke-width', 3);
                        showTooltip(event, `${expense.name}: ${allocation.toFixed(0)} SEK/year allocated`);
                    })
                    .on('mouseout', function() {
                        d3.select(this).attr('stroke-width', 2);
                        hideTooltip();
                    });
                
            } else if (expense.type === 'capex') {
                const interval = expense.interval;
                const points = [];
                
                for (let year = 0; year <= maxYears; year += 0.1) {
                    const cyclePos = year % interval;
                    const value = allocation * cyclePos;
                    points.push([xScale(year), yScale(value)]);
                }
                
                const line = d3.line()
                    .x(d => d[0])
                    .y(d => d[1]);
                
                const expensePath = g.append('path')
                    .datum(points)
                    .attr('fill', 'none')
                    .attr('stroke', color)
                    .attr('stroke-width', 2)
                    .attr('d', line)
                    .attr('class', 'capex-line');
                
                // Add tooltip for CapEx line
                expensePath.on('mouseover', function() {
                        d3.select(this).attr('stroke-width', 3);
                        showTooltip(event, `${expense.name}: ${allocation.toFixed(0)} SEK/year allocated`);
                    })
                    .on('mouseout', function() {
                        d3.select(this).attr('stroke-width', 2);
                        hideTooltip();
                    });
                
                // Add renewal points with interactivity
                for (let r = interval; r <= maxYears; r += interval) {
                    const renewalDate = new Date(fundStart.getTime() + (r * 365.25 * 24 * 60 * 60 * 1000));
                    
                    const circle = g.append('circle')
                        .attr('cx', xScale(r))
                        .attr('cy', yScale(allocation * interval))
                        .attr('r', 6)
                        .attr('fill', color)
                        .attr('stroke', 'white')
                        .attr('stroke-width', 2)
                        .attr('class', 'renewal-point')
                        .on('mouseover', function() {
                            d3.select(this).attr('r', 8);
                            showTooltip(event, `${expense.name}: Renewal on ${renewalDate.toLocaleDateString('sv-SE')}`);
                        })
                        .on('mouseout', function() {
                            d3.select(this).attr('r', 6);
                            hideTooltip();
                        })
                        .on('click', function() {
                            // Allow editing renewal date
                            const newDate = prompt(`Enter new renewal date for ${expense.name} (YYYY-MM-DD):`, renewalDate.toISOString().split('T')[0]);
                            if (newDate) {
                                expense.lastProcurementDate = newDate;
                                expense.lastRenewalDate = newDate;
                                if (!expense.renewals) expense.renewals = [];
                                expense.renewals.push({ date: newDate, cost: expense.cost });
                                App.render();
                            }
                        });
                    
                    // Add date label below point
                    g.append('text')
                        .attr('x', xScale(r))
                        .attr('y', yScale(allocation * interval) - 10)
                        .attr('text-anchor', 'middle')
                        .attr('font-size', '0.65rem')
                        .attr('fill', '#64748b')
                        .text(renewalDate.toLocaleDateString('sv-SE', { year: '2-digit', month: 'short' }));
                }
            }
        });
        
        // Tooltip functions
        function showTooltip(event, content) {
            const tooltip = d3.select('body')
                .append('div')
                .attr('class', 'timeline-tooltip')
                .style('position', 'absolute')
                .style('padding', '4px 8px')
                .style('background', 'rgba(0, 0, 0, 0.8)')
                .style('color', 'white')
                .style('border-radius', '4px')
                .style('font-size', '0.75rem')
                .style('pointer-events', 'none')
                .style('z-index', '1000');
            
            tooltip.html(content)
                .style('left', (event.pageX + 10) + 'px')
                .style('top', (event.pageY - 28) + 'px');
        }
        
        function hideTooltip() {
            d3.select('.timeline-tooltip').remove();
        }
        
        legend.innerHTML = expenses.map(e => `
            <div class="legend-item">
                <div class="legend-color" style="background: ${expenseColors[e.id]}"></div>
                <span>${this.escapeHtml(e.name)}</span>
            </div>
        `).join('');
    },

    generateSawtoothPath(expense, maxYears, maxAllocation) {
        const allocation = this.calculateAllocation(expense);
        const interval = expense.interval;
        const points = [];
        const width = 100;
        const height = 100;
        const startYears = expense.lastRenewalDate 
            ? Math.max(0, this.yearDiff(expense.lastRenewalDate, this.data.settings.fundStartDate))
            : 0;

        points.push(`M 0 ${height}`);

        for (let year = 0; year <= maxYears; year++) {
            const x = (year / maxYears) * width;
            const y = height - ((allocation * year) / maxAllocation) * height;
            
            if (year === 0) {
                points.push(`M ${x} ${y}`);
            } else {
                points.push(`L ${x} ${y}`);
            }
        }

        return points.join(' ');
    },

    openSettings() {
        document.getElementById('settingsModal').classList.add('open');
    },

    closeSettings() {
        document.getElementById('settingsModal').classList.remove('open');
    },

    openExpenseModal(expense = null) {
        this.editingExpenseId = expense ? expense.id : null;
        document.getElementById('expenseModalTitle').textContent = expense ? 'Edit Expense' : 'Add Expense';
        
        if (expense) {
            document.querySelector(`input[name="expenseType"][value="${expense.type}"]`).checked = true;
            document.getElementById('expenseName').value = expense.name;
            document.getElementById('expenseCost').value = expense.cost;
            document.getElementById('expenseInterval').value = expense.interval || '';
            
            if (expense.type === 'opex') {
                document.getElementById('billingCycleGroup').style.display = 'flex';
                document.getElementById('billingCycle').value = expense.billingCycle || 'monthly';
                document.getElementById('intervalGroup').style.display = 'none';
            }
            
            if (expense.lastRenewalDate) {
                document.getElementById('renewalDateGroup').style.display = 'flex';
                document.getElementById('lastRenewalDate').value = expense.lastRenewalDate;
            }
        } else {
            this.toggleExpenseType('capex');
        }
        
        document.getElementById('expenseModal').classList.add('open');
    },

    closeExpenseModal() {
        document.getElementById('expenseModal').classList.remove('open');
        this.editingExpenseId = null;
        document.getElementById('expenseName').value = '';
        document.getElementById('expenseCost').value = '';
        document.getElementById('expenseInterval').value = '';
        document.getElementById('renewalDateGroup').style.display = 'none';
    },

    toggleExpenseType(type) {
        if (type === 'opex') {
            document.getElementById('intervalGroup').style.display = 'none';
            document.getElementById('billingCycleGroup').style.display = 'flex';
            document.getElementById('renewalDateGroup').style.display = 'none';
        } else {
            document.getElementById('intervalGroup').style.display = 'flex';
            document.getElementById('billingCycleGroup').style.display = 'none';
            document.getElementById('renewalDateGroup').style.display = 'flex';
        }
    },

    saveExpense() {
        const type = document.querySelector('input[name="expenseType"]:checked').value;
        const name = document.getElementById('expenseName').value.trim();
        const cost = parseFloat(document.getElementById('expenseCost').value);

        if (!name || isNaN(cost) || cost <= 0) {
            alert('Please enter a name and valid cost.');
            return;
        }

        let interval, billingCycle, lastRenewalDate;

        if (type === 'opex') {
            billingCycle = document.getElementById('billingCycle').value;
            interval = 1;
            lastRenewalDate = this.data.settings.fundStartDate;
        } else {
            interval = parseFloat(document.getElementById('expenseInterval').value);
            if (isNaN(interval) || interval <= 0) {
                alert('Please enter a valid interval (years).');
                return;
            }
            lastRenewalDate = document.getElementById('lastRenewalDate').value || this.data.settings.fundStartDate;
        }

        if (this.editingExpenseId) {
            const expense = this.data.expenses.find(e => e.id === this.editingExpenseId);
            if (expense) {
                expense.name = name;
                expense.cost = cost;
                expense.interval = interval;
                expense.billingCycle = billingCycle;
                expense.lastRenewalDate = lastRenewalDate;
                expense.lastProcurementDate = lastRenewalDate;
            }
        } else {
            const expense = {
                id: this.generateId(),
                type,
                name,
                cost,
                interval,
                billingCycle,
                lastRenewalDate,
                createdAt: new Date().toISOString()
            };
            
             if (type === 'opex') {
                 expense.startDate = this.data.settings.fundStartDate;
                 expense.cancelledDate = null;
                 expense.lastProcurementDate = this.data.settings.fundStartDate;
             } else {
                 expense.renewals = [{ date: lastRenewalDate, cost }];
                 expense.lastProcurementDate = lastRenewalDate;
             }
            
            this.data.expenses.push(expense);
        }

        this.closeExpenseModal();
        this.render();
    },

    openRenewalModal(id) {
        const expense = this.data.expenses.find(e => e.id === id);
        if (!expense) return;
        
        document.getElementById('renewalExpenseName').textContent = expense.name;
        document.getElementById('renewalCost').value = expense.cost;
        document.getElementById('renewalDate').value = new Date().toISOString().split('T')[0];
        
        this.editingExpenseId = id;
        document.getElementById('renewalModal').classList.add('open');
    },

    closeRenewalModal() {
        document.getElementById('renewalModal').classList.remove('open');
        this.editingExpenseId = null;
    },

    saveRenewal() {
        const expense = this.data.expenses.find(e => e.id === this.editingExpenseId);
        if (!expense) return;
        
        const date = document.getElementById('renewalDate').value;
        const cost = parseFloat(document.getElementById('renewalCost').value);
        
        expense.lastProcurementDate = date;
        expense.lastRenewalDate = date;
        if (!isNaN(cost) && cost > 0) {
            expense.cost = cost;
        }
        
        if (!expense.renewals) expense.renewals = [];
        expense.renewals.push({ date, cost: expense.cost });
        
        this.closeRenewalModal();
        this.render();
    },

    cancelSubscription(id) {
        const expense = this.data.expenses.find(e => e.id === id);
        if (!expense) return;
        
        const date = prompt('Enter cancellation date (YYYY-MM-DD):', new Date().toISOString().split('T')[0]);
        if (!date) return;
        
        expense.cancelledDate = date;
        this.render();
    },

    editExpense(id) {
        const expense = this.data.expenses.find(e => e.id === id);
        if (expense) {
            this.openExpenseModal(expense);
        }
    },

    deleteExpense(id) {
        if (confirm('Delete this expense?')) {
            this.data.expenses = this.data.expenses.filter(e => e.id !== id);
            this.render();
        }
    },

    playTimeline() {
        if (this.animationInterval) {
            clearInterval(this.animationInterval);
            this.animationInterval = null;
            return;
        }
        
        this.timelineYear = 0;
        this.animationInterval = setInterval(() => {
            this.timelineYear++;
            if (this.timelineYear >= this.getMaxInterval()) {
                clearInterval(this.animationInterval);
                this.animationInterval = null;
            }
            this.renderTimeline();
        }, 500);
    },

    resetTimeline() {
        if (this.animationInterval) {
            clearInterval(this.animationInterval);
            this.animationInterval = null;
        }
        this.timelineYear = 0;
        this.renderTimeline();
    },

    async saveToken() {
        const token = document.getElementById('githubToken').value.trim();
        if (!token) {
            alert('Please enter a token.');
            return;
        }

        this.token = token;
        this.owner = document.getElementById('githubOwner').value.trim();
        this.repo = document.getElementById('githubRepo').value.trim();

        localStorage.setItem('selffund_token', token);
        if (this.owner) localStorage.setItem('selffund_owner', this.owner);
        if (this.repo) localStorage.setItem('selffund_repo', this.repo);

        this.updateAuthStatus('Token saved!', 'success');
    },

    updateAuthStatus(message, type) {
        const status = document.getElementById('authStatus');
        status.textContent = message;
        status.className = 'hint ' + type;
    },

    async loadFromGitHub() {
        if (!this.token || !this.owner || !this.repo) {
            alert('Please enter token, owner, and repo.');
            return;
        }

        try {
            const response = await fetch(`https://api.github.com/repos/${this.owner}/${this.repo}/contents/data.json`, {
                headers: { 'Authorization': `token ${this.token}` }
            });

            if (response.status === 404) {
                this.updateAuthStatus('No data.json yet', '');
                return;
            }

            if (!response.ok) throw new Error('Failed to load: ' + response.status);

            const fileData = await response.json();
            this.fileSha = fileData.sha;
            const content = atob(fileData.content);
            this.data = JSON.parse(content);

            document.getElementById('principal').value = this.data.settings.principal;
            document.getElementById('returnRate').value = this.data.settings.annualReturnRate * 100;
            document.getElementById('returnRateValue').textContent = (this.data.settings.annualReturnRate * 100) + '%';
            document.getElementById('accountType').value = this.data.settings.accountType;
            document.getElementById('fundStartDate').value = this.data.settings.fundStartDate;

            this.render();
            this.updateAuthStatus('Data loaded!', 'success');
        } catch (error) {
            this.updateAuthStatus('Error: ' + error.message, 'error');
        }
    },

    async saveToGitHub() {
        if (!this.token || !this.owner || !this.repo) {
            alert('Please configure GitHub connection first.');
            return;
        }

        try {
            const content = JSON.stringify(this.data, null, 2);
            const contentBase64 = btoa(content);

            const body = {
                message: 'Update data via SelfFund',
                content: contentBase64
            };

            if (this.fileSha) body.sha = this.fileSha;

            const response = await fetch(`https://api.github.com/repos/${this.owner}/${this.repo}/contents/data.json`, {
                method: 'PUT',
                headers: {
                    'Authorization': `token ${this.token}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(body)
            });

            if (!response.ok) throw new Error('Failed to save');

            const fileData = await response.json();
            this.fileSha = fileData.content.sha;
            alert('Saved successfully!');
        } catch (error) {
            alert('Error saving: ' + error.message);
        }
    },

    resetData() {
        if (confirm('Reset all data? This cannot be undone.')) {
            this.data = {
                settings: {
                    principal: 135000,
                    annualReturnRate: 0.07,
                    accountType: 'isk',
                    taxRate: 0.30,
                    fundStartDate: new Date().toISOString().split('T')[0]
                },
                expenses: []
            };
            this.fileSha = null;
            document.getElementById('principal').value = 135000;
            document.getElementById('returnRate').value = 7;
            document.getElementById('returnRateValue').textContent = '7%';
            document.getElementById('accountType').value = 'isk';
            this.setDefaultDate();
            this.render();
        }
    },

    exportData() {
        const blob = new Blob([JSON.stringify(this.data, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'selffund-data.json';
        a.click();
        URL.revokeObjectURL(url);
    },

    exportDebug() {
        const debugData = {
            settings: this.data.settings,
            expenses: this.data.expenses,
            calculations: {
                principal: this.data.settings.principal,
                annualReturnRate: this.data.settings.annualReturnRate,
                totalRequired: this.calculateTotalRequired(),
                isPrincipalSufficient: this.isPrincipalSufficient(),
                annualGains: this.data.settings.principal * this.data.settings.annualReturnRate,
                expenseAnalysis: this.data.expenses.map(expense => {
                    const allocation = this.calculateAllocation(expense);
                    const requiredPrincipal = this.calculateExpenseRequiredPrincipal(expense);
                    const scheduledNextDate = this.calculateScheduledNextProcurementDate(expense);
                    const projectedNextDate = this.calculateNextProcurementDate(expense);
                    const yearsSinceRenewal = expense.lastProcurementDate 
                        ? this.yearDiff(expense.lastProcurementDate, new Date())
                        : this.yearDiff(this.data.settings.fundStartDate, new Date());
                    const cyclePosition = yearsSinceRenewal % expense.interval;
                    const progressPercent = (cyclePosition / expense.interval) * 100;
                    
                    let daysDifference = null;
                    if (projectedNextDate && scheduledNextDate) {
                        const scheduledDate = new Date(scheduledNextDate);
                        const projectedDate = new Date(projectedNextDate);
                        daysDifference = Math.floor((projectedDate - scheduledDate) / (1000 * 60 * 60 * 24));
                    }
                    
                    return {
                        id: expense.id,
                        name: expense.name,
                        type: expense.type,
                        cost: expense.cost,
                        interval: expense.interval,
                        lastProcurementDate: expense.lastProcurementDate,
                        allocationPerYear: allocation,
                        requiredPrincipal: requiredPrincipal,
                        principalAffordable: this.data.settings.principal >= requiredPrincipal,
                        scheduledNextDate: scheduledNextDate,
                        projectedNextDate: projectedNextDate,
                        daysDifference: daysDifference,
                        yearsSinceRenewal: yearsSinceRenewal,
                        cyclePosition: cyclePosition,
                        progressPercent: progressPercent
                    };
                })
            }
        };
        
        const blob = new Blob([JSON.stringify(debugData, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'selffund-debug.json';
        a.click();
        URL.revokeObjectURL(url);
    },

    importData(event) {
        const file = event.target.files[0];
        if (!file) return;

        const reader = new FileReader();
        reader.onload = (e) => {
            try {
                const imported = JSON.parse(e.target.result);
                if (!imported.settings || !imported.expenses) throw new Error('Invalid format');
                this.data = imported;
                document.getElementById('principal').value = this.data.settings.principal;
                document.getElementById('returnRate').value = this.data.settings.annualReturnRate * 100;
                document.getElementById('returnRateValue').textContent = (this.data.settings.annualReturnRate * 100) + '%';
                document.getElementById('accountType').value = this.data.settings.accountType;
                document.getElementById('fundStartDate').value = this.data.settings.fundStartDate;
                this.render();
                alert('Data imported successfully!');
            } catch (err) {
                alert('Error importing: ' + err.message);
            }
        };
        reader.readAsText(file);
        event.target.value = '';
    },

    generateId() {
        return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
            const r = Math.random() * 16 | 0;
            const v = c === 'x' ? r : (r & 0x3 | 0x8);
            return v.toString(16);
        });
    },

      formatNumber(num) {
          return num.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
      },
     
     formatDate(dateString) {
         if (!dateString) return 'Never';
         const date = new Date(dateString);
         return date.toLocaleDateString('sv-SE'); // Swedish format: YYYY-MM-DD
     },

    escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }
};

document.addEventListener('DOMContentLoaded', () => App.init());