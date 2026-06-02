import { useState, useEffect, useMemo } from "react";

// ─── STORAGE HELPERS ──────────────────────────────────────────────────────────
async function loadData() {
  try {
    const clients = localStorage.getItem("creda_clients");
    const users = localStorage.getItem("creda_users");
    const pendingLoans = localStorage.getItem("creda_pending_loans");
    return {
      clients: clients ? JSON.parse(clients) : [],
      users: users ? JSON.parse(users) : getDefaultUsers(),
      pendingLoans: pendingLoans ? JSON.parse(pendingLoans) : [],
    };
  } catch { return { clients: [], users: getDefaultUsers(), pendingLoans: [] }; }
}

function getDefaultUsers() {
  return [
    { id: "USR001", name: "Admin", username: "admin", pin: "2026", role: "admin", createdAt: new Date().toISOString().split("T")[0], active: true },
  ];
}

async function saveAll(clients, users, pendingLoans) {
  try {
    localStorage.setItem("creda_clients", JSON.stringify(clients));
    localStorage.setItem("creda_users", JSON.stringify(users));
    localStorage.setItem("creda_pending_loans", JSON.stringify(pendingLoans));
    localStorage.setItem("creda_backup_" + new Date().toISOString().split("T")[0], JSON.stringify({ clients, users, pendingLoans }));
  } catch (e) { console.error("Save failed:", e); }
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

// ─── REPORT GENERATOR ─────────────────────────────────────────────────────────
function generatePortfolioReport(clients, users) {
  const today = new Date().toISOString().split("T")[0];
  const allLoans = clients.flatMap(c => (c.loans || []).map(l => ({ ...l, clientName: c.name, clientId: c.id, assignedTo: c.assignedTo, assignedToName: c.assignedToName })));
  const totalClients = clients.length;
  const activeClients = clients.filter(c => c.loans?.some(l => l.status === "active")).length;
  const totalLoans = allLoans.length;
  const activeLoans = allLoans.filter(l => l.status === "active").length;
  const completedLoans = allLoans.filter(l => l.status === "completed").length;
  let totalDisbursed = 0, totalRepayable = 0, totalCollected = 0, totalInterestExpected = 0, totalInterestEarned = 0, totalPrincipalRecovered = 0, overdueInstallments = 0, paidOnTime = 0, paidLate = 0;
  const todayDate = new Date();
  allLoans.forEach(l => {
    const principal = l.principal || 0, interest = l.totalInterest || 0, due = l.totalRepayable || 0;
    const iR = due > 0 ? interest / due : 0, pR = due > 0 ? principal / due : 0;
    totalDisbursed += principal; totalRepayable += due; totalInterestExpected += interest;
    (l.schedule || []).forEach(s => {
      if (s.paidAmount > 0) { totalCollected += s.paidAmount; totalInterestEarned += s.paidAmount * iR; totalPrincipalRecovered += s.paidAmount * pR; }
      if (!s.paid && new Date(s.dueDate) < todayDate) overdueInstallments++;
      if (s.paid && s.paidDate <= s.dueDate) paidOnTime++;
      if (s.paid && s.paidDate > s.dueDate) paidLate++;
    });
  });
  const totalSavings = clients.reduce((a, c) => a + (c.savingsBalance || 0), 0);
  const outstandingPrincipal = Math.max(0, totalDisbursed - totalPrincipalRecovered);
  const collectionRate = totalRepayable > 0 ? (totalCollected / totalRepayable) * 100 : 0;
  const realROI = totalDisbursed > 0 ? (totalInterestEarned / totalDisbursed) * 100 : 0;
  const totalPaid = paidOnTime + paidLate;
  const onTimeRate = totalPaid > 0 ? (paidOnTime / totalPaid) * 100 : 0;

  // Per officer stats
  const officerStats = {};
  clients.forEach(c => {
    const key = c.assignedTo || "unassigned";
    if (!officerStats[key]) officerStats[key] = { name: c.assignedToName || "Unassigned", clients: 0, disbursed: 0, collected: 0, activeLoans: 0, completedLoans: 0, interest: 0 };
    officerStats[key].clients++;
    (c.loans || []).forEach(l => {
      const due = l.totalRepayable || 0, int = l.totalInterest || 0;
      const iR = due > 0 ? int / due : 0;
      if (l.status === "active") officerStats[key].activeLoans++;
      if (l.status === "completed") officerStats[key].completedLoans++;
      officerStats[key].disbursed += l.principal || 0;
      (l.schedule || []).forEach(s => { if (s.paidAmount > 0) { officerStats[key].collected += s.paidAmount; officerStats[key].interest += s.paidAmount * iR; } });
    });
  });

  // Monthly breakdown
  const monthlyMap = {};
  allLoans.forEach(l => {
    const key = (l.issuedAt || l.startDate || today).slice(0, 7);
    if (!monthlyMap[key]) monthlyMap[key] = { disbursed: 0, collected: 0, interest: 0, loans: 0 };
    monthlyMap[key].disbursed += l.principal || 0;
    monthlyMap[key].loans++;
    const due = l.totalRepayable || 0, int = l.totalInterest || 0;
    const iR = due > 0 ? int / due : 0;
    (l.schedule || []).forEach(s => { if (s.paidAmount > 0) { monthlyMap[key].collected += s.paidAmount; monthlyMap[key].interest += s.paidAmount * iR; } });
  });

  const lines = [
    "╔══════════════════════════════════════════════════════════════╗",
    "║           CREDA FINANCE — PORTFOLIO PERFORMANCE REPORT       ║",
    "╚══════════════════════════════════════════════════════════════╝",
    "",
    `  Generated: ${new Date().toLocaleString("en-NG")}`,
    `  Report Date: ${today}`,
    "",
    "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━",
    "  PORTFOLIO OVERVIEW",
    "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━",
    `  Total Clients:              ${totalClients}`,
    `  Active Clients:             ${activeClients}`,
    `  Total Loan Cycles:          ${totalLoans}`,
    `  Active Loans:               ${activeLoans}`,
    `  Completed Loans:            ${completedLoans}`,
    `  Total Savings Held:         ${formatCurrency(totalSavings)}`,
    "",
    "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━",
    "  FINANCIAL PERFORMANCE",
    "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━",
    `  Total Capital Disbursed:    ${formatCurrency(totalDisbursed)}`,
    `  Total Repayable:            ${formatCurrency(totalRepayable)}`,
    `  Total Collected:            ${formatCurrency(totalCollected)}`,
    `  Outstanding Balance:        ${formatCurrency(Math.max(0, totalRepayable - totalCollected))}`,
    `  Principal Recovered:        ${formatCurrency(totalPrincipalRecovered)}`,
    `  Outstanding Principal:      ${formatCurrency(outstandingPrincipal)}`,
    `  Interest Expected:          ${formatCurrency(totalInterestExpected)}`,
    `  Interest Earned:            ${formatCurrency(totalInterestEarned)}`,
    `  True Profit:                ${formatCurrency(totalInterestEarned)}`,
    `  Real ROI:                   ${realROI.toFixed(2)}%`,
    `  Collection Rate:            ${collectionRate.toFixed(2)}%`,
    "",
    "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━",
    "  REPAYMENT BEHAVIOUR",
    "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━",
    `  Paid On Time:               ${paidOnTime} installments`,
    `  Paid Late:                  ${paidLate} installments`,
    `  Overdue (Unpaid):           ${overdueInstallments} installments`,
    `  On-Time Rate:               ${onTimeRate.toFixed(1)}%`,
    "",
    "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━",
    "  OFFICER PERFORMANCE BREAKDOWN",
    "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━",
    ...Object.values(officerStats).map(o => [
      `  Officer: ${o.name}`,
      `    Clients: ${o.clients}  |  Active Loans: ${o.activeLoans}  |  Completed: ${o.completedLoans}`,
      `    Disbursed: ${formatCurrency(o.disbursed)}  |  Collected: ${formatCurrency(o.collected)}`,
      `    Interest Earned: ${formatCurrency(o.interest)}`,
      `    Collection Rate: ${o.disbursed > 0 ? ((o.collected / (o.disbursed + o.interest)) * 100).toFixed(1) : 0}%`,
      "",
    ].join("\n")),
    "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━",
    "  MONTHLY DISBURSEMENT & COLLECTION",
    "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━",
    ...Object.entries(monthlyMap).sort((a, b) => b[0].localeCompare(a[0])).map(([month, d]) => {
      const [y, m] = month.split("-");
      const label = new Date(y, parseInt(m) - 1, 1).toLocaleDateString("en-NG", { month: "long", year: "numeric" });
      return `  ${label.padEnd(20)} Disbursed: ${formatCurrency(d.disbursed).padEnd(18)} Collected: ${formatCurrency(d.collected).padEnd(18)} Interest: ${formatCurrency(d.interest)}`;
    }),
    "",
    "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━",
    "  CLIENT SUMMARY",
    "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━",
    ...clients.map(c => {
      const active = c.loans?.find(l => l.status === "active");
      const total = c.loans?.length || 0;
      let cCollected = 0;
      (c.loans || []).forEach(l => (l.schedule || []).forEach(s => { if (s.paidAmount > 0) cCollected += s.paidAmount; }));
      const overdue = active?.schedule?.filter(s => !s.paid && new Date(s.dueDate) < new Date()).length || 0;
      return `  ${c.name.padEnd(25)} Cycles: ${String(total).padEnd(3)} Collected: ${formatCurrency(cCollected).padEnd(16)} Status: ${active ? `ACTIVE${overdue > 0 ? ` (${overdue} overdue)` : ""}` : total > 0 ? "COMPLETED" : "NO LOAN"}`;
    }),
    "",
    "╔══════════════════════════════════════════════════════════════╗",
    "║                  END OF PORTFOLIO REPORT                     ║",
    "╚══════════════════════════════════════════════════════════════╝",
  ];
  return lines.join("\n");
}

function generateClientReport(client) {
  const today = new Date();
  const todayStr = today.toISOString().split("T")[0];
  const loans = client.loans || [];
  let totalDisbursed = 0, totalRepayable = 0, totalCollected = 0, totalInterest = 0, totalInterestEarned = 0, totalPrincipalRecovered = 0, paidOnTime = 0, paidLate = 0, overdueCount = 0;
  loans.forEach(l => {
    const principal = l.principal || 0, interest = l.totalInterest || 0, due = l.totalRepayable || 0;
    const iR = due > 0 ? interest / due : 0, pR = due > 0 ? principal / due : 0;
    totalDisbursed += principal; totalRepayable += due; totalInterest += interest;
    (l.schedule || []).forEach(s => {
      if (s.paidAmount > 0) { totalCollected += s.paidAmount; totalInterestEarned += s.paidAmount * iR; totalPrincipalRecovered += s.paidAmount * pR; }
      if (!s.paid && new Date(s.dueDate) < today) overdueCount++;
      if (s.paid && s.paidDate <= s.dueDate) paidOnTime++;
      if (s.paid && s.paidDate > s.dueDate) paidLate++;
    });
  });
  const activeLoan = loans.find(l => l.status === "active");
  const collectionRate = totalRepayable > 0 ? (totalCollected / totalRepayable) * 100 : 0;
  const realROI = totalDisbursed > 0 ? (totalInterestEarned / totalDisbursed) * 100 : 0;
  const totalPaid = paidOnTime + paidLate;
  const onTimeRate = totalPaid > 0 ? (paidOnTime / totalPaid) * 100 : 0;
  const creditScore = Math.min(100, Math.round(onTimeRate * 0.5 + collectionRate * 0.3 + (loans.length > 0 ? Math.min(loans.length * 5, 20) : 0)));
  const creditGrade = creditScore >= 85 ? "A (Excellent)" : creditScore >= 70 ? "B (Good)" : creditScore >= 55 ? "C (Fair)" : creditScore >= 40 ? "D (Poor)" : "F (Very Poor)";

  const lines = [
    "╔══════════════════════════════════════════════════════════════╗",
    "║           CREDA FINANCE — CLIENT PERFORMANCE REPORT          ║",
    "╚══════════════════════════════════════════════════════════════╝",
    "",
    `  Generated: ${new Date().toLocaleString("en-NG")}`,
    `  Report Date: ${todayStr}`,
    "",
    "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━",
    "  CLIENT PROFILE",
    "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━",
    `  Name:                       ${client.name}`,
    `  Client ID:                  ${client.id}`,
    `  Phone:                      ${client.phone || "—"}`,
    `  Address:                    ${client.address || "—"}`,
    `  ID/BVN:                     ${client.idNumber || "—"}`,
    `  Loan Officer:               ${client.assignedToName || "—"}`,
    `  Member Since:               ${formatDate(client.createdAt)}`,
    `  Savings Balance:            ${formatCurrency(client.savingsBalance || 0)}`,
    "",
    "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━",
    "  CREDIT ASSESSMENT",
    "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━",
    `  Credit Score:               ${creditScore}/100`,
    `  Credit Grade:               ${creditGrade}`,
    `  On-Time Payment Rate:       ${onTimeRate.toFixed(1)}%`,
    `  Overall Collection Rate:    ${collectionRate.toFixed(1)}%`,
    `  Overdue Installments:       ${overdueCount}`,
    "",
    "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━",
    "  FINANCIAL SUMMARY",
    "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━",
    `  Total Loan Cycles:          ${loans.length}`,
    `  Active Loans:               ${loans.filter(l => l.status === "active").length}`,
    `  Completed Loans:            ${loans.filter(l => l.status === "completed").length}`,
    `  Total Principal Borrowed:   ${formatCurrency(totalDisbursed)}`,
    `  Total Repayable:            ${formatCurrency(totalRepayable)}`,
    `  Total Collected:            ${formatCurrency(totalCollected)}`,
    `  Outstanding Balance:        ${formatCurrency(Math.max(0, totalRepayable - totalCollected))}`,
    `  Principal Recovered:        ${formatCurrency(totalPrincipalRecovered)}`,
    `  Outstanding Principal:      ${formatCurrency(Math.max(0, totalDisbursed - totalPrincipalRecovered))}`,
    `  Interest Charged:           ${formatCurrency(totalInterest)}`,
    `  Interest Earned (so far):   ${formatCurrency(totalInterestEarned)}`,
    `  Real ROI (for lender):      ${realROI.toFixed(2)}%`,
    "",
    "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━",
    "  REPAYMENT BEHAVIOUR",
    "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━",
    `  Paid On Time:               ${paidOnTime} installments`,
    `  Paid Late:                  ${paidLate} installments`,
    `  Overdue (Unpaid):           ${overdueCount} installments`,
    `  On-Time Rate:               ${onTimeRate.toFixed(1)}%`,
    "",
    ...(activeLoan ? [
      "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━",
      "  CURRENT ACTIVE LOAN",
      "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━",
      `  Loan ID:                    ${activeLoan.id}`,
      `  Principal:                  ${formatCurrency(activeLoan.principal)}`,
      `  Interest Rate:              ${activeLoan.interestRate}%`,
      `  Duration:                   ${activeLoan.days} days`,
      `  Start Date:                 ${formatDate(activeLoan.startDate)}`,
      `  Daily Payment:              ${formatCurrency(activeLoan.dailyPayment)}`,
      `  Total Repayable:            ${formatCurrency(activeLoan.totalRepayable)}`,
      `  Installments Paid:          ${activeLoan.schedule?.filter(s => s.paid).length || 0}/${activeLoan.days}`,
      `  Overdue Installments:       ${activeLoan.schedule?.filter(s => !s.paid && new Date(s.dueDate) < today).length || 0}`,
      `  Remaining Balance:          ${formatCurrency(activeLoan.schedule?.find(s => !s.paid)?.balance ?? 0)}`,
      "",
      "  ACTIVE LOAN SCHEDULE:",
      "  " + "─".repeat(60),
      "  Day  Due Date      Expected       Paid           Status",
      "  " + "─".repeat(60),
      ...(activeLoan.schedule || []).map(s => {
        const isOverdue = !s.paid && new Date(s.dueDate) < today;
        const isLate = s.paid && s.paidDate > s.dueDate;
        const status = s.paid ? (isLate ? "PAID LATE" : "PAID") : isOverdue ? "OVERDUE" : "PENDING";
        return `  ${String(s.day).padEnd(5)}${s.dueDate.padEnd(14)}${formatCurrency(s.payment).padEnd(15)}${formatCurrency(s.paidAmount || 0).padEnd(15)}${status}`;
      }),
      "",
    ] : []),
    "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━",
    "  LOAN HISTORY",
    "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━",
    ...loans.map((l, idx) => {
      let lCollected = 0, lInterest = 0;
      const due = l.totalRepayable || 0, int = l.totalInterest || 0;
      const iR = due > 0 ? int / due : 0;
      (l.schedule || []).forEach(s => { if (s.paidAmount > 0) { lCollected += s.paidAmount; lInterest += s.paidAmount * iR; } });
      const paidCount = l.schedule?.filter(s => s.paid).length || 0;
      const lRate = due > 0 ? (lCollected / due) * 100 : 0;
      return [
        `  Cycle ${idx + 1} — ${l.status?.toUpperCase()} — ${formatDate(l.startDate)}`,
        `    Principal: ${formatCurrency(l.principal)}  |  Rate: ${l.interestRate}%  |  Days: ${l.days}`,
        `    Collected: ${formatCurrency(lCollected)}  |  Interest Earned: ${formatCurrency(lInterest)}`,
        `    Paid: ${paidCount}/${l.days} installments  |  Collection Rate: ${lRate.toFixed(1)}%`,
        "",
      ].join("\n");
    }),
    ...(client.savingsLogs && client.savingsLogs.length > 0 ? [
      "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━",
      "  SAVINGS HISTORY",
      "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━",
      ...client.savingsLogs.map(log =>
        `  ${log.date}  ${(log.type === "deposit" ? "DEPOSIT" : log.type === "withdraw" ? "WITHDRAW" : "ADJUST").padEnd(10)}  ${formatCurrency(log.amount).padEnd(16)}  Balance: ${formatCurrency(log.balanceAfter)}`
      ),
      "",
    ] : []),
    "╔══════════════════════════════════════════════════════════════╗",
    "║                   END OF CLIENT REPORT                       ║",
    "╚══════════════════════════════════════════════════════════════╝",
  ];
  return lines.join("\n");
}

function downloadReport(content, filename) {
  const blob = new Blob([content], { type: "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
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
    key: <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 2l-2 2m-7.61 7.61a5.5 5.5 0 1 1-7.778 7.778 5.5 5.5 0 0 1 7.777-7.777zm0 0L15.5 7.5m0 0l3 3L22 7l-3-3m-3.5 3.5L19 4"/></svg>,
    account: <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="3" width="20" height="14" rx="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/></svg>,
    report: <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/><line x1="10" y1="9" x2="8" y2="9"/></svg>,
    download: <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>,
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

// ─── INSTALLMENT ROW ──────────────────────────────────────────────────────────
function InstallmentRow({ s, i, loan, isActive, isAdmin, today, onPayment, onOverride }) {
  const isShortfall = !s.paid && s.paidAmount > 0 && s.paidAmount < s.payment;
  const isOverdue = !s.paid && new Date(s.dueDate) < today;
  const isNext = isActive && !s.paid && loan.schedule.filter(x => !x.paid)[0] === s;
  const isLate = s.paid && s.paidDate > s.dueDate;
  const hasOver = s.overpayment > 0;
  let border = "rgba(100,180,255,0.06)", bg = "rgba(255,255,255,0.01)";
  if (s.paid) { border = "rgba(34,197,94,0.15)"; bg = "rgba(34,197,94,0.04)"; }
  else if (isShortfall) { border = "rgba(239,68,68,0.35)"; bg = "rgba(239,68,68,0.08)"; }
  else if (isOverdue) { border = "rgba(239,68,68,0.2)"; bg = "rgba(239,68,68,0.05)"; }
  else if (isNext) { border = "rgba(96,165,250,0.2)"; bg = "rgba(96,165,250,0.03)"; }
  return (
    <div style={{ background:bg,border:`1px solid ${border}`,borderRadius:10,padding:"10px 12px",display:"flex",justifyContent:"space-between",alignItems:"flex-start" }}>
      <div style={{ display:"flex",gap:9,alignItems:"flex-start" }}>
        <div style={{ width:28,height:28,borderRadius:7,fontSize:10,fontWeight:700,flexShrink:0,display:"flex",alignItems:"center",justifyContent:"center",background:s.paid?"rgba(34,197,94,0.15)":isShortfall?"rgba(239,68,68,0.2)":isOverdue?"rgba(239,68,68,0.12)":"rgba(255,255,255,0.05)",color:s.paid?"#4ade80":isShortfall?"#f87171":isOverdue?"#f87171":"#4a6880" }}>
          {s.paid ? <Icon name="check" size={11}/> : `${i+1}`}
        </div>
        <div>
          <div style={{ display:"flex",alignItems:"center",gap:5,marginBottom:3,flexWrap:"wrap" }}>
            <span style={{ fontSize:12,fontWeight:700,color:s.paid?"#4ade80":isShortfall?"#f87171":isOverdue?"#f87171":"#c8dde8",fontFamily:"'Courier New',monospace" }}>
              {formatCurrency(s.paid ? s.paidAmount : s.payment)}
            </span>
            {isNext && <Badge color="#60a5fa" bg="rgba(96,165,250,0.12)">NEXT</Badge>}
            {isOverdue && !isShortfall && <Badge color="#f87171" bg="rgba(239,68,68,0.1)">OVERDUE</Badge>}
            {isLate && <Badge color="#f59e0b" bg="rgba(245,158,11,0.1)">LATE</Badge>}
            {isShortfall && <Badge color="#f87171" bg="rgba(239,68,68,0.15)">SHORTFALL</Badge>}
            {hasOver && <Badge color="#a78bfa" bg="rgba(167,139,250,0.12)">OVERPAID</Badge>}
          </div>
          {isShortfall && <div style={{ fontSize:9,color:"#f87171",marginBottom:2 }}>Paid {formatCurrency(s.paidAmount)} · Needs {formatCurrency(s.payment - s.paidAmount)} more</div>}
          {hasOver && <div style={{ fontSize:9,color:"#a78bfa",marginBottom:2 }}>+{formatCurrency(s.overpayment)} cascaded forward</div>}
          <div style={{ fontSize:9,color:"#3a5a70" }}>Due {formatDate(s.dueDate)}{s.paidDate && ` · Paid ${formatDate(s.paidDate)}`}</div>
        </div>
      </div>
      <div style={{ display:"flex",alignItems:"center",gap:6,flexShrink:0 }}>
        <div style={{ textAlign:"right" }}>
          <div style={{ fontSize:8,color:"#3a5a70" }}>BAL</div>
          <div style={{ fontSize:10,color:"#8ab4c8",fontFamily:"'Courier New',monospace" }}>{formatCurrency(s.balance)}</div>
        </div>
        {!s.paid && isActive && <button onClick={e=>{e.stopPropagation();onPayment(loan,i);}} style={{ background:"linear-gradient(135deg,#22c55e,#16a34a)",border:"none",color:"#000",padding:"5px 10px",borderRadius:6,cursor:"pointer",fontWeight:700,fontSize:10 }}>Pay</button>}
        {isAdmin && <button onClick={e=>{e.stopPropagation();onOverride(loan,i,s);}} style={{ background:"rgba(245,158,11,0.1)",border:"1px solid rgba(245,158,11,0.3)",color:"#f59e0b",borderRadius:6,padding:"4px 7px",cursor:"pointer",fontSize:9 }}>Edit</button>}
      </div>
    </div>
  );
}

// ─── LOAN CYCLE CARD ──────────────────────────────────────────────────────────
function LoanCycleCard({ loan, cycleNumber, totalCycles, isAdmin, onPayment, onOverride, today }) {
  const [expanded, setExpanded] = useState(cycleNumber === totalCycles);
  const [scheduleOpen, setScheduleOpen] = useState(cycleNumber === totalCycles);
  const fin = computeLoanFinancials(loan);
  const isActive = loan.status === "active";
  const perfColor = fin.completionRate >= 90 ? "#22c55e" : fin.completionRate >= 60 ? "#f59e0b" : "#ef4444";
  const roiColor = fin.realROI >= 20 ? "#22c55e" : fin.realROI >= 10 ? "#f59e0b" : "#ef4444";
  const stars = Math.round((fin.completionRate / 100) * 5);
  const totalOverpaid = (loan.schedule || []).reduce((s, r) => s + (r.overpayment || 0), 0);
  const totalShortfall = (loan.schedule || []).filter(s => !s.paid && s.paidAmount > 0).reduce((sum, s) => sum + (s.payment - s.paidAmount), 0);
  return (
    <div style={{ background:isActive?"linear-gradient(135deg,rgba(34,197,94,0.04),rgba(59,130,246,0.03))":"rgba(255,255,255,0.015)",border:`1px solid ${isActive?"rgba(34,197,94,0.2)":"rgba(96,165,250,0.12)"}`,borderRadius:16,overflow:"hidden",marginBottom:12 }}>
      <div onClick={()=>setExpanded(!expanded)} style={{ padding:"14px 16px",cursor:"pointer",borderBottom:expanded?"1px solid rgba(255,255,255,0.05)":"none" }}>
        <div style={{ display:"flex",justifyContent:"space-between",alignItems:"flex-start" }}>
          <div style={{ display:"flex",alignItems:"center",gap:10 }}>
            <div style={{ width:38,height:38,borderRadius:10,flexShrink:0,background:isActive?"linear-gradient(135deg,#16a34a,#22c55e)":"linear-gradient(135deg,#1d4ed8,#3b82f6)",display:"flex",alignItems:"center",justifyContent:"center",fontSize:13,fontWeight:800,color:"#fff" }}>
              {loan.status==="completed"?<Icon name="check" size={16}/>:`L${cycleNumber}`}
            </div>
            <div>
              <div style={{ display:"flex",alignItems:"center",gap:6,marginBottom:2 }}>
                <span style={{ fontSize:13,fontWeight:700,color:"#e8f4fd" }}>Loan Cycle {cycleNumber}{cycleNumber===totalCycles&&isActive&&<span style={{ fontSize:10,color:"#22c55e",marginLeft:6 }}>(Current)</span>}</span>
                <Badge color={isActive?"#4ade80":"#60a5fa"} bg={isActive?"rgba(34,197,94,0.12)":"rgba(96,165,250,0.12)"}>{isActive?"ACTIVE":"COMPLETED"}</Badge>
              </div>
              <div style={{ fontSize:10,color:"#3a5a70" }}>{formatDate(loan.startDate)} · {loan.days} days · {loan.interestRate}% interest</div>
            </div>
          </div>
          <div style={{ display:"flex",alignItems:"center",gap:8 }}>
            <div style={{ textAlign:"right" }}>
              <div style={{ fontSize:13,fontWeight:800,color:"#60a5fa",fontFamily:"'Courier New',monospace" }}>{formatCurrency(loan.principal)}</div>
              <div style={{ fontSize:9,color:"#3a5a70" }}>Principal</div>
            </div>
            <div style={{ color:"#3a5a70" }}>{expanded?<Icon name="chevronUp" size={14}/>:<Icon name="chevronDown" size={14}/>}</div>
          </div>
        </div>
        <div style={{ marginTop:10 }}>
          <div style={{ display:"flex",justifyContent:"space-between",fontSize:9,color:"#3a5a70",marginBottom:4 }}>
            <span>{fin.paidCount}/{fin.totalCount} installments</span>
            <span style={{ color:perfColor }}>{fin.completionRate.toFixed(0)}% complete</span>
          </div>
          <div style={{ height:4,background:"rgba(255,255,255,0.06)",borderRadius:4,overflow:"hidden" }}>
            <div style={{ height:"100%",width:`${fin.completionRate}%`,background:`linear-gradient(90deg,${perfColor},${perfColor}99)`,borderRadius:4,transition:"width 0.5s" }}/>
          </div>
        </div>
        {(totalOverpaid > 0 || totalShortfall > 0) && (
          <div style={{ display:"flex",gap:8,marginTop:8,flexWrap:"wrap" }}>
            {totalOverpaid > 0 && <div style={{ background:"rgba(167,139,250,0.1)",border:"1px solid rgba(167,139,250,0.2)",borderRadius:6,padding:"3px 8px",fontSize:9,color:"#a78bfa" }}>⚡ {formatCurrency(totalOverpaid)} cascaded</div>}
            {totalShortfall > 0 && <div style={{ background:"rgba(239,68,68,0.1)",border:"1px solid rgba(239,68,68,0.2)",borderRadius:6,padding:"3px 8px",fontSize:9,color:"#f87171" }}>⚠ {formatCurrency(totalShortfall)} shortfall</div>}
          </div>
        )}
      </div>
      {expanded && (
        <div style={{ padding:"14px 16px" }}>
          <div style={{ display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:8,marginBottom:14 }}>
            {[["Principal",formatCurrency(loan.principal),"#93c5fd"],["Interest",`${loan.interestRate}%`,"#c4b5fd"],["Daily",formatCurrency(loan.dailyPayment),"#60a5fa"],["Total Due",formatCurrency(loan.totalRepayable),"#e8f4fd"],["Collected",formatCurrency(fin.collected),"#4ade80"],["Outstanding",formatCurrency(Math.max(0,loan.totalRepayable-fin.collected)),fin.outstandingPrincipal>0?"#f87171":"#4ade80"]].map(([l,v,c])=>(
              <div key={l} style={{ background:"rgba(255,255,255,0.02)",borderRadius:9,padding:"9px 10px",border:"1px solid rgba(255,255,255,0.04)" }}>
                <div style={{ fontSize:8,color:"#3a5a70",marginBottom:3,textTransform:"uppercase" }}>{l}</div>
                <div style={{ fontSize:11,fontWeight:700,color:c,fontFamily:"'Courier New',monospace" }}>{v}</div>
              </div>
            ))}
          </div>
          <div style={{ background:"rgba(0,0,0,0.2)",borderRadius:12,padding:"12px 14px",marginBottom:14 }}>
            <div style={{ fontSize:11,color:"#5a7a90",fontWeight:700,letterSpacing:0.8,marginBottom:10,textTransform:"uppercase" }}>Financial Intelligence</div>
            {[["Interest Earned",formatCurrency(fin.interestEarned),"#a78bfa"],["True Profit",formatCurrency(fin.trueProfit),"#22c55e"],["Real ROI",`${fin.realROI.toFixed(2)}%`,roiColor],["Collection Rate",`${fin.collectionRate.toFixed(1)}%`,"#f59e0b"]].map(([l,v,c])=>(
              <div key={l} style={{ display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:6 }}>
                <span style={{ fontSize:11,color:"#8ab4c8" }}>{l}</span>
                <span style={{ fontSize:12,fontWeight:700,color:c,fontFamily:"'Courier New',monospace" }}>{v}</span>
              </div>
            ))}
            <div style={{ height:4,background:"rgba(255,255,255,0.06)",borderRadius:4,overflow:"hidden",marginTop:6 }}>
              <div style={{ height:"100%",width:`${Math.min(fin.realROI,100)}%`,background:roiColor,borderRadius:4 }}/>
            </div>
          </div>
          <div style={{ display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:6,marginBottom:14 }}>
            {[["On Time",fin.onTimeCount,"#4ade80","rgba(34,197,94,0.06)","rgba(34,197,94,0.15)"],["Late",fin.lateCount,"#f59e0b","rgba(245,158,11,0.06)","rgba(245,158,11,0.15)"],["Partial",fin.partialCount,"#f87171","rgba(239,68,68,0.06)","rgba(239,68,68,0.15)"],["Overdue",fin.overdueCount,"#ef4444","rgba(239,68,68,0.08)","rgba(239,68,68,0.2)"]].map(([l,v,c,bg,border])=>(
              <div key={l} style={{ background:bg,border:`1px solid ${border}`,borderRadius:10,padding:"10px 8px",textAlign:"center" }}>
                <div style={{ fontSize:16,fontWeight:800,color:c }}>{v}</div>
                <div style={{ fontSize:9,color:"#5a7a90",marginTop:2 }}>{l}</div>
              </div>
            ))}
          </div>
          <div style={{ background:`linear-gradient(135deg,${perfColor}10,${perfColor}05)`,border:`1px solid ${perfColor}30`,borderRadius:12,padding:"12px 14px",marginBottom:14,display:"flex",justifyContent:"space-between",alignItems:"center" }}>
            <div>
              <div style={{ fontSize:11,color:perfColor,fontWeight:700,marginBottom:4 }}>PERFORMANCE RATING</div>
              <div style={{ display:"flex",gap:3 }}>{[1,2,3,4,5].map(s=><span key={s} style={{ color:s<=stars?"#f59e0b":"rgba(255,255,255,0.1)",fontSize:14 }}>★</span>)}</div>
            </div>
            <div style={{ fontSize:22,fontWeight:900,color:perfColor,fontFamily:"'Courier New',monospace" }}>{fin.completionRate.toFixed(0)}%</div>
          </div>
          <button onClick={()=>setScheduleOpen(!scheduleOpen)} style={{ width:"100%",background:"rgba(100,180,255,0.06)",border:"1px solid rgba(100,180,255,0.12)",color:"#60a5fa",padding:"9px",borderRadius:10,cursor:"pointer",fontWeight:700,fontSize:12,display:"flex",alignItems:"center",justifyContent:"center",gap:6,marginBottom:scheduleOpen?10:0 }}>
            <Icon name="calendar" size={13}/>{scheduleOpen?"Hide Schedule":"View Schedule"}{scheduleOpen?<Icon name="chevronUp" size={13}/>:<Icon name="chevronDown" size={13}/>}
          </button>
          {scheduleOpen && (
            <div style={{ display:"flex",flexDirection:"column",gap:6 }}>
              {loan.schedule?.map((s, i) => (
                <InstallmentRow key={i} s={s} i={i} loan={loan} isActive={isActive} isAdmin={isAdmin} today={today} onPayment={onPayment} onOverride={onOverride}/>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── FINANCIAL PANEL ──────────────────────────────────────────────────────────
function FinancialPanel({ fin, isClient = false, expandFinancials, setExpandFinancials }) {
  const roiColor = fin.realROI >= 20 ? "#22c55e" : fin.realROI >= 10 ? "#f59e0b" : "#ef4444";
  return (
    <div style={{ background:"linear-gradient(135deg,rgba(16,30,50,0.9),rgba(10,20,40,0.95))",border:"1px solid rgba(100,180,255,0.1)",borderRadius:16,overflow:"hidden",marginBottom:20 }}>
      <div style={{ background:"linear-gradient(135deg,rgba(59,130,246,0.12),rgba(34,197,94,0.08))",padding:"14px 16px",borderBottom:"1px solid rgba(100,180,255,0.08)",display:"flex",justifyContent:"space-between",alignItems:"center" }}>
        <div style={{ display:"flex",alignItems:"center",gap:8 }}>
          <Icon name="trend" size={16}/>
          <div>
            <div style={{ fontSize:13,fontWeight:800,color:"#e8f4fd" }}>{isClient?"Client Intelligence":"Portfolio Intelligence"}</div>
            <div style={{ fontSize:10,color:"#3a5a70",marginTop:1 }}>{isClient?"Per-client capital & return":"Real-time portfolio metrics"}</div>
          </div>
        </div>
        {!isClient && setExpandFinancials && <button onClick={()=>setExpandFinancials(!expandFinancials)} style={{ background:"rgba(100,180,255,0.08)",border:"none",borderRadius:8,color:"#60a5fa",padding:"5px 12px",fontSize:11,cursor:"pointer",fontWeight:600 }}>{expandFinancials?"Collapse":"Expand"}</button>}
      </div>
      {(isClient || expandFinancials) && (
        <div style={{ padding:"14px 16px",display:"flex",flexDirection:"column",gap:8 }}>
          <FinanceMetricRow label="Total Capital Deployed" sub="All principal issued" value={formatCurrency(fin.totalCapital??fin.capital)} valueColor="#60a5fa" icon={<Icon name="shield" size={13}/>}/>
          <FinanceMetricRow label="Outstanding Principal" sub="Capital not yet recovered" value={formatCurrency(fin.outstandingPrincipal)} valueColor={fin.outstandingPrincipal>0?"#f87171":"#4ade80"} icon={<Icon name="shield" size={13}/>}/>
          <FinanceMetricRow label="Interest Earned" sub="Interest portion of receipts" value={formatCurrency(fin.interestEarned)} valueColor="#a78bfa" icon={<Icon name="trend" size={13}/>}/>
          <FinanceMetricRow label="Expected Total Interest" sub="Full interest on all loans" value={formatCurrency(fin.totalExpectedInterest??fin.expectedInterest)} valueColor="#c4b5fd" icon={<Icon name="trend" size={13}/>}/>
          <div style={{ padding:"12px 14px",background:"linear-gradient(135deg,rgba(34,197,94,0.08),rgba(34,197,94,0.04))",borderRadius:10,border:"1px solid rgba(34,197,94,0.15)",display:"flex",justifyContent:"space-between",alignItems:"center" }}>
            <div><div style={{ fontSize:11,color:"#4ade80",fontWeight:700 }}>TRUE PROFIT</div><div style={{ fontSize:9,color:"#3a6050",marginTop:2 }}>Cash income from interest</div></div>
            <div style={{ fontSize:18,fontWeight:900,color:"#22c55e",fontFamily:"'Courier New',monospace" }}>{formatCurrency(fin.trueProfit)}</div>
          </div>
          <div style={{ padding:"12px 14px",background:"linear-gradient(135deg,rgba(168,85,247,0.08),rgba(168,85,247,0.03))",borderRadius:10,border:`1px solid ${roiColor}33` }}>
            <div style={{ display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:8 }}>
              <div><div style={{ fontSize:11,color:roiColor,fontWeight:700 }}>REAL ROI %</div><div style={{ fontSize:9,color:"#3a4a58",marginTop:2 }}>True Profit ÷ Capital × 100</div></div>
              <div style={{ background:`${roiColor}20`,border:`1px solid ${roiColor}40`,borderRadius:8,padding:"4px 10px" }}>
                <span style={{ fontSize:16,fontWeight:900,color:roiColor,fontFamily:"'Courier New',monospace" }}>{fin.realROI.toFixed(2)}%</span>
              </div>
            </div>
            <ROIGauge roi={fin.realROI}/>
          </div>
          {!isClient && (
            <div style={{ display:"flex",justifyContent:"space-between",alignItems:"center",padding:"10px 14px",background:"rgba(255,255,255,0.02)",borderRadius:10,border:"1px solid rgba(255,255,255,0.04)" }}>
              <div><div style={{ fontSize:11,color:"#5a7a90" }}>Collection Rate</div><div style={{ fontSize:9,color:"#3a4a58",marginTop:1 }}>Total received vs expected</div></div>
              <div>
                <div style={{ fontSize:14,fontWeight:800,color:"#f59e0b",fontFamily:"'Courier New',monospace",textAlign:"right" }}>{fin.collectionRate.toFixed(1)}%</div>
                <div style={{ width:80,height:4,background:"rgba(255,255,255,0.06)",borderRadius:4,marginTop:4,overflow:"hidden" }}><div style={{ height:"100%",width:`${Math.min(fin.collectionRate,100)}%`,background:"#f59e0b",borderRadius:4 }}/></div>
              </div>
            </div>
          )}
          <div style={{ display:"grid",gridTemplateColumns:"1fr 1fr",gap:8 }}>
            <div style={{ padding:"10px 12px",background:"rgba(96,165,250,0.06)",borderRadius:10,border:"1px solid rgba(96,165,250,0.12)" }}><div style={{ fontSize:9,color:"#3a5a70",marginBottom:4 }}>PRINCIPAL RECOVERED</div><div style={{ fontSize:12,fontWeight:700,color:"#60a5fa",fontFamily:"'Courier New',monospace" }}>{formatCurrency(fin.principalCollected)}</div></div>
            <div style={{ padding:"10px 12px",background:"rgba(248,113,113,0.05)",borderRadius:10,border:"1px solid rgba(248,113,113,0.1)" }}><div style={{ fontSize:9,color:"#3a5a70",marginBottom:4 }}>CAPITAL AT RISK</div><div style={{ fontSize:12,fontWeight:700,color:"#f87171",fontFamily:"'Courier New',monospace" }}>{formatCurrency(fin.outstandingPrincipal)}</div></div>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── LOGIN SCREEN ─────────────────────────────────────────────────────────────
function LoginScreen({ users, onLogin }) {
  const [username, setUsername] = useState("");
  const [pin, setPin] = useState("");
  const [error, setError] = useState("");
  const handleLogin = () => {
    const user = users.find(u => u.username.toLowerCase() === username.toLowerCase().trim() && u.pin === pin && u.active);
    if (user) { setError(""); onLogin(user); }
    else setError("Invalid username or PIN. Please try again.");
  };
  return (
    <div style={{ minHeight:"100vh",background:"#060f1a",display:"flex",alignItems:"center",justifyContent:"center",padding:20,flexDirection:"column",gap:24 }}>
      <div style={{ textAlign:"center" }}>
        <div style={{ width:64,height:64,borderRadius:18,background:"linear-gradient(135deg,#0a5c36,#0d7a48)",border:"2px solid rgba(200,146,10,0.4)",display:"flex",alignItems:"center",justifyContent:"center",margin:"0 auto 16px" }}>
          <svg width="34" height="34" viewBox="0 0 80 80" fill="none">
            <path d="M48 22A19 19 0 1 0 48 58" stroke="white" strokeWidth="5.5" strokeLinecap="round" fill="none"/>
            <path d="M42 30L53 20L64 30" stroke="#c8920a" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" fill="none"/>
            <line x1="53" y1="20" x2="53" y2="44" stroke="#c8920a" strokeWidth="4" strokeLinecap="round"/>
          </svg>
        </div>
        <div style={{ fontSize:28,fontWeight:900,color:"#e8f4fd",letterSpacing:2,fontFamily:"serif" }}>CREDA</div>
        <div style={{ fontSize:11,color:"rgba(200,146,10,0.8)",letterSpacing:3,textTransform:"uppercase",marginTop:4 }}>Finance Platform</div>
        <div style={{ fontSize:12,color:"#3a5a70",marginTop:8 }}>Sign in to your account</div>
      </div>
      <div style={{ background:"#0d1b2a",border:"1px solid rgba(100,200,255,0.12)",borderRadius:20,padding:"28px 24px",width:"100%",maxWidth:380,boxShadow:"0 40px 100px rgba(0,0,0,0.5)" }}>
        <Field label="Username"><input style={inputStyle} value={username} onChange={e=>setUsername(e.target.value)} onKeyDown={e=>e.key==="Enter"&&handleLogin()} placeholder="Enter your username" autoFocus/></Field>
        <Field label="PIN"><input type="password" style={inputStyle} value={pin} onChange={e=>setPin(e.target.value)} onKeyDown={e=>e.key==="Enter"&&handleLogin()} placeholder="Enter your PIN"/></Field>
        {error && <div style={{ background:"rgba(239,68,68,0.1)",border:"1px solid rgba(239,68,68,0.2)",borderRadius:8,padding:"10px 12px",fontSize:12,color:"#f87171",marginBottom:14 }}>{error}</div>}
        <button onClick={handleLogin} style={{ width:"100%",background:"linear-gradient(135deg,#22c55e,#16a34a)",border:"none",color:"#000",padding:"13px",borderRadius:12,cursor:"pointer",fontWeight:800,fontSize:15,marginTop:4 }}>Sign In →</button>
        <div style={{ textAlign:"center",fontSize:11,color:"#2a4050",marginTop:16 }}>Contact your administrator for access credentials</div>
      </div>
    </div>
  );
}

// ─── STAFF MANAGEMENT ────────────────────────────────────────────────────────
function StaffPanel({ users, clients, pendingLoans, currentUser, onUpdateUsers, onApproveLoan, onRejectLoan }) {
  const [showAddStaff, setShowAddStaff] = useState(false);
  const [newStaff, setNewStaff] = useState({ name:"", username:"", pin:"", role:"loan_officer" });
  const [editStaff, setEditStaff] = useState(null);
  const loanOfficers = users.filter(u => u.role === "loan_officer");

  const handleAddStaff = () => {
    if (!newStaff.name.trim() || !newStaff.username.trim() || !newStaff.pin.trim()) return;
    if (users.find(u => u.username.toLowerCase() === newStaff.username.toLowerCase())) { alert("Username already exists."); return; }
    const staff = { ...newStaff, id: generateId("USR"), createdAt: new Date().toISOString().split("T")[0], active: true };
    onUpdateUsers([...users, staff]);
    setNewStaff({ name:"", username:"", pin:"", role:"loan_officer" });
    setShowAddStaff(false);
  };
  const handleToggleActive = (userId) => { onUpdateUsers(users.map(u => u.id === userId ? { ...u, active: !u.active } : u)); };
  const handleUpdateStaff = () => {
    if (!editStaff?.name.trim()) return;
    onUpdateUsers(users.map(u => u.id === editStaff.id ? editStaff : u));
    setEditStaff(null);
  };
  const getStaffStats = (staffId) => {
    const myClients = clients.filter(c => c.assignedTo === staffId);
    const activeLoans = myClients.reduce((a, c) => a + (c.loans?.filter(l=>l.status==="active").length||0), 0);
    const totalCollected = myClients.reduce((a, c) => a + (c.loans||[]).reduce((b, l) => b + (l.schedule||[]).reduce((d, s) => d + (s.paidAmount||0), 0), 0), 0);
    return { clients: myClients.length, activeLoans, totalCollected };
  };

  return (
    <div>
      <div style={{ display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:20 }}>
        <div>
          <h1 style={{ margin:0,fontSize:22,fontWeight:800,color:"#e8f4fd" }}>Staff Management</h1>
          <p style={{ margin:"4px 0 0",color:"#3a5a70",fontSize:13 }}>{loanOfficers.length} Loan Officer{loanOfficers.length!==1?"s":""}</p>
        </div>
        <button onClick={()=>setShowAddStaff(true)} style={{ background:"linear-gradient(135deg,#3b82f6,#2563eb)",border:"none",color:"#fff",padding:"9px 16px",borderRadius:11,cursor:"pointer",fontWeight:700,fontSize:13,display:"flex",alignItems:"center",gap:6 }}><Icon name="plus" size={13}/>Add Staff</button>
      </div>

      {pendingLoans.length > 0 && (
        <div style={{ background:"rgba(245,158,11,0.06)",border:"1px solid rgba(245,158,11,0.2)",borderRadius:14,padding:16,marginBottom:20 }}>
          <div style={{ display:"flex",alignItems:"center",gap:8,marginBottom:12 }}><Icon name="bell" size={16}/><span style={{ fontSize:14,fontWeight:700,color:"#f59e0b" }}>Pending Loan Approvals ({pendingLoans.length})</span></div>
          <div style={{ display:"flex",flexDirection:"column",gap:10 }}>
            {pendingLoans.map(pl => {
              const officer = users.find(u => u.id === pl.requestedBy);
              const client = clients.find(c => c.id === pl.clientId);
              return (
                <div key={pl.id} style={{ background:"rgba(0,0,0,0.2)",borderRadius:12,padding:"12px 14px" }}>
                  <div style={{ display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:8 }}>
                    <div><div style={{ fontSize:13,fontWeight:700,color:"#e8f4fd" }}>{client?.name || "Unknown Client"}</div><div style={{ fontSize:10,color:"#3a5a70",marginTop:2 }}>Requested by {officer?.name || "Unknown"} · {formatDate(pl.requestedAt?.split("T")[0])}</div></div>
                    <div style={{ textAlign:"right" }}><div style={{ fontSize:14,fontWeight:800,color:"#60a5fa",fontFamily:"'Courier New',monospace" }}>{formatCurrency(pl.loanData.principal)}</div><div style={{ fontSize:9,color:"#3a5a70" }}>{pl.loanData.interestRate}% · {pl.loanData.days} days</div></div>
                  </div>
                  <div style={{ display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:6,marginBottom:10,fontSize:10 }}>
                    <div style={{ background:"rgba(255,255,255,0.03)",borderRadius:7,padding:"7px 9px" }}><div style={{ color:"#3a5a70",marginBottom:2 }}>TOTAL REPAYABLE</div><div style={{ color:"#4ade80",fontWeight:700,fontFamily:"'Courier New',monospace" }}>{formatCurrency(pl.loanData.totalRepayable)}</div></div>
                    <div style={{ background:"rgba(255,255,255,0.03)",borderRadius:7,padding:"7px 9px" }}><div style={{ color:"#3a5a70",marginBottom:2 }}>DAILY PAYMENT</div><div style={{ color:"#60a5fa",fontWeight:700,fontFamily:"'Courier New',monospace" }}>{formatCurrency(pl.loanData.dailyPayment)}</div></div>
                    <div style={{ background:"rgba(255,255,255,0.03)",borderRadius:7,padding:"7px 9px" }}><div style={{ color:"#3a5a70",marginBottom:2 }}>INTEREST</div><div style={{ color:"#c4b5fd",fontWeight:700,fontFamily:"'Courier New',monospace" }}>{formatCurrency(pl.loanData.totalInterest)}</div></div>
                  </div>
                  <div style={{ display:"flex",gap:8 }}>
                    <button onClick={()=>onApproveLoan(pl)} style={{ flex:1,background:"linear-gradient(135deg,#22c55e,#16a34a)",border:"none",color:"#000",padding:"9px",borderRadius:9,cursor:"pointer",fontWeight:700,fontSize:12 }}>✓ Approve Loan</button>
                    <button onClick={()=>onRejectLoan(pl.id)} style={{ flex:1,background:"rgba(239,68,68,0.1)",border:"1px solid rgba(239,68,68,0.2)",color:"#f87171",padding:"9px",borderRadius:9,cursor:"pointer",fontWeight:700,fontSize:12 }}>✕ Reject</button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {loanOfficers.length === 0 ? (
        <div style={{ textAlign:"center",padding:40,color:"#2a4050",border:"1px dashed rgba(100,180,255,0.08)",borderRadius:14 }}><div style={{ fontSize:32,marginBottom:10 }}>👥</div><div>No loan officers yet.</div></div>
      ) : (
        <div style={{ display:"flex",flexDirection:"column",gap:10 }}>
          {loanOfficers.map(officer => {
            const stats = getStaffStats(officer.id);
            return (
              <div key={officer.id} style={{ background:"rgba(255,255,255,0.025)",border:`1px solid ${officer.active?"rgba(100,180,255,0.1)":"rgba(255,255,255,0.04)"}`,borderRadius:14,padding:"14px 16px" }}>
                <div style={{ display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:12 }}>
                  <div style={{ display:"flex",alignItems:"center",gap:10 }}>
                    <div style={{ width:42,height:42,borderRadius:12,background:officer.active?"linear-gradient(135deg,#1d4ed8,#3b82f6)":"rgba(255,255,255,0.06)",display:"flex",alignItems:"center",justifyContent:"center",fontWeight:800,fontSize:17,color:officer.active?"#fff":"#3a5a70",flexShrink:0 }}>{officer.name.charAt(0).toUpperCase()}</div>
                    <div>
                      <div style={{ fontSize:14,fontWeight:700,color:officer.active?"#dceef8":"#3a5a70" }}>{officer.name}</div>
                      <div style={{ fontSize:11,color:"#3a5a70",marginTop:1 }}>@{officer.username} · {officer.id}</div>
                      <div style={{ marginTop:4 }}><RoleBadge role={officer.role}/></div>
                    </div>
                  </div>
                  <div style={{ display:"flex",gap:6 }}>
                    <button onClick={()=>setEditStaff(officer)} style={{ background:"rgba(59,130,246,0.1)",border:"1px solid rgba(59,130,246,0.2)",color:"#60a5fa",width:30,height:30,borderRadius:8,cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center" }}><Icon name="edit" size={13}/></button>
                    <button onClick={()=>handleToggleActive(officer.id)} style={{ background:officer.active?"rgba(239,68,68,0.08)":"rgba(34,197,94,0.08)",border:`1px solid ${officer.active?"rgba(239,68,68,0.2)":"rgba(34,197,94,0.2)"}`,color:officer.active?"#f87171":"#4ade80",width:30,height:30,borderRadius:8,cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center" }}>
                      {officer.active?<Icon name="lock" size={13}/>:<Icon name="unlock" size={13}/>}
                    </button>
                  </div>
                </div>
                <div style={{ display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:8 }}>
                  {[["Clients",stats.clients,"#60a5fa"],["Active Loans",stats.activeLoans,"#4ade80"],["Collected",formatCurrency(stats.totalCollected),"#a78bfa"]].map(([l,v,c])=>(
                    <div key={l} style={{ background:"rgba(0,0,0,0.2)",borderRadius:9,padding:"9px 10px" }}><div style={{ fontSize:9,color:"#3a5a70",marginBottom:3 }}>{l}</div><div style={{ fontSize:12,fontWeight:700,color:c,fontFamily:"'Courier New',monospace" }}>{v}</div></div>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {showAddStaff && (
        <Modal title="Add Loan Officer" onClose={()=>setShowAddStaff(false)}>
          <Field label="Full Name *"><input style={inputStyle} value={newStaff.name} onChange={e=>setNewStaff(p=>({...p,name:e.target.value}))} placeholder="e.g. Chioma Adeyemi"/></Field>
          <Field label="Username *"><input style={inputStyle} value={newStaff.username} onChange={e=>setNewStaff(p=>({...p,username:e.target.value.toLowerCase().replace(/\s/g,"")}))} placeholder="e.g. chioma"/></Field>
          <Field label="PIN (4–6 digits) *"><input type="password" style={inputStyle} value={newStaff.pin} onChange={e=>setNewStaff(p=>({...p,pin:e.target.value}))} placeholder="e.g. 1234"/></Field>
          <div style={{ background:"rgba(96,165,250,0.06)",border:"1px solid rgba(96,165,250,0.15)",borderRadius:10,padding:"10px 12px",marginBottom:14,fontSize:12,color:"#60a5fa" }}>This staff can add clients, record payments, and request loan approvals.</div>
          <button onClick={handleAddStaff} style={{ width:"100%",background:"linear-gradient(135deg,#3b82f6,#2563eb)",border:"none",color:"#fff",padding:"12px",borderRadius:12,cursor:"pointer",fontWeight:800,fontSize:14 }}>✓ Create Staff Account</button>
        </Modal>
      )}
      {editStaff && (
        <Modal title="Edit Staff" onClose={()=>setEditStaff(null)}>
          <Field label="Full Name *"><input style={inputStyle} value={editStaff.name} onChange={e=>setEditStaff(p=>({...p,name:e.target.value}))}/></Field>
          <Field label="Username *"><input style={inputStyle} value={editStaff.username} onChange={e=>setEditStaff(p=>({...p,username:e.target.value}))}/></Field>
          <Field label="New PIN (leave blank to keep)"><input type="password" style={inputStyle} placeholder="Enter new PIN to change..." onChange={e=>{ if(e.target.value) setEditStaff(p=>({...p,pin:e.target.value})); }}/></Field>
          <button onClick={handleUpdateStaff} style={{ width:"100%",background:"linear-gradient(135deg,#3b82f6,#2563eb)",border:"none",color:"#fff",padding:"12px",borderRadius:12,cursor:"pointer",fontWeight:800,fontSize:14 }}>✓ Save Changes</button>
        </Modal>
      )}
    </div>
  );
}

// ─── MAIN APP ─────────────────────────────────────────────────────────────────
export default function App() {
  const [clients, setClients] = useState([]);
  const [users, setUsers] = useState([]);
  const [pendingLoans, setPendingLoans] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [savedFlash, setSavedFlash] = useState(false);
  const [currentUser, setCurrentUser] = useState(null);
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
  const [adminInstOverride, setAdminInstOverride] = useState({ paid:false,paidAmount:"",dueDate:"",paidDate:"" });
  const [showAssignClient, setShowAssignClient] = useState(null);
  const [clientSearch, setClientSearch] = useState("");
  const [clientFilter, setClientFilter] = useState("all");
  const [expandMonthlyHistory, setExpandMonthlyHistory] = useState(false);
  const [expandFinancials, setExpandFinancials] = useState(true);
  const [newClient, setNewClient] = useState({ name:"",phone:"",address:"",idNumber:"" });
  const [newLoan, setNewLoan] = useState({ principal:"",interestRate:"15",days:"30",startDate:new Date().toISOString().split("T")[0],excludeWeekends:true });

  useEffect(() => {
    loadData().then(data => { setClients(data.clients); setUsers(data.users); setPendingLoans(data.pendingLoans); setLoading(false); });
  }, []);

  const persist = async (c, u, p) => {
    setSaving(true); await saveAll(c, u, p); setSaving(false); setSavedFlash(true);
    setTimeout(() => setSavedFlash(false), 1800);
  };
  const updateAll = (c = clients, u = users, p = pendingLoans) => { setClients(c); setUsers(u); setPendingLoans(p); persist(c, u, p); };
  const isAdmin = currentUser?.role === "admin";
  const today = new Date();

  const visibleClients = useMemo(() => {
    if (isAdmin) return clients;
    return clients.filter(c => c.assignedTo === currentUser?.id);
  }, [clients, currentUser, isAdmin]);

  const selectedClient = visibleClients.find(c => c.id === selectedClientId);
  const globalFinancials = useMemo(() => computeFinancials(isAdmin ? clients : visibleClients), [clients, visibleClients, isAdmin]);

  const filteredClients = useMemo(() => {
    return visibleClients.filter(c => {
      const match = c.name.toLowerCase().includes(clientSearch.toLowerCase()) || c.phone.includes(clientSearch) || c.id.toLowerCase().includes(clientSearch.toLowerCase());
      const active = c.loans?.find(l => l.status === "active");
      const hasLoans = c.loans && c.loans.length > 0;
      if (clientFilter === "active") return match && active;
      if (clientFilter === "completed") return match && !active && hasLoans;
      if (clientFilter === "none") return match && !hasLoans;
      return match;
    });
  }, [visibleClients, clientSearch, clientFilter]);

  const stats = useMemo(() => {
    const source = isAdmin ? clients : visibleClients;
    let totalDisbursed = 0, totalExpected = 0, totalCollected = 0, overdueCount = 0;
    source.forEach(c => {
      (c.loans || []).forEach(l => {
        totalDisbursed += l.principal || 0; totalExpected += l.totalRepayable || 0;
        (l.schedule || []).forEach(s => { if (s.paidAmount > 0) totalCollected += s.paidAmount; else if (new Date(s.dueDate) < today) overdueCount++; });
      });
    });
    const totalSavings = source.reduce((a, c) => a + (c.savingsBalance || 0), 0);
    return { totalDisbursed, totalExpected, totalCollected, outstanding: totalExpected - totalCollected, overdueCount, totalSavings };
  }, [clients, visibleClients, isAdmin]);

  const monthlyHistory = useMemo(() => {
    const source = isAdmin ? clients : visibleClients;
    const map = {};
    source.forEach(c => {
      (c.loans || []).forEach(l => {
        const key = (l.issuedAt || l.startDate || new Date().toISOString()).slice(0, 7);
        if (!map[key]) map[key] = { disbursed:0, expected:0, collected:0, interest:0 };
        map[key].disbursed += l.principal || 0; map[key].expected += l.totalRepayable || 0; map[key].interest += l.totalInterest || 0;
        (l.schedule || []).forEach(s => { if (s.paidAmount > 0) map[key].collected += s.paidAmount; });
      });
    });
    return Object.entries(map).map(([month, d]) => ({ month, ...d, outstanding: Math.max(0, d.expected - d.collected) })).sort((a,b)=>b.month.localeCompare(a.month));
  }, [clients, visibleClients, isAdmin]);

  const globalTransactions = useMemo(() => {
    const source = isAdmin ? clients : visibleClients;
    const tx = [];
    source.forEach(c => { (c.loans||[]).forEach(l => { (l.schedule||[]).forEach(s => { if (s.paidAmount > 0) tx.push({ clientId:c.id,clientName:c.name,loanId:l.id,day:s.day,totalDays:l.days,paidAmount:s.paidAmount,paidDate:s.paidDate,dueDate:s.dueDate,overpayment:s.overpayment||0,shortfall:s.shortfall||0 }); }); }); });
    return tx.sort((a, b) => new Date(b.paidDate) - new Date(a.paidDate));
  }, [clients, visibleClients, isAdmin]);

  const dailyCollectionData = useMemo(() => {
    const source = isAdmin ? clients : visibleClients;
    const map = {};
    source.forEach(c => {
      (c.loans || []).forEach(l => {
        (l.schedule || []).forEach(s => {
          const due = s.dueDate; if (!due) return;
          if (!map[due]) map[due] = { date: due, expected: 0, collected: 0, installments: [] };
          map[due].expected += s.payment || 0; map[due].collected += s.paidAmount || 0;
          map[due].installments.push({ clientName:c.name,clientId:c.id,loanId:l.id,day:s.day,totalDays:l.days,payment:s.payment,paidAmount:s.paidAmount||0,paid:s.paid,paidDate:s.paidDate,dueDate:s.dueDate,overpayment:s.overpayment||0,shortfall:s.shortfall||0 });
        });
      });
    });
    return Object.values(map).sort((a, b) => new Date(b.date) - new Date(a.date));
  }, [clients, visibleClients, isAdmin]);

  const computePaymentPreview = (loan, idx, amount) => {
    if (!amount || amount <= 0) return null;
    const sim = applySmartPayment(loan.schedule, idx, amount, new Date().toISOString().split("T")[0]);
    const daysBefore = loan.schedule.filter(s => s.paid).length;
    const daysAfter = sim.filter(s => s.paid).length;
    return { daysCleared: daysAfter - daysBefore, isOver: amount > loan.dailyPayment, isUnder: amount > 0 && amount < loan.dailyPayment, remainingBal: sim[sim.length-1]?.balance || 0 };
  };

  const handleAddClient = () => {
    if (!newClient.name.trim() || !newClient.phone.trim()) return;
    const client = { ...newClient, id: generateId("CL"), loans: [], savingsBalance: 0, savingsLogs: [], assignedTo: currentUser?.id, assignedToName: currentUser?.name, createdAt: new Date().toISOString().split("T")[0] };
    updateAll([client, ...clients]); setNewClient({ name:"",phone:"",address:"",idNumber:"" }); setShowAddClient(false);
  };
  const handleUpdateClient = () => {
    if (!showEditClient?.name.trim()) return;
    updateAll(clients.map(c => c.id === showEditClient.id ? showEditClient : c)); setShowEditClient(null);
  };
  const handleAddLoan = () => {
    if (!newLoan.principal || !selectedClientId) return;
    const p = parseFloat(newLoan.principal), r = parseFloat(newLoan.interestRate), d = parseInt(newLoan.days);
    const { dailyPayment, totalRepayable, totalInterest, schedule } = calcLoanSchedule(p, r, d, newLoan.startDate, newLoan.excludeWeekends);
    const loan = { id: generateId("LN"), principal:p, interestRate:r, days:d, startDate:newLoan.startDate, dailyPayment, totalRepayable, totalInterest, schedule, status:"active", issuedAt:new Date().toISOString(), excludeWeekends:newLoan.excludeWeekends, issuedBy:currentUser?.id, issuedByName:currentUser?.name };
    updateAll(clients.map(c => c.id === selectedClientId ? { ...c, loans:[...(c.loans||[]),loan] } : c));
    setNewLoan({ principal:"",interestRate:"15",days:"30",startDate:new Date().toISOString().split("T")[0],excludeWeekends:true }); setShowAddLoan(false);
  };
  const handleRequestLoan = () => {
    if (!newLoan.principal || !selectedClientId) return;
    const p = parseFloat(newLoan.principal), r = parseFloat(newLoan.interestRate), d = parseInt(newLoan.days);
    const { dailyPayment, totalRepayable, totalInterest, schedule } = calcLoanSchedule(p, r, d, newLoan.startDate, newLoan.excludeWeekends);
    const pending = { id: generateId("PL"), clientId: selectedClientId, requestedBy: currentUser?.id, requestedByName: currentUser?.name, requestedAt: new Date().toISOString(), loanData: { principal:p, interestRate:r, days:d, startDate:newLoan.startDate, dailyPayment, totalRepayable, totalInterest, schedule, excludeWeekends:newLoan.excludeWeekends } };
    updateAll(clients, users, [...pendingLoans, pending]);
    setNewLoan({ principal:"",interestRate:"15",days:"30",startDate:new Date().toISOString().split("T")[0],excludeWeekends:true }); setShowAddLoan(false);
    alert("✅ Loan request submitted! Admin will review and approve.");
  };
  const handleApproveLoan = (pendingLoan) => {
    const { clientId, loanData } = pendingLoan;
    const loan = { id: generateId("LN"), ...loanData, status:"active", issuedAt:new Date().toISOString(), approvedBy:currentUser?.id, approvedByName:currentUser?.name };
    updateAll(clients.map(c => c.id === clientId ? { ...c, loans:[...(c.loans||[]),loan] } : c), users, pendingLoans.filter(p => p.id !== pendingLoan.id));
  };
  const handleRejectLoan = (pendingId) => { updateAll(clients, users, pendingLoans.filter(p => p.id !== pendingId)); };
  const handlePayment = () => {
    const amount = parseFloat(paymentAmount);
    if (!amount || amount <= 0 || !showPayment) return;
    const { clientId, loanId, scheduleIdx } = showPayment;
    const updated = clients.map(c => {
      if (c.id !== clientId) return c;
      return { ...c, loans: c.loans.map(l => {
        if (l.id !== loanId) return l;
        const newSchedule = applySmartPayment(l.schedule, scheduleIdx, amount, new Date().toISOString().split("T")[0]);
        return { ...l, schedule:newSchedule, status:newSchedule.every(s=>s.paid)?"completed":"active", lastPaymentBy:currentUser?.id, lastPaymentByName:currentUser?.name };
      })};
    });
    updateAll(updated); setPaymentAmount(""); setShowPayment(null); setPaymentPreview(null);
  };
  const handleSavingsTransaction = () => {
    const amount = parseFloat(savingsAmount);
    if (!amount || amount <= 0 || !showSavingsTx) return;
    const { type, client } = showSavingsTx;
    const updated = clients.map(c => {
      if (c.id !== client.id) return c;
      const cur = c.savingsBalance || 0;
      if (type === "withdraw" && amount > cur) { alert("⚠️ Insufficient savings!"); return c; }
      const newBal = type === "deposit" ? cur + amount : cur - amount;
      const log = { id:generateId("TX"), date:new Date().toISOString().split("T")[0], type, amount, balanceAfter:newBal, recordedBy:currentUser?.name };
      return { ...c, savingsBalance:newBal, savingsLogs:[log,...(c.savingsLogs||[])] };
    });
    updateAll(updated); setSavingsAmount(""); setShowSavingsTx(null);
  };
  const handleAdminSavingsAdjustment = () => {
    const newBal = parseFloat(adminDirectSavingsInput);
    if (isNaN(newBal) || !showSavingsTx) return;
    const { client } = showSavingsTx;
    const updated = clients.map(c => {
      if (c.id !== client.id) return c;
      const log = { id:generateId("TX"), date:new Date().toISOString().split("T")[0], type:"admin_adjustment", amount:Math.abs(newBal-(c.savingsBalance||0)), balanceAfter:newBal, recordedBy:currentUser?.name };
      return { ...c, savingsBalance:newBal, savingsLogs:[log,...(c.savingsLogs||[])] };
    });
    updateAll(updated); setAdminDirectSavingsInput(""); setShowSavingsTx(null);
  };
  const handleAdminInstallmentOverride = () => {
    if (!adminEditInstallment) return;
    const { client, loan, idx } = adminEditInstallment;
    const pAmt = parseFloat(adminInstOverride.paidAmount) || 0;
    const updated = clients.map(c => {
      if (c.id !== client.id) return c;
      return { ...c, loans: c.loans.map(l => {
        if (l.id !== loan.id) return l;
        const s = l.schedule.map((s, i) => i === idx ? { ...s, paid:adminInstOverride.paid, dueDate:adminInstOverride.dueDate, paidDate:adminInstOverride.paid?(adminInstOverride.paidDate||new Date().toISOString().split("T")[0]):null, paidAmount:adminInstOverride.paid?pAmt:0, overpayment:adminInstOverride.paid&&pAmt>s.payment?pAmt-s.payment:0, shortfall:adminInstOverride.paid&&pAmt<s.payment?s.payment-pAmt:0 } : s);
        let running = l.totalRepayable;
        const rc = s.map(s => { if (s.paidAmount > 0) running = Math.max(0, running - s.paidAmount); return { ...s, balance:running }; });
        return { ...l, schedule:rc, status:rc.every(s=>s.paid)?"completed":"active" };
      })};
    });
    updateAll(updated); setAdminEditInstallment(null);
  };
  const handleAssignClient = (clientId, staffId) => {
    const staff = users.find(u => u.id === staffId);
    updateAll(clients.map(c => c.id === clientId ? { ...c, assignedTo:staffId, assignedToName:staff?.name } : c)); setShowAssignClient(null);
  };
  const handleDeleteClient = (id) => { updateAll(clients.filter(c => c.id !== id)); setConfirmDelete(null); setView("clients"); };
  const getClientLoanSummary = (c) => {
    const active = c.loans?.find(l => l.status === "active");
    const overdue = active?.schedule?.filter(s => !s.paid && new Date(s.dueDate) < today).length || 0;
    const paid = active?.schedule?.filter(s => s.paid).length || 0;
    const total = active?.schedule?.length || 0;
    const balance = active ? (active.schedule.find(s => !s.paid)?.balance ?? 0) : 0;
    return { active, overdue, paid, total, balance };
  };

  if (loading) return (
    <div style={{ minHeight:"100vh",background:"#060f1a",display:"flex",alignItems:"center",justifyContent:"center",flexDirection:"column",gap:16 }}>
      <div style={{ width:48,height:48,borderRadius:14,background:"linear-gradient(135deg,#22c55e,#0ea5e9)",display:"flex",alignItems:"center",justifyContent:"center",fontSize:24 }}>💰</div>
      <div style={{ color:"#4a7090",fontSize:14 }}>CREDA Engine Starting...</div>
    </div>
  );

  if (!currentUser) return <LoginScreen users={users} onLogin={setCurrentUser}/>;

  // ── DASHBOARD ─────────────────────────────────────────────────────────────
  const Dashboard = () => (
    <div>
      <div style={{ marginBottom:22 }}>
        <div style={{ display:"flex",justifyContent:"space-between",alignItems:"flex-start" }}>
          <div>
            <h1 style={{ margin:0,fontSize:24,fontWeight:800,color:"#e8f4fd",letterSpacing:-0.5 }}>{isAdmin?"Dashboard":"My Dashboard"}</h1>
            <p style={{ margin:"4px 0 0",color:"#3a5a70",fontSize:13 }}>{isAdmin?`${clients.length} total clients · ${pendingLoans.length} pending approvals`:`${visibleClients.length} my clients · Loan Officer`}</p>
          </div>
          <RoleBadge role={currentUser.role}/>
        </div>
      </div>
      {isAdmin && pendingLoans.length > 0 && (
        <div onClick={()=>setView("staff")} style={{ background:"rgba(245,158,11,0.08)",border:"1px solid rgba(245,158,11,0.25)",borderRadius:12,padding:"12px 14px",marginBottom:16,cursor:"pointer",display:"flex",justifyContent:"space-between",alignItems:"center" }}>
          <div style={{ display:"flex",alignItems:"center",gap:8 }}><Icon name="bell" size={16}/><div><div style={{ fontSize:13,fontWeight:700,color:"#f59e0b" }}>{pendingLoans.length} Loan Approval{pendingLoans.length>1?"s":""} Pending</div><div style={{ fontSize:10,color:"#6b5020",marginTop:1 }}>Tap to review and approve</div></div></div>
          <Icon name="chevronDown" size={14}/>
        </div>
      )}
      {!isAdmin && (() => {
        const myPending = pendingLoans.filter(p => p.requestedBy === currentUser.id);
        return myPending.length > 0 ? (
          <div style={{ background:"rgba(96,165,250,0.08)",border:"1px solid rgba(96,165,250,0.2)",borderRadius:12,padding:"12px 14px",marginBottom:16 }}>
            <div style={{ fontSize:13,fontWeight:700,color:"#60a5fa",marginBottom:4 }}>⏳ {myPending.length} Loan Request{myPending.length>1?"s":""} Awaiting Admin Approval</div>
            {myPending.map(p => { const cl = clients.find(c => c.id === p.clientId); return <div key={p.id} style={{ fontSize:11,color:"#3a5a70",marginTop:2 }}>• {cl?.name} — {formatCurrency(p.loanData.principal)}</div>; })}
          </div>
        ) : null;
      })()}
      <div style={{ display:"grid",gridTemplateColumns:"1fr 1fr",gap:10,marginBottom:20 }}>
        <StatCard label={isAdmin?"Total Disbursed":"My Disbursed"} value={formatCurrency(stats.totalDisbursed)} accent="#3b82f6"/>
        <StatCard label={isAdmin?"Total Collected":"My Collected"} value={formatCurrency(stats.totalCollected)} accent="#22c55e"/>
        <StatCard label="Outstanding" value={formatCurrency(stats.outstanding)} accent="#f59e0b"/>
        <StatCard label="Total Savings" value={formatCurrency(stats.totalSavings)} accent="#a855f7"/>
        <div style={{ gridColumn:"span 2" }}><StatCard label="Overdue Installments" value={stats.overdueCount+" late runs"} accent="#ef4444"/></div>
      </div>
      <FinancialPanel fin={globalFinancials} expandFinancials={expandFinancials} setExpandFinancials={setExpandFinancials}/>
      <div style={{ background:"rgba(255,255,255,0.02)",border:"1px solid rgba(100,180,255,0.06)",borderRadius:14,padding:16,marginBottom:20 }}>
        <div style={{ display:"flex",justifyContent:"space-between",alignItems:"center" }}>
          <div><h3 style={{ margin:0,fontSize:13,fontWeight:700,color:"#93c5fd",textTransform:"uppercase" }}>Monthly Breakdown</h3><p style={{ margin:"2px 0 0",fontSize:11,color:"#3a5a70" }}>Historical performance</p></div>
          <button onClick={()=>setExpandMonthlyHistory(!expandMonthlyHistory)} style={{ background:"rgba(147,197,253,0.1)",border:"none",borderRadius:8,color:"#93c5fd",padding:"5px 12px",fontSize:11,cursor:"pointer",fontWeight:600 }}>{expandMonthlyHistory?"Hide":"View"}</button>
        </div>
        {expandMonthlyHistory && (
          <div style={{ marginTop:16,display:"flex",flexDirection:"column",gap:10 }}>
            {monthlyHistory.length===0?<div style={{ fontSize:11,color:"#3a5a70",textAlign:"center" }}>No data yet.</div>:monthlyHistory.map(item=>(
              <div key={item.month} style={{ padding:"10px 12px",background:"rgba(0,0,0,0.2)",borderRadius:10,borderLeft:"3px solid #22c55e" }}>
                <div style={{ fontWeight:700,color:"#e8f4fd",fontSize:12,marginBottom:6 }}>{formatMonth(item.month)}</div>
                <div style={{ display:"grid",gridTemplateColumns:"1fr 1fr 1fr 1fr",gap:6 }}>
                  {[["DISBURSED",item.disbursed,"#93c5fd"],["COLLECTED",item.collected,"#4ade80"],["INTEREST",item.interest,"#c4b5fd"],["OUTSTANDING",item.outstanding,"#f87171"]].map(([l,v,c])=>(
                    <div key={l}><div style={{ fontSize:8,color:"#3a5a70" }}>{l}</div><div style={{ fontSize:10,fontWeight:600,color:c,fontFamily:"'Courier New',monospace" }}>{formatCurrency(v)}</div></div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
      <div style={{ display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:12 }}>
        <div style={{ fontSize:14,fontWeight:700,color:"#c8dde8" }}>{isAdmin?"Recent Clients":"My Recent Clients"}</div>
        <button onClick={()=>setView("clients")} style={{ background:"none",border:"none",color:"#3b82f6",fontSize:12,cursor:"pointer" }}>See all →</button>
      </div>
      {visibleClients.length===0?(
        <div style={{ border:"1px dashed rgba(100,180,255,0.1)",borderRadius:14,padding:40,textAlign:"center",color:"#2a4050" }}>
          <div style={{ fontSize:36,marginBottom:10 }}>💳</div><div style={{ marginBottom:14,fontSize:14 }}>No clients yet</div>
          <button onClick={()=>{ setView("clients"); setShowAddClient(true); }} style={{ background:"linear-gradient(135deg,#22c55e,#16a34a)",border:"none",color:"#000",padding:"9px 22px",borderRadius:10,cursor:"pointer",fontWeight:700,fontSize:13 }}>+ Add First Client</button>
        </div>
      ):(
        <div style={{ display:"flex",flexDirection:"column",gap:8 }}>
          {visibleClients.slice(0,5).map(c=>{
            const { active, overdue, paid, total, balance } = getClientLoanSummary(c);
            return (
              <div key={c.id} onClick={()=>{ setSelectedClientId(c.id); setView("detail"); }} style={{ background:"rgba(255,255,255,0.02)",border:"1px solid rgba(100,180,255,0.07)",borderRadius:12,padding:"12px 15px",cursor:"pointer",display:"flex",justifyContent:"space-between",alignItems:"center" }}>
                <div style={{ display:"flex",alignItems:"center",gap:10 }}>
                  <div style={{ width:36,height:36,borderRadius:10,background:"linear-gradient(135deg,#1d4ed8,#3b82f6)",display:"flex",alignItems:"center",justifyContent:"center",fontWeight:800,fontSize:15,color:"#fff",flexShrink:0 }}>{c.name.charAt(0).toUpperCase()}</div>
                  <div><div style={{ fontWeight:600,color:"#dceef8",fontSize:14 }}>{c.name}</div><div style={{ fontSize:10,color:"#3a5a70" }}>{c.phone}{isAdmin&&c.assignedToName&&` · ${c.assignedToName}`}</div></div>
                </div>
                <div style={{ textAlign:"right" }}>
                  {active?(<><div style={{ fontSize:12,fontWeight:700,color:"#60a5fa",fontFamily:"'Courier New',monospace" }}>{formatCurrency(balance)}</div><div style={{ fontSize:10,color:overdue>0?"#f87171":"#3a6050" }}>{overdue>0?`${overdue} overdue`:`${paid}/${total} paid`}</div></>):<div style={{ fontSize:11,color:"#2a4050" }}>No active loan</div>}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );

  // ── CLIENTS LIST ──────────────────────────────────────────────────────────
  const ClientsList = () => (
    <div>
      <div style={{ display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:20 }}>
        <div>
          <h1 style={{ margin:0,fontSize:22,fontWeight:800,color:"#e8f4fd" }}>{isAdmin?"All Clients":"My Clients"}</h1>
          <p style={{ margin:"4px 0 0",color:"#3a5a70",fontSize:12 }}>{isAdmin?"Full portfolio":"Only clients assigned to you"}</p>
        </div>
        <button onClick={()=>setShowAddClient(true)} style={{ background:"linear-gradient(135deg,#22c55e,#16a34a)",border:"none",color:"#000",padding:"9px 16px",borderRadius:11,cursor:"pointer",fontWeight:700,fontSize:13,display:"flex",alignItems:"center",gap:6 }}><Icon name="plus" size={13}/>New</button>
      </div>
      <div style={{ display:"flex",flexDirection:"column",gap:10,marginBottom:16 }}>
        <div style={{ position:"relative" }}><span style={{ position:"absolute",left:12,top:11,color:"#5a7a90" }}><Icon name="search" size={14}/></span><input type="text" style={{ ...inputStyle,paddingLeft:36 }} placeholder="Search clients..." value={clientSearch} onChange={e=>setClientSearch(e.target.value)}/></div>
        <div style={{ display:"flex",gap:6,overflowX:"auto",paddingBottom:4 }}>
          {[{id:"all",label:"All"},{id:"active",label:"Active"},{id:"completed",label:"Completed"},{id:"none",label:"No Loan"}].map(f=>(
            <button key={f.id} onClick={()=>setClientFilter(f.id)} style={{ background:clientFilter===f.id?"rgba(34,197,94,0.15)":"rgba(255,255,255,0.03)",border:clientFilter===f.id?"1px solid rgba(34,197,94,0.4)":"1px solid rgba(255,255,255,0.06)",color:clientFilter===f.id?"#4ade80":"#8ab4c8",padding:"6px 12px",borderRadius:8,fontSize:11,fontWeight:600,cursor:"pointer",whiteSpace:"nowrap" }}>{f.label}</button>
          ))}
        </div>
      </div>
      {filteredClients.length===0?(
        <div style={{ textAlign:"center",padding:60,color:"#2a4050",border:"1px dashed rgba(100,180,255,0.08)",borderRadius:14 }}><div style={{ fontSize:36,marginBottom:10 }}>👤</div><div>No clients found.</div></div>
      ):(
        <div style={{ display:"flex",flexDirection:"column",gap:9 }}>
          {filteredClients.map(c=>{
            const { active, overdue, paid, total } = getClientLoanSummary(c);
            return (
              <div key={c.id} onClick={()=>{ setSelectedClientId(c.id); setView("detail"); }} style={{ background:"rgba(255,255,255,0.025)",border:"1px solid rgba(100,180,255,0.07)",borderRadius:13,padding:"14px 16px",cursor:"pointer" }}>
                <div style={{ display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:active?10:0 }}>
                  <div style={{ display:"flex",gap:10,alignItems:"center" }}>
                    <div style={{ width:40,height:40,borderRadius:11,background:"linear-gradient(135deg,#1e3a5f,#2563eb)",display:"flex",alignItems:"center",justifyContent:"center",fontWeight:800,fontSize:16,color:"#93c5fd",flexShrink:0 }}>{c.name.charAt(0).toUpperCase()}</div>
                    <div>
                      <div style={{ fontWeight:700,color:"#dceef8",fontSize:14 }}>{c.name}</div>
                      <div style={{ fontSize:10,color:"#3a5a70",marginTop:1 }}>{c.id} · {c.loans?.length||0} cycle{c.loans?.length!==1?"s":""}{isAdmin&&c.assignedToName&&<span style={{ color:"#60a5fa" }}> · {c.assignedToName}</span>}</div>
                    </div>
                  </div>
                  <Badge color={active?"#4ade80":c.loans?.length>0?"#94a3b8":"#3a5a70"} bg={active?"rgba(34,197,94,0.12)":c.loans?.length>0?"rgba(148,163,184,0.1)":"rgba(100,130,150,0.08)"}>{active?"Active":c.loans?.length>0?"Done":"No Loan"}</Badge>
                </div>
                {active&&(<div><div style={{ display:"flex",justifyContent:"space-between",fontSize:11,color:"#3a5a70",marginBottom:5 }}><span>{paid}/{total} paid</span><span style={{ color:overdue>0?"#f87171":"#3a6050" }}>{overdue>0?`${overdue} overdue`:"On track ✓"}</span></div><div style={{ height:3,background:"rgba(255,255,255,0.06)",borderRadius:4,overflow:"hidden" }}><div style={{ height:"100%",width:`${(paid/total)*100}%`,background:"linear-gradient(90deg,#22c55e,#4ade80)",borderRadius:4 }}/></div></div>)}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );

  // ── LEDGER ────────────────────────────────────────────────────────────────
  const Ledger = () => (
    <div>
      <div style={{ marginBottom:22 }}><h1 style={{ margin:0,fontSize:22,fontWeight:800,color:"#e8f4fd" }}>Ledger Log</h1><p style={{ margin:"4px 0 0",color:"#3a5a70",fontSize:13 }}>{isAdmin?"All payments":"My clients' payments"} in chronological order</p></div>
      {globalTransactions.length===0?(
        <div style={{ textAlign:"center",padding:60,color:"#2a4050",border:"1px dashed rgba(100,180,255,0.08)",borderRadius:14 }}><div style={{ fontSize:36,marginBottom:10 }}>📝</div><div>No transactions yet.</div></div>
      ):(
        <div style={{ display:"flex",flexDirection:"column",gap:8 }}>
          {globalTransactions.map((tx,idx)=>(
            <div key={idx} style={{ background:"rgba(255,255,255,0.02)",border:`1px solid ${tx.overpayment>0?"rgba(167,139,250,0.15)":tx.shortfall>0?"rgba(239,68,68,0.15)":"rgba(100,180,255,0.05)"}`,borderRadius:12,padding:"12px 14px",display:"flex",justifyContent:"space-between",alignItems:"center" }}>
              <div><div style={{ fontWeight:700,color:"#e8f4fd",fontSize:13 }}>{tx.clientName}</div><div style={{ fontSize:10,color:"#3a5a70",marginTop:2 }}>Day {tx.day}/{tx.totalDays} · Paid {formatDate(tx.paidDate)}</div>{tx.overpayment>0&&<div style={{ fontSize:9,color:"#a78bfa",marginTop:1 }}>⚡ +{formatCurrency(tx.overpayment)} cascaded</div>}{tx.shortfall>0&&<div style={{ fontSize:9,color:"#f87171",marginTop:1 }}>⚠ -{formatCurrency(tx.shortfall)} shortfall</div>}</div>
              <div style={{ textAlign:"right" }}><div style={{ fontSize:13,color:tx.overpayment>0?"#a78bfa":tx.shortfall>0?"#f87171":"#4ade80",fontWeight:700,fontFamily:"'Courier New',monospace" }}>+{formatCurrency(tx.paidAmount)}</div><div style={{ fontSize:9,color:"#3a5a70",marginTop:2 }}>Due: {formatDate(tx.dueDate)}</div></div>
            </div>
          ))}
        </div>
      )}
    </div>
  );

  // ── ACCOUNTANT VIEW ───────────────────────────────────────────────────────
  const AccountantView = () => {
    const [selectedDay, setSelectedDay] = useState(null);
    const [dateFilter, setDateFilter] = useState("today");
    const todayStr = today.toISOString().split("T")[0];
    const filteredDays = useMemo(() => {
      if (dateFilter==="today") return dailyCollectionData.filter(d=>d.date===todayStr);
      if (dateFilter==="week") { const w=new Date(today); w.setDate(w.getDate()-7); return dailyCollectionData.filter(d=>new Date(d.date)>=w); }
      if (dateFilter==="month") { const m=new Date(today); m.setDate(m.getDate()-30); return dailyCollectionData.filter(d=>new Date(d.date)>=m); }
      return dailyCollectionData;
    }, [dateFilter, todayStr]);
    const totals = useMemo(() => filteredDays.reduce((acc,d)=>({ expected:acc.expected+d.expected, collected:acc.collected+d.collected }),{ expected:0, collected:0 }), [filteredDays]);
    const todayData = dailyCollectionData.find(d=>d.date===todayStr);
    return (
      <div>
        <div style={{ marginBottom:22 }}><h1 style={{ margin:0,fontSize:22,fontWeight:800,color:"#e8f4fd" }}>Accountant</h1><p style={{ margin:"4px 0 0",color:"#3a5a70",fontSize:13 }}>Daily collection schedule & performance</p></div>
        <div style={{ background:"linear-gradient(135deg,rgba(34,197,94,0.08),rgba(59,130,246,0.06))",border:"1px solid rgba(34,197,94,0.2)",borderRadius:16,padding:"16px 18px",marginBottom:16 }}>
          <div style={{ fontSize:11,color:"#4ade80",fontWeight:700,letterSpacing:1.2,textTransform:"uppercase",marginBottom:12,display:"flex",alignItems:"center",gap:6 }}><Icon name="calendar" size={13}/> Today — {formatDate(todayStr)}</div>
          {todayData?(
            <>
              <div style={{ display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:10,marginBottom:12 }}>
                {[["Expected",formatCurrency(todayData.expected),"#60a5fa"],["Collected",formatCurrency(todayData.collected),"#4ade80"],["Shortfall",formatCurrency(Math.max(0,todayData.expected-todayData.collected)),todayData.collected>=todayData.expected?"#4ade80":"#f87171"]].map(([l,v,c])=>(
                  <div key={l} style={{ background:"rgba(0,0,0,0.25)",borderRadius:10,padding:"10px 11px" }}><div style={{ fontSize:9,color:"#3a5a70",marginBottom:4,textTransform:"uppercase" }}>{l}</div><div style={{ fontSize:12,fontWeight:800,color:c,fontFamily:"'Courier New',monospace" }}>{v}</div></div>
                ))}
              </div>
              <div>
                <div style={{ display:"flex",justifyContent:"space-between",fontSize:10,color:"#3a5a70",marginBottom:5 }}><span>{todayData.installments.filter(i=>i.paid).length}/{todayData.installments.length} clients paid</span><span style={{ color:todayData.collected>=todayData.expected?"#4ade80":"#f59e0b" }}>{todayData.expected>0?((todayData.collected/todayData.expected)*100).toFixed(1):0}% collected</span></div>
                <div style={{ height:6,background:"rgba(255,255,255,0.06)",borderRadius:4,overflow:"hidden" }}><div style={{ height:"100%",width:`${todayData.expected>0?Math.min((todayData.collected/todayData.expected)*100,100):0}%`,background:"linear-gradient(90deg,#22c55e,#4ade80)",borderRadius:4,transition:"width 0.6s" }}/></div>
              </div>
            </>
          ):<div style={{ textAlign:"center",color:"#2a4050",fontSize:13,padding:"10px 0" }}>No collections scheduled for today.</div>}
        </div>
        <div style={{ background:"rgba(255,255,255,0.02)",border:"1px solid rgba(100,180,255,0.07)",borderRadius:14,padding:"14px 16px",marginBottom:16 }}>
          <div style={{ fontSize:11,color:"#5a7a90",fontWeight:700,letterSpacing:1,textTransform:"uppercase",marginBottom:12 }}>Period Summary</div>
          <div style={{ display:"grid",gridTemplateColumns:"1fr 1fr",gap:10,marginBottom:10 }}>
            {[["Total Expected","#60a5fa","rgba(96,165,250,0.06)","rgba(96,165,250,0.12)",formatCurrency(totals.expected)],["Total Collected","#4ade80","rgba(34,197,94,0.06)","rgba(34,197,94,0.12)",formatCurrency(totals.collected)],["Outstanding","#f87171","rgba(239,68,68,0.05)","rgba(239,68,68,0.1)",formatCurrency(Math.max(0,totals.expected-totals.collected))],["Collection Rate","#f59e0b","rgba(245,158,11,0.05)","rgba(245,158,11,0.1)",`${totals.expected>0?((totals.collected/totals.expected)*100).toFixed(1):0}%`]].map(([l,c,bg,border,v])=>(
              <div key={l} style={{ background:bg,borderRadius:10,padding:"11px 13px",border:`1px solid ${border}` }}><div style={{ fontSize:9,color:"#3a5a70",marginBottom:4,textTransform:"uppercase" }}>{l}</div><div style={{ fontSize:14,fontWeight:800,color:c,fontFamily:"'Courier New',monospace" }}>{v}</div></div>
            ))}
          </div>
          <div><div style={{ display:"flex",justifyContent:"space-between",fontSize:10,color:"#3a5a70",marginBottom:5 }}><span>Overall collection progress</span><span style={{ color:"#f59e0b",fontWeight:700 }}>{totals.expected>0?((totals.collected/totals.expected)*100).toFixed(1):0}%</span></div><div style={{ height:5,background:"rgba(255,255,255,0.06)",borderRadius:4,overflow:"hidden" }}><div style={{ height:"100%",width:`${totals.expected>0?Math.min((totals.collected/totals.expected)*100,100):0}%`,background:"linear-gradient(90deg,#f59e0b,#fbbf24)",borderRadius:4,transition:"width 0.6s" }}/></div></div>
        </div>
        <div style={{ display:"flex",gap:6,marginBottom:16,overflowX:"auto",paddingBottom:4 }}>
          {[{id:"today",label:"Today"},{id:"week",label:"This Week"},{id:"month",label:"30 Days"},{id:"all",label:"All Time"}].map(f=>(
            <button key={f.id} onClick={()=>setDateFilter(f.id)} style={{ background:dateFilter===f.id?"rgba(34,197,94,0.15)":"rgba(255,255,255,0.03)",border:dateFilter===f.id?"1px solid rgba(34,197,94,0.4)":"1px solid rgba(255,255,255,0.06)",color:dateFilter===f.id?"#4ade80":"#8ab4c8",padding:"6px 14px",borderRadius:8,fontSize:11,fontWeight:600,cursor:"pointer",whiteSpace:"nowrap" }}>{f.label}</button>
          ))}
        </div>
        {filteredDays.length===0?(
          <div style={{ textAlign:"center",padding:60,color:"#2a4050",border:"1px dashed rgba(100,180,255,0.08)",borderRadius:14 }}><div style={{ fontSize:36,marginBottom:10 }}>📅</div><div>No data for this period.</div></div>
        ):(
          <div style={{ display:"flex",flexDirection:"column",gap:10 }}>
            {filteredDays.map(day=>{
              const isToday=day.date===todayStr, isPast=new Date(day.date)<today&&!isToday, isFuture=new Date(day.date)>today;
              const rate=day.expected>0?(day.collected/day.expected)*100:0;
              const fullPaid=rate>=100, partialPaid=rate>0&&rate<100, noPaid=rate===0;
              const isOpen=selectedDay===day.date;
              let borderColor="rgba(100,180,255,0.08)", accentColor="#60a5fa";
              if(isToday){borderColor="rgba(34,197,94,0.25)";accentColor="#22c55e";}
              else if(isFuture){borderColor="rgba(96,165,250,0.1)";accentColor="#60a5fa";}
              else if(fullPaid){borderColor="rgba(34,197,94,0.2)";accentColor="#22c55e";}
              else if(partialPaid){borderColor="rgba(245,158,11,0.2)";accentColor="#f59e0b";}
              else if(noPaid&&isPast){borderColor="rgba(239,68,68,0.2)";accentColor="#ef4444";}
              return (
                <div key={day.date} style={{ background:isToday?"linear-gradient(135deg,rgba(34,197,94,0.05),rgba(59,130,246,0.03))":"rgba(255,255,255,0.02)",border:`1px solid ${borderColor}`,borderRadius:14,overflow:"hidden" }}>
                  <div onClick={()=>setSelectedDay(isOpen?null:day.date)} style={{ padding:"13px 15px",cursor:"pointer" }}>
                    <div style={{ display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:10 }}>
                      <div style={{ display:"flex",alignItems:"center",gap:9 }}>
                        <div style={{ width:10,height:10,borderRadius:"50%",flexShrink:0,background:accentColor,boxShadow:isToday?`0 0 8px ${accentColor}`:"none" }}/>
                        <div>
                          <div style={{ fontSize:13,fontWeight:700,color:"#e8f4fd",display:"flex",alignItems:"center",gap:6,flexWrap:"wrap" }}>{formatDate(day.date)}{isToday&&<Badge color="#4ade80" bg="rgba(34,197,94,0.15)">TODAY</Badge>}{isFuture&&<Badge color="#60a5fa" bg="rgba(96,165,250,0.1)">UPCOMING</Badge>}</div>
                          <div style={{ fontSize:10,color:"#3a5a70",marginTop:2 }}>{day.installments.length} client{day.installments.length!==1?"s":""} · {day.installments.filter(i=>i.paid).length} paid</div>
                        </div>
                      </div>
                      <div style={{ display:"flex",alignItems:"center",gap:8 }}>
                        <div style={{ textAlign:"right" }}><div style={{ fontSize:13,fontWeight:800,color:accentColor,fontFamily:"'Courier New',monospace" }}>{formatCurrency(day.collected)}</div><div style={{ fontSize:10,color:"#3a5a70" }}>of {formatCurrency(day.expected)}</div></div>
                        <div style={{ color:"#3a5a70" }}>{isOpen?<Icon name="chevronUp" size={14}/>:<Icon name="chevronDown" size={14}/>}</div>
                      </div>
                    </div>
                    <div>
                      <div style={{ display:"flex",justifyContent:"space-between",fontSize:9,color:"#3a5a70",marginBottom:4 }}><span>{fullPaid?"✓ Fully Collected":partialPaid?"Partial":isPast?"⚠ Not Collected":"Pending"}</span><span style={{ color:accentColor,fontWeight:700 }}>{rate.toFixed(1)}%</span></div>
                      <div style={{ height:5,background:"rgba(255,255,255,0.06)",borderRadius:4,overflow:"hidden" }}><div style={{ height:"100%",width:`${Math.min(rate,100)}%`,background:`linear-gradient(90deg,${accentColor},${accentColor}99)`,borderRadius:4,transition:"width 0.5s" }}/></div>
                    </div>
                  </div>
                  {isOpen&&(
                    <div style={{ borderTop:"1px solid rgba(255,255,255,0.05)",padding:"12px 15px" }}>
                      <div style={{ display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:8,marginBottom:12 }}>
                        {[["Expected",formatCurrency(day.expected),"#60a5fa"],["Collected",formatCurrency(day.collected),"#4ade80"],["Balance",formatCurrency(Math.max(0,day.expected-day.collected)),day.collected>=day.expected?"#4ade80":"#f87171"]].map(([l,v,c])=>(
                          <div key={l} style={{ background:"rgba(0,0,0,0.2)",borderRadius:9,padding:"9px 10px" }}><div style={{ fontSize:8,color:"#3a5a70",marginBottom:3,textTransform:"uppercase" }}>{l}</div><div style={{ fontSize:11,fontWeight:700,color:c,fontFamily:"'Courier New',monospace" }}>{v}</div></div>
                        ))}
                      </div>
                      <div style={{ display:"flex",flexDirection:"column",gap:7 }}>
                        {day.installments.sort((a,b)=>a.paid===b.paid?0:a.paid?1:-1).map((inst,idx)=>{
                          const isLate=inst.paid&&inst.paidDate>inst.dueDate, isShortfall=!inst.paid&&inst.paidAmount>0;
                          const statusColor=inst.paid?(isLate?"#f59e0b":"#4ade80"):isShortfall?"#f87171":isPast?"#f87171":"#8ab4c8";
                          return (
                            <div key={idx} onClick={()=>{ setSelectedClientId(inst.clientId); setView("detail"); setSelectedDay(null); }} style={{ background:inst.paid?"rgba(34,197,94,0.04)":isShortfall?"rgba(239,68,68,0.06)":"rgba(255,255,255,0.02)",border:`1px solid ${inst.paid?"rgba(34,197,94,0.15)":isShortfall?"rgba(239,68,68,0.2)":"rgba(255,255,255,0.04)"}`,borderRadius:10,padding:"10px 12px",display:"flex",justifyContent:"space-between",alignItems:"center",cursor:"pointer" }}>
                              <div style={{ display:"flex",alignItems:"center",gap:8 }}>
                                <div style={{ width:26,height:26,borderRadius:7,flexShrink:0,display:"flex",alignItems:"center",justifyContent:"center",background:inst.paid?"rgba(34,197,94,0.15)":"rgba(255,255,255,0.05)",color:statusColor,fontSize:11 }}>{inst.paid?<Icon name="check" size={11}/>:`${inst.day}`}</div>
                                <div>
                                  <div style={{ fontSize:12,fontWeight:700,color:"#dceef8" }}>{inst.clientName}</div>
                                  <div style={{ fontSize:9,color:"#3a5a70",marginTop:1 }}>Day {inst.day}/{inst.totalDays}{inst.paid&&inst.paidDate&&` · Paid ${formatDate(inst.paidDate)}`}{isLate&&" ⚠ Late"}</div>
                                  {isShortfall&&<div style={{ fontSize:9,color:"#f87171",marginTop:1 }}>Partial: {formatCurrency(inst.paidAmount)} paid</div>}
                                  {inst.overpayment>0&&<div style={{ fontSize:9,color:"#a78bfa",marginTop:1 }}>⚡ +{formatCurrency(inst.overpayment)} cascaded</div>}
                                </div>
                              </div>
                              <div style={{ textAlign:"right" }}>
                                <div style={{ fontSize:12,fontWeight:700,color:statusColor,fontFamily:"'Courier New',monospace" }}>{formatCurrency(inst.paid?inst.paidAmount:inst.payment)}</div>
                                <div style={{ fontSize:9,color:"#3a5a70",marginTop:2 }}>{inst.paid?"Received":"Expected"}</div>
                                {!inst.paid&&inst.paidAmount===0&&<div style={{ marginTop:3 }}><Badge color={isPast?"#f87171":"#8ab4c8"} bg={isPast?"rgba(239,68,68,0.1)":"rgba(255,255,255,0.05)"}>{isPast?"UNPAID":"DUE"}</Badge></div>}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    );
  };

  // ── REPORTS VIEW ──────────────────────────────────────────────────────────
  const ReportsView = () => {
    const [reportTab, setReportTab] = useState("portfolio");
    const [searchClient, setSearchClient] = useState("");
    const [previewContent, setPreviewContent] = useState(null);
    const [previewTitle, setPreviewTitle] = useState("");

    const source = isAdmin ? clients : visibleClients;
    const filteredForReport = source.filter(c =>
      c.name.toLowerCase().includes(searchClient.toLowerCase()) ||
      c.id.toLowerCase().includes(searchClient.toLowerCase())
    );

    const handlePortfolioReport = () => {
      const content = generatePortfolioReport(source, users);
      setPreviewTitle("Portfolio Performance Report");
      setPreviewContent(content);
    };

    const handleClientReport = (client) => {
      const content = generateClientReport(client);
      setPreviewTitle(`Client Report — ${client.name}`);
      setPreviewContent(content);
    };

    const handleDownload = () => {
      if (!previewContent) return;
      const filename = previewTitle.toLowerCase().replace(/\s+/g, "_").replace(/[^a-z0-9_]/g, "") + "_" + new Date().toISOString().split("T")[0] + ".txt";
      downloadReport(previewContent, filename);
    };

    // Compute quick stats per client for the report list
    const getClientReportStats = (c) => {
      let collected = 0, onTime = 0, late = 0, overdue = 0;
      (c.loans || []).forEach(l => {
        (l.schedule || []).forEach(s => {
          if (s.paidAmount > 0) collected += s.paidAmount;
          if (s.paid && s.paidDate <= s.dueDate) onTime++;
          if (s.paid && s.paidDate > s.dueDate) late++;
          if (!s.paid && new Date(s.dueDate) < today) overdue++;
        });
      });
      const total = onTime + late;
      const onTimeRate = total > 0 ? (onTime / total) * 100 : 0;
      const creditScore = Math.min(100, Math.round(onTimeRate * 0.5 + (c.loans?.length > 0 ? Math.min(c.loans.length * 5, 20) : 0)));
      const grade = creditScore >= 85 ? "A" : creditScore >= 70 ? "B" : creditScore >= 55 ? "C" : creditScore >= 40 ? "D" : "F";
      const gradeColor = creditScore >= 85 ? "#22c55e" : creditScore >= 70 ? "#4ade80" : creditScore >= 55 ? "#f59e0b" : creditScore >= 40 ? "#f97316" : "#ef4444";
      return { collected, onTimeRate, creditScore, grade, gradeColor, overdue };
    };

    return (
      <div>
        <div style={{ marginBottom:22 }}>
          <h1 style={{ margin:0,fontSize:22,fontWeight:800,color:"#e8f4fd" }}>Performance Reports</h1>
          <p style={{ margin:"4px 0 0",color:"#3a5a70",fontSize:13 }}>Extract individual & collective reports</p>
        </div>

        {/* Preview Modal */}
        {previewContent && (
          <div style={{ position:"fixed",inset:0,background:"rgba(0,0,0,0.95)",zIndex:2000,display:"flex",flexDirection:"column",padding:0 }}>
            {/* Preview Header */}
            <div style={{ background:"#0d1b2a",borderBottom:"1px solid rgba(100,180,255,0.1)",padding:"14px 18px",display:"flex",justifyContent:"space-between",alignItems:"center",flexShrink:0 }}>
              <div>
                <div style={{ fontSize:14,fontWeight:700,color:"#e8f4fd" }}>{previewTitle}</div>
                <div style={{ fontSize:10,color:"#3a5a70",marginTop:2 }}>Preview — ready to download</div>
              </div>
              <div style={{ display:"flex",gap:8 }}>
                <button onClick={handleDownload} style={{ background:"linear-gradient(135deg,#22c55e,#16a34a)",border:"none",color:"#000",padding:"8px 16px",borderRadius:9,cursor:"pointer",fontWeight:700,fontSize:12,display:"flex",alignItems:"center",gap:6 }}>
                  <Icon name="download" size={13}/>Download
                </button>
                <button onClick={()=>setPreviewContent(null)} style={{ background:"rgba(255,255,255,0.06)",border:"1px solid rgba(255,255,255,0.1)",color:"#8ab4c8",padding:"8px 14px",borderRadius:9,cursor:"pointer",fontWeight:600,fontSize:12 }}>✕ Close</button>
              </div>
            </div>
            {/* Preview Content */}
            <div style={{ flex:1,overflowY:"auto",padding:20 }}>
              <pre style={{ fontFamily:"'Courier New',Courier,monospace",fontSize:11,color:"#c8dde8",lineHeight:1.7,whiteSpace:"pre-wrap",wordBreak:"break-word",margin:0 }}>{previewContent}</pre>
            </div>
          </div>
        )}

        {/* Tab Switcher */}
        <div style={{ display:"flex",gap:3,marginBottom:20,background:"rgba(255,255,255,0.03)",borderRadius:12,padding:4 }}>
          {[{id:"portfolio",label:"📊 Portfolio Report"},{id:"individual",label:"👤 Individual Reports"}].map(t=>(
            <button key={t.id} onClick={()=>setReportTab(t.id)} style={{ flex:1,padding:"9px 4px",borderRadius:9,border:"none",cursor:"pointer",background:reportTab===t.id?"rgba(100,180,255,0.12)":"transparent",color:reportTab===t.id?"#93c5fd":"#3a5a70",fontWeight:700,fontSize:12 }}>{t.label}</button>
          ))}
        </div>

        {/* ── PORTFOLIO REPORT TAB ────────────────────────────── */}
        {reportTab === "portfolio" && (
          <div>
            {/* Portfolio Overview Cards */}
            <div style={{ display:"grid",gridTemplateColumns:"1fr 1fr",gap:10,marginBottom:20 }}>
              {(()=>{
                const src = isAdmin ? clients : visibleClients;
                let diss=0, col=0, pOT=0, pL=0, ov=0;
                src.forEach(c=>(c.loans||[]).forEach(l=>{diss+=l.principal||0;(l.schedule||[]).forEach(s=>{if(s.paidAmount>0)col+=s.paidAmount;if(s.paid&&s.paidDate<=s.dueDate)pOT++;if(s.paid&&s.paidDate>s.dueDate)pL++;if(!s.paid&&new Date(s.dueDate)<today)ov++;});}));
                const totalPaid=pOT+pL;
                return [
                  ["Total Clients", src.length, "#60a5fa", "#3b82f6"],
                  ["Total Loans", src.reduce((a,c)=>a+(c.loans?.length||0),0), "#4ade80", "#22c55e"],
                  ["On-Time Rate", `${totalPaid>0?((pOT/totalPaid)*100).toFixed(1):0}%`, "#a78bfa", "#a855f7"],
                  ["Overdue", ov+" inst.", "#f87171", "#ef4444"],
                ].map(([l,v,c,acc])=>(
                  <StatCard key={l} label={l} value={v} accent={acc}/>
                ));
              })()}
            </div>

            {/* Generate Button */}
            <div style={{ background:"linear-gradient(135deg,rgba(59,130,246,0.08),rgba(34,197,94,0.05))",border:"1px solid rgba(59,130,246,0.2)",borderRadius:16,padding:"20px",marginBottom:20,textAlign:"center" }}>
              <div style={{ fontSize:32,marginBottom:10 }}>📊</div>
              <div style={{ fontSize:15,fontWeight:700,color:"#e8f4fd",marginBottom:6 }}>Full Portfolio Report</div>
              <div style={{ fontSize:12,color:"#3a5a70",marginBottom:16,lineHeight:1.6 }}>
                Includes: financial summary, officer breakdown, monthly trends, repayment behaviour, and full client listing.
              </div>
              <button onClick={handlePortfolioReport} style={{ background:"linear-gradient(135deg,#3b82f6,#2563eb)",border:"none",color:"#fff",padding:"12px 28px",borderRadius:12,cursor:"pointer",fontWeight:800,fontSize:14,display:"inline-flex",alignItems:"center",gap:8 }}>
                <Icon name="report" size={15}/>Generate & Preview Report
              </button>
            </div>

            {/* Officer Leaderboard */}
            {isAdmin && (()=>{
              const officers = {};
              clients.forEach(c=>{
                const key=c.assignedTo||"unassigned";
                if(!officers[key]) officers[key]={name:c.assignedToName||"Unassigned",clients:0,disbursed:0,collected:0,onTime:0,late:0};
                officers[key].clients++;
                (c.loans||[]).forEach(l=>{
                  officers[key].disbursed+=l.principal||0;
                  (l.schedule||[]).forEach(s=>{
                    if(s.paidAmount>0) officers[key].collected+=s.paidAmount;
                    if(s.paid&&s.paidDate<=s.dueDate) officers[key].onTime++;
                    if(s.paid&&s.paidDate>s.dueDate) officers[key].late++;
                  });
                });
              });
              const sorted=Object.values(officers).sort((a,b)=>b.collected-a.collected);
              if(sorted.length===0) return null;
              return (
                <div style={{ background:"rgba(255,255,255,0.02)",border:"1px solid rgba(100,180,255,0.07)",borderRadius:14,padding:16,marginBottom:20 }}>
                  <div style={{ fontSize:13,fontWeight:700,color:"#93c5fd",marginBottom:14,textTransform:"uppercase",letterSpacing:0.8 }}>🏆 Officer Leaderboard</div>
                  <div style={{ display:"flex",flexDirection:"column",gap:10 }}>
                    {sorted.map((o,idx)=>{
                      const totalPaid=o.onTime+o.late;
                      const onTimeRate=totalPaid>0?(o.onTime/totalPaid)*100:0;
                      const medals=["🥇","🥈","🥉"];
                      return (
                        <div key={o.name} style={{ background:"rgba(0,0,0,0.2)",borderRadius:12,padding:"12px 14px" }}>
                          <div style={{ display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:8 }}>
                            <div style={{ display:"flex",alignItems:"center",gap:8 }}>
                              <span style={{ fontSize:18 }}>{medals[idx]||`#${idx+1}`}</span>
                              <div><div style={{ fontSize:13,fontWeight:700,color:"#e8f4fd" }}>{o.name}</div><div style={{ fontSize:10,color:"#3a5a70",marginTop:1 }}>{o.clients} client{o.clients!==1?"s":""}</div></div>
                            </div>
                            <div style={{ textAlign:"right" }}><div style={{ fontSize:13,fontWeight:800,color:"#4ade80",fontFamily:"'Courier New',monospace" }}>{formatCurrency(o.collected)}</div><div style={{ fontSize:9,color:"#3a5a70" }}>collected</div></div>
                          </div>
                          <div style={{ display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:6 }}>
                            {[["Disbursed",formatCurrency(o.disbursed),"#60a5fa"],["On-Time",`${onTimeRate.toFixed(0)}%`,"#4ade80"],["Late",o.late,"#f59e0b"]].map(([l,v,c])=>(
                              <div key={l} style={{ background:"rgba(255,255,255,0.03)",borderRadius:8,padding:"7px 9px" }}><div style={{ fontSize:8,color:"#3a5a70",marginBottom:2 }}>{l}</div><div style={{ fontSize:11,fontWeight:700,color:c,fontFamily:"'Courier New',monospace" }}>{v}</div></div>
                            ))}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })()}
          </div>
        )}

        {/* ── INDIVIDUAL REPORTS TAB ─────────────────────────── */}
        {reportTab === "individual" && (
          <div>
            <div style={{ position:"relative",marginBottom:16 }}>
              <span style={{ position:"absolute",left:12,top:11,color:"#5a7a90" }}><Icon name="search" size={14}/></span>
              <input type="text" style={{ ...inputStyle,paddingLeft:36 }} placeholder="Search client name or ID..." value={searchClient} onChange={e=>setSearchClient(e.target.value)}/>
            </div>

            <div style={{ fontSize:11,color:"#3a5a70",marginBottom:12,letterSpacing:0.5 }}>{filteredForReport.length} client{filteredForReport.length!==1?"s":""} · tap to generate report</div>

            {filteredForReport.length===0?(
              <div style={{ textAlign:"center",padding:50,color:"#2a4050",border:"1px dashed rgba(100,180,255,0.08)",borderRadius:14 }}><div style={{ fontSize:36,marginBottom:10 }}>🔍</div><div>No clients found.</div></div>
            ):(
              <div style={{ display:"flex",flexDirection:"column",gap:10 }}>
                {filteredForReport.map(c=>{
                  const rStats = getClientReportStats(c);
                  const activeLoan = c.loans?.find(l=>l.status==="active");
                  return (
                    <div key={c.id} style={{ background:"rgba(255,255,255,0.025)",border:"1px solid rgba(100,180,255,0.08)",borderRadius:14,padding:"14px 16px" }}>
                      {/* Client Header */}
                      <div style={{ display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:12 }}>
                        <div style={{ display:"flex",alignItems:"center",gap:10 }}>
                          <div style={{ width:42,height:42,borderRadius:12,background:"linear-gradient(135deg,#1e3a5f,#2563eb)",display:"flex",alignItems:"center",justifyContent:"center",fontWeight:800,fontSize:17,color:"#93c5fd",flexShrink:0 }}>{c.name.charAt(0).toUpperCase()}</div>
                          <div>
                            <div style={{ fontSize:14,fontWeight:700,color:"#dceef8" }}>{c.name}</div>
                            <div style={{ fontSize:10,color:"#3a5a70",marginTop:1 }}>{c.id} · {c.loans?.length||0} loan cycle{c.loans?.length!==1?"s":""}</div>
                            {isAdmin&&c.assignedToName&&<div style={{ fontSize:10,color:"#60a5fa",marginTop:1 }}>Officer: {c.assignedToName}</div>}
                          </div>
                        </div>
                        {/* Credit Grade Badge */}
                        <div style={{ textAlign:"center" }}>
                          <div style={{ width:36,height:36,borderRadius:10,background:`${rStats.gradeColor}20`,border:`2px solid ${rStats.gradeColor}50`,display:"flex",alignItems:"center",justifyContent:"center",fontWeight:900,fontSize:16,color:rStats.gradeColor }}>{rStats.grade}</div>
                          <div style={{ fontSize:8,color:"#3a5a70",marginTop:3 }}>CREDIT</div>
                        </div>
                      </div>

                      {/* Quick Stats */}
                      <div style={{ display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:7,marginBottom:12 }}>
                        {[
                          ["Collected",formatCurrency(rStats.collected),"#4ade80"],
                          ["On-Time",`${rStats.onTimeRate.toFixed(0)}%`,"#60a5fa"],
                          ["Overdue",rStats.overdue+" inst",rStats.overdue>0?"#f87171":"#4ade80"],
                        ].map(([l,v,c])=>(
                          <div key={l} style={{ background:"rgba(0,0,0,0.2)",borderRadius:9,padding:"8px 10px" }}>
                            <div style={{ fontSize:8,color:"#3a5a70",marginBottom:3,textTransform:"uppercase" }}>{l}</div>
                            <div style={{ fontSize:11,fontWeight:700,color:c,fontFamily:"'Courier New',monospace" }}>{v}</div>
                          </div>
                        ))}
                      </div>

                      {/* Credit Score Bar */}
                      <div style={{ marginBottom:12 }}>
                        <div style={{ display:"flex",justifyContent:"space-between",fontSize:9,color:"#3a5a70",marginBottom:4 }}>
                          <span>Credit Score</span>
                          <span style={{ color:rStats.gradeColor,fontWeight:700 }}>{rStats.creditScore}/100</span>
                        </div>
                        <div style={{ height:4,background:"rgba(255,255,255,0.06)",borderRadius:4,overflow:"hidden" }}>
                          <div style={{ height:"100%",width:`${rStats.creditScore}%`,background:rStats.gradeColor,borderRadius:4 }}/>
                        </div>
                      </div>

                      {/* Active loan info */}
                      {activeLoan && (
                        <div style={{ background:"rgba(34,197,94,0.05)",border:"1px solid rgba(34,197,94,0.12)",borderRadius:9,padding:"8px 11px",marginBottom:12,display:"flex",justifyContent:"space-between",alignItems:"center" }}>
                          <div><div style={{ fontSize:10,color:"#4ade80",fontWeight:700 }}>ACTIVE LOAN</div><div style={{ fontSize:9,color:"#3a5a70",marginTop:1 }}>{activeLoan.schedule?.filter(s=>s.paid).length||0}/{activeLoan.days} paid</div></div>
                          <div style={{ fontSize:12,fontWeight:800,color:"#4ade80",fontFamily:"'Courier New',monospace" }}>{formatCurrency(activeLoan.principal)}</div>
                        </div>
                      )}

                      {/* Generate Button */}
                      <button onClick={()=>handleClientReport(c)} style={{ width:"100%",background:"linear-gradient(135deg,rgba(59,130,246,0.15),rgba(59,130,246,0.08))",border:"1px solid rgba(59,130,246,0.25)",color:"#60a5fa",padding:"10px",borderRadius:10,cursor:"pointer",fontWeight:700,fontSize:12,display:"flex",alignItems:"center",justifyContent:"center",gap:7 }}>
                        <Icon name="report" size={13}/>Generate Full Report for {c.name.split(" ")[0]}
                      </button>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}
      </div>
    );
  };

  // ── DETAIL ────────────────────────────────────────────────────────────────
  const Detail = () => {
    if (!selectedClient) return null;
    const c = selectedClient;
    const activeLoan = c.loans?.find(l => l.status === "active");
    const allLoans = [...(c.loans||[])].reverse();
    const clientFin = useMemo(() => computeClientFinancials(c), [c.id]);
    const myPendingForClient = pendingLoans.filter(p => p.clientId === c.id);
    const canIssueLoan = isAdmin;
    const canRequestLoan = !isAdmin && !activeLoan && myPendingForClient.length === 0;

    const handleQuickReport = () => {
      const content = generateClientReport(c);
      downloadReport(content, `report_${c.name.replace(/\s+/g,"_")}_${new Date().toISOString().split("T")[0]}.txt`);
    };

    return (
      <div>
        <div style={{ display:"flex",alignItems:"center",gap:12,marginBottom:20 }}>
          <button onClick={()=>setView("clients")} style={{ background:"rgba(255,255,255,0.06)",border:"none",color:"#8ab4c8",width:34,height:34,borderRadius:9,cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center" }}><Icon name="back" size={15}/></button>
          <div style={{ width:44,height:44,borderRadius:12,background:"linear-gradient(135deg,#1d4ed8,#3b82f6)",display:"flex",alignItems:"center",justifyContent:"center",fontWeight:800,fontSize:18,color:"#fff",flexShrink:0 }}>{c.name.charAt(0).toUpperCase()}</div>
          <div style={{ flexGrow:1 }}>
            <div style={{ fontSize:18,fontWeight:800,color:"#e8f4fd" }}>{c.name}</div>
            <div style={{ fontSize:11,color:"#3a5a70" }}>{c.id} · {allLoans.length} cycle{allLoans.length!==1?"s":""}{c.assignedToName&&<span style={{ color:"#60a5fa" }}> · {c.assignedToName}</span>}</div>
          </div>
          <div style={{ display:"flex",gap:6 }}>
            <button onClick={handleQuickReport} style={{ background:"rgba(59,130,246,0.1)",border:"1px solid rgba(59,130,246,0.2)",color:"#60a5fa",width:32,height:32,borderRadius:8,cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center" }} title="Download Report"><Icon name="download" size={14}/></button>
            <button onClick={()=>setShowEditClient(c)} style={{ background:"rgba(255,255,255,0.04)",border:"1px solid rgba(255,255,255,0.08)",color:"#3b82f6",width:32,height:32,borderRadius:8,cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center" }}><Icon name="edit" size={14}/></button>
          </div>
        </div>

        <div style={{ background:"rgba(100,180,255,0.04)",border:"1px solid rgba(100,180,255,0.08)",borderRadius:13,padding:"14px 16px",marginBottom:16,display:"grid",gridTemplateColumns:"1fr 1fr",gap:10 }}>
          <div><div style={{ fontSize:10,color:"#3a5a70",marginBottom:3 }}>PHONE</div><div style={{ color:"#c8dde8",fontSize:13 }}>{c.phone||"—"}</div></div>
          <div><div style={{ fontSize:10,color:"#3a5a70",marginBottom:3 }}>ID/BVN</div><div style={{ color:"#c8dde8",fontSize:13 }}>{c.idNumber||"—"}</div></div>
          <div><div style={{ fontSize:10,color:"#3a5a70",marginBottom:3 }}>SAVINGS</div><div style={{ color:"#c084fc",fontSize:13,fontWeight:700 }}>{formatCurrency(c.savingsBalance||0)}</div></div>
          <div><div style={{ fontSize:10,color:"#3a5a70",marginBottom:3 }}>OFFICER</div><div style={{ color:"#60a5fa",fontSize:13 }}>{c.assignedToName||"—"}</div></div>
          <div style={{ gridColumn:"1/-1" }}><div style={{ fontSize:10,color:"#3a5a70",marginBottom:3 }}>ADDRESS</div><div style={{ color:"#c8dde8",fontSize:13 }}>{c.address||"—"}</div></div>
        </div>

        {isAdmin && (
          <button onClick={()=>setShowAssignClient(c)} style={{ width:"100%",marginBottom:12,background:"rgba(96,165,250,0.06)",border:"1px solid rgba(96,165,250,0.15)",color:"#60a5fa",padding:"8px",borderRadius:9,cursor:"pointer",fontWeight:600,fontSize:12,display:"flex",alignItems:"center",justifyContent:"center",gap:6 }}>
            <Icon name="users" size={13}/>Reassign to Different Officer
          </button>
        )}

        <FinancialPanel fin={clientFin} isClient={true}/>

        {myPendingForClient.length > 0 && (
          <div style={{ background:"rgba(96,165,250,0.08)",border:"1px solid rgba(96,165,250,0.2)",borderRadius:12,padding:"12px 14px",marginBottom:14 }}>
            <div style={{ fontSize:13,fontWeight:700,color:"#60a5fa",marginBottom:4 }}>⏳ Loan Request Pending Admin Approval</div>
            {myPendingForClient.map(p=>(<div key={p.id} style={{ fontSize:11,color:"#3a5a70" }}>{formatCurrency(p.loanData.principal)} · {p.loanData.days} days · Submitted {formatDate(p.requestedAt?.split("T")[0])}</div>))}
          </div>
        )}

        <div style={{ display:"flex",gap:8,marginBottom:16 }}>
          {canIssueLoan && !activeLoan && (
            <button onClick={()=>setShowAddLoan(true)} style={{ flex:1,background:"linear-gradient(135deg,#22c55e,#16a34a)",border:"none",color:"#000",padding:"10px",borderRadius:10,cursor:"pointer",fontWeight:700,fontSize:13,display:"flex",alignItems:"center",justifyContent:"center",gap:6 }}><Icon name="plus" size={13}/>Issue Loan</button>
          )}
          {canRequestLoan && (
            <button onClick={()=>setShowAddLoan(true)} style={{ flex:1,background:"rgba(96,165,250,0.12)",border:"1px solid rgba(96,165,250,0.25)",color:"#60a5fa",padding:"10px",borderRadius:10,cursor:"pointer",fontWeight:700,fontSize:13,display:"flex",alignItems:"center",justifyContent:"center",gap:6 }}><Icon name="plus" size={13}/>Request Loan</button>
          )}
          <button onClick={()=>setShowSavingsTx({type:"deposit",client:c})} style={{ flex:1,background:"rgba(168,85,247,0.12)",border:"1px solid rgba(168,85,247,0.25)",color:"#c084fc",padding:"10px",borderRadius:10,cursor:"pointer",fontWeight:700,fontSize:13 }}>📥 Savings</button>
        </div>

        <div style={{ display:"flex",gap:3,marginBottom:16,background:"rgba(255,255,255,0.03)",borderRadius:10,padding:3 }}>
          {[{id:"loans",label:`Cycles (${allLoans.length})`},{id:"savings",label:"Savings"}].map(tab=>(
            <button key={tab.id} onClick={()=>setActiveTab(tab.id)} style={{ flex:1,padding:"8px 4px",borderRadius:8,border:"none",cursor:"pointer",background:activeTab===tab.id?"rgba(100,180,255,0.1)":"transparent",color:activeTab===tab.id?(tab.id==="savings"?"#c084fc":"#93c5fd"):"#3a5a70",fontWeight:600,fontSize:12 }}>{tab.label}</button>
          ))}
        </div>

        {activeTab==="loans" && (
          <div>
            {allLoans.length===0?(
              <div style={{ border:"1px dashed rgba(100,180,255,0.08)",borderRadius:13,padding:40,textAlign:"center",color:"#2a4050" }}><div style={{ fontSize:32,marginBottom:10 }}>💰</div><div style={{ fontSize:13 }}>No loan cycles yet.</div></div>
            ):(
              <div>
                <div style={{ background:"rgba(59,130,246,0.06)",border:"1px solid rgba(59,130,246,0.12)",borderRadius:12,padding:"12px 14px",marginBottom:14,display:"flex",gap:16,overflowX:"auto" }}>
                  {[[allLoans.length,"TOTAL","#60a5fa"],[allLoans.filter(l=>l.status==="completed").length,"DONE","#22c55e"],[allLoans.filter(l=>l.status==="active").length,"ACTIVE","#f59e0b"],[formatCurrency(clientFin.trueProfit).replace("₦",""),"PROFIT","#a78bfa"]].map(([v,l,c])=>(
                    <div key={l} style={{ flexShrink:0,textAlign:"center",minWidth:55 }}><div style={{ fontSize:18,fontWeight:900,color:c }}>{v}</div><div style={{ fontSize:9,color:"#3a5a70",marginTop:2 }}>{l}</div></div>
                  ))}
                </div>
                {allLoans.map((loan,idx)=>(
                  <LoanCycleCard key={loan.id} loan={loan} cycleNumber={allLoans.length-idx} totalCycles={allLoans.length} isAdmin={isAdmin} today={today}
                    onPayment={(loan,scheduleIdx)=>{ setShowPayment({clientId:c.id,loanId:loan.id,scheduleIdx}); setPaymentAmount(loan.dailyPayment.toFixed(2)); setPaymentPreview(null); }}
                    onOverride={(loan,idx,s)=>{ setAdminEditInstallment({client:c,loan,idx}); setAdminInstOverride({paid:s.paid,paidAmount:s.paidAmount||loan.dailyPayment.toFixed(2),dueDate:s.dueDate,paidDate:s.paidDate||new Date().toISOString().split("T")[0]}); }}
                  />
                ))}
              </div>
            )}
          </div>
        )}

        {activeTab==="savings" && (
          <div>
            <div style={{ background:"rgba(168,85,247,0.05)",border:"1px solid rgba(168,85,247,0.15)",borderRadius:14,padding:16,display:"flex",flexDirection:"column",gap:14,marginBottom:16 }}>
              <div style={{ textAlign:"center" }}><div style={{ fontSize:10,color:"#a855f7",fontWeight:700,letterSpacing:1 }}>SAVINGS BALANCE</div><div style={{ fontSize:28,fontWeight:800,color:"#c084fc",fontFamily:"'Courier New',monospace",marginTop:6 }}>{formatCurrency(c.savingsBalance||0)}</div></div>
              <div style={{ display:"grid",gridTemplateColumns:"1fr 1fr",gap:10 }}>
                <button onClick={()=>setShowSavingsTx({type:"deposit",client:c})} style={{ background:"#a855f7",border:"none",color:"#fff",fontWeight:700,padding:"10px",borderRadius:10,cursor:"pointer",fontSize:13 }}>📥 Deposit</button>
                <button onClick={()=>setShowSavingsTx({type:"withdraw",client:c})} style={{ background:"transparent",border:"1px solid #a855f7",color:"#c084fc",fontWeight:700,padding:"10px",borderRadius:10,cursor:"pointer",fontSize:13 }}>📤 Withdraw</button>
              </div>
            </div>
            {(!c.savingsLogs||c.savingsLogs.length===0)?(
              <div style={{ textAlign:"center",padding:20,color:"#2a4050",fontSize:12,border:"1px dashed rgba(168,85,247,0.08)",borderRadius:10 }}>No savings history yet.</div>
            ):(
              <div style={{ display:"flex",flexDirection:"column",gap:6 }}>
                {c.savingsLogs.map((log,idx)=>(
                  <div key={idx} style={{ background:"rgba(255,255,255,0.01)",border:"1px solid rgba(168,85,247,0.08)",borderRadius:10,padding:"10px 12px",display:"flex",justifyContent:"space-between",alignItems:"center" }}>
                    <div><div style={{ fontSize:12,fontWeight:600,color:log.type==="deposit"?"#4ade80":log.type==="withdraw"?"#f87171":"#c084fc" }}>{log.type==="deposit"?"Deposit":log.type==="withdraw"?"Withdrawal":"Admin Override"}</div><div style={{ fontSize:9,color:"#3a5a70",marginTop:2 }}>{formatDate(log.date)}{log.recordedBy&&` · by ${log.recordedBy}`}</div></div>
                    <div style={{ textAlign:"right" }}><div style={{ fontSize:12,fontWeight:700,color:"#e8f4fd",fontFamily:"'Courier New',monospace" }}>{log.type==="deposit"?"+":"-"}{formatCurrency(log.amount)}</div><div style={{ fontSize:9,color:"#3a5a70",marginTop:2 }}>Bal: {formatCurrency(log.balanceAfter)}</div></div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {isAdmin && (
          <button onClick={()=>setConfirmDelete(c.id)} style={{ marginTop:22,background:"rgba(239,68,68,0.08)",border:"1px solid rgba(239,68,68,0.15)",color:"#f87171",padding:"9px 18px",borderRadius:10,cursor:"pointer",fontWeight:600,fontSize:12,display:"flex",alignItems:"center",gap:7 }}><Icon name="trash" size={13
