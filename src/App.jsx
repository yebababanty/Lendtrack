import { useState, useEffect, useMemo, useCallback } from "react";
import { initializeApp } from "firebase/app";
import { getFirestore, doc, setDoc, onSnapshot } from "firebase/firestore";

// ─── FIREBASE ────────────────────────────────────────────────────────────────
const firebaseConfig = {
  apiKey: "AIzaSyDFl5lcskIt6QYddo6N_TcdJ3WHxHzR1EU",
  authDomain: "creda-finance.firebaseapp.com",
  projectId: "creda-finance",
  storageBucket: "creda-finance.firebasestorage.app",
  messagingSenderId: "384415520313",
  appId: "1:384415520313:web:ba4084319e0eb723889fe8"
};
const firebaseApp = initializeApp(firebaseConfig);
const db = getFirestore(firebaseApp);

async function fbSet(id, value) {
  try { await setDoc(doc(db, "creda", id), { value }); } catch (e) { console.error(e); }
}
function fbListen(id, cb) {
  return onSnapshot(doc(db, "creda", id), s => { if (s.exists()) cb(s.data().value); });
}

// ─── HOLIDAYS ────────────────────────────────────────────────────────────────
const FIXED_HOLIDAYS = ["01-01", "05-01", "06-12", "10-01", "12-25", "12-26"];
const VARIABLE_HOLIDAYS = new Set([
  "2024-03-29", "2024-04-01", "2025-04-18", "2025-04-21",
  "2025-03-30", "2025-03-31", "2026-04-03", "2026-04-06",
  "2026-03-20", "2026-03-21", "2026-05-27", "2026-05-28"
]);
function isHoliday(d) {
  return FIXED_HOLIDAYS.includes(d.slice(5)) || VARIABLE_HOLIDAYS.has(d);
}

// ─── UTILS ────────────────────────────────────────────────────────────────────
const generateId = (p = "ID") => p + Date.now().toString().slice(-6) + Math.floor(Math.random() * 100);
const fc = (a) => "₦" + Number(a || 0).toLocaleString("en-NG", { minimumFractionDigits: 2 });
const fd = (d) => d ? new Date(d).toLocaleDateString("en-NG", { day: "2-digit", month: "short", year: "numeric" }) : "—";
const fm = (ym) => {
  if (!ym) return "—";
  const [y, m] = ym.split("-");
  return new Date(y, parseInt(m) - 1, 1).toLocaleDateString("en-NG", { month: "long", year: "numeric" });
};
const todayStr = new Date().toISOString().split("T")[0];
const curMonthKey = todayStr.slice(0, 7);

function getRepayDays(start, count, excl) {
  const days = [];
  const cur = new Date(start);
  cur.setDate(cur.getDate() + 1);
  while (days.length < count) {
    const ds = cur.toISOString().split("T")[0];
    const day = cur.getDay();
    if (excl) {
      if (day !== 0 && day !== 6 && !isHoliday(ds)) days.push(ds);
    } else {
      days.push(ds);
    }
    cur.setDate(cur.getDate() + 1);
  }
  return days;
}

function calcLoanSchedule(principal, rate, days, start, excl) {
  const interest = (principal * rate) / 100;
  const total = principal + interest;
  const daily = total / days;
  const repDays = getRepayDays(start, days, excl);
  const schedule = [];
  let bal = total;
  for (let i = 0; i < days; i++) {
    bal = Math.max(0, bal - daily);
    schedule.push({
      day: i + 1,
      dueDate: repDays[i],
      payment: daily,
      balance: bal,
      paid: false,
      paidDate: null,
      paidAmount: 0,
      overpayment: 0,
      shortfall: 0,
      paymentLog: []
    });
  }
  return { dailyPayment: daily, totalRepayable: total, totalInterest: interest, schedule };
}

// ─── SMART PAYMENT ENGINE (UPDATED: Excess settles defaults first) ───────────
function applySmartPayment(schedule, startIdx, amountPaid, paidDate, paidBy) {
  let remaining = amountPaid;
  const updated = schedule.map(s => ({ ...s, paymentLog: [...(s.paymentLog || [])] }));
  const today = new Date();

  // STEP 1: Find all defaulting (overdue unpaid) slots BEFORE or AT startIdx
  const defaultSlots = [];
  for (let d = 0; d < updated.length; d++) {
    if (!updated[d].paid && new Date(updated[d].dueDate) < today && d <= startIdx) {
      const owed = updated[d].payment - (updated[d].paidAmount || 0);
      if (owed > 0) defaultSlots.push(d);
    }
  }

  // STEP 2: Settle defaults first (oldest to newest)
  for (const dIdx of defaultSlots) {
    if (remaining <= 0) break;
    const s = updated[dIdx];
    const owed = s.payment - (s.paidAmount || 0);
    const here = Math.min(remaining, owed);
    const newPaid = (s.paidAmount || 0) + here;

    updated[dIdx].paymentLog.push({
      amount: here,
      date: paidDate,
      by: paidBy || "",
      at: new Date().toISOString(),
      cascaded: dIdx !== startIdx,
      defaultSettlement: true
    });
    updated[dIdx] = {
      ...updated[dIdx],
      paid: newPaid >= s.payment,
      paidAmount: newPaid,
      paidDate: newPaid >= s.payment ? paidDate : s.paidDate,
      overpayment: 0,
      shortfall: Math.max(0, s.payment - newPaid)
    };
    remaining -= here;
  }

  // STEP 3: Pay the current slot if not already a default slot
  if (remaining > 0 && !defaultSlots.includes(startIdx)) {
    const s = updated[startIdx];
    const total = (s.paidAmount || 0) + remaining;
    const covers = Math.min(total, s.payment);
    const excess = total - s.payment;

    updated[startIdx].paymentLog.push({
      amount: remaining,
      date: paidDate,
      by: paidBy || "",
      at: new Date().toISOString()
    });
    updated[startIdx] = {
      ...updated[startIdx],
      paid: total >= s.payment,
      paidAmount: covers,
      paidDate: paidDate,
      overpayment: Math.max(0, excess),
      shortfall: Math.max(0, s.payment - total)
    };
    remaining = Math.max(0, excess);
  }

  // STEP 4: Cascade remaining excess to future unpaid slots
  let i = startIdx + 1;
  while (remaining > 0 && i < updated.length) {
    const s = updated[i];
    if (s.paid) { i++; continue; }

    const already = s.paidAmount || 0;
    const owed = s.payment - already;
    const here = Math.min(remaining, owed);
    const newPaid = already + here;

    updated[i].paymentLog.push({
      amount: here,
      date: paidDate,
      by: paidBy || "",
      at: new Date().toISOString(),
      cascaded: true
    });
    updated[i] = {
      ...updated[i],
      paid: newPaid >= s.payment,
      paidAmount: newPaid,
      paidDate: newPaid >= s.payment ? paidDate : s.paidDate,
      overpayment: 0,
      shortfall: Math.max(0, s.payment - newPaid)
    };
    remaining -= here;
    i++;
  }

  // STEP 5: Recalculate balances
  const totalDue = updated.reduce((sum, s) => sum + s.payment, 0);
  let bal = totalDue;
  for (let j = 0; j < updated.length; j++) {
    bal = Math.max(0, bal - (updated[j].paidAmount || 0));
    updated[j].balance = bal;
  }
  return updated;
}

// ─── LOAN RESTRUCTURE ENGINE ─────────────────────────────────────────────────
function restructureLoan(loan, newDailyAmount, reason, approvedBy) {
  const unpaidSlots = loan.schedule.filter(s => !s.paid);
  const totalUnpaidOwed = unpaidSlots.reduce((sum, s) => sum + (s.payment - (s.paidAmount || 0)), 0);
  const newDays = Math.ceil(totalUnpaidOwed / newDailyAmount);
  const lastPaidDate = loan.schedule.filter(s => s.paid).slice(-1)[0]?.paidDate || loan.startDate;
  const newRepayDays = getRepayDays(lastPaidDate, newDays, loan.excludeWeekends);
  const paidSlots = loan.schedule.filter(s => s.paid);
  const newSchedule = [...paidSlots];
  let bal = totalUnpaidOwed;
  for (let i = 0; i < newDays; i++) {
    bal = Math.max(0, bal - newDailyAmount);
    newSchedule.push({
      day: paidSlots.length + i + 1,
      dueDate: newRepayDays[i],
      payment: newDailyAmount,
      balance: bal,
      paid: false,
      paidDate: null,
      paidAmount: 0,
      overpayment: 0,
      shortfall: 0,
      paymentLog: [],
      restructured: true
    });
  }
  const newTotal = paidSlots.reduce((s, x) => s + x.paidAmount, 0) + totalUnpaidOwed;
  return {
    ...loan,
    schedule: newSchedule,
    days: newSchedule.length,
    dailyPayment: newDailyAmount,
    totalRepayable: newTotal,
    restructureLog: [...(loan.restructureLog || []), {
      date: todayStr,
      reason,
      approvedBy,
      newDailyAmount,
      newDays,
      totalUnpaidOwed,
      at: new Date().toISOString()
    }]
  };
}

// ─── SHORTFALL CALCULATOR ────────────────────────────────────────────────────
function computeTotalShortfall(loan) {
  const today = new Date();
  let totalShortfall = 0;
  let shortfallDays = 0;
  (loan.schedule || []).forEach(s => {
    if (!s.paid && new Date(s.dueDate) <= today) {
      const gap = s.payment - (s.paidAmount || 0);
      if (gap > 0) {
        totalShortfall += gap;
        shortfallDays++;
      }
    }
  });
  (loan.schedule || []).forEach(s => {
    if (!s.paid && s.paidAmount > 0 && s.paidAmount < s.payment) {
      const gap = s.payment - s.paidAmount;
      if (gap > 0 && new Date(s.dueDate) > today) {
        totalShortfall += gap;
        shortfallDays++;
      }
    }
  });
  return { totalShortfall, shortfallDays };
}

// ─── RISK FLAG SYSTEM ────────────────────────────────────────────────────────
function computeClientRisk(client) {
  const activeLoan = client.loans?.find(l => l.status === "active");
  if (!activeLoan) return { level: "none", label: "No Loan", color: "#3a5a70", bg: "rgba(100,130,150,0.08)", emoji: "⚪" };
  const today = new Date();
  const schedule = activeLoan.schedule || [];
  let consecutiveShortfalls = 0;
  let maxConsecutive = 0;
  let totalShortfallDays = 0;
  let latePayments = 0;
  let overdueCount = 0;

  schedule.forEach(s => {
    const due = new Date(s.dueDate);
    if (!s.paid && due < today) {
      overdueCount++;
      consecutiveShortfalls++;
      maxConsecutive = Math.max(maxConsecutive, consecutiveShortfalls);
      totalShortfallDays++;
    } else if (s.paid && s.paidDate > s.dueDate) {
      latePayments++;
      consecutiveShortfalls = 0;
    } else if (!s.paid && s.paidAmount > 0 && s.paidAmount < s.payment) {
      totalShortfallDays++;
      consecutiveShortfalls++;
      maxConsecutive = Math.max(maxConsecutive, consecutiveShortfalls);
    } else if (s.paid) {
      consecutiveShortfalls = 0;
    }
  });

  if (maxConsecutive >= 3 || overdueCount >= 3) {
    return { level: "red", label: "High Risk", color: "#ef4444", bg: "rgba(239,68,68,0.12)", emoji: "🔴" };
  } else if (maxConsecutive >= 1 || latePayments >= 2 || totalShortfallDays >= 2) {
    return { level: "amber", label: "Watch", color: "#f59e0b", bg: "rgba(245,158,11,0.12)", emoji: "🟡" };
  } else {
    return { level: "green", label: "On Track", color: "#22c55e", bg: "rgba(34,197,94,0.12)", emoji: "🟢" };
  }
}

// ─── FINANCIAL ENGINES ───────────────────────────────────────────────────────
function computeFinancials(clients) {
  let totalCapital = 0, totalExpectedInterest = 0, interestEarned = 0, principalCollected = 0, totalCollected = 0;
  clients.forEach(c => {
    (c.loans || []).forEach(l => {
      const p = l.principal || 0;
      const int = l.totalInterest || 0;
      const td = l.totalRepayable || 0;
      const iR = td > 0 ? int / td : 0;
      const pR = td > 0 ? p / td : 0;
      totalCapital += p;
      totalExpectedInterest += int;
      (l.schedule || []).forEach(s => {
        if (s.paidAmount > 0) {
          totalCollected += s.paidAmount;
          interestEarned += s.paidAmount * iR;
          principalCollected += s.paidAmount * pR;
        }
      });
    });
  });
  return {
    totalCapital, totalExpectedInterest, interestEarned, principalCollected,
    outstandingPrincipal: Math.max(0, totalCapital - principalCollected),
    trueProfit: interestEarned,
    realROI: totalCapital > 0 ? (interestEarned / totalCapital) * 100 : 0,
    collectionRate: (totalExpectedInterest + totalCapital) > 0 ? (totalCollected / (totalExpectedInterest + totalCapital)) * 100 : 0,
    totalCollected
  };
}

function computeClientFinancials(client) {
  let capital = 0, expectedInterest = 0, interestEarned = 0, principalCollected = 0, totalCollected = 0;
  (client.loans || []).forEach(l => {
    const p = l.principal || 0;
    const int = l.totalInterest || 0;
    const td = l.totalRepayable || 0;
    const iR = td > 0 ? int / td : 0;
    const pR = td > 0 ? p / td : 0;
    capital += p;
    expectedInterest += int;
    (l.schedule || []).forEach(s => {
      if (s.paidAmount > 0) {
        totalCollected += s.paidAmount;
        interestEarned += s.paidAmount * iR;
        principalCollected += s.paidAmount * pR;
      }
    });
  });
  return {
    capital, expectedInterest, interestEarned, principalCollected,
    outstandingPrincipal: Math.max(0, capital - principalCollected),
    trueProfit: interestEarned,
    realROI: capital > 0 ? (interestEarned / capital) * 100 : 0,
    totalCollected
  };
}

function computeLoanFinancials(loan) {
  const p = loan.principal || 0;
  const int = loan.totalInterest || 0;
  const td = loan.totalRepayable || 0;
  const iR = td > 0 ? int / td : 0;
  const pR = td > 0 ? p / td : 0;
  let collected = 0, intEarned = 0, prinCollected = 0;
  (loan.schedule || []).forEach(s => {
    if (s.paidAmount > 0) {
      collected += s.paidAmount;
      intEarned += s.paidAmount * iR;
      prinCollected += s.paidAmount * pR;
    }
  });
  const paidCount = (loan.schedule || []).filter(s => s.paid).length;
  const totalCount = loan.days || 1;
  const today = new Date();
  return {
    collected, interestEarned: intEarned, principalCollected: prinCollected,
    outstandingPrincipal: Math.max(0, p - prinCollected),
    trueProfit: intEarned,
    realROI: p > 0 ? (intEarned / p) * 100 : 0,
    collectionRate: td > 0 ? (collected / td) * 100 : 0,
    completionRate: (paidCount / totalCount) * 100,
    paidCount, totalCount,
    overdueCount: (loan.schedule || []).filter(s => !s.paid && new Date(s.dueDate) < today).length,
    onTimeCount: (loan.schedule || []).filter(s => s.paid && s.paidDate <= s.dueDate).length,
    lateCount: (loan.schedule || []).filter(s => s.paid && s.paidDate > s.dueDate).length,
    partialCount: (loan.schedule || []).filter(s => !s.paid && s.paidAmount > 0 && s.paidAmount < s.payment).length,
    remainingBalance: Math.max(0, td - collected)
  };
}

// UPDATED: Cleared loans excluded from expected collection
function computeMonthlyStats(clientsList, monthKey) {
  let totalDisbursed = 0, totalExpected = 0, totalCollected = 0, overdueCount = 0;
  const today = new Date();
  clientsList.forEach(c => {
    (c.loans || []).forEach(l => {
      if ((l.issuedAt || l.startDate || "").slice(0, 7) === monthKey) totalDisbursed += l.principal || 0;
      (l.schedule || []).forEach(s => {
        if ((s.dueDate || "").slice(0, 7) === monthKey) {
          // Only count non-cleared slots in expected
          if (l.status !== "completed" || !s.paid) {
            totalExpected += s.payment || 0;
          }
          if (s.paidAmount > 0) totalCollected += s.paidAmount;
          else if (new Date(s.dueDate) < today && !s.paid) overdueCount++;
        }
      });
    });
  });
  return {
    totalDisbursed, totalExpected, totalCollected,
    outstanding: totalExpected - totalCollected, overdueCount,
    totalSavings: clientsList.reduce((a, c) => a + (c.savingsBalance || 0), 0)
  };
}

// UPDATED: Monthly report with defaulting clients
function computeMonthlyReport(clients) {
  const map = {};
  const today = new Date();
  clients.forEach(c => {
    (c.loans || []).forEach(l => {
      const key = (l.issuedAt || l.startDate || "").slice(0, 7);
      if (!map[key]) map[key] = { disbursed: 0, expected: 0, collected: 0, interest: 0, loanCount: 0, clientIds: new Set(), defaultingClients: [] };
      map[key].disbursed += l.principal || 0;
      map[key].expected += l.totalRepayable || 0;
      map[key].interest += l.totalInterest || 0;
      map[key].loanCount++;
      map[key].clientIds.add(c.id);
      let hasDefault = false;
      let defaultAmount = 0;
      let defaultDays = 0;
      (l.schedule || []).forEach(s => {
        if (s.paidAmount > 0) map[key].collected += s.paidAmount;
        if (!s.paid && new Date(s.dueDate) < today && (s.dueDate || "").slice(0, 7) === key) {
          const gap = s.payment - (s.paidAmount || 0);
          if (gap > 0) {
            hasDefault = true;
            defaultAmount += gap;
            defaultDays++;
          }
        }
      });
      if (hasDefault) {
        map[key].defaultingClients.push({
          clientId: c.id,
          clientName: c.name,
          phone: c.phone,
          defaultAmount,
          defaultDays,
          loanId: l.id,
          risk: computeClientRisk(c)
        });
      }
    });
  });
  return Object.entries(map)
    .map(([month, d]) => ({ month, ...d, clientCount: d.clientIds.size, outstanding: Math.max(0, d.expected - d.collected) }))
    .sort((a, b) => b.month.localeCompare(a.month));
}

function computeStaffMonthlyReport(clients, users, monthKey) {
  const staffReports = [];
  const today = new Date();
  users.filter(u => u.role !== "admin").forEach(officer => {
    const myClients = clients.filter(c => c.assignedTo === officer.id);
    let disbursed = 0, collected = 0, expectedThisMonth = 0, overdueCount = 0, loansIssued = 0, paymentsReceived = 0;
    const activeClientIds = new Set();
    myClients.forEach(c => {
      (c.loans || []).forEach(l => {
        if ((l.issuedAt || l.startDate || "").slice(0, 7) === monthKey) { disbursed += l.principal || 0; loansIssued++; }
        (l.schedule || []).forEach(s => {
          if ((s.dueDate || "").slice(0, 7) === monthKey) {
            if (l.status !== "completed" || !s.paid) {
              expectedThisMonth += s.payment || 0;
            }
            if (s.paidAmount > 0) {
              collected += s.paidAmount;
              if (s.paymentLog && s.paymentLog.length > 0) {
                s.paymentLog.forEach(pl => { if ((pl.date || "").slice(0, 7) === monthKey) paymentsReceived++; });
              } else paymentsReceived++;
            } else if (new Date(s.dueDate) < today) overdueCount++;
            activeClientIds.add(c.id);
          }
        });
      });
    });
    staffReports.push({
      officer, totalClients: myClients.length, activeClients: activeClientIds.size,
      disbursed, collected, expectedThisMonth,
      outstanding: Math.max(0, expectedThisMonth - collected),
      overdueCount, loansIssued, paymentsReceived,
      collectionRate: expectedThisMonth > 0 ? (collected / expectedThisMonth) * 100 : 0,
      savingsBalance: myClients.reduce((a, c) => a + (c.savingsBalance || 0), 0)
    });
  });
  return staffReports;
}

