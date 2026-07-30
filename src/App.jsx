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
      day: i + 1, dueDate: repDays[i], payment: daily,
      balance: bal, paid: false, paidDate: null,
      paidAmount: 0, overpayment: 0, shortfall: 0, paymentLog: []
    });
  }
  return { dailyPayment: daily, totalRepayable: total, totalInterest: interest, schedule };
}

function applySmartPayment(schedule, startIdx, amountPaid, paidDate, paidBy) {
  let remaining = amountPaid;
  const updated = schedule.map(s => ({ ...s, paymentLog: [...(s.paymentLog || [])] }));
  const today = new Date();

  const defaultedSlots = [];
  for (let i = 0; i < updated.length; i++) {
    if (i === startIdx) continue;
    const s = updated[i];
    const isDefaulted = !s.paid && new Date(s.dueDate) < today;
    const gap = s.payment - (s.paidAmount || 0);
    if (isDefaulted && gap > 0) defaultedSlots.push(i);
  }
  defaultedSlots.sort((a, b) => new Date(updated[a].dueDate) - new Date(updated[b].dueDate));

  for (const defIdx of defaultedSlots) {
    if (remaining <= 0) break;
    const s = updated[defIdx];
    const owed = s.payment - (s.paidAmount || 0);
    const here = Math.min(remaining, owed);
    const newPaid = (s.paidAmount || 0) + here;
    updated[defIdx].paymentLog.push({
      amount: here, date: paidDate, by: paidBy || "",
      at: new Date().toISOString(), cascaded: true, defaultSettlement: true
    });
    updated[defIdx] = {
      ...updated[defIdx],
      paid: newPaid >= s.payment,
      paidAmount: newPaid,
      paidDate: newPaid >= s.payment ? paidDate : s.paidDate,
      overpayment: 0,
      shortfall: Math.max(0, s.payment - newPaid)
    };
    remaining -= here;
  }

  if (remaining > 0 && startIdx < updated.length) {
    const s = updated[startIdx];
    const total = (s.paidAmount || 0) + remaining;
    const covers = Math.min(total, s.payment);
    const excess = total - s.payment;
    updated[startIdx].paymentLog.push({
      amount: amountPaid, date: paidDate, by: paidBy || "",
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

  let i = startIdx + 1;
  while (remaining > 0 && i < updated.length) {
    const s = updated[i];
    if (s.paid) { i++; continue; }
    const already = s.paidAmount || 0;
    const owed = s.payment - already;
    const here = Math.min(remaining, owed);
    const newPaid = already + here;
    updated[i].paymentLog.push({
      amount: here, date: paidDate, by: paidBy || "",
      at: new Date().toISOString(), cascaded: true
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

  const totalDue = updated.reduce((sum, s) => sum + s.payment, 0);
  let bal = totalDue;
  for (let j = 0; j < updated.length; j++) {
    bal = Math.max(0, bal - (updated[j].paidAmount || 0));
    updated[j].balance = bal;
  }
  return updated;
}

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
      day: paidSlots.length + i + 1, dueDate: newRepayDays[i],
      payment: newDailyAmount, balance: bal, paid: false, paidDate: null,
      paidAmount: 0, overpayment: 0, shortfall: 0, paymentLog: [], restructured: true
    });
  }
  const newTotal = paidSlots.reduce((s, x) => s + x.paidAmount, 0) + totalUnpaidOwed;
  return {
    ...loan, schedule: newSchedule, days: newSchedule.length,
    dailyPayment: newDailyAmount, totalRepayable: newTotal,
    restructureLog: [...(loan.restructureLog || []), {
      date: todayStr, reason, approvedBy, newDailyAmount, newDays, totalUnpaidOwed,
      at: new Date().toISOString()
    }]
  };
}

function computeTotalShortfall(loan) {
  const today = new Date();
  let totalShortfall = 0;
  let shortfallDays = 0;
  (loan.schedule || []).forEach(s => {
    if (!s.paid && s.paidAmount >= 0 && new Date(s.dueDate) <= today) {
      const gap = s.payment - (s.paidAmount || 0);
      if (gap > 0) { totalShortfall += gap; shortfallDays++; }
    }
  });
  (loan.schedule || []).forEach(s => {
    if (!s.paid && s.paidAmount > 0 && s.paidAmount < s.payment) {
      const gap = s.payment - s.paidAmount;
      if (gap > 0 && new Date(s.dueDate) > today) { totalShortfall += gap; shortfallDays++; }
    }
  });
  return { totalShortfall, shortfallDays };
}

function computeClientRisk(client) {
  const activeLoan = client.loans?.find(l => l.status === "active");
  if (!activeLoan) return { level: "none", label: "No Loan", color: "#3a5a70", bg: "rgba(100,130,150,0.08)", emoji: "⚪" };
  const today = new Date();
  const schedule = activeLoan.schedule || [];
  let consecutiveShortfalls = 0, maxConsecutive = 0, totalShortfallDays = 0, latePayments = 0, overdueCount = 0;
  schedule.forEach(s => {
    const due = new Date(s.dueDate);
    if (!s.paid && due < today) {
      overdueCount++; consecutiveShortfalls++;
      maxConsecutive = Math.max(maxConsecutive, consecutiveShortfalls);
      totalShortfallDays++;
    } else if (s.paid && s.paidDate > s.dueDate) {
      latePayments++; consecutiveShortfalls = 0;
    } else if (!s.paid && s.paidAmount > 0 && s.paidAmount < s.payment) {
      totalShortfallDays++; consecutiveShortfalls++;
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

function computeDefaultingClientsReport(clients, monthKey) {
  const defaulters = [];
  const today = new Date();
  clients.forEach(c => {
    (c.loans || []).forEach(l => {
      if (l.status !== "active") return;
      const overdueSlots = (l.schedule || []).filter(s => {
        const isOverdue = !s.paid && new Date(s.dueDate) < today;
        const inMonth = monthKey ? (s.dueDate || "").slice(0, 7) === monthKey : true;
        return isOverdue && inMonth;
      });
      if (overdueSlots.length === 0) return;
      const totalOwed = overdueSlots.reduce((sum, s) => sum + (s.payment - (s.paidAmount || 0)), 0);
      defaulters.push({
        clientId: c.id, clientName: c.name, phone: c.phone,
        daysOverdue: overdueSlots.length, totalOwed,
        lastDueDate: overdueSlots[overdueSlots.length - 1]?.dueDate,
        dailyPayment: l.dailyPayment,
        risk: computeClientRisk(c)
      });
    });
  });
  return defaulters.sort((a, b) => b.totalOwed - a.totalOwed);
}

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
    partialCount: (loan.schedule || []).filter(s => !s.paid && s.paidAmount > 0 && s.paidAmount < s.payment).length
  };
}

function computeMonthlyStats(clientsList, monthKey) {
  let totalDisbursed = 0, totalExpected = 0, totalCollected = 0, overdueCount = 0;
  const today = new Date();
  clientsList.forEach(c => {
    (c.loans || []).forEach(l => {
      if ((l.issuedAt || l.startDate || "").slice(0, 7) === monthKey) totalDisbursed += l.principal || 0;
      (l.schedule || []).forEach(s => {
        if ((s.dueDate || "").slice(0, 7) === monthKey) {
          totalExpected += s.payment || 0;
          if (s.paidAmount > 0) totalCollected += s.paidAmount;
          else if (new Date(s.dueDate) < today) overdueCount++;
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

function computeMonthlyReport(clients) {
  const map = {};
  clients.forEach(c => {
    (c.loans || []).forEach(l => {
      const key = (l.issuedAt || l.startDate || "").slice(0, 7);
      if (!map[key]) map[key] = { disbursed: 0, expected: 0, collected: 0, interest: 0, loanCount: 0, clientIds: new Set() };
      map[key].disbursed += l.principal || 0;
      map[key].expected += l.totalRepayable || 0;
      map[key].interest += l.totalInterest || 0;
      map[key].loanCount++;
      map[key].clientIds.add(c.id);
      (l.schedule || []).forEach(s => { if (s.paidAmount > 0) map[key].collected += s.paidAmount; });
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
            expectedThisMonth += s.payment || 0;
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
            description: `Loan Cycle ${lIdx + 1} — Day ${s.day}/${l.days}${pl.cascaded ? " (Cascaded)" : ""}`,
            detail: `${pl.by ? `by ${pl.by} · ` : ""}${fd(pl.date)}${pl.cascaded ? " · Auto-cascaded" : ""}`,
            color: pl.cascaded ? "#a78bfa" : "#4ade80", icon: pl.cascaded ? "⚡" : "✓"
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
    restructure: <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><polyline points="17 1 21 5 17 9" /><path d="M3 11V9a4 4 0 0 1 4-4h14" /><polyline points="7 23 3 19 7 15" /><path d="M21 13v2a4 4 0 0 1-4 4H3" /></svg>
  };
  return icons[name] || null;
};

function Modal({ title, onClose, children, wide }) {
  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,8,20,0.92)", zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "center", padding: 12, backdropFilter: "blur(8px)" }}>
      <div style={{ background: "#0d1b2a", border: "1px solid rgba(100,200,255,0.12)", borderRadius: 20, width: "100%", maxWidth: wide ? 580 : 480, maxHeight: "92vh", overflowY: "auto", WebkitOverflowScrolling: "touch" }}>
        <div style={{ padding: "18px 20px 12px", borderBottom: "1px solid rgba(255,255,255,0.06)", display: "flex", justifyContent: "space-between", alignItems: "center", position: "sticky", top: 0, background: "#0d1b2a", zIndex: 1, borderRadius: "20px 20px 0 0" }}>
          <h2 style={{ margin: 0, fontSize: 17, fontWeight: 700, color: "#e8f4fd" }}>{title}</h2>
          <button onClick={onClose} style={{ background: "rgba(255,255,255,0.06)", border: "none", color: "#8ab4c8", width: 36, height: 36, borderRadius: 10, cursor: "pointer", fontSize: 20, display: "flex", alignItems: "center", justifyContent: "center" }}>×</button>
        </div>
        <div style={{ padding: "18px 20px" }}>{children}</div>
      </div>
    </div>
  );
}

function Field({ label, children }) {
  return (
    <div style={{ marginBottom: 14 }}>
      <label style={{ display: "block", fontSize: 11, color: "#5a7a90", marginBottom: 5, letterSpacing: 0.8, textTransform: "uppercase" }}>{label}</label>
      {children}
    </div>
  );
}

const IS = { width: "100%", padding: "12px 14px", background: "rgba(100,180,255,0.05)", border: "1px solid rgba(100,180,255,0.15)", borderRadius: 10, color: "#e8f4fd", fontSize: 15, outline: "none", boxSizing: "border-box", fontFamily: "inherit" };

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

function ModernStatCard({ label, value, icon, gradient, danger, badge }) {
  return (
    <div style={{ background: "linear-gradient(135deg, rgba(255,255,255,0.04), rgba(255,255,255,0.01))", border: "1px solid rgba(255,255,255,0.06)", borderRadius: 16, padding: "14px 15px", position: "relative", overflow: "hidden", minHeight: 100 }}>
      <div style={{ position: "absolute", top: 0, left: 0, right: 0, height: 3, background: gradient }} />
      <div style={{ width: 32, height: 32, borderRadius: 9, background: gradient, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 15, marginBottom: 10 }}>{icon}</div>
      <div style={{ fontSize: 9, color: "#5a7a90", letterSpacing: 1, textTransform: "uppercase", fontWeight: 700, marginBottom: 4 }}>{label}</div>
      <div style={{ fontSize: 15, fontWeight: 900, color: danger ? "#f87171" : "#ffffff", fontFamily: "'Courier New',monospace", letterSpacing: -0.3 }}>{value}</div>
      {badge && (<div style={{ marginTop: 6, fontSize: 9, color: "#4ade80", fontWeight: 700, display: "inline-block", padding: "2px 6px", background: "rgba(74,222,128,0.1)", borderRadius: 5 }}>{badge}</div>)}
    </div>
  );
}

function MetricRow({ icon, label, value, color }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "12px 14px", background: "rgba(255,255,255,0.02)", borderRadius: 11, border: "1px solid rgba(255,255,255,0.04)" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <div style={{ width: 32, height: 32, borderRadius: 8, background: `${color}15`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 14 }}>{icon}</div>
        <div style={{ fontSize: 12, color: "#8ab4c8", fontWeight: 500 }}>{label}</div>
      </div>
      <div style={{ fontSize: 14, fontWeight: 800, color: color, fontFamily: "'Courier New',monospace" }}>{value}</div>
    </div>
  );
}

function ModernPortfolioCard({ fin, expanded, onToggle }) {
  const rc = fin.realROI >= 20 ? "#22c55e" : fin.realROI >= 10 ? "#f59e0b" : "#ef4444";
  return (
    <div style={{ background: "linear-gradient(135deg, rgba(16,30,50,0.9), rgba(10,20,40,0.95))", border: "1px solid rgba(100,180,255,0.15)", borderRadius: 18, overflow: "hidden", marginBottom: 20, boxShadow: "0 8px 32px rgba(0,0,0,0.3)" }}>
      <div onClick={onToggle} style={{ background: "linear-gradient(135deg, rgba(59,130,246,0.15), rgba(34,197,94,0.1))", padding: "16px 18px", borderBottom: expanded ? "1px solid rgba(100,180,255,0.1)" : "none", display: "flex", justifyContent: "space-between", alignItems: "center", cursor: "pointer" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <div style={{ width: 36, height: 36, borderRadius: 10, background: "linear-gradient(135deg, #1e40af, #3b82f6)", display: "flex", alignItems: "center", justifyContent: "center" }}><Icon name="trend" size={17} /></div>
          <div>
            <div style={{ fontSize: 14, fontWeight: 800, color: "#e8f4fd" }}>Portfolio Intelligence</div>
            <div style={{ fontSize: 10, color: "#5a7a90", marginTop: 2 }}>Real-time financial performance</div>
          </div>
        </div>
        <button style={{ background: "rgba(100,180,255,0.12)", border: "none", borderRadius: 9, color: "#60a5fa", padding: "8px 14px", fontSize: 11, cursor: "pointer", fontWeight: 700, minHeight: 36 }}>{expanded ? "Hide ▲" : "Show ▼"}</button>
      </div>
      {expanded && (
        <div style={{ padding: "16px 18px" }}>
          <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 12 }}>
            <MetricRow icon="🛡️" label="Capital Deployed" value={fc(fin.totalCapital)} color="#60a5fa" />
            <MetricRow icon="⚠️" label="Outstanding Principal" value={fc(fin.outstandingPrincipal)} color={fin.outstandingPrincipal > 0 ? "#f87171" : "#4ade80"} />
            <MetricRow icon="📈" label="Interest Earned" value={fc(fin.interestEarned)} color="#c4b5fd" />
          </div>
          <div style={{ padding: "16px 18px", background: "linear-gradient(135deg, rgba(34,197,94,0.12), rgba(22,163,74,0.08))", borderRadius: 14, border: "1px solid rgba(34,197,94,0.25)", marginBottom: 12 }}>
            <div style={{ fontSize: 10, color: "#4ade80", fontWeight: 700, letterSpacing: 1.5, textTransform: "uppercase", marginBottom: 6 }}>💰 True Profit</div>
            <div style={{ fontSize: 24, fontWeight: 900, color: "#22c55e", fontFamily: "'Courier New',monospace", letterSpacing: -0.5 }}>{fc(fin.trueProfit)}</div>
          </div>
          <div style={{ padding: "16px 18px", background: `linear-gradient(135deg, ${rc}12, ${rc}05)`, borderRadius: 14, border: `1px solid ${rc}30` }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
              <div>
                <div style={{ fontSize: 10, color: rc, fontWeight: 700, letterSpacing: 1.5, textTransform: "uppercase" }}>Return on Investment</div>
                <div style={{ fontSize: 9, color: "#5a7a90", marginTop: 3 }}>{fin.realROI >= 20 ? "🚀 Excellent" : fin.realROI >= 10 ? "📊 Healthy" : "⚠️ Below target"}</div>
              </div>
              <div style={{ background: `${rc}25`, borderRadius: 10, padding: "6px 14px", border: `1px solid ${rc}40` }}>
                <span style={{ fontSize: 20, fontWeight: 900, color: rc, fontFamily: "'Courier New',monospace" }}>{fin.realROI.toFixed(2)}%</span>
              </div>
            </div>
            <div style={{ height: 8, background: "rgba(255,255,255,0.05)", borderRadius: 6, overflow: "hidden" }}>
              <div style={{ height: "100%", width: `${Math.min(Math.max(fin.realROI, 0), 100)}%`, background: `linear-gradient(90deg, ${rc}, ${rc}cc)`, borderRadius: 6, transition: "width 0.6s ease-out" }} />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function DefaultersSection({ clients, monthKey, onSelectClient }) {
  const [expanded, setExpanded] = useState(false);
  const defaulters = useMemo(() => computeDefaultingClientsReport(clients, monthKey), [clients, monthKey]);
  if (defaulters.length === 0) return null;
  const totalOwed = defaulters.reduce((s, d) => s + d.totalOwed, 0);
  return (
    <div style={{ background: "linear-gradient(135deg, rgba(239,68,68,0.08), rgba(220,38,38,0.04))", border: "1px solid rgba(239,68,68,0.25)", borderRadius: 18, padding: 18, marginBottom: 20 }}>
      <div onClick={() => setExpanded(!expanded)} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", cursor: "pointer" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <div style={{ width: 36, height: 36, borderRadius: 10, background: "linear-gradient(135deg, #7f1d1d, #dc2626)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 16 }}>⚠️</div>
          <div>
            <div style={{ fontSize: 14, fontWeight: 800, color: "#f87171" }}>{defaulters.length} Defaulting Client{defaulters.length !== 1 ? "s" : ""}</div>
            <div style={{ fontSize: 11, color: "#7a3a3a", marginTop: 2 }}>Total owed: <span style={{ fontWeight: 800, color: "#ef4444", fontFamily: "'Courier New',monospace" }}>{fc(totalOwed)}</span></div>
          </div>
        </div>
        <button style={{ background: "rgba(239,68,68,0.15)", border: "none", borderRadius: 9, color: "#f87171", padding: "8px 12px", fontSize: 11, cursor: "pointer", fontWeight: 700, minHeight: 36 }}>{expanded ? "▲" : "▼"}</button>
      </div>
      {expanded && (
        <div style={{ marginTop: 14, display: "flex", flexDirection: "column", gap: 8 }}>
          {defaulters.map(d => (
            <div key={d.clientId} onClick={() => onSelectClient(d.clientId)} style={{ background: "rgba(0,0,0,0.25)", border: "1px solid rgba(239,68,68,0.15)", borderRadius: 12, padding: "12px 14px", cursor: "pointer", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <div style={{ width: 34, height: 34, borderRadius: 9, background: "linear-gradient(135deg, #7f1d1d, #dc2626)", display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 800, color: "#fff", fontSize: 13 }}>{d.clientName.charAt(0)}</div>
                <div>
                  <div style={{ fontSize: 13, fontWeight: 700, color: "#e8f4fd" }}>{d.clientName}</div>
                  <div style={{ fontSize: 10, color: "#7a3a3a" }}>{d.phone} · {d.daysOverdue}d overdue</div>
                </div>
              </div>
              <div style={{ textAlign: "right" }}>
                <div style={{ fontSize: 14, fontWeight: 800, color: "#f87171", fontFamily: "'Courier New',monospace" }}>{fc(d.totalOwed)}</div>
                <div style={{ fontSize: 9, color: "#5a3030", marginTop: 2 }}>{d.risk.emoji} {d.risk.label}</div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function FMR({ label, value, valueColor = "#e8f4fd", icon, sub }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "10px 14px", background: "rgba(255,255,255,0.02)", borderRadius: 10, border: "1px solid rgba(255,255,255,0.04)" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        {icon && <span style={{ color: valueColor, opacity: 0.8 }}>{icon}</span>}
        <div>
          <div style={{ fontSize: 11, color: "#5a7a90" }}>{label}</div>
          {sub && <div style={{ fontSize: 9, color: "#3a4a58", marginTop: 1 }}>{sub}</div>}
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

function FP({ fin, isClient, expandFinancials, setExpandFinancials }) {
  const rc = fin.realROI >= 20 ? "#22c55e" : fin.realROI >= 10 ? "#f59e0b" : "#ef4444";
  return (
    <div style={{ background: "linear-gradient(135deg,rgba(16,30,50,0.9),rgba(10,20,40,0.95))", border: "1px solid rgba(100,180,255,0.1)", borderRadius: 16, overflow: "hidden", marginBottom: 20 }}>
      <div style={{ background: "linear-gradient(135deg,rgba(59,130,246,0.12),rgba(34,197,94,0.08))", padding: "14px 16px", borderBottom: "1px solid rgba(100,180,255,0.08)", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <Icon name="trend" size={16} />
          <div style={{ fontSize: 13, fontWeight: 800, color: "#e8f4fd" }}>{isClient ? "Client Intelligence" : "Portfolio Intelligence"}</div>
        </div>
        {!isClient && setExpandFinancials && (
          <button onClick={() => setExpandFinancials(!expandFinancials)} style={{ background: "rgba(100,180,255,0.08)", border: "none", borderRadius: 8, color: "#60a5fa", padding: "6px 12px", fontSize: 11, cursor: "pointer", fontWeight: 600, minHeight: 32 }}>{expandFinancials ? "Hide" : "Show"}</button>
        )}
      </div>
      {(isClient || expandFinancials) && (
        <div style={{ padding: "14px 16px", display: "flex", flexDirection: "column", gap: 8 }}>
          <FMR label="Capital" value={fc(fin.totalCapital ?? fin.capital)} valueColor="#60a5fa" icon={<Icon name="shield" size={13} />} />
          <FMR label="Outstanding" value={fc(fin.outstandingPrincipal)} valueColor={fin.outstandingPrincipal > 0 ? "#f87171" : "#4ade80"} icon={<Icon name="shield" size={13} />} />
          <FMR label="Interest Earned" value={fc(fin.interestEarned)} valueColor="#a78bfa" icon={<Icon name="trend" size={13} />} />
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

function InstRow({ s, i, loan, isActive, isAdmin, today, onPay, onOverride }) {
  const [showLog, setShowLog] = useState(false);
  const [quickAmt, setQuickAmt] = useState("");
  const isSF = !s.paid && s.paidAmount > 0 && s.paidAmount < s.payment;
  const isOD = !s.paid && new Date(s.dueDate) < today;
  const isNext = isActive && !s.paid && loan.schedule.filter(x => !x.paid)[0] === s;
  const isLate = s.paid && s.paidDate > s.dueDate;
  const hasOver = s.overpayment > 0;
  const hasLog = (s.paymentLog || []).length > 0;
  const amountRemaining = Math.max(0, s.payment - (s.paidAmount || 0));
  const totalRemaining = loan.schedule.filter(x => !x.paid).reduce((sum, x) => sum + (x.payment - (x.paidAmount || 0)), 0);
  const remainingDays = loan.schedule.filter(x => !x.paid).length;
  let border = "rgba(100,180,255,0.06)", bg = "rgba(255,255,255,0.01)";
  if (s.paid) { border = "rgba(34,197,94,0.15)"; bg = "rgba(34,197,94,0.04)"; }
  else if (isSF) { border = "rgba(239,68,68,0.35)"; bg = "rgba(239,68,68,0.08)"; }
  else if (isOD) { border = "rgba(239,68,68,0.2)"; bg = "rgba(239,68,68,0.05)"; }
  else if (isNext) { border = "rgba(96,165,250,0.2)"; bg = "rgba(96,165,250,0.03)"; }
  return (
    <div style={{ background: bg, border: `1px solid ${border}`, borderRadius: 10, padding: "10px 12px", marginBottom: 6 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
        <div style={{ display: "flex", gap: 9, alignItems: "flex-start" }}>
          <div style={{ width: 28, height: 28, borderRadius: 7, fontSize: 10, fontWeight: 700, flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center", background: s.paid ? "rgba(34,197,94,0.15)" : isSF ? "rgba(239,68,68,0.2)" : isOD ? "rgba(239,68,68,0.12)" : "rgba(255,255,255,0.05)", color: s.paid ? "#4ade80" : isSF ? "#f87171" : isOD ? "#f87171" : "#4a6880" }}>
            {s.paid ? <Icon name="check" size={11} /> : `${i + 1}`}
          </div>
          <div>
            <div style={{ display: "flex", alignItems: "center", gap: 5, marginBottom: 3, flexWrap: "wrap" }}>
              <span style={{ fontSize: 12, fontWeight: 700, color: s.paid ? "#4ade80" : isSF ? "#f87171" : isOD ? "#f87171" : "#c8dde8", fontFamily: "'Courier New',monospace" }}>{fc(s.paid ? s.paidAmount : s.payment)}</span>
              {s.restructured && <Badge color="#c084fc" bg="rgba(192,132,252,0.12)">RESTRUCTURED</Badge>}
              {isNext && <Badge color="#60a5fa" bg="rgba(96,165,250,0.12)">NEXT</Badge>}
              {isOD && !isSF && <Badge color="#f87171" bg="rgba(239,68,68,0.1)">OVERDUE</Badge>}
              {isLate && <Badge color="#f59e0b" bg="rgba(245,158,11,0.1)">LATE</Badge>}
              {isSF && <Badge color="#f87171" bg="rgba(239,68,68,0.15)">SHORTFALL</Badge>}
              {hasOver && <Badge color="#a78bfa" bg="rgba(167,139,250,0.12)">OVERPAID</Badge>}
              {hasLog && (
                <button onClick={() => setShowLog(!showLog)} style={{ background: "rgba(245,158,11,0.1)", border: "1px solid rgba(245,158,11,0.2)", color: "#f59e0b", borderRadius: 5, padding: "2px 7px", cursor: "pointer", fontSize: 9, fontWeight: 700, minHeight: 24 }}>
                  {s.paymentLog.length} pay{s.paymentLog.length > 1 ? "s" : ""} {showLog ? "▲" : "▼"}
                </button>
              )}
            </div>
            {isSF && <div style={{ fontSize: 9, color: "#f87171" }}>Paid {fc(s.paidAmount)} · Needs {fc(amountRemaining)}</div>}
            {hasOver && <div style={{ fontSize: 9, color: "#a78bfa" }}>+{fc(s.overpayment)} cascaded</div>}
            <div style={{ fontSize: 9, color: "#3a5a70" }}>Due {fd(s.dueDate)}{s.paidDate && ` · Last paid ${fd(s.paidDate)}`}</div>
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 6, flexShrink: 0 }}>
          <div style={{ textAlign: "right" }}>
            <div style={{ fontSize: 8, color: "#3a5a70" }}>BAL</div>
            <div style={{ fontSize: 10, color: "#8ab4c8", fontFamily: "'Courier New',monospace" }}>{fc(s.balance)}</div>
          </div>
          {!s.paid && isActive && (
            <button onClick={e => { e.stopPropagation(); onPay(loan, i); }} style={{ background: "linear-gradient(135deg,#22c55e,#16a34a)", border: "none", color: "#000", padding: "8px 12px", borderRadius: 7, cursor: "pointer", fontWeight: 700, fontSize: 11, minHeight: 34 }}>Pay</button>
          )}
          {isAdmin && (
            <button onClick={e => { e.stopPropagation(); onOverride(loan, i, s); }} style={{ background: "rgba(245,158,11,0.1)", border: "1px solid rgba(245,158,11,0.3)", color: "#f59e0b", borderRadius: 7, padding: "6px 9px", cursor: "pointer", fontSize: 10, minHeight: 32 }}>Edit</button>
          )}
        </div>
      </div>
      {!s.paid && isActive && (
        <div style={{ marginTop: 10, padding: "10px 12px", background: "rgba(0,0,0,0.2)", borderRadius: 8, border: "1px solid rgba(100,180,255,0.08)" }}>
          <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 10 }}>
            <div style={{ textAlign: "center", flex: 1 }}>
              <div style={{ fontSize: 8, color: "#3a5a70", marginBottom: 2 }}>REMAINING</div>
              <div style={{ fontSize: 12, fontWeight: 800, color: "#f87171", fontFamily: "'Courier New',monospace" }}>{fc(amountRemaining)}</div>
            </div>
            <div style={{ width: 1, background: "rgba(255,255,255,0.06)", margin: "0 8px" }} />
            <div style={{ textAlign: "center", flex: 1 }}>
              <div style={{ fontSize: 8, color: "#3a5a70", marginBottom: 2 }}>TOTAL LEFT</div>
              <div style={{ fontSize: 12, fontWeight: 800, color: "#f59e0b", fontFamily: "'Courier New',monospace" }}>{fc(totalRemaining)}</div>
            </div>
            <div style={{ width: 1, background: "rgba(255,255,255,0.06)", margin: "0 8px" }} />
            <div style={{ textAlign: "center", flex: 1 }}>
              <div style={{ fontSize: 8, color: "#3a5a70", marginBottom: 2 }}>DAYS LEFT</div>
              <div style={{ fontSize: 12, fontWeight: 800, color: "#60a5fa", fontFamily: "'Courier New',monospace" }}>{remainingDays}d</div>
            </div>
          </div>
          <div style={{ display: "flex", alignItems: "flex-end", gap: 8, borderTop: "1px solid rgba(255,255,255,0.04)", paddingTop: 10 }}>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 9, color: "#3a5a70", marginBottom: 4, letterSpacing: 0.8 }}>AMOUNT COLLECTED</div>
              <input type="number" value={quickAmt} onChange={e => setQuickAmt(e.target.value)} placeholder="Enter amount..." style={{ ...IS, padding: "10px 12px", fontSize: 15, fontWeight: 700, fontFamily: "'Courier New',monospace", color: "#4ade80", borderColor: quickAmt ? "rgba(34,197,94,0.4)" : "rgba(100,180,255,0.15)", background: quickAmt ? "rgba(34,197,94,0.05)" : "rgba(100,180,255,0.05)" }} />
              {quickAmt && parseFloat(quickAmt) > 0 && (
                <div style={{ fontSize: 9, color: parseFloat(quickAmt) >= amountRemaining ? "#4ade80" : "#f59e0b", marginTop: 4 }}>
                  {parseFloat(quickAmt) >= amountRemaining ? `✓ Covers day${parseFloat(quickAmt) > amountRemaining ? ` (+${fc(parseFloat(quickAmt) - amountRemaining)} extra)` : ""}` : `⚠ Short by ${fc(amountRemaining - parseFloat(quickAmt))}`}
                </div>
              )}
            </div>
            <button onClick={e => { e.stopPropagation(); if (quickAmt && parseFloat(quickAmt) > 0) { onPay(loan, i, parseFloat(quickAmt)); setQuickAmt(""); } }} style={{ background: quickAmt && parseFloat(quickAmt) > 0 ? "linear-gradient(135deg,#22c55e,#16a34a)" : "rgba(255,255,255,0.04)", border: "none", color: quickAmt && parseFloat(quickAmt) > 0 ? "#000" : "#3a5a70", padding: "12px 16px", borderRadius: 8, cursor: quickAmt ? "pointer" : "default", fontWeight: 800, fontSize: 13, whiteSpace: "nowrap", minHeight: 44 }}>✓ Collect</button>
          </div>
        </div>
      )}
      {showLog && hasLog && (
        <div style={{ marginTop: 10, borderTop: "1px solid rgba(255,255,255,0.06)", paddingTop: 10 }}>
          <div style={{ fontSize: 10, color: "#f59e0b", fontWeight: 700, marginBottom: 8 }}>📋 Payment Details</div>
          {s.paymentLog.map((pl, idx) => (
            <div key={idx} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "6px 10px", background: pl.cascaded ? "rgba(167,139,250,0.06)" : "rgba(34,197,94,0.04)", border: `1px solid ${pl.cascaded ? "rgba(167,139,250,0.15)" : "rgba(34,197,94,0.1)"}`, borderRadius: 8, marginBottom: 5 }}>
              <div>
                <div style={{ fontSize: 11, fontWeight: 700, color: pl.cascaded ? "#a78bfa" : "#4ade80", fontFamily: "'Courier New',monospace" }}>{fc(pl.amount)}</div>
                <div style={{ fontSize: 9, color: "#3a5a70", marginTop: 2 }}>{fd(pl.date)}{pl.by ? ` · ${pl.by}` : ""}{pl.cascaded ? (pl.defaultSettlement ? " · Default settled" : " · Cascaded") : ""}</div>
              </div>
              <div style={{ fontSize: 16 }}>{pl.cascaded ? "⚡" : "✓"}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function LCC({ loan, num, total, isAdmin, onPay, onOverride, today, onRestructure }) {
  const [exp, setExp] = useState(num === total);
  const [schOpen, setSchOpen] = useState(num === total);
  const fin = computeLoanFinancials(loan);
  const isAct = loan.status === "active";
  const pc = fin.completionRate >= 90 ? "#22c55e" : fin.completionRate >= 60 ? "#f59e0b" : "#ef4444";
  const stars = Math.round((fin.completionRate / 100) * 5);
  return (
    <div style={{ background: isAct ? "linear-gradient(135deg,rgba(34,197,94,0.04),rgba(59,130,246,0.03))" : "rgba(255,255,255,0.015)", border: `1px solid ${isAct ? "rgba(34,197,94,0.2)" : "rgba(96,165,250,0.12)"}`, borderRadius: 16, overflow: "hidden", marginBottom: 12 }}>
      <div onClick={() => setExp(!exp)} style={{ padding: "14px 16px", cursor: "pointer" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <div style={{ width: 38, height: 38, borderRadius: 10, flexShrink: 0, background: isAct ? "linear-gradient(135deg,#16a34a,#22c55e)" : "linear-gradient(135deg,#1d4ed8,#3b82f6)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 13, fontWeight: 800, color: "#fff" }}>
              {loan.status === "completed" ? <Icon name="check" size={16} /> : `L${num}`}
            </div>
            <div>
              <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 2 }}>
                <span style={{ fontSize: 13, fontWeight: 700, color: "#e8f4fd" }}>Cycle {num}</span>
                <Badge color={isAct ? "#4ade80" : "#60a5fa"} bg={isAct ? "rgba(34,197,94,0.12)" : "rgba(96,165,250,0.12)"}>{isAct ? "ACTIVE" : "DONE"}</Badge>
                {(loan.restructureLog || []).length > 0 && <Badge color="#c084fc" bg="rgba(192,132,252,0.12)">RESTRUCTURED</Badge>}
              </div>
              <div style={{ fontSize: 10, color: "#3a5a70" }}>{fd(loan.startDate)} · {loan.days}d · {loan.interestRate}%</div>
            </div>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <div style={{ textAlign: "right" }}>
              <div style={{ fontSize: 13, fontWeight: 800, color: "#60a5fa", fontFamily: "'Courier New',monospace" }}>{fc(loan.principal)}</div>
            </div>
            <div style={{ color: "#3a5a70" }}>{exp ? <Icon name="chevronUp" size={14} /> : <Icon name="chevronDown" size={14} />}</div>
          </div>
        </div>
        <div style={{ marginTop: 10 }}>
          <div style={{ display: "flex", justifyContent: "space-between", fontSize: 9, color: "#3a5a70", marginBottom: 4 }}>
            <span>{fin.paidCount}/{fin.totalCount}</span>
            <span style={{ color: pc }}>{fin.completionRate.toFixed(0)}%</span>
          </div>
          <div style={{ height: 4, background: "rgba(255,255,255,0.06)", borderRadius: 4, overflow: "hidden" }}>
            <div style={{ height: "100%", width: `${fin.completionRate}%`, background: `linear-gradient(90deg,${pc},${pc}99)`, borderRadius: 4 }} />
          </div>
        </div>
      </div>
      {exp && (
        <div style={{ padding: "14px 16px" }}>
          {isAct && <ShortfallBanner loan={loan} />}
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
            {[["Principal", fc(loan.principal), "#93c5fd"], ["Daily", fc(loan.dailyPayment), "#60a5fa"], ["Total", fc(loan.totalRepayable), "#e8f4fd"], ["Collected", fc(fin.collected), "#4ade80"], ["Outstanding", fc(Math.max(0, loan.totalRepayable - fin.collected)), fin.outstandingPrincipal > 0 ? "#f87171" : "#4ade80"], ["Interest", `${loan.interestRate}%`, "#c4b5fd"]].map(([l, v, c]) => (
              <div key={l} style={{ background: "rgba(255,255,255,0.02)", borderRadius: 9, padding: "9px 10px", border: "1px solid rgba(255,255,255,0.04)" }}>
                <div style={{ fontSize: 8, color: "#3a5a70", marginBottom: 3 }}>{l}</div>
                <div style={{ fontSize: 11, fontWeight: 700, color: c, fontFamily: "'Courier New',monospace" }}>{v}</div>
              </div>
            ))}
          </div>
          {isAdmin && (
            <div style={{ background: "rgba(0,0,0,0.2)", borderRadius: 12, padding: "12px 14px", marginBottom: 14 }}>
              <div style={{ fontSize: 11, color: "#5a7a90", fontWeight: 700, marginBottom: 10 }}>FINANCIAL INTELLIGENCE</div>
              {[["Interest Earned", fc(fin.interestEarned), "#a78bfa"], ["Profit", fc(fin.trueProfit), "#22c55e"], ["ROI", `${fin.realROI.toFixed(2)}%`, fin.realROI >= 20 ? "#22c55e" : "#f59e0b"], ["Collection", `${fin.collectionRate.toFixed(1)}%`, "#f59e0b"]].map(([l, v, c]) => (
                <div key={l} style={{ display: "flex", justifyContent: "space-between", marginBottom: 6 }}>
                  <span style={{ fontSize: 11, color: "#8ab4c8" }}>{l}</span>
                  <span style={{ fontSize: 12, fontWeight: 700, color: c, fontFamily: "'Courier New',monospace" }}>{v}</span>
                </div>
              ))}
            </div>
          )}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 6, marginBottom: 14 }}>
            {[["On Time", fin.onTimeCount, "#4ade80", "rgba(34,197,94,0.06)"], ["Late", fin.lateCount, "#f59e0b", "rgba(245,158,11,0.06)"], ["Partial", fin.partialCount, "#f87171", "rgba(239,68,68,0.06)"], ["Overdue", fin.overdueCount, "#ef4444", "rgba(239,68,68,0.08)"]].map(([l, v, c, bg]) => (
              <div key={l} style={{ background: bg, borderRadius: 10, padding: "10px 8px", textAlign: "center" }}>
                <div style={{ fontSize: 16, fontWeight: 800, color: c }}>{v}</div>
                <div style={{ fontSize: 9, color: "#5a7a90", marginTop: 2 }}>{l}</div>
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
            <button onClick={() => onRestructure(loan)} style={{ width: "100%", background: "rgba(192,132,252,0.1)", border: "1px solid rgba(192,132,252,0.25)", color: "#c084fc", padding: "11px", borderRadius: 10, cursor: "pointer", fontWeight: 700, fontSize: 13, display: "flex", alignItems: "center", justifyContent: "center", gap: 6, marginBottom: 10, minHeight: 44 }}>
              <Icon name="restructure" size={13} />Restructure Loan
            </button>
          )}
          <button onClick={() => setSchOpen(!schOpen)} style={{ width: "100%", background: "rgba(100,180,255,0.06)", border: "1px solid rgba(100,180,255,0.12)", color: "#60a5fa", padding: "11px", borderRadius: 10, cursor: "pointer", fontWeight: 700, fontSize: 13, display: "flex", alignItems: "center", justifyContent: "center", gap: 6, marginBottom: schOpen ? 10 : 0, minHeight: 44 }}>
            <Icon name="calendar" size={13} />{schOpen ? "Hide" : "View"} Schedule
          </button>
          {schOpen && (
            <div>
              {loan.schedule?.map((s, idx) => (
                <InstRow key={idx} s={s} i={idx} loan={loan} isActive={isAct} isAdmin={isAdmin} today={today} onPay={onPay} onOverride={onOverride} />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

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
            <input style={IS} value={u} onChange={e => setU(e.target.value)} onKeyDown={e => e.key === "Enter" && go()} placeholder="Username" autoFocus />
          </Field>
          <Field label="Password">
            <div style={{ position: "relative" }}>
              <input type={show ? "text" : "password"} style={{ ...IS, paddingRight: 44 }} value={p} onChange={e => setP(e.target.value)} onKeyDown={e => e.key === "Enter" && go()} placeholder="Password" />
              <button onClick={() => setShow(s => !s)} style={{ position: "absolute", right: 8, top: "50%", transform: "translateY(-50%)", background: "none", border: "none", color: "#3a5a70", cursor: "pointer", width: 36, height: 36, fontSize: 16 }}>{show ? "🙈" : "👁️"}</button>
            </div>
          </Field>
          {err && <div style={{ background: "rgba(239,68,68,0.1)", border: "1px solid rgba(239,68,68,0.2)", borderRadius: 8, padding: "10px 12px", fontSize: 12, color: "#f87171", marginBottom: 14 }}>{err}</div>}
          <button onClick={go} style={{ width: "100%", background: "linear-gradient(135deg,#22c55e,#16a34a)", border: "none", color: "#000", padding: "14px", borderRadius: 12, cursor: "pointer", fontWeight: 800, fontSize: 15, minHeight: 48 }}>Sign In →</button>
        </div>
      </div>
    </div>
  );
      }
function StaffPanel({ users, clients, pendingLoans, currentUser, onUpdateUsers, onApproveLoan, onRejectLoan, showToast }) {
  const [showAdd, setShowAdd] = useState(false);
  const [ns, setNs] = useState({ name: "", username: "", password: "", role: "loan_officer" });
  const [editS, setEditS] = useState(null);
  const [resetPwd, setResetPwd] = useState(null);
  const [newPwd, setNewPwd] = useState("");
  const [showStaffReport, setShowStaffReport] = useState(false);
  const [reportMonth, setReportMonth] = useState(curMonthKey);

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
          <h1 style={{ margin: 0, fontSize: 22, fontWeight: 800, color: "#e8f4fd" }}>Staff</h1>
          <p style={{ margin: "4px 0 0", color: "#3a5a70", fontSize: 13 }}>{users.filter(u => u.role !== "admin").length} members</p>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <button onClick={() => setShowStaffReport(true)} style={{ background: "rgba(167,139,250,0.12)", border: "1px solid rgba(167,139,250,0.25)", color: "#a78bfa", padding: "10px 14px", borderRadius: 11, cursor: "pointer", fontWeight: 700, fontSize: 12, display: "flex", alignItems: "center", gap: 6, minHeight: 40 }}>
            <Icon name="chart" size={13} />Reports
          </button>
          <button onClick={() => setShowAdd(true)} style={{ background: "linear-gradient(135deg,#3b82f6,#2563eb)", border: "none", color: "#fff", padding: "10px 16px", borderRadius: 11, cursor: "pointer", fontWeight: 700, fontSize: 13, display: "flex", alignItems: "center", gap: 6, minHeight: 40 }}>
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
                    <div style={{ fontSize: 13, fontWeight: 700, color: "#e8f4fd" }}>{cl?.name || "?"}</div>
                    <div style={{ fontSize: 10, color: "#3a5a70" }}>By {off?.name} · {fd(pl.requestedAt?.split("T")[0])}</div>
                  </div>
                  <div style={{ textAlign: "right" }}>
                    <div style={{ fontSize: 14, fontWeight: 800, color: "#60a5fa", fontFamily: "'Courier New',monospace" }}>{fc(pl.loanData.principal)}</div>
                  </div>
                </div>
                <div style={{ display: "flex", gap: 8 }}>
                  <button onClick={() => onApproveLoan(pl)} style={{ flex: 1, background: "linear-gradient(135deg,#22c55e,#16a34a)", border: "none", color: "#000", padding: "11px", borderRadius: 9, cursor: "pointer", fontWeight: 700, fontSize: 12, minHeight: 44 }}>✓ Approve</button>
                  <button onClick={() => onRejectLoan(pl.id)} style={{ flex: 1, background: "rgba(239,68,68,0.1)", border: "1px solid rgba(239,68,68,0.2)", color: "#f87171", padding: "11px", borderRadius: 9, cursor: "pointer", fontWeight: 700, fontSize: 12, minHeight: 44 }}>✕ Reject</button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {users.filter(u => u.role !== "admin").map(o => {
        const st = getStats(o.id);
        return (
          <div key={o.id} style={{ background: "rgba(255,255,255,0.025)", border: `1px solid ${o.active ? "rgba(100,180,255,0.1)" : "rgba(255,255,255,0.04)"}`, borderRadius: 14, padding: "14px 16px", marginBottom: 10 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <div style={{ width: 42, height: 42, borderRadius: 12, background: o.active ? "linear-gradient(135deg,#1d4ed8,#3b82f6)" : "rgba(255,255,255,0.06)", display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 800, fontSize: 17, color: o.active ? "#fff" : "#3a5a70" }}>{o.name.charAt(0)}</div>
                <div>
                  <div style={{ fontSize: 14, fontWeight: 700, color: o.active ? "#dceef8" : "#3a5a70" }}>{o.name}</div>
                  <div style={{ fontSize: 11, color: "#3a5a70" }}>@{o.username}</div>
                  <div style={{ marginTop: 4 }}>
                    <RB role={o.role} />
                    {!o.active && <Badge color="#6b7a8d" bg="rgba(107,122,141,0.1)"> INACTIVE</Badge>}
                  </div>
                </div>
              </div>
              <div style={{ display: "flex", gap: 6 }}>
                <button onClick={() => setResetPwd(o)} style={{ background: "rgba(245,158,11,0.1)", border: "1px solid rgba(245,158,11,0.2)", color: "#f59e0b", width: 36, height: 36, borderRadius: 8, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}>
                  <Icon name="key" size={13} />
                </button>
                <button onClick={() => setEditS(o)} style={{ background: "rgba(59,130,246,0.1)", border: "1px solid rgba(59,130,246,0.2)", color: "#60a5fa", width: 36, height: 36, borderRadius: 8, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}>
                  <Icon name="edit" size={13} />
                </button>
                <button onClick={() => onUpdateUsers(users.map(u => u.id === o.id ? { ...u, active: !u.active } : u))} style={{ background: o.active ? "rgba(239,68,68,0.08)" : "rgba(34,197,94,0.08)", border: `1px solid ${o.active ? "rgba(239,68,68,0.2)" : "rgba(34,197,94,0.2)"}`, color: o.active ? "#f87171" : "#4ade80", width: 36, height: 36, borderRadius: 8, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}>
                  {o.active ? <Icon name="lock" size={13} /> : <Icon name="unlock" size={13} />}
                </button>
              </div>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8 }}>
              {[["Clients", st.clients, "#60a5fa"], ["Active", st.activeLoans, "#4ade80"], ["Collected", fc(st.collected), "#a78bfa"]].map(([l, v, c]) => (
                <div key={l} style={{ background: "rgba(0,0,0,0.2)", borderRadius: 9, padding: "9px 10px" }}>
                  <div style={{ fontSize: 9, color: "#3a5a70", marginBottom: 3 }}>{l}</div>
                  <div style={{ fontSize: 11, fontWeight: 700, color: c, fontFamily: "'Courier New',monospace" }}>{v}</div>
                </div>
              ))}
            </div>
          </div>
        );
      })}

      {showAdd && (
        <Modal title="Create Staff Account" onClose={() => setShowAdd(false)}>
          <Field label="Name *"><input style={IS} value={ns.name} onChange={e => setNs(p => ({ ...p, name: e.target.value }))} autoFocus /></Field>
          <Field label="Username *"><input style={IS} value={ns.username} onChange={e => setNs(p => ({ ...p, username: e.target.value.toLowerCase().replace(/\s/g, "") }))} /></Field>
          <Field label="Password *"><input type="password" style={IS} value={ns.password} onChange={e => setNs(p => ({ ...p, password: e.target.value }))} placeholder="Min 4 chars" /></Field>
          <button onClick={handleAdd} style={{ width: "100%", background: "linear-gradient(135deg,#3b82f6,#2563eb)", border: "none", color: "#fff", padding: "14px", borderRadius: 12, cursor: "pointer", fontWeight: 800, fontSize: 14, minHeight: 48 }}>✓ Create</button>
        </Modal>
      )}

      {editS && (
        <Modal title="Edit Staff" onClose={() => setEditS(null)}>
          <Field label="Name"><input style={IS} value={editS.name} onChange={e => setEditS(p => ({ ...p, name: e.target.value }))} /></Field>
          <Field label="Username"><input style={IS} value={editS.username} onChange={e => setEditS(p => ({ ...p, username: e.target.value.toLowerCase().replace(/\s/g, "") }))} /></Field>
          <button onClick={() => {
            if (editS.username && users.find(u => u.username === editS.username && u.id !== editS.id)) { showToast("Taken", "error"); return; }
            onUpdateUsers(users.map(u => u.id === editS.id ? { ...u, name: editS.name, username: editS.username } : u));
            setEditS(null);
            showToast("Updated!");
          }} style={{ width: "100%", background: "linear-gradient(135deg,#3b82f6,#2563eb)", border: "none", color: "#fff", padding: "14px", borderRadius: 12, cursor: "pointer", fontWeight: 800, minHeight: 48 }}>✓ Save</button>
        </Modal>
      )}

      {resetPwd && (
        <Modal title="🔑 Reset Password" onClose={() => { setResetPwd(null); setNewPwd(""); }}>
          <Field label="New Password *"><input type="password" style={IS} value={newPwd} onChange={e => setNewPwd(e.target.value)} placeholder="Min 4 characters" autoFocus /></Field>
          <button onClick={handleReset} style={{ width: "100%", background: "#f59e0b", border: "none", color: "#000", padding: "14px", borderRadius: 12, cursor: "pointer", fontWeight: 800, minHeight: 48 }}>✓ Reset</button>
        </Modal>
      )}

      {showStaffReport && (
        <Modal title="📊 Staff Monthly Report" onClose={() => setShowStaffReport(false)} wide>
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 20 }}>
            <div style={{ fontSize: 13, color: "#8ab4c8", fontWeight: 600 }}>Month:</div>
            <select style={{ ...IS, width: "auto", minWidth: 160 }} value={reportMonth} onChange={e => setReportMonth(e.target.value)}>
              {availableMonths.map(m => <option key={m} value={m}>{fm(m)}</option>)}
            </select>
          </div>
          {staffReport.length === 0 ? (
            <div style={{ textAlign: "center", padding: 40, color: "#3a5a70" }}>No staff data.</div>
          ) : staffReport.map(sr => {
            const rateColor = sr.collectionRate >= 80 ? "#22c55e" : sr.collectionRate >= 50 ? "#f59e0b" : "#ef4444";
            return (
              <div key={sr.officer.id} style={{ background: "rgba(255,255,255,0.025)", border: "1px solid rgba(100,180,255,0.1)", borderRadius: 16, padding: "16px", marginBottom: 14 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 14 }}>
                  <div style={{ width: 44, height: 44, borderRadius: 12, background: "linear-gradient(135deg,#1d4ed8,#3b82f6)", display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 800, fontSize: 18, color: "#fff", flexShrink: 0 }}>{sr.officer.name.charAt(0)}</div>
                  <div style={{ flexGrow: 1 }}>
                    <div style={{ fontSize: 15, fontWeight: 700, color: "#e8f4fd" }}>{sr.officer.name}</div>
                    <div style={{ fontSize: 11, color: "#3a5a70" }}>@{sr.officer.username} · {fm(reportMonth)}</div>
                  </div>
                  <div style={{ textAlign: "right" }}>
                    <div style={{ fontSize: 18, fontWeight: 900, color: rateColor, fontFamily: "'Courier New',monospace" }}>{sr.collectionRate.toFixed(1)}%</div>
                    <div style={{ fontSize: 9, color: "#3a5a70" }}>Rate</div>
                  </div>
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 8 }}>
                  {[["💰 Disbursed", fc(sr.disbursed), "#60a5fa"], ["📥 Collected", fc(sr.collected), "#4ade80"], ["📊 Outstanding", fc(sr.outstanding), "#f87171"], ["👥 Clients", sr.totalClients, "#93c5fd"], ["🏃 Active", sr.activeClients, "#f59e0b"], ["📋 Loans", sr.loansIssued, "#c4b5fd"], ["✅ Payments", sr.paymentsReceived, "#4ade80"], ["⚠️ Overdue", sr.overdueCount, "#ef4444"], ["💎 Savings", fc(sr.savingsBalance), "#c084fc"]].map(([l, v, c]) => (
                    <div key={l} style={{ background: "rgba(0,0,0,0.2)", borderRadius: 9, padding: "9px 10px" }}>
                      <div style={{ fontSize: 9, color: "#3a5a70", marginBottom: 3 }}>{l}</div>
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
  const [confirmDelete, setConfirmDelete] = useState(null);
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
  const [newClient, setNewClient] = useState({ name: "", phone: "", address: "", idNumber: "", occupation: "", guarantorName: "", guarantorPhone: "", guarantorRelationship: "", guarantorOccupation: "" });
  const [newLoan, setNewLoan] = useState({ principal: "", interestRate: "15", days: "24", startDate: todayStr, excludeWeekends: true });
  const [showRestructure, setShowRestructure] = useState(null);
  const [restructureInput, setRestructureInput] = useState({ newDailyAmount: "", reason: "" });
  const [routeVisited, setRouteVisited] = useState({});
  const [lastBackupDate, setLastBackupDate] = useState(() => localStorage.getItem("creda_last_backup") || null);
  const [dismissedBackup, setDismissedBackup] = useState(false);
  const [sessionTimeout, setSessionTimeout] = useState(() => parseInt(localStorage.getItem("creda_timeout") || "10"));
  const [lastActivity, setLastActivity] = useState(Date.now());
  const [showTimeoutWarning, setShowTimeoutWarning] = useState(false);
  const [showTimeoutSettings, setShowTimeoutSettings] = useState(false);

  const showToast = useCallback((msg, type = "success") => {
    setToast({ msg, type });
    setTimeout(() => setToast({ msg: "", type: "success" }), 3000);
  }, []);

  const isAdmin = currentUser?.role === "admin";
  const today = new Date();

  useEffect(() => {
    if (!currentUser) return;
    const resetActivity = () => {
      setLastActivity(Date.now());
      if (showTimeoutWarning) setShowTimeoutWarning(false);
    };
    const events = ["mousedown", "keydown", "touchstart", "scroll", "click"];
    events.forEach(e => window.addEventListener(e, resetActivity, { passive: true }));
    const checker = setInterval(() => {
      const idle = (Date.now() - lastActivity) / 60000;
      const warnAt = sessionTimeout - 2;
      if (idle >= sessionTimeout) {
        setCurrentUser(null);
        setShowTimeoutWarning(false);
        showToast("Logged out due to inactivity", "error");
      } else if (idle >= warnAt && !showTimeoutWarning) {
        setShowTimeoutWarning(true);
      }
    }, 30000);
    return () => {
      events.forEach(e => window.removeEventListener(e, resetActivity));
      clearInterval(checker);
    };
  }, [currentUser, lastActivity, sessionTimeout, showTimeoutWarning, showToast]);

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
          e += l.totalRepayable || 0;
          (l.schedule || []).forEach(s => {
            if (s.paidAmount > 0) c += s.paidAmount;
            else if (new Date(s.dueDate) < today) o++;
          });
        });
      });
      return { totalDisbursed: d, totalExpected: e, totalCollected: c, outstanding: e - c, overdueCount: o, totalSavings: src.reduce((a, cl) => a + (cl.savingsBalance || 0), 0) };
    }
    return computeMonthlyStats(src, curMonthKey);
  }, [clients, visibleClients, isAdmin]);

  // ─── OFFICER PORTFOLIO TOTALS (all-time) ─────────────────────
  const officerPortfolio = useMemo(() => {
    const src = visibleClients;
    let totalCapital = 0, totalCollectedEver = 0, totalOutstanding = 0;
    let activeClientCount = 0, activeLoanCount = 0, overdueTotal = 0;
    const t = new Date();
    src.forEach(c => {
      let hasActive = false;
      (c.loans || []).forEach(l => {
        totalCapital += l.principal || 0;
        const collected = (l.schedule || []).reduce((sum, s) => sum + (s.paidAmount || 0), 0);
        totalCollectedEver += collected;
        if (l.status === "active") {
          hasActive = true;
          activeLoanCount++;
          const remaining = (l.schedule || []).filter(s => !s.paid).reduce((sum, s) => sum + (s.payment - (s.paidAmount || 0)), 0);
          totalOutstanding += remaining;
          (l.schedule || []).forEach(s => {
            if (!s.paid && new Date(s.dueDate) < t) {
              overdueTotal += (s.payment - (s.paidAmount || 0));
            }
          });
        }
      });
      if (hasActive) activeClientCount++;
    });
    return { totalCapital, totalCollectedEver, totalOutstanding, activeClientCount, activeLoanCount, overdueTotal };
  }, [visibleClients]);

  const monthlyReport = useMemo(() => computeMonthlyReport(clients), [clients]);

  const dailyCollectionData = useMemo(() => {
    const src = isAdmin ? clients : visibleClients;
    const map = {};
    src.forEach(c => {
      (c.loans || []).forEach(l => {
        if (l.status === "completed") return;
        (l.schedule || []).forEach(s => {
          const due = s.dueDate;
          if (!due) return;
          if (!map[due]) map[due] = { date: due, expected: 0, collected: 0, installments: [] };
          if (!s.paid) map[due].expected += s.payment || 0;
          if (s.paidAmount > 0) map[due].collected += s.paidAmount;
          map[due].installments.push({ clientName: c.name, clientId: c.id, day: s.day, totalDays: l.days, payment: s.payment, paidAmount: s.paidAmount || 0, paid: s.paid, paidDate: s.paidDate, dueDate: s.dueDate, loanStatus: l.status });
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

  const handleAddClient = () => {
    if (!newClient.name.trim() || !newClient.phone.trim()) return;
    saveClients([{ ...newClient, id: generateId("CL"), loans: [], savingsBalance: 0, savingsLogs: [], assignedTo: currentUser?.id, assignedToName: currentUser?.name, createdAt: todayStr }, ...clients]);
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
    setNewLoan({ principal: "", interestRate: "15", days: "24", startDate: todayStr, excludeWeekends: true });
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
    setNewLoan({ principal: "", interestRate: "15", days: "24", startDate: todayStr, excludeWeekends: true });
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

  const handlePayment = (customAmount) => {
    const amount = customAmount || parseFloat(paymentAmount);
    if (!amount || !showPayment) return;
    const { clientId, loanId, scheduleIdx } = showPayment;
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
    setPaymentAmount(""); setShowPayment(null);
    showToast("Payment recorded!");
  };

  const handleDirectPay = (clientId, loanId, scheduleIdx, amount) => {
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
    showToast("Payment recorded!");
  };

  const handleRestructure = () => {
    if (!showRestructure || !restructureInput.newDailyAmount) return;
    const newAmt = parseFloat(restructureInput.newDailyAmount);
    if (isNaN(newAmt) || newAmt <= 0) { showToast("Invalid amount", "error"); return; }
    if (!restructureInput.reason.trim()) { showToast("Reason required", "error"); return; }
    saveClients(clients.map(c => {
      const hasLoan = c.loans?.find(l => l.id === showRestructure.id);
      if (!hasLoan) return c;
      return { ...c, loans: c.loans.map(l => l.id === showRestructure.id ? restructureLoan(l, newAmt, restructureInput.reason, currentUser?.name) : l) };
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
    const blob = new Blob([JSON.stringify({ clients, users, pendingLoans, v: "12.0", at: new Date().toISOString() }, null, 2)], { type: "application/json" });
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
    return <LoginScreen users={users} onLogin={u => { setCurrentUser(u); setLastActivity(Date.now()); }} />;
  }

  const currentClient = selectedClient;
  const activeLoan = currentClient?.loans?.find(l => l.status === "active");
  const clientFin = currentClient ? computeClientFinancials(currentClient) : null;

  return (
    <div style={{ minHeight: "100vh", background: "#060f1a", paddingBottom: "calc(80px + env(safe-area-inset-bottom))", WebkitTapHighlightColor: "transparent", WebkitTextSizeAdjust: "100%", touchAction: "manipulation" }}>
      <Toast msg={toast.msg} type={toast.type} />

      <header style={{ position: "sticky", top: 0, background: "rgba(6,15,26,0.95)", backdropFilter: "blur(12px)", borderBottom: "1px solid rgba(100,180,255,0.08)", padding: "12px 16px", display: "flex", justifyContent: "space-between", alignItems: "center", zIndex: 50 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <div style={{ width: 36, height: 36, borderRadius: 10, background: "linear-gradient(135deg,#0a5c36,#0d7a48)", display: "flex", alignItems: "center", justifyContent: "center" }}>
            <span style={{ color: "#fff", fontWeight: 900, fontSize: 15 }}>C</span>
          </div>
          <div style={{ fontSize: 15, fontWeight: 800, color: "#e8f4fd", letterSpacing: 1, fontFamily: "serif" }}>CREDA</div>
        </div>
        <div style={{ display: "flex", gap: 6 }}>
          <div style={{ width: 32, height: 32, display: "flex", alignItems: "center", justifyContent: "center", color: sync === "synced" ? "#4ade80" : "#f59e0b", fontSize: 16 }}>{sync === "synced" ? "☁" : "⟳"}</div>
          <button onClick={() => setShowProfile(true)} style={{ background: "rgba(96,165,250,0.1)", border: "1px solid rgba(96,165,250,0.2)", color: "#60a5fa", width: 40, height: 40, borderRadius: 10, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}><Icon name="user" size={15} /></button>
          <button onClick={exportData} style={{ background: "rgba(107,122,141,0.1)", border: "1px solid rgba(107,122,141,0.2)", color: "#8ab4c8", width: 40, height: 40, borderRadius: 10, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}><Icon name="dashboard" size={15} /></button>
          <button onClick={() => setCurrentUser(null)} style={{ background: "rgba(239,68,68,0.1)", border: "1px solid rgba(239,68,68,0.2)", color: "#f87171", width: 40, height: 40, borderRadius: 10, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}><Icon name="logout" size={15} /></button>
        </div>
      </header>

      <main style={{ padding: "16px" }}>
        {isAdmin && adminMode === "accountant" && (
          <div>
            <div style={{ background: "linear-gradient(135deg, rgba(167,139,250,0.15), rgba(139,92,246,0.08))", borderRadius: 20, padding: "20px 22px", marginBottom: 20, border: "1px solid rgba(167,139,250,0.2)" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
                <div>
                  <div style={{ fontSize: 11, color: "#c4b5fd", fontWeight: 700, letterSpacing: 1.5, textTransform: "uppercase", marginBottom: 4 }}>Financial Ops</div>
                  <h1 style={{ margin: 0, fontSize: 24, fontWeight: 900, color: "#fff" }}>Accountant</h1>
                </div>
                <button onClick={() => setAdminMode("admin")} style={{ background: "rgba(245,158,11,0.15)", border: "1px solid rgba(245,158,11,0.3)", color: "#f59e0b", padding: "8px 14px", borderRadius: 9, cursor: "pointer", fontWeight: 700, fontSize: 12, minHeight: 40 }}>👑 Admin</button>
              </div>
            </div>
            {(() => {
              const todayData = dailyCollectionData.find(d => d.date === todayStr) || { expected: 0, collected: 0, installments: [] };
              const gap = Math.max(0, todayData.expected - todayData.collected);
              const rate = todayData.expected > 0 ? (todayData.collected / todayData.expected) * 100 : 0;
              return (
                <div style={{ background: "linear-gradient(135deg, rgba(16,30,50,0.85), rgba(10,20,40,0.9))", border: "1px solid rgba(100,180,255,0.15)", borderRadius: 18, padding: 18, marginBottom: 18 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 16 }}>
                    <div style={{ width: 32, height: 32, borderRadius: 9, background: "linear-gradient(135deg,#16a34a,#22c55e)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 15 }}>📅</div>
                    <div>
                      <div style={{ fontSize: 13, fontWeight: 800, color: "#4ade80" }}>Today's Collection</div>
                      <div style={{ fontSize: 10, color: "#5a7a90" }}>{fd(todayStr)}</div>
                    </div>
                  </div>
                  <div style={{ textAlign: "center", padding: "10px 0 16px", borderBottom: "1px solid rgba(255,255,255,0.05)" }}>
                    <div style={{ fontSize: 32, fontWeight: 900, color: "#4ade80", fontFamily: "'Courier New',monospace", letterSpacing: -1 }}>{fc(todayData.collected)}</div>
                    <div style={{ fontSize: 11, color: "#5a7a90", marginTop: 6 }}>of {fc(todayData.expected)} expected</div>
                  </div>
                  <div style={{ padding: "16px 0" }}>
                    <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6 }}>
                      <span style={{ fontSize: 10, color: "#5a7a90", fontWeight: 600 }}>Progress</span>
                      <span style={{ fontSize: 12, color: rate >= 80 ? "#4ade80" : rate >= 50 ? "#f59e0b" : "#f87171", fontWeight: 800, fontFamily: "'Courier New',monospace" }}>{rate.toFixed(1)}%</span>
                    </div>
                    <div style={{ height: 8, background: "rgba(255,255,255,0.05)", borderRadius: 6, overflow: "hidden" }}>
                      <div style={{ height: "100%", width: `${Math.min(rate, 100)}%`, background: rate >= 80 ? "linear-gradient(90deg,#22c55e,#4ade80)" : rate >= 50 ? "linear-gradient(90deg,#d97706,#f59e0b)" : "linear-gradient(90deg,#dc2626,#f87171)", borderRadius: 6 }} />
                    </div>
                  </div>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8 }}>
                    <div style={{ padding: 10, background: "rgba(96,165,250,0.06)", borderRadius: 10, border: "1px solid rgba(96,165,250,0.15)", textAlign: "center" }}>
                      <div style={{ fontSize: 8, color: "#5a7a90" }}>EXPECTED</div>
                      <div style={{ fontSize: 13, fontWeight: 800, color: "#60a5fa", fontFamily: "'Courier New',monospace", marginTop: 3 }}>{fc(todayData.expected)}</div>
                    </div>
                    <div style={{ padding: 10, background: "rgba(74,222,128,0.06)", borderRadius: 10, border: "1px solid rgba(74,222,128,0.15)", textAlign: "center" }}>
                      <div style={{ fontSize: 8, color: "#5a7a90" }}>COLLECTED</div>
                      <div style={{ fontSize: 13, fontWeight: 800, color: "#4ade80", fontFamily: "'Courier New',monospace", marginTop: 3 }}>{fc(todayData.collected)}</div>
                    </div>
                    <div style={{ padding: 10, background: gap > 0 ? "rgba(248,113,113,0.06)" : "rgba(74,222,128,0.06)", borderRadius: 10, border: `1px solid ${gap > 0 ? "rgba(248,113,113,0.15)" : "rgba(74,222,128,0.15)"}`, textAlign: "center" }}>
                      <div style={{ fontSize: 8, color: "#5a7a90" }}>GAP</div>
                      <div style={{ fontSize: 13, fontWeight: 800, color: gap > 0 ? "#f87171" : "#4ade80", fontFamily: "'Courier New',monospace", marginTop: 3 }}>{fc(gap)}</div>
                    </div>
                  </div>
                </div>
              );
            })()}
            <div style={{ display: "flex", gap: 6, marginBottom: 16, padding: 4, background: "rgba(0,0,0,0.25)", borderRadius: 12 }}>
              {["today", "week", "month", "all"].map(f => (
                <button key={f} onClick={() => setAcctDateFilter(f)} style={{ flex: 1, background: acctDateFilter === f ? "linear-gradient(135deg,#16a34a,#22c55e)" : "transparent", border: "none", color: acctDateFilter === f ? "#000" : "#5a7a90", padding: "11px 12px", borderRadius: 9, cursor: "pointer", fontWeight: 700, fontSize: 12, textTransform: "capitalize", minHeight: 42 }}>{f}</button>
              ))}
            </div>
            {dailyCollectionData.filter(d => {
              if (acctDateFilter === "today") return d.date === todayStr;
              if (acctDateFilter === "week") { const diff = (new Date() - new Date(d.date)) / (86400000); return diff >= 0 && diff <= 7; }
              if (acctDateFilter === "month") return d.date.slice(0, 7) === curMonthKey;
              return true;
            }).map(day => {
              const dayRate = day.expected > 0 ? (day.collected / day.expected) * 100 : 0;
              const isToday = day.date === todayStr;
              const pending = day.installments.filter(i => !i.paid);
              const paid = day.installments.filter(i => i.paid);
              return (
                <div key={day.date} style={{ background: "linear-gradient(135deg, rgba(16,30,50,0.7), rgba(10,20,40,0.5))", border: `1px solid ${isToday ? "rgba(74,222,128,0.25)" : "rgba(100,180,255,0.08)"}`, borderRadius: 16, padding: 16, marginBottom: 14 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 12 }}>
                    <div>
                      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                        <span style={{ fontSize: 15, fontWeight: 800, color: "#e8f4fd" }}>{fd(day.date)}</span>
                        {isToday && <span style={{ fontSize: 9, padding: "2px 8px", background: "linear-gradient(135deg,#16a34a,#22c55e)", color: "#000", borderRadius: 20, fontWeight: 800 }}>TODAY</span>}
                      </div>
                      <div style={{ fontSize: 10, color: "#5a7a90", marginTop: 3 }}>{new Date(day.date).toLocaleDateString("en-NG", { weekday: "long" })}</div>
                    </div>
                    <div style={{ textAlign: "right" }}>
                      <div style={{ fontSize: 15, fontWeight: 800, color: "#4ade80", fontFamily: "'Courier New',monospace" }}>{fc(day.collected)}</div>
                      <div style={{ fontSize: 10, color: "#5a7a90", fontFamily: "'Courier New',monospace" }}>/ {fc(day.expected)}</div>
                    </div>
                  </div>
                  <div style={{ height: 5, background: "rgba(255,255,255,0.05)", borderRadius: 4, overflow: "hidden", marginBottom: 14 }}>
                    <div style={{ height: "100%", width: `${Math.min(dayRate, 100)}%`, background: dayRate >= 80 ? "linear-gradient(90deg,#22c55e,#4ade80)" : dayRate >= 50 ? "linear-gradient(90deg,#d97706,#f59e0b)" : "linear-gradient(90deg,#dc2626,#f87171)", borderRadius: 4 }} />
                  </div>
                  {pending.length > 0 && (
                    <div>
                      <div style={{ fontSize: 10, color: "#f59e0b", fontWeight: 700, marginBottom: 8, textTransform: "uppercase" }}>Pending</div>
                      {pending.map((i, idx) => (
                        <div key={idx} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "8px 12px", background: "rgba(255,255,255,0.02)", borderRadius: 9, marginBottom: 5 }}>
                          <div>
                            <div style={{ fontSize: 12, fontWeight: 600, color: "#e8f4fd" }}>{i.clientName}</div>
                            <div style={{ fontSize: 9, color: "#5a7a90" }}>Day {i.day}/{i.totalDays}</div>
                          </div>
                          <div style={{ fontSize: 13, fontWeight: 800, color: "#60a5fa", fontFamily: "'Courier New',monospace" }}>{fc(i.payment - (i.paidAmount || 0))}</div>
                        </div>
                      ))}
                    </div>
                  )}
                  {paid.length > 0 && (
                    <div style={{ marginTop: pending.length ? 12 : 0 }}>
                      <div style={{ fontSize: 10, color: "#4ade80", fontWeight: 700, marginBottom: 8, textTransform: "uppercase" }}>✓ Collected ({paid.length})</div>
                      {paid.map((i, idx) => (
                        <div key={idx} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "6px 12px", background: "rgba(74,222,128,0.04)", borderRadius: 8, marginBottom: 4, opacity: 0.7 }}>
                          <div style={{ fontSize: 11, color: "#8ab4c8" }}><span style={{ color: "#4ade80" }}>✓</span> {i.clientName} · Day {i.day}/{i.totalDays}</div>
                          <div style={{ fontSize: 11, fontWeight: 700, color: "#4ade80", fontFamily: "'Courier New',monospace" }}>{fc(i.paidAmount)}</div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {(!isAdmin || adminMode === "admin") && view === "dashboard" && (
          <div>
            <div style={{ background: "linear-gradient(135deg, rgba(59,130,246,0.15), rgba(34,197,94,0.08), rgba(167,139,250,0.1))", borderRadius: 20, padding: "20px 22px", marginBottom: 20, border: "1px solid rgba(100,180,255,0.15)", position: "relative", overflow: "hidden" }}>
              <div style={{ position: "absolute", top: -40, right: -40, width: 140, height: 140, background: "radial-gradient(circle, rgba(59,130,246,0.2), transparent)", borderRadius: "50%" }} />
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", position: "relative" }}>
                <div>
                  <div style={{ fontSize: 11, color: "#60a5fa", fontWeight: 700, letterSpacing: 1.5, textTransform: "uppercase", marginBottom: 6 }}>{new Date().toLocaleDateString("en-NG", { weekday: "long" })} · {fd(todayStr)}</div>
                  <h1 style={{ margin: 0, fontSize: 26, fontWeight: 900, color: "#fff", letterSpacing: -0.5, lineHeight: 1.1 }}>{(() => { const h = new Date().getHours(); return h < 12 ? "Good Morning" : h < 17 ? "Good Afternoon" : "Good Evening"; })()}</h1>
                  <div style={{ fontSize: 13, color: "#8ab4c8", marginTop: 4, fontWeight: 500 }}>{currentUser.name.split(" ")[0]} · {isAdmin ? "Portfolio" : "Your Portfolio"}</div>
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: 6, alignItems: "flex-end" }}>
                  <RB role={currentUser.role} />
                  {isAdmin && (
                    <button onClick={() => setAdminMode("accountant")} style={{ background: "linear-gradient(135deg, rgba(167,139,250,0.2), rgba(139,92,246,0.15))", border: "1px solid rgba(167,139,250,0.3)", color: "#c4b5fd", padding: "9px 14px", borderRadius: 9, cursor: "pointer", fontWeight: 700, fontSize: 11, minHeight: 38 }}>📊 Finance</button>
                  )}
                </div>
              </div>
            </div>
            {showBackupReminder && isAdmin && (
              <div style={{ background: "rgba(245,158,11,0.1)", border: "1px solid rgba(245,158,11,0.3)", borderRadius: 12, padding: "10px 14px", marginBottom: 16, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <span style={{ fontSize: 18 }}>💾</span>
                  <div>
                    <div style={{ fontSize: 12, fontWeight: 700, color: "#f59e0b" }}>Backup Reminder</div>
                    <div style={{ fontSize: 10, color: "#7a6030" }}>{lastBackupDate ? `Last: ${Math.floor((new Date() - new Date(lastBackupDate)) / 86400000)}d ago` : "No backup yet"}</div>
                  </div>
                </div>
                <div style={{ display: "flex", gap: 6 }}>
                  <button onClick={exportData} style={{ background: "#f59e0b", border: "none", color: "#000", padding: "8px 12px", borderRadius: 8, cursor: "pointer", fontWeight: 700, fontSize: 11, minHeight: 36 }}>Backup</button>
                  <button onClick={() => setDismissedBackup(true)} style={{ background: "rgba(255,255,255,0.06)", border: "none", color: "#5a7a90", padding: "8px 12px", borderRadius: 8, cursor: "pointer", minHeight: 36 }}>×</button>
                </div>
              </div>
            )}
            {isAdmin && pendingLoans.length > 0 && (
              <div onClick={() => setView("staff")} style={{ background: "linear-gradient(135deg, rgba(245,158,11,0.12), rgba(234,88,12,0.08))", border: "1px solid rgba(245,158,11,0.3)", borderRadius: 14, padding: "14px 16px", marginBottom: 16, cursor: "pointer", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <div style={{ width: 36, height: 36, borderRadius: 10, background: "rgba(245,158,11,0.15)", display: "flex", alignItems: "center", justifyContent: "center" }}><Icon name="bell" size={16} /></div>
                  <div>
                    <div style={{ fontSize: 13, fontWeight: 700, color: "#f59e0b" }}>{pendingLoans.length} Pending Approval{pendingLoans.length > 1 ? "s" : ""}</div>
                    <div style={{ fontSize: 10, color: "#7a6030", marginTop: 2 }}>Tap to review</div>
                  </div>
                </div>
              </div>
            )}
            {!isAdmin && todayRoute.length > 0 && (
              <div style={{ background: "linear-gradient(135deg,rgba(59,130,246,0.08),rgba(34,197,94,0.06))", border: "1px solid rgba(96,165,250,0.2)", borderRadius: 16, padding: 16, marginBottom: 20 }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <Icon name="route" size={16} />
                    <div>
                      <div style={{ fontSize: 14, fontWeight: 800, color: "#60a5fa" }}>Today's Route</div>
                      <div style={{ fontSize: 10, color: "#3a5a70" }}>{todayRoute.length} client{todayRoute.length !== 1 ? "s" : ""}</div>
                    </div>
                  </div>
                </div>
                {todayRoute.map((r, idx) => (
                  <div key={idx} onClick={() => { setSelectedClientId(r.clientId); setView("detail"); }} style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 12px", background: "rgba(255,255,255,0.02)", border: `1px solid ${r.risk.level === "red" ? "rgba(239,68,68,0.25)" : "rgba(100,180,255,0.08)"}`, borderRadius: 10, marginBottom: 8, cursor: "pointer" }}>
                    <div style={{ flexGrow: 1 }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                        <span style={{ fontSize: 13, fontWeight: 700, color: "#e8f4fd" }}>{r.clientName}</span>
                        <span>{r.risk.emoji}</span>
                      </div>
                      <div style={{ fontSize: 10, color: "#3a5a70" }}>{r.phone}</div>
                    </div>
                    <div style={{ fontSize: 13, fontWeight: 800, color: "#60a5fa", fontFamily: "'Courier New',monospace" }}>{fc(r.payment)}</div>
                  </div>
                ))}
              </div>
            )}

            {isAdmin ? (
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 22 }}>
                <ModernStatCard label="Disbursed" value={fc(stats.totalDisbursed)} icon="💰" gradient="linear-gradient(135deg,#1e40af,#3b82f6)" />
                <ModernStatCard label="Collected" value={fc(stats.totalCollected)} icon="📥" gradient="linear-gradient(135deg,#15803d,#22c55e)" />
                <ModernStatCard label="Outstanding" value={fc(stats.outstanding)} icon="⏳" gradient="linear-gradient(135deg,#b45309,#f59e0b)" danger={stats.outstanding > stats.totalDisbursed * 0.5} />
                <ModernStatCard label="Savings" value={fc(stats.totalSavings)} icon="💎" gradient="linear-gradient(135deg,#7e22ce,#a855f7)" />
              </div>
            ) : (
              <>
                <div style={{ marginBottom: 16 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10, padding: "0 4px" }}>
                    <div style={{ width: 28, height: 28, borderRadius: 8, background: "linear-gradient(135deg,#3b82f6,#60a5fa)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 13 }}>📅</div>
                    <div>
                      <div style={{ fontSize: 13, fontWeight: 800, color: "#60a5fa" }}>This Month</div>
                      <div style={{ fontSize: 9, color: "#5a7a90" }}>{fm(curMonthKey)} — resets monthly</div>
                    </div>
                  </div>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                    <ModernStatCard label="Disbursed" value={fc(stats.totalDisbursed)} icon="💰" gradient="linear-gradient(135deg,#1e40af,#3b82f6)" />
                    <ModernStatCard label="Collected" value={fc(stats.totalCollected)} icon="📥" gradient="linear-gradient(135deg,#15803d,#22c55e)" />
                    <ModernStatCard label="Expected" value={fc(stats.totalExpected || 0)} icon="📊" gradient="linear-gradient(135deg,#7c3aed,#a855f7)" />
                    <ModernStatCard label="Month Gap" value={fc(stats.outstanding)} icon="⏳" gradient="linear-gradient(135deg,#b45309,#f59e0b)" danger={stats.outstanding > 0} />
                  </div>
                </div>

                <div style={{ marginBottom: 22 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10, padding: "0 4px" }}>
                    <div style={{ width: 28, height: 28, borderRadius: 8, background: "linear-gradient(135deg,#16a34a,#22c55e)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 13 }}>🏦</div>
                    <div>
                      <div style={{ fontSize: 13, fontWeight: 800, color: "#4ade80" }}>My Portfolio</div>
                      <div style={{ fontSize: 9, color: "#5a7a90" }}>All-time totals across all clients</div>
                    </div>
                  </div>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 10 }}>
                    <ModernStatCard label="Capital Given" value={fc(officerPortfolio.totalCapital)} icon="🛡️" gradient="linear-gradient(135deg,#0369a1,#0ea5e9)" />
                    <ModernStatCard label="Total Collected" value={fc(officerPortfolio.totalCollectedEver)} icon="💵" gradient="linear-gradient(135deg,#166534,#16a34a)" />
                    <ModernStatCard label="Outstanding" value={fc(officerPortfolio.totalOutstanding)} icon="⚠️" gradient="linear-gradient(135deg,#991b1b,#dc2626)" danger={officerPortfolio.totalOutstanding > 0} />
                    <ModernStatCard label="Savings" value={fc(stats.totalSavings)} icon="💎" gradient="linear-gradient(135deg,#7e22ce,#a855f7)" />
                  </div>
                  <div style={{ background: "linear-gradient(135deg,rgba(74,222,128,0.06),rgba(34,197,94,0.03))", border: "1px solid rgba(74,222,128,0.15)", borderRadius: 12, padding: "12px 14px", display: "flex", justifyContent: "space-around" }}>
                    <div style={{ textAlign: "center", flex: 1 }}>
                      <div style={{ fontSize: 9, color: "#5a7a90", letterSpacing: 0.5 }}>ACTIVE</div>
                      <div style={{ fontSize: 16, fontWeight: 900, color: "#4ade80", fontFamily: "'Courier New',monospace", marginTop: 2 }}>{officerPortfolio.activeClientCount}</div>
                      <div style={{ fontSize: 8, color: "#3a5a70" }}>clients</div>
                    </div>
                    <div style={{ width: 1, background: "rgba(255,255,255,0.06)" }} />
                    <div style={{ textAlign: "center", flex: 1 }}>
                      <div style={{ fontSize: 9, color: "#5a7a90", letterSpacing: 0.5 }}>LOANS</div>
                      <div style={{ fontSize: 16, fontWeight: 900, color: "#60a5fa", fontFamily: "'Courier New',monospace", marginTop: 2 }}>{officerPortfolio.activeLoanCount}</div>
                      <div style={{ fontSize: 8, color: "#3a5a70" }}>running</div>
                    </div>
                    {officerPortfolio.overdueTotal > 0 && (
                      <>
                        <div style={{ width: 1, background: "rgba(255,255,255,0.06)" }} />
                        <div style={{ textAlign: "center", flex: 1 }}>
                          <div style={{ fontSize: 9, color: "#5a7a90", letterSpacing: 0.5 }}>OVERDUE</div>
                          <div style={{ fontSize: 14, fontWeight: 900, color: "#f87171", fontFamily: "'Courier New',monospace", marginTop: 2 }}>{fc(officerPortfolio.overdueTotal)}</div>
                          <div style={{ fontSize: 8, color: "#3a5a70" }}>to recover</div>
                        </div>
                      </>
                    )}
                  </div>
                </div>
              </>
            )}

            {isAdmin && <ModernPortfolioCard fin={globalFin} expanded={expandFinancials} onToggle={() => setExpandFinancials(!expandFinancials)} />}
            {isAdmin && <DefaultersSection clients={clients} monthKey={null} onSelectClient={id => { setSelectedClientId(id); setView("detail"); }} />}
            {isAdmin && (
              <div style={{ background: "linear-gradient(135deg,rgba(16,30,50,0.7),rgba(10,20,40,0.5))", border: "1px solid rgba(100,180,255,0.1)", borderRadius: 18, padding: 18, marginBottom: 20 }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                    <div style={{ width: 32, height: 32, borderRadius: 9, background: "rgba(147,197,253,0.15)", display: "flex", alignItems: "center", justifyContent: "center" }}><Icon name="chart" size={15} /></div>
                    <div>
                      <h3 style={{ margin: 0, fontSize: 14, fontWeight: 800, color: "#e8f4fd" }}>Monthly Performance</h3>
                      <p style={{ margin: "2px 0 0", fontSize: 10, color: "#5a7a90" }}>Loan trends</p>
                    </div>
                  </div>
                  <button onClick={() => setExpandMonthlyHistory(!expandMonthlyHistory)} style={{ background: "rgba(147,197,253,0.12)", border: "none", borderRadius: 9, color: "#93c5fd", padding: "9px 14px", fontSize: 11, cursor: "pointer", fontWeight: 700, minHeight: 38 }}>{expandMonthlyHistory ? "Hide ▲" : "View ▼"}</button>
                </div>
                {expandMonthlyHistory && (
                  <div style={{ marginTop: 16, display: "flex", flexDirection: "column", gap: 10 }}>
                    {monthlyReport.length === 0 ? (
                      <div style={{ fontSize: 12, color: "#3a5a70", textAlign: "center", padding: 20 }}>📊 No data</div>
                    ) : monthlyReport.map(item => {
                      const rate = item.expected > 0 ? (item.collected / item.expected) * 100 : 0;
                      const rc = rate >= 80 ? "#22c55e" : rate >= 50 ? "#f59e0b" : "#ef4444";
                      return (
                        <div key={item.month} style={{ padding: "14px 16px", background: "rgba(0,0,0,0.25)", borderRadius: 14, borderLeft: `3px solid ${rc}` }}>
                          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
                            <div>
                              <div style={{ fontWeight: 800, color: "#e8f4fd", fontSize: 14 }}>{fm(item.month)}</div>
                              <div style={{ fontSize: 10, color: "#5a7a90", marginTop: 2 }}>{item.loanCount} loan{item.loanCount !== 1 ? "s" : ""} · {item.clientCount} client{item.clientCount !== 1 ? "s" : ""}</div>
                            </div>
                            <div style={{ background: `${rc}20`, border: `1px solid ${rc}40`, borderRadius: 8, padding: "4px 10px" }}>
                              <span style={{ fontSize: 13, fontWeight: 800, color: rc, fontFamily: "'Courier New',monospace" }}>{rate.toFixed(1)}%</span>
                            </div>
                          </div>
                          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                            {[["DISBURSED", item.disbursed, "#93c5fd"], ["COLLECTED", item.collected, "#4ade80"], ["INTEREST", item.interest, "#c4b5fd"], ["OUTSTANDING", item.outstanding, "#f87171"]].map(([l, v, c]) => (
                              <div key={l} style={{ padding: "8px 10px", background: `${c}10`, borderRadius: 8, border: `1px solid ${c}20` }}>
                                <div style={{ fontSize: 8, color: "#5a7a90", letterSpacing: 0.8 }}>{l}</div>
                                <div style={{ fontSize: 11, fontWeight: 800, color: c, fontFamily: "'Courier New',monospace" }}>{fc(v)}</div>
                              </div>
                            ))}
                          </div>
                          <div style={{ marginTop: 10, height: 5, background: "rgba(255,255,255,0.05)", borderRadius: 4, overflow: "hidden" }}>
                            <div style={{ height: "100%", width: `${Math.min(rate, 100)}%`, background: `linear-gradient(90deg,${rc},${rc}cc)`, borderRadius: 4 }} />
                          </div>
                        </div>
                      );
                    })}
                    {computeDefaultingClientsReport(clients, curMonthKey).length > 0 && (
                      <div style={{ marginTop: 6, padding: "14px 16px", background: "rgba(239,68,68,0.06)", border: "1px solid rgba(239,68,68,0.2)", borderRadius: 12 }}>
                        <div style={{ fontSize: 12, fontWeight: 700, color: "#f87171", marginBottom: 10 }}>⚠️ Defaulting Clients — {fm(curMonthKey)}</div>
                        {computeDefaultingClientsReport(clients, curMonthKey).map(d => (
                          <div key={d.clientId} onClick={() => { setSelectedClientId(d.clientId); setView("detail"); }} style={{ background: "rgba(0,0,0,0.25)", border: "1px solid rgba(239,68,68,0.15)", borderRadius: 10, padding: "10px 12px", marginBottom: 8, cursor: "pointer", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                            <div>
                              <div style={{ fontSize: 12, fontWeight: 700, color: "#e8f4fd" }}>{d.clientName}</div>
                              <div style={{ fontSize: 10, color: "#7a3a3a", marginTop: 2 }}>{d.phone} · {d.daysOverdue} day{d.daysOverdue !== 1 ? "s" : ""} overdue</div>
                            </div>
                            <div style={{ textAlign: "right" }}>
                              <div style={{ fontSize: 13, fontWeight: 800, color: "#f87171", fontFamily: "'Courier New',monospace" }}>{fc(d.totalOwed)}</div>
                              <div style={{ fontSize: 9, color: "#5a3030" }}>owed</div>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
              <div style={{ fontSize: 15, fontWeight: 800, color: "#e8f4fd" }}>Recent Activity</div>
              <button onClick={() => setView("clients")} style={{ background: "rgba(59,130,246,0.1)", border: "1px solid rgba(59,130,246,0.2)", color: "#60a5fa", fontSize: 11, cursor: "pointer", padding: "8px 14px", borderRadius: 9, fontWeight: 700, minHeight: 36 }}>View All →</button>
            </div>
            {visibleClients.slice(0, 5).map(c => {
              const { active, overdue, balance } = getClientSummary(c);
              const risk = computeClientRisk(c);
              return (
                <div key={c.id} onClick={() => { setSelectedClientId(c.id); setView("detail"); }} style={{ background: "linear-gradient(135deg,rgba(255,255,255,0.03),rgba(255,255,255,0.01))", border: `1px solid ${risk.level === "red" ? "rgba(239,68,68,0.2)" : "rgba(100,180,255,0.08)"}`, borderRadius: 14, padding: "14px 16px", cursor: "pointer", display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                    <div style={{ width: 42, height: 42, borderRadius: 12, background: `linear-gradient(135deg,${risk.level === "red" ? "#7f1d1d,#dc2626" : risk.level === "amber" ? "#92400e,#f59e0b" : "#1d4ed8,#3b82f6"})`, display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 800, fontSize: 16, color: "#fff" }}>{c.name.charAt(0).toUpperCase()}</div>
                    <div>
                      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                        <span style={{ fontWeight: 700, color: "#e8f4fd", fontSize: 14 }}>{c.name}</span>
                        <span>{risk.emoji}</span>
                      </div>
                      <div style={{ fontSize: 11, color: "#5a7a90" }}>{c.phone}{overdue > 0 && <span style={{ color: "#f87171", fontWeight: 700 }}> · {overdue} overdue</span>}</div>
                    </div>
                  </div>
                  <div style={{ textAlign: "right" }}>
                    {active ? (<>
                      <div style={{ fontSize: 14, fontWeight: 800, color: "#60a5fa", fontFamily: "'Courier New',monospace" }}>{fc(balance)}</div>
                      <div style={{ fontSize: 9, color: "#3a5a70", marginTop: 2 }}>Balance</div>
                    </>) : <div style={{ fontSize: 11, color: "#3a5a70" }}>No active loan</div>}
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {(!isAdmin || adminMode === "admin") && view === "clients" && (
          <div>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
              <div>
                <h1 style={{ margin: 0, fontSize: 22, fontWeight: 800, color: "#e8f4fd" }}>Clients</h1>
                <p style={{ margin: "4px 0 0", color: "#3a5a70", fontSize: 13 }}>{filteredClients.length} of {visibleClients.length}</p>
              </div>
              <button onClick={() => setShowAddClient(true)} style={{ background: "linear-gradient(135deg,#22c55e,#16a34a)", border: "none", color: "#000", padding: "12px 18px", borderRadius: 11, cursor: "pointer", fontWeight: 800, fontSize: 13, display: "flex", alignItems: "center", gap: 6, minHeight: 44 }}><Icon name="plus" size={14} />Add</button>
            </div>
            <div style={{ position: "relative", marginBottom: 12 }}>
              <input placeholder="Search name or phone..." value={clientSearch} onChange={e => setClientSearch(e.target.value)} style={{ ...IS, paddingLeft: 40 }} />
              <div style={{ position: "absolute", left: 12, top: "50%", transform: "translateY(-50%)", color: "#3a5a70" }}><Icon name="search" size={15} /></div>
            </div>
            <div style={{ display: "flex", gap: 6, marginBottom: 14, overflowX: "auto", WebkitOverflowScrolling: "touch" }}>
              {[["all", "All"], ["active", "Active"], ["completed", "Done"], ["none", "No Loan"], ["red", "🔴 High"], ["amber", "🟡 Watch"]].map(([k, v]) => (
                <button key={k} onClick={() => setClientFilter(k)} style={{ background: clientFilter === k ? "linear-gradient(135deg,#3b82f6,#2563eb)" : "rgba(255,255,255,0.04)", border: "none", color: clientFilter === k ? "#fff" : "#5a7a90", padding: "9px 14px", borderRadius: 8, cursor: "pointer", fontWeight: 700, fontSize: 11, whiteSpace: "nowrap", minHeight: 36 }}>{v}</button>
              ))}
            </div>
            {filteredClients.length === 0 ? (
              <div style={{ textAlign: "center", padding: 40, color: "#3a5a70" }}>No clients found</div>
            ) : filteredClients.map(c => {
              const { active, overdue, balance } = getClientSummary(c);
              const risk = computeClientRisk(c);
              return (
                <div key={c.id} onClick={() => { setSelectedClientId(c.id); setView("detail"); }} style={{ background: "rgba(255,255,255,0.025)", border: `1px solid ${risk.level === "red" ? "rgba(239,68,68,0.2)" : "rgba(100,180,255,0.08)"}`, borderRadius: 12, padding: "12px 14px", cursor: "pointer", marginBottom: 8, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                    <div style={{ width: 38, height: 38, borderRadius: 10, background: `linear-gradient(135deg,${risk.level === "red" ? "#7f1d1d,#dc2626" : risk.level === "amber" ? "#92400e,#f59e0b" : "#1d4ed8,#3b82f6"})`, display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 800, color: "#fff", fontSize: 15 }}>{c.name.charAt(0).toUpperCase()}</div>
                    <div>
                      <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
                        <span style={{ fontSize: 13, fontWeight: 700, color: "#e8f4fd" }}>{c.name}</span>
                        <span>{risk.emoji}</span>
                      </div>
                      <div style={{ fontSize: 10, color: "#3a5a70" }}>{c.phone}{overdue > 0 && ` · ${overdue} overdue`}</div>
                    </div>
                  </div>
                  <div style={{ textAlign: "right" }}>
                    {active ? <div style={{ fontSize: 12, fontWeight: 800, color: "#60a5fa", fontFamily: "'Courier New',monospace" }}>{fc(balance)}</div> : <div style={{ fontSize: 10, color: "#3a5a70" }}>No loan</div>}
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {(!isAdmin || adminMode === "admin") && view === "detail" && currentClient && (
          <div>
            <button onClick={() => setView("clients")} style={{ background: "rgba(100,180,255,0.06)", border: "1px solid rgba(100,180,255,0.12)", color: "#60a5fa", padding: "9px 14px", borderRadius: 9, cursor: "pointer", marginBottom: 14, display: "flex", alignItems: "center", gap: 5, fontSize: 12, minHeight: 40 }}><Icon name="back" size={13} />Back</button>
            <div style={{ background: "linear-gradient(135deg,rgba(59,130,246,0.1),rgba(34,197,94,0.06))", border: "1px solid rgba(100,180,255,0.15)", borderRadius: 18, padding: 18, marginBottom: 16 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 12 }}>
                <div style={{ width: 56, height: 56, borderRadius: 14, background: "linear-gradient(135deg,#1d4ed8,#3b82f6)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 22, fontWeight: 900, color: "#fff" }}>{currentClient.name.charAt(0).toUpperCase()}</div>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 17, fontWeight: 800, color: "#e8f4fd" }}>{currentClient.name}</div>
                  <div style={{ fontSize: 12, color: "#8ab4c8", marginTop: 2 }}>📞 {currentClient.phone}</div>
                  <div style={{ marginTop: 5 }}>{(() => { const r = computeClientRisk(currentClient); return <Badge color={r.color} bg={r.bg}>{r.emoji} {r.label}</Badge>; })()}</div>
                </div>
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                {currentClient.address && <div style={{ fontSize: 11, color: "#8ab4c8" }}>📍 {currentClient.address}</div>}
                {currentClient.idNumber && <div style={{ fontSize: 11, color: "#8ab4c8" }}>🆔 {currentClient.idNumber}</div>}
                {currentClient.occupation && <div style={{ fontSize: 11, color: "#8ab4c8" }}>💼 {currentClient.occupation}</div>}
                {currentClient.assignedToName && <div style={{ fontSize: 11, color: "#8ab4c8" }}>👤 {currentClient.assignedToName}</div>}
              </div>
              {currentClient.guarantorName && (
                <div style={{ marginTop: 12, padding: "10px 12px", background: "rgba(0,0,0,0.2)", borderRadius: 10 }}>
                  <div style={{ fontSize: 10, color: "#5a7a90", marginBottom: 4 }}>GUARANTOR</div>
                  <div style={{ fontSize: 12, color: "#e8f4fd", fontWeight: 600 }}>{currentClient.guarantorName}</div>
                  <div style={{ fontSize: 10, color: "#8ab4c8", marginTop: 2 }}>{currentClient.guarantorPhone} · {currentClient.guarantorRelationship}</div>
                  {currentClient.guarantorOccupation && <div style={{ fontSize: 10, color: "#8ab4c8" }}>💼 {currentClient.guarantorOccupation}</div>}
                </div>
              )}
              <div style={{ display: "flex", gap: 6, marginTop: 12 }}>
                <button onClick={() => setShowEditClient(currentClient)} style={{ flex: 1, background: "rgba(59,130,246,0.1)", border: "1px solid rgba(59,130,246,0.2)", color: "#60a5fa", padding: "10px", borderRadius: 8, cursor: "pointer", fontSize: 11, fontWeight: 700, minHeight: 40 }}>Edit</button>
                {isAdmin && <button onClick={() => setShowAssignClient(currentClient)} style={{ flex: 1, background: "rgba(167,139,250,0.1)", border: "1px solid rgba(167,139,250,0.2)", color: "#a78bfa", padding: "10px", borderRadius: 8, cursor: "pointer", fontSize: 11, fontWeight: 700, minHeight: 40 }}>Reassign</button>}
                {isAdmin && <button onClick={() => setConfirmDelete(currentClient)} style={{ flex: 1, background: "rgba(239,68,68,0.1)", border: "1px solid rgba(239,68,68,0.2)", color: "#f87171", padding: "10px", borderRadius: 8, cursor: "pointer", fontSize: 11, fontWeight: 700, minHeight: 40 }}>Delete</button>}
              </div>
            </div>
            {isAdmin && <FP fin={{ ...clientFin, totalCapital: clientFin.capital }} isClient />}
            {!activeLoan && (
              <button onClick={() => setShowAddLoan(true)} style={{ width: "100%", background: "linear-gradient(135deg,#22c55e,#16a34a)", border: "none", color: "#000", padding: "14px", borderRadius: 12, cursor: "pointer", fontWeight: 800, fontSize: 14, marginBottom: 14, minHeight: 48 }}>+ {isAdmin ? "Issue Loan" : "Request Loan"}</button>
            )}
            <div style={{ display: "flex", gap: 6, marginBottom: 14, padding: 4, background: "rgba(0,0,0,0.25)", borderRadius: 10 }}>
              {[["loans", `Loans (${currentClient.loans?.length || 0})`], ["savings", "Savings"], ["history", "History"]].map(([k, v]) => (
                <button key={k} onClick={() => setActiveTab(k)} style={{ flex: 1, background: activeTab === k ? "linear-gradient(135deg,#3b82f6,#2563eb)" : "transparent", border: "none", color: activeTab === k ? "#fff" : "#5a7a90", padding: "10px", borderRadius: 8, cursor: "pointer", fontWeight: 700, fontSize: 11, minHeight: 40 }}>{v}</button>
              ))}
            </div>
            {activeTab === "loans" && (
              <div>
                {(!currentClient.loans || currentClient.loans.length === 0) ? (
                  <div style={{ textAlign: "center", padding: 30, color: "#3a5a70" }}>No loans yet</div>
                ) : currentClient.loans.map((l, idx) => (
                  <LCC key={l.id} loan={l} num={idx + 1} total={currentClient.loans.length} isAdmin={isAdmin} today={today} onPay={(loan, i, customAmt) => {
                    if (customAmt) {
                      handleDirectPay(currentClient.id, loan.id, i, customAmt);
                    } else {
                      setShowPayment({ clientId: currentClient.id, loanId: loan.id, scheduleIdx: i });
                      setPaymentAmount(loan.schedule[i].payment.toFixed(2));
                    }
                  }} onOverride={(loan, i, s) => {
                    setAdminEditInstallment({ client: currentClient, loan, idx: i });
                    setAdminInstOverride({ paid: s.paid, paidAmount: s.paidAmount || 0, dueDate: s.dueDate, paidDate: s.paidDate || todayStr });
                  }} onRestructure={loan => setShowRestructure(loan)} />
                ))}
              </div>
            )}
            {activeTab === "savings" && (
              <div>
                <div style={{ background: "linear-gradient(135deg,rgba(167,139,250,0.1),rgba(139,92,246,0.06))", border: "1px solid rgba(167,139,250,0.2)", borderRadius: 14, padding: 18, marginBottom: 12, textAlign: "center" }}>
                  <div style={{ fontSize: 11, color: "#c4b5fd", letterSpacing: 1 }}>SAVINGS BALANCE</div>
                  <div style={{ fontSize: 28, fontWeight: 900, color: "#a78bfa", fontFamily: "'Courier New',monospace", marginTop: 6 }}>{fc(currentClient.savingsBalance || 0)}</div>
                </div>
                <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
                  <button onClick={() => setShowSavingsTx({ type: "deposit", client: currentClient })} style={{ flex: 1, background: "linear-gradient(135deg,#22c55e,#16a34a)", border: "none", color: "#000", padding: "12px", borderRadius: 10, cursor: "pointer", fontWeight: 700, minHeight: 44 }}>📥 Deposit</button>
                  <button onClick={() => setShowSavingsTx({ type: "withdraw", client: currentClient })} style={{ flex: 1, background: "rgba(239,68,68,0.1)", border: "1px solid rgba(239,68,68,0.2)", color: "#f87171", padding: "12px", borderRadius: 10, cursor: "pointer", fontWeight: 700, minHeight: 44 }}>📤 Withdraw</button>
                </div>
                {(currentClient.savingsLogs || []).map(log => (
                  <div key={log.id} style={{ background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.04)", borderRadius: 10, padding: "10px 12px", marginBottom: 6, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <div>
                      <div style={{ fontSize: 12, fontWeight: 700, color: log.type === "deposit" ? "#4ade80" : log.type === "withdraw" ? "#f87171" : "#c084fc" }}>{log.type === "deposit" ? "📥 Deposit" : log.type === "withdraw" ? "📤 Withdrawal" : "🛡️ Adjustment"}</div>
                      <div style={{ fontSize: 9, color: "#3a5a70", marginTop: 2 }}>{fd(log.date)}{log.recordedBy ? ` · ${log.recordedBy}` : ""}</div>
                    </div>
                    <div style={{ textAlign: "right" }}>
                      <div style={{ fontSize: 13, fontWeight: 800, color: "#e8f4fd", fontFamily: "'Courier New',monospace" }}>{fc(log.amount)}</div>
                      <div style={{ fontSize: 9, color: "#3a5a70" }}>Bal: {fc(log.balanceAfter)}</div>
                    </div>
                  </div>
                ))}
              </div>
            )}
            {activeTab === "history" && (
              <div>
                {getClientTransactions(currentClient).length === 0 ? (
                  <div style={{ textAlign: "center", padding: 30, color: "#3a5a70" }}>No transactions</div>
                ) : getClientTransactions(currentClient).map(tx => (
                  <div key={tx.id} style={{ background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.04)", borderRadius: 10, padding: "10px 12px", marginBottom: 6, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                      <span style={{ fontSize: 18 }}>{tx.icon}</span>
                      <div>
                        <div style={{ fontSize: 12, fontWeight: 700, color: tx.color }}>{tx.description}</div>
                        <div style={{ fontSize: 9, color: "#3a5a70", marginTop: 2 }}>{tx.detail}</div>
                      </div>
                    </div>
                    <div style={{ fontSize: 13, fontWeight: 800, color: tx.color, fontFamily: "'Courier New',monospace" }}>{fc(tx.amount)}</div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {isAdmin && adminMode === "admin" && view === "staff" && (
          <StaffPanel users={users} clients={clients} pendingLoans={pendingLoans} currentUser={currentUser} onUpdateUsers={saveUsers} onApproveLoan={handleApproveLoan} onRejectLoan={handleRejectLoan} showToast={showToast} />
        )}
      </main>

      <nav style={{ position: "fixed", bottom: 0, left: 0, right: 0, background: "rgba(6,15,26,0.98)", backdropFilter: "blur(16px)", borderTop: "1px solid rgba(100,180,255,0.12)", display: "flex", justifyContent: "space-around", padding: "10px 4px calc(12px + env(safe-area-inset-bottom))", zIndex: 40, boxShadow: "0 -4px 20px rgba(0,0,0,0.4)" }}>
        {[["dashboard", "Overview", "dashboard"], ["clients", "Clients", "user"]].map(([v, l, i]) => (
          <button key={v} onClick={() => { setView(v); if (isAdmin) setAdminMode("admin"); }} style={{ background: "none", border: "none", color: view === v && (adminMode === "admin" || !isAdmin) ? "#4ade80" : "#5a7a90", cursor: "pointer", display: "flex", flexDirection: "column", alignItems: "center", gap: 4, padding: "8px 14px", minWidth: 60, minHeight: 48, borderRadius: 10 }}>
            <Icon name={i} size={20} />
            <span style={{ fontSize: 10, fontWeight: 700 }}>{l}</span>
          </button>
        ))}
        {isAdmin && (
          <button onClick={() => setAdminMode("accountant")} style={{ background: "none", border: "none", color: adminMode === "accountant" ? "#4ade80" : "#5a7a90", cursor: "pointer", display: "flex", flexDirection: "column", alignItems: "center", gap: 4, padding: "8px 14px", minWidth: 60, minHeight: 48, borderRadius: 10 }}>
            <Icon name="account" size={20} />
            <span style={{ fontSize: 10, fontWeight: 700 }}>Accounts</span>
          </button>
        )}
        {isAdmin && (
          <button onClick={() => { setView("staff"); setAdminMode("admin"); }} style={{ background: "none", border: "none", color: view === "staff" ? "#4ade80" : "#5a7a90", cursor: "pointer", display: "flex", flexDirection: "column", alignItems: "center", gap: 4, padding: "8px 14px", minWidth: 60, minHeight: 48, borderRadius: 10 }}>
            <Icon name="users" size={20} />
            <span style={{ fontSize: 10, fontWeight: 700 }}>Staff</span>
          </button>
        )}
      </nav>

      {showTimeoutWarning && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,8,20,0.95)", zIndex: 2000, display: "flex", alignItems: "center", justifyContent: "center", padding: 16, backdropFilter: "blur(10px)" }}>
          <div style={{ background: "linear-gradient(135deg, rgba(245,158,11,0.15), rgba(234,88,12,0.1))", border: "2px solid rgba(245,158,11,0.4)", borderRadius: 20, padding: 24, maxWidth: 380, width: "100%", textAlign: "center", boxShadow: "0 20px 60px rgba(245,158,11,0.3)" }}>
            <div style={{ fontSize: 48, marginBottom: 14 }}>⏰</div>
            <div style={{ fontSize: 18, fontWeight: 800, color: "#f59e0b", marginBottom: 8 }}>Session Expiring</div>
            <div style={{ fontSize: 13, color: "#e8f4fd", marginBottom: 20, lineHeight: 1.5 }}>You'll be logged out in 2 minutes due to inactivity.<br /><br /><span style={{ color: "#8ab4c8", fontSize: 11 }}>Tap anywhere or the button below to stay signed in.</span></div>
            <button onClick={() => { setLastActivity(Date.now()); setShowTimeoutWarning(false); }} style={{ width: "100%", background: "linear-gradient(135deg,#22c55e,#16a34a)", border: "none", color: "#000", padding: "14px", borderRadius: 12, cursor: "pointer", fontWeight: 800, fontSize: 14, marginBottom: 10, minHeight: 48 }}>✓ Stay Signed In</button>
            <button onClick={() => { setCurrentUser(null); setShowTimeoutWarning(false); }} style={{ width: "100%", background: "rgba(239,68,68,0.1)", border: "1px solid rgba(239,68,68,0.2)", color: "#f87171", padding: "12px", borderRadius: 12, cursor: "pointer", fontWeight: 700, fontSize: 13, minHeight: 44 }}>Sign Out Now</button>
          </div>
        </div>
      )}

      {showTimeoutSettings && (
        <Modal title="⏰ Session Timeout" onClose={() => setShowTimeoutSettings(false)}>
          <div style={{ padding: 14, background: "rgba(59,130,246,0.06)", borderRadius: 10, marginBottom: 16 }}>
            <div style={{ fontSize: 12, color: "#60a5fa", fontWeight: 700, marginBottom: 6 }}>🔐 Current Setting</div>
            <div style={{ fontSize: 20, fontWeight: 900, color: "#e8f4fd", fontFamily: "'Courier New',monospace" }}>{sessionTimeout} minute{sessionTimeout !== 1 ? "s" : ""}</div>
            <div style={{ fontSize: 10, color: "#5a7a90", marginTop: 6 }}>Users logged out after this idle period</div>
          </div>
          <div style={{ fontSize: 12, color: "#8ab4c8", marginBottom: 10, fontWeight: 600 }}>Choose Duration:</div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 14 }}>
            {[5, 10, 15, 30, 60, 120].map(mins => (
              <button key={mins} onClick={() => { setSessionTimeout(mins); localStorage.setItem("creda_timeout", mins.toString()); setLastActivity(Date.now()); showToast(`Timeout set to ${mins} minutes`); }} style={{ background: sessionTimeout === mins ? "linear-gradient(135deg,#22c55e,#16a34a)" : "rgba(255,255,255,0.04)", border: "none", color: sessionTimeout === mins ? "#000" : "#8ab4c8", padding: "14px", borderRadius: 10, cursor: "pointer", fontWeight: 800, fontSize: 13, minHeight: 48 }}>{mins < 60 ? `${mins} min` : `${mins / 60} hr`}</button>
            ))}
          </div>
          <button onClick={() => setShowTimeoutSettings(false)} style={{ width: "100%", background: "linear-gradient(135deg,#3b82f6,#2563eb)", border: "none", color: "#fff", padding: "14px", borderRadius: 12, cursor: "pointer", fontWeight: 800, minHeight: 48 }}>Done</button>
        </Modal>
      )}

      {showAddClient && (
        <Modal title="Register Client" onClose={() => setShowAddClient(false)}>
          <Field label="Name *"><input style={IS} value={newClient.name} onChange={e => setNewClient(p => ({ ...p, name: e.target.value }))} autoFocus /></Field>
          <Field label="Phone *"><input style={IS} value={newClient.phone} onChange={e => setNewClient(p => ({ ...p, phone: e.target.value }))} /></Field>
          <Field label="Address"><input style={IS} value={newClient.address} onChange={e => setNewClient(p => ({ ...p, address: e.target.value }))} /></Field>
          <Field label="ID/BVN"><input style={IS} value={newClient.idNumber} onChange={e => setNewClient(p => ({ ...p, idNumber: e.target.value }))} /></Field>
          <Field label="Occupation"><input style={IS} value={newClient.occupation} onChange={e => setNewClient(p => ({ ...p, occupation: e.target.value }))} placeholder="e.g. Trader, Teacher, Farmer" /></Field>
          <div style={{ borderTop: "1px solid rgba(255,255,255,0.06)", margin: "16px 0 14px", paddingTop: 12 }}>
            <div style={{ fontSize: 12, color: "#f59e0b", fontWeight: 700, marginBottom: 10 }}>🛡️ Guarantor (Optional)</div>
          </div>
          <Field label="Guarantor Name"><input style={IS} value={newClient.guarantorName} onChange={e => setNewClient(p => ({ ...p, guarantorName: e.target.value }))} /></Field>
          <Field label="Guarantor Phone"><input style={IS} value={newClient.guarantorPhone} onChange={e => setNewClient(p => ({ ...p, guarantorPhone: e.target.value }))} /></Field>
          <Field label="Relationship"><input style={IS} value={newClient.guarantorRelationship} onChange={e => setNewClient(p => ({ ...p, guarantorRelationship: e.target.value }))} placeholder="e.g. Spouse, Sibling, Employer" /></Field>
          <Field label="Guarantor Occupation"><input style={IS} value={newClient.guarantorOccupation} onChange={e => setNewClient(p => ({ ...p, guarantorOccupation: e.target.value }))} placeholder="e.g. Civil Servant, Business Owner" /></Field>
          <button onClick={handleAddClient} style={{ width: "100%", background: "linear-gradient(135deg,#22c55e,#16a34a)", border: "none", color: "#000", padding: "14px", borderRadius: 12, cursor: "pointer", fontWeight: 800, fontSize: 14, minHeight: 48 }}>✓ Register</button>
        </Modal>
      )}

      {showEditClient && (
        <Modal title="Edit Client" onClose={() => setShowEditClient(null)}>
          <Field label="Name *"><input style={IS} value={showEditClient.name} onChange={e => setShowEditClient(p => ({ ...p, name: e.target.value }))} /></Field>
          <Field label="Phone *"><input style={IS} value={showEditClient.phone} onChange={e => setShowEditClient(p => ({ ...p, phone: e.target.value }))} /></Field>
          <Field label="Address"><input style={IS} value={showEditClient.address || ""} onChange={e => setShowEditClient(p => ({ ...p, address: e.target.value }))} /></Field>
          <Field label="ID/BVN"><input style={IS} value={showEditClient.idNumber || ""} onChange={e => setShowEditClient(p => ({ ...p, idNumber: e.target.value }))} /></Field>
          <Field label="Occupation"><input style={IS} value={showEditClient.occupation || ""} onChange={e => setShowEditClient(p => ({ ...p, occupation: e.target.value }))} /></Field>
          <div style={{ borderTop: "1px solid rgba(255,255,255,0.06)", margin: "16px 0 14px", paddingTop: 12 }}>
            <div style={{ fontSize: 12, color: "#f59e0b", fontWeight: 700, marginBottom: 10 }}>🛡️ Guarantor</div>
          </div>
          <Field label="Guarantor Name"><input style={IS} value={showEditClient.guarantorName || ""} onChange={e => setShowEditClient(p => ({ ...p, guarantorName: e.target.value }))} /></Field>
          <Field label="Guarantor Phone"><input style={IS} value={showEditClient.guarantorPhone || ""} onChange={e => setShowEditClient(p => ({ ...p, guarantorPhone: e.target.value }))} /></Field>
          <Field label="Relationship"><input style={IS} value={showEditClient.guarantorRelationship || ""} onChange={e => setShowEditClient(p => ({ ...p, guarantorRelationship: e.target.value }))} /></Field>
          <Field label="Guarantor Occupation"><input style={IS} value={showEditClient.guarantorOccupation || ""} onChange={e => setShowEditClient(p => ({ ...p, guarantorOccupation: e.target.value }))} /></Field>
          <button onClick={handleUpdateClient} style={{ width: "100%", background: "linear-gradient(135deg,#3b82f6,#2563eb)", border: "none", color: "#fff", padding: "14px", borderRadius: 12, cursor: "pointer", fontWeight: 800, minHeight: 48 }}>✓ Save</button>
        </Modal>
      )}

      {showAddLoan && (
        <Modal title={isAdmin ? "Issue Loan" : "Request Loan"} onClose={() => setShowAddLoan(false)}>
          <Field label="Principal *"><input type="number" style={IS} value={newLoan.principal} onChange={e => setNewLoan(p => ({ ...p, principal: e.target.value }))} autoFocus /></Field>
          <Field label="Interest Rate (%)"><input type="number" style={IS} value={newLoan.interestRate} onChange={e => setNewLoan(p => ({ ...p, interestRate: e.target.value }))} /></Field>
          <Field label="Days"><input type="number" style={IS} value={newLoan.days} onChange={e => setNewLoan(p => ({ ...p, days: e.target.value }))} /></Field>
          <Field label="Start Date"><input type="date" style={IS} value={newLoan.startDate} onChange={e => setNewLoan(p => ({ ...p, startDate: e.target.value }))} /></Field>
          <label style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 14, cursor: "pointer", padding: "10px 4px" }}>
            <input type="checkbox" checked={newLoan.excludeWeekends} onChange={e => setNewLoan(p => ({ ...p, excludeWeekends: e.target.checked }))} style={{ width: 20, height: 20 }} />
            <span style={{ fontSize: 13, color: "#8ab4c8" }}>Exclude weekends & holidays</span>
          </label>
          <button onClick={isAdmin ? handleAddLoan : handleRequestLoan} style={{ width: "100%", background: "linear-gradient(135deg,#22c55e,#16a34a)", border: "none", color: "#000", padding: "14px", borderRadius: 12, cursor: "pointer", fontWeight: 800, minHeight: 48 }}>✓ {isAdmin ? "Issue" : "Request"}</button>
        </Modal>
      )}

      {showPayment && (
        <Modal title="Record Payment" onClose={() => { setShowPayment(null); setPaymentAmount(""); }}>
          <Field label="Amount *"><input type="number" style={IS} value={paymentAmount} onChange={e => setPaymentAmount(e.target.value)} autoFocus /></Field>
          <button onClick={() => handlePayment()} style={{ width: "100%", background: "linear-gradient(135deg,#22c55e,#16a34a)", border: "none", color: "#000", padding: "14px", borderRadius: 12, cursor: "pointer", fontWeight: 800, minHeight: 48 }}>✓ Record</button>
        </Modal>
      )}

      {showSavingsTx && (
        <Modal title={showSavingsTx.type === "deposit" ? "📥 Deposit" : "📤 Withdrawal"} onClose={() => { setShowSavingsTx(null); setSavingsAmount(""); setAdminDirectSavingsInput(""); }}>
          <Field label="Amount"><input type="number" style={IS} value={savingsAmount} onChange={e => setSavingsAmount(e.target.value)} autoFocus /></Field>
          <button onClick={handleSavingsTransaction} style={{ width: "100%", background: "linear-gradient(135deg,#22c55e,#16a34a)", border: "none", color: "#000", padding: "14px", borderRadius: 12, cursor: "pointer", fontWeight: 800, marginBottom: isAdmin ? 10 : 0, minHeight: 48 }}>✓ Confirm</button>
          {isAdmin && (
            <>
              <div style={{ margin: "14px 0", padding: 10, background: "rgba(167,139,250,0.06)", borderRadius: 10 }}>
                <div style={{ fontSize: 11, color: "#a78bfa", fontWeight: 700, marginBottom: 6 }}>🛡️ Admin: Set exact balance</div>
                <input type="number" style={IS} value={adminDirectSavingsInput} onChange={e => setAdminDirectSavingsInput(e.target.value)} placeholder="New balance..." />
              </div>
              <button onClick={handleAdminSavingsAdj} style={{ width: "100%", background: "#c084fc", border: "none", color: "#000", padding: "12px", borderRadius: 10, cursor: "pointer", fontWeight: 800, minHeight: 44 }}>Set Balance</button>
            </>
          )}
        </Modal>
      )}

      {adminEditInstallment && (
        <Modal title="Admin: Edit Installment" onClose={() => setAdminEditInstallment(null)}>
          <label style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12, cursor: "pointer", padding: "8px 4px" }}>
            <input type="checkbox" checked={adminInstOverride.paid} onChange={e => setAdminInstOverride(p => ({ ...p, paid: e.target.checked }))} style={{ width: 20, height: 20 }} />
            <span style={{ fontSize: 13, color: "#e8f4fd" }}>Mark as paid</span>
          </label>
          <Field label="Paid Amount"><input type="number" style={IS} value={adminInstOverride.paidAmount} onChange={e => setAdminInstOverride(p => ({ ...p, paidAmount: e.target.value }))} /></Field>
          <Field label="Due Date"><input type="date" style={IS} value={adminInstOverride.dueDate} onChange={e => setAdminInstOverride(p => ({ ...p, dueDate: e.target.value }))} /></Field>
          <Field label="Paid Date"><input type="date" style={IS} value={adminInstOverride.paidDate} onChange={e => setAdminInstOverride(p => ({ ...p, paidDate: e.target.value }))} /></Field>
          <button onClick={handleAdminInstOverride} style={{ width: "100%", background: "#f59e0b", border: "none", color: "#000", padding: "14px", borderRadius: 12, cursor: "pointer", fontWeight: 800, minHeight: 48 }}>✓ Apply</button>
        </Modal>
      )}

      {showRestructure && (
        <Modal title="🔄 Restructure Loan" onClose={() => { setShowRestructure(null); setRestructureInput({ newDailyAmount: "", reason: "" }); }}>
          <Field label="New Daily Amount *"><input type="number" style={IS} value={restructureInput.newDailyAmount} onChange={e => setRestructureInput(p => ({ ...p, newDailyAmount: e.target.value }))} autoFocus /></Field>
          <Field label="Reason *"><textarea style={{ ...IS, minHeight: 60, resize: "vertical" }} value={restructureInput.reason} onChange={e => setRestructureInput(p => ({ ...p, reason: e.target.value }))} placeholder="Why restructure?" /></Field>
          <button onClick={handleRestructure} style={{ width: "100%", background: "linear-gradient(135deg,#c084fc,#a855f7)", border: "none", color: "#fff", padding: "14px", borderRadius: 12, cursor: "pointer", fontWeight: 800, minHeight: 48 }}>✓ Restructure</button>
        </Modal>
      )}

      {showAssignClient && (
        <Modal title="Reassign Client" onClose={() => setShowAssignClient(null)}>
          {users.filter(u => u.role !== "admin" && u.active).map(o => (
            <button key={o.id} onClick={() => handleAssignClient(showAssignClient.id, o.id)} style={{ width: "100%", background: showAssignClient.assignedTo === o.id ? "rgba(34,197,94,0.1)" : "rgba(255,255,255,0.04)", border: `1px solid ${showAssignClient.assignedTo === o.id ? "rgba(34,197,94,0.3)" : "rgba(255,255,255,0.08)"}`, color: "#e8f4fd", padding: "12px 14px", borderRadius: 10, cursor: "pointer", fontSize: 13, marginBottom: 6, textAlign: "left", display: "flex", justifyContent: "space-between", alignItems: "center", minHeight: 48 }}>
              <span>{o.name}</span>
              {showAssignClient.assignedTo === o.id && <Icon name="check" size={14} />}
            </button>
          ))}
        </Modal>
      )}

      {confirmDelete && (
        <Modal title="⚠️ Confirm Delete" onClose={() => setConfirmDelete(null)}>
          <div style={{ padding: 14, background: "rgba(239,68,68,0.08)", borderRadius: 10, marginBottom: 14 }}>
            <div style={{ fontSize: 13, color: "#f87171", fontWeight: 700 }}>Delete {confirmDelete.name}?</div>
            <div style={{ fontSize: 11, color: "#7a3a3a", marginTop: 4 }}>All data will be lost.</div>
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <button onClick={() => setConfirmDelete(null)} style={{ flex: 1, background: "rgba(255,255,255,0.06)", border: "none", color: "#8ab4c8", padding: "12px", borderRadius: 10, cursor: "pointer", fontWeight: 700, minHeight: 44 }}>Cancel</button>
            <button onClick={() => handleDeleteClient(confirmDelete.id)} style={{ flex: 1, background: "#ef4444", border: "none", color: "#fff", padding: "12px", borderRadius: 10, cursor: "pointer", fontWeight: 800, minHeight: 44 }}>Delete</button>
          </div>
        </Modal>
      )}

      {showProfile && (
        <Modal title="👤 Profile" onClose={() => setShowProfile(false)}>
          <div style={{ padding: 14, background: "rgba(59,130,246,0.06)", borderRadius: 10, marginBottom: 14 }}>
            <div style={{ fontSize: 14, fontWeight: 700, color: "#e8f4fd" }}>{currentUser.name}</div>
            <div style={{ fontSize: 11, color: "#5a7a90", marginTop: 2 }}>@{currentUser.username} · <RB role={currentUser.role} /></div>
          </div>
          <div style={{ fontSize: 12, color: "#f59e0b", fontWeight: 700, marginBottom: 10 }}>🔑 Change Password</div>
          <Field label="Current Password"><input type="password" style={IS} value={profileEdit.oldPassword} onChange={e => setProfileEdit(p => ({ ...p, oldPassword: e.target.value }))} /></Field>
          <Field label="New Password"><input type="password" style={IS} value={profileEdit.newPassword} onChange={e => setProfileEdit(p => ({ ...p, newPassword: e.target.value }))} /></Field>
          <Field label="Confirm New"><input type="password" style={IS} value={profileEdit.confirmPassword} onChange={e => setProfileEdit(p => ({ ...p, confirmPassword: e.target.value }))} /></Field>
          <button onClick={handleChangePassword} style={{ width: "100%", background: "linear-gradient(135deg,#3b82f6,#2563eb)", border: "none", color: "#fff", padding: "14px", borderRadius: 12, cursor: "pointer", fontWeight: 800, minHeight: 48 }}>✓ Change Password</button>
          {isAdmin && (
            <>
              <div style={{ borderTop: "1px solid rgba(255,255,255,0.06)", margin: "16px 0 14px", paddingTop: 14 }}>
                <div style={{ fontSize: 12, color: "#a78bfa", fontWeight: 700, marginBottom: 10 }}>⚙️ Security Settings</div>
              </div>
              <button onClick={() => { setShowProfile(false); setShowTimeoutSettings(true); }} style={{ width: "100%", background: "rgba(167,139,250,0.1)", border: "1px solid rgba(167,139,250,0.25)", color: "#a78bfa", padding: "14px", borderRadius: 12, cursor: "pointer", fontWeight: 700, display: "flex", alignItems: "center", justifyContent: "space-between", minHeight: 48 }}>
                <span>⏰ Session Timeout</span>
                <span style={{ background: "rgba(167,139,250,0.15)", padding: "4px 12px", borderRadius: 8, fontFamily: "'Courier New',monospace", fontSize: 12 }}>{sessionTimeout}m</span>
              </button>
            </>
          )}
        </Modal>
      )}
    </div>
  );
    }
