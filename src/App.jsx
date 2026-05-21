import { useState, useEffect, useMemo } from "react";

// ─── STORAGE HELPERS ──────────────────────────────────────────────────────────
async function loadClients() {
  try {
    const data = localStorage.getItem("creda_clients");
    return data ? JSON.parse(data) : [];
  } catch { return []; }
}

async function saveClients(clients) {
  try {
    localStorage.setItem("creda_clients", JSON.stringify(clients));
    localStorage.setItem("creda_backup_" + new Date().toISOString().split("T")[0], JSON.stringify(clients));
  } catch (e) { console.error("Save failed:", e); }
}

function exportData(clients) {
  const blob = new Blob([JSON.stringify(clients, null, 2)], { type: "application/json" });
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
      if (Array.isArray(data)) {
        localStorage.setItem("creda_clients", JSON.stringify(data));
        onSuccess(data);
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
function isHoliday(dateStr) {
  return FIXED_HOLIDAYS.includes(dateStr.slice(5)) || VARIABLE_HOLIDAYS.has(dateStr);
}

// ─── UTILS ────────────────────────────────────────────────────────────────────
function generateId(prefix = "CL") {
  return prefix + Date.now().toString().slice(-6) + Math.floor(Math.random() * 100);
}
function formatCurrency(amount) {
  return "₦" + Number(amount || 0).toLocaleString("en-NG", { minimumFractionDigits: 2 });
}
function formatDate(dateStr) {
  if (!dateStr) return "—";
  return new Date(dateStr).toLocaleDateString("en-NG", { day:"2-digit", month:"short", year:"numeric" });
}
function formatMonth(yearMonthStr) {
  if (!yearMonthStr) return "—";
  const [year, month] = yearMonthStr.split("-");
  return new Date(year, parseInt(month) - 1, 1).toLocaleDateString("en-NG", { month:"long", year:"numeric" });
}
function getRepaymentDays(startDate, count, excludeWH) {
  const days = [];
  const cursor = new Date(startDate);
  cursor.setDate(cursor.getDate() + 1);
  while (days.length < count) {
    const dateStr = cursor.toISOString().split("T")[0];
    const day = cursor.getDay();
    if (excludeWH) { if (day !== 0 && day !== 6 && !isHoliday(dateStr)) days.push(dateStr); }
    else days.push(dateStr);
    cursor.setDate(cursor.getDate() + 1);
  }
  return days;
}
function calcLoanSchedule(principal, interestRate, days, startDate, excludeWeekends) {
  const totalInterest = (principal * interestRate) / 100;
  const totalRepayable = principal + totalInterest;
  const dailyPayment = totalRepayable / days;
  const repaymentDays = getRepaymentDays(startDate, days, excludeWeekends);
  const schedule = [];
  let balance = totalRepayable;
  for (let i = 0; i < days; i++) {
    balance = Math.max(0, balance - dailyPayment);
    schedule.push({
      day: i + 1, dueDate: repaymentDays[i], payment: dailyPayment,
      balance, paid: false, paidDate: null, paidAmount: 0, overpayment: 0, shortfall: 0,
    });
  }
  return { dailyPayment, totalRepayable, totalInterest, schedule };
}

// ─── SMART OVERPAYMENT ENGINE ─────────────────────────────────────────────────
// Applies a payment amount starting from a given index, cascading excess
// forward across unpaid installments. Returns the updated schedule.
function applySmartPayment(schedule, startIdx, amountPaid, paidDate) {
  let remaining = amountPaid;
  const updated = schedule.map((s, i) => ({ ...s })); // deep copy

  // Step 1: Fill the target installment first (even if partially paid before)
  // Then cascade excess forward to unpaid installments
  let i = startIdx;
  while (remaining > 0 && i < updated.length) {
    const s = updated[i];
    if (s.paid && i !== startIdx) { i++; continue; } // skip already paid (except target)

    const owed = s.payment - (s.paidAmount || 0);
    if (owed <= 0 && i !== startIdx) { i++; continue; }

    const applying = Math.min(remaining, owed > 0 ? owed : s.payment);

    if (i === startIdx) {
      // Always overwrite the target slot
      const totalForThisSlot = (s.paidAmount || 0) + remaining;
      const covers = Math.min(totalForThisSlot, s.payment);
      const excess = totalForThisSlot - s.payment;
      updated[i] = {
        ...s,
        paid: totalForThisSlot >= s.payment,
        paidAmount: covers > s.payment ? s.payment : Math.min(totalForThisSlot, s.payment),
        paidDate: paidDate,
        overpayment: Math.max(0, excess),
        shortfall: Math.max(0, s.payment - totalForThisSlot),
      };
      remaining = Math.max(0, excess);
    } else {
      // Cascade excess into subsequent unpaid slots
      if (!s.paid) {
        const slot = updated[i];
        const alreadyPaid = slot.paidAmount || 0;
        const stillOwed = slot.payment - alreadyPaid;
        const applyHere = Math.min(remaining, stillOwed);
        const newPaid = alreadyPaid + applyHere;
        const newRemaining = remaining - applyHere;
        updated[i] = {
          ...slot,
          paid: newPaid >= slot.payment,
          paidAmount: newPaid,
          paidDate: newPaid >= slot.payment ? paidDate : slot.paidDate,
          overpayment: newPaid > slot.payment ? newPaid - slot.payment : 0,
          shortfall: Math.max(0, slot.payment - newPaid),
        };
        remaining = newRemaining;
      }
    }
    i++;
  }

  // Step 2: Recalculate rolling balances
  let runningBalance = updated[0] ? (updated[0].payment * updated.length) : 0;
  // Use totalRepayable approach: start from sum of all payments
  const totalDue = updated.reduce((sum, s) => sum + s.payment, 0);
  let bal = totalDue;
  for (let j = 0; j < updated.length; j++) {
    const paid = updated[j].paidAmount || 0;
    bal = Math.max(0, bal - paid);
    updated[j].balance = bal;
  }

  return updated;
}

// ─── FINANCIAL ENGINE ─────────────────────────────────────────────────────────
function computeFinancials(clients) {
  let totalCapital=0, totalExpectedInterest=0, interestEarned=0, principalCollected=0, totalCollected=0;
  clients.forEach(c => {
    (c.loans||[]).forEach(l => {
      const principal=l.principal||0, interest=l.totalInterest||0, totalDue=l.totalRepayable||0;
      const iR = totalDue>0 ? interest/totalDue : 0;
      const pR = totalDue>0 ? principal/totalDue : 0;
      totalCapital += principal; totalExpectedInterest += interest;
      (l.schedule||[]).forEach(s => {
        if (s.paid||s.paidAmount>0) {
          const r=s.paidAmount||0; totalCollected+=r; interestEarned+=r*iR; principalCollected+=r*pR;
        }
      });
    });
  });
  const outstandingPrincipal=Math.max(0,totalCapital-principalCollected);
  const trueProfit=interestEarned;
  const realROI=totalCapital>0?(trueProfit/totalCapital)*100:0;
  const collectionRate=(totalExpectedInterest+totalCapital)>0?(totalCollected/(totalExpectedInterest+totalCapital))*100:0;
  return { totalCapital,totalExpectedInterest,interestEarned,principalCollected,outstandingPrincipal,trueProfit,realROI,collectionRate,totalCollected };
}

function computeClientFinancials(client) {
  let capital=0,expectedInterest=0,interestEarned=0,principalCollected=0,totalCollected=0;
  (client.loans||[]).forEach(l => {
    const principal=l.principal||0,interest=l.totalInterest||0,totalDue=l.totalRepayable||0;
    const iR=totalDue>0?interest/totalDue:0, pR=totalDue>0?principal/totalDue:0;
    capital+=principal; expectedInterest+=interest;
    (l.schedule||[]).forEach(s => {
      if(s.paid||s.paidAmount>0){const r=s.paidAmount||0;totalCollected+=r;interestEarned+=r*iR;principalCollected+=r*pR;}
    });
  });
  const outstandingPrincipal=Math.max(0,capital-principalCollected);
  return{capital,expectedInterest,interestEarned,principalCollected,outstandingPrincipal,trueProfit:interestEarned,realROI:capital>0?(interestEarned/capital)*100:0,totalCollected};
}

function computeLoanFinancials(loan) {
  const principal=loan.principal||0,interest=loan.totalInterest||0,totalDue=loan.totalRepayable||0;
  const iR=totalDue>0?interest/totalDue:0,pR=totalDue>0?principal/totalDue:0;
  let collected=0,interestEarned=0,principalCollected=0;
  (loan.schedule||[]).forEach(s=>{if(s.paid||s.paidAmount>0){const r=s.paidAmount||0;collected+=r;interestEarned+=r*iR;principalCollected+=r*pR;}});
  const paidCount=(loan.schedule||[]).filter(s=>s.paid).length;
  const totalCount=loan.days||1;
  const completionRate=(paidCount/totalCount)*100;
  const outstandingPrincipal=Math.max(0,principal-principalCollected);
  const trueProfit=interestEarned;
  const realROI=principal>0?(trueProfit/principal)*100:0;
  const collectionRate=totalDue>0?(collected/totalDue)*100:0;
  const today=new Date();
  const overdueCount=(loan.schedule||[]).filter(s=>!s.paid&&new Date(s.dueDate)<today).length;
  const onTimeCount=(loan.schedule||[]).filter(s=>s.paid&&s.paidDate<=s.dueDate).length;
  const lateCount=(loan.schedule||[]).filter(s=>s.paid&&s.paidDate>s.dueDate).length;
  const partialCount=(loan.schedule||[]).filter(s=>!s.paid&&s.paidAmount>0&&s.paidAmount<s.payment).length;
  return{collected,interestEarned,principalCollected,outstandingPrincipal,trueProfit,realROI,collectionRate,completionRate,paidCount,totalCount,overdueCount,onTimeCount,lateCount,partialCount};
}

// ─── ICONS ────────────────────────────────────────────────────────────────────
const Icon = ({ name, size=16 }) => {
  const icons = {
    plus:<svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>,
    user:<svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="8" r="4"/><path d="M4 20c0-4 3.6-7 8-7s8 3 8 7"/></svg>,
    check:<svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>,
    back:<svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 18 9 12 15 6"/></svg>,
    dashboard:<svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/></svg>,
    trash:<svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6"/><path d="M10 11v6M14 11v6M9 6V4h6v2"/></svg>,
    cloud:<svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M18 10h-1.26A8 8 0 109 20h9a5 5 0 000-10z"/></svg>,
    edit:<svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 113 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>,
    ledger:<svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/><polyline points="10 9 9 9 8 9"/></svg>,
    search:<svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>,
    lock:<svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>,
    unlock:<svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 9.9-1"/></svg>,
    trend:<svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="23 6 13.5 15.5 8.5 10.5 1 18"/><polyline points="17 6 23 6 23 12"/></svg>,
    shield:<svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>,
    chevronDown:<svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="6 9 12 15 18 9"/></svg>,
    chevronUp:<svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="18 15 12 9 6 15"/></svg>,
    calendar:<svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>,
    lightning:<svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>,
  };
  return icons[name] || null;
};

// ─── BASE COMPONENTS ──────────────────────────────────────────────────────────
function Modal({ title, onClose, children }) {
  return (
    <div style={{position:"fixed",inset:0,background:"rgba(0,8,20,0.92)",zIndex:1000,display:"flex",alignItems:"center",justifyContent:"center",padding:16,backdropFilter:"blur(8px)"}}>
      <div style={{background:"#0d1b2a",border:"1px solid rgba(100,200,255,0.12)",borderRadius:20,width:"100%",maxWidth:480,maxHeight:"92vh",overflowY:"auto",boxShadow:"0 40px 100px rgba(0,0,0,0.7)"}}>
        <div style={{padding:"20px 22px 14px",borderBottom:"1px solid rgba(255,255,255,0.06)",display:"flex",justifyContent:"space-between",alignItems:"center",position:"sticky",top:0,background:"#0d1b2a",zIndex:1,borderRadius:"20px 20px 0 0"}}>
          <h2 style={{margin:0,fontSize:17,fontWeight:700,color:"#e8f4fd"}}>{title}</h2>
          <button onClick={onClose} style={{background:"rgba(255,255,255,0.06)",border:"none",color:"#8ab4c8",width:30,height:30,borderRadius:8,cursor:"pointer",fontSize:17}}>×</button>
        </div>
        <div style={{padding:"20px 22px"}}>{children}</div>
      </div>
    </div>
  );
}

function Field({ label, children }) {
  return (
    <div style={{marginBottom:14}}>
      <label style={{display:"block",fontSize:11,color:"#5a7a90",marginBottom:5,letterSpacing:0.8,textTransform:"uppercase"}}>{label}</label>
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
    <div style={{background:"rgba(255,255,255,0.03)",border:"1px solid rgba(255,255,255,0.06)",borderRadius:14,padding:"16px 18px",borderTop:`2px solid ${accent}`}}>
      <div style={{fontSize:10,color:"#4a6880",letterSpacing:1.2,textTransform:"uppercase",marginBottom:7}}>{label}</div>
      <div style={{fontSize:19,fontWeight:800,color:"#e8f4fd",fontFamily:"'Courier New',monospace",letterSpacing:-0.5}}>{value}</div>
      {sub && <div style={{fontSize:10,color:"#3a5060",marginTop:3}}>{sub}</div>}
    </div>
  );
}

function Badge({ color, bg, children }) {
  return <span style={{fontSize:10,padding:"2px 9px",borderRadius:20,background:bg,color,fontWeight:700,letterSpacing:0.5}}>{children}</span>;
}

function FinanceMetricRow({ label, value, valueColor="#e8f4fd", icon, sub }) {
  return (
    <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"10px 14px",background:"rgba(255,255,255,0.02)",borderRadius:10,border:"1px solid rgba(255,255,255,0.04)"}}>
      <div style={{display:"flex",alignItems:"center",gap:8}}>
        {icon && <span style={{color:valueColor,opacity:0.8}}>{icon}</span>}
        <div>
          <div style={{fontSize:11,color:"#5a7a90",letterSpacing:0.6}}>{label}</div>
          {sub && <div style={{fontSize:9,color:"#3a4a58",marginTop:1}}>{sub}</div>}
        </div>
      </div>
      <div style={{fontSize:14,fontWeight:800,color:valueColor,fontFamily:"'Courier New',monospace"}}>{value}</div>
    </div>
  );
}

