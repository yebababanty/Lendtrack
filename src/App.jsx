import { useState, useEffect, useMemo } from "react";
import { db } from "./firebase";
import {
  doc, setDoc, onSnapshot, getDoc
} from "firebase/firestore";

// ─── FIREBASE SYNC ────────────────────────────────────────────────────────────
const DB_DOC = "creda_main";
const DB_COL = "appdata";

async function saveToFirebase(clients, users, pendingLoans) {
  try {
    await setDoc(doc(db, DB_COL, DB_DOC), {
      clients: JSON.stringify(clients),
      users: JSON.stringify(users),
      pendingLoans: JSON.stringify(pendingLoans),
      updatedAt: new Date().toISOString(),
    });
    // Also save locally as backup
    localStorage.setItem("creda_clients", JSON.stringify(clients));
    localStorage.setItem("creda_users", JSON.stringify(users));
    localStorage.setItem("creda_pending_loans", JSON.stringify(pendingLoans));
  } catch (e) {
    console.error("Firebase save failed:", e);
    // Fallback to localStorage
    localStorage.setItem("creda_clients", JSON.stringify(clients));
    localStorage.setItem("creda_users", JSON.stringify(users));
    localStorage.setItem("creda_pending_loans", JSON.stringify(pendingLoans));
  }
}

function subscribeToFirebase(onData) {
  return onSnapshot(doc(db, DB_COL, DB_DOC), (snap) => {
    if (snap.exists()) {
      const data = snap.data();
      onData({
        clients: JSON.parse(data.clients || "[]"),
        users: JSON.parse(data.users || JSON.stringify(getDefaultUsers())),
        pendingLoans: JSON.parse(data.pendingLoans || "[]"),
      });
    }
  }, (error) => {
    console.error("Firebase listener error:", error);
  });
}

// ─── STORAGE HELPERS ──────────────────────────────────────────────────────────
function getDefaultUsers() {
  return [
    { id: "USR001", name: "Admin", username: "admin", pin: "2026", role: "admin", createdAt: new Date().toISOString().split("T")[0], active: true },
  ];
}

