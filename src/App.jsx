import { useState, useEffect, useMemo, useCallback } from "react";
import { initializeApp } from "firebase/app";
import { getFirestore, doc, setDoc, onSnapshot } from "firebase/firestore";

// ─── FIREBASE SETUP ───────────────────────────────────────────────────────────
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

// ─── NIGERIAN PUBLIC HOLIDAYS ─────────────────────────────────────────────────
const FIXED_HOLIDAYS = ["01-01","05-01","06-12","10-01","12-25","12-26"];
const VARIABLE_HOLIDAYS = new Set([
  "2024-03-29","2024-04-01","2024-04-09","2024-04-10","2024-06-16","2024-06-17",
  "2025-04-18","2025-04-21","2025-03-30","2025-03-31","2025-06-06","2025-06-07",
  "2026-04-03","2026-04-06","2026-03-20","2026-03-21","2026-05-27","2026-05-28",
]);
function isHoliday(d) { return FIXED_HOLIDAYS.includes(d.slice(5)) || VARIABLE_HOLIDAYS.has(d); }

// ─── UTILS ────────────────────────────────────────────────────────────────────
const generateId = (p = "ID") => p + Date.now().toString().slice(-6) + Math.floor(Math.random() * 100);
const formatCurrency = (a) => "₦" + Number(a || 0).toLocaleString("en-NG", { minimumFractionDigits: 2 });
const formatDate = (d) => d ? new Date(d).toLocaleDateString("en-NG", { day: "2-digit", month: "short", year: "numeric" }) : "—";
const formatMonth = (ym) => { if (!ym) return "—"; const [y, m] = ym.split("-"); return new Date(y, parseInt(m) - 1, 1).toLocaleDateString("en-NG", { month: "long", year: "numeric" }); };
const todayStr = new Date().toISOString().split("T")[0];
const currentMonthKey = todayStr.slice(0, 7); // "2026-04" format

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

// ─── FINANCIAL ENGINES ────────────────────────────────────────────────────────
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
  return { capital, expectedInterest, interestEarned, principalCollected, outstandingPrincipal: Math.max(0, capital - principalCollected), trueProfit: interestEarned, realROI: capital > 0 ? (interestEarned / capital) * 100 : 0, totalCollected };
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
  return { collected, interestEarned, principalCollected, outstandingPrincipal: Math.max(0, principal - principalCollected), trueProfit: interestEarned, realROI: principal > 0 ? (interestEarned / principal) * 100 : 0, collectionRate: totalDue > 0 ? (collected / totalDue) * 100 : 0, completionRate: (paidCount / totalCount) * 100, paidCount, totalCount, overdueCount, onTimeCount, lateCount, partialCount };
}

// ─── MONTHLY STATS FOR STAFF ──────────────────────────────────────────────────
function computeMonthlyStats(clientsList, monthKey) {
  let totalDisbursed = 0, totalExpected = 0, totalCollected = 0, overdueCount = 0;
  const today = new Date();
  clientsList.forEach(c => {
    (c.loans || []).forEach(l => {
      // Only count loans issued this month
      const loanMonth = (l.issuedAt || l.startDate || "").slice(0, 7);
      if (loanMonth === monthKey) {
        totalDisbursed += l.principal || 0;
      }
      // Collections & overdue for current month schedule entries
      (l.schedule || []).forEach(s => {
        const dueMonth = (s.dueDate || "").slice(0, 7);
        if (dueMonth === monthKey) {
          totalExpected += s.payment || 0;
          if (s.paidAmount > 0) totalCollected += s.paidAmount;
          else if (new Date(s.dueDate) < today) overdueCount++;
        }
      });
    });
  });
  const totalSavings = clientsList.reduce((a, c) => a + (c.savingsBalance || 0), 0);
  return { totalDisbursed, totalExpected, totalCollected, outstanding: totalExpected - totalCollected, overdueCount, totalSavings };
}

// ─── DEFAULT USERS ────────────────────────────────────────────────────────────
const DEFAULT_USERS = [
  { id: "admin_001", username: "Yebaba", password: "Go5win619$", role: "admin", name: "Admin", createdAt: "2026-04-21", active: true }
];