function ROIGauge({ roi }) {
  const capped = Math.min(Math.max(roi,0),100);
  const color = roi>=20?"#22c55e":roi>=10?"#f59e0b":"#ef4444";
  return (
    <div style={{marginTop:4}}>
      <div style={{display:"flex",justifyContent:"space-between",marginBottom:5}}>
        <span style={{fontSize:10,color:"#5a7a90"}}>ROI Performance</span>
        <span style={{fontSize:12,fontWeight:800,color,fontFamily:"'Courier New',monospace"}}>{roi.toFixed(2)}%</span>
      </div>
      <div style={{height:6,background:"rgba(255,255,255,0.06)",borderRadius:4,overflow:"hidden"}}>
        <div style={{height:"100%",width:`${capped}%`,background:`linear-gradient(90deg,${color},${color}cc)`,borderRadius:4,transition:"width 0.6s"}}/>
      </div>
    </div>
  );
}

// ─── INSTALLMENT ROW ──────────────────────────────────────────────────────────
function InstallmentRow({ s, i, loan, isActive, isAdmin, today, onPayment, onOverride }) {
  const isFullyPaid = s.paid;
  const isPartial = !s.paid && s.paidAmount > 0 && s.paidAmount < s.payment;
  const isShortfall = isPartial;
  const isOverdue = !s.paid && new Date(s.dueDate) < today;
  const isCoveredByOverpay = !s.paid && s.paidAmount >= s.payment;
  const unpaid = loan.schedule.filter(x => !x.paid);
  const isNext = isActive && !s.paid && unpaid.length > 0 && unpaid[0] === s;
  const isLate = s.paid && s.paidDate > s.dueDate;
  const hasOverpay = s.overpayment > 0;

  // Determine border & background color
  let borderColor = "rgba(100,180,255,0.06)";
  let bgColor = "rgba(255,255,255,0.01)";

  if (isFullyPaid) { borderColor="rgba(34,197,94,0.15)"; bgColor="rgba(34,197,94,0.04)"; }
  else if (isCoveredByOverpay) { borderColor="rgba(34,197,94,0.2)"; bgColor="rgba(34,197,94,0.06)"; }
  else if (isShortfall) { borderColor="rgba(239,68,68,0.35)"; bgColor="rgba(239,68,68,0.08)"; }
  else if (isOverdue) { borderColor="rgba(239,68,68,0.2)"; bgColor="rgba(239,68,68,0.05)"; }
  else if (isNext) { borderColor="rgba(96,165,250,0.2)"; bgColor="rgba(96,165,250,0.03)"; }

  const amountColor = isFullyPaid ? "#4ade80" : isShortfall ? "#f87171" : isOverdue ? "#f87171" : "#c8dde8";

  return (
    <div style={{background:bgColor,border:`1px solid ${borderColor}`,borderRadius:10,padding:"10px 12px",display:"flex",justifyContent:"space-between",alignItems:"flex-start"}}>
      {/* Left */}
      <div style={{display:"flex",gap:9,alignItems:"flex-start"}}>
        {/* Day badge */}
        <div style={{
          width:28,height:28,borderRadius:7,fontSize:10,fontWeight:700,flexShrink:0,
          display:"flex",alignItems:"center",justifyContent:"center",
          background: isFullyPaid?"rgba(34,197,94,0.15)":isShortfall?"rgba(239,68,68,0.2)":isOverdue?"rgba(239,68,68,0.12)":"rgba(255,255,255,0.05)",
          color: isFullyPaid?"#4ade80":isShortfall?"#f87171":isOverdue?"#f87171":"#4a6880",
        }}>
          {isFullyPaid ? <Icon name="check" size={11}/> : `${i+1}`}
        </div>

        <div>
          {/* Amount line */}
          <div style={{display:"flex",alignItems:"center",gap:5,marginBottom:3,flexWrap:"wrap"}}>
            <span style={{fontSize:12,fontWeight:700,color:amountColor,fontFamily:"'Courier New',monospace"}}>
              {formatCurrency(isFullyPaid ? s.paidAmount : s.payment)}
            </span>
            {isNext && <Badge color="#60a5fa" bg="rgba(96,165,250,0.12)">NEXT</Badge>}
            {isOverdue && !isShortfall && <Badge color="#f87171" bg="rgba(239,68,68,0.1)">OVERDUE</Badge>}
            {isLate && <Badge color="#f59e0b" bg="rgba(245,158,11,0.1)">LATE</Badge>}
            {isShortfall && <Badge color="#f87171" bg="rgba(239,68,68,0.15)">SHORTFALL</Badge>}
            {isCoveredByOverpay && !isFullyPaid && <Badge color="#22c55e" bg="rgba(34,197,94,0.12)">COVERED</Badge>}
            {hasOverpay && isFullyPaid && <Badge color="#a78bfa" bg="rgba(167,139,250,0.12)">OVERPAID</Badge>}
          </div>

          {/* Shortfall details */}
          {isShortfall && (
            <div style={{fontSize:9,color:"#f87171",marginBottom:2}}>
              Paid {formatCurrency(s.paidAmount)} · Still needs {formatCurrency(s.payment - s.paidAmount)}
            </div>
          )}

          {/* Overpayment cascade note */}
          {hasOverpay && (
            <div style={{fontSize:9,color:"#a78bfa",marginBottom:2}}>
              +{formatCurrency(s.overpayment)} cascaded to next days
            </div>
          )}

          {/* Date line */}
          <div style={{fontSize:9,color:"#3a5a70"}}>
            Due {formatDate(s.dueDate)}
            {s.paidDate && ` · Paid ${formatDate(s.paidDate)}`}
          </div>
        </div>
      </div>

      {/* Right */}
      <div style={{display:"flex",alignItems:"center",gap:6,flexShrink:0}}>
        <div style={{textAlign:"right"}}>
          <div style={{fontSize:8,color:"#3a5a70"}}>BAL</div>
          <div style={{fontSize:10,color:"#8ab4c8",fontFamily:"'Courier New',monospace"}}>{formatCurrency(s.balance)}</div>
        </div>
        {!isFullyPaid && isActive && (
          <button onClick={e=>{e.stopPropagation();onPayment(loan,i);}} style={{background:"linear-gradient(135deg,#22c55e,#16a34a)",border:"none",color:"#000",padding:"5px 10px",borderRadius:6,cursor:"pointer",fontWeight:700,fontSize:10}}>Pay</button>
        )}
        {isAdmin && (
          <button onClick={e=>{e.stopPropagation();onOverride(loan,i,s);}} style={{background:"rgba(245,158,11,0.1)",border:"1px solid rgba(245,158,11,0.3)",color:"#f59e0b",borderRadius:6,padding:"4px 7px",cursor:"pointer",fontSize:9}}>Edit</button>
        )}
      </div>
    </div>
  );
}