function getClientTransactions(client) {
  const txs = [];
  (client.loans || []).forEach((l, lIdx) => {
    (l.schedule || []).forEach(s => {
      if (s.paymentLog && s.paymentLog.length > 0) {
        s.paymentLog.forEach((pl, plIdx) => {
          txs.push({
            id: `${l.id}-${s.day}-${plIdx}`, type: "loan_payment", date: pl.date, amount: pl.amount,
            description: `Loan Cycle ${lIdx + 1} — Day ${s.day}/${l.days}${pl.cascaded ? " (Cascaded)" : ""}${pl.defaultSettlement ? " (Default Settlement)" : ""}`,
            detail: `${pl.by ? `by ${pl.by} · ` : ""}${fd(pl.date)}${pl.cascaded ? " · Auto-cascaded" : ""}${pl.defaultSettlement ? " · Default settled" : ""}`,
            color: pl.defaultSettlement ? "#f59e0b" : pl.cascaded ? "#a78bfa" : "#4ade80",
            icon: pl.defaultSettlement ? "🔧" : pl.cascaded ? "⚡" : "✓"
          });
        });
      } else if (s.paidAmount > 0) {
        txs.push({
          id: `${l.id}-${s.day}`, type: "loan_payment", date: s.paidDate || s.dueDate, amount: s.paidAmount,
          description: `Loan Cycle ${lIdx + 1} — Day ${s.day}/${l.days}`,
          detail: s.paid ? (s.overpayment > 0 ? `Overpaid +${fc(s.overpayment)}` : "Full payment") : `Partial (${fc(s.shortfall)} short)`,
          color: s.paid ? "#4ade80" : "#f87171", icon: s.paid ? "✓" : "⚠"
        });
      }
    });
    txs.push({
      id: `issued-${l.id}`, type: "loan_issued", date: (l.issuedAt || l.startDate || "").split("T")[0],
      amount: l.principal, description: `Loan Cycle ${lIdx + 1} Issued`,
      detail: `${fc(l.principal)} at ${l.interestRate}% · ${l.days}d · Total: ${fc(l.totalRepayable)}${l.issuedByName ? ` · by ${l.issuedByName}` : ""}`,
      color: "#60a5fa", icon: "💰"
    });
  });
  (client.savingsLogs || []).forEach(log => {
    txs.push({
      id: log.id, type: log.type, date: log.date, amount: log.amount,
      description: log.type === "deposit" ? "Savings Deposit" : log.type === "withdraw" ? "Savings Withdrawal" : "Admin Adjustment",
      detail: `Balance after: ${fc(log.balanceAfter)}${log.recordedBy ? ` · by ${log.recordedBy}` : ""}`,
      color: log.type === "deposit" ? "#4ade80" : log.type === "withdraw" ? "#f87171" : "#c084fc",
      icon: log.type === "deposit" ? "📥" : log.type === "withdraw" ? "📤" : "🛡️"
    });
  });
  return txs.sort((a, b) => new Date(b.date) - new Date(a.date));
}

const DEFAULT_USERS = [
  { id: "admin_001", username: "Yebaba", password: "Go5win619$", role: "admin", name: "Admin", createdAt: "2026-04-21", active: true }
];

// ─── THEME SYSTEM ────────────────────────────────────────────────────────────
const themes = {
  dark: {
    bg: "#060f1a",
    cardBg: "#0d1b2a",
    cardBorder: "rgba(100,200,255,0.12)",
    text: "#e8f4fd",
    textSecondary: "#8ab4c8",
    textMuted: "#3a5a70",
    textDim: "#2a4050",
    inputBg: "rgba(100,180,255,0.05)",
    inputBorder: "rgba(100,180,255,0.15)",
    overlayBg: "rgba(0,8,20,0.92)",
    rowBg: "rgba(255,255,255,0.02)",
    rowBorder: "rgba(255,255,255,0.06)",
    accentBlue: "#3b82f6",
    accentGreen: "#22c55e",
    name: "dark"
  },
  light: {
    bg: "#f0f4f8",
    cardBg: "#ffffff",
    cardBorder: "rgba(0,0,0,0.1)",
    text: "#1a2332",
    textSecondary: "#4a6078",
    textMuted: "#8a9ab0",
    textDim: "#b0bcc8",
    inputBg: "rgba(0,0,0,0.03)",
    inputBorder: "rgba(0,0,0,0.12)",
    overlayBg: "rgba(240,244,248,0.95)",
    rowBg: "rgba(0,0,0,0.02)",
    rowBorder: "rgba(0,0,0,0.06)",
    accentBlue: "#2563eb",
    accentGreen: "#16a34a",
    name: "light"
  }
};

// ─── ICONS ───────────────────────────────────────────────────────────────────
const Icon = ({ name, size = 16 }) => {
  const icons = {
    plus: <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></svg>,
    user: <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><circle cx="12" cy="8" r="4" /><path d="M4 20c0-4 3.6-7 8-7s8 3 8 7" /></svg>,
    users: <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M23 21v-2a4 4 0 0 0-3-3.87" /></svg>,
    check: <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><polyline points="20 6 9 17 4 12" /></svg>,
    back: <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><polyline points="15 18 9 12 15 6" /></svg>,
    dashboard: <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><rect x="3" y="3" width="7" height="7" /><rect x="14" y="3" width="7" height="7" /><rect x="3" y="14" width="7" height="7" /><rect x="14" y="14" width="7" height="7" /></svg>,
    trash: <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><polyline points="3 6 5 6 21 6" /><path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6" /></svg>,
    edit: <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7" /><path d="M18.5 2.5a2.121 2.121 0 113 3L12 15l-4 1 1-4 9.5-9.5z" /></svg>,
    ledger: <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" /><polyline points="14 2 14 8 20 8" /></svg>,
    search: <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" /></svg>,
    lock: <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><rect x="3" y="11" width="18" height="11" rx="2" /><path d="M7 11V7a5 5 0 0 1 10 0v4" /></svg>,
    unlock: <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><rect x="3" y="11" width="18" height="11" rx="2" /><path d="M7 11V7a5 5 0 0 1 9.9-1" /></svg>,
    trend: <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><polyline points="23 6 13.5 15.5 8.5 10.5 1 18" /><polyline points="17 6 23 6 23 12" /></svg>,
    shield: <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" /></svg>,
    chevronDown: <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><polyline points="6 9 12 15 18 9" /></svg>,
    chevronUp: <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><polyline points="18 15 12 9 6 15" /></svg>,
    calendar: <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><rect x="3" y="4" width="18" height="18" rx="2" /><line x1="16" y1="2" x2="16" y2="6" /><line x1="8" y1="2" x2="8" y2="6" /><line x1="3" y1="10" x2="21" y2="10" /></svg>,
    bell: <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" /><path d="M13.73 21a2 2 0 0 1-3.46 0" /></svg>,
    logout: <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" /><polyline points="16 17 21 12 16 7" /><line x1="21" y1="12" x2="9" y2="12" /></svg>,
    account: <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><rect x="2" y="3" width="20" height="14" rx="2" /><line x1="8" y1="21" x2="16" y2="21" /></svg>,
    key: <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M21 2l-2 2m-7.61 7.61a5.5 5.5 0 1 1-7.778 7.778 5.5 5.5 0 0 1 7.777-7.777zm0 0L15.5 7.5m0 0l3 3L22 7l-3-3m-3.5 3.5L19 4" /></svg>,
    history: <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><circle cx="12" cy="12" r="10" /><polyline points="12 6 12 12 16 14" /></svg>,
    chart: <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><line x1="18" y1="20" x2="18" y2="10" /><line x1="12" y1="20" x2="12" y2="4" /><line x1="6" y1="20" x2="6" y2="14" /></svg>,
    route: <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><circle cx="6" cy="19" r="3" /><path d="M9 19h8.5a3.5 3.5 0 0 0 0-7h-11a3.5 3.5 0 0 1 0-7H15" /><circle cx="18" cy="5" r="3" /></svg>,
    restructure: <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><polyline points="17 1 21 5 17 9" /><path d="M3 11V9a4 4 0 0 1 4-4h14" /><polyline points="7 23 3 19 7 15" /><path d="M21 13v2a4 4 0 0 1-4 4H3" /></svg>,
    sun: <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><circle cx="12" cy="12" r="5" /><line x1="12" y1="1" x2="12" y2="3" /><line x1="12" y1="21" x2="12" y2="23" /><line x1="4.22" y1="4.22" x2="5.64" y2="5.64" /><line x1="18.36" y1="18.36" x2="19.78" y2="19.78" /><line x1="1" y1="12" x2="3" y2="12" /><line x1="21" y1="12" x2="23" y2="12" /><line x1="4.22" y1="19.78" x2="5.64" y2="18.36" /><line x1="18.36" y1="5.64" x2="19.78" y2="4.22" /></svg>,
    moon: <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" /></svg>,
    printer: <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><polyline points="6 9 6 2 18 2 18 9" /><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2" /><rect x="6" y="14" width="12" height="8" /></svg>,
    briefcase: <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><rect x="2" y="7" width="20" height="14" rx="2" /><path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16" /></svg>,
  };
  return icons[name] || null;
};

// ─── UI COMPONENTS ───────────────────────────────────────────────────────────
function Modal({ title, onClose, children, wide, theme }) {
  const t = theme || themes.dark;
  return (
    <div style={{ position: "fixed", inset: 0, background: t.overlayBg, zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "center", padding: 16, backdropFilter: "blur(8px)" }}>
      <div style={{ background: t.cardBg, border: `1px solid ${t.cardBorder}`, borderRadius: 20, width: "100%", maxWidth: wide ? 580 : 480, maxHeight: "92vh", overflowY: "auto" }} className="print-modal">
        <div style={{ padding: "20px 22px 14px", borderBottom: `1px solid ${t.rowBorder}`, display: "flex", justifyContent: "space-between", alignItems: "center", position: "sticky", top: 0, background: t.cardBg, zIndex: 1, borderRadius: "20px 20px 0 0" }}>
          <h2 style={{ margin: 0, fontSize: 17, fontWeight: 700, color: t.text }}>{title}</h2>
          <div style={{ display: "flex", gap: 6 }}>
            <button onClick={() => window.print()} className="no-print" style={{ background: "rgba(96,165,250,0.1)", border: "none", color: "#60a5fa", width: 30, height: 30, borderRadius: 8, cursor: "pointer", fontSize: 13, display: "flex", alignItems: "center", justifyContent: "center" }}>
              <Icon name="printer" size={14} />
            </button>
            <button onClick={onClose} className="no-print" style={{ background: t.rowBg, border: "none", color: t.textMuted, width: 30, height: 30, borderRadius: 8, cursor: "pointer", fontSize: 17 }}>×</button>
          </div>
        </div>
        <div style={{ padding: "20px 22px" }}>{children}</div>
      </div>
    </div>
  );
}

function Field({ label, children, theme }) {
  const t = theme || themes.dark;
  return (
    <div style={{ marginBottom: 14 }}>
      <label style={{ display: "block", fontSize: 11, color: t.textMuted, marginBottom: 5, letterSpacing: 0.8, textTransform: "uppercase" }}>{label}</label>
      {children}
    </div>
  );
}

function getIS(theme) {
  const t = theme || themes.dark;
  return { width: "100%", padding: "10px 13px", background: t.inputBg, border: `1px solid ${t.inputBorder}`, borderRadius: 10, color: t.text, fontSize: 14, outline: "none", boxSizing: "border-box", fontFamily: "inherit" };
}

function SC({ label, value, accent, sub, theme }) {
  const t = theme || themes.dark;
  return (
    <div style={{ background: t.rowBg, border: `1px solid ${t.rowBorder}`, borderRadius: 14, padding: "16px 18px", borderTop: `2px solid ${accent}` }}>
      <div style={{ fontSize: 10, color: t.textMuted, letterSpacing: 1.2, textTransform: "uppercase", marginBottom: 7 }}>{label}</div>
      <div style={{ fontSize: 19, fontWeight: 800, color: t.text, fontFamily: "'Courier New',monospace" }}>{value}</div>
      {sub && <div style={{ fontSize: 10, color: t.textDim, marginTop: 3 }}>{sub}</div>}
    </div>
  );
}

function Badge({ color, bg, children }) {
  return <span style={{ fontSize: 10, padding: "2px 9px", borderRadius: 20, background: bg, color, fontWeight: 700 }}>{children}</span>;
}

function RB({ role }) {
  return role === "admin"
    ? <Badge color="#f59e0b" bg="rgba(245,158,11,0.15)">👑 ADMIN</Badge>
    : <Badge color="#60a5fa" bg="rgba(96,165,250,0.15)">🏦 OFFICER</Badge>;
}

function Toast({ msg, type }) {
  if (!msg) return null;
  return (
    <div style={{ position: "fixed", top: 70, left: "50%", transform: "translateX(-50%)", background: type === "error" ? "rgba(248,113,113,0.15)" : "rgba(34,197,94,0.15)", border: `1px solid ${type === "error" ? "rgba(248,113,113,0.3)" : "rgba(34,197,94,0.3)"}`, color: type === "error" ? "#f87171" : "#4ade80", padding: "10px 20px", borderRadius: 12, zIndex: 9999, fontWeight: 700, fontSize: 13, backdropFilter: "blur(8px)" }}>{msg}</div>
  );
}

function FMR({ label, value, valueColor = "#e8f4fd", icon, sub, theme }) {
  const t = theme || themes.dark;
  return (
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "10px 14px", background: t.rowBg, borderRadius: 10, border: `1px solid ${t.rowBorder}` }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        {icon && <span style={{ color: valueColor, opacity: 0.8 }}>{icon}</span>}
        <div>
          <div style={{ fontSize: 11, color: t.textMuted }}>{label}</div>
          {sub && <div style={{ fontSize: 9, color: t.textDim, marginTop: 1 }}>{sub}</div>}
        </div>
      </div>
      <div style={{ fontSize: 14, fontWeight: 800, color: valueColor, fontFamily: "'Courier New',monospace" }}>{value}</div>
    </div>
  );
}

function ROIGauge({ roi }) {
  const c = Math.min(Math.max(roi, 0), 100);
  const color = roi >= 20 ? "#22c55e" : roi >= 10 ? "#f59e0b" : "#ef4444";
  return (
    <div style={{ marginTop: 4 }}>
      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 5 }}>
        <span style={{ fontSize: 10, color: "#5a7a90" }}>ROI</span>
        <span style={{ fontSize: 12, fontWeight: 800, color, fontFamily: "'Courier New',monospace" }}>{roi.toFixed(2)}%</span>
      </div>
      <div style={{ height: 6, background: "rgba(255,255,255,0.06)", borderRadius: 4, overflow: "hidden" }}>
        <div style={{ height: "100%", width: `${c}%`, background: `linear-gradient(90deg,${color},${color}cc)`, borderRadius: 4 }} />
      </div>
    </div>
  );
}