function exportData(clients, users, pendingLoans) {
  const blob = new Blob([JSON.stringify({ clients, users, pendingLoans }, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "creda_backup_" + new Date().toISOString().split("T")[0] + ".json";
  a.click();
  URL.revokeObjectURL(url);
}

function importData(file, onSuccess) {
  const reader = new FileReader();
  reader.onload = (e) => {
    try {
      const data = JSON.parse(e.target.result);
      if (data.clients && Array.isArray(data.clients)) {
        onSuccess(data);
      } else if (Array.isArray(data)) {
        onSuccess({ clients: data, users: getDefaultUsers(), pendingLoans: [] });
      } else { alert("Invalid backup file."); }
    } catch { alert("Could not read file."); }
  };
  reader.readAsText(file);
}

// ─── NIGERIAN PUBLIC HOLIDAYS ─────────────────────────────────────────────────
const FIXED_HOLIDAYS = ["01-01","05-01","06-12","10-01","12-25","12-26"];
const VARIABLE_HOLIDAYS = new Set([
  "2024-03-29","2024-04-01","2024-04-09","2024-04-10","2024-06-16","2024-06-17","2024-09-15","2024-09-16",
  "2025-04-18","2025-04-21","2025-03-30","2025-03-31","2025-06-06","2025-06-07","2025-09-05",
  "2026-04-03","2026-04-06","2026-03-20","2026-03-21","2026-05-27","2026-05-28","2026-08-25"
]);
function isHoliday(d) { return FIXED_HOLIDAYS.includes(d.slice(5)) || VARIABLE_HOLIDAYS.has(d); }

// ─── UTILS ────────────────────────────────────────────────────────────────────
function generateId(p = "ID") { return p + Date.now().toString().slice(-6) + Math.floor(Math.random() * 100); }
function formatCurrency(a) { return "₦" + Number(a || 0).toLocaleString("en-NG", { minimumFractionDigits: 2 }); }
function formatDate(d) {
  if (!d) return "—";
  return new Date(d).toLocaleDateString("en-NG", { day: "2-digit", month: "short", year: "numeric" });
}
function formatMonth(ym) {
  if (!ym) return "—";
  const [y, m] = ym.split("-");
  return new Date(y, parseInt(m) - 1, 1).toLocaleDateString("en-NG", { month: "long", year: "numeric" });
}
function getRepaymentDays(startDate, count, excl) {
  const days = []; const cursor = new Date(startDate); cursor.setDate(cursor.getDate() + 1);
  while (days.length < count) {
    const ds = cursor.toISOString().split("T")[0]; const day = cursor.getDay();
    if (excl) { if (day !== 0 && day !== 6 && !isHoliday(ds)) days.push(ds); }
    else days.push(ds);
    cursor.setDate(cursor.getDate() + 1);
  }
  return days;
}
function calcLoanSchedule(principal, interestRate, days, startDate, excl) {
  const totalInterest = (principal * interestRate) / 100;
  const totalRepayable = principal + totalInterest;
  const dailyPayment = totalRepayable / days;
  const repaymentDays = getRepaymentDays(startDate, days, excl);
  const schedule = [];
  let balance = totalRepayable;
  for (let i = 0; i < days; i++) {
    balance = Math.max(0, balance - dailyPayment);
    schedule.push({ day: i + 1, dueDate: repaymentDays[i], payment: dailyPayment, balance, paid: false, paidDate: null, paidAmount: 0, overpayment: 0, shortfall: 0 });
  }
  return { dailyPayment, totalRepayable, totalInterest, schedule };
}

// ─── SMART PAYMENT ENGINE ─────────────────────────────────────────────────────
function applySmartPayment(schedule, startIdx, amountPaid, paidDate) {
  let remaining = amountPaid;
  const updated = schedule.map(s => ({ ...s }));
  let i = startIdx;
  while (remaining > 0 && i < updated.length) {
    const s = updated[i];
    if (s.paid && i !== startIdx) { i++; continue; }
    if (i === startIdx) {
      const total = (s.paidAmount || 0) + remaining;
      const covers = Math.min(total, s.payment);
      const excess = total - s.payment;
      updated[i] = { ...s, paid: total >= s.payment, paidAmount: covers, paidDate, overpayment: Math.max(0, excess), shortfall: Math.max(0, s.payment - total) };
      remaining = Math.max(0, excess);
    } else if (!s.paid) {
      const alreadyPaid = s.paidAmount || 0;
      const stillOwed = s.payment - alreadyPaid;
      const applyHere = Math.min(remaining, stillOwed);
      const newPaid = alreadyPaid + applyHere;
      updated[i] = { ...s, paid: newPaid >= s.payment, paidAmount: newPaid, paidDate: newPaid >= s.payment ? paidDate : s.paidDate, overpayment: 0, shortfall: Math.max(0, s.payment - newPaid) };
      remaining -= applyHere;
    }
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

// ─── FINANCIAL ENGINE ─────────────────────────────────────────────────────────
function computeFinancials(clients) {
  let totalCapital = 0, totalExpectedInterest = 0, interestEarned = 0, principalCollected = 0, totalCollected = 0;
  clients.forEach(c => {
    (c.loans || []).forEach(l => {
      const principal = l.principal || 0, interest = l.totalInterest || 0, totalDue = l.totalRepayable || 0;
      const iR = totalDue > 0 ? interest / totalDue : 0, pR = totalDue > 0 ? principal / totalDue : 0;
      totalCapital += principal; totalExpectedInterest += interest;
      (l.schedule || []).forEach(s => { if (s.paidAmount > 0) { totalCollected += s.paidAmount; interestEarned += s.paidAmount * iR; principalCollected += s.paidAmount * pR; } });
    });
  });
  const outstandingPrincipal = Math.max(0, totalCapital - principalCollected);
  const trueProfit = interestEarned;
  const realROI = totalCapital > 0 ? (trueProfit / totalCapital) * 100 : 0;
  const collectionRate = (totalExpectedInterest + totalCapital) > 0 ? (totalCollected / (totalExpectedInterest + totalCapital)) * 100 : 0;
  return { totalCapital, totalExpectedInterest, interestEarned, principalCollected, outstandingPrincipal, trueProfit, realROI, collectionRate, totalCollected };
}

function computeClientFinancials(client) {
  let capital = 0, expectedInterest = 0, interestEarned = 0, principalCollected = 0, totalCollected = 0;
  (client.loans || []).forEach(l => {
    const principal = l.principal || 0, interest = l.totalInterest || 0, totalDue = l.totalRepayable || 0;
    const iR = totalDue > 0 ? interest / totalDue : 0, pR = totalDue > 0 ? principal / totalDue : 0;
    capital += principal; expectedInterest += interest;
    (l.schedule || []).forEach(s => { if (s.paidAmount > 0) { totalCollected += s.paidAmount; interestEarned += s.paidAmount * iR; principalCollected += s.paidAmount * pR; } });
  });
  const outstandingPrincipal = Math.max(0, capital - principalCollected);
  return { capital, expectedInterest, interestEarned, principalCollected, outstandingPrincipal, trueProfit: interestEarned, realROI: capital > 0 ? (interestEarned / capital) * 100 : 0, totalCollected };
}

function computeLoanFinancials(loan) {
  const principal = loan.principal || 0, interest = loan.totalInterest || 0, totalDue = loan.totalRepayable || 0;
  const iR = totalDue > 0 ? interest / totalDue : 0, pR = totalDue > 0 ? principal / totalDue : 0;
  let collected = 0, interestEarned = 0, principalCollected = 0;
  (loan.schedule || []).forEach(s => { if (s.paidAmount > 0) { collected += s.paidAmount; interestEarned += s.paidAmount * iR; principalCollected += s.paidAmount * pR; } });
  const paidCount = (loan.schedule || []).filter(s => s.paid).length;
  const totalCount = loan.days || 1;
  const today = new Date();
  const overdueCount = (loan.schedule || []).filter(s => !s.paid && new Date(s.dueDate) < today).length;
  const onTimeCount = (loan.schedule || []).filter(s => s.paid && s.paidDate <= s.dueDate).length;
  const lateCount = (loan.schedule || []).filter(s => s.paid && s.paidDate > s.dueDate).length;
  const partialCount = (loan.schedule || []).filter(s => !s.paid && s.paidAmount > 0 && s.paidAmount < s.payment).length;
  return {
    collected, interestEarned, principalCollected, outstandingPrincipal: Math.max(0, principal - principalCollected),
    trueProfit: interestEarned, realROI: principal > 0 ? (interestEarned / principal) * 100 : 0,
    collectionRate: totalDue > 0 ? (collected / totalDue) * 100 : 0,
    completionRate: (paidCount / totalCount) * 100,
    paidCount, totalCount, overdueCount, onTimeCount, lateCount, partialCount,
  };
}

// ─── PERFORMANCE REPORT ENGINE ────────────────────────────────────────────────
function generateClientReport(client) {
  const loans = client.loans || [];
  const totalLoans = loans.length;
  const completedLoans = loans.filter(l => l.status === "completed").length;
  const activeLoans = loans.filter(l => l.status === "active").length;
  const totalBorrowed = loans.reduce((a, l) => a + (l.principal || 0), 0);
  const totalRepayable = loans.reduce((a, l) => a + (l.totalRepayable || 0), 0);
  const totalCollected = loans.reduce((a, l) => a + (l.schedule || []).reduce((b, s) => b + (s.paidAmount || 0), 0), 0);
  const totalInterestExpected = loans.reduce((a, l) => a + (l.totalInterest || 0), 0);
  const today = new Date();
  const totalOverdue = loans.reduce((a, l) => a + (l.schedule || []).filter(s => !s.paid && new Date(s.dueDate) < today).length, 0);
  const totalOnTime = loans.reduce((a, l) => a + (l.schedule || []).filter(s => s.paid && s.paidDate <= s.dueDate).length, 0);
  const totalLate = loans.reduce((a, l) => a + (l.schedule || []).filter(s => s.paid && s.paidDate > s.dueDate).length, 0);
  const totalInstallments = loans.reduce((a, l) => a + (l.schedule || []).length, 0);
  const totalPaid = loans.reduce((a, l) => a + (l.schedule || []).filter(s => s.paid).length, 0);
  const collectionRate = totalRepayable > 0 ? (totalCollected / totalRepayable) * 100 : 0;
  const onTimeRate = (totalPaid > 0) ? (totalOnTime / totalPaid) * 100 : 0;

  // Credit score (0-100)
  let creditScore = 50;
  if (collectionRate >= 100) creditScore += 20;
  else if (collectionRate >= 80) creditScore += 10;
  else creditScore -= 10;
  if (onTimeRate >= 90) creditScore += 20;
  else if (onTimeRate >= 70) creditScore += 10;
  else creditScore -= 10;
  if (totalOverdue === 0) creditScore += 10;
  else creditScore -= Math.min(totalOverdue * 2, 20);
  if (completedLoans > 0) creditScore += Math.min(completedLoans * 5, 20);
  creditScore = Math.max(0, Math.min(100, creditScore));

  const creditGrade =
    creditScore >= 85 ? "A+" :
    creditScore >= 75 ? "A" :
    creditScore >= 65 ? "B+" :
    creditScore >= 55 ? "B" :
    creditScore >= 45 ? "C" :
    creditScore >= 35 ? "D" : "F";

  const creditLabel =
    creditScore >= 75 ? "Excellent" :
    creditScore >= 55 ? "Good" :
    creditScore >= 40 ? "Fair" : "Poor";

  return {
    totalLoans, completedLoans, activeLoans, totalBorrowed, totalRepayable,
    totalCollected, totalInterestExpected, totalOverdue, totalOnTime, totalLate,
    totalInstallments, totalPaid, collectionRate, onTimeRate,
    creditScore, creditGrade, creditLabel,
    savingsBalance: client.savingsBalance || 0,
    memberSince: client.createdAt,
  };
}

function generateCollectiveReport(clients) {
  const allLoans = clients.flatMap(c => c.loans || []);
  const today = new Date();
  const totalClients = clients.length;
  const activeClients = clients.filter(c => c.loans?.some(l => l.status === "active")).length;
  const totalLoans = allLoans.length;
  const activeLoans = allLoans.filter(l => l.status === "active").length;
  const completedLoans = allLoans.filter(l => l.status === "completed").length;
  const totalDisbursed = allLoans.reduce((a, l) => a + (l.principal || 0), 0);
  const totalRepayable = allLoans.reduce((a, l) => a + (l.totalRepayable || 0), 0);
  const totalCollected = allLoans.reduce((a, l) => a + (l.schedule || []).reduce((b, s) => b + (s.paidAmount || 0), 0), 0);
  const totalInterest = allLoans.reduce((a, l) => a + (l.totalInterest || 0), 0);
  const totalOverdue = allLoans.reduce((a, l) => a + (l.schedule || []).filter(s => !s.paid && new Date(s.dueDate) < today).length, 0);
  const totalOnTime = allLoans.reduce((a, l) => a + (l.schedule || []).filter(s => s.paid && s.paidDate <= s.dueDate).length, 0);
  const totalLate = allLoans.reduce((a, l) => a + (l.schedule || []).filter(s => s.paid && s.paidDate > s.dueDate).length, 0);
  const totalPaidInstallments = allLoans.reduce((a, l) => a + (l.schedule || []).filter(s => s.paid).length, 0);
  const totalInstallments = allLoans.reduce((a, l) => a + (l.schedule || []).length, 0);
  const totalSavings = clients.reduce((a, c) => a + (c.savingsBalance || 0), 0);
  const collectionRate = totalRepayable > 0 ? (totalCollected / totalRepayable) * 100 : 0;
  const onTimeRate = totalPaidInstallments > 0 ? (totalOnTime / totalPaidInstallments) * 100 : 0;
  const defaultRate = totalInstallments > 0 ? (totalOverdue / totalInstallments) * 100 : 0;
  const avgLoanSize = totalLoans > 0 ? totalDisbursed / totalLoans : 0;
  const outstandingPrincipal = Math.max(0, totalDisbursed - (totalCollected * (totalDisbursed / (totalRepayable || 1))));

  // Top performers
  const clientReports = clients.map(c => ({ client: c, report: generateClientReport(c) }));
  const topPerformers = [...clientReports].sort((a, b) => b.report.creditScore - a.report.creditScore).slice(0, 5);
  const bottomPerformers = [...clientReports].filter(r => r.report.totalLoans > 0).sort((a, b) => a.report.creditScore - b.report.creditScore).slice(0, 5);

  // Monthly breakdown
  const monthlyMap = {};
  allLoans.forEach(l => {
    const key = (l.issuedAt || l.startDate || "").slice(0, 7);
    if (!key) return;
    if (!monthlyMap[key]) monthlyMap[key] = { disbursed: 0, collected: 0, interest: 0, loans: 0 };
    monthlyMap[key].disbursed += l.principal || 0;
    monthlyMap[key].interest += l.totalInterest || 0;
    monthlyMap[key].loans += 1;
    (l.schedule || []).forEach(s => { if (s.paidAmount > 0) monthlyMap[key].collected += s.paidAmount; });
  });
  const monthlyTrend = Object.entries(monthlyMap).map(([month, d]) => ({ month, ...d })).sort((a, b) => a.month.localeCompare(b.month));

  return {
    totalClients, activeClients, totalLoans, activeLoans, completedLoans,
    totalDisbursed, totalRepayable, totalCollected, totalInterest, totalOverdue,
    totalOnTime, totalLate, totalPaidInstallments, totalInstallments, totalSavings,
    collectionRate, onTimeRate, defaultRate, avgLoanSize, outstandingPrincipal,
    topPerformers, bottomPerformers, monthlyTrend, clientReports,
  };
}

function exportReportAsText(title, lines) {
  const content = [`CREDA FINANCE — ${title}`, `Generated: ${new Date().toLocaleString("en-NG")}`, "=".repeat(50), "", ...lines].join("\n");
  const blob = new Blob([content], { type: "text/plain" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `creda_report_${Date.now()}.txt`;
  a.click();
  URL.revokeObjectURL(url);
}

// ─── ICONS ────────────────────────────────────────────────────────────────────
const Icon = ({ name, size = 16 }) => {
  const icons = {
    plus: <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>,
    user: <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="8" r="4"/><path d="M4 20c0-4 3.6-7 8-7s8 3 8 7"/></svg>,
    users: <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>,
    check: <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>,
    back: <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 18 9 12 15 6"/></svg>,
    dashboard: <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/></svg>,
    trash: <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6"/><path d="M10 11v6M14 11v6M9 6V4h6v2"/></svg>,
    cloud: <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M18 10h-1.26A8 8 0 109 20h9a5 5 0 000-10z"/></svg>,
    edit: <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 113 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>,
    ledger: <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/><polyline points="10 9 9 9 8 9"/></svg>,
    search: <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>,
    lock: <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>,
    unlock: <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 9.9-1"/></svg>,
    trend: <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="23 6 13.5 15.5 8.5 10.5 1 18"/><polyline points="17 6 23 6 23 12"/></svg>,
    shield: <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>,
    chevronDown: <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="6 9 12 15 18 9"/></svg>,
    chevronUp: <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="18 15 12 9 6 15"/></svg>,
    calendar: <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>,
    lightning: <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>,
    bell: <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/></svg>,
    logout: <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg>,
    report: <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/><line x1="10" y1="9" x2="8" y2="9"/></svg>,
    account: <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="3" width="20" height="14" rx="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/></svg>,
    download: <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>,
    star: <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" strokeWidth="1"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>,
    wifi: <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12.55a11 11 0 0 1 14.08 0"/><path d="M1.42 9a16 16 0 0 1 21.16 0"/><path d="M8.53 16.11a6 6 0 0 1 6.95 0"/><line x1="12" y1="20" x2="12.01" y2="20"/></svg>,
  };
  return icons[name] || null;
};

// ─── BASE UI COMPONENTS ───────────────────────────────────────────────────────
function Modal({ title, onClose, children, wide = false }) {
  return (
    <div style={{ position:"fixed",inset:0,background:"rgba(0,8,20,0.92)",zIndex:1000,display:"flex",alignItems:"center",justifyContent:"center",padding:16,backdropFilter:"blur(8px)" }}>
      <div style={{ background:"#0d1b2a",border:"1px solid rgba(100,200,255,0.12)",borderRadius:20,width:"100%",maxWidth:wide?580:480,maxHeight:"92vh",overflowY:"auto",boxShadow:"0 40px 100px rgba(0,0,0,0.7)" }}>
        <div style={{ padding:"20px 22px 14px",borderBottom:"1px solid rgba(255,255,255,0.06)",display:"flex",justifyContent:"space-between",alignItems:"center",position:"sticky",top:0,background:"#0d1b2a",zIndex:1,borderRadius:"20px 20px 0 0" }}>
          <h2 style={{ margin:0,fontSize:17,fontWeight:700,color:"#e8f4fd" }}>{title}</h2>
          <button onClick={onClose} style={{ background:"rgba(255,255,255,0.06)",border:"none",color:"#8ab4c8",width:30,height:30,borderRadius:8,cursor:"pointer",fontSize:17 }}>×</button>
        </div>
        <div style={{ padding:"20px 22px" }}>{children}</div>
      </div>
    </div>
  );
}

function Field({ label, children }) {
  return (
    <div style={{ marginBottom:14 }}>
      <label style={{ display:"block",fontSize:11,color:"#5a7a90",marginBottom:5,letterSpacing:0.8,textTransform:"uppercase" }}>{label}</label>
      {children}
    </div>
  );
}

const inputStyle = {
  width:"100%",padding:"10px 13px",background:"rgba(100,180,255,0.05)",
  border:"1px solid rgba(100,180,255,0.15)",borderRadius:10,color:"#e8f4fd",
  fontSize:14,outline:"none",boxSizing:"border-box",fontFamily:"inherit",
};

function StatCard({ label, value, accent, sub }) {
  return (
    <div style={{ background:"rgba(255,255,255,0.03)",border:"1px solid rgba(255,255,255,0.06)",borderRadius:14,padding:"16px 18px",borderTop:`2px solid ${accent}` }}>
      <div style={{ fontSize:10,color:"#4a6880",letterSpacing:1.2,textTransform:"uppercase",marginBottom:7 }}>{label}</div>
      <div style={{ fontSize:19,fontWeight:800,color:"#e8f4fd",fontFamily:"'Courier New',monospace",letterSpacing:-0.5 }}>{value}</div>
      {sub && <div style={{ fontSize:10,color:"#3a5060",marginTop:3 }}>{sub}</div>}
    </div>
  );
}

function Badge({ color, bg, children }) {
  return <span style={{ fontSize:10,padding:"2px 9px",borderRadius:20,background:bg,color,fontWeight:700,letterSpacing:0.5 }}>{children}</span>;
}

function RoleBadge({ role }) {
  return role === "admin"
    ? <Badge color="#f59e0b" bg="rgba(245,158,11,0.15)">👑 ADMIN</Badge>
    : <Badge color="#60a5fa" bg="rgba(96,165,250,0.15)">🏦 LOAN OFFICER</Badge>;
}

function FinanceMetricRow({ label, value, valueColor = "#e8f4fd", icon, sub }) {
  return (
    <div style={{ display:"flex",justifyContent:"space-between",alignItems:"center",padding:"10px 14px",background:"rgba(255,255,255,0.02)",borderRadius:10,border:"1px solid rgba(255,255,255,0.04)" }}>
      <div style={{ display:"flex",alignItems:"center",gap:8 }}>
        {icon && <span style={{ color:valueColor,opacity:0.8 }}>{icon}</span>}
        <div>
          <div style={{ fontSize:11,color:"#5a7a90",letterSpacing:0.6 }}>{label}</div>
          {sub && <div style={{ fontSize:9,color:"#3a4a58",marginTop:1 }}>{sub}</div>}
        </div>
      </div>
      <div style={{ fontSize:14,fontWeight:800,color:valueColor,fontFamily:"'Courier New',monospace" }}>{value}</div>
    </div>
  );
}

function ROIGauge({ roi }) {
  const capped = Math.min(Math.max(roi, 0), 100);
  const color = roi >= 20 ? "#22c55e" : roi >= 10 ? "#f59e0b" : "#ef4444";
  return (
    <div style={{ marginTop:4 }}>
      <div style={{ display:"flex",justifyContent:"space-between",marginBottom:5 }}>
        <span style={{ fontSize:10,color:"#5a7a90" }}>ROI Performance</span>
        <span style={{ fontSize:12,fontWeight:800,color,fontFamily:"'Courier New',monospace" }}>{roi.toFixed(2)}%</span>
      </div>
      <div style={{ height:6,background:"rgba(255,255,255,0.06)",borderRadius:4,overflow:"hidden" }}>
        <div style={{ height:"100%",width:`${capped}%`,background:`linear-gradient(90deg,${color},${color}cc)`,borderRadius:4,transition:"width 0.6s" }}/>
      </div>
    </div>
  );
}

// ─── CREDIT SCORE WIDGET ──────────────────────────────────────────────────────
function 