// ─── LOAN CYCLE CARD ──────────────────────────────────────────────────────────
function LoanCycleCard({ loan, cycleNumber, totalCycles, isAdmin, clientId, onPayment, onOverride, today }) {
  const [expanded, setExpanded] = useState(cycleNumber === totalCycles);
  const [scheduleOpen, setScheduleOpen] = useState(cycleNumber === totalCycles);
  const fin = computeLoanFinancials(loan);
  const isActive = loan.status === "active";
  const isCompleted = loan.status === "completed";
  const perfColor = fin.completionRate>=90?"#22c55e":fin.completionRate>=60?"#f59e0b":"#ef4444";
  const roiColor = fin.realROI>=20?"#22c55e":fin.realROI>=10?"#f59e0b":"#ef4444";
  const stars = Math.round((fin.completionRate/100)*5);

  // Overpayment summary for this loan
  const totalOverpaid = (loan.schedule||[]).reduce((s,r)=>s+(r.overpayment||0),0);
  const totalShortfall = (loan.schedule||[]).filter(s=>!s.paid&&s.paidAmount>0).reduce((sum,s)=>sum+(s.payment-s.paidAmount),0);
  const daysAdvanced = (loan.schedule||[]).filter(s=>s.paid&&!isActive).length;

  return (
    <div style={{background:isActive?"linear-gradient(135deg,rgba(34,197,94,0.04),rgba(59,130,246,0.03))":"rgba(255,255,255,0.015)",border:`1px solid ${isActive?"rgba(34,197,94,0.2)":isCompleted?"rgba(96,165,250,0.12)":"rgba(255,255,255,0.06)"}`,borderRadius:16,overflow:"hidden",marginBottom:12}}>

      {/* Header */}
      <div onClick={()=>setExpanded(!expanded)} style={{padding:"14px 16px",cursor:"pointer",borderBottom:expanded?"1px solid rgba(255,255,255,0.05)":"none"}}>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start"}}>
          <div style={{display:"flex",alignItems:"center",gap:10}}>
            <div style={{width:38,height:38,borderRadius:10,flexShrink:0,background:isActive?"linear-gradient(135deg,#16a34a,#22c55e)":isCompleted?"linear-gradient(135deg,#1d4ed8,#3b82f6)":"rgba(255,255,255,0.06)",display:"flex",alignItems:"center",justifyContent:"center",fontSize:13,fontWeight:800,color:"#fff"}}>
              {isCompleted?<Icon name="check" size={16}/>:`L${cycleNumber}`}
            </div>
            <div>
              <div style={{display:"flex",alignItems:"center",gap:6,marginBottom:2}}>
                <span style={{fontSize:13,fontWeight:700,color:"#e8f4fd"}}>Loan Cycle {cycleNumber}{cycleNumber===totalCycles&&isActive&&<span style={{fontSize:10,color:"#22c55e",marginLeft:6}}>(Current)</span>}</span>
                <Badge color={isActive?"#4ade80":"#60a5fa"} bg={isActive?"rgba(34,197,94,0.12)":"rgba(96,165,250,0.12)"}>{isActive?"ACTIVE":"COMPLETED"}</Badge>
              </div>
              <div style={{fontSize:10,color:"#3a5a70"}}>{formatDate(loan.startDate)} · {loan.days} days · {loan.interestRate}% interest</div>
            </div>
          </div>
          <div style={{display:"flex",alignItems:"center",gap:8}}>
            <div style={{textAlign:"right"}}>
              <div style={{fontSize:13,fontWeight:800,color:"#60a5fa",fontFamily:"'Courier New',monospace"}}>{formatCurrency(loan.principal)}</div>
              <div style={{fontSize:9,color:"#3a5a70",marginTop:1}}>Principal</div>
            </div>
            <div style={{color:"#3a5a70"}}>{expanded?<Icon name="chevronUp" size={14}/>:<Icon name="chevronDown" size={14}/>}</div>
          </div>
        </div>

        {/* Progress bar */}
        <div style={{marginTop:10}}>
          <div style={{display:"flex",justifyContent:"space-between",fontSize:9,color:"#3a5a70",marginBottom:4}}>
            <span>{fin.paidCount}/{fin.totalCount} installments paid</span>
            <span style={{color:perfColor}}>{fin.completionRate.toFixed(0)}% complete</span>
          </div>
          <div style={{height:4,background:"rgba(255,255,255,0.06)",borderRadius:4,overflow:"hidden"}}>
            <div style={{height:"100%",width:`${fin.completionRate}%`,background:`linear-gradient(90deg,${perfColor},${perfColor}99)`,borderRadius:4,transition:"width 0.5s"}}/>
          </div>
        </div>

        {/* Overpayment / shortfall indicators */}
        {(totalOverpaid > 0 || totalShortfall > 0 || fin.partialCount > 0) && (
          <div style={{display:"flex",gap:8,marginTop:8,flexWrap:"wrap"}}>
            {totalOverpaid > 0 && (
              <div style={{background:"rgba(167,139,250,0.1)",border:"1px solid rgba(167,139,250,0.2)",borderRadius:6,padding:"3px 8px",fontSize:9,color:"#a78bfa"}}>
                ⚡ {formatCurrency(totalOverpaid)} overpaid & cascaded
              </div>
            )}
            {totalShortfall > 0 && (
              <div style={{background:"rgba(239,68,68,0.1)",border:"1px solid rgba(239,68,68,0.2)",borderRadius:6,padding:"3px 8px",fontSize:9,color:"#f87171"}}>
                ⚠ {formatCurrency(totalShortfall)} still owed
              </div>
            )}
          </div>
        )}
      </div>

      {/* Expanded body */}
      {expanded && (
        <div style={{padding:"14px 16px"}}>

          {/* Overpayment Impact Panel */}
          {totalOverpaid > 0 && (
            <div style={{background:"linear-gradient(135deg,rgba(167,139,250,0.08),rgba(167,139,250,0.04))",border:"1px solid rgba(167,139,250,0.2)",borderRadius:12,padding:"12px 14px",marginBottom:14}}>
              <div style={{display:"flex",alignItems:"center",gap:7,marginBottom:8}}>
                <Icon name="lightning" size={14}/>
                <span style={{fontSize:12,fontWeight:700,color:"#a78bfa"}}>Overpayment Impact</span>
              </div>
              <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8}}>
                <div style={{background:"rgba(0,0,0,0.2)",borderRadius:8,padding:"8px 10px"}}>
                  <div style={{fontSize:8,color:"#5a7a90",marginBottom:2}}>TOTAL OVERPAID</div>
                  <div style={{fontSize:12,fontWeight:700,color:"#a78bfa",fontFamily:"'Courier New',monospace"}}>{formatCurrency(totalOverpaid)}</div>
                </div>
                <div style={{background:"rgba(0,0,0,0.2)",borderRadius:8,padding:"8px 10px"}}>
                  <div style={{fontSize:8,color:"#5a7a90",marginBottom:2}}>DAYS CLEARED AHEAD</div>
                  <div style={{fontSize:12,fontWeight:700,color:"#4ade80",fontFamily:"'Courier New',monospace"}}>
                    {(loan.schedule||[]).filter(s=>s.paid&&(s.overpayment>0||(s.paidAmount>=s.payment&&s.paidDate<s.dueDate))).length} days
                  </div>
                </div>
                <div style={{background:"rgba(0,0,0,0.2)",borderRadius:8,padding:"8px 10px",gridColumn:"span 2"}}>
                  <div style={{fontSize:8,color:"#5a7a90",marginBottom:2}}>REMAINING BALANCE AFTER OVERPAYMENTS</div>
                  <div style={{fontSize:12,fontWeight:700,color:"#60a5fa",fontFamily:"'Courier New',monospace"}}>
                    {formatCurrency((loan.schedule||[]).slice(-1)[0]?.balance||0)}
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Shortfall Panel */}
          {totalShortfall > 0 && (
            <div style={{background:"rgba(239,68,68,0.06)",border:"1px solid rgba(239,68,68,0.2)",borderRadius:12,padding:"12px 14px",marginBottom:14}}>
              <div style={{fontSize:12,fontWeight:700,color:"#f87171",marginBottom:6}}>⚠️ Outstanding Shortfall</div>
              <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8}}>
                <div style={{background:"rgba(0,0,0,0.2)",borderRadius:8,padding:"8px 10px"}}>
                  <div style={{fontSize:8,color:"#5a7a90",marginBottom:2}}>UNDERPAID SLOTS</div>
                  <div style={{fontSize:12,fontWeight:700,color:"#f87171"}}>{fin.partialCount} days</div>
                </div>
                <div style={{background:"rgba(0,0,0,0.2)",borderRadius:8,padding:"8px 10px"}}>
                  <div style={{fontSize:8,color:"#5a7a90",marginBottom:2}}>AMOUNT STILL OWED</div>
                  <div style={{fontSize:12,fontWeight:700,color:"#f87171",fontFamily:"'Courier New',monospace"}}>{formatCurrency(totalShortfall)}</div>
                </div>
              </div>
            </div>
          )}

          {/* Performance Summary */}
          <div style={{marginBottom:14}}>
            <div style={{fontSize:11,color:"#5a7a90",fontWeight:700,letterSpacing:0.8,marginBottom:8,textTransform:"uppercase"}}>Performance Summary</div>
            <div style={{display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:8}}>
              {[
                ["Principal",formatCurrency(loan.principal),"#93c5fd"],
                ["Interest",`${loan.interestRate}%`,"#c4b5fd"],
                ["Daily Pay",formatCurrency(loan.dailyPayment),"#60a5fa"],
                ["Total Due",formatCurrency(loan.totalRepayable),"#e8f4fd"],
                ["Collected",formatCurrency(fin.collected),"#4ade80"],
                ["Outstanding",formatCurrency(Math.max(0,loan.totalRepayable-fin.collected)),fin.outstandingPrincipal>0?"#f87171":"#4ade80"],
              ].map(([label,val,color])=>(
                <div key={label} style={{background:"rgba(255,255,255,0.02)",borderRadius:9,padding:"9px 10px",border:"1px solid rgba(255,255,255,0.04)"}}>
                  <div style={{fontSize:8,color:"#3a5a70",marginBottom:3,textTransform:"uppercase"}}>{label}</div>
                  <div style={{fontSize:11,fontWeight:700,color,fontFamily:"'Courier New',monospace"}}>{val}</div>
                </div>
              ))}
            </div>
          </div>

          {/* Financial Intelligence */}
          <div style={{marginBottom:14,background:"rgba(0,0,0,0.2)",borderRadius:12,padding:"12px 14px"}}>
            <div style={{fontSize:11,color:"#5a7a90",fontWeight:700,letterSpacing:0.8,marginBottom:10,textTransform:"uppercase"}}>Financial Intelligence</div>
            <div style={{display:"flex",flexDirection:"column",gap:7}}>
              {[
                ["Interest Earned",formatCurrency(fin.interestEarned),"#a78bfa"],
                ["True Profit",formatCurrency(fin.trueProfit),"#22c55e"],
                ["Real ROI",`${fin.realROI.toFixed(2)}%`,roiColor],
                ["Collection Rate",`${fin.collectionRate.toFixed(1)}%`,"#f59e0b"],
              ].map(([l,v,c])=>(
                <div key={l} style={{display:"flex",justifyContent:"space-between",alignItems:"center"}}>
                  <span style={{fontSize:11,color:"#8ab4c8"}}>{l}</span>
                  <span style={{fontSize:12,fontWeight:700,color:c,fontFamily:"'Courier New',monospace"}}>{v}</span>
                </div>
              ))}
              <div style={{height:4,background:"rgba(255,255,255,0.06)",borderRadius:4,overflow:"hidden"}}>
                <div style={{height:"100%",width:`${Math.min(fin.realROI,100)}%`,background:roiColor,borderRadius:4}}/>
              </div>
            </div>
          </div>

          {/* Repayment Behavior */}
          <div style={{marginBottom:14}}>
            <div style={{fontSize:11,color:"#5a7a90",fontWeight:700,letterSpacing:0.8,marginBottom:8,textTransform:"uppercase"}}>Repayment Behavior</div>
            <div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:6}}>
              {[
                ["On Time",fin.onTimeCount,"#4ade80","rgba(34,197,94,0.06)","rgba(34,197,94,0.15)"],
                ["Late",fin.lateCount,"#f59e0b","rgba(245,158,11,0.06)","rgba(245,158,11,0.15)"],
                ["Partial",fin.partialCount,"#f87171","rgba(239,68,68,0.06)","rgba(239,68,68,0.15)"],
                ["Overdue",fin.overdueCount,"#ef4444","rgba(239,68,68,0.08)","rgba(239,68,68,0.2)"],
              ].map(([l,v,color,bg,border])=>(
                <div key={l} style={{background:bg,border:`1px solid ${border}`,borderRadius:10,padding:"10px 8px",textAlign:"center"}}>
                  <div style={{fontSize:16,fontWeight:800,color}}>{v}</div>
                  <div style={{fontSize:9,color:"#5a7a90",marginTop:2}}>{l}</div>
                </div>
              ))}
            </div>
          </div>

          {/* Performance Rating */}
          <div style={{background:`linear-gradient(135deg,${perfColor}10,${perfColor}05)`,border:`1px solid ${perfColor}30`,borderRadius:12,padding:"12px 14px",marginBottom:14,display:"flex",justifyContent:"space-between",alignItems:"center"}}>
            <div>
              <div style={{fontSize:11,color:perfColor,fontWeight:700,marginBottom:4}}>PERFORMANCE RATING</div>
              <div style={{display:"flex",gap:3}}>{[1,2,3,4,5].map(s=><span key={s} style={{color:s<=stars?"#f59e0b":"rgba(255,255,255,0.1)",fontSize:14}}>★</span>)}</div>
              <div style={{fontSize:10,color:"#5a7a90",marginTop:3}}>{fin.completionRate>=90?"Excellent":fin.completionRate>=60?"Average":"Poor"} · {fin.completionRate.toFixed(1)}%</div>
            </div>
            <div style={{textAlign:"right"}}>
              <div style={{fontSize:22,fontWeight:900,color:perfColor,fontFamily:"'Courier New',monospace"}}>{fin.completionRate.toFixed(0)}%</div>
              <div style={{fontSize:9,color:"#3a5a70"}}>Completion</div>
            </div>
          </div>

          {/* Dates */}
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8,marginBottom:14}}>
            {[
              ["START DATE",formatDate(loan.startDate)],
              ["LAST PAYMENT",loan.schedule?.filter(s=>s.paid).slice(-1)[0]?.paidDate?formatDate(loan.schedule.filter(s=>s.paid).slice(-1)[0].paidDate):"None yet"],
              ["LOAN ID",loan.id],
              ["SCHEDULE",loan.excludeWeekends?"Mon–Fri + Hols":"All Days"],
            ].map(([l,v])=>(
              <div key={l} style={{background:"rgba(255,255,255,0.02)",borderRadius:9,padding:"9px 11px"}}>
                <div style={{fontSize:8,color:"#3a5a70",marginBottom:2}}>{l}</div>
                <div style={{fontSize:10,color:"#c8dde8",fontWeight:600,wordBreak:"break-all"}}>{v}</div>
              </div>
            ))}
          </div>

          {/* Schedule Toggle */}
          <button onClick={()=>setScheduleOpen(!scheduleOpen)} style={{width:"100%",background:"rgba(100,180,255,0.06)",border:"1px solid rgba(100,180,255,0.12)",color:"#60a5fa",padding:"9px",borderRadius:10,cursor:"pointer",fontWeight:700,fontSize:12,display:"flex",alignItems:"center",justifyContent:"center",gap:6,marginBottom:scheduleOpen?10:0}}>
            <Icon name="calendar" size={13}/>
            {scheduleOpen?"Hide Repayment Schedule":"View Repayment Schedule"}
            {scheduleOpen?<Icon name="chevronUp" size={13}/>:<Icon name="chevronDown" size={13}/>}
          </button>

          {/* Schedule */}
          {scheduleOpen && (
            <div style={{display:"flex",flexDirection:"column",gap:6}}>
              {loan.schedule?.map((s,i) => (
                <InstallmentRow
                  key={i} s={s} i={i} loan={loan}
                  isActive={isActive} isAdmin={isAdmin} today={today}
                  onPayment={onPayment} onOverride={onOverride}
                />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── FINANCIAL PANEL ──────────────────────────────────────────────────────────
function FinancialPanel({ fin, isClient=false, expandFinancials, setExpandFinancials }) {
  const roiColor = fin.realROI>=20?"#22c55e":fin.realROI>=10?"#f59e0b":"#ef4444";
  return (
    <div style={{background:"linear-gradient(135deg,rgba(16,30,50,0.9),rgba(10,20,40,0.95))",border:"1px solid rgba(100,180,255,0.1)",borderRadius:16,overflow:"hidden",marginBottom:20}}>
      <div style={{background:"linear-gradient(135deg,rgba(59,130,246,0.12),rgba(34,197,94,0.08))",padding:"14px 16px",borderBottom:"1px solid rgba(100,180,255,0.08)",display:"flex",justifyContent:"space-between",alignItems:"center"}}>
        <div style={{display:"flex",alignItems:"center",gap:8}}>
          <Icon name="trend" size={16}/>
          <div>
            <div style={{fontSize:13,fontWeight:800,color:"#e8f4fd"}}>{isClient?"Client Intelligence":"Portfolio Intelligence"}</div>
            <div style={{fontSize:10,color:"#3a5a70",marginTop:1}}>{isClient?"Per-client capital & return breakdown":"Real-time portfolio metrics"}</div>
          </div>
        </div>
        {!isClient && setExpandFinancials && (
          <button onClick={()=>setExpandFinancials(!expandFinancials)} style={{background:"rgba(100,180,255,0.08)",border:"none",borderRadius:8,color:"#60a5fa",padding:"5px 12px",fontSize:11,cursor:"pointer",fontWeight:600}}>
            {expandFinancials?"Collapse":"Expand"}
          </button>
        )}
      </div>
      {(isClient||expandFinancials) && (
        <div style={{padding:"14px 16px",display:"flex",flexDirection:"column",gap:8}}>
          <FinanceMetricRow label="Total Capital Deployed" sub="Sum of all principal issued" value={formatCurrency(fin.totalCapital??fin.capital)} valueColor="#60a5fa" icon={<Icon name="shield" size={13}/>}/>
          <FinanceMetricRow label="Outstanding Principal" sub="Capital not yet recovered" value={formatCurrency(fin.outstandingPrincipal)} valueColor={fin.outstandingPrincipal>0?"#f87171":"#4ade80"} icon={<Icon name="shield" size={13}/>}/>
          <FinanceMetricRow label="Interest Earned" sub="Interest portion of received payments" value={formatCurrency(fin.interestEarned)} valueColor="#a78bfa" icon={<Icon name="trend" size={13}/>}/>
          <FinanceMetricRow label="Expected Total Interest" sub="Full interest if all loans complete" value={formatCurrency(fin.totalExpectedInterest??fin.expectedInterest)} valueColor="#c4b5fd" icon={<Icon name="trend" size={13}/>}/>
          <div style={{padding:"12px 14px",background:"linear-gradient(135deg,rgba(34,197,94,0.08),rgba(34,197,94,0.04))",borderRadius:10,border:"1px solid rgba(34,197,94,0.15)",display:"flex",justifyContent:"space-between",alignItems:"center"}}>
            <div>
              <div style={{fontSize:11,color:"#4ade80",fontWeight:700}}>TRUE PROFIT</div>
              <div style={{fontSize:9,color:"#3a6050",marginTop:2}}>Interest received as cash</div>
            </div>
            <div style={{fontSize:18,fontWeight:900,color:"#22c55e",fontFamily:"'Courier New',monospace"}}>{formatCurrency(fin.trueProfit)}</div>
          </div>
          <div style={{padding:"12px 14px",background:"linear-gradient(135deg,rgba(168,85,247,0.08),rgba(168,85,247,0.03))",borderRadius:10,border:`1px solid ${roiColor}33`}}>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:8}}>
              <div>
                <div style={{fontSize:11,color:roiColor,fontWeight:700}}>REAL ROI %</div>
                <div style={{fontSize:9,color:"#3a4a58",marginTop:2}}>True Profit ÷ Capital × 100</div>
              </div>
              <div style={{background:`${roiColor}20`,border:`1px solid ${roiColor}40`,borderRadius:8,padding:"4px 10px"}}>
                <span style={{fontSize:16,fontWeight:900,color:roiColor,fontFamily:"'Courier New',monospace"}}>{fin.realROI.toFixed(2)}%</span>
              </div>
            </div>
            <ROIGauge roi={fin.realROI}/>
          </div>
          {!isClient && (
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"10px 14px",background:"rgba(255,255,255,0.02)",borderRadius:10,border:"1px solid rgba(255,255,255,0.04)"}}>
              <div>
                <div style={{fontSize:11,color:"#5a7a90"}}>Collection Rate</div>
                <div style={{fontSize:9,color:"#3a4a58",marginTop:1}}>Total received vs total expected</div>
              </div>
              <div>
                <div style={{fontSize:14,fontWeight:800,color:"#f59e0b",fontFamily:"'Courier New',monospace",textAlign:"right"}}>{fin.collectionRate.toFixed(1)}%</div>
                <div style={{width:80,height:4,background:"rgba(255,255,255,0.06)",borderRadius:4,marginTop:4,overflow:"hidden"}}>
                  <div style={{height:"100%",width:`${Math.min(fin.collectionRate,100)}%`,background:"#f59e0b",borderRadius:4}}/>
                </div>
              </div>
            </div>
          )}
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8}}>
            <div style={{padding:"10px 12px",background:"rgba(96,165,250,0.06)",borderRadius:10,border:"1px solid rgba(96,165,250,0.12)"}}>
              <div style={{fontSize:9,color:"#3a5a70",marginBottom:4}}>PRINCIPAL RECOVERED</div>
              <div style={{fontSize:12,fontWeight:700,color:"#60a5fa",fontFamily:"'Courier New',monospace"}}>{formatCurrency(fin.principalCollected)}</div>
            </div>
            <div style={{padding:"10px 12px",background:"rgba(248,113,113,0.05)",borderRadius:10,border:"1px solid rgba(248,113,113,0.1)"}}>
              <div style={{fontSize:9,color:"#3a5a70",marginBottom:4}}>CAPITAL AT RISK</div>
              <div style={{fontSize:12,fontWeight:700,color:"#f87171",fontFamily:"'Courier New',monospace"}}>{formatCurrency(fin.outstandingPrincipal)}</div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── MAIN APP ─────────────────────────────────────────────────────────────────
export default function App() {
  const [clients, setClients] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [savedFlash, setSavedFlash] = useState(false);
  const [view, setView] = useState("dashboard");
  const [selectedClientId, setSelectedClientId] = useState(null);
  const [activeTab, setActiveTab] = useState("loans");

  const [isAdmin, setIsAdmin] = useState(false);
  const [showAdminLogin, setShowAdminLogin] = useState(false);
  const [adminPinInput, setAdminPinInput] = useState("");

  const [showAddClient, setShowAddClient] = useState(false);
  const [showEditClient, setShowEditClient] = useState(null);
  const [showAddLoan, setShowAddLoan] = useState(false);
  const [showPayment, setShowPayment] = useState(null);
  const [paymentAmount, setPaymentAmount] = useState("");
  const [confirmDelete, setConfirmDelete] = useState(null);
  const [showSettings, setShowSettings] = useState(false);
  const [showSavingsTx, setShowSavingsTx] = useState(null);
  const [savingsAmount, setSavingsAmount] = useState("");
  const [adminDirectSavingsInput, setAdminDirectSavingsInput] = useState("");
  const [adminEditInstallment, setAdminEditInstallment] = useState(null);
  const [adminInstOverride, setAdminInstOverride] = useState({paid:false,paidAmount:"",dueDate:"",paidDate:""});

  const [clientSearch, setClientSearch] = useState("");
  const [clientFilter, setClientFilter] = useState("all");
  const [expandMonthlyHistory, setExpandMonthlyHistory] = useState(false);
  const [expandFinancials, setExpandFinancials] = useState(true);

  const [newClient, setNewClient] = useState({name:"",phone:"",address:"",idNumber:""});
  const [newLoan, setNewLoan] = useState({principal:"",interestRate:"15",days:"30",startDate:new Date().toISOString().split("T")[0],excludeWeekends:true});

  // Payment preview state
  const [paymentPreview, setPaymentPreview] = useState(null);

  useEffect(()=>{loadClients().then(data=>{setClients(data);setLoading(false);});},[]);

  const persistClients = async(updated)=>{setSaving(true);await saveClients(updated);setSaving(false);setSavedFlash(true);setTimeout(()=>setSavedFlash(false),1800);};
  const updateClients=(updated)=>{setClients(updated);persistClients(updated);};

  const today = new Date();
  const selectedClient = clients.find(c=>c.id===selectedClientId);
  const globalFinancials = useMemo(()=>computeFinancials(clients),[clients]);

  const monthlyHistory = useMemo(()=>{
    const map={};
    clients.forEach(c=>{(c.loans||[]).forEach(l=>{
      const key=(l.issuedAt||l.startDate||new Date().toISOString()).slice(0,7);
      if(!map[key]) map[key]={disbursed:0,expected:0,collected:0,interest:0};
      map[key].disbursed+=l.principal||0; map[key].expected+=l.totalRepayable||0; map[key].interest+=l.totalInterest||0;
      (l.schedule||[]).forEach(s=>{if(s.paid||s.paidAmount>0) map[key].collected+=s.paidAmount||0;});
    });});
    return Object.entries(map).map(([month,d])=>({month,disbursed:d.disbursed,expected:d.expected,collected:d.collected,interest:d.interest,outstanding:Math.max(0,d.expected-d.collected)})).sort((a,b)=>b.month.localeCompare(a.month));
  },[clients]);

  const stats = useMemo(()=>{
    let totalDisbursed=0,totalExpected=0,totalCollected=0,overdueCount=0;
    clients.forEach(c=>{(c.loans||[]).forEach(l=>{
      totalDisbursed+=l.principal||0; totalExpected+=l.totalRepayable||0;
      (l.schedule||[]).forEach(s=>{if(s.paid||s.paidAmount>0) totalCollected+=s.paidAmount||0; else if(new Date(s.dueDate)<today) overdueCount++;});
    });});
    const totalSavings=clients.reduce((a,c)=>a+(c.savingsBalance||0),0);
    return{totalDisbursed,totalExpected,totalCollected,outstanding:totalExpected-totalCollected,overdueCount,totalSavings};
  },[clients]);

  const globalTransactions = useMemo(()=>{
    const tx=[];
    clients.forEach(c=>{(c.loans||[]).forEach(l=>{(l.schedule||[]).forEach(s=>{if((s.paid||s.paidAmount>0)&&s.paidAmount>0) tx.push({clientId:c.id,clientName:c.name,loanId:l.id,day:s.day,totalDays:l.days,paidAmount:s.paidAmount,paidDate:s.paidDate,dueDate:s.dueDate,overpayment:s.overpayment||0,shortfall:s.shortfall||0});});});});
    return tx.sort((a,b)=>new Date(b.paidDate)-new Date(a.paidDate));
  },[clients]);

  const filteredClients = useMemo(()=>{
    return clients.filter(c=>{
      const match=c.name.toLowerCase().includes(clientSearch.toLowerCase())||c.phone.includes(clientSearch)||c.id.toLowerCase().includes(clientSearch.toLowerCase());
      const active=c.loans?.find(l=>l.status==="active");
      const hasLoans=c.loans&&c.loans.length>0;
      if(clientFilter==="active") return match&&active;
      if(clientFilter==="completed") return match&&!active&&hasLoans;
      if(clientFilter==="none") return match&&!hasLoans;
      return match;
    });
  },[clients,clientSearch,clientFilter]);

  // ── PAYMENT PREVIEW ───────────────────────────────────────────────────────
  const computePaymentPreview = (loan, scheduleIdx, amount) => {
    if (!amount || amount <= 0) return null;
    const simSchedule = applySmartPayment(loan.schedule, scheduleIdx, amount, new Date().toISOString().split("T")[0]);
    const daysBefore = loan.schedule.filter(s=>s.paid).length;
    const daysAfter = simSchedule.filter(s=>s.paid).length;
    const daysCleared = daysAfter - daysBefore;
    const expectedAmount = loan.dailyPayment;
    const isOver = amount > expectedAmount;
    const isUnder = amount < expectedAmount;
    const remainingBal = simSchedule[simSchedule.length-1]?.balance || 0;
    return { daysCleared, isOver, isUnder, remainingBal, simSchedule };
  };

  // ── ACTIONS ───────────────────────────────────────────────────────────────
  const handleAddClient=()=>{
    if(!newClient.name.trim()||!newClient.phone.trim()) return;
    updateClients([{...newClient,id:generateId("CL"),loans:[],savingsBalance:0,savingsLogs:[],createdAt:new Date().toISOString().split("T")[0]},...clients]);
    setNewClient({name:"",phone:"",address:"",idNumber:""}); setShowAddClient(false);
  };

  const handleUpdateClient=()=>{
    if(!showEditClient?.name.trim()) return;
    updateClients(clients.map(c=>c.id===showEditClient.id?showEditClient:c));
    setShowEditClient(null);
  };

  const handleAdminVerify=()=>{
    if(adminPinInput==="2026"){setIsAdmin(true);setShowAdminLogin(false);setAdminPinInput("");}
    else alert("⚠️ Incorrect Admin PIN.");
  };

  const handleAddLoan=()=>{
    if(!newLoan.principal||!selectedClientId) return;
    const p=parseFloat(newLoan.principal),r=parseFloat(newLoan.interestRate),d=parseInt(newLoan.days);
    const{dailyPayment,totalRepayable,totalInterest,schedule}=calcLoanSchedule(p,r,d,newLoan.startDate,newLoan.excludeWeekends);
    const loan={id:generateId("LN"),principal:p,interestRate:r,days:d,startDate:newLoan.startDate,dailyPayment,totalRepayable,totalInterest,schedule,status:"active",issuedAt:new Date().toISOString(),excludeWeekends:newLoan.excludeWeekends};
    updateClients(clients.map(c=>c.id===selectedClientId?{...c,loans:[...(c.loans||[]),loan]}:c));
    setNewLoan({principal:"",interestRate:"15",days:"30",startDate:new Date().toISOString().split("T")[0],excludeWeekends:true});
    setShowAddLoan(false);
  };

  // ── SMART PAYMENT HANDLER ─────────────────────────────────────────────────
  const handlePayment=()=>{
    const amount=parseFloat(paymentAmount);
    if(!amount||amount<=0||!showPayment) return;
    const{clientId,loanId,scheduleIdx}=showPayment;

    const updated=clients.map(c=>{
      if(c.id!==clientId) return c;
      return{...c,loans:c.loans.map(l=>{
        if(l.id!==loanId) return l;
        // Apply smart payment with cascade
        const newSchedule=applySmartPayment(l.schedule,scheduleIdx,amount,new Date().toISOString().split("T")[0]);
        const isCompleted=newSchedule.every(s=>s.paid||(s.paidAmount>0&&s.paidAmount>=s.payment));
        return{...l,schedule:newSchedule,status:newSchedule.every(s=>s.paid)?"completed":"active"};
      })};
    });

    updateClients(updated);
    setPaymentAmount(""); setShowPayment(null); setPaymentPreview(null);
  };

  const handleSavingsTransaction=()=>{
    const amount=parseFloat(savingsAmount);
    if(!amount||amount<=0||!showSavingsTx) return;
    const{type,client}=showSavingsTx;
    const updated=clients.map(c=>{
      if(c.id!==client.id) return c;
      const cur=c.savingsBalance||0;
      if(type==="withdraw"&&amount>cur){alert("⚠️ Insufficient savings!");return c;}
      const newBal=type==="deposit"?cur+amount:cur-amount;
      const log={id:generateId("TX"),date:new Date().toISOString().split("T")[0],type,amount,balanceAfter:newBal};
      return{...c,savingsBalance:newBal,savingsLogs:[log,...(c.savingsLogs||[])]};
    });
    updateClients(updated); setSavingsAmount(""); setShowSavingsTx(null);
  };

  const handleAdminSavingsAdjustment=()=>{
    const newBal=parseFloat(adminDirectSavingsInput);
    if(isNaN(newBal)||!showSavingsTx) return;
    const{client}=showSavingsTx;
    const updated=clients.map(c=>{
      if(c.id!==client.id) return c;
      const log={id:generateId("TX"),date:new Date().toISOString().split("T")[0],type:"admin_adjustment",amount:Math.abs(newBal-(c.savingsBalance||0)),balanceAfter:newBal};
      return{...c,savingsBalance:newBal,savingsLogs:[log,...(c.savingsLogs||[])]};
    });
    updateClients(updated); setAdminDirectSavingsInput(""); setShowSavingsTx(null);
  };

  const handleAdminInstallmentOverride=()=>{
    if(!adminEditInstallment) return;
    const{client,loan,idx}=adminEditInstallment;
    const pAmt=parseFloat(adminInstOverride.paidAmount)||0;
    const updated=clients.map(c=>{
      if(c.id!==client.id) return c;
      return{...c,loans:c.loans.map(l=>{
        if(l.id!==loan.id) return l;
        const s=l.schedule.map((s,i)=>i===idx?{...s,paid:adminInstOverride.paid,dueDate:adminInstOverride.dueDate,paidDate:adminInstOverride.paid?(adminInstOverride.paidDate||new Date().toISOString().split("T")[0]):null,paidAmount:adminInstOverride.paid?pAmt:0,overpayment:adminInstOverride.paid&&pAmt>s.payment?pAmt-s.payment:0,shortfall:adminInstOverride.paid&&pAmt<s.payment?s.payment-pAmt:0}:s);
        let running=l.totalRepayable;
        const rc=s.map(s=>{if(s.paid||s.paidAmount>0) running=Math.max(0,running-s.paidAmount); return{...s,balance:running};});
        return{...l,schedule:rc,status:rc.every(s=>s.paid)?"completed":"active"};
      })};
    });
    updateClients(updated); setAdminEditInstallment(null);
  };

  const handleDeleteClient=(id)=>{updateClients(clients.filter(c=>c.id!==id));setConfirmDelete(null);setView("clients");};

  const getClientLoanSummary=(c)=>{
    const active=c.loans?.find(l=>l.status==="active");
    const overdue=active?.schedule?.filter(s=>!s.paid&&new Date(s.dueDate)<today).length||0;
    const paid=active?.schedule?.filter(s=>s.paid).length||0;
    const total=active?.schedule?.length||0;
    const balance=active?(active.schedule.find(s=>!s.paid)?.balance??0):0;
    return{active,overdue,paid,total,balance};
  };

  if(loading) return(
    <div style={{minHeight:"100vh",background:"#060f1a",display:"flex",alignItems:"center",justifyContent:"center",flexDirection:"column",gap:16}}>
      <div style={{width:48,height:48,borderRadius:14,background:"linear-gradient(135deg,#22c55e,#0ea5e9)",display:"flex",alignItems:"center",justifyContent:"center",fontSize:24}}>💰</div>
      <div style={{color:"#4a7090",fontSize:14}}>CREDA Engine Starting...</div>
    </div>
  );

  // ── DASHBOARD ─────────────────────────────────────────────────────────────
  const Dashboard=()=>(
    <div>
      <div style={{marginBottom:22}}>
        <h1 style={{margin:0,fontSize:24,fontWeight:800,color:"#e8f4fd",letterSpacing:-0.5}}>Dashboard</h1>
        <p style={{margin:"4px 0 0",color:"#3a5a70",fontSize:13}}>{clients.length} clients · {clients.reduce((a,c)=>a+(c.loans?.filter(l=>l.status==="active").length||0),0)} active loans</p>
      </div>
      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10,marginBottom:20}}>
        <StatCard label="Total Disbursed" value={formatCurrency(stats.totalDisbursed)} accent="#3b82f6"/>
        <StatCard label="Total Collected" value={formatCurrency(stats.totalCollected)} accent="#22c55e"/>
        <StatCard label="Outstanding" value={formatCurrency(stats.outstanding)} accent="#f59e0b"/>
        <StatCard label="Total Savings" value={formatCurrency(stats.totalSavings)} accent="#a855f7"/>
        <div style={{gridColumn:"span 2"}}><StatCard label="Overdue Installments" value={stats.overdueCount+" late runs"} accent="#ef4444"/></div>
      </div>
      <FinancialPanel fin={globalFinancials} expandFinancials={expandFinancials} setExpandFinancials={setExpandFinancials}/>
      <div style={{background:"rgba(255,255,255,0.02)",border:"1px solid rgba(100,180,255,0.06)",borderRadius:14,padding:16,marginBottom:20}}>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center"}}>
          <div><h3 style={{margin:0,fontSize:13,fontWeight:700,color:"#93c5fd",textTransform:"uppercase"}}>Monthly Breakdown</h3><p style={{margin:"2px 0 0",fontSize:11,color:"#3a5a70"}}>Historical monthly performance</p></div>
          <button onClick={()=>setExpandMonthlyHistory(!expandMonthlyHistory)} style={{background:"rgba(147,197,253,0.1)",border:"none",borderRadius:8,color:"#93c5fd",padding:"5px 12px",fontSize:11,cursor:"pointer",fontWeight:600}}>{expandMonthlyHistory?"Hide":"View Months"}</button>
        </div>
        {expandMonthlyHistory&&(
          <div style={{marginTop:16,display:"flex",flexDirection:"column",gap:10}}>
            {monthlyHistory.length===0?<div style={{fontSize:11,color:"#3a5a70",textAlign:"center"}}>No data yet.</div>:monthlyHistory.map(item=>(
              <div key={item.month} style={{padding:"10px 12px",background:"rgba(0,0,0,0.2)",borderRadius:10,borderLeft:"3px solid #22c55e"}}>
                <div style={{fontWeight:700,color:"#e8f4fd",fontSize:12,marginBottom:6}}>{formatMonth(item.month)}</div>
                <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr 1fr",gap:6}}>
                  {[["DISBURSED",item.disbursed,"#93c5fd"],["COLLECTED",item.collected,"#4ade80"],["INTEREST",item.interest,"#c4b5fd"],["OUTSTANDING",item.outstanding,"#f87171"]].map(([l,v,col])=>(
                    <div key={l}><div style={{fontSize:8,color:"#3a5a70"}}>{l}</div><div style={{fontSize:10,fontWeight:600,color:col,fontFamily:"'Courier New',monospace"}}>{formatCurrency(v)}</div></div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:12}}>
        <div style={{fontSize:14,fontWeight:700,color:"#c8dde8"}}>Recent Clients</div>
        <button onClick={()=>setView("clients")} style={{background:"none",border:"none",color:"#3b82f6",fontSize:12,cursor:"pointer"}}>See all →</button>
      </div>
      {clients.length===0?(
        <div style={{border:"1px dashed rgba(100,180,255,0.1)",borderRadius:14,padding:40,textAlign:"center",color:"#2a4050"}}>
          <div style={{fontSize:36,marginBottom:10}}>💳</div>
          <div style={{marginBottom:14,fontSize:14}}>No clients yet</div>
          <button onClick={()=>{setView("clients");setShowAddClient(true);}} style={{background:"linear-gradient(135deg,#22c55e,#16a34a)",border:"none",color:"#000",padding:"9px 22px",borderRadius:10,cursor:"pointer",fontWeight:700,fontSize:13}}>+ Add First Client</button>
        </div>
      ):(
        <div style={{display:"flex",flexDirection:"column",gap:8}}>
          {clients.slice(0,5).map(c=>{
            const{active,overdue,paid,total,balance}=getClientLoanSummary(c);
            return(
              <div key={c.id} onClick={()=>{setSelectedClientId(c.id);setView("detail");}} style={{background:"rgba(255,255,255,0.02)",border:"1px solid rgba(100,180,255,0.07)",borderRadius:12,padding:"12px 15px",cursor:"pointer",display:"flex",justifyContent:"space-between",alignItems:"center"}}>
                <div style={{display:"flex",alignItems:"center",gap:10}}>
                  <div style={{width:36,height:36,borderRadius:10,background:"linear-gradient(135deg,#1d4ed8,#3b82f6)",display:"flex",alignItems:"center",justifyContent:"center",fontWeight:800,fontSize:15,color:"#fff",flexShrink:0}}>{c.name.charAt(0).toUpperCase()}</div>
                  <div><div style={{fontWeight:600,color:"#dceef8",fontSize:14}}>{c.name}</div><div style={{fontSize:11,color:"#3a5a70"}}>{c.phone}</div></div>
                </div>
                <div style={{textAlign:"right"}}>
                  {active?(<><div style={{fontSize:12,fontWeight:700,color:"#60a5fa",fontFamily:"'Courier New',monospace"}}>{formatCurrency(balance)}</div><div style={{fontSize:10,color:overdue>0?"#f87171":"#3a6050"}}>{overdue>0?`${overdue} overdue`:`${paid}/${total} paid`}</div></>):<div style={{fontSize:11,color:"#2a4050"}}>No active loan</div>}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );

  // ── CLIENTS LIST ──────────────────────────────────────────────────────────
  const ClientsList=()=>(
    <div>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:20}}>
        <h1 style={{margin:0,fontSize:22,fontWeight:800,color:"#e8f4fd"}}>Clients</h1>
        <button onClick={()=>setShowAddClient(true)} style={{background:"linear-gradient(135deg,#22c55e,#16a34a)",border:"none",color:"#000",padding:"9px 16px",borderRadius:11,cursor:"pointer",fontWeight:700,fontSize:13,display:"flex",alignItems:"center",gap:6}}><Icon name="plus" size={13}/>New</button>
      </div>
      <div style={{display:"flex",flexDirection:"column",gap:10,marginBottom:16}}>
        <div style={{position:"relative"}}><span style={{position:"absolute",left:12,top:11,color:"#5a7a90"}}><Icon name="search" size={14}/></span><input type="text" style={{...inputStyle,paddingLeft:36}} placeholder="Search by name, ID or phone..." value={clientSearch} onChange={e=>setClientSearch(e.target.value)}/></div>
        <div style={{display:"flex",gap:6,overflowX:"auto",paddingBottom:4}}>
          {[{id:"all",label:"All"},{id:"active",label:"Active"},{id:"completed",label:"Completed"},{id:"none",label:"No Loan"}].map(f=>(
            <button key={f.id} onClick={()=>setClientFilter(f.id)} style={{background:clientFilter===f.id?"rgba(34,197,94,0.15)":"rgba(255,255,255,0.03)",border:clientFilter===f.id?"1px solid rgba(34,197,94,0.4)":"1px solid rgba(255,255,255,0.06)",color:clientFilter===f.id?"#4ade80":"#8ab4c8",padding:"6px 12px",borderRadius:8,fontSize:11,fontWeight:600,cursor:"pointer",whiteSpace:"nowrap"}}>{f.label}</button>
          ))}
        </div>
      </div>
      {filteredClients.length===0?(
        <div style={{textAlign:"center",padding:60,color:"#2a4050",border:"1px dashed rgba(100,180,255,0.08)",borderRadius:14}}><div style={{fontSize:36,marginBottom:10}}>👤</div><div>No clients found.</div></div>
      ):(
        <div style={{display:"flex",flexDirection:"column",gap:9}}>
          {filteredClients.map(c=>{
            const{active,overdue,paid,total}=getClientLoanSummary(c);
            return(
              <div key={c.id} onClick={()=>{setSelectedClientId(c.id);setView("detail");}} style={{background:"rgba(255,255,255,0.025)",border:"1px solid rgba(100,180,255,0.07)",borderRadius:13,padding:"14px 16px",cursor:"pointer"}}>
                <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:active?10:0}}>
                  <div style={{display:"flex",gap:10,alignItems:"center"}}>
                    <div style={{width:40,height:40,borderRadius:11,background:"linear-gradient(135deg,#1e3a5f,#2563eb)",display:"flex",alignItems:"center",justifyContent:"center",fontWeight:800,fontSize:16,color:"#93c5fd",flexShrink:0}}>{c.name.charAt(0).toUpperCase()}</div>
                    <div><div style={{fontWeight:700,color:"#dceef8",fontSize:14}}>{c.name}</div><div style={{fontSize:11,color:"#3a5a70",marginTop:1}}>{c.id} · {c.loans?.length||0} cycle{c.loans?.length!==1?"s":""}</div></div>
                  </div>
                  <Badge color={active?"#4ade80":c.loans?.length>0?"#94a3b8":"#3a5a70"} bg={active?"rgba(34,197,94,0.12)":c.loans?.length>0?"rgba(148,163,184,0.1)":"rgba(100,130,150,0.08)"}>{active?"Active":c.loans?.length>0?"Done":"No Loan"}</Badge>
                </div>
                {active&&(<div><div style={{display:"flex",justifyContent:"space-between",fontSize:11,color:"#3a5a70",marginBottom:5}}><span>{paid}/{total} paid</span><span style={{color:overdue>0?"#f87171":"#3a6050"}}>{overdue>0?`${overdue} overdue`:"On track ✓"}</span></div><div style={{height:3,background:"rgba(255,255,255,0.06)",borderRadius:4,overflow:"hidden"}}><div style={{height:"100%",width:`${(paid/total)*100}%`,background:"linear-gradient(90deg,#22c55e,#4ade80)",borderRadius:4}}/></div></div>)}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );

  // ── LEDGER ────────────────────────────────────────────────────────────────
  const Ledger=()=>(
    <div>
      <div style={{marginBottom:22}}><h1 style={{margin:0,fontSize:22,fontWeight:800,color:"#e8f4fd"}}>Ledger Log</h1><p style={{margin:"4px 0 0",color:"#3a5a70",fontSize:13}}>All received payments in chronological order</p></div>
      {globalTransactions.length===0?(<div style={{textAlign:"center",padding:60,color:"#2a4050",border:"1px dashed rgba(100,180,255,0.08)",borderRadius:14}}><div style={{fontSize:36,marginBottom:10}}>📝</div><div>No transactions yet.</div></div>):(
        <div style={{display:"flex",flexDirection:"column",gap:8}}>
          {globalTransactions.map((tx,idx)=>(
            <div key={idx} style={{background:"rgba(255,255,255,0.02)",border:`1px solid ${tx.overpayment>0?"rgba(167,139,250,0.15)":tx.shortfall>0?"rgba(239,68,68,0.15)":"rgba(100,180,255,0.05)"}`,borderRadius:12,padding:"12px 14px",display:"flex",justifyContent:"space-between",alignItems:"center"}}>
              <div>
                <div style={{fontWeight:700,color:"#e8f4fd",fontSize:13}}>{tx.clientName}</div>
                <div style={{fontSize:10,color:"#3a5a70",marginTop:2}}>Day {tx.day}/{tx.totalDays} · Paid {formatDate(tx.paidDate)}</div>
                {tx.overpayment>0&&<div style={{fontSize:9,color:"#a78bfa",marginTop:1}}>⚡ +{formatCurrency(tx.overpayment)} overpaid</div>}
                {tx.shortfall>0&&<div style={{fontSize:9,color:"#f87171",marginTop:1}}>⚠ -{formatCurrency(tx.shortfall)} shortfall</div>}
              </div>
              <div style={{textAlign:"right"}}>
                <div style={{fontSize:13,color:tx.overpayment>0?"#a78bfa":tx.shortfall>0?"#f87171":"#4ade80",fontWeight:700,fontFamily:"'Courier New',monospace"}}>+{formatCurrency(tx.paidAmount)}</div>
                <div style={{fontSize:9,color:"#3a5a70",marginTop:2}}>Due: {formatDate(tx.dueDate)}</div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );

  // ── DETAIL ────────────────────────────────────────────────────────────────
  const Detail=()=>{
    if(!selectedClient) return null;
    const c=selectedClient;
    const activeLoan=c.loans?.find(l=>l.status==="active");
    const allLoans=[...(c.loans||[])].reverse();
    const clientFin=useMemo(()=>computeClientFinancials(c),[c.id,c.loans]);

    return(
      <div>
        <div style={{display:"flex",alignItems:"center",gap:12,marginBottom:20}}>
          <button onClick={()=>setView("clients")} style={{background:"rgba(255,255,255,0.06)",border:"none",color:"#8ab4c8",width:34,height:34,borderRadius:9,cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center"}}><Icon name="back" size={15}/></button>
          <div style={{width:44,height:44,borderRadius:12,background:"linear-gradient(135deg,#1d4ed8,#3b82f6)",display:"flex",alignItems:"center",justifyContent:"center",fontWeight:800,fontSize:18,color:"#fff",flexShrink:0}}>{c.name.charAt(0).toUpperCase()}</div>
          <div style={{flexGrow:1}}><div style={{fontSize:18,fontWeight:800,color:"#e8f4fd"}}>{c.name}</div><div style={{fontSize:11,color:"#3a5a70"}}>{c.id} · {allLoans.length} cycle{allLoans.length!==1?"s":""} · Joined {formatDate(c.createdAt)}</div></div>
          <button onClick={()=>setShowEditClient(c)} style={{background:"rgba(255,255,255,0.04)",border:"1px solid rgba(255,255,255,0.08)",color:"#3b82f6",width:32,height:32,borderRadius:8,cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center"}}><Icon name="edit" size={14}/></button>
        </div>

        <div style={{background:"rgba(100,180,255,0.04)",border:"1px solid rgba(100,180,255,0.08)",borderRadius:13,padding:"14px 16px",marginBottom:16,display:"grid",gridTemplateColumns:"1fr 1fr",gap:10}}>
          <div><div style={{fontSize:10,color:"#3a5a70",marginBottom:3}}>PHONE</div><div style={{color:"#c8dde8",fontSize:13}}>{c.phone||"—"}</div></div>
          <div><div style={{fontSize:10,color:"#3a5a70",marginBottom:3}}>ID/BVN</div><div style={{color:"#c8dde8",fontSize:13}}>{c.idNumber||"—"}</div></div>
          <div><div style={{fontSize:10,color:"#3a5a70",marginBottom:3}}>SAVINGS</div><div style={{color:"#c084fc",fontSize:13,fontWeight:700}}>{formatCurrency(c.savingsBalance||0)}</div></div>
          <div><div style={{fontSize:10,color:"#3a5a70",marginBottom:3}}>TOTAL CYCLES</div><div style={{color:"#4ade80",fontSize:13,fontWeight:700}}>{allLoans.length}</div></div>
          <div style={{gridColumn:"1/-1"}}><div style={{fontSize:10,color:"#3a5a70",marginBottom:3}}>ADDRESS</div><div style={{color:"#c8dde8",fontSize:13}}>{c.address||"—"}</div></div>
        </div>

        <FinancialPanel fin={clientFin} isClient={true}/>

        <div style={{display:"flex",gap:8,marginBottom:16}}>
          {!activeLoan&&<button onClick={()=>setShowAddLoan(true)} style={{flex:1,background:"linear-gradient(135deg,#22c55e,#16a34a)",border:"none",color:"#000",padding:"10px",borderRadius:10,cursor:"pointer",fontWeight:700,fontSize:13,display:"flex",alignItems:"center",justifyContent:"center",gap:6}}><Icon name="plus" size={13}/>Issue New Loan</button>}
          <button onClick={()=>setShowSavingsTx({type:"deposit",client:c})} style={{flex:1,background:"rgba(168,85,247,0.12)",border:"1px solid rgba(168,85,247,0.25)",color:"#c084fc",padding:"10px",borderRadius:10,cursor:"pointer",fontWeight:700,fontSize:13}}>📥 Savings</button>
        </div>

        <div style={{display:"flex",gap:3,marginBottom:16,background:"rgba(255,255,255,0.03)",borderRadius:10,padding:3}}>
          {[{id:"loans",label:`Loan Cycles (${allLoans.length})`},{id:"savings",label:"Savings"}].map(tab=>(
            <button key={tab.id} onClick={()=>setActiveTab(tab.id)} style={{flex:1,padding:"8px 4px",borderRadius:8,border:"none",cursor:"pointer",background:activeTab===tab.id?"rgba(100,180,255,0.1)":"transparent",color:activeTab===tab.id?(tab.id==="savings"?"#c084fc":"#93c5fd"):"#3a5a70",fontWeight:600,fontSize:12}}>{tab.label}</button>
          ))}
        </div>

        {activeTab==="loans"&&(
          <div>
            {allLoans.length===0?(
              <div style={{border:"1px dashed rgba(100,180,255,0.08)",borderRadius:13,padding:40,textAlign:"center",color:"#2a4050"}}><div style={{fontSize:32,marginBottom:10}}>💰</div><div style={{fontSize:13}}>No loan cycles yet.</div></div>
            ):(
              <div>
                <div style={{background:"rgba(59,130,246,0.06)",border:"1px solid rgba(59,130,246,0.12)",borderRadius:12,padding:"12px 14px",marginBottom:14,display:"flex",gap:16,overflowX:"auto"}}>
                  {[
                    [allLoans.length,"TOTAL CYCLES","#60a5fa"],
                    [allLoans.filter(l=>l.status==="completed").length,"COMPLETED","#22c55e"],
                    [allLoans.filter(l=>l.status==="active").length,"ACTIVE","#f59e0b"],
                    [formatCurrency(clientFin.trueProfit).replace("₦",""),"PROFIT","#a78bfa"],
                  ].map(([v,l,col])=>(
                    <div key={l} style={{flexShrink:0,textAlign:"center",minWidth:60}}>
                      <div style={{fontSize:18,fontWeight:900,color:col}}>{v}</div>
                      <div style={{fontSize:9,color:"#3a5a70",marginTop:2}}>{l}</div>
                    </div>
                  ))}
                </div>
                {allLoans.map((loan,idx)=>(
                  <LoanCycleCard key={loan.id} loan={loan} cycleNumber={allLoans.length-idx} totalCycles={allLoans.length} isAdmin={isAdmin} clientId={c.id} today={today}
                    onPayment={(loan,scheduleIdx)=>{setShowPayment({clientId:c.id,loanId:loan.id,scheduleIdx});setPaymentAmount(loan.dailyPayment.toFixed(2));setPaymentPreview(null);}}
                    onOverride={(loan,idx,s)=>{setAdminEditInstallment({client:c,loan,idx});setAdminInstOverride({paid:s.paid,paidAmount:s.paidAmount||loan.dailyPayment.toFixed(2),dueDate:s.dueDate,paidDate:s.paidDate||new Date().toISOString().split("T")[0]});}}
                  />
                ))}
              </div>
            )}
          </div>
        )}

        {activeTab==="savings"&&(
          <div>
            <div style={{background:"rgba(168,85,247,0.05)",border:"1px solid rgba(168,85,247,0.15)",borderRadius:14,padding:16,display:"flex",flexDirection:"column",gap:14,marginBottom:16}}>
              <div style={{textAlign:"center"}}><div style={{fontSize:10,color:"#a855f7",fontWeight:700,letterSpacing:1}}>SAVINGS BALANCE</div><div style={{fontSize:28,fontWeight:800,color:"#c084fc",fontFamily:"'Courier New',monospace",marginTop:6}}>{formatCurrency(c.savingsBalance||0)}</div></div>
              <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10}}>
                <button onClick={()=>setShowSavingsTx({type:"deposit",client:c})} style={{background:"#a855f7",border:"none",color:"#fff",fontWeight:700,padding:"10px",borderRadius:10,cursor:"pointer",fontSize:13}}>📥 Deposit</button>
                <button onClick={()=>setShowSavingsTx({type:"withdraw",client:c})} style={{background:"transparent",border:"1px solid #a855f7",color:"#c084fc",fontWeight:700,padding:"10px",borderRadius:10,cursor:"pointer",fontSize:13}}>📤 Withdraw</button>
              </div>
            </div>
            {(!c.savingsLogs||c.savingsLogs.length===0)?(<div style={{textAlign:"center",padding:20,color:"#2a4050",fontSize:12,border:"1px dashed rgba(168,85,247,0.08)",borderRadius:10}}>No savings history yet.</div>):(
              <div style={{display:"flex",flexDirection:"column",gap:6}}>
                {c.savingsLogs.map((log,idx)=>(
                  <div key={idx} style={{background:"rgba(255,255,255,0.01)",border:"1px solid rgba(168,85,247,0.08)",borderRadius:10,padding:"10px 12px",display:"flex",justifyContent:"space-between",alignItems:"center"}}>
                    <div><div style={{fontSize:12,fontWeight:600,color:log.type==="deposit"?"#4ade80":log.type==="withdraw"?"#f87171":"#c084fc"}}>{log.type==="deposit"?"Deposit":log.type==="withdraw"?"Withdrawal":"Admin Override"}</div><div style={{fontSize:9,color:"#3a5a70",marginTop:2}}>{formatDate(log.date)}</div></div>
                    <div style={{textAlign:"right"}}><div style={{fontSize:12,fontWeight:700,color:"#e8f4fd",fontFamily:"'Courier New',monospace"}}>{log.type==="deposit"?"+":"-"}{formatCurrency(log.amount)}</div><div style={{fontSize:9,color:"#3a5a70",marginTop:2}}>Bal: {formatCurrency(log.balanceAfter)}</div></div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        <button onClick={()=>setConfirmDelete(c.id)} style={{marginTop:22,background:"rgba(239,68,68,0.08)",border:"1px solid rgba(239,68,68,0.15)",color:"#f87171",padding:"9px 18px",borderRadius:10,cursor:"pointer",fontWeight:600,fontSize:12,display:"flex",alignItems:"center",gap:7}}><Icon name="trash" size={13}/>Delete Client</button>
      </div>
    );
  };

  // ── LAYOUT ────────────────────────────────────────────────────────────────
  return(
    <div style={{minHeight:"100vh",background:"#060f1a",fontFamily:"'Segoe UI',system-ui,sans-serif",color:"#e8f4fd"}}>
      {isAdmin&&<div style={{background:"#f59e0b",color:"#000",padding:"4px 12px",fontSize:11,fontWeight:700,textAlign:"center",display:"flex",justifyContent:"center",gap:10,alignItems:"center",position:"sticky",top:0,zIndex:1000}}>🛡️ ADMIN OVERRIDES ACTIVE<button onClick={()=>setIsAdmin(false)} style={{background:"rgba(0,0,0,0.15)",border:"none",borderRadius:4,color:"#000",fontSize:9,fontWeight:800,padding:"2px 6px",cursor:"pointer"}}>LOCK</button></div>}

      <div style={{background:"rgba(6,15,26,0.95)",borderBottom:"1px solid rgba(100,180,255,0.07)",padding:"14px 18px",display:"flex",justifyContent:"space-between",alignItems:"center",position:"sticky",top:isAdmin?28:0,zIndex:100,backdropFilter:"blur(10px)"}}>
        <div style={{display:"flex",alignItems:"center",gap:10}}>
          <div style={{width:36,height:36,borderRadius:10,background:"linear-gradient(135deg,#0a5c36,#0d7a48)",border:"1.5px solid rgba(200,146,10,0.4)",display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0}}>
            <svg width="20" height="20" viewBox="0 0 80 80" fill="none"><path d="M48 22A19 19 0 1 0 48 58" stroke="white" strokeWidth="5.5" strokeLinecap="round" fill="none"/><path d="M42 30L53 20L64 30" stroke="#c8920a" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" fill="none"/><line x1="53" y1="20" x2="53" y2="44" stroke="#c8920a" strokeWidth="4" strokeLinecap="round"/></svg>
          </div>
          <div><div style={{fontSize:14,fontWeight:800,color:"#e8f4fd",letterSpacing:1,fontFamily:"serif"}}>CREDA</div><div style={{fontSize:8,color:"rgba(200,146,10,0.7)",letterSpacing:2,textTransform:"uppercase",lineHeight:1}}>Finance</div></div>
        </div>
        <div style={{display:"flex",alignItems:"center",gap:10}}>
          {saving&&<div style={{fontSize:11,color:"#3b82f6",display:"flex",alignItems:"center",gap:4}}><Icon name="cloud" size={12}/>Saving…</div>}
          {savedFlash&&!saving&&<div style={{fontSize:11,color:"#22c55e",display:"flex",alignItems:"center",gap:4}}><Icon name="check" size={12}/>Saved ✓</div>}
          <button onClick={()=>isAdmin?setIsAdmin(false):setShowAdminLogin(true)} style={{background:isAdmin?"rgba(245,158,11,0.15)":"rgba(255,255,255,0.06)",border:isAdmin?"1px solid #f59e0b":"1px solid rgba(255,255,255,0.1)",color:isAdmin?"#f59e0b":"#8ab4c8",width:30,height:30,borderRadius:8,cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center"}}><Icon name={isAdmin?"unlock":"lock"} size={14}/></button>
          <button onClick={()=>setShowSettings(true)} style={{background:"rgba(255,255,255,0.06)",border:"1px solid rgba(255,255,255,0.1)",color:"#8ab4c8",width:30,height:30,borderRadius:8,cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center"}}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 010 2.83 2 2 0 01-2.83 0l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83-2.83l.06-.06A1.65 1.65 0 004.68 15a1.65 1.65 0 00-1.51-1H3a2 2 0 010-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 012.83-2.83l.06.06A1.65 1.65 0 009 4.68a1.65 1.65 0 001-1.51V3a2 2 0 014 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 2.83l-.06.06A1.65 1.65 0 0019.4 9a1.65 1.65 0 001.51 1H21a2 2 0 010 4h-.09a1.65 1.65 0 00-1.51 1z"/></svg>
          </button>
        </div>
      </div>

      <div style={{padding:"20px 16px 100px",maxWidth:540,margin:"0 auto"}}>
        {view==="dashboard"&&<Dashboard/>}
        {view==="clients"&&<ClientsList/>}
        {view==="ledger"&&<Ledger/>}
        {view==="detail"&&<Detail/>}
      </div>

      <div style={{position:"fixed",bottom:0,left:0,right:0,background:"rgba(6,15,26,0.97)",borderTop:"1px solid rgba(100,180,255,0.07)",display:"flex",backdropFilter:"blur(12px)",zIndex:900}}>
        {[{id:"dashboard",label:"Overview",icon:"dashboard"},{id:"clients",label:"Clients",icon:"user"},{id:"ledger",label:"Ledger",icon:"ledger"}].map(n=>{
          const active=view===n.id||(view==="detail"&&n.id==="clients");
          return(<button key={n.id} onClick={()=>setView(n.id)} style={{flex:1,padding:"12px 8px 14px",background:"transparent",border:"none",cursor:"pointer",color:active?"#22c55e":"#4a6880",display:"flex",flexDirection:"column",alignItems:"center",gap:4}}><Icon name={n.icon} size={18}/><span style={{fontSize:10,fontWeight:600,letterSpacing:0.4}}>{n.label}</span></button>);
        })}
      </div>

      {/* ── PAYMENT MODAL with Smart Preview ─────────────────────────────── */}
      {showPayment&&(()=>{
        const cl=clients.find(c=>c.id===showPayment.clientId);
        const ln=cl?.loans?.find(l=>l.id===showPayment.loanId);
        const preview=paymentPreview;
        const amount=parseFloat(paymentAmount)||0;
        const expected=ln?.dailyPayment||0;
        const isOver=amount>expected;
        const isUnder=amount>0&&amount<expected;
        return(
          <Modal title="Record Payment" onClose={()=>{setShowPayment(null);setPaymentAmount("");setPaymentPreview(null);}}>
            <div style={{textAlign:"center",marginBottom:16}}>
              <div style={{fontSize:12,color:"#3a5a70",marginBottom:4}}>Expected Daily Amount</div>
              <div style={{fontSize:26,fontWeight:800,color:"#4ade80",fontFamily:"'Courier New',monospace"}}>{formatCurrency(expected)}</div>
              <div style={{fontSize:11,color:"#3a5a70",marginTop:4}}>Day {showPayment.scheduleIdx+1} of {ln?.days}</div>
            </div>

            <Field label="Amount Received (₦)">
              <input type="number" style={inputStyle} value={paymentAmount}
                onChange={e=>{
                  setPaymentAmount(e.target.value);
                  const amt=parseFloat(e.target.value)||0;
                  if(amt>0&&ln) setPaymentPreview(computePaymentPreview(ln,showPayment.scheduleIdx,amt));
                  else setPaymentPreview(null);
                }}
                placeholder="Enter amount" autoFocus/>
            </Field>

            {/* Live smart preview */}
            {preview&&amount>0&&(
              <div style={{marginBottom:14}}>
                {isOver&&(
                  <div style={{background:"linear-gradient(135deg,rgba(167,139,250,0.1),rgba(167,139,250,0.05))",border:"1px solid rgba(167,139,250,0.25)",borderRadius:12,padding:"12px 14px"}}>
                    <div style={{display:"flex",alignItems:"center",gap:6,marginBottom:8}}><Icon name="lightning" size={13}/><span style={{fontSize:12,fontWeight:700,color:"#a78bfa"}}>Overpayment — Smart Cascade Active</span></div>
                    <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8}}>
                      <div style={{background:"rgba(0,0,0,0.2)",borderRadius:8,padding:"8px 10px"}}>
                        <div style={{fontSize:8,color:"#5a7a90",marginBottom:2}}>OVERPAYMENT</div>
                        <div style={{fontSize:12,fontWeight:700,color:"#a78bfa",fontFamily:"'Courier New',monospace"}}>{formatCurrency(amount-expected)}</div>
                      </div>
                      <div style={{background:"rgba(0,0,0,0.2)",borderRadius:8,padding:"8px 10px"}}>
                        <div style={{fontSize:8,color:"#5a7a90",marginBottom:2}}>DAYS CLEARED</div>
                        <div style={{fontSize:12,fontWeight:700,color:"#4ade80",fontFamily:"'Courier New',monospace"}}>{preview.daysCleared} day{preview.daysCleared!==1?"s":""}</div>
                      </div>
                      <div style={{background:"rgba(0,0,0,0.2)",borderRadius:8,padding:"8px 10px",gridColumn:"span 2"}}>
                        <div style={{fontSize:8,color:"#5a7a90",marginBottom:2}}>REMAINING BALANCE AFTER THIS PAYMENT</div>
                        <div style={{fontSize:12,fontWeight:700,color:"#60a5fa",fontFamily:"'Courier New',monospace"}}>{formatCurrency(preview.remainingBal)}</div>
                      </div>
                    </div>
                    <div style={{fontSize:10,color:"#6a5a80",marginTop:8}}>⚡ Excess will automatically fill upcoming installments in order</div>
                  </div>
                )}
                {isUnder&&(
                  <div style={{background:"rgba(239,68,68,0.06)",border:"1px solid rgba(239,68,68,0.2)",borderRadius:12,padding:"12px 14px"}}>
                    <div style={{fontSize:12,fontWeight:700,color:"#f87171",marginBottom:6}}>⚠️ Underpayment — Shortfall Will Be Flagged</div>
                    <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8}}>
                      <div style={{background:"rgba(0,0,0,0.2)",borderRadius:8,padding:"8px 10px"}}>
                        <div style={{fontSize:8,color:"#5a7a90",marginBottom:2}}>SHORTFALL</div>
                        <div style={{fontSize:12,fontWeight:700,color:"#f87171",fontFamily:"'Courier New',monospace"}}>{formatCurrency(expected-amount)}</div>
                      </div>
                      <div style={{background:"rgba(0,0,0,0.2)",borderRadius:8,padding:"8px 10px"}}>
                        <div style={{fontSize:8,color:"#5a7a90",marginBottom:2}}>THIS DAY STATUS</div>
                        <div style={{fontSize:11,fontWeight:700,color:"#f87171"}}>Partial / Red</div>
                      </div>
                    </div>
                    <div style={{fontSize:10,color:"#6a4040",marginTop:8}}>This installment will show in red as incomplete until fully paid.</div>
                  </div>
                )}
                {!isOver&&!isUnder&&amount===expected&&(
                  <div style={{background:"rgba(34,197,94,0.06)",border:"1px solid rgba(34,197,94,0.2)",borderRadius:12,padding:"10px 14px",textAlign:"center"}}>
                    <span style={{fontSize:12,color:"#4ade80",fontWeight:700}}>✓ Exact payment — installment will be marked complete</span>
                  </div>
                )}
              </div>
            )}

            <button onClick={handlePayment} style={{width:"100%",background:"linear-gradient(135deg,#22c55e,#16a34a)",border:"none",color:"#000",padding:"12px",borderRadius:12,cursor:"pointer",fontWeight:800,fontSize:14,marginTop:6}}>
              ✓ Confirm Payment {isOver?"(+Cascade)":isUnder?"(Partial)":""}
            </button>
          </Modal>
        );
      })()}

      {/* Admin Login */}
      {showAdminLogin&&(<Modal title="🛡️ Admin Access" onClose={()=>setShowAdminLogin(false)}><div style={{textAlign:"center",marginBottom:14,fontSize:13,color:"#8ab4c8"}}>Enter PIN to activate admin overrides.</div><Field label="Security PIN"><input type="password" style={inputStyle} value={adminPinInput} onChange={e=>setAdminPinInput(e.target.value)} onKeyDown={e=>e.key==="Enter"&&handleAdminVerify()} placeholder="Enter PIN" autoFocus/></Field><button onClick={handleAdminVerify} style={{width:"100%",background:"linear-gradient(135deg,#f59e0b,#d97706)",border:"none",color:"#000",padding:"12px",borderRadius:12,cursor:"pointer",fontWeight:800,fontSize:14}}>✓ Unlock Admin</button></Modal>)}

      {/* Admin Installment Override */}
      {adminEditInstallment&&(<Modal title="🛠️ Admin Override" onClose={()=>setAdminEditInstallment(null)}><div style={{background:"rgba(245,158,11,0.08)",border:"1px solid rgba(245,158,11,0.2)",borderRadius:10,padding:12,fontSize:12,color:"#f59e0b",marginBottom:16}}>Overriding Installment {adminEditInstallment.idx+1} for <strong>{adminEditInstallment.client.name}</strong></div><div style={{display:"flex",alignItems:"center",gap:10,marginBottom:16}}><label style={{fontSize:12,color:"#8ab4c8",fontWeight:600,flexGrow:1}}>Mark as Paid?</label><input type="checkbox" style={{width:20,height:20,accentColor:"#22c55e",cursor:"pointer"}} checked={adminInstOverride.paid} onChange={e=>setAdminInstOverride(p=>({...p,paid:e.target.checked}))}/></div>{adminInstOverride.paid&&(<><Field label="Amount Received (₦)"><input type="number" style={inputStyle} value={adminInstOverride.paidAmount} onChange={e=>setAdminInstOverride(p=>({...p,paidAmount:e.target.value}))}/></Field><Field label="Received Date"><input type="date" style={inputStyle} value={adminInstOverride.paidDate} onChange={e=>setAdminInstOverride(p=>({...p,paidDate:e.target.value}))}/></Field></>)}<Field label="Due Date"><input type="date" style={inputStyle} value={adminInstOverride.dueDate} onChange={e=>setAdminInstOverride(p=>({...p,dueDate:e.target.value}))}/></Field><button onClick={handleAdminInstallmentOverride} style={{width:"100%",background:"#f59e0b",border:"none",color:"#000",padding:"12px",borderRadius:12,cursor:"pointer",fontWeight:800,fontSize:14}}>✓ Apply Override</button></Modal>)}

      {/* Savings Modal */}
      {showSavingsTx&&(<Modal title={showSavingsTx.type==="deposit"?"📥 Deposit":"📤 Withdraw"} onClose={()=>setShowSavingsTx(null)}><div style={{background:"rgba(168,85,247,0.08)",border:"1px solid rgba(168,85,247,0.15)",borderRadius:10,padding:"9px 13px",marginBottom:16,fontSize:13,color:"#c084fc"}}>Client: <strong>{showSavingsTx.client.name}</strong><br/>Balance: <strong>{formatCurrency(showSavingsTx.client.savingsBalance||0)}</strong></div><Field label="Amount (₦)"><input type="number" style={inputStyle} value={savingsAmount} onChange={e=>setSavingsAmount(e.target.value)} placeholder="e.g. 10000" autoFocus/></Field><button onClick={handleSavingsTransaction} style={{width:"100%",background:"linear-gradient(135deg,#a855f7,#7c3aed)",border:"none",color:"#fff",padding:"12px",borderRadius:12,cursor:"pointer",fontWeight:800,fontSize:14,marginBottom:isAdmin?20:0}}>Confirm {showSavingsTx.type==="deposit"?"Deposit":"Withdrawal"}</button>{isAdmin&&(<div style={{borderTop:"1px dashed rgba(255,255,255,0.1)",paddingTop:16}}><div style={{fontSize:11,color:"#f59e0b",fontWeight:700,marginBottom:8}}>🛡️ Admin Direct Override</div><Field label="Set Balance To (₦)"><input type="number" style={{...inputStyle,border:"1px solid rgba(245,158,11,0.3)"}} value={adminDirectSavingsInput} onChange={e=>setAdminDirectSavingsInput(e.target.value)} placeholder="New absolute balance"/></Field><button onClick={handleAdminSavingsAdjustment} style={{width:"100%",background:"#f59e0b",border:"none",color:"#000",padding:"10px",borderRadius:10,cursor:"pointer",fontWeight:700,fontSize:12}}>Force Adjust</button></div>)}</Modal>)}

      {/* Add Client */}
      {showAddClient&&(<Modal title="Register New Client" onClose={()=>setShowAddClient(false)}><Field label="Full Name *"><input style={inputStyle} value={newClient.name} onChange={e=>setNewClient(p=>({...p,name:e.target.value}))} placeholder="e.g. Amaka Johnson"/></Field><Field label="Phone Number *"><input style={inputStyle} value={newClient.phone} onChange={e=>setNewClient(p=>({...p,phone:e.target.value}))} placeholder="08012345678"/></Field><Field label="Address"><input style={inputStyle} value={newClient.address} onChange={e=>setNewClient(p=>({...p,address:e.target.value}))} placeholder="Street, City"/></Field><Field label="ID / BVN Number"><input style={inputStyle} value={newClient.idNumber} onChange={e=>setNewClient(p=>({...p,idNumber:e.target.value}))} placeholder="National ID or BVN"/></Field><button onClick={handleAddClient} style={{width:"100%",background:"linear-gradient(135deg,#22c55e,#16a34a)",border:"none",color:"#000",padding:"12px",borderRadius:12,cursor:"pointer",fontWeight:800,fontSize:14,marginTop:6}}>✓ Register Client</button></Modal>)}

      {/* Edit Client */}
      {showEditClient&&(<Modal title="Edit Client" onClose={()=>setShowEditClient(null)}><Field label="Full Name *"><input style={inputStyle} value={showEditClient.name} onChange={e=>setShowEditClient(p=>({...p,name:e.target.value}))}/></Field><Field label="Phone Number *"><input style={inputStyle} value={showEditClient.phone} onChange={e=>setShowEditClient(p=>({...p,phone:e.target.value}))}/></Field><Field label="Address"><input style={inputStyle} value={showEditClient.address||""} onChange={e=>setShowEditClient(p=>({...p,address:e.target.value}))}/></Field><Field label="ID / BVN Number"><input style={inputStyle} value={showEditClient.idNumber||""} onChange={e=>setShowEditClient(p=>({...p,idNumber:e.target.value}))}/></Field><button onClick={handleUpdateClient} style={{width:"100%",background:"linear-gradient(135deg,#3b82f6,#2563eb)",border:"none",color:"#fff",padding:"12px",borderRadius:12,cursor:"pointer",fontWeight:800,fontSize:14,marginTop:6}}>✓ Save Changes</button></Modal>)}

      {/* Add Loan */}
      {showAddLoan&&(<Modal title="Issue New Loan" onClose={()=>setShowAddLoan(false)}><div style={{background:"rgba(59,130,246,0.08)",border:"1px solid rgba(59,130,246,0.15)",borderRadius:9,padding:"9px 13px",marginBottom:16,fontSize:13,color:"#93c5fd"}}>Client: <strong>{selectedClient?.name}</strong> · Cycle #{(selectedClient?.loans?.length||0)+1}</div><Field label="Principal Amount (₦) *"><input type="number" style={inputStyle} value={newLoan.principal} onChange={e=>setNewLoan(p=>({...p,principal:e.target.value}))} placeholder="e.g. 50000"/></Field><Field label="Interest Rate (% flat)"><input type="number" style={inputStyle} value={newLoan.interestRate} onChange={e=>setNewLoan(p=>({...p,interestRate:e.target.value}))}/></Field><Field label="Duration (Repayment Days)"><input type="number" style={inputStyle} value={newLoan.days} onChange={e=>setNewLoan(p=>({...p,days:e.target.value}))} placeholder="e.g. 20"/></Field><Field label="Start Date"><input type="date" style={inputStyle} value={newLoan.startDate} onChange={e=>setNewLoan(p=>({...p,startDate:e.target.value}))}/></Field><div style={{display:"flex",alignItems:"center",justifyContent:"space-between",padding:"8px 0 16px"}}><span style={{fontSize:12,color:"#8ab4c8",fontWeight:600}}>Skip Weekends & Public Holidays?</span><input type="checkbox" style={{width:20,height:20,accentColor:"#22c55e",cursor:"pointer"}} checked={newLoan.excludeWeekends} onChange={e=>setNewLoan(p=>({...p,excludeWeekends:e.target.checked}))}/></div>{newLoan.principal&&(()=>{const p=parseFloat(newLoan.principal)||0,r=parseFloat(newLoan.interestRate)||0,d=parseInt(newLoan.days)||1,total=p+(p*r/100),daily=total/d;return(<div style={{background:"rgba(34,197,94,0.06)",border:"1px solid rgba(34,197,94,0.12)",borderRadius:10,padding:"12px 14px",marginBottom:14,display:"grid",gridTemplateColumns:"1fr 1fr",gap:10}}><div><div style={{fontSize:10,color:"#3a5a70",marginBottom:3}}>TOTAL REPAYABLE</div><div style={{color:"#4ade80",fontWeight:700,fontFamily:"'Courier New',monospace",fontSize:13}}>{formatCurrency(total)}</div></div><div><div style={{fontSize:10,color:"#3a5a70",marginBottom:3}}>DAILY PAYMENT</div><div style={{color:"#60a5fa",fontWeight:700,fontFamily:"'Courier New',monospace",fontSize:13}}>{formatCurrency(daily)}</div></div><div><div style={{fontSize:10,color:"#3a5a70",marginBottom:3}}>INTEREST</div><div style={{color:"#c4b5fd",fontWeight:700,fontFamily:"'Courier New',monospace",fontSize:13}}>{formatCurrency(p*r/100)}</div></div><div><div style={{fontSize:10,color:"#3a5a70",marginBottom:3}}>CYCLE ROI</div><div style={{color:"#f59e0b",fontWeight:700,fontFamily:"'Courier New',monospace",fontSize:13}}>{r.toFixed(1)}%</div></div></div>);})()}<button onClick={handleAddLoan} style={{width:"100%",background:"linear-gradient(135deg,#22c55e,#16a34a)",border:"none",color:"#000",padding:"12px",borderRadius:12,cursor:"pointer",fontWeight:800,fontSize:14}}>✓ Issue Loan Cycle #{(selectedClient?.loans?.length||0)+1}</button></Modal>)}

      {/* Settings */}
      {showSettings&&(<Modal title="⚙️ Settings & Backup" onClose={()=>setShowSettings(false)}><div style={{display:"flex",flexDirection:"column",gap:14}}><div style={{background:"rgba(34,197,94,0.06)",border:"1px solid rgba(34,197,94,0.15)",borderRadius:10,padding:"12px 14px"}}><div style={{fontSize:12,color:"#4ade80",fontWeight:700,marginBottom:4}}>💾 Local Storage</div><div style={{fontSize:12,color:"#6b7a8d",lineHeight:1.5}}>Data is saved on this device. Export backups regularly.</div></div><div><div style={{fontSize:12,color:"#8a9bb0",marginBottom:8,fontWeight:600}}>📤 EXPORT</div><button onClick={()=>{exportData(clients);setShowSettings(false);}} style={{width:"100%",background:"linear-gradient(135deg,#22c55e,#16a34a)",border:"none",color:"#000",padding:"11px",borderRadius:10,cursor:"pointer",fontWeight:700,fontSize:13}}>Download Backup (.json)</button></div><div><div style={{fontSize:12,color:"#8a9bb0",marginBottom:8,fontWeight:600}}>📥 RESTORE</div><label style={{display:"block",width:"100%",background:"rgba(96,165,250,0.1)",border:"1px solid rgba(96,165,250,0.25)",color:"#60a5fa",padding:"11px",borderRadius:10,cursor:"pointer",fontWeight:700,fontSize:13,textAlign:"center",boxSizing:"border-box"}}>Choose Backup File<input type="file" accept=".json" style={{display:"none"}} onChange={e=>{if(e.target.files[0]){importData(e.target.files[0],data=>{setClients(data);setShowSettings(false);alert("✅ "+data.length+" clients restored.");})}}}/></label></div><div style={{borderTop:"1px solid rgba(255,255,255,0.06)",paddingTop:14}}><div style={{fontSize:12,color:"#8a9bb0",marginBottom:8,fontWeight:600}}>📊 INFO</div><div style={{background:"rgba(255,255,255,0.03)",borderRadius:8,padding:"10px 12px",display:"flex",flexDirection:"column",gap:6}}>{[["Clients",clients.length,"#fff"],["Active Loans",clients.reduce((a,c)=>a+(c.loans?.filter(l=>l.status==="active").length||0),0),"#4ade80"],["Total Cycles",clients.reduce((a,c)=>a+(c.loans?.length||0),0),"#60a5fa"],["Data Size",(JSON.stringify(clients).length/1024).toFixed(1)+" KB","#a78bfa"]].map(([l,v,col])=>(<div key={l} style={{display:"flex",justifyContent:"space-between",fontSize:12,color:"#6b7a8d"}}><span>{l}</span><span style={{color:col,fontWeight:600}}>{v}</span></div>))}</div></div><div style={{borderTop:"1px solid rgba(255,255,255,0.06)",paddingTop:14}}><div style={{fontSize:12,color:"#f87171",marginBottom:8,fontWeight:600}}>⚠️ DANGER</div><button onClick={()=>{if(window.confirm("Delete ALL data permanently?")){setClients([]);localStorage.removeItem("creda_clients");setShowSettings(false);}}} style={{width:"100%",background:"rgba(248,113,113,0.1)",border:"1px solid rgba(248,113,113,0.2)",color:"#f87171",padding:"10px",borderRadius:10,cursor:"pointer",fontWeight:600,fontSize:12}}>🗑️ Clear All Data</button></div></div></Modal>)}

      {/* Confirm Delete */}
      {confirmDelete&&(<Modal title="Delete Client?" onClose={()=>setConfirmDelete(null)}><p style={{color:"#8ab4c8",fontSize:14,marginBottom:20,lineHeight:1.6}}>This will permanently delete this client and all records.</p><div style={{display:"flex",gap:10}}><button onClick={()=>setConfirmDelete(null)} style={{flex:1,background:"rgba(255,255,255,0.05)",border:"1px solid rgba(255,255,255,0.08)",color:"#8ab4c8",padding:"11px",borderRadius:11,cursor:"pointer",fontWeight:700,fontSize:13}}>Cancel</button><button onClick={()=>handleDeleteClient(confirmDelete)} style={{flex:1,background:"linear-gradient(135deg,#dc2626,#b91c1c)",border:"none",color:"#fff",padding:"11px",borderRadius:11,cursor:"pointer",fontWeight:700,fontSize:13}}>Delete</button></div></Modal>)}
    </div>
  );
    }