function FP({ fin, isClient, expandFinancials, setExpandFinancials, theme }) {
  const t = theme || themes.dark;
  const rc = fin.realROI >= 20 ? "#22c55e" : fin.realROI >= 10 ? "#f59e0b" : "#ef4444";
  return (
    <div style={{ background: `linear-gradient(135deg,${t.cardBg},${t.cardBg})`, border: `1px solid ${t.cardBorder}`, borderRadius: 16, overflow: "hidden", marginBottom: 20 }}>
      <div style={{ background: "linear-gradient(135deg,rgba(59,130,246,0.12),rgba(34,197,94,0.08))", padding: "14px 16px", borderBottom: `1px solid ${t.rowBorder}`, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <Icon name="trend" size={16} />
          <div style={{ fontSize: 13, fontWeight: 800, color: t.text }}>{isClient ? "Client Intelligence" : "Portfolio Intelligence"}</div>
        </div>
        {!isClient && setExpandFinancials && (
          <button onClick={() => setExpandFinancials(!expandFinancials)} className="no-print" style={{ background: "rgba(100,180,255,0.08)", border: "none", borderRadius: 8, color: "#60a5fa", padding: "5px 12px", fontSize: 11, cursor: "pointer", fontWeight: 600 }}>
            {expandFinancials ? "Hide" : "Show"}
          </button>
        )}
      </div>
      {(isClient || expandFinancials) && (
        <div style={{ padding: "14px 16px", display: "flex", flexDirection: "column", gap: 8 }}>
          <FMR label="Capital" value={fc(fin.totalCapital ?? fin.capital)} valueColor="#60a5fa" icon={<Icon name="shield" size={13} />} theme={t} />
          <FMR label="Outstanding" value={fc(fin.outstandingPrincipal)} valueColor={fin.outstandingPrincipal > 0 ? "#f87171" : "#4ade80"} icon={<Icon name="shield" size={13} />} theme={t} />
          <FMR label="Interest Earned" value={fc(fin.interestEarned)} valueColor="#a78bfa" icon={<Icon name="trend" size={13} />} theme={t} />
          <div style={{ padding: "12px 14px", background: "rgba(34,197,94,0.06)", borderRadius: 10, border: "1px solid rgba(34,197,94,0.15)", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <div style={{ fontSize: 11, color: "#4ade80", fontWeight: 700 }}>TRUE PROFIT</div>
            <div style={{ fontSize: 18, fontWeight: 900, color: "#22c55e", fontFamily: "'Courier New',monospace" }}>{fc(fin.trueProfit)}</div>
          </div>
          <div style={{ padding: "12px 14px", background: `${rc}14`, borderRadius: 10, border: `1px solid ${rc}33` }}>
            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 8 }}>
              <div style={{ fontSize: 11, color: rc, fontWeight: 700 }}>ROI</div>
              <div style={{ background: `${rc}20`, borderRadius: 8, padding: "4px 10px" }}>
                <span style={{ fontSize: 16, fontWeight: 900, color: rc, fontFamily: "'Courier New',monospace" }}>{fin.realROI.toFixed(2)}%</span>
              </div>
            </div>
            <ROIGauge roi={fin.realROI} />
          </div>
        </div>
      )}
    </div>
  );
}

// ─── SHORTFALL BANNER ────────────────────────────────────────────────────────
function ShortfallBanner({ loan }) {
  const { totalShortfall, shortfallDays } = computeTotalShortfall(loan);
  if (totalShortfall <= 0) return null;
  return (
    <div style={{ background: "rgba(239,68,68,0.08)", border: "1px solid rgba(239,68,68,0.3)", borderRadius: 12, padding: "12px 14px", marginBottom: 12 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div>
          <div style={{ fontSize: 11, color: "#f87171", fontWeight: 700, marginBottom: 2 }}>⚠️ TOTAL SHORTFALL OWED</div>
          <div style={{ fontSize: 9, color: "#7a3a3a" }}>{shortfallDays} day{shortfallDays !== 1 ? "s" : ""} with unpaid gaps</div>
        </div>
        <div style={{ fontSize: 20, fontWeight: 900, color: "#ef4444", fontFamily: "'Courier New',monospace" }}>{fc(totalShortfall)}</div>
      </div>
    </div>
  );
}

// ─── REPAYMENT INPUT ROW (NEW: Inline balance + input) ───────────────────────
function RepaymentInputRow({ s, i, loan, isActive, isAdmin, today, onPay, onOverride, theme, currentUser }) {
  const [showLog, setShowLog] = useState(false);
  const [inlineAmount, setInlineAmount] = useState("");
  const [showInline, setShowInline] = useState(false);
  const t = theme || themes.dark;

  const isSF = !s.paid && s.paidAmount > 0 && s.paidAmount < s.payment;
  const isOD = !s.paid && new Date(s.dueDate) < today;
  const isNext = isActive && !s.paid && loan.schedule.filter(x => !x.paid)[0] === s;
  const isLate = s.paid && s.paidDate > s.dueDate;
  const hasOver = s.overpayment > 0;
  const hasLog = (s.paymentLog || []).length > 0;
  const remainingForSlot = Math.max(0, s.payment - (s.paidAmount || 0));

  let border = t.rowBorder, bg = t.rowBg;
  if (s.paid) { border = "rgba(34,197,94,0.15)"; bg = "rgba(34,197,94,0.04)"; }
  else if (isSF) { border = "rgba(239,68,68,0.35)"; bg = "rgba(239,68,68,0.08)"; }
  else if (isOD) { border = "rgba(239,68,68,0.2)"; bg = "rgba(239,68,68,0.05)"; }
  else if (isNext) { border = "rgba(96,165,250,0.2)"; bg = "rgba(96,165,250,0.03)"; }

  const handleInlinePay = () => {
    const amt = parseFloat(inlineAmount);
    if (!amt || amt <= 0) return;
    onPay(loan, i, amt);
    setInlineAmount("");
    setShowInline(false);
  };

  return (
    <div style={{ background: bg, border: `1px solid ${border}`, borderRadius: 10, padding: "10px 12px", marginBottom: 6 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
        <div style={{ display: "flex", gap: 9, alignItems: "flex-start" }}>
          <div style={{ width: 28, height: 28, borderRadius: 7, fontSize: 10, fontWeight: 700, flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center", background: s.paid ? "rgba(34,197,94,0.15)" : isSF ? "rgba(239,68,68,0.2)" : isOD ? "rgba(239,68,68,0.12)" : "rgba(255,255,255,0.05)", color: s.paid ? "#4ade80" : isSF ? "#f87171" : isOD ? "#f87171" : t.textMuted }}>
            {s.paid ? <Icon name="check" size={11} /> : `${i + 1}`}
          </div>
          <div>
            <div style={{ display: "flex", alignItems: "center", gap: 5, marginBottom: 3, flexWrap: "wrap" }}>
              <span style={{ fontSize: 12, fontWeight: 700, color: s.paid ? "#4ade80" : isSF ? "#f87171" : isOD ? "#f87171" : t.text, fontFamily: "'Courier New',monospace" }}>
                {fc(s.payment)}
              </span>
              {s.restructured && <Badge color="#c084fc" bg="rgba(192,132,252,0.12)">RESTRUCTURED</Badge>}
              {isNext && <Badge color="#60a5fa" bg="rgba(96,165,250,0.12)">NEXT</Badge>}
              {isOD && !isSF && <Badge color="#f87171" bg="rgba(239,68,68,0.1)">OVERDUE</Badge>}
              {isLate && <Badge color="#f59e0b" bg="rgba(245,158,11,0.1)">LATE</Badge>}
              {isSF && <Badge color="#f87171" bg="rgba(239,68,68,0.15)">SHORTFALL</Badge>}
              {hasOver && <Badge color="#a78bfa" bg="rgba(167,139,250,0.12)">OVERPAID</Badge>}
              {s.paymentLog?.some(pl => pl.defaultSettlement) && <Badge color="#f59e0b" bg="rgba(245,158,11,0.12)">DEFAULT SETTLED</Badge>}
              {hasLog && (
                <button onClick={() => setShowLog(!showLog)} style={{ background: "rgba(245,158,11,0.1)", border: "1px solid rgba(245,158,11,0.2)", color: "#f59e0b", borderRadius: 5, padding: "1px 6px", cursor: "pointer", fontSize: 9, fontWeight: 700 }}>
                  {s.paymentLog.length} log{s.paymentLog.length > 1 ? "s" : ""} {showLog ? "▲" : "▼"}
                </button>
              )}
            </div>

            {/* REMAINING AMOUNT DISPLAY */}
            {!s.paid && (
              <div style={{ fontSize: 10, color: "#f59e0b", fontWeight: 700, marginBottom: 2 }}>
                Remaining: <span style={{ fontFamily: "'Courier New',monospace" }}>{fc(remainingForSlot)}</span>
              </div>
            )}

            {isSF && <div style={{ fontSize: 9, color: "#f87171" }}>Paid {fc(s.paidAmount)} · Needs {fc(remainingForSlot)}</div>}
            {hasOver && <div style={{ fontSize: 9, color: "#a78bfa" }}>+{fc(s.overpayment)} cascaded</div>}
            <div style={{ fontSize: 9, color: t.textMuted }}>Due {fd(s.dueDate)}{s.paidDate && ` · Last paid ${fd(s.paidDate)}`}</div>
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 6, flexShrink: 0 }}>
          <div style={{ textAlign: "right" }}>
            <div style={{ fontSize: 8, color: t.textMuted }}>BAL</div>
            <div style={{ fontSize: 10, color: t.textSecondary, fontFamily: "'Courier New',monospace" }}>{fc(s.balance)}</div>
          </div>
          {!s.paid && isActive && (
            <button onClick={() => setShowInline(!showInline)} style={{ background: "linear-gradient(135deg,#22c55e,#16a34a)", border: "none", color: "#000", padding: "5px 10px", borderRadius: 6, cursor: "pointer", fontWeight: 700, fontSize: 10 }}>
              {showInline ? "✕" : "Pay"}
            </button>
          )}
          {isAdmin && (
            <button onClick={e => { e.stopPropagation(); onOverride(loan, i, s); }} style={{ background: "rgba(245,158,11,0.1)", border: "1px solid rgba(245,158,11,0.3)", color: "#f59e0b", borderRadius: 6, padding: "4px 7px", cursor: "pointer", fontSize: 9 }}>Edit</button>
          )}
        </div>
      </div>

      {/* INLINE PAYMENT INPUT */}
      {showInline && !s.paid && isActive && (
        <div style={{ marginTop: 10, padding: "10px 12px", background: "rgba(34,197,94,0.06)", border: "1px solid rgba(34,197,94,0.15)", borderRadius: 10 }}>
          <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 8 }}>
            <span style={{ fontSize: 11, color: "#4ade80", fontWeight: 700 }}>Amount to collect:</span>
            <span style={{ fontSize: 11, color: t.textMuted }}>Due: {fc(remainingForSlot)}</span>
          </div>
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <div style={{ flex: 1, position: "relative" }}>
              <span style={{ position: "absolute", left: 10, top: "50%", transform: "translateY(-50%)", color: t.textMuted, fontSize: 13 }}>₦</span>
              <input
                type="number"
                value={inlineAmount}
                onChange={e => setInlineAmount(e.target.value)}
                onKeyDown={e => e.key === "Enter" && handleInlinePay()}
                placeholder="0.00"
                autoFocus
                style={{ ...getIS(t), paddingLeft: 28, borderBottom: `2px solid ${t.accentGreen}`, borderRadius: 8 }}
              />
            </div>
            <button onClick={() => setInlineAmount(remainingForSlot.toFixed(2))} style={{ background: "rgba(96,165,250,0.1)", border: "1px solid rgba(96,165,250,0.2)", color: "#60a5fa", padding: "8px 10px", borderRadius: 8, cursor: "pointer", fontWeight: 700, fontSize: 10, whiteSpace: "nowrap" }}>Full</button>
            <button onClick={handleInlinePay} style={{ background: "linear-gradient(135deg,#22c55e,#16a34a)", border: "none", color: "#000", padding: "8px 14px", borderRadius: 8, cursor: "pointer", fontWeight: 800, fontSize: 12 }}>✓</button>
          </div>
          {inlineAmount && parseFloat(inlineAmount) > 0 && (
            <div style={{ marginTop: 8, fontSize: 10, color: t.textMuted }}>
              {parseFloat(inlineAmount) > remainingForSlot && (
                <span style={{ color: "#a78bfa" }}>💡 Excess {fc(parseFloat(inlineAmount) - remainingForSlot)} will settle defaults first, then cascade</span>
              )}
              {parseFloat(inlineAmount) < remainingForSlot && (
                <span style={{ color: "#f59e0b" }}>⚠ Partial — {fc(remainingForSlot - parseFloat(inlineAmount))} still needed</span>
              )}
              {parseFloat(inlineAmount) === remainingForSlot && (
                <span style={{ color: "#4ade80" }}>✓ Exact amount</span>
              )}
            </div>
          )}
        </div>
      )}

      {showLog && hasLog && (
        <div style={{ marginTop: 10, borderTop: `1px solid ${t.rowBorder}`, paddingTop: 10 }}>
          <div style={{ fontSize: 10, color: "#f59e0b", fontWeight: 700, marginBottom: 8 }}>📋 Payment Details</div>
          {s.paymentLog.map((pl, idx) => (
            <div key={idx} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "6px 10px", background: pl.defaultSettlement ? "rgba(245,158,11,0.06)" : pl.cascaded ? "rgba(167,139,250,0.06)" : "rgba(34,197,94,0.04)", border: `1px solid ${pl.defaultSettlement ? "rgba(245,158,11,0.15)" : pl.cascaded ? "rgba(167,139,250,0.15)" : "rgba(34,197,94,0.1)"}`, borderRadius: 8, marginBottom: 5 }}>
              <div>
                <div style={{ fontSize: 11, fontWeight: 700, color: pl.defaultSettlement ? "#f59e0b" : pl.cascaded ? "#a78bfa" : "#4ade80", fontFamily: "'Courier New',monospace" }}>{fc(pl.amount)}</div>
                <div style={{ fontSize: 9, color: t.textMuted, marginTop: 2 }}>
                  {fd(pl.date)}{pl.by ? ` · ${pl.by}` : ""}
                  {pl.cascaded ? " · Cascaded" : ""}
                  {pl.defaultSettlement ? " · Default Settlement" : ""}
                </div>
              </div>
              <div style={{ fontSize: 16 }}>{pl.defaultSettlement ? "🔧" : pl.cascaded ? "⚡" : "✓"}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── LOAN CYCLE CARD ─────────────────────────────────────────────────────────
function LCC({ loan, num, total, isAdmin, onPay, onOverride, today, onRestructure, theme, currentUser }) {
  const [exp, setExp] = useState(num === total);
  const [schOpen, setSchOpen] = useState(num === total);
  const fin = computeLoanFinancials(loan);
  const t = theme || themes.dark;
  const isAct = loan.status === "active";
  const pc = fin.completionRate >= 90 ? "#22c55e" : fin.completionRate >= 60 ? "#f59e0b" : "#ef4444";
  const stars = Math.round((fin.completionRate / 100) * 5);

  return (
    <div style={{ background: isAct ? "linear-gradient(135deg,rgba(34,197,94,0.04),rgba(59,130,246,0.03))" : t.rowBg, border: `1px solid ${isAct ? "rgba(34,197,94,0.2)" : t.cardBorder}`, borderRadius: 16, overflow: "hidden", marginBottom: 12 }}>
      <div onClick={() => setExp(!exp)} style={{ padding: "14px 16px", cursor: "pointer" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <div style={{ width: 38, height: 38, borderRadius: 10, flexShrink: 0, background: isAct ? "linear-gradient(135deg,#16a34a,#22c55e)" : "linear-gradient(135deg,#1d4ed8,#3b82f6)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 13, fontWeight: 800, color: "#fff" }}>
              {loan.status === "completed" ? <Icon name="check" size={16} /> : `L${num}`}
            </div>
            <div>
              <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 2 }}>
                <span style={{ fontSize: 13, fontWeight: 700, color: t.text }}>Cycle {num}</span>
                <Badge color={isAct ? "#4ade80" : "#60a5fa"} bg={isAct ? "rgba(34,197,94,0.12)" : "rgba(96,165,250,0.12)"}>{isAct ? "ACTIVE" : "DONE"}</Badge>
                {(loan.restructureLog || []).length > 0 && <Badge color="#c084fc" bg="rgba(192,132,252,0.12)">RESTRUCTURED</Badge>}
              </div>
              <div style={{ fontSize: 10, color: t.textMuted }}>{fd(loan.startDate)} · {loan.days}d · {loan.interestRate}%</div>
            </div>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <div style={{ textAlign: "right" }}>
              <div style={{ fontSize: 13, fontWeight: 800, color: "#60a5fa", fontFamily: "'Courier New',monospace" }}>{fc(loan.principal)}</div>
              {isAct && <div style={{ fontSize: 9, color: "#f59e0b" }}>Rem: {fc(fin.remainingBalance)}</div>}
            </div>
            <div style={{ color: t.textMuted }}>{exp ? <Icon name="chevronUp" size={14} /> : <Icon name="chevronDown" size={14} />}</div>
          </div>
        </div>
        <div style={{ marginTop: 10 }}>
          <div style={{ display: "flex", justifyContent: "space-between", fontSize: 9, color: t.textMuted, marginBottom: 4 }}>
            <span>{fin.paidCount}/{fin.totalCount} days</span>
            <span style={{ color: pc }}>{fin.completionRate.toFixed(0)}%</span>
          </div>
          <div style={{ height: 4, background: t.rowBorder, borderRadius: 4, overflow: "hidden" }}>
            <div style={{ height: "100%", width: `${fin.completionRate}%`, background: `linear-gradient(90deg,${pc},${pc}99)`, borderRadius: 4 }} />
          </div>
        </div>
      </div>
      {exp && (
        <div style={{ padding: "14px 16px" }}>
          {isAct && <ShortfallBanner loan={loan} />}

          {/* Remaining Balance Banner */}
          {isAct && (
            <div style={{ background: "rgba(96,165,250,0.08)", border: "1px solid rgba(96,165,250,0.2)", borderRadius: 12, padding: "12px 14px", marginBottom: 12, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <div>
                <div style={{ fontSize: 11, color: "#60a5fa", fontWeight: 700 }}>💰 REMAINING BALANCE</div>
                <div style={{ fontSize: 9, color: t.textMuted }}>{fin.totalCount - fin.paidCount} day{fin.totalCount - fin.paidCount !== 1 ? "s" : ""} remaining</div>
              </div>
              <div style={{ fontSize: 22, fontWeight: 900, color: "#60a5fa", fontFamily: "'Courier New',monospace" }}>{fc(fin.remainingBalance)}</div>
            </div>
          )}

          {(loan.restructureLog || []).length > 0 && (
            <div style={{ background: "rgba(192,132,252,0.06)", border: "1px solid rgba(192,132,252,0.2)", borderRadius: 12, padding: "10px 14px", marginBottom: 14 }}>
              <div style={{ fontSize: 11, color: "#c084fc", fontWeight: 700, marginBottom: 8 }}>🔄 Restructure History</div>
              {loan.restructureLog.map((r, idx) => (
                <div key={idx} style={{ fontSize: 10, color: "#8a6aaa", marginBottom: 4 }}>
                  {fd(r.date)} · {fc(r.newDailyAmount)}/day · {r.newDays} days · by {r.approvedBy}
                  {r.reason && <div style={{ fontSize: 9, color: "#6a4a8a", marginTop: 1 }}>"{r.reason}"</div>}
                </div>
              ))}
            </div>
          )}

          <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 8, marginBottom: 14 }}>
            {[["Principal", fc(loan.principal), "#93c5fd"], ["Daily", fc(loan.dailyPayment), "#60a5fa"], ["Total", fc(loan.totalRepayable), t.text], ["Collected", fc(fin.collected), "#4ade80"], ["Outstanding", fc(fin.remainingBalance), fin.remainingBalance > 0 ? "#f87171" : "#4ade80"], ["Interest", `${loan.interestRate}%`, "#c4b5fd"]].map(([l, v, c]) => (
              <div key={l} style={{ background: t.rowBg, borderRadius: 9, padding: "9px 10px", border: `1px solid ${t.rowBorder}` }}>
                <div style={{ fontSize: 8, color: t.textMuted, marginBottom: 3 }}>{l}</div>
                <div style={{ fontSize: 11, fontWeight: 700, color: c, fontFamily: "'Courier New',monospace" }}>{v}</div>
              </div>
            ))}
          </div>

          {isAdmin && (
            <div style={{ background: "rgba(0,0,0,0.2)", borderRadius: 12, padding: "12px 14px", marginBottom: 14 }}>
              <div style={{ fontSize: 11, color: t.textMuted, fontWeight: 700, marginBottom: 10 }}>FINANCIAL INTELLIGENCE</div>
              {[["Interest Earned", fc(fin.interestEarned), "#a78bfa"], ["Profit", fc(fin.trueProfit), "#22c55e"], ["ROI", `${fin.realROI.toFixed(2)}%`, fin.realROI >= 20 ? "#22c55e" : "#f59e0b"], ["Collection", `${fin.collectionRate.toFixed(1)}%`, "#f59e0b"]].map(([l, v, c]) => (
                <div key={l} style={{ display: "flex", justifyContent: "space-between", marginBottom: 6 }}>
                  <span style={{ fontSize: 11, color: t.textSecondary }}>{l}</span>
                  <span style={{ fontSize: 12, fontWeight: 700, color: c, fontFamily: "'Courier New',monospace" }}>{v}</span>
                </div>
              ))}
            </div>
          )}

          <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 6, marginBottom: 14 }}>
            {[["On Time", fin.onTimeCount, "#4ade80", "rgba(34,197,94,0.06)"], ["Late", fin.lateCount, "#f59e0b", "rgba(245,158,11,0.06)"], ["Partial", fin.partialCount, "#f87171", "rgba(239,68,68,0.06)"], ["Overdue", fin.overdueCount, "#ef4444", "rgba(239,68,68,0.08)"]].map(([l, v, c, bg]) => (
              <div key={l} style={{ background: bg, borderRadius: 10, padding: "10px 8px", textAlign: "center" }}>
                <div style={{ fontSize: 16, fontWeight: 800, color: c }}>{v}</div>
                <div style={{ fontSize: 9, color: t.textMuted, marginTop: 2 }}>{l}</div>
              </div>
            ))}
          </div>

          <div style={{ background: `${pc}10`, border: `1px solid ${pc}30`, borderRadius: 12, padding: "12px 14px", marginBottom: 14, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <div>
              <div style={{ fontSize: 11, color: pc, fontWeight: 700, marginBottom: 4 }}>PERFORMANCE</div>
              <div style={{ display: "flex", gap: 3 }}>
                {[1, 2, 3, 4, 5].map(x => <span key={x} style={{ color: x <= stars ? "#f59e0b" : "rgba(255,255,255,0.1)", fontSize: 14 }}>★</span>)}
              </div>
            </div>
            <div style={{ fontSize: 22, fontWeight: 900, color: pc, fontFamily: "'Courier New',monospace" }}>{fin.completionRate.toFixed(0)}%</div>
          </div>

          {isAdmin && isAct && (
            <button onClick={() => onRestructure(loan)} className="no-print" style={{ width: "100%", background: "rgba(192,132,252,0.1)", border: "1px solid rgba(192,132,252,0.25)", color: "#c084fc", padding: "9px", borderRadius: 10, cursor: "pointer", fontWeight: 700, fontSize: 12, display: "flex", alignItems: "center", justifyContent: "center", gap: 6, marginBottom: 10 }}>
              <Icon name="restructure" size={13} />Restructure Loan
            </button>
          )}

          <button onClick={() => setSchOpen(!schOpen)} className="no-print" style={{ width: "100%", background: "rgba(100,180,255,0.06)", border: `1px solid ${t.cardBorder}`, color: "#60a5fa", padding: "9px", borderRadius: 10, cursor: "pointer", fontWeight: 700, fontSize: 12, display: "flex", alignItems: "center", justifyContent: "center", gap: 6, marginBottom: schOpen ? 10 : 0 }}>
            <Icon name="calendar" size={13} />{schOpen ? "Hide" : "View"} Schedule
          </button>
          {schOpen && (
            <div>
              {loan.schedule?.map((s, idx) => (
                <RepaymentInputRow key={idx} s={s} i={idx} loan={loan} isActive={isAct} isAdmin={isAdmin} today={today} onPay={onPay} onOverride={onOverride} theme={t} currentUser={currentUser} />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── LOGIN ───────────────────────────────────────────────────────────────────
function LoginScreen({ users, onLogin }) {
  const [u, setU] = useState("");
  const [p, setP] = useState("");
  const [err, setErr] = useState("");
  const [show, setShow] = useState(false);

  const go = () => {
    const f = users.find(x => x.username === u.trim() && x.password === p.trim() && x.active);
    if (f) { setErr(""); onLogin(f); }
    else setErr("Invalid credentials.");
  };

  return (
    <div style={{ minHeight: "100vh", background: "#060f1a", display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }}>
      <div style={{ width: "100%", maxWidth: 380 }}>
        <div style={{ textAlign: "center", marginBottom: 32 }}>
          <div style={{ width: 64, height: 64, borderRadius: 18, background: "linear-gradient(135deg,#0a5c36,#0d7a48)", border: "2px solid rgba(200,146,10,0.4)", display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 16px" }}>
            <svg width="34" height="34" viewBox="0 0 80 80" fill="none">
              <path d="M48 22A19 19 0 1 0 48 58" stroke="white" strokeWidth="5.5" strokeLinecap="round" fill="none" />
              <path d="M42 30L53 20L64 30" stroke="#c8920a" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" fill="none" />
              <line x1="53" y1="20" x2="53" y2="44" stroke="#c8920a" strokeWidth="4" strokeLinecap="round" />
            </svg>
          </div>
          <div style={{ fontSize: 28, fontWeight: 900, color: "#e8f4fd", letterSpacing: 2, fontFamily: "serif" }}>CREDA</div>
          <div style={{ fontSize: 11, color: "rgba(200,146,10,0.8)", letterSpacing: 3, textTransform: "uppercase", marginTop: 4 }}>Finance Platform</div>
        </div>
        <div style={{ background: "#0d1b2a", border: "1px solid rgba(100,200,255,0.12)", borderRadius: 20, padding: "28px 24px" }}>
          <Field label="Username">
            <input style={getIS(themes.dark)} value={u} onChange={e => setU(e.target.value)} onKeyDown={e => e.key === "Enter" && go()} placeholder="Username" autoFocus />
          </Field>
          <Field label="Password">
            <div style={{ position: "relative" }}>
              <input type={show ? "text" : "password"} style={{ ...getIS(themes.dark), paddingRight: 40 }} value={p} onChange={e => setP(e.target.value)} onKeyDown={e => e.key === "Enter" && go()} placeholder="Password" />
              <button onClick={() => setShow(s => !s)} style={{ position: "absolute", right: 10, top: "50%", transform: "translateY(-50%)", background: "none", border: "none", color: "#3a5a70", cursor: "pointer" }}>{show ? "🙈" : "👁️"}</button>
            </div>
          </Field>
          {err && <div style={{ background: "rgba(239,68,68,0.1)", border: "1px solid rgba(239,68,68,0.2)", borderRadius: 8, padding: "10px 12px", fontSize: 12, color: "#f87171", marginBottom: 14 }}>{err}</div>}
          <button onClick={go} style={{ width: "100%", background: "linear-gradient(135deg,#22c55e,#16a34a)", border: "none", color: "#000", padding: "13px", borderRadius: 12, cursor: "pointer", fontWeight: 800, fontSize: 15 }}>Sign In →</button>
        </div>
      </div>
    </div>
  );
}

// ─── STAFF PANEL ─────────────────────────────────────────────────────────────
function StaffPanel({ users, clients, pendingLoans, currentUser, onUpdateUsers, onApproveLoan, onRejectLoan, showToast, theme }) {
  const [showAdd, setShowAdd] = useState(false);
  const [ns, setNs] = useState({ name: "", username: "", password: "", role: "loan_officer" });
  const [editS, setEditS] = useState(null);
  const [resetPwd, setResetPwd] = useState(null);
  const [newPwd, setNewPwd] = useState("");
  const [showStaffReport, setShowStaffReport] = useState(false);
  const [reportMonth, setReportMonth] = useState(curMonthKey);
  const t = theme;
  const IS = getIS(t);

  const handleAdd = () => {
    if (!ns.name || !ns.username || !ns.password) { showToast("All fields required", "error"); return; }
    if (ns.password.length < 4) { showToast("Min 4 chars", "error"); return; }
    if (users.find(u => u.username.toLowerCase() === ns.username.toLowerCase())) { showToast("Username exists", "error"); return; }
    onUpdateUsers([...users, { ...ns, id: generateId("USR"), createdAt: todayStr, active: true }]);
    setNs({ name: "", username: "", password: "", role: "loan_officer" });
    setShowAdd(false);
    showToast("Account created!");
  };

  const handleReset = () => {
    if (!newPwd || newPwd.length < 4) { showToast("Min 4 chars", "error"); return; }
    onUpdateUsers(users.map(u => u.id === resetPwd.id ? { ...u, password: newPwd } : u));
    setResetPwd(null);
    setNewPwd("");
    showToast("Password reset!");
  };

  const getStats = id => {
    const mc = clients.filter(c => c.assignedTo === id);
    return {
      clients: mc.length,
      activeLoans: mc.reduce((a, c) => a + (c.loans?.filter(l => l.status === "active").length || 0), 0),
      collected: mc.reduce((a, c) => a + (c.loans || []).reduce((b, l) => b + (l.schedule || []).reduce((d, s) => d + (s.paidAmount || 0), 0), 0), 0)
    };
  };

  const staffReport = useMemo(() => computeStaffMonthlyReport(clients, users, reportMonth), [clients, users, reportMonth]);

  const availableMonths = useMemo(() => {
    const months = new Set();
    clients.forEach(c => {
      (c.loans || []).forEach(l => {
        const m = (l.issuedAt || l.startDate || "").slice(0, 7);
        if (m) months.add(m);
        (l.schedule || []).forEach(s => { const dm = (s.dueDate || "").slice(0, 7); if (dm) months.add(dm); });
      });
    });
    months.add(curMonthKey);
    return [...months].sort().reverse();
  }, [clients]);

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
        <div>
          <h1 style={{ margin: 0, fontSize: 22, fontWeight: 800, color: t.text }}>Staff</h1>
          <p style={{ margin: "4px 0 0", color: t.textMuted, fontSize: 13 }}>{users.filter(u => u.role !== "admin").length} members</p>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <button onClick={() => setShowStaffReport(true)} style={{ background: "rgba(167,139,250,0.12)", border: "1px solid rgba(167,139,250,0.25)", color: "#a78bfa", padding: "9px 14px", borderRadius: 11, cursor: "pointer", fontWeight: 700, fontSize: 12, display: "flex", alignItems: "center", gap: 6 }}>
            <Icon name="chart" size={13} />Reports
          </button>
          <button onClick={() => setShowAdd(true)} style={{ background: `linear-gradient(135deg,${t.accentBlue},#2563eb)`, border: "none", color: "#fff", padding: "9px 16px", borderRadius: 11, cursor: "pointer", fontWeight: 700, fontSize: 13, display: "flex", alignItems: "center", gap: 6 }}>
            <Icon name="plus" size={13} />Add
          </button>
        </div>
      </div>

      {pendingLoans.length > 0 && (
        <div style={{ background: "rgba(245,158,11,0.06)", border: "1px solid rgba(245,158,11,0.2)", borderRadius: 14, padding: 16, marginBottom: 20 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
            <Icon name="bell" size={16} />
            <span style={{ fontSize: 14, fontWeight: 700, color: "#f59e0b" }}>Pending ({pendingLoans.length})</span>
          </div>
          {pendingLoans.map(pl => {
            const off = users.find(u => u.id === pl.requestedBy);
            const cl = clients.find(c => c.id === pl.clientId);
            return (
              <div key={pl.id} style={{ background: "rgba(0,0,0,0.2)", borderRadius: 12, padding: "12px 14px", marginBottom: 10 }}>
                <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 8 }}>
                  <div>
                    <div style={{ fontSize: 13, fontWeight: 700, color: t.text }}>{cl?.name || "?"}</div>
                    <div style={{ fontSize: 10, color: t.textMuted }}>By {off?.name} · {fd(pl.requestedAt?.split("T")[0])}</div>
                  </div>
                  <div style={{ textAlign: "right" }}>
                    <div style={{ fontSize: 14, fontWeight: 800, color: "#60a5fa", fontFamily: "'Courier New',monospace" }}>{fc(pl.loanData.principal)}</div>
                  </div>
                </div>
                <div style={{ display: "flex", gap: 8 }}>
                  <button onClick={() => onApproveLoan(pl)} style={{ flex: 1, background: `linear-gradient(135deg,${t.accentGreen},#16a34a)`, border: "none", color: "#000", padding: "9px", borderRadius: 9, cursor: "pointer", fontWeight: 700, fontSize: 12 }}>✓ Approve</button>
                  <button onClick={() => onRejectLoan(pl.id)} style={{ flex: 1, background: "rgba(239,68,68,0.1)", border: "1px solid rgba(239,68,68,0.2)", color: "#f87171", padding: "9px", borderRadius: 9, cursor: "pointer", fontWeight: 700, fontSize: 12 }}>✕ Reject</button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {users.filter(u => u.role !== "admin").map(o => {
        const st = getStats(o.id);
        return (
          <div key={o.id} style={{ background: t.rowBg, border: `1px solid ${o.active ? t.cardBorder : t.rowBorder}`, borderRadius: 14, padding: "14px 16px", marginBottom: 10 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <div style={{ width: 42, height: 42, borderRadius: 12, background: o.active ? "linear-gradient(135deg,#1d4ed8,#3b82f6)" : t.rowBg, display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 800, fontSize: 17, color: o.active ? "#fff" : t.textMuted }}>{o.name.charAt(0)}</div>
                <div>
                  <div style={{ fontSize: 14, fontWeight: 700, color: o.active ? t.text : t.textMuted }}>{o.name}</div>
                  <div style={{ fontSize: 11, color: t.textMuted }}>@{o.username}</div>
                  <div style={{ marginTop: 4 }}>
                    <RB role={o.role} />
                    {!o.active && <Badge color="#6b7a8d" bg="rgba(107,122,141,0.1)"> INACTIVE</Badge>}
                  </div>
                </div>
              </div>
              <div style={{ display: "flex", gap: 6 }}>
                <button onClick={() => setResetPwd(o)} title="Reset Password" style={{ background: "rgba(245,158,11,0.1)", border: "1px solid rgba(245,158,11,0.2)", color: "#f59e0b", width: 30, height: 30, borderRadius: 8, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}>
                  <Icon name="key" size={13} />
                </button>
                <button onClick={() => setEditS(o)} style={{ background: "rgba(59,130,246,0.1)", border: "1px solid rgba(59,130,246,0.2)", color: "#60a5fa", width: 30, height: 30, borderRadius: 8, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}>
                  <Icon name="edit" size={13} />
                </button>
                <button onClick={() => onUpdateUsers(users.map(u => u.id === o.id ? { ...u, active: !u.active } : u))} style={{ background: o.active ? "rgba(239,68,68,0.08)" : "rgba(34,197,94,0.08)", border: `1px solid ${o.active ? "rgba(239,68,68,0.2)" : "rgba(34,197,94,0.2)"}`, color: o.active ? "#f87171" : "#4ade80", width: 30, height: 30, borderRadius: 8, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}>
                  {o.active ? <Icon name="lock" size={13} /> : <Icon name="unlock" size={13} />}
                </button>
              </div>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8 }}>
              {[["Clients", st.clients, "#60a5fa"], ["Active", st.activeLoans, "#4ade80"], ["Collected", fc(st.collected), "#a78bfa"]].map(([l, v, c]) => (
                <div key={l} style={{ background: "rgba(0,0,0,0.15)", borderRadius: 9, padding: "9px 10px" }}>
                  <div style={{ fontSize: 9, color: t.textMuted, marginBottom: 3 }}>{l}</div>
                  <div style={{ fontSize: 11, fontWeight: 700, color: c, fontFamily: "'Courier New',monospace" }}>{v}</div>
                </div>
              ))}
            </div>
          </div>
        );
      })}

      {showAdd && (
        <Modal title="Create Staff Account" onClose={() => setShowAdd(false)} theme={t}>
          <Field label="Name *" theme={t}><input style={IS} value={ns.name} onChange={e => setNs(p => ({ ...p, name: e.target.value }))} autoFocus /></Field>
          <Field label="Username *" theme={t}><input style={IS} value={ns.username} onChange={e => setNs(p => ({ ...p, username: e.target.value.toLowerCase().replace(/\s/g, "") }))} /></Field>
          <Field label="Password *" theme={t}><input type="password" style={IS} value={ns.password} onChange={e => setNs(p => ({ ...p, password: e.target.value }))} placeholder="Min 4 chars" /></Field>
          <button onClick={handleAdd} style={{ width: "100%", background: `linear-gradient(135deg,${t.accentBlue},#2563eb)`, border: "none", color: "#fff", padding: "12px", borderRadius: 12, cursor: "pointer", fontWeight: 800, fontSize: 14 }}>✓ Create</button>
        </Modal>
      )}

      {editS && (
        <Modal title="Edit Staff" onClose={() => setEditS(null)} theme={t}>
          <Field label="Name" theme={t}><input style={IS} value={editS.name} onChange={e => setEditS(p => ({ ...p, name: e.target.value }))} /></Field>
          <Field label="Username" theme={t}><input style={IS} value={editS.username} onChange={e => setEditS(p => ({ ...p, username: e.target.value.toLowerCase().replace(/\s/g, "") }))} /></Field>
          <button onClick={() => {
            if (editS.username && users.find(u => u.username === editS.username && u.id !== editS.id)) { showToast("Taken", "error"); return; }
            onUpdateUsers(users.map(u => u.id === editS.id ? { ...u, name: editS.name, username: editS.username } : u));
            setEditS(null);
            showToast("Updated!");
          }} style={{ width: "100%", background: `linear-gradient(135deg,${t.accentBlue},#2563eb)`, border: "none", color: "#fff", padding: "12px", borderRadius: 12, cursor: "pointer", fontWeight: 800 }}>✓ Save</button>
        </Modal>
      )}

      {resetPwd && (
        <Modal title="🔑 Reset Password" onClose={() => { setResetPwd(null); setNewPwd(""); }} theme={t}>
          <div style={{ background: "rgba(245,158,11,0.08)", border: "1px solid rgba(245,158,11,0.2)", borderRadius: 10, padding: "12px 14px", marginBottom: 16 }}>
            <div style={{ fontSize: 13, color: "#f59e0b", fontWeight: 700, marginBottom: 4 }}>Resetting for:</div>
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <div style={{ width: 36, height: 36, borderRadius: 10, background: "linear-gradient(135deg,#1d4ed8,#3b82f6)", display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 800, color: "#fff", fontSize: 15 }}>{resetPwd.name.charAt(0)}</div>
              <div>
                <div style={{ fontSize: 14, fontWeight: 700, color: t.text }}>{resetPwd.name}</div>
                <div style={{ fontSize: 11, color: t.textMuted }}>@{resetPwd.username}</div>
              </div>
            </div>
          </div>
          <Field label="New Password *" theme={t}><input type="password" style={IS} value={newPwd} onChange={e => setNewPwd(e.target.value)} placeholder="Min 4 characters" autoFocus /></Field>
          <button onClick={handleReset} style={{ width: "100%", background: "#f59e0b", border: "none", color: "#000", padding: "12px", borderRadius: 12, cursor: "pointer", fontWeight: 800 }}>✓ Reset</button>
        </Modal>
      )}

      {showStaffReport && (
        <Modal title="📊 Staff Monthly Report" onClose={() => setShowStaffReport(false)} wide theme={t}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 20 }}>
            <div style={{ fontSize: 13, color: t.textSecondary, fontWeight: 600 }}>Month:</div>
            <select style={{ ...IS, width: "auto", minWidth: 160 }} value={reportMonth} onChange={e => setReportMonth(e.target.value)}>
              {availableMonths.map(m => <option key={m} value={m}>{fm(m)}</option>)}
            </select>
          </div>
          {staffReport.length === 0 ? (
            <div style={{ textAlign: "center", padding: 40, color: t.textMuted }}>No staff data for this month.</div>
          ) : staffReport.map(sr => {
            const rateColor = sr.collectionRate >= 80 ? "#22c55e" : sr.collectionRate >= 50 ? "#f59e0b" : "#ef4444";
            return (
              <div key={sr.officer.id} style={{ background: t.rowBg, border: `1px solid ${t.cardBorder}`, borderRadius: 16, padding: "16px", marginBottom: 14 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 14 }}>
                  <div style={{ width: 44, height: 44, borderRadius: 12, background: "linear-gradient(135deg,#1d4ed8,#3b82f6)", display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 800, fontSize: 18, color: "#fff", flexShrink: 0 }}>{sr.officer.name.charAt(0)}</div>
                  <div style={{ flexGrow: 1 }}>
                    <div style={{ fontSize: 15, fontWeight: 700, color: t.text }}>{sr.officer.name}</div>
                    <div style={{ fontSize: 11, color: t.textMuted }}>@{sr.officer.username} · {fm(reportMonth)}</div>
                  </div>
                  <div style={{ textAlign: "right" }}>
                    <div style={{ fontSize: 18, fontWeight: 900, color: rateColor, fontFamily: "'Courier New',monospace" }}>{sr.collectionRate.toFixed(1)}%</div>
                    <div style={{ fontSize: 9, color: t.textMuted }}>Rate</div>
                  </div>
                </div>
                <div style={{ marginBottom: 14 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", fontSize: 10, color: t.textMuted, marginBottom: 5 }}>
                    <span>Collected: {fc(sr.collected)}</span>
                    <span>Expected: {fc(sr.expectedThisMonth)}</span>
                  </div>
                  <div style={{ height: 6, background: t.rowBorder, borderRadius: 4, overflow: "hidden" }}>
                    <div style={{ height: "100%", width: `${Math.min(sr.collectionRate, 100)}%`, background: `linear-gradient(90deg,${rateColor},${rateColor}99)`, borderRadius: 4 }} />
                  </div>
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 8 }}>
                  {[["💰 Disbursed", fc(sr.disbursed), "#60a5fa"], ["📥 Collected", fc(sr.collected), "#4ade80"], ["📊 Outstanding", fc(sr.outstanding), "#f87171"], ["👥 Clients", sr.totalClients, "#93c5fd"], ["🏃 Active", sr.activeClients, "#f59e0b"], ["📋 Loans", sr.loansIssued, "#c4b5fd"], ["✅ Payments", sr.paymentsReceived, "#4ade80"], ["⚠️ Overdue", sr.overdueCount, "#ef4444"], ["💎 Savings", fc(sr.savingsBalance), "#c084fc"]].map(([l, v, c]) => (
                    <div key={l} style={{ background: "rgba(0,0,0,0.15)", borderRadius: 9, padding: "9px 10px" }}>
                      <div style={{ fontSize: 9, color: t.textMuted, marginBottom: 3 }}>{l}</div>
                      <div style={{ fontSize: 12, fontWeight: 700, color: c, fontFamily: "'Courier New',monospace" }}>{v}</div>
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </Modal>
      )}
    </div>
  );
}

// ─── PRINT STYLES ────────────────────────────────────────────────────────────
const PrintStyles = () => (
  <style>{`
    @media print {
      body { background: #fff !important; color: #000 !important; }
      .no-print { display: none !important; }
      .print-modal { max-height: none !important; overflow: visible !important; border: none !important; box-shadow: none !important; }
      * { color: #000 !important; background: #fff !important; border-color: #ccc !important; }
      @page { margin: 10mm; size: A4; }
    }
    @media (max-width: 480px) {
      .responsive-grid-2 { grid-template-columns: 1fr !important; }
      .responsive-grid-3 { grid-template-columns: 1fr 1fr !important; }
      .responsive-grid-4 { grid-template-columns: 1fr 1fr !important; }
    }
  `}</style>
);

// ─── MAIN APP ────────────────────────────────────────────────────────────────
export default function App() {
  const [currentUser, setCurrentUser] = useState(null);
  const [clients, setClients] = useState([]);
  const [users, setUsers] = useState(DEFAULT_USERS);
  const [pendingLoans, setPendingLoans] = useState([]);
  const [loading, setLoading] = useState(true);
  const [sync, setSync] = useState("syncing");
  const [toast, setToast] = useState({ msg: "", type: "success" });
  const [adminMode, setAdminMode] = useState("admin");
  const [view, setView] = useState("dashboard");
  const [selectedClientId, setSelectedClientId] = useState(null);
  const [activeTab, setActiveTab] = useState("loans");
  const [showAddClient, setShowAddClient] = useState(false);
  const [showEditClient, setShowEditClient] = useState(null);
  const [showAddLoan, setShowAddLoan] = useState(false);
  const [showPayment, setShowPayment] = useState(null);
  const [paymentAmount, setPaymentAmount] = useState("");
  const [paymentPreview, setPaymentPreview] = useState(null);
  const [confirmDelete, setConfirmDelete] = useState(null);
  const [showSettings, setShowSettings] = useState(false);
  const [showSavingsTx, setShowSavingsTx] = useState(null);
  const [savingsAmount, setSavingsAmount] = useState("");
  const [adminDirectSavingsInput, setAdminDirectSavingsInput] = useState("");
  const [adminEditInstallment, setAdminEditInstallment] = useState(null);
  const [adminInstOverride, setAdminInstOverride] = useState({ paid: false, paidAmount: "", dueDate: "", paidDate: "" });
  const [showAssignClient, setShowAssignClient] = useState(null);
  const [showProfile, setShowProfile] = useState(false);
  const [profileEdit, setProfileEdit] = useState({ oldPassword: "", newPassword: "", confirmPassword: "" });
  const [clientSearch, setClientSearch] = useState("");
  const [clientFilter, setClientFilter] = useState("all");
  const [expandMonthlyHistory, setExpandMonthlyHistory] = useState(false);
  const [expandFinancials, setExpandFinancials] = useState(true);
  const [acctDateFilter, setAcctDateFilter] = useState("today");
  const [acctSelectedDay, setAcctSelectedDay] = useState(null);
  // UPDATED: Occupation fields added
  const [newClient, setNewClient] = useState({ name: "", phone: "", address: "", idNumber: "", occupation: "", guarantorName: "", guarantorPhone: "", guarantorRelationship: "", guarantorOccupation: "" });
  const [newLoan, setNewLoan] = useState({ principal: "", interestRate: "15", days: "30", startDate: todayStr, excludeWeekends: true });
  const [showRestructure, setShowRestructure] = useState(null);
  const [restructureInput, setRestructureInput] = useState({ newDailyAmount: "", reason: "" });
  const [routeVisited, setRouteVisited] = useState({});
  const [lastBackupDate, setLastBackupDate] = useState(() => localStorage.getItem("creda_last_backup") || null);
  const [dismissedBackup, setDismissedBackup] = useState(false);
  // NEW: Theme state
  const [themeMode, setThemeMode] = useState(() => localStorage.getItem("creda_theme") || "dark");

  const theme = themes[themeMode];
  const IS = getIS(theme);

  const toggleTheme = useCallback(() => {
    const next = themeMode === "dark" ? "light" : "dark";
    setThemeMode(next);
    localStorage.setItem("creda_theme", next);
  }, [themeMode]);

  const showToast = useCallback((msg, type = "success") => {
    setToast({ msg, type });
    setTimeout(() => setToast({ msg: "", type: "success" }), 3000);
  }, []);

  const isAdmin = currentUser?.role === "admin";
  const today = new Date();

  useEffect(() => {
    const unsubs = [
      fbListen("clients", v => { setClients(v || []); setSync("synced"); }),
      fbListen("users", v => {
        if (!v || v.length === 0) { fbSet("users", DEFAULT_USERS); setUsers(DEFAULT_USERS); }
        else setUsers(v);
      }),
      fbListen("pendingLoans", v => setPendingLoans(v || []))
    ];
    setTimeout(() => setLoading(false), 1600);
    return () => unsubs.forEach(u => u());
  }, []);

  const saveClients = async v => { setClients(v); setSync("syncing"); await fbSet("clients", v); setSync("synced"); };
  const saveUsers = async v => { setUsers(v); await fbSet("users", v); };
  const savePending = async v => { setPendingLoans(v); await fbSet("pendingLoans", v); };

  const visibleClients = useMemo(() => isAdmin ? clients : clients.filter(c => c.assignedTo === currentUser?.id), [clients, currentUser, isAdmin]);
  const selectedClient = visibleClients.find(c => c.id === selectedClientId);
  const globalFin = useMemo(() => computeFinancials(isAdmin ? clients : visibleClients), [clients, visibleClients, isAdmin]);

  const filteredClients = useMemo(() => visibleClients.filter(c => {
    const match = c.name.toLowerCase().includes(clientSearch.toLowerCase()) || c.phone.includes(clientSearch);
    const active = c.loans?.find(l => l.status === "active");
    if (clientFilter === "active") return match && active;
    if (clientFilter === "completed") return match && !active && c.loans?.length > 0;
    if (clientFilter === "none") return match && (!c.loans || c.loans.length === 0);
    if (clientFilter === "red") return match && computeClientRisk(c).level === "red";
    if (clientFilter === "amber") return match && computeClientRisk(c).level === "amber";
    return match;
  }), [visibleClients, clientSearch, clientFilter]);

  const stats = useMemo(() => {
    const src = isAdmin ? clients : visibleClients;
    if (isAdmin) {
      let d = 0, e = 0, c = 0, o = 0;
      src.forEach(cl => {
        (cl.loans || []).forEach(l => {
          d += l.principal || 0;
          // UPDATED: Exclude completed loans from expected
          if (l.status !== "completed") {
            e += l.totalRepayable || 0;
          } else {
            e += (l.schedule || []).reduce((s, x) => s + (x.paidAmount || 0), 0);
          }
          (l.schedule || []).forEach(s => {
            if (s.paidAmount > 0) c += s.paidAmount;
            else if (new Date(s.dueDate) < today && !s.paid && l.status !== "completed") o++;
          });
        });
      });
      return { totalDisbursed: d, totalExpected: e, totalCollected: c, outstanding: Math.max(0, e - c), overdueCount: o, totalSavings: src.reduce((a, cl) => a + (cl.savingsBalance || 0), 0) };
    }
    return computeMonthlyStats(src, curMonthKey);
  }, [clients, visibleClients, isAdmin]);

  const monthlyReport = useMemo(() => computeMonthlyReport(clients), [clients]);

  const globalTransactions = useMemo(() => {
    const src = isAdmin ? clients : visibleClients;
    const tx = [];
    src.forEach(c => {
      (c.loans || []).forEach(l => {
        (l.schedule || []).forEach(s => {
          if (s.paymentLog && s.paymentLog.length > 0) {
            s.paymentLog.forEach(pl => {
              tx.push({ clientId: c.id, clientName: c.name, day: s.day, totalDays: l.days, paidAmount: pl.amount, paidDate: pl.date, dueDate: s.dueDate, cascaded: pl.cascaded || false, defaultSettlement: pl.defaultSettlement || false, by: pl.by || "" });
            });
          } else if (s.paidAmount > 0) {
            tx.push({ clientId: c.id, clientName: c.name, day: s.day, totalDays: l.days, paidAmount: s.paidAmount, paidDate: s.paidDate, dueDate: s.dueDate });
          }
        });
      });
    });
    return tx.sort((a, b) => new Date(b.paidDate) - new Date(a.paidDate));
  }, [clients, visibleClients, isAdmin]);

  // UPDATED: Daily collection excludes completed loans
  const dailyCollectionData = useMemo(() => {
    const src = isAdmin ? clients : visibleClients;
    const map = {};
    src.forEach(c => {
      (c.loans || []).forEach(l => {
        if (l.status === "completed") return; // Skip completed loans
        (l.schedule || []).forEach(s => {
          const due = s.dueDate;
          if (!due) return;
          if (!map[due]) map[due] = { date: due, expected: 0, collected: 0, installments: [] };
          map[due].expected += s.payment || 0;
          map[due].collected += s.paidAmount || 0;
          map[due].installments.push({ clientName: c.name, clientId: c.id, day: s.day, totalDays: l.days, payment: s.payment, paidAmount: s.paidAmount || 0, paid: s.paid, paidDate: s.paidDate, dueDate: s.dueDate });
        });
      });
    });
    return Object.values(map).sort((a, b) => new Date(b.date) - new Date(a.date));
  }, [clients, visibleClients, isAdmin]);

  const todayRoute = useMemo(() => {
    const src = visibleClients;
    const route = [];
    src.forEach(c => {
      (c.loans || []).forEach(l => {
        if (l.status !== "active") return;
        const todaySlot = l.schedule?.find(s => s.dueDate === todayStr && !s.paid);
        if (todaySlot) {
          route.push({ clientId: c.id, clientName: c.name, phone: c.phone, loanId: l.id, scheduleIdx: l.schedule.indexOf(todaySlot), payment: todaySlot.payment, paidAmount: todaySlot.paidAmount || 0, paid: todaySlot.paid, risk: computeClientRisk(c) });
        }
      });
    });
    return route;
  }, [visibleClients]);

  const showBackupReminder = useMemo(() => {
    if (dismissedBackup) return false;
    if (!lastBackupDate) return true;
    const daysSince = Math.floor((new Date() - new Date(lastBackupDate)) / (1000 * 60 * 60 * 24));
    const isFriday = new Date().getDay() === 5;
    return daysSince >= 7 || isFriday;
  }, [lastBackupDate, dismissedBackup]);

  const getClientSummary = c => {
    const a = c.loans?.find(l => l.status === "active");
    return {
      active: a,
      overdue: a?.schedule?.filter(s => !s.paid && new Date(s.dueDate) < today).length || 0,
      paid: a?.schedule?.filter(s => s.paid).length || 0,
      total: a?.schedule?.length || 0,
      balance: a ? (a.schedule.find(s => !s.paid)?.balance ?? 0) : 0
    };
  };

  // UPDATED: Registration with occupation fields
  const handleAddClient = () => {
    if (!newClient.name.trim() || !newClient.phone.trim()) return;
    saveClients([{
      ...newClient,
      id: generateId("CL"),
      loans: [],
      savingsBalance: 0,
      savingsLogs: [],
      assignedTo: currentUser?.id,
      assignedToName: currentUser?.name,
      createdAt: todayStr
    }, ...clients]);
    setNewClient({ name: "", phone: "", address: "", idNumber: "", occupation: "", guarantorName: "", guarantorPhone: "", guarantorRelationship: "", guarantorOccupation: "" });
    setShowAddClient(false);
    showToast("Registered!");
  };

  const handleUpdateClient = () => {
    if (!showEditClient?.name.trim()) return;
    saveClients(clients.map(c => c.id === showEditClient.id ? showEditClient : c));
    setShowEditClient(null);
    showToast("Updated!");
  };

  const handleAddLoan = () => {
    if (!newLoan.principal || !selectedClientId) return;
    const p = parseFloat(newLoan.principal);
    const r = parseFloat(newLoan.interestRate);
    const d = parseInt(newLoan.days);
    const calc = calcLoanSchedule(p, r, d, newLoan.startDate, newLoan.excludeWeekends);
    const loan = { id: generateId("LN"), principal: p, interestRate: r, days: d, startDate: newLoan.startDate, ...calc, status: "active", issuedAt: new Date().toISOString(), excludeWeekends: newLoan.excludeWeekends, issuedBy: currentUser?.id, issuedByName: currentUser?.name };
    saveClients(clients.map(c => c.id === selectedClientId ? { ...c, loans: [...(c.loans || []), loan] } : c));
    setNewLoan({ principal: "", interestRate: "15", days: "30", startDate: todayStr, excludeWeekends: true });
    setShowAddLoan(false);
    showToast("Loan issued!");
  };

  const handleRequestLoan = () => {
    if (!newLoan.principal || !selectedClientId) return;
    const p = parseFloat(newLoan.principal);
    const r = parseFloat(newLoan.interestRate);
    const d = parseInt(newLoan.days);
    const calc = calcLoanSchedule(p, r, d, newLoan.startDate, newLoan.excludeWeekends);
    savePending([...pendingLoans, { id: generateId("PL"), clientId: selectedClientId, requestedBy: currentUser?.id, requestedByName: currentUser?.name, requestedAt: new Date().toISOString(), loanData: { principal: p, interestRate: r, days: d, startDate: newLoan.startDate, ...calc, excludeWeekends: newLoan.excludeWeekends } }]);
    setNewLoan({ principal: "", interestRate: "15", days: "30", startDate: todayStr, excludeWeekends: true });
    setShowAddLoan(false);
    showToast("Request submitted!");
  };

  const handleApproveLoan = pl => {
    const loan = { id: generateId("LN"), ...pl.loanData, status: "active", issuedAt: new Date().toISOString(), approvedByName: currentUser?.name };
    saveClients(clients.map(c => c.id === pl.clientId ? { ...c, loans: [...(c.loans || []), loan] } : c));
    savePending(pendingLoans.filter(p => p.id !== pl.id));
    showToast("Approved!");
  };

  const handleRejectLoan = id => { savePending(pendingLoans.filter(p => p.id !== id)); showToast("Rejected", "error"); };

  // UPDATED: Payment handler supports inline payment with amount param
  const handlePayment = (loanOverride, idxOverride, amtOverride) => {
    const amount = amtOverride || parseFloat(paymentAmount);
    const payData = loanOverride ? { clientId: selectedClientId, loanId: loanOverride.id, scheduleIdx: idxOverride } : showPayment;
    if (!amount || !payData) return;
    const { clientId, loanId, scheduleIdx } = payData;
    saveClients(clients.map(c => {
      if (c.id !== clientId) return c;
      return {
        ...c,
        loans: c.loans.map(l => {
          if (l.id !== loanId) return l;
          const ns = applySmartPayment(l.schedule, scheduleIdx, amount, todayStr, currentUser?.name);
          return { ...l, schedule: ns, status: ns.every(s => s.paid) ? "completed" : "active", lastPaymentBy: currentUser?.name };
        })
      };
    }));
    if (!loanOverride) {
      setPaymentAmount(""); setShowPayment(null); setPaymentPreview(null);
    }
    showToast("Payment recorded!");
  };

  // Inline payment handler for RepaymentInputRow
  const handleInlinePayment = (loan, idx, amount) => {
    handlePayment(loan, idx, amount);
  };

  const handleRestructure = () => {
    if (!showRestructure || !restructureInput.newDailyAmount) return;
    const newAmt = parseFloat(restructureInput.newDailyAmount);
    if (isNaN(newAmt) || newAmt <= 0) { showToast("Invalid amount", "error"); return; }
    if (!restructureInput.reason.trim()) { showToast("Reason required", "error"); return; }
    saveClients(clients.map(c => {
      const hasLoan = c.loans?.find(l => l.id === showRestructure.id);
      if (!hasLoan) return c;
      return {
        ...c,
        loans: c.loans.map(l => l.id === showRestructure.id ? restructureLoan(l, newAmt, restructureInput.reason, currentUser?.name) : l)
      };
    }));
    setShowRestructure(null);
    setRestructureInput({ newDailyAmount: "", reason: "" });
    showToast("Loan restructured!");
  };

  const handleSavingsTransaction = () => {
    const amt = parseFloat(savingsAmount);
    if (!amt || !showSavingsTx) return;
    const { type, client } = showSavingsTx;
    saveClients(clients.map(c => {
      if (c.id !== client.id) return c;
      const cur = c.savingsBalance || 0;
      if (type === "withdraw" && amt > cur) { showToast("Insufficient!", "error"); return c; }
      const nb = type === "deposit" ? cur + amt : cur - amt;
      return { ...c, savingsBalance: nb, savingsLogs: [{ id: generateId("TX"), date: todayStr, type, amount: amt, balanceAfter: nb, recordedBy: currentUser?.name }, ...(c.savingsLogs || [])] };
    }));
    setSavingsAmount(""); setShowSavingsTx(null);
    showToast(`${type === "deposit" ? "Deposit" : "Withdrawal"} done!`);
  };

  const handleAdminSavingsAdj = () => {
    const nb = parseFloat(adminDirectSavingsInput);
    if (isNaN(nb) || !showSavingsTx) return;
    const { client } = showSavingsTx;
    saveClients(clients.map(c => c.id !== client.id ? c : { ...c, savingsBalance: nb, savingsLogs: [{ id: generateId("TX"), date: todayStr, type: "admin_adjustment", amount: Math.abs(nb - (c.savingsBalance || 0)), balanceAfter: nb, recordedBy: currentUser?.name }, ...(c.savingsLogs || [])] }));
    setAdminDirectSavingsInput(""); setShowSavingsTx(null);
    showToast("Adjusted!");
  };

  const handleAdminInstOverride = () => {
    if (!adminEditInstallment) return;
    const { client, loan, idx } = adminEditInstallment;
    const pAmt = parseFloat(adminInstOverride.paidAmount) || 0;
    saveClients(clients.map(c => {
      if (c.id !== client.id) return c;
      return {
        ...c,
        loans: c.loans.map(l => {
          if (l.id !== loan.id) return l;
          const updatedSchedule = l.schedule.map((s, i) => {
            if (i !== idx) return s;
            return { ...s, paid: adminInstOverride.paid, dueDate: adminInstOverride.dueDate, paidDate: adminInstOverride.paid ? (adminInstOverride.paidDate || todayStr) : null, paidAmount: adminInstOverride.paid ? pAmt : 0, overpayment: adminInstOverride.paid && pAmt > s.payment ? pAmt - s.payment : 0, shortfall: adminInstOverride.paid && pAmt < s.payment ? s.payment - pAmt : 0, paymentLog: adminInstOverride.paid ? [{ amount: pAmt, date: adminInstOverride.paidDate || todayStr, by: currentUser?.name, at: new Date().toISOString() }] : [] };
          });
          let run = l.totalRepayable;
          const rc = updatedSchedule.map(s => { if (s.paidAmount > 0) run = Math.max(0, run - s.paidAmount); return { ...s, balance: run }; });
          return { ...l, schedule: rc, status: rc.every(s => s.paid) ? "completed" : "active" };
        })
      };
    }));
    setAdminEditInstallment(null);
    showToast("Override applied!");
  };

  const handleAssignClient = (cId, sId) => {
    const staff = users.find(u => u.id === sId);
    saveClients(clients.map(c => c.id === cId ? { ...c, assignedTo: sId, assignedToName: staff?.name } : c));
    setShowAssignClient(null);
    showToast("Reassigned!");
  };

  const handleDeleteClient = id => {
    saveClients(clients.filter(c => c.id !== id));
    setConfirmDelete(null);
    setView("clients");
    showToast("Deleted", "error");
  };

  const handleChangePassword = () => {
    if (!profileEdit.oldPassword) { showToast("Enter current password", "error"); return; }
    if (profileEdit.oldPassword !== currentUser.password) { showToast("Wrong password", "error"); return; }
    if (!profileEdit.newPassword || profileEdit.newPassword.length < 4) { showToast("Min 4 chars", "error"); return; }
    if (profileEdit.newPassword !== profileEdit.confirmPassword) { showToast("Don't match", "error"); return; }
    const upd = { ...currentUser, password: profileEdit.newPassword };
    saveUsers(users.map(u => u.id === currentUser.id ? upd : u));
    setCurrentUser(upd);
    setShowProfile(false);
    setProfileEdit({ oldPassword: "", newPassword: "", confirmPassword: "" });
    showToast("Password changed!");
  };

  const exportData = () => {
    const blob = new Blob([JSON.stringify({ clients, users, pendingLoans, v: "10.0", at: new Date().toISOString() }, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `creda_backup_${todayStr}.json`;
    a.click();
    URL.revokeObjectURL(url);
    localStorage.setItem("creda_last_backup", todayStr);
    setLastBackupDate(todayStr);
    setDismissedBackup(false);
    showToast("Downloaded!");
  };

  if (loading) {
    return (
      <div style={{ minHeight: "100vh", background: "#060f1a", display: "flex", alignItems: "center", justifyContent: "center", flexDirection: "column", gap: 16 }}>
        <div style={{ width: 56, height: 56, borderRadius: 16, background: "linear-gradient(135deg,#0a5c36,#0d7a48)", border: "2px solid rgba(200,146,10,0.4)", display: "flex", alignItems: "center", justifyContent: "center" }}>
          <svg width="30" height="30" viewBox="0 0 80 80" fill="none">
            <path d="M48 22A19 19 0 1 0 48 58" stroke="white" strokeWidth="5.5" strokeLinecap="round" fill="none" />
            <path d="M42 30L53 20L64 30" stroke="#c8920a" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" fill="none" />
            <line x1="53" y1="20" x2="53" y2="44" stroke="#c8920a" strokeWidth="4" strokeLinecap="round" />
          </svg>
        </div>
        <div style={{ color: "#e8f4fd", fontSize: 16, fontWeight: 700, fontFamily: "serif", letterSpacing: 2 }}>CREDA Finance</div>
        <div style={{ color: "#3a5a70", fontSize: 12 }}>Connecting…</div>
      </div>
    );
  }

  if (!currentUser) {
    return <LoginScreen users={users} onLogin={u => { setCurrentUser(u); setProfileEdit({ oldPassword: "", newPassword: "", confirmPassword: "" }); }} />;
  }

  const t = theme;

  // ── Backup Reminder Banner ──────────────────────────────────────────────
  const BackupBanner = () => {
    if (!showBackupReminder || !isAdmin) return null;
    const daysSince = lastBackupDate ? Math.floor((new Date() - new Date(lastBackupDate)) / (1000 * 60 * 60 * 24)) : null;
    return (
      <div className="no-print" style={{ background: "rgba(245,158,11,0.1)", border: "1px solid rgba(245,158,11,0.3)", borderRadius: 12, padding: "10px 14px", marginBottom: 16, display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ fontSize: 18 }}>💾</span>
          <div>
            <div style={{ fontSize: 12, fontWeight: 700, color: "#f59e0b" }}>Backup Reminder</div>
            <div style={{ fontSize: 10, color: "#7a6030" }}>{daysSince === null ? "No backup recorded" : `Last backup ${daysSince} day${daysSince !== 1 ? "s" : ""} ago`}</div>
          </div>
        </div>
        <div style={{ display: "flex", gap: 6 }}>
          <button onClick={() => { exportData(); }} style={{ background: "#f59e0b", border: "none", color: "#000", padding: "6px 12px", borderRadius: 8, cursor: "pointer", fontWeight: 700, fontSize: 11 }}>Backup Now</button>
          <button onClick={() => setDismissedBackup(true)} style={{ background: t.rowBg, border: "none", color: t.textMuted, padding: "6px 10px", borderRadius: 8, cursor: "pointer", fontSize: 11 }}>×</button>
        </div>
      </div>
    );
  };

  // ── Today's Route Panel ──────────────────────────────────────────────────
  const TodayRoute = () => {
    if (isAdmin) return null;
    if (todayRoute.length === 0) return null;
    const totalExpected = todayRoute.reduce((s, r) => s + r.payment, 0);
    const totalCollected = todayRoute.reduce((s, r) => s + (r.paidAmount || 0), 0);
    const visitedCount = Object.values(routeVisited).filter(Boolean).length;

    return (
      <div style={{ background: `linear-gradient(135deg,rgba(59,130,246,0.08),rgba(34,197,94,0.06))`, border: `1px solid rgba(96,165,250,0.2)`, borderRadius: 16, padding: 16, marginBottom: 20 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <Icon name="route" size={16} />
            <div>
              <div style={{ fontSize: 14, fontWeight: 800, color: "#60a5fa" }}>Today's Route</div>
              <div style={{ fontSize: 10, color: t.textMuted }}>{fd(todayStr)} · {todayRoute.length} client{todayRoute.length !== 1 ? "s" : ""} · {visitedCount} visited</div>
            </div>
          </div>
          <div style={{ textAlign: "right" }}>
            <div style={{ fontSize: 13, fontWeight: 800, color: "#4ade80", fontFamily: "'Courier New',monospace" }}>{fc(totalCollected)}</div>
            <div style={{ fontSize: 9, color: t.textMuted }}>of {fc(totalExpected)}</div>
          </div>
        </div>

        <div style={{ height: 4, background: t.rowBorder, borderRadius: 4, overflow: "hidden", marginBottom: 12 }}>
          <div style={{ height: "100%", width: `${totalExpected > 0 ? (totalCollected / totalExpected) * 100 : 0}%`, background: "linear-gradient(90deg,#22c55e,#4ade80)", borderRadius: 4 }} />
        </div>

        {todayRoute.map((r, idx) => {
          const visited = routeVisited[r.clientId];
          return (
            <div key={idx} style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 12px", background: visited ? "rgba(34,197,94,0.06)" : t.rowBg, border: `1px solid ${r.risk.level === "red" ? "rgba(239,68,68,0.25)" : r.risk.level === "amber" ? "rgba(245,158,11,0.2)" : "rgba(34,197,94,0.1)"}`, borderRadius: 10, marginBottom: 8 }}>
              <button onClick={() => setRouteVisited(prev => ({ ...prev, [r.clientId]: !visited }))} style={{ width: 26, height: 26, borderRadius: 7, flexShrink: 0, background: visited ? "#22c55e" : t.rowBg, border: visited ? "none" : `1px solid ${t.rowBorder}`, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", color: visited ? "#000" : t.textMuted }}>
                {visited ? <Icon name="check" size={12} /> : "○"}
              </button>
              <div style={{ flexGrow: 1, cursor: "pointer" }} onClick={() => { setSelectedClientId(r.clientId); setView("detail"); }}>
                <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  <span style={{ fontSize: 13, fontWeight: 700, color: visited ? "#4ade80" : t.text }}>{r.clientName}</span>
                  <span style={{ fontSize: 12 }}>{r.risk.emoji}</span>
                </div>
                <div style={{ fontSize: 10, color: t.textMuted }}>{r.phone}</div>
              </div>
              <div style={{ textAlign: "right" }}>
                <div style={{ fontSize: 13, fontWeight: 800, color: r.paid ? "#4ade80" : "#60a5fa", fontFamily: "'Courier New',monospace" }}>{fc(r.payment)}</div>
                {r.paidAmount > 0 && !r.paid && <div style={{ fontSize: 9, color: "#f87171" }}>+{fc(r.paidAmount)} partial</div>}
              </div>
              {!r.paid && (
                <button onClick={() => { setSelectedClientId(r.clientId); setView("detail"); setShowPayment({ clientId: r.clientId, loanId: r.loanId, scheduleIdx: r.scheduleIdx }); setPaymentAmount(r.payment.toFixed(2)); }} style={{ background: `linear-gradient(135deg,${t.accentGreen},#16a34a)`, border: "none", color: "#000", padding: "6px 10px", borderRadius: 7, cursor: "pointer", fontWeight: 700, fontSize: 10, flexShrink: 0 }}>Pay</button>
              )}
            </div>
          );
        })}
      </div>
    );
  };

  // ═══════════════════════════════════════════════════════════════════════════
  // DASHBOARD
  // ═══════════════════════════════════════════════════════════════════════════
  const Dashboard = () => (
    <div>
      <div style={{ marginBottom: 22, display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
        <div>
          <h1 style={{ margin: 0, fontSize: 24, fontWeight: 800, color: t.text }}>{isAdmin ? "Dashboard" : "My Dashboard"}</h1>
          <p style={{ margin: "4px 0 0", color: t.textMuted, fontSize: 13 }}>{isAdmin ? `${clients.length} clients` : `${visibleClients.length} clients · ${fm(curMonthKey)}`}</p>
        </div>
        <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 6 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <button onClick={toggleTheme} className="no-print" title={themeMode === "dark" ? "Switch to Light" : "Switch to Dark"} style={{ background: t.rowBg, border: `1px solid ${t.rowBorder}`, color: t.textSecondary, width: 32, height: 32, borderRadius: 8, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}>
              <Icon name={themeMode === "dark" ? "sun" : "moon"} size={14} />
            </button>
            <RB role={currentUser.role} />
          </div>
          {isAdmin && (
            <button onClick={() => setAdminMode("accountant")} className="no-print" style={{ background: "rgba(167,139,250,0.15)", border: "1px solid rgba(167,139,250,0.3)", color: "#a78bfa", padding: "6px 12px", borderRadius: 9, cursor: "pointer", fontWeight: 700, fontSize: 11 }}>📊 Finance</button>
          )}
        </div>
      </div>

      <BackupBanner />

      {!isAdmin && (
        <div style={{ background: "rgba(96,165,250,0.08)", border: "1px solid rgba(96,165,250,0.2)", borderRadius: 12, padding: "10px 14px", marginBottom: 16, fontSize: 12, color: "#60a5fa", fontWeight: 700 }}>
          📅 {fm(curMonthKey)} only — Resets next month
        </div>
      )}

      {isAdmin && pendingLoans.length > 0 && (
        <div onClick={() => setView("staff")} className="no-print" style={{ background: "rgba(245,158,11,0.08)", border: "1px solid rgba(245,158,11,0.25)", borderRadius: 12, padding: "12px 14px", marginBottom: 16, cursor: "pointer", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <Icon name="bell" size={16} />
            <div style={{ fontSize: 13, fontWeight: 700, color: "#f59e0b" }}>{pendingLoans.length} Pending</div>
          </div>
          <Icon name="chevronDown" size={14} />
        </div>
      )}

      <TodayRoute />

      <div className="responsive-grid-2" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 20 }}>
        <SC label={isAdmin ? "Disbursed" : "This Month"} value={fc(stats.totalDisbursed)} accent={t.accentBlue} theme={t} />
        <SC label="Collected" value={fc(stats.totalCollected)} accent={t.accentGreen} theme={t} />
        <SC label="Outstanding" value={fc(stats.outstanding)} accent="#f59e0b" theme={t} />
        <SC label="Savings" value={fc(stats.totalSavings)} accent="#a855f7" theme={t} />
      </div>

      {isAdmin && <FP fin={globalFin} expandFinancials={expandFinancials} setExpandFinancials={setExpandFinancials} theme={t} />}

      {/* UPDATED: Monthly report with defaulting clients section */}
      {isAdmin && (
        <div style={{ background: t.rowBg, border: `1px solid ${t.rowBorder}`, borderRadius: 14, padding: 16, marginBottom: 20 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <div>
              <h3 style={{ margin: 0, fontSize: 13, fontWeight: 700, color: "#93c5fd", textTransform: "uppercase" }}>Monthly Disbursement Report</h3>
              <p style={{ margin: "2px 0 0", fontSize: 11, color: t.textMuted }}>Loan issuance, collection & defaults by month</p>
            </div>
            <div style={{ display: "flex", gap: 6 }}>
              <button onClick={() => window.print()} className="no-print" style={{ background: "rgba(96,165,250,0.08)", border: "none", borderRadius: 8, color: "#60a5fa", padding: "5px 10px", fontSize: 11, cursor: "pointer" }}>
                <Icon name="printer" size={12} />
              </button>
              <button onClick={() => setExpandMonthlyHistory(!expandMonthlyHistory)} className="no-print" style={{ background: "rgba(147,197,253,0.1)", border: "none", borderRadius: 8, color: "#93c5fd", padding: "5px 12px", fontSize: 11, cursor: "pointer", fontWeight: 600 }}>{expandMonthlyHistory ? "Hide" : "View"}</button>
            </div>
          </div>
          {expandMonthlyHistory && (
            <div style={{ marginTop: 16, display: "flex", flexDirection: "column", gap: 10 }}>
              {monthlyReport.length === 0 ? (
                <div style={{ fontSize: 11, color: t.textMuted, textAlign: "center" }}>No data.</div>
              ) : monthlyReport.map(item => (
                <div key={item.month} style={{ padding: "12px 14px", background: t.name === "dark" ? "rgba(0,0,0,0.2)" : "rgba(0,0,0,0.03)", borderRadius: 12, borderLeft: "3px solid #22c55e" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
                    <div style={{ fontWeight: 700, color: t.text, fontSize: 13 }}>{fm(item.month)}</div>
                    <div style={{ fontSize: 11, color: t.textMuted }}>{item.loanCount} loan{item.loanCount !== 1 ? "s" : ""} · {item.clientCount} client{item.clientCount !== 1 ? "s" : ""}</div>
                  </div>
                  <div className="responsive-grid-4" style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr", gap: 8 }}>
                    {[["DISBURSED", item.disbursed, "#93c5fd"], ["COLLECTED", item.collected, "#4ade80"], ["INTEREST", item.interest, "#c4b5fd"], ["OUTSTANDING", item.outstanding, "#f87171"]].map(([l, v, c]) => (
                      <div key={l}>
                        <div style={{ fontSize: 8, color: t.textMuted }}>{l}</div>
                        <div style={{ fontSize: 10, fontWeight: 700, color: c, fontFamily: "'Courier New',monospace" }}>{fc(v)}</div>
                      </div>
                    ))}
                  </div>
                  <div style={{ marginTop: 8 }}>
                    <div style={{ display: "flex", justifyContent: "space-between", fontSize: 9, color: t.textMuted, marginBottom: 3 }}>
                      <span>Collection</span>
                      <span style={{ color: item.collected >= item.expected ? "#4ade80" : "#f59e0b", fontWeight: 700 }}>{item.expected > 0 ? ((item.collected / item.expected) * 100).toFixed(1) : 0}%</span>
                    </div>
                    <div style={{ height: 4, background: t.rowBorder, borderRadius: 4, overflow: "hidden" }}>
                      <div style={{ height: "100%", width: `${item.expected > 0 ? Math.min((item.collected / item.expected) * 100, 100) : 0}%`, background: "linear-gradient(90deg,#22c55e,#4ade80)", borderRadius: 4 }} />
                    </div>
                  </div>

                  {/* DEFAULTING CLIENTS SECTION */}
                  {item.defaultingClients && item.defaultingClients.length > 0 && (
                    <div style={{ marginTop: 12, background: "rgba(239,68,68,0.06)", border: "1px solid rgba(239,68,68,0.15)", borderRadius: 10, padding: "10px 12px" }}>
                      <div style={{ fontSize: 10, color: "#f87171", fontWeight: 700, marginBottom: 8, display: "flex", alignItems: "center", gap: 4 }}>
                        ⚠️ DEFAULTING CLIENTS ({item.defaultingClients.length})
                      </div>
                      {item.defaultingClients.map((dc, dcIdx) => (
                        <div key={dcIdx} onClick={() => { setSelectedClientId(dc.clientId); setView("detail"); }} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "6px 10px", background: "rgba(239,68,68,0.04)", border: "1px solid rgba(239,68,68,0.1)", borderRadius: 8, marginBottom: 4, cursor: "pointer" }}>
                          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                            <span style={{ fontSize: 12 }}>{dc.risk.emoji}</span>
                            <div>
                              <div style={{ fontSize: 11, fontWeight: 700, color: t.text }}>{dc.clientName}</div>
                              <div style={{ fontSize: 9, color: t.textMuted }}>{dc.phone} · {dc.defaultDays} day{dc.defaultDays !== 1 ? "s" : ""} overdue</div>
                            </div>
                          </div>
                          <div style={{ fontSize: 12, fontWeight: 800, color: "#ef4444", fontFamily: "'Courier New',monospace" }}>{fc(dc.defaultAmount)}</div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
        <div style={{ fontSize: 14, fontWeight: 700, color: t.textSecondary }}>Recent</div>
        <button onClick={() => setView("clients")} className="no-print" style={{ background: "none", border: "none", color: t.accentBlue, fontSize: 12, cursor: "pointer" }}>All →</button>
      </div>
      {visibleClients.slice(0, 5).map(c => {
        const { active, overdue, balance } = getClientSummary(c);
        const risk = computeClientRisk(c);
        return (
          <div key={c.id} onClick={() => { setSelectedClientId(c.id); setView("detail"); }} style={{ background: t.rowBg, border: `1px solid ${t.rowBorder}`, borderRadius: 12, padding: "12px 15px", cursor: "pointer", display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <div style={{ width: 36, height: 36, borderRadius: 10, background: "linear-gradient(135deg,#1d4ed8,#3b82f6)", display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 800, fontSize: 15, color: "#fff", flexShrink: 0 }}>{c.name.charAt(0).toUpperCase()}</div>
              <div>
                <div style={{ fontWeight: 600, color: t.text, fontSize: 14 }}>{c.name}</div>
                <div style={{ fontSize: 10, color: t.textMuted }}>{c.phone}{c.occupation ? ` · ${c.occupation}` : ""}</div>
              </div>
            </div>
            <div style={{ textAlign: "right", display: "flex", alignItems: "center", gap: 8 }}>
              <span style={{ fontSize: 14 }}>{risk.emoji}</span>
              {active ? <div style={{ fontSize: 12, fontWeight: 700, color: "#60a5fa", fontFamily: "'Courier New',monospace" }}>{fc(balance)}</div> : <div style={{ fontSize: 11, color: t.textDim }}>No loan</div>}
            </div>
          </div>
        );
      })}
    </div>
  );

  // ═══════════════════════════════════════════════════════════════════════════
  // RENDER APP
  // ═══════════════════════════════════════════════════════════════════════════
  return (
    <div style={{ minHeight: "100vh", background: t.bg, color: t.text, fontFamily: "-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif", transition: "background 0.3s, color 0.3s" }}>
      <PrintStyles />
      <Toast msg={toast.msg} type={toast.type} />

      {/* HEADER */}
      <div className="no-print" style={{ background: t.cardBg, borderBottom: `1px solid ${t.cardBorder}`, padding: "10px 16px", display: "flex", justifyContent: "space-between", alignItems: "center", position: "sticky", top: 0, zIndex: 100, backdropFilter: "blur(12px)" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          {view !== "dashboard" && (
            <button onClick={() => setView(view === "detail" ? "clients" : "dashboard")} style={{ background: "none", border: "none", color: t.textSecondary, cursor: "pointer", padding: 4 }}>
              <Icon name="back" size={18} />
            </button>
          )}
          <div style={{ fontSize: 16, fontWeight: 800, color: t.text, letterSpacing: 1, fontFamily: "serif" }}>CREDA</div>
          <div style={{ fontSize: 8, padding: "2px 6px", borderRadius: 4, background: sync === "synced" ? "rgba(34,197,94,0.15)" : "rgba(245,158,11,0.15)", color: sync === "synced" ? "#4ade80" : "#f59e0b" }}>{sync === "synced" ? "●" : "◌"}</div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <button onClick={toggleTheme} title={themeMode === "dark" ? "Light Mode" : "Dark Mode"} style={{ background: t.rowBg, border: `1px solid ${t.rowBorder}`, color: t.textSecondary, width: 30, height: 30, borderRadius: 8, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}>
            <Icon name={themeMode === "dark" ? "sun" : "moon"} size={13} />
          </button>
          <button onClick={() => setShowProfile(true)} style={{ background: t.rowBg, border: `1px solid ${t.rowBorder}`, color: t.textSecondary, borderRadius: 8, padding: "5px 10px", cursor: "pointer", fontSize: 11, fontWeight: 600 }}>
            {currentUser.name.charAt(0)}
          </button>
          <button onClick={() => setShowSettings(true)} style={{ background: "none", border: "none", color: t.textMuted, cursor: "pointer", fontSize: 16, padding: 4 }}>⚙</button>
        </div>
      </div>

      {/* CONTENT */}
      <div style={{ padding: "16px 16px 100px", maxWidth: 600, margin: "0 auto" }}>
        {view === "dashboard" && <Dashboard />}

        {view === "staff" && isAdmin && (
          <StaffPanel users={users} clients={clients} pendingLoans={pendingLoans} currentUser={currentUser} onUpdateUsers={saveUsers} onApproveLoan={handleApproveLoan} onRejectLoan={handleRejectLoan} showToast={showToast} theme={t} />
        )}

        {view === "clients" && (
          <div>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
              <h1 style={{ margin: 0, fontSize: 22, fontWeight: 800, color: t.text }}>Clients</h1>
              <button onClick={() => setShowAddClient(true)} className="no-print" style={{ background: `linear-gradient(135deg,${t.accentBlue},#2563eb)`, border: "none", color: "#fff", padding: "9px 16px", borderRadius: 11, cursor: "pointer", fontWeight: 700, fontSize: 13, display: "flex", alignItems: "center", gap: 6 }}>
                <Icon name="plus" size={13} />Add
              </button>
            </div>

            <div style={{ position: "relative", marginBottom: 12 }}>
              <Icon name="search" size={14} />
              <input style={{ ...IS, paddingLeft: 36 }} placeholder="Search clients..." value={clientSearch} onChange={e => setClientSearch(e.target.value)} />
            </div>

            <div className="no-print" style={{ display: "flex", gap: 6, marginBottom: 16, flexWrap: "wrap" }}>
              {[["all", "All"], ["active", "Active"], ["completed", "Done"], ["none", "No Loan"], ["red", "🔴 Risk"], ["amber", "🟡 Watch"]].map(([v, l]) => (
                <button key={v} onClick={() => setClientFilter(v)} style={{ background: clientFilter === v ? `${t.accentBlue}20` : t.rowBg, border: `1px solid ${clientFilter === v ? t.accentBlue : t.rowBorder}`, color: clientFilter === v ? t.accentBlue : t.textMuted, padding: "5px 12px", borderRadius: 8, cursor: "pointer", fontSize: 11, fontWeight: 600 }}>{l}</button>
              ))}
            </div>

            {filteredClients.map(c => {
              const { active, overdue, balance } = getClientSummary(c);
              const risk = computeClientRisk(c);
              return (
                <div key={c.id} onClick={() => { setSelectedClientId(c.id); setView("detail"); }} style={{ background: t.rowBg, border: `1px solid ${t.rowBorder}`, borderRadius: 12, padding: "12px 15px", cursor: "pointer", display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                    <div style={{ width: 36, height: 36, borderRadius: 10, background: "linear-gradient(135deg,#1d4ed8,#3b82f6)", display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 800, fontSize: 15, color: "#fff", flexShrink: 0 }}>{c.name.charAt(0).toUpperCase()}</div>
                    <div>
                      <div style={{ fontWeight: 600, color: t.text, fontSize: 14 }}>{c.name}</div>
                      <div style={{ fontSize: 10, color: t.textMuted }}>{c.phone}{c.occupation ? ` · ${c.occupation}` : ""}</div>
                      {isAdmin && c.assignedToName && <div style={{ fontSize: 9, color: t.textDim }}>→ {c.assignedToName}</div>}
                    </div>
                  </div>
                  <div style={{ textAlign: "right", display: "flex", alignItems: "center", gap: 8 }}>
                    <span style={{ fontSize: 14 }}>{risk.emoji}</span>
                    {active ? <div style={{ fontSize: 12, fontWeight: 700, color: "#60a5fa", fontFamily: "'Courier New',monospace" }}>{fc(balance)}</div> : <div style={{ fontSize: 11, color: t.textDim }}>No loan</div>}
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {view === "detail" && selectedClient && (
          <div>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 20 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                <div style={{ width: 48, height: 48, borderRadius: 14, background: "linear-gradient(135deg,#1d4ed8,#3b82f6)", display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 800, fontSize: 20, color: "#fff", flexShrink: 0 }}>{selectedClient.name.charAt(0).toUpperCase()}</div>
                <div>
                  <div style={{ fontSize: 18, fontWeight: 800, color: t.text }}>{selectedClient.name}</div>
                  <div style={{ fontSize: 12, color: t.textMuted }}>{selectedClient.phone}</div>
                  {selectedClient.occupation && <div style={{ fontSize: 11, color: t.textSecondary, display: "flex", alignItems: "center", gap: 4 }}><Icon name="briefcase" size={11} /> {selectedClient.occupation}</div>}
                  <div style={{ marginTop: 4, display: "flex", gap: 6, alignItems: "center" }}>
                    {(() => { const risk = computeClientRisk(selectedClient); return <Badge color={risk.color} bg={risk.bg}>{risk.emoji} {risk.label}</Badge>; })()}
                    {selectedClient.assignedToName && <span style={{ fontSize: 10, color: t.textMuted }}>→ {selectedClient.assignedToName}</span>}
                  </div>
                </div>
              </div>
              <div style={{ display: "flex", gap: 6 }} className="no-print">
                {isAdmin && (
                  <>
                    <button onClick={() => setShowAssignClient(selectedClient)} style={{ background: "rgba(167,139,250,0.1)", border: "1px solid rgba(167,139,250,0.2)", color: "#a78bfa", width: 30, height: 30, borderRadius: 8, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}>
                      <Icon name="users" size={13} />
                    </button>
                  </>
                )}
                <button onClick={() => {
                  const ec = { ...selectedClient };
                  if (!ec.occupation) ec.occupation = "";
                  if (!ec.guarantorOccupation) ec.guarantorOccupation = "";
                  setShowEditClient(ec);
                }} style={{ background: `rgba(59,130,246,0.1)`, border: "1px solid rgba(59,130,246,0.2)", color: "#60a5fa", width: 30, height: 30, borderRadius: 8, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}>
                  <Icon name="edit" size={13} />
                </button>
                <button onClick={() => window.print()} style={{ background: "rgba(96,165,250,0.08)", border: "1px solid rgba(96,165,250,0.15)", color: "#60a5fa", width: 30, height: 30, borderRadius: 8, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}>
                  <Icon name="printer" size={13} />
                </button>
                {isAdmin && (
                  <button onClick={() => setConfirmDelete(selectedClient)} style={{ background: "rgba(239,68,68,0.08)", border: "1px solid rgba(239,68,68,0.2)", color: "#f87171", width: 30, height: 30, borderRadius: 8, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}>
                    <Icon name="trash" size={13} />
                  </button>
                )}
              </div>
            </div>

            {/* Client Info Card */}
            <div style={{ background: t.rowBg, border: `1px solid ${t.rowBorder}`, borderRadius: 14, padding: "14px 16px", marginBottom: 16 }}>
              <div className="responsive-grid-2" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                {[
                  ["📞 Phone", selectedClient.phone],
                  ["🏠 Address", selectedClient.address || "—"],
                  ["🆔 ID", selectedClient.idNumber || "—"],
                  ["💼 Occupation", selectedClient.occupation || "—"],
                  ["👤 Guarantor", selectedClient.guarantorName || "—"],
                  ["📱 G. Phone", selectedClient.guarantorPhone || "—"],
                  ["🤝 Relationship", selectedClient.guarantorRelationship || "—"],
                  ["💼 G. Occupation", selectedClient.guarantorOccupation || "—"]
                ].map(([l, v]) => (
                  <div key={l}>
                    <div style={{ fontSize: 9, color: t.textMuted, marginBottom: 2 }}>{l}</div>
                    <div style={{ fontSize: 12, color: t.text, fontWeight: 600 }}>{v}</div>
                  </div>
                ))}
              </div>
            </div>

            {/* Tabs */}
            <div className="no-print" style={{ display: "flex", gap: 6, marginBottom: 16, flexWrap: "wrap" }}>
              {["loans", "savings", "history"].map(tab => (
                <button key={tab} onClick={() => setActiveTab(tab)} style={{ background: activeTab === tab ? `${t.accentBlue}20` : t.rowBg, border: `1px solid ${activeTab === tab ? t.accentBlue : t.rowBorder}`, color: activeTab === tab ? t.accentBlue : t.textMuted, padding: "7px 16px", borderRadius: 9, cursor: "pointer", fontSize: 12, fontWeight: 600, textTransform: "capitalize" }}>{tab}</button>
              ))}
            </div>

            {activeTab === "loans" && (
              <div>
                <button onClick={() => setShowAddLoan(true)} className="no-print" style={{ width: "100%", background: `linear-gradient(135deg,${t.accentGreen},#16a34a)`, border: "none", color: "#000", padding: "12px", borderRadius: 12, cursor: "pointer", fontWeight: 800, fontSize: 14, marginBottom: 16, display: "flex", alignItems: "center", justifyContent: "center", gap: 6 }}>
                  <Icon name="plus" size={14} />{isAdmin ? "Issue Loan" : "Request Loan"}
                </button>

                {(selectedClient.loans || []).map((l, idx) => (
                  <LCC key={l.id} loan={l} num={idx + 1} total={selectedClient.loans.length} isAdmin={isAdmin} today={today}
                    onPay={(loan, i, amt) => {
                      if (amt) {
                        handleInlinePayment(loan, i, amt);
                      } else {
                        setShowPayment({ clientId: selectedClient.id, loanId: loan.id, scheduleIdx: i });
                        setPaymentAmount(loan.schedule[i].payment.toFixed(2));
                      }
                    }}
                    onOverride={(loan, i, s) => { setAdminEditInstallment({ client: selectedClient, loan, idx: i }); setAdminInstOverride({ paid: s.paid, paidAmount: s.paidAmount?.toString() || "", dueDate: s.dueDate, paidDate: s.paidDate || "" }); }}
                    onRestructure={l => { setShowRestructure(l); setRestructureInput({ newDailyAmount: l.dailyPayment.toFixed(2), reason: "" }); }}
                    theme={t}
                    currentUser={currentUser}
                  />
                ))}
              </div>
            )}

            {activeTab === "savings" && (
              <div>
                <div style={{ background: "linear-gradient(135deg,rgba(168,85,247,0.1),rgba(59,130,246,0.08))", border: "1px solid rgba(168,85,247,0.2)", borderRadius: 16, padding: "18px 20px", marginBottom: 16, textAlign: "center" }}>
                  <div style={{ fontSize: 10, color: "#a855f7", letterSpacing: 1.5, marginBottom: 6 }}>SAVINGS BALANCE</div>
                  <div style={{ fontSize: 28, fontWeight: 900, color: t.text, fontFamily: "'Courier New',monospace" }}>{fc(selectedClient.savingsBalance || 0)}</div>
                </div>
                <div className="no-print" style={{ display: "flex", gap: 8, marginBottom: 16 }}>
                  <button onClick={() => setShowSavingsTx({ type: "deposit", client: selectedClient })} style={{ flex: 1, background: `rgba(34,197,94,0.08)`, border: "1px solid rgba(34,197,94,0.2)", color: "#4ade80", padding: "10px", borderRadius: 10, cursor: "pointer", fontWeight: 700, fontSize: 12 }}>📥 Deposit</button>
                  <button onClick={() => setShowSavingsTx({ type: "withdraw", client: selectedClient })} style={{ flex: 1, background: "rgba(239,68,68,0.08)", border: "1px solid rgba(239,68,68,0.2)", color: "#f87171", padding: "10px", borderRadius: 10, cursor: "pointer", fontWeight: 700, fontSize: 12 }}>📤 Withdraw</button>
                  {isAdmin && (
                    <button onClick={() => { setShowSavingsTx({ type: "admin", client: selectedClient }); setAdminDirectSavingsInput((selectedClient.savingsBalance || 0).toString()); }} style={{ flex: 1, background: "rgba(168,85,247,0.08)", border: "1px solid rgba(168,85,247,0.2)", color: "#c084fc", padding: "10px", borderRadius: 10, cursor: "pointer", fontWeight: 700, fontSize: 12 }}>🛡️ Adjust</button>
                  )}
                </div>
                {(selectedClient.savingsLogs || []).slice(0, 10).map(log => (
                  <div key={log.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "10px 12px", background: t.rowBg, border: `1px solid ${t.rowBorder}`, borderRadius: 10, marginBottom: 6 }}>
                    <div>
                      <div style={{ fontSize: 12, fontWeight: 700, color: log.type === "deposit" ? "#4ade80" : log.type === "withdraw" ? "#f87171" : "#c084fc" }}>{log.type === "deposit" ? "📥 Deposit" : log.type === "withdraw" ? "📤 Withdrawal" : "🛡️ Adjustment"}</div>
                      <div style={{ fontSize: 9, color: t.textMuted }}>{fd(log.date)}{log.recordedBy ? ` · ${log.recordedBy}` : ""}</div>
                    </div>
                    <div style={{ textAlign: "right" }}>
                      <div style={{ fontSize: 13, fontWeight: 700, color: log.type === "deposit" ? "#4ade80" : "#f87171", fontFamily: "'Courier New',monospace" }}>{log.type === "deposit" ? "+" : "-"}{fc(log.amount)}</div>
                      <div style={{ fontSize: 9, color: t.textMuted }}>Bal: {fc(log.balanceAfter)}</div>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {activeTab === "history" && (
              <div>
                {getClientTransactions(selectedClient).slice(0, 30).map(tx => (
                  <div key={tx.id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 12px", background: t.rowBg, border: `1px solid ${t.rowBorder}`, borderRadius: 10, marginBottom: 6 }}>
                    <div style={{ width: 28, height: 28, borderRadius: 7, background: `${tx.color}15`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 13, flexShrink: 0 }}>{tx.icon}</div>
                    <div style={{ flexGrow: 1 }}>
                      <div style={{ fontSize: 12, fontWeight: 700, color: t.text }}>{tx.description}</div>
                      <div style={{ fontSize: 9, color: t.textMuted }}>{tx.detail}</div>
                    </div>
                    <div style={{ fontSize: 13, fontWeight: 700, color: tx.color, fontFamily: "'Courier New',monospace" }}>{fc(tx.amount)}</div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* BOTTOM NAV */}
      <div className="no-print" style={{ position: "fixed", bottom: 0, left: 0, right: 0, background: t.cardBg, borderTop: `1px solid ${t.cardBorder}`, padding: "8px 0 env(safe-area-inset-bottom,8px)", display: "flex", justifyContent: "center", gap: 4, zIndex: 100, backdropFilter: "blur(12px)" }}>
        {[
          ["dashboard", "dashboard", "Home"],
          ["clients", "users", "Clients"],
          ...(isAdmin ? [["staff", "shield", "Staff"]] : []),
          ["accountant", "account", "Finance"]
        ].map(([v, icon, label]) => (
          <button key={v} onClick={() => { if (v === "accountant") setAdminMode("accountant"); setView(v === "accountant" ? "dashboard" : v); }} style={{ background: view === v ? `${t.accentBlue}15` : "transparent", border: "none", color: view === v ? t.accentBlue : t.textMuted, padding: "8px 16px", borderRadius: 10, cursor: "pointer", display: "flex", flexDirection: "column", alignItems: "center", gap: 3, minWidth: 56 }}>
            <Icon name={icon} size={18} />
            <span style={{ fontSize: 9, fontWeight: 600 }}>{label}</span>
          </button>
        ))}
      </div>

      {/* ═══════════════════════════════════════════════════════════════════ */}
      {/* MODALS */}
      {/* ═══════════════════════════════════════════════════════════════════ */}

      {/* ADD CLIENT MODAL - UPDATED with occupation fields */}
      {showAddClient && (
        <Modal title="Register Client" onClose={() => setShowAddClient(false)} theme={t}>
          <Field label="Full Name *" theme={t}><input style={IS} value={newClient.name} onChange={e => setNewClient(p => ({ ...p, name: e.target.value }))} autoFocus /></Field>
          <Field label="Phone Number *" theme={t}><input style={IS} value={newClient.phone} onChange={e => setNewClient(p => ({ ...p, phone: e.target.value }))} type="tel" /></Field>
          <Field label="Address" theme={t}><input style={IS} value={newClient.address} onChange={e => setNewClient(p => ({ ...p, address: e.target.value }))} /></Field>
          <Field label="ID Number" theme={t}><input style={IS} value={newClient.idNumber} onChange={e => setNewClient(p => ({ ...p, idNumber: e.target.value }))} /></Field>
          <Field label="Occupation" theme={t}>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <span style={{ color: t.textMuted }}><Icon name="briefcase" size={14} /></span>
              <input style={IS} value={newClient.occupation} onChange={e => setNewClient(p => ({ ...p, occupation: e.target.value }))} placeholder="e.g. Trader, Civil Servant, Farmer..." />
            </div>
          </Field>

          <div style={{ borderTop: `1px solid ${t.rowBorder}`, marginTop: 16, paddingTop: 16 }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: t.textSecondary, marginBottom: 12, display: "flex", alignItems: "center", gap: 6 }}>
              <Icon name="shield" size={14} /> GUARANTOR INFORMATION
            </div>
            <Field label="Guarantor Name" theme={t}><input style={IS} value={newClient.guarantorName} onChange={e => setNewClient(p => ({ ...p, guarantorName: e.target.value }))} /></Field>
            <Field label="Guarantor Phone" theme={t}><input style={IS} value={newClient.guarantorPhone} onChange={e => setNewClient(p => ({ ...p, guarantorPhone: e.target.value }))} type="tel" /></Field>
            <Field label="Relationship" theme={t}><input style={IS} value={newClient.guarantorRelationship} onChange={e => setNewClient(p => ({ ...p, guarantorRelationship: e.target.value }))} placeholder="e.g. Spouse, Brother, Friend..." /></Field>
            <Field label="Guarantor Occupation" theme={t}>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <span style={{ color: t.textMuted }}><Icon name="briefcase" size={14} /></span>
                <input style={IS} value={newClient.guarantorOccupation} onChange={e => setNewClient(p => ({ ...p, guarantorOccupation: e.target.value }))} placeholder="e.g. Teacher, Business Owner..." />
              </div>
            </Field>
          </div>

          <button onClick={handleAddClient} style={{ width: "100%", background: `linear-gradient(135deg,${t.accentGreen},#16a34a)`, border: "none", color: "#000", padding: "13px", borderRadius: 12, cursor: "pointer", fontWeight: 800, fontSize: 14, marginTop: 8 }}>✓ Register Client</button>
        </Modal>
      )}

      {/* EDIT CLIENT MODAL - UPDATED with occupation fields */}
      {showEditClient && (
        <Modal title="Edit Client" onClose={() => setShowEditClient(null)} theme={t}>
          <Field label="Full Name *" theme={t}><input style={IS} value={showEditClient.name} onChange={e => setShowEditClient(p => ({ ...p, name: e.target.value }))} /></Field>
          <Field label="Phone Number *" theme={t}><input style={IS} value={showEditClient.phone} onChange={e => setShowEditClient(p => ({ ...p, phone: e.target.value }))} type="tel" /></Field>
          <Field label="Address" theme={t}><input style={IS} value={showEditClient.address || ""} onChange={e => setShowEditClient(p => ({ ...p, address: e.target.value }))} /></Field>
          <Field label="ID Number" theme={t}><input style={IS} value={showEditClient.idNumber || ""} onChange={e => setShowEditClient(p => ({ ...p, idNumber: e.target.value }))} /></Field>
          <Field label="Occupation" theme={t}>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <span style={{ color: t.textMuted }}><Icon name="briefcase" size={14} /></span>
              <input style={IS} value={showEditClient.occupation || ""} onChange={e => setShowEditClient(p => ({ ...p, occupation: e.target.value }))} placeholder="e.g. Trader, Civil Servant, Farmer..." />
            </div>
          </Field>

          <div style={{ borderTop: `1px solid ${t.rowBorder}`, marginTop: 16, paddingTop: 16 }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: t.textSecondary, marginBottom: 12, display: "flex", alignItems: "center", gap: 6 }}>
              <Icon name="shield" size={14} /> GUARANTOR INFORMATION
            </div>
            <Field label="Guarantor Name" theme={t}><input style={IS} value={showEditClient.guarantorName || ""} onChange={e => setShowEditClient(p => ({ ...p, guarantorName: e.target.value }))} /></Field>
            <Field label="Guarantor Phone" theme={t}><input style={IS} value={showEditClient.guarantorPhone || ""} onChange={e => setShowEditClient(p => ({ ...p, guarantorPhone: e.target.value }))} type="tel" /></Field>
            <Field label="Relationship" theme={t}><input style={IS} value={showEditClient.guarantorRelationship || ""} onChange={e => setShowEditClient(p => ({ ...p, guarantorRelationship: e.target.value }))} /></Field>
            <Field label="Guarantor Occupation" theme={t}>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <span style={{ color: t.textMuted }}><Icon name="briefcase" size={14} /></span>
                <input style={IS} value={showEditClient.guarantorOccupation || ""} onChange={e => setShowEditClient(p => ({ ...p, guarantorOccupation: e.target.value }))} placeholder="e.g. Teacher, Business Owner..." />
              </div>
            </Field>
          </div>

          <button onClick={handleUpdateClient} style={{ width: "100%", background: `linear-gradient(135deg,${t.accentBlue},#2563eb)`, border: "none", color: "#fff", padding: "12px", borderRadius: 12, cursor: "pointer", fontWeight: 800, marginTop: 8 }}>✓ Save Changes</button>
        </Modal>
      )}

      {/* ADD LOAN MODAL */}
      {showAddLoan && (
        <Modal title={isAdmin ? "Issue New Loan" : "Request Loan"} onClose={() => setShowAddLoan(false)} theme={t}>
          <Field label="Principal Amount (₦) *" theme={t}><input type="number" style={IS} value={newLoan.principal} onChange={e => setNewLoan(p => ({ ...p, principal: e.target.value }))} autoFocus /></Field>
          <Field label="Interest Rate (%)" theme={t}><input type="number" style={IS} value={newLoan.interestRate} onChange={e => setNewLoan(p => ({ ...p, interestRate: e.target.value }))} /></Field>
          <Field label="Repayment Days" theme={t}><input type="number" style={IS} value={newLoan.days} onChange={e => setNewLoan(p => ({ ...p, days: e.target.value }))} /></Field>
          <Field label="Start Date" theme={t}><input type="date" style={IS} value={newLoan.startDate} onChange={e => setNewLoan(p => ({ ...p, startDate: e.target.value }))} /></Field>
          <Field label="Exclude Weekends & Holidays" theme={t}>
            <button onClick={() => setNewLoan(p => ({ ...p, excludeWeekends: !p.excludeWeekends }))} style={{ background: newLoan.excludeWeekends ? "rgba(34,197,94,0.15)" : t.rowBg, border: `1px solid ${newLoan.excludeWeekends ? "rgba(34,197,94,0.3)" : t.rowBorder}`, color: newLoan.excludeWeekends ? "#4ade80" : t.textMuted, padding: "8px 14px", borderRadius: 8, cursor: "pointer", fontWeight: 600, fontSize: 12 }}>
              {newLoan.excludeWeekends ? "✓ Yes" : "✕ No"}
            </button>
          </Field>

          {newLoan.principal && (
            <div style={{ background: "rgba(59,130,246,0.06)", border: `1px solid rgba(59,130,246,0.15)`, borderRadius: 12, padding: "12px 14px", marginBottom: 16 }}>
              <div style={{ fontSize: 11, color: "#60a5fa", fontWeight: 700, marginBottom: 8 }}>📊 Preview</div>
              {(() => {
                const p = parseFloat(newLoan.principal) || 0;
                const r = parseFloat(newLoan.interestRate) || 0;
                const d = parseInt(newLoan.days) || 0;
                const int = (p * r) / 100;
                const tot = p + int;
                const daily = d > 0 ? tot / d : 0;
                return (
                  <div className="responsive-grid-2" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                    {[["Interest", fc(int), "#c4b5fd"], ["Total", fc(tot), t.text], ["Daily", fc(daily), "#60a5fa"], ["Days", d, "#93c5fd"]].map(([l, v, c]) => (
                      <div key={l}>
                        <div style={{ fontSize: 9, color: t.textMuted }}>{l}</div>
                        <div style={{ fontSize: 12, fontWeight: 700, color: c, fontFamily: "'Courier New',monospace" }}>{v}</div>
                      </div>
                    ))}
                  </div>
                );
              })()}
            </div>
          )}

          <button onClick={isAdmin ? handleAddLoan : handleRequestLoan} style={{ width: "100%", background: `linear-gradient(135deg,${t.accentGreen},#16a34a)`, border: "none", color: "#000", padding: "13px", borderRadius: 12, cursor: "pointer", fontWeight: 800, fontSize: 14 }}>
            {isAdmin ? "✓ Issue Loan" : "📤 Submit Request"}
          </button>
        </Modal>
      )}

      {/* PAYMENT MODAL */}
      {showPayment && (
        <Modal title="Record Payment" onClose={() => { setShowPayment(null); setPaymentAmount(""); setPaymentPreview(null); }} theme={t}>
          <Field label="Amount (₦)" theme={t}>
            <input type="number" style={IS} value={paymentAmount} onChange={e => {
              setPaymentAmount(e.target.value);
              const amt = parseFloat(e.target.value);
              if (amt > 0 && showPayment) {
                const cl = clients.find(c => c.id === showPayment.clientId);
                const ln = cl?.loans?.find(l => l.id === showPayment.loanId);
                if (ln) {
                  const sim = applySmartPayment(ln.schedule, showPayment.scheduleIdx, amt, todayStr, currentUser?.name);
                  const daysCleared = sim.filter(s => s.paid).length - ln.schedule.filter(s => s.paid).length;
                  const remBal = sim[sim.length - 1]?.balance || 0;
                  setPaymentPreview({ daysCleared, remainingBal: remBal });
                }
              } else {
                setPaymentPreview(null);
              }
            }} autoFocus />
          </Field>
          {paymentPreview && (
            <div style={{ background: "rgba(34,197,94,0.06)", border: "1px solid rgba(34,197,94,0.15)", borderRadius: 10, padding: "10px 14px", marginBottom: 14 }}>
              <div style={{ fontSize: 11, color: "#4ade80", fontWeight: 700, marginBottom: 4 }}>Preview</div>
              <div style={{ display: "flex", justifyContent: "space-between" }}>
                <span style={{ fontSize: 11, color: t.textMuted }}>Days cleared:</span>
                <span style={{ fontSize: 12, fontWeight: 700, color: "#4ade80" }}>{paymentPreview.daysCleared}</span>
              </div>
              <div style={{ display: "flex", justifyContent: "space-between" }}>
                <span style={{ fontSize: 11, color: t.textMuted }}>Remaining:</span>
                <span style={{ fontSize: 12, fontWeight: 700, color: "#60a5fa", fontFamily: "'Courier New',monospace" }}>{fc(paymentPreview.remainingBal)}</span>
              </div>
            </div>
          )}
          <button onClick={() => handlePayment()} style={{ width: "100%", background: `linear-gradient(135deg,${t.accentGreen},#16a34a)`, border: "none", color: "#000", padding: "13px", borderRadius: 12, cursor: "pointer", fontWeight: 800, fontSize: 14 }}>✓ Record Payment</button>
        </Modal>
      )}

      {/* SAVINGS MODAL */}
      {showSavingsTx && showSavingsTx.type !== "admin" && (
        <Modal title={showSavingsTx.type === "deposit" ? "📥 Deposit" : "📤 Withdrawal"} onClose={() => setShowSavingsTx(null)} theme={t}>
          <div style={{ background: "rgba(168,85,247,0.08)", borderRadius: 10, padding: "12px", marginBottom: 16, textAlign: "center" }}>
            <div style={{ fontSize: 10, color: "#a855f7" }}>Current Balance</div>
            <div style={{ fontSize: 22, fontWeight: 900, color: t.text, fontFamily: "'Courier New',monospace" }}>{fc(showSavingsTx.client.savingsBalance || 0)}</div>
          </div>
          <Field label="Amount (₦)" theme={t}><input type="number" style={IS} value={savingsAmount} onChange={e => setSavingsAmount(e.target.value)} autoFocus /></Field>
          <button onClick={handleSavingsTransaction} style={{ width: "100%", background: showSavingsTx.type === "deposit" ? `linear-gradient(135deg,${t.accentGreen},#16a34a)` : "linear-gradient(135deg,#ef4444,#dc2626)", border: "none", color: showSavingsTx.type === "deposit" ? "#000" : "#fff", padding: "12px", borderRadius: 12, cursor: "pointer", fontWeight: 800 }}>
            ✓ {showSavingsTx.type === "deposit" ? "Deposit" : "Withdraw"}
          </button>
        </Modal>
      )}

      {showSavingsTx && showSavingsTx.type === "admin" && (
        <Modal title="🛡️ Admin Adjustment" onClose={() => setShowSavingsTx(null)} theme={t}>
          <Field label="Set New Balance (₦)" theme={t}><input type="number" style={IS} value={adminDirectSavingsInput} onChange={e => setAdminDirectSavingsInput(e.target.value)} autoFocus /></Field>
          <button onClick={handleAdminSavingsAdj} style={{ width: "100%", background: "linear-gradient(135deg,#a855f7,#7c3aed)", border: "none", color: "#fff", padding: "12px", borderRadius: 12, cursor: "pointer", fontWeight: 800 }}>✓ Set Balance</button>
        </Modal>
      )}

      {/* ADMIN INSTALLMENT OVERRIDE */}
      {adminEditInstallment && (
        <Modal title="🛡️ Admin Override" onClose={() => setAdminEditInstallment(null)} theme={t}>
          <Field label="Due Date" theme={t}><input type="date" style={IS} value={adminInstOverride.dueDate} onChange={e => setAdminInstOverride(p => ({ ...p, dueDate: e.target.value }))} /></Field>
          <Field label="Paid Status" theme={t}>
            <button onClick={() => setAdminInstOverride(p => ({ ...p, paid: !p.paid }))} style={{ background: adminInstOverride.paid ? "rgba(34,197,94,0.15)" : t.rowBg, border: `1px solid ${adminInstOverride.paid ? "rgba(34,197,94,0.3)" : t.rowBorder}`, color: adminInstOverride.paid ? "#4ade80" : t.textMuted, padding: "8px 14px", borderRadius: 8, cursor: "pointer", fontWeight: 600 }}>
              {adminInstOverride.paid ? "✓ Paid" : "✕ Unpaid"}
            </button>
          </Field>
          {adminInstOverride.paid && (
            <>
              <Field label="Paid Amount (₦)" theme={t}><input type="number" style={IS} value={adminInstOverride.paidAmount} onChange={e => setAdminInstOverride(p => ({ ...p, paidAmount: e.target.value }))} /></Field>
              <Field label="Paid Date" theme={t}><input type="date" style={IS} value={adminInstOverride.paidDate} onChange={e => setAdminInstOverride(p => ({ ...p, paidDate: e.target.value }))} /></Field>
            </>
          )}
          <button onClick={handleAdminInstOverride} style={{ width: "100%", background: "#f59e0b", border: "none", color: "#000", padding: "12px", borderRadius: 12, cursor: "pointer", fontWeight: 800 }}>✓ Apply Override</button>
        </Modal>
      )}

      {/* RESTRUCTURE MODAL */}
      {showRestructure && (
        <Modal title="🔄 Restructure Loan" onClose={() => setShowRestructure(null)} theme={t}>
          <div style={{ background: "rgba(192,132,252,0.08)", borderRadius: 12, padding: "12px 14px", marginBottom: 16 }}>
            <div style={{ fontSize: 11, color: "#c084fc", fontWeight: 700, marginBottom: 6 }}>Current Terms</div>
            <div className="responsive-grid-2" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
              <div><div style={{ fontSize: 9, color: t.textMuted }}>Daily</div><div style={{ fontSize: 12, fontWeight: 700, color: t.text }}>{fc(showRestructure.dailyPayment)}</div></div>
              <div><div style={{ fontSize: 9, color: t.textMuted }}>Remaining</div><div style={{ fontSize: 12, fontWeight: 700, color: "#f87171" }}>{fc(computeLoanFinancials(showRestructure).remainingBalance)}</div></div>
            </div>
          </div>
          <Field label="New Daily Amount (₦) *" theme={t}><input type="number" style={IS} value={restructureInput.newDailyAmount} onChange={e => setRestructureInput(p => ({ ...p, newDailyAmount: e.target.value }))} /></Field>
          <Field label="Reason *" theme={t}><input style={IS} value={restructureInput.reason} onChange={e => setRestructureInput(p => ({ ...p, reason: e.target.value }))} placeholder="e.g. Client hardship, business downturn..." /></Field>
          {restructureInput.newDailyAmount && (
            <div style={{ background: "rgba(34,197,94,0.06)", borderRadius: 10, padding: "10px 14px", marginBottom: 14 }}>
              <div style={{ fontSize: 11, color: "#4ade80", fontWeight: 700, marginBottom: 4 }}>Preview</div>
              <div style={{ fontSize: 11, color: t.textMuted }}>
                New duration: ~{Math.ceil(computeLoanFinancials(showRestructure).remainingBalance / (parseFloat(restructureInput.newDailyAmount) || 1))} days
              </div>
            </div>
          )}
          <button onClick={handleRestructure} style={{ width: "100%", background: "linear-gradient(135deg,#a855f7,#7c3aed)", border: "none", color: "#fff", padding: "12px", borderRadius: 12, cursor: "pointer", fontWeight: 800 }}>✓ Restructure</button>
        </Modal>
      )}

      {/* ASSIGN CLIENT MODAL */}
      {showAssignClient && (
        <Modal title="Reassign Client" onClose={() => setShowAssignClient(null)} theme={t}>
          <div style={{ marginBottom: 14 }}>
            <div style={{ fontSize: 13, color: t.text, fontWeight: 700 }}>{showAssignClient.name}</div>
            <div style={{ fontSize: 11, color: t.textMuted }}>Current: {showAssignClient.assignedToName || "Unassigned"}</div>
          </div>
          {users.filter(u => u.role !== "admin" && u.active).map(u => (
            <button key={u.id} onClick={() => handleAssignClient(showAssignClient.id, u.id)} style={{ width: "100%", background: showAssignClient.assignedTo === u.id ? `${t.accentBlue}20` : t.rowBg, border: `1px solid ${showAssignClient.assignedTo === u.id ? t.accentBlue : t.rowBorder}`, borderRadius: 10, padding: "10px 14px", marginBottom: 6, cursor: "pointer", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <span style={{ fontSize: 13, color: t.text, fontWeight: 600 }}>{u.name}</span>
              {showAssignClient.assignedTo === u.id && <Badge color="#4ade80" bg="rgba(34,197,94,0.12)">Current</Badge>}
            </button>
          ))}
        </Modal>
      )}

      {/* DELETE CONFIRMATION */}
      {confirmDelete && (
        <Modal title="⚠️ Delete Client" onClose={() => setConfirmDelete(null)} theme={t}>
          <div style={{ textAlign: "center", padding: "20px 0" }}>
            <div style={{ fontSize: 48, marginBottom: 16 }}>⚠️</div>
            <div style={{ fontSize: 15, color: t.text, fontWeight: 700, marginBottom: 8 }}>Delete {confirmDelete.name}?</div>
            <div style={{ fontSize: 12, color: "#f87171", marginBottom: 20 }}>This cannot be undone. All loans and history will be lost.</div>
            <div style={{ display: "flex", gap: 10 }}>
              <button onClick={() => setConfirmDelete(null)} style={{ flex: 1, background: t.rowBg, border: `1px solid ${t.rowBorder}`, color: t.textSecondary, padding: "11px", borderRadius: 10, cursor: "pointer", fontWeight: 700 }}>Cancel</button>
              <button onClick={() => handleDeleteClient(confirmDelete.id)} style={{ flex: 1, background: "linear-gradient(135deg,#ef4444,#dc2626)", border: "none", color: "#fff", padding: "11px", borderRadius: 10, cursor: "pointer", fontWeight: 700 }}>Delete</button>
            </div>
          </div>
        </Modal>
      )}

      {/* PROFILE MODAL */}
      {showProfile && (
        <Modal title="👤 Profile" onClose={() => setShowProfile(false)} theme={t}>
          <div style={{ textAlign: "center", marginBottom: 20 }}>
            <div style={{ width: 56, height: 56, borderRadius: 16, background: "linear-gradient(135deg,#1d4ed8,#3b82f6)", display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 800, fontSize: 24, color: "#fff", margin: "0 auto 12px" }}>{currentUser.name.charAt(0)}</div>
            <div style={{ fontSize: 18, fontWeight: 800, color: t.text }}>{currentUser.name}</div>
            <div style={{ fontSize: 12, color: t.textMuted }}>@{currentUser.username}</div>
            <div style={{ marginTop: 6 }}><RB role={currentUser.role} /></div>
          </div>
          <div style={{ borderTop: `1px solid ${t.rowBorder}`, paddingTop: 16 }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: t.textSecondary, marginBottom: 12 }}>Change Password</div>
            <Field label="Current Password" theme={t}><input type="password" style={IS} value={profileEdit.oldPassword} onChange={e => setProfileEdit(p => ({ ...p, oldPassword: e.target.value }))} /></Field>
            <Field label="New Password" theme={t}><input type="password" style={IS} value={profileEdit.newPassword} onChange={e => setProfileEdit(p => ({ ...p, newPassword: e.target.value }))} placeholder="Min 4 chars" /></Field>
            <Field label="Confirm New Password" theme={t}><input type="password" style={IS} value={profileEdit.confirmPassword} onChange={e => setProfileEdit(p => ({ ...p, confirmPassword: e.target.value }))} /></Field>
            <button onClick={handleChangePassword} style={{ width: "100%", background: `linear-gradient(135deg,${t.accentBlue},#2563eb)`, border: "none", color: "#fff", padding: "12px", borderRadius: 12, cursor: "pointer", fontWeight: 800, marginBottom: 10 }}>✓ Change Password</button>
          </div>
          <button onClick={() => { setCurrentUser(null); setShowProfile(false); }} style={{ width: "100%", background: "rgba(239,68,68,0.08)", border: "1px solid rgba(239,68,68,0.2)", color: "#f87171", padding: "11px", borderRadius: 12, cursor: "pointer", fontWeight: 700, display: "flex", alignItems: "center", justifyContent: "center", gap: 6 }}>
            <Icon name="logout" size={14} />Sign Out
          </button>
        </Modal>
      )}

      {/* SETTINGS MODAL */}
      {showSettings && (
        <Modal title="⚙ Settings" onClose={() => setShowSettings(false)} theme={t}>
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "12px 14px", background: t.rowBg, border: `1px solid ${t.rowBorder}`, borderRadius: 12 }}>
              <div>
                <div style={{ fontSize: 13, fontWeight: 700, color: t.text }}>Theme</div>
                <div style={{ fontSize: 10, color: t.textMuted }}>{themeMode === "dark" ? "Dark Mode" : "Light Mode"}</div>
              </div>
              <button onClick={toggleTheme} style={{ background: t.accentBlue + "20", border: `1px solid ${t.accentBlue}40`, color: t.accentBlue, padding: "8px 14px", borderRadius: 8, cursor: "pointer", fontWeight: 700, fontSize: 12, display: "flex", alignItems: "center", gap: 6 }}>
                <Icon name={themeMode === "dark" ? "sun" : "moon"} size={14} />
                {themeMode === "dark" ? "Light" : "Dark"}
              </button>
            </div>

            <button onClick={exportData} style={{ width: "100%", background: "rgba(34,197,94,0.08)", border: "1px solid rgba(34,197,94,0.2)", color: "#4ade80", padding: "12px", borderRadius: 12, cursor: "pointer", fontWeight: 700, fontSize: 13, display: "flex", alignItems: "center", justifyContent: "center", gap: 6 }}>
              💾 Export Backup
            </button>

            <button onClick={() => window.print()} style={{ width: "100%", background: "rgba(96,165,250,0.08)", border: "1px solid rgba(96,165,250,0.2)", color: "#60a5fa", padding: "12px", borderRadius: 12, cursor: "pointer", fontWeight: 700, fontSize: 13, display: "flex", alignItems: "center", justifyContent: "center", gap: 6 }}>
              <Icon name="printer" size={14} /> Print Current View
            </button>

            <div style={{ padding: "12px 14px", background: t.rowBg, borderRadius: 12, border: `1px solid ${t.rowBorder}` }}>
              <div style={{ fontSize: 10, color: t.textMuted, marginBottom: 4 }}>Version</div>
              <div style={{ fontSize: 13, color: t.text, fontWeight: 700 }}>CREDA Finance v10.0</div>
              <div style={{ fontSize: 10, color: t.textMuted }}>With occupation fields, inline repayment, smart default settlement, light/dark mode, print support</div>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
  }