// ─── ICONS ────────────────────────────────────────────────────────────────────
const Icon = ({ name, size = 16 }) => {
  const icons = {
    plus: <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>,
    user: <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><circle cx="12" cy="8" r="4"/><path d="M4 20c0-4 3.6-7 8-7s8 3 8 7"/></svg>,
    users: <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>,
    check: <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><polyline points="20 6 9 17 4 12"/></svg>,
    back: <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><polyline points="15 18 9 12 15 6"/></svg>,
    dashboard: <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/></svg>,
    trash: <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6"/><path d="M10 11v6M14 11v6M9 6V4h6v2"/></svg>,
    edit: <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 113 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>,
    ledger: <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>,
    search: <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>,
    lock: <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>,
    unlock: <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 9.9-1"/></svg>,
    trend: <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><polyline points="23 6 13.5 15.5 8.5 10.5 1 18"/><polyline points="17 6 23 6 23 12"/></svg>,
    shield: <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>,
    chevronDown: <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><polyline points="6 9 12 15 18 9"/></svg>,
    chevronUp: <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><polyline points="18 15 12 9 6 15"/></svg>,
    calendar: <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>,
    lightning: <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>,
    bell: <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/></svg>,
    logout: <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg>,
    account: <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><rect x="2" y="3" width="20" height="14" rx="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/></svg>,
    key: <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M21 2l-2 2m-7.61 7.61a5.5 5.5 0 1 1-7.778 7.778 5.5 5.5 0 0 1 7.777-7.777zm0 0L15.5 7.5m0 0l3 3L22 7l-3-3m-3.5 3.5L19 4"/></svg>,
    cloud: <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M18 10h-1.26A8 8 0 109 20h9a5 5 0 000-10z"/></svg>,
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
  return <div style={{ marginBottom:14 }}><label style={{ display:"block",fontSize:11,color:"#5a7a90",marginBottom:5,letterSpacing:0.8,textTransform:"uppercase" }}>{label}</label>{children}</div>;
}

const inputStyle = { width:"100%",padding:"10px 13px",background:"rgba(100,180,255,0.05)",border:"1px solid rgba(100,180,255,0.15)",borderRadius:10,color:"#e8f4fd",fontSize:14,outline:"none",boxSizing:"border-box",fontFamily:"inherit" };

function StatCard({ label, value, accent, sub }) {
  return (
    <div style={{ background:"rgba(255,255,255,0.03)",border:"1px solid rgba(255,255,255,0.06)",borderRadius:14,padding:"16px 18px",borderTop:`2px solid ${accent}` }}>
      <div style={{ fontSize:10,color:"#4a6880",letterSpacing:1.2,textTransform:"uppercase",marginBottom:7 }}>{label}</div>
      <div style={{ fontSize:19,fontWeight:800,color:"#e8f4fd",fontFamily:"'Courier New',monospace" }}>{value}</div>
      {sub && <div style={{ fontSize:10,color:"#3a5060",marginTop:3 }}>{sub}</div>}
    </div>
  );
}

function Badge({ color, bg, children }) {
  return <span style={{ fontSize:10,padding:"2px 9px",borderRadius:20,background:bg,color,fontWeight:700 }}>{children}</span>;
}

function RoleBadge({ role }) {
  return role === "admin" ? <Badge color="#f59e0b" bg="rgba(245,158,11,0.15)">👑 ADMIN</Badge> : <Badge color="#60a5fa" bg="rgba(96,165,250,0.15)">🏦 OFFICER</Badge>;
}

function Toast({ msg, type }) {
  if (!msg) return null;
  return <div style={{ position:"fixed",top:70,left:"50%",transform:"translateX(-50%)",background:type==="error"?"rgba(248,113,113,0.15)":"rgba(34,197,94,0.15)",border:`1px solid ${type==="error"?"rgba(248,113,113,0.3)":"rgba(34,197,94,0.3)"}`,color:type==="error"?"#f87171":"#4ade80",padding:"10px 20px",borderRadius:12,zIndex:9999,fontWeight:700,fontSize:13,backdropFilter:"blur(8px)",whiteSpace:"nowrap" }}>{msg}</div>;
}

function FinanceMetricRow({ label, value, valueColor = "#e8f4fd", icon, sub }) {
  return (
    <div style={{ display:"flex",justifyContent:"space-between",alignItems:"center",padding:"10px 14px",background:"rgba(255,255,255,0.02)",borderRadius:10,border:"1px solid rgba(255,255,255,0.04)" }}>
      <div style={{ display:"flex",alignItems:"center",gap:8 }}>{icon&&<span style={{ color:valueColor,opacity:0.8 }}>{icon}</span>}<div><div style={{ fontSize:11,color:"#5a7a90",letterSpacing:0.6 }}>{label}</div>{sub&&<div style={{ fontSize:9,color:"#3a4a58",marginTop:1 }}>{sub}</div>}</div></div>
      <div style={{ fontSize:14,fontWeight:800,color:valueColor,fontFamily:"'Courier New',monospace" }}>{value}</div>
    </div>
  );
}

function ROIGauge({ roi }) {
  const capped = Math.min(Math.max(roi, 0), 100);
  const color = roi >= 20 ? "#22c55e" : roi >= 10 ? "#f59e0b" : "#ef4444";
  return (
    <div style={{ marginTop:4 }}>
      <div style={{ display:"flex",justifyContent:"space-between",marginBottom:5 }}><span style={{ fontSize:10,color:"#5a7a90" }}>ROI Performance</span><span style={{ fontSize:12,fontWeight:800,color,fontFamily:"'Courier New',monospace" }}>{roi.toFixed(2)}%</span></div>
      <div style={{ height:6,background:"rgba(255,255,255,0.06)",borderRadius:4,overflow:"hidden" }}><div style={{ height:"100%",width:`${capped}%`,background:`linear-gradient(90deg,${color},${color}cc)`,borderRadius:4 }}/></div>
    </div>
  );
}

// ─── FINANCIAL PANEL (ADMIN ONLY) ─────────────────────────────────────────────
function FinancialPanel({ fin, isClient = false, expandFinancials, setExpandFinancials }) {
  const roiColor = fin.realROI >= 20 ? "#22c55e" : fin.realROI >= 10 ? "#f59e0b" : "#ef4444";
  return (
    <div style={{ background:"linear-gradient(135deg,rgba(16,30,50,0.9),rgba(10,20,40,0.95))",border:"1px solid rgba(100,180,255,0.1)",borderRadius:16,overflow:"hidden",marginBottom:20 }}>
      <div style={{ background:"linear-gradient(135deg,rgba(59,130,246,0.12),rgba(34,197,94,0.08))",padding:"14px 16px",borderBottom:"1px solid rgba(100,180,255,0.08)",display:"flex",justifyContent:"space-between",alignItems:"center" }}>
        <div style={{ display:"flex",alignItems:"center",gap:8 }}>
          <Icon name="trend" size={16}/>
          <div><div style={{ fontSize:13,fontWeight:800,color:"#e8f4fd" }}>{isClient?"Client Intelligence":"Portfolio Intelligence"}</div><div style={{ fontSize:10,color:"#3a5a70",marginTop:1 }}>{isClient?"Per-client capital & return":"Real-time portfolio metrics"}</div></div>
        </div>
        {!isClient&&setExpandFinancials&&<button onClick={()=>setExpandFinancials(!expandFinancials)} style={{ background:"rgba(100,180,255,0.08)",border:"none",borderRadius:8,color:"#60a5fa",padding:"5px 12px",fontSize:11,cursor:"pointer",fontWeight:600 }}>{expandFinancials?"Collapse":"Expand"}</button>}
      </div>
      {(isClient||expandFinancials)&&(
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
              <div style={{ background:`${roiColor}20`,border:`1px solid ${roiColor}40`,borderRadius:8,padding:"4px 10px" }}><span style={{ fontSize:16,fontWeight:900,color:roiColor,fontFamily:"'Courier New',monospace" }}>{fin.realROI.toFixed(2)}%</span></div>
            </div>
            <ROIGauge roi={fin.realROI}/>
          </div>
          {!isClient&&<div style={{ display:"flex",justifyContent:"space-between",alignItems:"center",padding:"10px 14px",background:"rgba(255,255,255,0.02)",borderRadius:10,border:"1px solid rgba(255,255,255,0.04)" }}>
            <div><div style={{ fontSize:11,color:"#5a7a90" }}>Collection Rate</div></div>
            <div><div style={{ fontSize:14,fontWeight:800,color:"#f59e0b",fontFamily:"'Courier New',monospace" }}>{fin.collectionRate.toFixed(1)}%</div><div style={{ width:80,height:4,background:"rgba(255,255,255,0.06)",borderRadius:4,marginTop:4,overflow:"hidden" }}><div style={{ height:"100%",width:`${Math.min(fin.collectionRate,100)}%`,background:"#f59e0b",borderRadius:4 }}/></div></div>
          </div>}
          <div style={{ display:"grid",gridTemplateColumns:"1fr 1fr",gap:8 }}>
            <div style={{ padding:"10px 12px",background:"rgba(96,165,250,0.06)",borderRadius:10,border:"1px solid rgba(96,165,250,0.12)" }}><div style={{ fontSize:9,color:"#3a5a70",marginBottom:4 }}>PRINCIPAL RECOVERED</div><div style={{ fontSize:12,fontWeight:700,color:"#60a5fa",fontFamily:"'Courier New',monospace" }}>{formatCurrency(fin.principalCollected)}</div></div>
            <div style={{ padding:"10px 12px",background:"rgba(248,113,113,0.05)",borderRadius:10,border:"1px solid rgba(248,113,113,0.1)" }}><div style={{ fontSize:9,color:"#3a5a70",marginBottom:4 }}>CAPITAL AT RISK</div><div style={{ fontSize:12,fontWeight:700,color:"#f87171",fontFamily:"'Courier New',monospace" }}>{formatCurrency(fin.outstandingPrincipal)}</div></div>
          </div>
        </div>
      )}
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
          {s.paid?<Icon name="check" size={11}/>:`${i+1}`}
        </div>
        <div>
          <div style={{ display:"flex",alignItems:"center",gap:5,marginBottom:3,flexWrap:"wrap" }}>
            <span style={{ fontSize:12,fontWeight:700,color:s.paid?"#4ade80":isShortfall?"#f87171":isOverdue?"#f87171":"#c8dde8",fontFamily:"'Courier New',monospace" }}>{formatCurrency(s.paid?s.paidAmount:s.payment)}</span>
            {isNext&&<Badge color="#60a5fa" bg="rgba(96,165,250,0.12)">NEXT</Badge>}
            {isOverdue&&!isShortfall&&<Badge color="#f87171" bg="rgba(239,68,68,0.1)">OVERDUE</Badge>}
            {isLate&&<Badge color="#f59e0b" bg="rgba(245,158,11,0.1)">LATE</Badge>}
            {isShortfall&&<Badge color="#f87171" bg="rgba(239,68,68,0.15)">SHORTFALL</Badge>}
            {hasOver&&<Badge color="#a78bfa" bg="rgba(167,139,250,0.12)">OVERPAID</Badge>}
          </div>
          {isShortfall&&<div style={{ fontSize:9,color:"#f87171",marginBottom:2 }}>Paid {formatCurrency(s.paidAmount)} · Needs {formatCurrency(s.payment-s.paidAmount)} more</div>}
          {hasOver&&<div style={{ fontSize:9,color:"#a78bfa",marginBottom:2 }}>+{formatCurrency(s.overpayment)} cascaded forward</div>}
          <div style={{ fontSize:9,color:"#3a5a70" }}>Due {formatDate(s.dueDate)}{s.paidDate&&` · Paid ${formatDate(s.paidDate)}`}</div>
        </div>
      </div>
      <div style={{ display:"flex",alignItems:"center",gap:6,flexShrink:0 }}>
        <div style={{ textAlign:"right" }}><div style={{ fontSize:8,color:"#3a5a70" }}>BAL</div><div style={{ fontSize:10,color:"#8ab4c8",fontFamily:"'Courier New',monospace" }}>{formatCurrency(s.balance)}</div></div>
        {!s.paid&&isActive&&<button onClick={e=>{e.stopPropagation();onPayment(loan,i);}} style={{ background:"linear-gradient(135deg,#22c55e,#16a34a)",border:"none",color:"#000",padding:"5px 10px",borderRadius:6,cursor:"pointer",fontWeight:700,fontSize:10 }}>Pay</button>}
        {isAdmin&&<button onClick={e=>{e.stopPropagation();onOverride(loan,i,s);}} style={{ background:"rgba(245,158,11,0.1)",border:"1px solid rgba(245,158,11,0.3)",color:"#f59e0b",borderRadius:6,padding:"4px 7px",cursor:"pointer",fontSize:9 }}>Edit</button>}
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
            <div style={{ width:38,height:38,borderRadius:10,flexShrink:0,background:isActive?"linear-gradient(135deg,#16a34a,#22c55e)":"linear-gradient(135deg,#1d4ed8,#3b82f6)",display:"flex",alignItems:"center",justifyContent:"center",fontSize:13,fontWeight:800,color:"#fff" }}>{loan.status==="completed"?<Icon name="check" size={16}/>:`L${cycleNumber}`}</div>
            <div>
              <div style={{ display:"flex",alignItems:"center",gap:6,marginBottom:2 }}>
                <span style={{ fontSize:13,fontWeight:700,color:"#e8f4fd" }}>Cycle {cycleNumber}{cycleNumber===totalCycles&&isActive&&<span style={{ fontSize:10,color:"#22c55e",marginLeft:6 }}>(Current)</span>}</span>
                <Badge color={isActive?"#4ade80":"#60a5fa"} bg={isActive?"rgba(34,197,94,0.12)":"rgba(96,165,250,0.12)"}>{isActive?"ACTIVE":"DONE"}</Badge>
              </div>
              <div style={{ fontSize:10,color:"#3a5a70" }}>{formatDate(loan.startDate)} · {loan.days}d · {loan.interestRate}%</div>
            </div>
          </div>
          <div style={{ display:"flex",alignItems:"center",gap:8 }}>
            <div style={{ textAlign:"right" }}><div style={{ fontSize:13,fontWeight:800,color:"#60a5fa",fontFamily:"'Courier New',monospace" }}>{formatCurrency(loan.principal)}</div><div style={{ fontSize:9,color:"#3a5a70" }}>Principal</div></div>
            <div style={{ color:"#3a5a70" }}>{expanded?<Icon name="chevronUp" size={14}/>:<Icon name="chevronDown" size={14}/>}</div>
          </div>
        </div>
        <div style={{ marginTop:10 }}>
          <div style={{ display:"flex",justifyContent:"space-between",fontSize:9,color:"#3a5a70",marginBottom:4 }}><span>{fin.paidCount}/{fin.totalCount}</span><span style={{ color:perfColor }}>{fin.completionRate.toFixed(0)}%</span></div>
          <div style={{ height:4,background:"rgba(255,255,255,0.06)",borderRadius:4,overflow:"hidden" }}><div style={{ height:"100%",width:`${fin.completionRate}%`,background:`linear-gradient(90deg,${perfColor},${perfColor}99)`,borderRadius:4 }}/></div>
        </div>
        {(totalOverpaid>0||totalShortfall>0)&&<div style={{ display:"flex",gap:8,marginTop:8,flexWrap:"wrap" }}>
          {totalOverpaid>0&&<div style={{ background:"rgba(167,139,250,0.1)",border:"1px solid rgba(167,139,250,0.2)",borderRadius:6,padding:"3px 8px",fontSize:9,color:"#a78bfa" }}>⚡ {formatCurrency(totalOverpaid)} cascaded</div>}
          {totalShortfall>0&&<div style={{ background:"rgba(239,68,68,0.1)",border:"1px solid rgba(239,68,68,0.2)",borderRadius:6,padding:"3px 8px",fontSize:9,color:"#f87171" }}>⚠ {formatCurrency(totalShortfall)} shortfall</div>}
        </div>}
      </div>
      {expanded&&(
        <div style={{ padding:"14px 16px" }}>
          <div style={{ display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:8,marginBottom:14 }}>
            {[["Principal",formatCurrency(loan.principal),"#93c5fd"],["Interest",`${loan.interestRate}%`,"#c4b5fd"],["Daily",formatCurrency(loan.dailyPayment),"#60a5fa"],["Total Due",formatCurrency(loan.totalRepayable),"#e8f4fd"],["Collected",formatCurrency(fin.collected),"#4ade80"],["Outstanding",formatCurrency(Math.max(0,loan.totalRepayable-fin.collected)),fin.outstandingPrincipal>0?"#f87171":"#4ade80"]].map(([l,v,c])=>(
              <div key={l} style={{ background:"rgba(255,255,255,0.02)",borderRadius:9,padding:"9px 10px",border:"1px solid rgba(255,255,255,0.04)" }}><div style={{ fontSize:8,color:"#3a5a70",marginBottom:3,textTransform:"uppercase" }}>{l}</div><div style={{ fontSize:11,fontWeight:700,color:c,fontFamily:"'Courier New',monospace" }}>{v}</div></div>
            ))}
          </div>

          {/* Financial Intelligence — ADMIN ONLY */}
          {isAdmin&&<div style={{ background:"rgba(0,0,0,0.2)",borderRadius:12,padding:"12px 14px",marginBottom:14 }}>
            <div style={{ fontSize:11,color:"#5a7a90",fontWeight:700,letterSpacing:0.8,marginBottom:10,textTransform:"uppercase" }}>Financial Intelligence</div>
            {[["Interest Earned",formatCurrency(fin.interestEarned),"#a78bfa"],["True Profit",formatCurrency(fin.trueProfit),"#22c55e"],["Real ROI",`${fin.realROI.toFixed(2)}%`,roiColor],["Collection Rate",`${fin.collectionRate.toFixed(1)}%`,"#f59e0b"]].map(([l,v,c])=>(
              <div key={l} style={{ display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:6 }}><span style={{ fontSize:11,color:"#8ab4c8" }}>{l}</span><span style={{ fontSize:12,fontWeight:700,color:c,fontFamily:"'Courier New',monospace" }}>{v}</span></div>
            ))}
          </div>}

          <div style={{ display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:6,marginBottom:14 }}>
            {[["On Time",fin.onTimeCount,"#4ade80","rgba(34,197,94,0.06)","rgba(34,197,94,0.15)"],["Late",fin.lateCount,"#f59e0b","rgba(245,158,11,0.06)","rgba(245,158,11,0.15)"],["Partial",fin.partialCount,"#f87171","rgba(239,68,68,0.06)","rgba(239,68,68,0.15)"],["Overdue",fin.overdueCount,"#ef4444","rgba(239,68,68,0.08)","rgba(239,68,68,0.2)"]].map(([l,v,c,bg,border])=>(
              <div key={l} style={{ background:bg,border:`1px solid ${border}`,borderRadius:10,padding:"10px 8px",textAlign:"center" }}><div style={{ fontSize:16,fontWeight:800,color:c }}>{v}</div><div style={{ fontSize:9,color:"#5a7a90",marginTop:2 }}>{l}</div></div>
            ))}
          </div>
          <div style={{ background:`linear-gradient(135deg,${perfColor}10,${perfColor}05)`,border:`1px solid ${perfColor}30`,borderRadius:12,padding:"12px 14px",marginBottom:14,display:"flex",justifyContent:"space-between",alignItems:"center" }}>
            <div><div style={{ fontSize:11,color:perfColor,fontWeight:700,marginBottom:4 }}>PERFORMANCE</div><div style={{ display:"flex",gap:3 }}>{[1,2,3,4,5].map(s=><span key={s} style={{ color:s<=stars?"#f59e0b":"rgba(255,255,255,0.1)",fontSize:14 }}>★</span>)}</div></div>
            <div style={{ fontSize:22,fontWeight:900,color:perfColor,fontFamily:"'Courier New',monospace" }}>{fin.completionRate.toFixed(0)}%</div>
          </div>
          <button onClick={()=>setScheduleOpen(!scheduleOpen)} style={{ width:"100%",background:"rgba(100,180,255,0.06)",border:"1px solid rgba(100,180,255,0.12)",color:"#60a5fa",padding:"9px",borderRadius:10,cursor:"pointer",fontWeight:700,fontSize:12,display:"flex",alignItems:"center",justifyContent:"center",gap:6,marginBottom:scheduleOpen?10:0 }}><Icon name="calendar" size={13}/>{scheduleOpen?"Hide":"View"} Schedule {scheduleOpen?<Icon name="chevronUp" size={13}/>:<Icon name="chevronDown" size={13}/>}</button>
          {scheduleOpen&&<div style={{ display:"flex",flexDirection:"column",gap:6 }}>{loan.schedule?.map((s,i)=><InstallmentRow key={i} s={s} i={i} loan={loan} isActive={isActive} isAdmin={isAdmin} today={today} onPayment={onPayment} onOverride={onOverride}/>)}</div>}
        </div>
      )}
    </div>
  );
}

// ─── LOGIN ────────────────────────────────────────────────────────────────────
function LoginScreen({ users, onLogin }) {
  const [username, setUsername] = useState(""), [pwd, setPwd] = useState(""), [err, setErr] = useState(""), [show, setShow] = useState(false);
  const handleLogin = () => {
    const u = users.find(x => x.username === username.trim() && x.password === pwd.trim() && x.active);
    if (u) { setErr(""); onLogin(u); } else setErr("Invalid username or password.");
  };
  return (
    <div style={{ minHeight:"100vh",background:"#060f1a",display:"flex",alignItems:"center",justifyContent:"center",padding:20 }}>
      <div style={{ width:"100%",maxWidth:380 }}>
        <div style={{ textAlign:"center",marginBottom:32 }}>
          <div style={{ width:64,height:64,borderRadius:18,background:"linear-gradient(135deg,#0a5c36,#0d7a48)",border:"2px solid rgba(200,146,10,0.4)",display:"flex",alignItems:"center",justifyContent:"center",margin:"0 auto 16px" }}>
            <svg width="34" height="34" viewBox="0 0 80 80" fill="none"><path d="M48 22A19 19 0 1 0 48 58" stroke="white" strokeWidth="5.5" strokeLinecap="round" fill="none"/><path d="M42 30L53 20L64 30" stroke="#c8920a" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" fill="none"/><line x1="53" y1="20" x2="53" y2="44" stroke="#c8920a" strokeWidth="4" strokeLinecap="round"/></svg>
          </div>
          <div style={{ fontSize:28,fontWeight:900,color:"#e8f4fd",letterSpacing:2,fontFamily:"serif" }}>CREDA</div>
          <div style={{ fontSize:11,color:"rgba(200,146,10,0.8)",letterSpacing:3,textTransform:"uppercase",marginTop:4 }}>Finance Platform</div>
        </div>
        <div style={{ background:"#0d1b2a",border:"1px solid rgba(100,200,255,0.12)",borderRadius:20,padding:"28px 24px" }}>
          <Field label="Username"><input style={inputStyle} value={username} onChange={e=>setUsername(e.target.value)} onKeyDown={e=>e.key==="Enter"&&handleLogin()} placeholder="Enter username" autoFocus/></Field>
          <Field label="Password"><div style={{ position:"relative" }}><input type={show?"text":"password"} style={{ ...inputStyle,paddingRight:40 }} value={pwd} onChange={e=>setPwd(e.target.value)} onKeyDown={e=>e.key==="Enter"&&handleLogin()} placeholder="Enter password"/><button onClick={()=>setShow(s=>!s)} style={{ position:"absolute",right:10,top:"50%",transform:"translateY(-50%)",background:"none",border:"none",color:"#3a5a70",cursor:"pointer",fontSize:14 }}>{show?"🙈":"👁️"}</button></div></Field>
          {err&&<div style={{ background:"rgba(239,68,68,0.1)",border:"1px solid rgba(239,68,68,0.2)",borderRadius:8,padding:"10px 12px",fontSize:12,color:"#f87171",marginBottom:14 }}>{err}</div>}
          <button onClick={handleLogin} style={{ width:"100%",background:"linear-gradient(135deg,#22c55e,#16a34a)",border:"none",color:"#000",padding:"13px",borderRadius:12,cursor:"pointer",fontWeight:800,fontSize:15,marginTop:4 }}>Sign In →</button>
        </div>
      </div>
    </div>
  );
}

// ─── STAFF PANEL ──────────────────────────────────────────────────────────────
function StaffPanel({ users, clients, pendingLoans, currentUser, onUpdateUsers, onApproveLoan, onRejectLoan }) {
  const [showAdd, setShowAdd] = useState(false);
  const [ns, setNs] = useState({ name:"",username:"",password:"",role:"loan_officer" });
  const [editS, setEditS] = useState(null);
  const handleAdd = () => {
    if (!ns.name||!ns.username||!ns.password) return;
    if (users.find(u=>u.username.toLowerCase()===ns.username.toLowerCase())) { alert("Username exists."); return; }
    onUpdateUsers([...users,{ ...ns,id:generateId("USR"),createdAt:todayStr,active:true }]);
    setNs({ name:"",username:"",password:"",role:"loan_officer" }); setShowAdd(false);
  };
  const getStats = (id) => {
    const mc = clients.filter(c=>c.assignedTo===id);
    return { clients:mc.length, activeLoans:mc.reduce((a,c)=>a+(c.loans?.filter(l=>l.status==="active").length||0),0), collected:mc.reduce((a,c)=>a+(c.loans||[]).reduce((b,l)=>b+(l.schedule||[]).reduce((d,s)=>d+(s.paidAmount||0),0),0),0) };
  };
  return (
    <div>
      <div style={{ display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:20 }}>
        <div><h1 style={{ margin:0,fontSize:22,fontWeight:800,color:"#e8f4fd" }}>Staff</h1><p style={{ margin:"4px 0 0",color:"#3a5a70",fontSize:13 }}>{users.filter(u=>u.role==="loan_officer").length} officers</p></div>
        <button onClick={()=>setShowAdd(true)} style={{ background:"linear-gradient(135deg,#3b82f6,#2563eb)",border:"none",color:"#fff",padding:"9px 16px",borderRadius:11,cursor:"pointer",fontWeight:700,fontSize:13,display:"flex",alignItems:"center",gap:6 }}><Icon name="plus" size={13}/>Add</button>
      </div>
      {pendingLoans.length>0&&<div style={{ background:"rgba(245,158,11,0.06)",border:"1px solid rgba(245,158,11,0.2)",borderRadius:14,padding:16,marginBottom:20 }}>
        <div style={{ display:"flex",alignItems:"center",gap:8,marginBottom:12 }}><Icon name="bell" size={16}/><span style={{ fontSize:14,fontWeight:700,color:"#f59e0b" }}>Pending ({pendingLoans.length})</span></div>
        {pendingLoans.map(pl=>{
          const officer=users.find(u=>u.id===pl.requestedBy); const client=clients.find(c=>c.id===pl.clientId);
          return (<div key={pl.id} style={{ background:"rgba(0,0,0,0.2)",borderRadius:12,padding:"12px 14px",marginBottom:10 }}>
            <div style={{ display:"flex",justifyContent:"space-between",marginBottom:8 }}>
              <div><div style={{ fontSize:13,fontWeight:700,color:"#e8f4fd" }}>{client?.name||"Unknown"}</div><div style={{ fontSize:10,color:"#3a5a70" }}>By {officer?.name} · {formatDate(pl.requestedAt?.split("T")[0])}</div></div>
              <div style={{ textAlign:"right" }}><div style={{ fontSize:14,fontWeight:800,color:"#60a5fa",fontFamily:"'Courier New',monospace" }}>{formatCurrency(pl.loanData.principal)}</div><div style={{ fontSize:9,color:"#3a5a70" }}>{pl.loanData.interestRate}% · {pl.loanData.days}d</div></div>
            </div>
            <div style={{ display:"flex",gap:8 }}>
              <button onClick={()=>onApproveLoan(pl)} style={{ flex:1,background:"linear-gradient(135deg,#22c55e,#16a34a)",border:"none",color:"#000",padding:"9px",borderRadius:9,cursor:"pointer",fontWeight:700,fontSize:12 }}>✓ Approve</button>
              <button onClick={()=>onRejectLoan(pl.id)} style={{ flex:1,background:"rgba(239,68,68,0.1)",border:"1px solid rgba(239,68,68,0.2)",color:"#f87171",padding:"9px",borderRadius:9,cursor:"pointer",fontWeight:700,fontSize:12 }}>✕ Reject</button>
            </div>
          </div>);
        })}
      </div>}
      {users.filter(u=>u.role==="loan_officer").map(o=>{
        const st=getStats(o.id);
        return (<div key={o.id} style={{ background:"rgba(255,255,255,0.025)",border:`1px solid ${o.active?"rgba(100,180,255,0.1)":"rgba(255,255,255,0.04)"}`,borderRadius:14,padding:"14px 16px",marginBottom:10 }}>
          <div style={{ display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:12 }}>
            <div style={{ display:"flex",alignItems:"center",gap:10 }}>
              <div style={{ width:42,height:42,borderRadius:12,background:o.active?"linear-gradient(135deg,#1d4ed8,#3b82f6)":"rgba(255,255,255,0.06)",display:"flex",alignItems:"center",justifyContent:"center",fontWeight:800,fontSize:17,color:o.active?"#fff":"#3a5a70" }}>{o.name.charAt(0)}</div>
              <div><div style={{ fontSize:14,fontWeight:700,color:o.active?"#dceef8":"#3a5a70" }}>{o.name}</div><div style={{ fontSize:11,color:"#3a5a70" }}>@{o.username}</div><div style={{ marginTop:4 }}><RoleBadge role={o.role}/></div></div>
            </div>
            <div style={{ display:"flex",gap:6 }}>
              <button onClick={()=>setEditS(o)} style={{ background:"rgba(59,130,246,0.1)",border:"1px solid rgba(59,130,246,0.2)",color:"#60a5fa",width:30,height:30,borderRadius:8,cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center" }}><Icon name="edit" size={13}/></button>
              <button onClick={()=>onUpdateUsers(users.map(u=>u.id===o.id?{...u,active:!u.active}:u))} style={{ background:o.active?"rgba(239,68,68,0.08)":"rgba(34,197,94,0.08)",border:`1px solid ${o.active?"rgba(239,68,68,0.2)":"rgba(34,197,94,0.2)"}`,color:o.active?"#f87171":"#4ade80",width:30,height:30,borderRadius:8,cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center" }}>{o.active?<Icon name="lock" size={13}/>:<Icon name="unlock" size={13}/>}</button>
            </div>
          </div>
          <div style={{ display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:8 }}>
            {[["Clients",st.clients,"#60a5fa"],["Active",st.activeLoans,"#4ade80"],["Collected",formatCurrency(st.collected),"#a78bfa"]].map(([l,v,c])=>(<div key={l} style={{ background:"rgba(0,0,0,0.2)",borderRadius:9,padding:"9px 10px" }}><div style={{ fontSize:9,color:"#3a5a70",marginBottom:3 }}>{l}</div><div style={{ fontSize:11,fontWeight:700,color:c,fontFamily:"'Courier New',monospace" }}>{v}</div></div>))}
          </div>
        </div>);
      })}
      {showAdd&&<Modal title="Add Staff" onClose={()=>setShowAdd(false)}>
        <Field label="Name *"><input style={inputStyle} value={ns.name} onChange={e=>setNs(p=>({...p,name:e.target.value}))} autoFocus/></Field>
        <Field label="Username *"><input style={inputStyle} value={ns.username} onChange={e=>setNs(p=>({...p,username:e.target.value.toLowerCase().replace(/\s/g,"")}))} /></Field>
        <Field label="Password *"><input type="password" style={inputStyle} value={ns.password} onChange={e=>setNs(p=>({...p,password:e.target.value}))} /></Field>
        <button onClick={handleAdd} style={{ width:"100%",background:"linear-gradient(135deg,#3b82f6,#2563eb)",border:"none",color:"#fff",padding:"12px",borderRadius:12,cursor:"pointer",fontWeight:800,fontSize:14 }}>✓ Create</button>
      </Modal>}
      {editS&&<Modal title="Edit Staff" onClose={()=>setEditS(null)}>
        <Field label="Name"><input style={inputStyle} value={editS.name} onChange={e=>setEditS(p=>({...p,name:e.target.value}))}/></Field>
        <Field label="Username"><input style={inputStyle} value={editS.username} onChange={e=>setEditS(p=>({...p,username:e.target.value}))}/></Field>
        <Field label="New Password"><input type="password" style={inputStyle} placeholder="Leave blank to keep" onChange={e=>{if(e.target.value)setEditS(p=>({...p,password:e.target.value}));}}/></Field>
        <button onClick={()=>{onUpdateUsers(users.map(u=>u.id===editS.id?editS:u));setEditS(null);}} style={{ width:"100%",background:"linear-gradient(135deg,#3b82f6,#2563eb)",border:"none",color:"#fff",padding:"12px",borderRadius:12,cursor:"pointer",fontWeight:800,fontSize:14 }}>✓ Save</button>
      </Modal>}
    </div>
  );
}

// ─── MAIN APP ─────────────────────────────────────────────────────────────────
export default function App() {
  const [currentUser, setCurrentUser] = useState(null);
  const [clients, setClients] = useState([]);
  const [users, setUsers] = useState(DEFAULT_USERS);
  const [pendingLoans, setPendingLoans] = useState([]);
  const [loading, setLoading] = useState(true);
  const [sync, setSync] = useState("syncing");
  const [toast, setToast] = useState({ msg:"",type:"success" });
  const [adminMode, setAdminMode] = useState("admin");
  const [view, setView] = useState("dashboard");
  const [selectedClientId, setSelectedClientId] = useState(null);
  const [activeTab, setActiveTab] = useState("loans");

  // Modals
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
  const [showProfile, setShowProfile] = useState(false);
  const [profileEdit, setProfileEdit] = useState({ name:"",username:"",oldPassword:"",newPassword:"",confirmPassword:"" });
  const [clientSearch, setClientSearch] = useState("");
  const [clientFilter, setClientFilter] = useState("all");
  const [expandMonthlyHistory, setExpandMonthlyHistory] = useState(false);
  const [expandFinancials, setExpandFinancials] = useState(true);
  const [acctDateFilter, setAcctDateFilter] = useState("today");
  const [acctSelectedDay, setAcctSelectedDay] = useState(null);

  const [newClient, setNewClient] = useState({ name:"",phone:"",address:"",idNumber:"" });
  const [newLoan, setNewLoan] = useState({ principal:"",interestRate:"15",days:"30",startDate:todayStr,excludeWeekends:true });

  const showToast = useCallback((msg,type="success") => { setToast({msg,type}); setTimeout(()=>setToast({msg:"",type:"success"}),3000); },[]);

  const isAdmin = currentUser?.role === "admin";
  const today = new Date();

  useEffect(() => {
    // Force reset users with new credentials — REMOVE after first login
    fbSet("users", DEFAULT_USERS);
    const unsubs = [
      fbListen("clients", v => { setClients(v||[]); setSync("synced"); }),
      fbListen("users", v => setUsers(v||DEFAULT_USERS)),
      fbListen("pendingLoans", v => setPendingLoans(v||[])),
    ];
    setTimeout(() => setLoading(false), 1600);
    return () => unsubs.forEach(u => u());
  }, []);

  const saveClients = async (v) => { setClients(v); setSync("syncing"); await fbSet("clients",v); setSync("synced"); };
  const saveUsers = async (v) => { setUsers(v); await fbSet("users",v); };
  const savePending = async (v) => { setPendingLoans(v); await fbSet("pendingLoans",v); };

  const visibleClients = useMemo(() => isAdmin ? clients : clients.filter(c=>c.assignedTo===currentUser?.id), [clients,currentUser,isAdmin]);
  const selectedClient = visibleClients.find(c=>c.id===selectedClientId);
  const globalFin = useMemo(() => computeFinancials(isAdmin?clients:visibleClients), [clients,visibleClients,isAdmin]);

  const filteredClients = useMemo(() => visibleClients.filter(c => {
    const match = c.name.toLowerCase().includes(clientSearch.toLowerCase())||c.phone.includes(clientSearch)||c.id.toLowerCase().includes(clientSearch.toLowerCase());
    const active = c.loans?.find(l=>l.status==="active");
    const hasLoans = c.loans&&c.loans.length>0;
    if (clientFilter==="active") return match&&active;
    if (clientFilter==="completed") return match&&!active&&hasLoans;
    if (clientFilter==="none") return match&&!hasLoans;
    return match;
  }), [visibleClients,clientSearch,clientFilter]);

  // ── STATS: Admin = all-time, Staff = current month only ───────────────────
  const stats = useMemo(() => {
    const src = isAdmin ? clients : visibleClients;
    if (isAdmin) {
      // Admin sees ALL-TIME stats
      let totalDisbursed=0,totalExpected=0,totalCollected=0,overdueCount=0;
      src.forEach(c=>{(c.loans||[]).forEach(l=>{ totalDisbursed+=l.principal||0; totalExpected+=l.totalRepayable||0; (l.schedule||[]).forEach(s=>{ if(s.paidAmount>0)totalCollected+=s.paidAmount; else if(new Date(s.dueDate)<today)overdueCount++; }); });});
      const totalSavings=src.reduce((a,c)=>a+(c.savingsBalance||0),0);
      return { totalDisbursed,totalExpected,totalCollected,outstanding:totalExpected-totalCollected,overdueCount,totalSavings };
    } else {
      // Staff sees CURRENT MONTH only
      return computeMonthlyStats(src, currentMonthKey);
    }
  }, [clients,visibleClients,isAdmin]);

  const monthlyHistory = useMemo(() => {
    const src = isAdmin?clients:visibleClients;
    const map = {};
    src.forEach(c=>{(c.loans||[]).forEach(l=>{ const key=(l.issuedAt||l.startDate||new Date().toISOString()).slice(0,7); if(!map[key])map[key]={disbursed:0,expected:0,collected:0,interest:0}; map[key].disbursed+=l.principal||0; map[key].expected+=l.totalRepayable||0; map[key].interest+=l.totalInterest||0; (l.schedule||[]).forEach(s=>{ if(s.paidAmount>0)map[key].collected+=s.paidAmount; }); });});
    return Object.entries(map).map(([month,d])=>({month,...d,outstanding:Math.max(0,d.expected-d.collected)})).sort((a,b)=>b.month.localeCompare(a.month));
  }, [clients,visibleClients,isAdmin]);

  const globalTransactions = useMemo(() => {
    const src = isAdmin?clients:visibleClients;
    const tx = [];
    src.forEach(c=>{(c.loans||[]).forEach(l=>{(l.schedule||[]).forEach(s=>{ if(s.paidAmount>0)tx.push({clientId:c.id,clientName:c.name,loanId:l.id,day:s.day,totalDays:l.days,paidAmount:s.paidAmount,paidDate:s.paidDate,dueDate:s.dueDate,overpayment:s.overpayment||0,shortfall:s.shortfall||0}); });});});
    return tx.sort((a,b)=>new Date(b.paidDate)-new Date(a.paidDate));
  }, [clients,visibleClients,isAdmin]);

  const dailyCollectionData = useMemo(() => {
    const src = isAdmin?clients:visibleClients;
    const map = {};
    src.forEach(c=>{(c.loans||[]).forEach(l=>{(l.schedule||[]).forEach(s=>{ const due=s.dueDate; if(!due)return; if(!map[due])map[due]={date:due,expected:0,collected:0,installments:[]}; map[due].expected+=s.payment||0; map[due].collected+=s.paidAmount||0; map[due].installments.push({clientName:c.name,clientId:c.id,loanId:l.id,day:s.day,totalDays:l.days,payment:s.payment,paidAmount:s.paidAmount||0,paid:s.paid,paidDate:s.paidDate,dueDate:s.dueDate,overpayment:s.overpayment||0,shortfall:s.shortfall||0}); });});});
    return Object.values(map).sort((a,b)=>new Date(b.date)-new Date(a.date));
  }, [clients,visibleClients,isAdmin]);

  const computePaymentPreview = (loan,idx,amount) => {
    if (!amount||amount<=0) return null;
    const sim = applySmartPayment(loan.schedule,idx,amount,todayStr);
    const before=loan.schedule.filter(s=>s.paid).length;
    const after=sim.filter(s=>s.paid).length;
    return { daysCleared:after-before,isOver:amount>loan.dailyPayment,isUnder:amount>0&&amount<loan.dailyPayment,remainingBal:sim[sim.length-1]?.balance||0 };
  };

  const getClientLoanSummary = (c) => {
    const active=c.loans?.find(l=>l.status==="active");
    const overdue=active?.schedule?.filter(s=>!s.paid&&new Date(s.dueDate)<today).length||0;
    const paid=active?.schedule?.filter(s=>s.paid).length||0;
    const total=active?.schedule?.length||0;
    const balance=active?(active.schedule.find(s=>!s.paid)?.balance??0):0;
    return { active,overdue,paid,total,balance };
  };

  // ── ACTIONS ───────────────────────────────────────────────────────────────
  const handleAddClient = () => {
    if (!newClient.name.trim()||!newClient.phone.trim()) return;
    saveClients([{ ...newClient,id:generateId("CL"),loans:[],savingsBalance:0,savingsLogs:[],assignedTo:currentUser?.id,assignedToName:currentUser?.name,createdAt:todayStr },...clients]);
    setNewClient({ name:"",phone:"",address:"",idNumber:"" }); setShowAddClient(false); showToast("Client registered!");
  };
  const handleUpdateClient = () => { if(!showEditClient?.name.trim())return; saveClients(clients.map(c=>c.id===showEditClient.id?showEditClient:c)); setShowEditClient(null); showToast("Updated!"); };
  const handleAddLoan = () => {
    if(!newLoan.principal||!selectedClientId)return;
    const p=parseFloat(newLoan.principal),r=parseFloat(newLoan.interestRate),d=parseInt(newLoan.days);
    const {dailyPayment,totalRepayable,totalInterest,schedule}=calcLoanSchedule(p,r,d,newLoan.startDate,newLoan.excludeWeekends);
    const loan={id:generateId("LN"),principal:p,interestRate:r,days:d,startDate:newLoan.startDate,dailyPayment,totalRepayable,totalInterest,schedule,status:"active",issuedAt:new Date().toISOString(),excludeWeekends:newLoan.excludeWeekends,issuedBy:currentUser?.id,issuedByName:currentUser?.name};
    saveClients(clients.map(c=>c.id===selectedClientId?{...c,loans:[...(c.loans||[]),loan]}:c));
    setNewLoan({principal:"",interestRate:"15",days:"30",startDate:todayStr,excludeWeekends:true}); setShowAddLoan(false); showToast("Loan issued!");
  };
  const handleRequestLoan = () => {
    if(!newLoan.principal||!selectedClientId)return;
    const p=parseFloat(newLoan.principal),r=parseFloat(newLoan.interestRate),d=parseInt(newLoan.days);
    const {dailyPayment,totalRepayable,totalInterest,schedule}=calcLoanSchedule(p,r,d,newLoan.startDate,newLoan.excludeWeekends);
    savePending([...pendingLoans,{id:generateId("PL"),clientId:selectedClientId,requestedBy:currentUser?.id,requestedByName:currentUser?.name,requestedAt:new Date().toISOString(),loanData:{principal:p,interestRate:r,days:d,startDate:newLoan.startDate,dailyPayment,totalRepayable,totalInterest,schedule,excludeWeekends:newLoan.excludeWeekends}}]);
    setNewLoan({principal:"",interestRate:"15",days:"30",startDate:todayStr,excludeWeekends:true}); setShowAddLoan(false); showToast("Request submitted!");
  };
  const handleApproveLoan = (pl) => {
    const loan={id:generateId("LN"),...pl.loanData,status:"active",issuedAt:new Date().toISOString(),approvedBy:currentUser?.id,approvedByName:currentUser?.name};
    saveClients(clients.map(c=>c.id===pl.clientId?{...c,loans:[...(c.loans||[]),loan]}:c));
    savePending(pendingLoans.filter(p=>p.id!==pl.id)); showToast("Approved!");
  };
  const handleRejectLoan = (id) => { savePending(pendingLoans.filter(p=>p.id!==id)); showToast("Rejected","error"); };
  const handlePayment = () => {
    const amount=parseFloat(paymentAmount);
    if(!amount||amount<=0||!showPayment)return;
    const{clientId,loanId,scheduleIdx}=showPayment;
    saveClients(clients.map(c=>{
      if(c.id!==clientId)return c;
      return{...c,loans:c.loans.map(l=>{
        if(l.id!==loanId)return l;
        const ns=applySmartPayment(l.schedule,scheduleIdx,amount,todayStr);
        return{...l,schedule:ns,status:ns.every(s=>s.paid)?"completed":"active",lastPaymentBy:currentUser?.name};
      })};
    }));
    setPaymentAmount(""); setShowPayment(null); setPaymentPreview(null); showToast("Payment recorded!");
  };
  const handleSavingsTransaction = () => {
    const amount=parseFloat(savingsAmount);
    if(!amount||amount<=0||!showSavingsTx)return;
    const{type,client}=showSavingsTx;
    const updated=clients.map(c=>{
      if(c.id!==client.id)return c;
      const cur=c.savingsBalance||0;
      if(type==="withdraw"&&amount>cur){showToast("Insufficient!","error");return c;}
      const newBal=type==="deposit"?cur+amount:cur-amount;
      return{...c,savingsBalance:newBal,savingsLogs:[{id:generateId("TX"),date:todayStr,type,amount,balanceAfter:newBal,recordedBy:currentUser?.name},...(c.savingsLogs||[])]};
    });
    saveClients(updated); setSavingsAmount(""); setShowSavingsTx(null); showToast(`${type==="deposit"?"Deposit":"Withdrawal"} done!`);
  };
  const handleAdminSavingsAdjustment = () => {
    const newBal=parseFloat(adminDirectSavingsInput);
    if(isNaN(newBal)||!showSavingsTx)return;
    const{client}=showSavingsTx;
    saveClients(clients.map(c=>c.id!==client.id?c:{...c,savingsBalance:newBal,savingsLogs:[{id:generateId("TX"),date:todayStr,type:"admin_adjustment",amount:Math.abs(newBal-(c.savingsBalance||0)),balanceAfter:newBal,recordedBy:currentUser?.name},...(c.savingsLogs||[])]}));
    setAdminDirectSavingsInput(""); setShowSavingsTx(null); showToast("Balance adjusted!");
  };
  const handleAdminInstallmentOverride = () => {
    if(!adminEditInstallment)return;
    const{client,loan,idx}=adminEditInstallment;
    const pAmt=parseFloat(adminInstOverride.paidAmount)||0;
    saveClients(clients.map(c=>{
      if(c.id!==client.id)return c;
      return{...c,loans:c.loans.map(l=>{
        if(l.id!==loan.id)return l;
        const s=l.schedule.map((s,i)=>i===idx?{...s,paid:adminInstOverride.paid,dueDate:adminInstOverride.dueDate,paidDate:adminInstOverride.paid?(adminInstOverride.paidDate||todayStr):null,paidAmount:adminInstOverride.paid?pAmt:0,overpayment:adminInstOverride.paid&&pAmt>s.payment?pAmt-s.payment:0,shortfall:adminInstOverride.paid&&pAmt<s.payment?s.payment-pAmt:0}:s);
        let run=l.totalRepayable; const rc=s.map(s=>{if(s.paidAmount>0)run=Math.max(0,run-s.paidAmount);return{...s,balance:run};});
        return{...l,schedule:rc,status:rc.every(s=>s.paid)?"completed":"active"};
      })};
    }));
    setAdminEditInstallment(null); showToast("Override applied!");
  };
  const handleAssignClient = (clientId,staffId) => {
    const staff=users.find(u=>u.id===staffId);
    saveClients(clients.map(c=>c.id===clientId?{...c,assignedTo:staffId,assignedToName:staff?.name}:c));
    setShowAssignClient(null); showToast("Reassigned!");
  };
  const handleDeleteClient = (id) => { saveClients(clients.filter(c=>c.id!==id)); setConfirmDelete(null); setView("clients"); showToast("Deleted","error"); };
  const handleUpdateProfile = () => {
    if(!profileEdit.oldPassword){showToast("Enter current password","error");return;}
    if(profileEdit.oldPassword!==currentUser.password){showToast("Wrong password","error");return;}
    if(profileEdit.newPassword&&profileEdit.newPassword!==profileEdit.confirmPassword){showToast("Don't match","error");return;}
    if(profileEdit.newPassword&&profileEdit.newPassword.length<4){showToast("Min 4 chars","error");return;}
    if(profileEdit.username&&profileEdit.username!==currentUser.username&&users.find(u=>u.username===profileEdit.username&&u.id!==currentUser.id)){showToast("Username taken","error");return;}
    const updated={...currentUser,name:profileEdit.name||currentUser.name,username:profileEdit.username||currentUser.username,password:profileEdit.newPassword||currentUser.password};
    saveUsers(users.map(u=>u.id===currentUser.id?updated:u)); setCurrentUser(updated); setShowProfile(false); showToast("Profile updated!");
  };
  const exportData = () => {
    const blob=new Blob([JSON.stringify({clients,users,pendingLoans,v:"6.0",at:new Date().toISOString()},null,2)],{type:"application/json"});
    const url=URL.createObjectURL(blob),a=document.createElement("a"); a.href=url; a.download=`creda_backup_${todayStr}.json`; a.click(); URL.revokeObjectURL(url); showToast("Backup downloaded!");
  };

  if (loading) return (
    <div style={{ minHeight:"100vh",background:"#060f1a",display:"flex",alignItems:"center",justifyContent:"center",flexDirection:"column",gap:16 }}>
      <div style={{ width:56,height:56,borderRadius:16,background:"linear-gradient(135deg,#0a5c36,#0d7a48)",border:"2px solid rgba(200,146,10,0.4)",display:"flex",alignItems:"center",justifyContent:"center" }}>
        <svg width="30" height="30" viewBox="0 0 80 80" fill="none"><path d="M48 22A19 19 0 1 0 48 58" stroke="white" strokeWidth="5.5" strokeLinecap="round" fill="none"/><path d="M42 30L53 20L64 30" stroke="#c8920a" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" fill="none"/><line x1="53" y1="20" x2="53" y2="44" stroke="#c8920a" strokeWidth="4" strokeLinecap="round"/></svg>
      </div>
      <div style={{ color:"#e8f4fd",fontSize:16,fontWeight:700,fontFamily:"serif",letterSpacing:2 }}>CREDA Finance</div>
      <div style={{ color:"#3a5a70",fontSize:12 }}>Connecting to Firebase…</div>
    </div>
  );

  if (!currentUser) return <LoginScreen users={users} onLogin={u=>{ setCurrentUser(u); setProfileEdit({ name:u.name,username:u.username,oldPassword:"",newPassword:"",confirmPassword:"" }); }}/>;

  // ── ACCOUNTANT VIEW ───────────────────────────────────────────────────────
  const AccountantView = () => {
    const todayData = dailyCollectionData.find(d=>d.date===todayStr);
    const filteredDays = useMemo(() => {
      if(acctDateFilter==="today") return dailyCollectionData.filter(d=>d.date===todayStr);
      if(acctDateFilter==="week"){const w=new Date(today);w.setDate(w.getDate()-7);return dailyCollectionData.filter(d=>new Date(d.date)>=w);}
      if(acctDateFilter==="month"){const m=new Date(today);m.setDate(m.getDate()-30);return dailyCollectionData.filter(d=>new Date(d.date)>=m);}
      return dailyCollectionData;
    },[acctDateFilter]);
    const totals=filteredDays.reduce((acc,d)=>({expected:acc.expected+d.expected,collected:acc.collected+d.collected}),{expected:0,collected:0});
    return (
      <div>
        <div style={{ display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:20 }}>
          <div><h1 style={{ margin:0,fontSize:22,fontWeight:800,color:"#e8f4fd" }}>Accountant</h1><p style={{ margin:"4px 0 0",color:"#3a5a70",fontSize:13 }}>Daily collection & performance</p></div>
          {isAdmin&&<button onClick={()=>setAdminMode("admin")} style={{ background:"rgba(200,146,10,0.15)",border:"1px solid rgba(200,146,10,0.3)",color:"#f59e0b",padding:"8px 14px",borderRadius:10,cursor:"pointer",fontWeight:700,fontSize:11 }}>🔐 Admin View</button>}
        </div>
        <div style={{ background:"linear-gradient(135deg,rgba(34,197,94,0.08),rgba(59,130,246,0.06))",border:"1px solid rgba(34,197,94,0.2)",borderRadius:16,padding:"16px 18px",marginBottom:16 }}>
          <div style={{ fontSize:11,color:"#4ade80",fontWeight:700,letterSpacing:1.2,textTransform:"uppercase",marginBottom:12,display:"flex",alignItems:"center",gap:6 }}><Icon name="calendar" size={13}/> Today — {formatDate(todayStr)}</div>
          {todayData?(<>
            <div style={{ display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:10,marginBottom:12 }}>
              {[["Expected",todayData.expected,"#60a5fa"],["Collected",todayData.collected,"#4ade80"],["Shortfall",Math.max(0,todayData.expected-todayData.collected),todayData.collected>=todayData.expected?"#4ade80":"#f87171"]].map(([l,v,c])=>(<div key={l} style={{ background:"rgba(0,0,0,0.25)",borderRadius:10,padding:"10px 11px" }}><div style={{ fontSize:9,color:"#3a5a70",marginBottom:4,textTransform:"uppercase" }}>{l}</div><div style={{ fontSize:12,fontWeight:800,color:c,fontFamily:"'Courier New',monospace" }}>{formatCurrency(v)}</div></div>))}
            </div>
            <div><div style={{ display:"flex",justifyContent:"space-between",fontSize:10,color:"#3a5a70",marginBottom:5 }}><span>{todayData.installments.filter(i=>i.paid).length}/{todayData.installments.length} paid</span><span style={{ color:todayData.collected>=todayData.expected?"#4ade80":"#f59e0b" }}>{todayData.expected>0?((todayData.collected/todayData.expected)*100).toFixed(1):0}%</span></div><div style={{ height:6,background:"rgba(255,255,255,0.06)",borderRadius:4,overflow:"hidden" }}><div style={{ height:"100%",width:`${todayData.expected>0?Math.min((todayData.collected/todayData.expected)*100,100):0}%`,background:"linear-gradient(90deg,#22c55e,#4ade80)",borderRadius:4 }}/></div></div>
          </>):<div style={{ textAlign:"center",color:"#2a4050",fontSize:13,padding:"10px 0" }}>No collections today.</div>}
        </div>
        <div style={{ background:"rgba(255,255,255,0.02)",border:"1px solid rgba(100,180,255,0.07)",borderRadius:14,padding:"14px 16px",marginBottom:16 }}>
          <div style={{ display:"grid",gridTemplateColumns:"1fr 1fr",gap:10,marginBottom:10 }}>
            {[["Expected",totals.expected,"#60a5fa","rgba(96,165,250,0.06)","rgba(96,165,250,0.12)"],["Collected",totals.collected,"#4ade80","rgba(34,197,94,0.06)","rgba(34,197,94,0.12)"],["Outstanding",Math.max(0,totals.expected-totals.collected),"#f87171","rgba(239,68,68,0.05)","rgba(239,68,68,0.1)"],["Rate",`${totals.expected>0?((totals.collected/totals.expected)*100).toFixed(1):0}%`,"#f59e0b","rgba(245,158,11,0.05)","rgba(245,158,11,0.1)"]].map(([l,v,c,bg,border])=>(<div key={l} style={{ background:bg,borderRadius:10,padding:"11px 13px",border:`1px solid ${border}` }}><div style={{ fontSize:9,color:"#3a5a70",marginBottom:4,textTransform:"uppercase" }}>{l}</div><div style={{ fontSize:14,fontWeight:800,color:c,fontFamily:"'Courier New',monospace" }}>{typeof v==="string"?v:formatCurrency(v)}</div></div>))}
          </div>
        </div>
        <div style={{ display:"flex",gap:6,marginBottom:16,overflowX:"auto",paddingBottom:4 }}>
          {[{id:"today",l:"Today"},{id:"week",l:"Week"},{id:"month",l:"30 Days"},{id:"all",l:"All"}].map(f=>(<button key={f.id} onClick={()=>setAcctDateFilter(f.id)} style={{ background:acctDateFilter===f.id?"rgba(34,197,94,0.15)":"rgba(255,255,255,0.03)",border:acctDateFilter===f.id?"1px solid rgba(34,197,94,0.4)":"1px solid rgba(255,255,255,0.06)",color:acctDateFilter===f.id?"#4ade80":"#8ab4c8",padding:"6px 14px",borderRadius:8,fontSize:11,fontWeight:600,cursor:"pointer",whiteSpace:"nowrap" }}>{f.l}</button>))}
        </div>
        {filteredDays.length===0?<div style={{ textAlign:"center",padding:60,color:"#2a4050",border:"1px dashed rgba(100,180,255,0.08)",borderRadius:14 }}><div style={{ fontSize:36,marginBottom:10 }}>📅</div><div>No data.</div></div>
        :filteredDays.map(day=>{
          const isToday2=day.date===todayStr;const isPast=new Date(day.date)<today&&!isToday2;const rate=day.expected>0?(day.collected/day.expected)*100:0;const isOpen=acctSelectedDay===day.date;
          let borderColor="rgba(100,180,255,0.08)",accentColor="#60a5fa";
          if(isToday2){borderColor="rgba(34,197,94,0.25)";accentColor="#22c55e";}else if(rate>=100){borderColor="rgba(34,197,94,0.2)";accentColor="#22c55e";}else if(rate>0){borderColor="rgba(245,158,11,0.2)";accentColor="#f59e0b";}else if(isPast){borderColor="rgba(239,68,68,0.2)";accentColor="#ef4444";}
          return(<div key={day.date} style={{ background:isToday2?"linear-gradient(135deg,rgba(34,197,94,0.05),rgba(59,130,246,0.03))":"rgba(255,255,255,0.02)",border:`1px solid ${borderColor}`,borderRadius:14,overflow:"hidden",marginBottom:10 }}>
            <div onClick={()=>setAcctSelectedDay(isOpen?null:day.date)} style={{ padding:"13px 15px",cursor:"pointer" }}>
              <div style={{ display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:10 }}>
                <div style={{ display:"flex",alignItems:"center",gap:9 }}>
                  <div style={{ width:10,height:10,borderRadius:"50%",flexShrink:0,background:accentColor,boxShadow:isToday2?`0 0 8px ${accentColor}`:"none" }}/>
                  <div><div style={{ fontSize:13,fontWeight:700,color:"#e8f4fd" }}>{formatDate(day.date)} {isToday2&&<Badge color="#4ade80" bg="rgba(34,197,94,0.15)">TODAY</Badge>}</div><div style={{ fontSize:10,color:"#3a5a70",marginTop:2 }}>{day.installments.length} client{day.installments.length!==1?"s":""} · {day.installments.filter(i=>i.paid).length} paid</div></div>
                </div>
                <div style={{ display:"flex",alignItems:"center",gap:8 }}>
                  <div style={{ textAlign:"right" }}><div style={{ fontSize:13,fontWeight:800,color:accentColor,fontFamily:"'Courier New',monospace" }}>{formatCurrency(day.collected)}</div><div style={{ fontSize:10,color:"#3a5a70" }}>of {formatCurrency(day.expected)}</div></div>
                  <div style={{ color:"#3a5a70" }}>{isOpen?<Icon name="chevronUp" size={14}/>:<Icon name="chevronDown" size={14}/>}</div>
                </div>
              </div>
              <div style={{ height:5,background:"rgba(255,255,255,0.06)",borderRadius:4,overflow:"hidden" }}><div style={{ height:"100%",width:`${Math.min(rate,100)}%`,background:`linear-gradient(90deg,${accentColor},${accentColor}99)`,borderRadius:4 }}/></div>
            </div>
            {isOpen&&<div style={{ borderTop:"1px solid rgba(255,255,255,0.05)",padding:"12px 15px" }}>
              {day.installments.sort((a,b)=>a.paid===b.paid?0:a.paid?1:-1).map((inst,idx)=>{
                const sc=inst.paid?"#4ade80":(!inst.paid&&inst.paidAmount>0)?"#f87171":isPast?"#f87171":"#8ab4c8";
                return(<div key={idx} onClick={()=>{setSelectedClientId(inst.clientId);setView("detail");setAcctSelectedDay(null);}} style={{ background:inst.paid?"rgba(34,197,94,0.04)":"rgba(255,255,255,0.02)",border:`1px solid ${inst.paid?"rgba(34,197,94,0.15)":"rgba(255,255,255,0.04)"}`,borderRadius:10,padding:"10px 12px",display:"flex",justifyContent:"space-between",alignItems:"center",cursor:"pointer",marginBottom:7 }}>
                  <div style={{ display:"flex",alignItems:"center",gap:8 }}>
                    <div style={{ width:26,height:26,borderRadius:7,display:"flex",alignItems:"center",justifyContent:"center",background:inst.paid?"rgba(34,197,94,0.15)":"rgba(255,255,255,0.05)",color:sc,fontSize:11 }}>{inst.paid?<Icon name="check" size={11}/>:`${inst.day}`}</div>
                    <div><div style={{ fontSize:12,fontWeight:700,color:"#dceef8" }}>{inst.clientName}</div><div style={{ fontSize:9,color:"#3a5a70" }}>Day {inst.day}/{inst.totalDays}</div></div>
                  </div>
                  <div style={{ fontSize:12,fontWeight:700,color:sc,fontFamily:"'Courier New',monospace" }}>{formatCurrency(inst.paid?inst.paidAmount:inst.payment)}</div>
                </div>);
              })}
            </div>}
          </div>);
        })}
      </div>
    );
  };

  // ── DASHBOARD ─────────────────────────────────────────────────────────────
  const Dashboard = () => (
    <div>
      <div style={{ marginBottom:22 }}>
        <div style={{ display:"flex",justifyContent:"space-between",alignItems:"flex-start" }}>
          <div>
            <h1 style={{ margin:0,fontSize:24,fontWeight:800,color:"#e8f4fd" }}>{isAdmin?"Dashboard":"My Dashboard"}</h1>
            <p style={{ margin:"4px 0 0",color:"#3a5a70",fontSize:13 }}>
              {isAdmin?`${clients.length} clients · ${pendingLoans.length} pending`:`${visibleClients.length} clients · ${formatMonth(currentMonthKey)}`}
            </p>
          </div>
          <div style={{ display:"flex",flexDirection:"column",alignItems:"flex-end",gap:6 }}>
            <RoleBadge role={currentUser.role}/>
            {isAdmin&&<button onClick={()=>setAdminMode("accountant")} style={{ background:"rgba(167,139,250,0.15)",border:"1px solid rgba(167,139,250,0.3)",color:"#a78bfa",padding:"6px 12px",borderRadius:9,cursor:"pointer",fontWeight:700,fontSize:11 }}>📊 Finance View</button>}
          </div>
        </div>
      </div>

      {/* Staff monthly label */}
      {!isAdmin&&<div style={{ background:"rgba(96,165,250,0.08)",border:"1px solid rgba(96,165,250,0.2)",borderRadius:12,padding:"10px 14px",marginBottom:16,display:"flex",alignItems:"center",gap:8 }}>
        <Icon name="calendar" size={14}/>
        <div style={{ fontSize:12,color:"#60a5fa",fontWeight:700 }}>📅 Showing stats for {formatMonth(currentMonthKey)} only — Resets next month</div>
      </div>}

      {isAdmin&&pendingLoans.length>0&&<div onClick={()=>setView("staff")} style={{ background:"rgba(245,158,11,0.08)",border:"1px solid rgba(245,158,11,0.25)",borderRadius:12,padding:"12px 14px",marginBottom:16,cursor:"pointer",display:"flex",justifyContent:"space-between",alignItems:"center" }}>
        <div style={{ display:"flex",alignItems:"center",gap:8 }}><Icon name="bell" size={16}/><div><div style={{ fontSize:13,fontWeight:700,color:"#f59e0b" }}>{pendingLoans.length} Pending</div><div style={{ fontSize:10,color:"#6b5020",marginTop:1 }}>Tap to review</div></div></div><Icon name="chevronDown" size={14}/>
      </div>}

      {!isAdmin&&(()=>{const mp=pendingLoans.filter(p=>p.requestedBy===currentUser.id);return mp.length>0?(<div style={{ background:"rgba(96,165,250,0.08)",border:"1px solid rgba(96,165,250,0.2)",borderRadius:12,padding:"12px 14px",marginBottom:16 }}><div style={{ fontSize:13,fontWeight:700,color:"#60a5fa",marginBottom:4 }}>⏳ {mp.length} Request{mp.length>1?"s":""} Pending</div>{mp.map(p=>{const cl=clients.find(c=>c.id===p.clientId);return<div key={p.id} style={{ fontSize:11,color:"#3a5a70",marginTop:2 }}>• {cl?.name} — {formatCurrency(p.loanData.principal)}</div>;})}</div>):null;})()}

      <div style={{ display:"grid",gridTemplateColumns:"1fr 1fr",gap:10,marginBottom:20 }}>
        <StatCard label={isAdmin?"Total Disbursed":`This Month Disbursed`} value={formatCurrency(stats.totalDisbursed)} accent="#3b82f6" sub={!isAdmin?formatMonth(currentMonthKey):undefined}/>
        <StatCard label={isAdmin?"Total Collected":"This Month Collected"} value={formatCurrency(stats.totalCollected)} accent="#22c55e" sub={!isAdmin?formatMonth(currentMonthKey):undefined}/>
        <StatCard label="Outstanding" value={formatCurrency(stats.outstanding)} accent="#f59e0b"/>
        <StatCard label="Savings" value={formatCurrency(stats.totalSavings)} accent="#a855f7"/>
        <div style={{ gridColumn:"span 2" }}><StatCard label="Overdue" value={`${stats.overdueCount} late`} accent="#ef4444"/></div>
      </div>

      {/* Portfolio Intelligence — ADMIN ONLY */}
      {isAdmin&&<FinancialPanel fin={globalFin} expandFinancials={expandFinancials} setExpandFinancials={setExpandFinancials}/>}

      {/* Monthly History — ADMIN ONLY */}
      {isAdmin&&<div style={{ background:"rgba(255,255,255,0.02)",border:"1px solid rgba(100,180,255,0.06)",borderRadius:14,padding:16,marginBottom:20 }}>
        <div style={{ display:"flex",justifyContent:"space-between",alignItems:"center" }}>
          <div><h3 style={{ margin:0,fontSize:13,fontWeight:700,color:"#93c5fd",textTransform:"uppercase" }}>Monthly</h3></div>
          <button onClick={()=>setExpandMonthlyHistory(!expandMonthlyHistory)} style={{ background:"rgba(147,197,253,0.1)",border:"none",borderRadius:8,color:"#93c5fd",padding:"5px 12px",fontSize:11,cursor:"pointer",fontWeight:600 }}>{expandMonthlyHistory?"Hide":"View"}</button>
        </div>
        {expandMonthlyHistory&&<div style={{ marginTop:16,display:"flex",flexDirection:"column",gap:10 }}>
          {monthlyHistory.length===0?<div style={{ fontSize:11,color:"#3a5a70",textAlign:"center" }}>No data.</div>:monthlyHistory.map(item=>(<div key={item.month} style={{ padding:"10px 12px",background:"rgba(0,0,0,0.2)",borderRadius:10,borderLeft:"3px solid #22c55e" }}><div style={{ fontWeight:700,color:"#e8f4fd",fontSize:12,marginBottom:6 }}>{formatMonth(item.month)}</div><div style={{ display:"grid",gridTemplateColumns:"1fr 1fr 1fr 1fr",gap:6 }}>{[["DISBURSED",item.disbursed,"#93c5fd"],["COLLECTED",item.collected,"#4ade80"],["INTEREST",item.interest,"#c4b5fd"],["OUTSTANDING",item.outstanding,"#f87171"]].map(([l,v,c])=>(<div key={l}><div style={{ fontSize:8,color:"#3a5a70" }}>{l}</div><div style={{ fontSize:10,fontWeight:600,color:c,fontFamily:"'Courier New',monospace" }}>{formatCurrency(v)}</div></div>))}</div></div>))}
        </div>}
      </div>}

      <div style={{ display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:12 }}>
        <div style={{ fontSize:14,fontWeight:700,color:"#c8dde8" }}>Recent Clients</div>
        <button onClick={()=>setView("clients")} style={{ background:"none",border:"none",color:"#3b82f6",fontSize:12,cursor:"pointer" }}>See all →</button>
      </div>
      {visibleClients.length===0
        ?<div style={{ border:"1px dashed rgba(100,180,255,0.1)",borderRadius:14,padding:40,textAlign:"center",color:"#2a4050" }}><div style={{ fontSize:36,marginBottom:10 }}>💳</div><div style={{ marginBottom:14 }}>No clients</div><button onClick={()=>{setView("clients");setShowAddClient(true);}} style={{ background:"linear-gradient(135deg,#22c55e,#16a34a)",border:"none",color:"#000",padding:"9px 22px",borderRadius:10,cursor:"pointer",fontWeight:700,fontSize:13 }}>+ Add Client</button></div>
        :visibleClients.slice(0,5).map(c=>{const{active,overdue,paid,total,balance}=getClientLoanSummary(c);return(<div key={c.id} onClick={()=>{setSelectedClientId(c.id);setView("detail");}} style={{ background:"rgba(255,255,255,0.02)",border:"1px solid rgba(100,180,255,0.07)",borderRadius:12,padding:"12px 15px",cursor:"pointer",display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:8 }}><div style={{ display:"flex",alignItems:"center",gap:10 }}><div style={{ width:36,height:36,borderRadius:10,background:"linear-gradient(135deg,#1d4ed8,#3b82f6)",display:"flex",alignItems:"center",justifyContent:"center",fontWeight:800,fontSize:15,color:"#fff",flexShrink:0 }}>{c.name.charAt(0).toUpperCase()}</div><div><div style={{ fontWeight:600,color:"#dceef8",fontSize:14 }}>{c.name}</div><div style={{ fontSize:10,color:"#3a5a70" }}>{c.phone}{isAdmin&&c.assignedToName&&` · ${c.assignedToName}`}</div></div></div><div style={{ textAlign:"right" }}>{active?(<><div style={{ fontSize:12,fontWeight:700,color:"#60a5fa",fontFamily:"'Courier New',monospace" }}>{formatCurrency(balance)}</div><div style={{ fontSize:10,color:overdue>0?"#f87171":"#3a6050" }}>{overdue>0?`${overdue} overdue`:`${paid}/${total}`}</div></>):<div style={{ fontSize:11,color:"#2a4050" }}>No loan</div>}</div></div>);})}
    </div>
  );

  // ── CLIENTS LIST ──────────────────────────────────────────────────────────
  const ClientsList = () => (
    <div>
      <div style={{ display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:20 }}>
        <h1 style={{ margin:0,fontSize:22,fontWeight:800,color:"#e8f4fd" }}>{isAdmin?"All Clients":"My Clients"}</h1>
        <button onClick={()=>setShowAddClient(true)} style={{ background:"linear-gradient(135deg,#22c55e,#16a34a)",border:"none",color:"#000",padding:"9px 16px",borderRadius:11,cursor:"pointer",fontWeight:700,fontSize:13,display:"flex",alignItems:"center",gap:6 }}><Icon name="plus" size={13}/>New</button>
      </div>
      <div style={{ position:"relative",marginBottom:10 }}><span style={{ position:"absolute",left:12,top:11,color:"#5a7a90" }}><Icon name="search" size={14}/></span><input type="text" style={{ ...inputStyle,paddingLeft:36 }} placeholder="Search…" value={clientSearch} onChange={e=>setClientSearch(e.target.value)}/></div>
      <div style={{ display:"flex",gap:6,marginBottom:16,overflowX:"auto",paddingBottom:4 }}>
        {[{id:"all",l:"All"},{id:"active",l:"Active"},{id:"completed",l:"Done"},{id:"none",l:"No Loan"}].map(f=>(<button key={f.id} onClick={()=>setClientFilter(f.id)} style={{ background:clientFilter===f.id?"rgba(34,197,94,0.15)":"rgba(255,255,255,0.03)",border:clientFilter===f.id?"1px solid rgba(34,197,94,0.4)":"1px solid rgba(255,255,255,0.06)",color:clientFilter===f.id?"#4ade80":"#8ab4c8",padding:"6px 12px",borderRadius:8,fontSize:11,fontWeight:600,cursor:"pointer",whiteSpace:"nowrap" }}>{f.l}</button>))}
      </div>
      {filteredClients.length===0?<div style={{ textAlign:"center",padding:60,color:"#2a4050",border:"1px dashed rgba(100,180,255,0.08)",borderRadius:14 }}><div style={{ fontSize:36,marginBottom:10 }}>👤</div><div>No clients found.</div></div>
      :filteredClients.map(c=>{const{active,overdue,paid,total}=getClientLoanSummary(c);return(<div key={c.id} onClick={()=>{setSelectedClientId(c.id);setView("detail");}} style={{ background:"rgba(255,255,255,0.025)",border:"1px solid rgba(100,180,255,0.07)",borderRadius:13,padding:"14px 16px",cursor:"pointer",marginBottom:9 }}>
        <div style={{ display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:active?10:0 }}>
          <div style={{ display:"flex",gap:10,alignItems:"center" }}><div style={{ width:40,height:40,borderRadius:11,background:"linear-gradient(135deg,#1e3a5f,#2563eb)",display:"flex",alignItems:"center",justifyContent:"center",fontWeight:800,fontSize:16,color:"#93c5fd",flexShrink:0 }}>{c.name.charAt(0).toUpperCase()}</div><div><div style={{ fontWeight:700,color:"#dceef8",fontSize:14 }}>{c.name}</div><div style={{ fontSize:10,color:"#3a5a70",marginTop:1 }}>{c.id}{isAdmin&&c.assignedToName&&<span style={{ color:"#60a5fa" }}> · {c.assignedToName}</span>}</div></div></div>
          <Badge color={active?"#4ade80":"#3a5a70"} bg={active?"rgba(34,197,94,0.12)":"rgba(100,130,150,0.08)"}>{active?"Active":c.loans?.length>0?"Done":"No Loan"}</Badge>
        </div>
        {active&&<div><div style={{ display:"flex",justifyContent:"space-between",fontSize:11,color:"#3a5a70",marginBottom:5 }}><span>{paid}/{total}</span><span style={{ color:overdue>0?"#f87171":"#3a6050" }}>{overdue>0?`${overdue} overdue`:"✓"}</span></div><div style={{ height:3,background:"rgba(255,255,255,0.06)",borderRadius:4,overflow:"hidden" }}><div style={{ height:"100%",width:`${(paid/total)*100}%`,background:"linear-gradient(90deg,#22c55e,#4ade80)",borderRadius:4 }}/></div></div>}
      </div>);})}
    </div>
  );

  // ── LEDGER ────────────────────────────────────────────────────────────────
  const Ledger = () => (
    <div>
      <div style={{ marginBottom:22 }}><h1 style={{ margin:0,fontSize:22,fontWeight:800,color:"#e8f4fd" }}>Ledger</h1></div>
      {globalTransactions.length===0?<div style={{ textAlign:"center",padding:60,color:"#2a4050",border:"1px dashed rgba(100,180,255,0.08)",borderRadius:14 }}><div style={{ fontSize:36,marginBottom:10 }}>📝</div><div>No transactions.</div></div>
      :globalTransactions.map((tx,idx)=>(<div key={idx} style={{ background:"rgba(255,255,255,0.02)",border:`1px solid ${tx.overpayment>0?"rgba(167,139,250,0.15)":tx.shortfall>0?"rgba(239,68,68,0.15)":"rgba(100,180,255,0.05)"}`,borderRadius:12,padding:"12px 14px",display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:8 }}><div><div style={{ fontWeight:700,color:"#e8f4fd",fontSize:13 }}>{tx.clientName}</div><div style={{ fontSize:10,color:"#3a5a70",marginTop:2 }}>Day {tx.day}/{tx.totalDays} · {formatDate(tx.paidDate)}</div>{tx.overpayment>0&&<div style={{ fontSize:9,color:"#a78bfa",marginTop:1 }}>⚡ +{formatCurrency(tx.overpayment)}</div>}{tx.shortfall>0&&<div style={{ fontSize:9,color:"#f87171",marginTop:1 }}>⚠ -{formatCurrency(tx.shortfall)}</div>}</div><div style={{ textAlign:"right" }}><div style={{ fontSize:13,color:tx.overpayment>0?"#a78bfa":tx.shortfall>0?"#f87171":"#4ade80",fontWeight:700,fontFamily:"'Courier New',monospace" }}>+{formatCurrency(tx.paidAmount)}</div></div></div>))}
    </div>
  );

  // ── CLIENT DETAIL ─────────────────────────────────────────────────────────
  const Detail = () => {
    if(!selectedClient)return null;
    const c=selectedClient;const activeLoan=c.loans?.find(l=>l.status==="active");const allLoans=[...(c.loans||[])].reverse();
    const clientFin=useMemo(()=>computeClientFinancials(c),[c.id]);
    const myPendingForClient=pendingLoans.filter(p=>p.clientId===c.id);
    return (
      <div>
        <div style={{ display:"flex",alignItems:"center",gap:12,marginBottom:20 }}>
          <button onClick={()=>setView("clients")} style={{ background:"rgba(255,255,255,0.06)",border:"none",color:"#8ab4c8",width:34,height:34,borderRadius:9,cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center" }}><Icon name="back" size={15}/></button>
          <div style={{ width:44,height:44,borderRadius:12,background:"linear-gradient(135deg,#1d4ed8,#3b82f6)",display:"flex",alignItems:"center",justifyContent:"center",fontWeight:800,fontSize:18,color:"#fff",flexShrink:0 }}>{c.name.charAt(0).toUpperCase()}</div>
          <div style={{ flexGrow:1 }}><div style={{ fontSize:18,fontWeight:800,color:"#e8f4fd" }}>{c.name}</div><div style={{ fontSize:11,color:"#3a5a70" }}>{c.id} · {allLoans.length} cycle{allLoans.length!==1?"s":""}</div></div>
          <button onClick={()=>setShowEditClient(c)} style={{ background:"rgba(255,255,255,0.04)",border:"1px solid rgba(255,255,255,0.08)",color:"#3b82f6",width:32,height:32,borderRadius:8,cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center" }}><Icon name="edit" size={14}/></button>
        </div>
        <div style={{ background:"rgba(100,180,255,0.04)",border:"1px solid rgba(100,180,255,0.08)",borderRadius:13,padding:"14px 16px",marginBottom:16,display:"grid",gridTemplateColumns:"1fr 1fr",gap:10 }}>
          {[["PHONE",c.phone||"—"],["ID/BVN",c.idNumber||"—"],["SAVINGS",<span style={{ color:"#c084fc",fontWeight:700 }}>{formatCurrency(c.savingsBalance||0)}</span>],["OFFICER",c.assignedToName||"—"]].map(([l,v])=>(<div key={l}><div style={{ fontSize:10,color:"#3a5a70",marginBottom:3 }}>{l}</div><div style={{ color:"#c8dde8",fontSize:13 }}>{v}</div></div>))}
          <div style={{ gridColumn:"1/-1" }}><div style={{ fontSize:10,color:"#3a5a70",marginBottom:3 }}>ADDRESS</div><div style={{ color:"#c8dde8",fontSize:13 }}>{c.address||"—"}</div></div>
        </div>
        {isAdmin&&<button onClick={()=>setShowAssignClient(c)} style={{ width:"100%",marginBottom:12,background:"rgba(96,165,250,0.06)",border:"1px solid rgba(96,165,250,0.15)",color:"#60a5fa",padding:"8px",borderRadius:9,cursor:"pointer",fontWeight:600,fontSize:12,display:"flex",alignItems:"center",justifyContent:"center",gap:6 }}><Icon name="users" size={13}/>Reassign</button>}

        {/* Client Intelligence — ADMIN ONLY */}
        {isAdmin&&<FinancialPanel fin={clientFin} isClient={true}/>}

        {myPendingForClient.length>0&&<div style={{ background:"rgba(96,165,250,0.08)",border:"1px solid rgba(96,165,250,0.2)",borderRadius:12,padding:"12px 14px",marginBottom:14 }}><div style={{ fontSize:13,fontWeight:700,color:"#60a5fa",marginBottom:4 }}>⏳ Pending Approval</div>{myPendingForClient.map(p=><div key={p.id} style={{ fontSize:11,color:"#3a5a70" }}>{formatCurrency(p.loanData.principal)} · {p.loanData.days}d</div>)}</div>}

        <div style={{ display:"flex",gap:8,marginBottom:16 }}>
          {isAdmin&&!activeLoan&&<button onClick={()=>setShowAddLoan(true)} style={{ flex:1,background:"linear-gradient(135deg,#22c55e,#16a34a)",border:"none",color:"#000",padding:"10px",borderRadius:10,cursor:"pointer",fontWeight:700,fontSize:13,display:"flex",alignItems:"center",justifyContent:"center",gap:6 }}><Icon name="plus" size={13}/>Issue Loan</button>}
          {!isAdmin&&!activeLoan&&myPendingForClient.length===0&&<button onClick={()=>setShowAddLoan(true)} style={{ flex:1,background:"rgba(96,165,250,0.12)",border:"1px solid rgba(96,165,250,0.25)",color:"#60a5fa",padding:"10px",borderRadius:10,cursor:"pointer",fontWeight:700,fontSize:13,display:"flex",alignItems:"center",justifyContent:"center",gap:6 }}><Icon name="plus" size={13}/>Request Loan</button>}
          <button onClick={()=>setShowSavingsTx({type:"deposit",client:c})} style={{ flex:1,background:"rgba(168,85,247,0.12)",border:"1px solid rgba(168,85,247,0.25)",color:"#c084fc",padding:"10px",borderRadius:10,cursor:"pointer",fontWeight:700,fontSize:13 }}>📥 Savings</button>
        </div>

        <div style={{ display:"flex",gap:3,marginBottom:16,background:"rgba(255,255,255,0.03)",borderRadius:10,padding:3 }}>
          {[{id:"loans",label:`Cycles (${allLoans.length})`},{id:"savings",label:"Savings"}].map(tab=>(<button key={tab.id} onClick={()=>setActiveTab(tab.id)} style={{ flex:1,padding:"8px 4px",borderRadius:8,border:"none",cursor:"pointer",background:activeTab===tab.id?"rgba(100,180,255,0.1)":"transparent",color:activeTab===tab.id?(tab.id==="savings"?"#c084fc":"#93c5fd"):"#3a5a70",fontWeight:600,fontSize:12 }}>{tab.label}</button>))}
        </div>

        {activeTab==="loans"&&(allLoans.length===0
          ?<div style={{ border:"1px dashed rgba(100,180,255,0.08)",borderRadius:13,padding:40,textAlign:"center",color:"#2a4050" }}><div style={{ fontSize:32,marginBottom:10 }}>💰</div><div>No cycles.</div></div>
          :<div>
            <div style={{ background:"rgba(59,130,246,0.06)",border:"1px solid rgba(59,130,246,0.12)",borderRadius:12,padding:"12px 14px",marginBottom:14,display:"flex",gap:16,overflowX:"auto" }}>
              {[[allLoans.length,"TOTAL","#60a5fa"],[allLoans.filter(l=>l.status==="completed").length,"DONE","#22c55e"],[allLoans.filter(l=>l.status==="active").length,"ACTIVE","#f59e0b"]].map(([v,l,c])=>(<div key={l} style={{ flexShrink:0,textAlign:"center",minWidth:55 }}><div style={{ fontSize:18,fontWeight:900,color:c }}>{v}</div><div style={{ fontSize:9,color:"#3a5a70",marginTop:2 }}>{l}</div></div>))}
              {/* Profit — Admin only */}
              {isAdmin&&<div style={{ flexShrink:0,textAlign:"center",minWidth:55 }}><div style={{ fontSize:18,fontWeight:900,color:"#a78bfa" }}>{formatCurrency(clientFin.trueProfit).replace("₦","")}</div><div style={{ fontSize:9,color:"#3a5a70",marginTop:2 }}>PROFIT</div></div>}
            </div>
            {allLoans.map((loan,idx)=>(
              <LoanCycleCard key={loan.id} loan={loan} cycleNumber={allLoans.length-idx} totalCycles={allLoans.length} isAdmin={isAdmin} today={today}
                onPayment={(loan,schedIdx)=>{setShowPayment({clientId:c.id,loanId:loan.id,scheduleIdx:schedIdx});setPaymentAmount(loan.dailyPayment.toFixed(2));setPaymentPreview(null);}}
                onOverride={(loan,idx2,s)=>{setAdminEditInstallment({client:c,loan,idx:idx2});setAdminInstOverride({paid:s.paid,paidAmount:s.paidAmount||loan.dailyPayment.toFixed(2),dueDate:s.dueDate,paidDate:s.paidDate||todayStr});}}
              />
            ))}
          </div>
        )}

        {activeTab==="savings"&&<div>
          <div style={{ background:"rgba(168,85,247,0.05)",border:"1px solid rgba(168,85,247,0.15)",borderRadius:14,padding:16,marginBottom:16 }}>
            <div style={{ textAlign:"center",marginBottom:14 }}><div style={{ fontSize:10,color:"#a855f7",fontWeight:700,letterSpacing:1 }}>SAVINGS BALANCE</div><div style={{ fontSize:28,fontWeight:800,color:"#c084fc",fontFamily:"'Courier New',monospace",marginTop:6 }}>{formatCurrency(c.savingsBalance||0)}</div></div>
            <div style={{ display:"grid",gridTemplateColumns:"1fr 1fr",gap:10 }}>
              <button onClick={()=>setShowSavingsTx({type:"deposit",client:c})} style={{ background:"#a855f7",border:"none",color:"#fff",fontWeight:700,padding:"10px",borderRadius:10,cursor:"pointer" }}>📥 Deposit</button>
              <button onClick={()=>setShowSavingsTx({type:"withdraw",client:c})} style={{ background:"transparent",border:"1px solid #a855f7",color:"#c084fc",fontWeight:700,padding:"10px",borderRadius:10,cursor:"pointer" }}>📤 Withdraw</button>
            </div>
          </div>
          {(!c.savingsLogs||c.savingsLogs.length===0)?<div style={{ textAlign:"center",padding:20,color:"#2a4050",fontSize:12 }}>No history.</div>
          :c.savingsLogs.map((log,idx)=>(<div key={idx} style={{ background:"rgba(255,255,255,0.01)",border:"1px solid rgba(168,85,247,0.08)",borderRadius:10,padding:"10px 12px",display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:6 }}><div><div style={{ fontSize:12,fontWeight:600,color:log.type==="deposit"?"#4ade80":log.type==="withdraw"?"#f87171":"#c084fc" }}>{log.type==="deposit"?"Deposit":log.type==="withdraw"?"Withdrawal":"Admin Override"}</div><div style={{ fontSize:9,color:"#3a5a70",marginTop:2 }}>{formatDate(log.date)}{log.recordedBy&&` · ${log.recordedBy}`}</div></div><div style={{ textAlign:"right" }}><div style={{ fontSize:12,fontWeight:700,color:"#e8f4fd",fontFamily:"'Courier New',monospace" }}>{log.type==="deposit"?"+":"-"}{formatCurrency(log.amount)}</div><div style={{ fontSize:9,color:"#3a5a70" }}>Bal: {formatCurrency(log.balanceAfter)}</div></div></div>))}
        </div>}

        {isAdmin&&<button onClick={()=>setConfirmDelete(c.id)} style={{ marginTop:22,background:"rgba(239,68,68,0.08)",border:"1px solid rgba(239,68,68,0.15)",color:"#f87171",padding:"9px 18px",borderRadius:10,cursor:"pointer",fontWeight:600,fontSize:12,display:"flex",alignItems:"center",gap:7 }}><Icon name="trash" size={13}/>Delete Client</button>}
      </div>
    );
  };

  // ── NAV ────────────────────────────────────────────────────────────────────
  const navItems = [
    { id:"dashboard",label:"Overview",icon:"dashboard" },
    { id:"clients",label:isAdmin?"Clients":"Mine",icon:"user" },
    { id:"ledger",label:"Ledger",icon:"ledger" },
    ...(isAdmin?[{ id:"accountant",label:"Accounts",icon:"account" },{ id:"staff",label:"Staff",icon:"users" }]:[]),
  ];

  return (
    <div style={{ minHeight:"100vh",background:"#060f1a",fontFamily:"'Segoe UI',system-ui,sans-serif",color:"#e8f4fd" }}>
      <Toast msg={toast.msg} type={toast.type}/>
      {!isAdmin&&<div style={{ background:"rgba(96,165,250,0.12)",borderBottom:"1px solid rgba(96,165,250,0.15)",padding:"5px 16px",fontSize:11,color:"#60a5fa",display:"flex",justifyContent:"space-between" }}><span>🏦 Officer — Your clients only</span><span style={{ color:"#3a5a70" }}>{currentUser.name}</span></div>}
      <div style={{ background:"rgba(6,15,26,0.95)",borderBottom:"1px solid rgba(100,180,255,0.07)",padding:"14px 18px",display:"flex",justifyContent:"space-between",alignItems:"center",position:"sticky",top:!isAdmin?28:0,zIndex:100,backdropFilter:"blur(10px)" }}>
        <div style={{ display:"flex",alignItems:"center",gap:10 }}>
          <div style={{ width:36,height:36,borderRadius:10,background:"linear-gradient(135deg,#0a5c36,#0d7a48)",border:"1.5px solid rgba(200,146,10,0.4)",display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0 }}>
            <svg width="20" height="20" viewBox="0 0 80 80" fill="none"><path d="M48 22A19 19 0 1 0 48 58" stroke="white" strokeWidth="5.5" strokeLinecap="round" fill="none"/><path d="M42 30L53 20L64 30" stroke="#c8920a" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" fill="none"/><line x1="53" y1="20" x2="53" y2="44" stroke="#c8920a" strokeWidth="4" strokeLinecap="round"/></svg>
          </div>
          <div><div style={{ fontSize:14,fontWeight:800,color:"#e8f4fd",letterSpacing:1,fontFamily:"serif" }}>CREDA</div><div style={{ fontSize:8,color:"rgba(200,146,10,0.7)",letterSpacing:2,textTransform:"uppercase",lineHeight:1 }}>Finance</div></div>
        </div>
        <div style={{ display:"flex",alignItems:"center",gap:10 }}>
          <span style={{ fontSize:10,color:sync==="synced"?"#22c55e":"#60a5fa",fontWeight:600 }}>{sync==="synced"?"☁️":"⟳"}</span>
          {isAdmin&&pendingLoans.length>0&&<button onClick={()=>setView("staff")} style={{ position:"relative",background:"rgba(245,158,11,0.15)",border:"1px solid rgba(245,158,11,0.3)",color:"#f59e0b",width:30,height:30,borderRadius:8,cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center" }}><Icon name="bell" size={14}/><span style={{ position:"absolute",top:-4,right:-4,background:"#ef4444",color:"#fff",fontSize:9,fontWeight:800,width:14,height:14,borderRadius:"50%",display:"flex",alignItems:"center",justifyContent:"center" }}>{pendingLoans.length}</span></button>}
          <button onClick={()=>{setShowProfile(true);setProfileEdit({name:currentUser.name,username:currentUser.username,oldPassword:"",newPassword:"",confirmPassword:""});}} style={{ background:"rgba(255,255,255,0.06)",border:"1px solid rgba(255,255,255,0.1)",color:"#8ab4c8",width:30,height:30,borderRadius:8,cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center" }}><Icon name="key" size={14}/></button>
          <button onClick={()=>setShowSettings(true)} style={{ background:"rgba(255,255,255,0.06)",border:"1px solid rgba(255,255,255,0.1)",color:"#8ab4c8",width:30,height:30,borderRadius:8,cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center" }}>⚙️</button>
          <button onClick={()=>setCurrentUser(null)} style={{ background:"rgba(239,68,68,0.08)",border:"1px solid rgba(239,68,68,0.15)",color:"#f87171",width:30,height:30,borderRadius:8,cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center" }}><Icon name="logout" size={14}/></button>
        </div>
      </div>
      <div style={{ padding:"20px 16px 100px",maxWidth:540,margin:"0 auto" }}>
        {view==="dashboard"&&(isAdmin&&adminMode==="accountant"?<AccountantView/>:<Dashboard/>)}
        {view==="clients"&&<ClientsList/>}
        {view==="ledger"&&<Ledger/>}
        {view==="accountant"&&isAdmin&&<AccountantView/>}
        {view==="staff"&&isAdmin&&<StaffPanel users={users} clients={clients} pendingLoans={pendingLoans} currentUser={currentUser} onUpdateUsers={saveUsers} onApproveLoan={handleApproveLoan} onRejectLoan={handleRejectLoan}/>}
        {view==="detail"&&<Detail/>}
      </div>
      <div style={{ position:"fixed",bottom:0,left:0,right:0,background:"rgba(6,15,26,0.97)",borderTop:"1px solid rgba(100,180,255,0.07)",display:"flex",backdropFilter:"blur(12px)",zIndex:900 }}>
        {navItems.map(n=>{const active=view===n.id||(view==="detail"&&n.id==="clients");return(<button key={n.id} onClick={()=>{setView(n.id);if(n.id==="dashboard")setAdminMode("admin");}} style={{ flex:1,padding:"12px 8px 14px",background:"transparent",border:"none",cursor:"pointer",color:active?"#22c55e":"#4a6880",display:"flex",flexDirection:"column",alignItems:"center",gap:4,position:"relative" }}><Icon name={n.icon} size={18}/><span style={{ fontSize:10,fontWeight:600 }}>{n.label}</span>{n.id==="staff"&&pendingLoans.length>0&&<span style={{ position:"absolute",top:8,right:"calc(50% - 14px)",background:"#ef4444",color:"#fff",fontSize:8,fontWeight:800,width:13,height:13,borderRadius:"50%",display:"flex",alignItems:"center",justifyContent:"center" }}>{pendingLoans.length}</span>}</button>);})}
      </div>

      {/* ── MODALS ──────────────────────────────────────────────────────── */}

      {showProfile&&<Modal title="👤 My Profile" onClose={()=>setShowProfile(false)}>
        <div style={{ display:"flex",alignItems:"center",gap:12,marginBottom:20,padding:12,background:"rgba(255,255,255,0.03)",borderRadius:12 }}>
          <div style={{ width:50,height:50,borderRadius:14,background:isAdmin?"linear-gradient(135deg,#f59e0b,#d97706)":"linear-gradient(135deg,#1d4ed8,#3b82f6)",display:"flex",alignItems:"center",justifyContent:"center",fontWeight:800,fontSize:22,color:"#fff" }}>{currentUser.name.charAt(0)}</div>
          <div><div style={{ fontWeight:700,color:"#e8f4fd",fontSize:16 }}>{currentUser.name}</div><div style={{ fontSize:12,color:"#3a5a70" }}>@{currentUser.username} · {currentUser.role}</div></div>
        </div>
        <div style={{ background:"rgba(245,158,11,0.08)",border:"1px solid rgba(245,158,11,0.2)",borderRadius:9,padding:"9px 12px",marginBottom:16,fontSize:12,color:"#f59e0b" }}>🔐 Enter current password to save changes</div>
        <Field label="Current Password *"><input type="password" style={inputStyle} value={profileEdit.oldPassword} onChange={e=>setProfileEdit(p=>({...p,oldPassword:e.target.value}))}/></Field>
        <Field label="Display Name"><input style={inputStyle} value={profileEdit.name} onChange={e=>setProfileEdit(p=>({...p,name:e.target.value}))}/></Field>
        <Field label="New Username"><input style={inputStyle} value={profileEdit.username} onChange={e=>setProfileEdit(p=>({...p,username:e.target.value.toLowerCase().replace(/\s/g,"")}))}/></Field>
        <Field label="New Password"><input type="password" style={inputStyle} value={profileEdit.newPassword} onChange={e=>setProfileEdit(p=>({...p,newPassword:e.target.value}))} placeholder="Leave blank to keep"/></Field>
        <Field label="Confirm"><input type="password" style={inputStyle} value={profileEdit.confirmPassword} onChange={e=>setProfileEdit(p=>({...p,confirmPassword:e.target.value}))}/></Field>
        <button onClick={handleUpdateProfile} style={{ width:"100%",background:"linear-gradient(135deg,#22c55e,#16a34a)",border:"none",color:"#000",padding:12,borderRadius:12,cursor:"pointer",fontWeight:800,fontSize:14 }}>✓ Update</button>
      </Modal>}

      {showPayment&&(()=>{const cl=clients.find(c=>c.id===showPayment.clientId);const ln=cl?.loans?.find(l=>l.id===showPayment.loanId);const preview=paymentPreview;const amount=parseFloat(paymentAmount)||0;const expected=ln?.dailyPayment||0;const isOver=amount>expected,isUnder=amount>0&&amount<expected;return(<Modal title="Record Payment" onClose={()=>{setShowPayment(null);setPaymentAmount("");setPaymentPreview(null);}}>
        <div style={{ textAlign:"center",marginBottom:16 }}><div style={{ fontSize:12,color:"#3a5a70" }}>Expected</div><div style={{ fontSize:26,fontWeight:800,color:"#4ade80",fontFamily:"'Courier New',monospace" }}>{formatCurrency(expected)}</div><div style={{ fontSize:11,color:"#3a5a70",marginTop:4 }}>Day {showPayment.scheduleIdx+1} of {ln?.days} · {cl?.name}</div></div>
        <Field label="Amount (₦)"><input type="number" style={inputStyle} value={paymentAmount} onChange={e=>{setPaymentAmount(e.target.value);const amt=parseFloat(e.target.value)||0;if(amt>0&&ln)setPaymentPreview(computePaymentPreview(ln,showPayment.scheduleIdx,amt));else setPaymentPreview(null);}} autoFocus/></Field>
        {preview&&amount>0&&<div style={{ marginBottom:14 }}>
          {isOver&&<div style={{ background:"rgba(167,139,250,0.1)",border:"1px solid rgba(167,139,250,0.25)",borderRadius:12,padding:"12px 14px" }}><div style={{ fontSize:12,fontWeight:700,color:"#a78bfa",marginBottom:8 }}>⚡ Smart Cascade</div><div style={{ display:"grid",gridTemplateColumns:"1fr 1fr",gap:8 }}><div style={{ background:"rgba(0,0,0,0.2)",borderRadius:8,padding:"8px 10px" }}><div style={{ fontSize:8,color:"#5a7a90" }}>OVER</div><div style={{ fontSize:12,fontWeight:700,color:"#a78bfa",fontFamily:"'Courier New',monospace" }}>{formatCurrency(amount-expected)}</div></div><div style={{ background:"rgba(0,0,0,0.2)",borderRadius:8,padding:"8px 10px" }}><div style={{ fontSize:8,color:"#5a7a90" }}>DAYS</div><div style={{ fontSize:12,fontWeight:700,color:"#4ade80",fontFamily:"'Courier New',monospace" }}>{preview.daysCleared}</div></div></div></div>}
          {isUnder&&<div style={{ background:"rgba(239,68,68,0.06)",border:"1px solid rgba(239,68,68,0.2)",borderRadius:12,padding:"12px 14px" }}><div style={{ fontSize:12,fontWeight:700,color:"#f87171" }}>⚠️ Shortfall: {formatCurrency(expected-amount)}</div></div>}
          {!isOver&&!isUnder&&amount===expected&&<div style={{ background:"rgba(34,197,94,0.06)",border:"1px solid rgba(34,197,94,0.2)",borderRadius:12,padding:"10px 14px",textAlign:"center" }}><span style={{ fontSize:12,color:"#4ade80",fontWeight:700 }}>✓ Exact</span></div>}
        </div>}
        <button onClick={handlePayment} style={{ width:"100%",background:"linear-gradient(135deg,#22c55e,#16a34a)",border:"none",color:"#000",padding:12,borderRadius:12,cursor:"pointer",fontWeight:800,fontSize:14 }}>✓ Confirm {isOver?"(+Cascade)":isUnder?"(Partial)":""}</button>
      </Modal>);})()}

      {adminEditInstallment&&<Modal title="🛠️ Override" onClose={()=>setAdminEditInstallment(null)}>
        <div style={{ background:"rgba(245,158,11,0.08)",border:"1px solid rgba(245,158,11,0.2)",borderRadius:10,padding:12,fontSize:12,color:"#f59e0b",marginBottom:16 }}>Installment {adminEditInstallment.idx+1} — {adminEditInstallment.client.name}</div>
        <div style={{ display:"flex",alignItems:"center",gap:10,marginBottom:16 }}><label style={{ fontSize:12,color:"#8ab4c8",fontWeight:600,flexGrow:1 }}>Paid?</label><input type="checkbox" style={{ width:20,height:20,accentColor:"#22c55e" }} checked={adminInstOverride.paid} onChange={e=>setAdminInstOverride(p=>({...p,paid:e.target.checked}))}/></div>
        {adminInstOverride.paid&&<><Field label="Amount"><input type="number" style={inputStyle} value={adminInstOverride.paidAmount} onChange={e=>setAdminInstOverride(p=>({...p,paidAmount:e.target.value}))}/></Field><Field label="Paid Date"><input type="date" style={inputStyle} value={adminInstOverride.paidDate} onChange={e=>setAdminInstOverride(p=>({...p,paidDate:e.target.value}))}/></Field></>}
        <Field label="Due Date"><input type="date" style={inputStyle} value={adminInstOverride.dueDate} onChange={e=>setAdminInstOverride(p=>({...p,dueDate:e.target.value}))}/></Field>
        <button onClick={handleAdminInstallmentOverride} style={{ width:"100%",background:"#f59e0b",border:"none",color:"#000",padding:12,borderRadius:12,cursor:"pointer",fontWeight:800,fontSize:14 }}>✓ Apply</button>
      </Modal>}

      {showSavingsTx&&<Modal title={showSavingsTx.type==="deposit"?"📥 Deposit":"📤 Withdraw"} onClose={()=>setShowSavingsTx(null)}>
        <div style={{ background:"rgba(168,85,247,0.08)",border:"1px solid rgba(168,85,247,0.15)",borderRadius:10,padding:"9px 13px",marginBottom:16,fontSize:13,color:"#c084fc" }}>{showSavingsTx.client.name} · Bal: {formatCurrency(showSavingsTx.client.savingsBalance||0)}</div>
        <Field label="Amount"><input type="number" style={inputStyle} value={savingsAmount} onChange={e=>setSavingsAmount(e.target.value)} autoFocus/></Field>
        <button onClick={handleSavingsTransaction} style={{ width:"100%",background:"linear-gradient(135deg,#a855f7,#7c3aed)",border:"none",color:"#fff",padding:12,borderRadius:12,cursor:"pointer",fontWeight:800,fontSize:14,marginBottom:isAdmin?20:0 }}>{showSavingsTx.type==="deposit"?"Deposit":"Withdraw"}</button>
        {isAdmin&&<div style={{ borderTop:"1px dashed rgba(255,255,255,0.1)",paddingTop:16 }}><div style={{ fontSize:11,color:"#f59e0b",fontWeight:700,marginBottom:8 }}>🛡️ Admin Override</div><Field label="Set Balance"><input type="number" style={{...inputStyle,border:"1px solid rgba(245,158,11,0.3)"}} value={adminDirectSavingsInput} onChange={e=>setAdminDirectSavingsInput(e.target.value)}/></Field><button onClick={handleAdminSavingsAdjustment} style={{ width:"100%",background:"#f59e0b",border:"none",color:"#000",padding:10,borderRadius:10,cursor:"pointer",fontWeight:700,fontSize:12 }}>Force Adjust</button></div>}
      </Modal>}

      {showAddClient&&<Modal title="Register Client" onClose={()=>setShowAddClient(false)}>
        <Field label="Name *"><input style={inputStyle} value={newClient.name} onChange={e=>setNewClient(p=>({...p,name:e.target.value}))} autoFocus/></Field>
        <Field label="Phone *"><input style={inputStyle} value={newClient.phone} onChange={e=>setNewClient(p=>({...p,phone:e.target.value}))}/></Field>
        <Field label="Address"><input style={inputStyle} value={newClient.address} onChange={e=>setNewClient(p=>({...p,address:e.target.value}))}/></Field>
        <Field label="ID/BVN"><input style={inputStyle} value={newClient.idNumber} onChange={e=>setNewClient(p=>({...p,idNumber:e.target.value}))}/></Field>
        <button onClick={handleAddClient} style={{ width:"100%",background:"linear-gradient(135deg,#22c55e,#16a34a)",border:"none",color:"#000",padding:12,borderRadius:12,cursor:"pointer",fontWeight:800,fontSize:14 }}>✓ Register</button>
      </Modal>}

      {showEditClient&&<Modal title="Edit Client" onClose={()=>setShowEditClient(null)}>
        <Field label="Name"><input style={inputStyle} value={showEditClient.name} onChange={e=>setShowEditClient(p=>({...p,name:e.target.value}))}/></Field>
        <Field label="Phone"><input style={inputStyle} value={showEditClient.phone} onChange={e=>setShowEditClient(p=>({...p,phone:e.target.value}))}/></Field>
        <Field label="Address"><input style={inputStyle} value={showEditClient.address||""} onChange={e=>setShowEditClient(p=>({...p,address:e.target.value}))}/></Field>
        <Field label="ID/BVN"><input style={inputStyle} value={showEditClient.idNumber||""} onChange={e=>setShowEditClient(p=>({...p,idNumber:e.target.value}))}/></Field>
        <button onClick={handleUpdateClient} style={{ width:"100%",background:"linear-gradient(135deg,#3b82f6,#2563eb)",border:"none",color:"#fff",padding:12,borderRadius:12,cursor:"pointer",fontWeight:800,fontSize:14 }}>✓ Save</button>
      </Modal>}

      {showAssignClient&&<Modal title="Reassign" onClose={()=>setShowAssignClient(null)}>
        <div style={{ fontSize:13,color:"#8ab4c8",marginBottom:16 }}>Reassign <strong>{showAssignClient.name}</strong>:</div>
        {users.filter(u=>u.active).map(u=>(<button key={u.id} onClick={()=>handleAssignClient(showAssignClient.id,u.id)} style={{ width:"100%",background:showAssignClient.assignedTo===u.id?"rgba(34,197,94,0.12)":"rgba(255,255,255,0.03)",border:showAssignClient.assignedTo===u.id?"1px solid rgba(34,197,94,0.3)":"1px solid rgba(255,255,255,0.06)",borderRadius:10,padding:"11px 14px",cursor:"pointer",display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:8 }}><div style={{ display:"flex",alignItems:"center",gap:8 }}><div style={{ width:32,height:32,borderRadius:9,background:u.role==="admin"?"linear-gradient(135deg,#f59e0b,#d97706)":"linear-gradient(135deg,#1d4ed8,#3b82f6)",display:"flex",alignItems:"center",justifyContent:"center",fontWeight:800,color:"#fff",fontSize:13 }}>{u.name.charAt(0)}</div><div><div style={{ fontSize:13,fontWeight:600,color:"#dceef8" }}>{u.name}</div><div style={{ fontSize:10,color:"#3a5a70" }}>@{u.username}</div></div></div><RoleBadge role={u.role}/></button>))}
      </Modal>}

      {showAddLoan&&<Modal title={isAdmin?"Issue Loan":"Request Loan"} onClose={()=>setShowAddLoan(false)}>
        <div style={{ background:isAdmin?"rgba(59,130,246,0.08)":"rgba(245,158,11,0.08)",border:`1px solid ${isAdmin?"rgba(59,130,246,0.15)":"rgba(245,158,11,0.2)"}`,borderRadius:9,padding:"9px 13px",marginBottom:16,fontSize:13,color:isAdmin?"#93c5fd":"#f59e0b" }}>{isAdmin?"For: ":"Requesting for: "}<strong>{selectedClient?.name}</strong></div>
        <Field label="Principal (₦) *"><input type="number" style={inputStyle} value={newLoan.principal} onChange={e=>setNewLoan(p=>({...p,principal:e.target.value}))}/></Field>
        <Field label="Interest (%)"><input type="number" style={inputStyle} value={newLoan.interestRate} onChange={e=>setNewLoan(p=>({...p,interestRate:e.target.value}))}/></Field>
        <Field label="Days"><input type="number" style={inputStyle} value={newLoan.days} onChange={e=>setNewLoan(p=>({...p,days:e.target.value}))}/></Field>
        <Field label="Start Date"><input type="date" style={inputStyle} value={newLoan.startDate} onChange={e=>setNewLoan(p=>({...p,startDate:e.target.value}))}/></Field>
        <div style={{ display:"flex",alignItems:"center",justifyContent:"space-between",padding:"8px 0 16px" }}><span style={{ fontSize:12,color:"#8ab4c8",fontWeight:600 }}>Skip Weekends?</span><input type="checkbox" style={{ width:20,height:20,accentColor:"#22c55e" }} checked={newLoan.excludeWeekends} onChange={e=>setNewLoan(p=>({...p,excludeWeekends:e.target.checked}))}/></div>
        {newLoan.principal&&(()=>{const p=parseFloat(newLoan.principal)||0,r=parseFloat(newLoan.interestRate)||0,d=parseInt(newLoan.days)||1,total=p+(p*r/100),daily=total/d;return(<div style={{ background:"rgba(34,197,94,0.06)",border:"1px solid rgba(34,197,94,0.12)",borderRadius:10,padding:"12px 14px",marginBottom:14,display:"grid",gridTemplateColumns:"1fr 1fr",gap:10 }}><div><div style={{ fontSize:10,color:"#3a5a70" }}>TOTAL</div><div style={{ color:"#4ade80",fontWeight:700,fontFamily:"'Courier New',monospace",fontSize:13 }}>{formatCurrency(total)}</div></div><div><div style={{ fontSize:10,color:"#3a5a70" }}>DAILY</div><div style={{ color:"#60a5fa",fontWeight:700,fontFamily:"'Courier New',monospace",fontSize:13 }}>{formatCurrency(daily)}</div></div><div><div style={{ fontSize:10,color:"#3a5a70" }}>INTEREST</div><div style={{ color:"#c4b5fd",fontWeight:700,fontFamily:"'Courier New',monospace",fontSize:13 }}>{formatCurrency(p*r/100)}</div></div><div><div style={{ fontSize:10,color:"#3a5a70" }}>ROI</div><div style={{ color:"#f59e0b",fontWeight:700,fontFamily:"'Courier New',monospace",fontSize:13 }}>{r.toFixed(1)}%</div></div></div>);})()}
        <button onClick={isAdmin?handleAddLoan:handleRequestLoan} style={{ width:"100%",background:isAdmin?"linear-gradient(135deg,#22c55e,#16a34a)":"linear-gradient(135deg,#f59e0b,#d97706)",border:"none",color:"#000",padding:12,borderRadius:12,cursor:"pointer",fontWeight:800,fontSize:14 }}>{isAdmin?`✓ Issue Cycle #${(selectedClient?.loans?.length||0)+1}`:"📤 Submit"}</button>
      </Modal>}

      {showSettings&&<Modal title="⚙️ Settings" onClose={()=>setShowSettings(false)}>
        <div style={{ display:"flex",flexDirection:"column",gap:14 }}>
          <div style={{ background:"rgba(255,255,255,0.03)",border:"1px solid rgba(255,255,255,0.06)",borderRadius:12,padding:"14px 16px" }}>
            <div style={{ display:"flex",alignItems:"center",gap:10 }}>
              <div style={{ width:40,height:40,borderRadius:11,background:isAdmin?"linear-gradient(135deg,#f59e0b,#d97706)":"linear-gradient(135deg,#1d4ed8,#3b82f6)",display:"flex",alignItems:"center",justifyContent:"center",fontWeight:800,fontSize:16,color:"#fff" }}>{currentUser.name.charAt(0)}</div>
              <div><div style={{ fontSize:14,fontWeight:700,color:"#e8f4fd" }}>{currentUser.name}</div><div style={{ fontSize:11,color:"#3a5a70" }}>@{currentUser.username}</div><RoleBadge role={currentUser.role}/></div>
            </div>
          </div>
          <div style={{ background:"rgba(34,197,94,0.06)",border:"1px solid rgba(34,197,94,0.15)",borderRadius:10,padding:"10px 14px" }}><div style={{ fontSize:12,color:"#4ade80",fontWeight:700 }}>☁️ Firebase Synced</div></div>
          {isAdmin&&<>
            <button onClick={()=>{exportData();setShowSettings(false);}} style={{ width:"100%",background:"linear-gradient(135deg,#22c55e,#16a34a)",border:"none",color:"#000",padding:11,borderRadius:10,cursor:"pointer",fontWeight:700,fontSize:13 }}>📤 Download Backup</button>
            <label style={{ display:"block",width:"100%",background:"rgba(96,165,250,0.1)",border:"1px solid rgba(96,165,250,0.25)",color:"#60a5fa",padding:11,borderRadius:10,cursor:"pointer",fontWeight:700,fontSize:13,textAlign:"center",boxSizing:"border-box" }}>📥 Restore<input type="file" accept=".json" style={{ display:"none" }} onChange={e=>{if(e.target.files[0]){const reader=new FileReader();reader.onload=ev=>{try{const data=JSON.parse(ev.target.result);if(data.clients){saveClients(data.clients);if(data.users)saveUsers(data.users);if(data.pendingLoans)savePending(data.pendingLoans);setShowSettings(false);showToast(`✅ ${data.clients.length} clients restored!`);}else showToast("Invalid","error");}catch{showToast("Error","error");}};reader.readAsText(e.target.files[0]);}}}/></label>
            <div style={{ background:"rgba(255,255,255,0.03)",borderRadius:8,padding:"10px 12px",display:"flex",flexDirection:"column",gap:6 }}>
              {[["Clients",clients.length,"#fff"],["Officers",users.filter(u=>u.role==="loan_officer").length,"#60a5fa"],["Active",clients.reduce((a,c)=>a+(c.loans?.filter(l=>l.status==="active").length||0),0),"#4ade80"],["Pending",pendingLoans.length,"#f59e0b"]].map(([l,v,c])=>(<div key={l} style={{ display:"flex",justifyContent:"space-between",fontSize:12,color:"#6b7a8d" }}><span>{l}</span><span style={{ color:c,fontWeight:600 }}>{v}</span></div>))}
            </div>
            <button onClick={()=>{if(window.confirm("Delete ALL data?")){saveClients([]);savePending([]);setShowSettings(false);showToast("Cleared","error");}}} style={{ width:"100%",background:"rgba(248,113,113,0.1)",border:"1px solid rgba(248,113,113,0.2)",color:"#f87171",padding:10,borderRadius:10,cursor:"pointer",fontWeight:600,fontSize:12 }}>🗑️ Clear All</button>
          </>}
          <button onClick={()=>setCurrentUser(null)} style={{ width:"100%",background:"rgba(239,68,68,0.08)",border:"1px solid rgba(239,68,68,0.15)",color:"#f87171",padding:11,borderRadius:10,cursor:"pointer",fontWeight:700,fontSize:13,display:"flex",alignItems:"center",justifyContent:"center",gap:8 }}><Icon name="logout" size={14}/>Sign Out</button>
        </div>
      </Modal>}

      {confirmDelete&&<Modal title="Delete?" onClose={()=>setConfirmDelete(null)}>
        <p style={{ color:"#8ab4c8",fontSize:14,marginBottom:20 }}>Permanently delete this client?</p>
        <div style={{ display:"flex",gap:10 }}>
          <button onClick={()=>setConfirmDelete(null)} style={{ flex:1,background:"rgba(255,255,255,0.05)",border:"1px solid rgba(255,255,255,0.08)",color:"#8ab4c8",padding:11,borderRadius:11,cursor:"pointer",fontWeight:700 }}>Cancel</button>
          <button onClick={()=>handleDeleteClient(confirmDelete)} style={{ flex:1,background:"linear-gradient(135deg,#dc2626,#b91c1c)",border:"none",color:"#fff",padding:11,borderRadius:11,cursor:"pointer",fontWeight:700 }}>Delete</button>
        </div>
      </Modal>}
    </div>
  );
    }
