import { useState, useEffect, useMemo } from "react";

// ─── STORAGE HELPERS (localStorage — works on Vercel) ────────────────────────
async function loadClients() {
  try {
    const data = localStorage.getItem("creda_clients");
    return data ? JSON.parse(data) : [];
  } catch {
    return [];
  }
}

async function saveClients(clients) {
  try {
    localStorage.setItem("creda_clients", JSON.stringify(clients));
    // Also keep a timestamped backup
    localStorage.setItem("creda_backup_" + new Date().toISOString().split("T")[0], JSON.stringify(clients));
  } catch (e) {
    console.error("Save failed:", e);
  }
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
      } else {
        alert("Invalid backup file.");
      }
    } catch {
      alert("Could not read file. Make sure it is a valid CREDA backup.");
    }
  };
  reader.readAsText(file);
}

// ─── NIGERIAN PUBLIC HOLIDAYS (2024 - 2026) ──────────────────────────────────
const FIXED_HOLIDAYS = ["01-01", "05-01", "06-12", "10-01", "12-25", "12-26"];
const VARIABLE_HOLIDAYS = new Set([
  // 2024
  "2024-03-29", "2024-04-01", "2024-04-09", "2024-04-10", "2024-06-16", "2024-06-17", "2024-09-15", "2024-09-16",
  // 2025
  "2025-04-18", "2025-04-21", "2025-03-30", "2025-03-31", "2025-06-06", "2025-06-07", "2025-09-05",
  // 2026
  "2026-04-03", "2026-04-06", "2026-03-20", "2026-03-21", "2026-05-27", "2026-05-28", "2026-08-25"
]);

function isHoliday(dateStr) {
  const mAndD = dateStr.slice(5); // Get MM-DD
  if (FIXED_HOLIDAYS.includes(mAndD)) return true;
  if (VARIABLE_HOLIDAYS.has(dateStr)) return true;
  return false;
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
  return new Date(dateStr).toLocaleDateString("en-NG", { day: "2-digit", month: "short", year: "numeric" });
}

function formatMonth(yearMonthStr) {
  if (!yearMonthStr) return "—";
  const [year, month] = yearMonthStr.split("-");
  const date = new Date(year, parseInt(month) - 1, 1);
  return date.toLocaleDateString("en-NG", { month: "long", year: "numeric" });
}

// Skips both weekends and Nigerian holidays if target config is active
function getRepaymentDays(startDate, count, excludeWeekendsAndHolidays) {
  const days = [];
  const cursor = new Date(startDate);
  cursor.setDate(cursor.getDate() + 1); // start from next day
  while (days.length < count) {
    const dateStr = cursor.toISOString().split("T")[0];
    const day = cursor.getDay(); // 0=Sun, 6=Sat
    const isWeekend = day === 0 || day === 6;
    const isPubHoliday = isHoliday(dateStr);

    if (excludeWeekendsAndHolidays) {
      if (!isWeekend && !isPubHoliday) {
        days.push(dateStr);
      }
    } else {
      days.push(dateStr);
    }
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
      day: i + 1,
      dueDate: repaymentDays[i],
      payment: dailyPayment,
      balance,
      paid: false,
      paidDate: null,
      paidAmount: 0,
    });
  }
  return { dailyPayment, totalRepayable, totalInterest, schedule };
}

// ─── ICONS ───────────────────────────────────────────────────────────────────
const Icon = ({ name, size = 16 }) => {
  const icons = {
    plus: <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>,
    user: <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="8" r="4"/><path d="M4 20c0-4 3.6-7 8-7s8 3 8 7"/></svg>,
    check: <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>,
    back: <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 18 9 12 15 6"/></svg>,
    dashboard: <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/></svg>,
    trash: <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6"/><path d="M10 11v6M14 11v6M9 6V4h6v2"/></svg>,
    save: <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M19 21H5a2 2 0 01-2-2V5a2 2 0 012-2h11l5 5v11a2 2 0 01-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/></svg>,
    cloud: <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M18 10h-1.26A8 8 0 109 20h9a5 5 0 000-10z"/></svg>,
    edit: <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 113 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>,
    ledger: <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/><polyline points="10 9 9 9 8 9"/></svg>,
    search: <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>,
    lock: <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>,
    unlock: <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 9.9-1"/></svg>
  };
  return icons[name] || null;
};

// ─── COMPONENTS ───────────────────────────────────────────────────────────────
function Modal({ title, onClose, children }) {
  return (
    <div style={{
      position:"fixed",inset:0,background:"rgba(0,8,20,0.92)",zIndex:1000,
      display:"flex",alignItems:"center",justifyContent:"center",padding:16,
      backdropFilter:"blur(8px)",
    }}>
      <div style={{
        background:"#0d1b2a",border:"1px solid rgba(100,200,255,0.12)",
        borderRadius:20,width:"100%",maxWidth:480,
        maxHeight:"92vh",overflowY:"auto",
        boxShadow:"0 40px 100px rgba(0,0,0,0.7), 0 0 0 1px rgba(100,200,255,0.05)",
      }}>
        <div style={{
          padding:"20px 22px 14px",borderBottom:"1px solid rgba(255,255,255,0.06)",
          display:"flex",justifyContent:"space-between",alignItems:"center",
          position:"sticky",top:0,background:"#0d1b2a",zIndex:1,borderRadius:"20px 20px 0 0",
        }}>
          <h2 style={{margin:0,fontSize:17,fontWeight:700,color:"#e8f4fd"}}>{title}</h2>
          <button onClick={onClose} style={{
            background:"rgba(255,255,255,0.06)",border:"none",color:"#8ab4c8",
            width:30,height:30,borderRadius:8,cursor:"pointer",fontSize:17,lineHeight:1,
          }}>×</button>
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
  width:"100%",padding:"10px 13px",
  background:"rgba(100,180,255,0.05)",
  border:"1px solid rgba(100,180,255,0.15)",
  borderRadius:10,color:"#e8f4fd",
  fontSize:14,outline:"none",boxSizing:"border-box",fontFamily:"inherit",
};

function StatCard({ label, value, accent, sub }) {
  return (
    <div style={{
      background:"rgba(255,255,255,0.03)",
      border:"1px solid rgba(255,255,255,0.06)",
      borderRadius:14,padding:"16px 18px",
      borderTop:`2px solid ${accent}`,
    }}>
      <div style={{fontSize:10,color:"#4a6880",letterSpacing:1.2,textTransform:"uppercase",marginBottom:7}}>{label}</div>
      <div style={{fontSize:19,fontWeight:800,color:"#e8f4fd",fontFamily:"'Courier New',monospace",letterSpacing:-0.5}}>{value}</div>
      {sub && <div style={{fontSize:10,color:"#3a5060",marginTop:3}}>{sub}</div>}
    </div>
  );
}

function Badge({ color, bg, children }) {
  return (
    <span style={{
      fontSize:10,padding:"2px 9px",borderRadius:20,
      background:bg,color,fontWeight:700,letterSpacing:0.5,
    }}>{children}</span>
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
  const [activeTab, setActiveTab] = useState("schedule");

  // Admin Module settings
  const [isAdmin, setIsAdmin] = useState(false);
  const [showAdminLogin, setShowAdminLogin] = useState(false);
  const [adminPinInput, setAdminPinInput] = useState("");

  // Modals
  const [showAddClient, setShowAddClient] = useState(false);
  const [showEditClient, setShowEditClient] = useState(null);
  const [showAddLoan, setShowAddLoan] = useState(false);
  const [showPayment, setShowPayment] = useState(null);
  const [paymentAmount, setPaymentAmount] = useState("");
  const [confirmDelete, setConfirmDelete] = useState(null);
  const [showSettings, setShowSettings] = useState(false);
  
  // Savings Modal actions
  const [showSavingsTx, setShowSavingsTx] = useState(null); // { type: 'deposit' | 'withdraw', client }
  const [savingsAmount, setSavingsAmount] = useState("");
  const [adminDirectSavingsInput, setAdminDirectSavingsInput] = useState("");

  // Admin line override state
  const [adminEditInstallment, setAdminEditInstallment] = useState(null); // { client, loan, idx }
  const [adminInstOverride, setAdminInstOverride] = useState({ paid: false, paidAmount: "", dueDate: "", paidDate: "" });

  // Search & Filters state
  const [clientSearch, setClientSearch] = useState("");
  const [clientFilter, setClientFilter] = useState("all"); // "all", "active", "completed", "none"
  const [expandMonthlyHistory, setExpandMonthlyHistory] = useState(false);

  // Form state
  const [newClient, setNewClient] = useState({ name:"", phone:"", address:"", idNumber:"" });
  const [newLoan, setNewLoan] = useState({
    principal:"", interestRate:"15", days:"30",
    startDate: new Date().toISOString().split("T")[0],
    excludeWeekends: true
  });

  // Load from storage on mount
  useEffect(() => {
    loadClients().then(data => {
      setClients(data);
      setLoading(false);
    });
  }, []);

  // Save to storage helper
  const persistClients = async (updated) => {
    setSaving(true);
    await saveClients(updated);
    setSaving(false);
    setSavedFlash(true);
    setTimeout(() => setSavedFlash(false), 1800);
  };

  const updateClients = (updated) => {
    setClients(updated);
    persistClients(updated);
  };

  const today = new Date();
  const selectedClient = clients.find(c => c.id === selectedClientId);

  // ── HISTORIC MONTHLY ANALYTICS ──────────────────────────────────────────────
  const monthlyHistory = useMemo(() => {
    const historyMap = {}; // "YYYY-MM" -> stats
    clients.forEach(c => {
      c.loans?.forEach(l => {
        // Parse issue or starting month
        const baseDate = l.issuedAt || l.startDate || new Date().toISOString();
        const monthKey = baseDate.slice(0, 7); // Gives format "YYYY-MM"
        
        if (!historyMap[monthKey]) {
          historyMap[monthKey] = { disbursed: 0, expected: 0, collected: 0 };
        }
        historyMap[monthKey].disbursed += (l.principal || 0);
        historyMap[monthKey].expected += (l.totalRepayable || 0);
        
        l.schedule?.forEach(s => {
          if (s.paid) {
            historyMap[monthKey].collected += (s.paidAmount || 0);
          }
        });
      });
    });

    // Convert structured object map back into chronological descending list
    return Object.entries(historyMap).map(([month, data]) => ({
      month,
      disbursed: data.disbursed,
      collected: data.collected,
      expected: data.expected,
      outstanding: Math.max(0, data.expected - data.collected)
    })).sort((a, b) => b.month.localeCompare(a.month));
  }, [clients]);

  // ── STATS SUMMARY ──────────────────────────────────────────────────────────
  const stats = useMemo(() => {
    let totalDisbursed = 0, totalExpected = 0, totalCollected = 0, overdueCount = 0;
    clients.forEach(c => {
      c.loans?.forEach(l => {
        totalDisbursed += l.principal;
        totalExpected += l.totalRepayable;
        l.schedule?.forEach(s => {
          if (s.paid) totalCollected += s.paidAmount;
          else if (new Date(s.dueDate) < today) overdueCount++;
        });
      });
    });
    const outstanding = totalExpected - totalCollected;
    const totalSavings = clients.reduce((accum, cl) => accum + (cl.savingsBalance || 0), 0);
    return { totalDisbursed, totalExpected, totalCollected, outstanding, overdueCount, totalSavings };
  }, [clients]);

  // Global Ledger Log
  const globalTransactions = useMemo(() => {
    const txList = [];
    clients.forEach(c => {
      c.loans?.forEach(l => {
        l.schedule?.forEach(s => {
          if (s.paid && s.paidAmount > 0) {
            txList.push({
              clientId: c.id,
              clientName: c.name,
              loanId: l.id,
              day: s.day,
              totalDays: l.days,
              paidAmount: s.paidAmount,
              paidDate: s.paidDate,
              dueDate: s.dueDate
            });
          }
        });
      });
    });
    return txList.sort((a, b) => new Date(b.paidDate) - new Date(a.paidDate));
  }, [clients]);

  // Filtered Client List
  const filteredClients = useMemo(() => {
    return clients.filter(c => {
      const matchSearch =
        c.name.toLowerCase().includes(clientSearch.toLowerCase()) ||
        c.phone.includes(clientSearch) ||
        c.id.toLowerCase().includes(clientSearch.toLowerCase());

      const activeLoan = c.loans?.find(l => l.status === "active");
      const hasLoans = c.loans && c.loans.length > 0;

      if (clientFilter === "active") return matchSearch && activeLoan;
      if (clientFilter === "completed") return matchSearch && !activeLoan && hasLoans;
      if (clientFilter === "none") return matchSearch && !hasLoans;
      return matchSearch;
    });
  }, [clients, clientSearch, clientFilter]);

  // ── ACTIONS ────────────────────────────────────────────────────────────────
  const handleAddClient = () => {
    if (!newClient.name.trim() || !newClient.phone.trim()) return;
    const client = {
      ...newClient,
      id: generateId("CL"),
      loans: [],
      savingsBalance: 0,
      savingsLogs: [],
      createdAt: new Date().toISOString().split("T")[0],
    };
    const updated = [client, ...clients];
    updateClients(updated);
    setNewClient({ name:"", phone:"", address:"", idNumber:"" });
    setShowAddClient(false);
  };

  const handleUpdateClient = () => {
    if (!showEditClient || !showEditClient.name.trim()) return;
    const updated = clients.map(c => c.id === showEditClient.id ? showEditClient : c);
    updateClients(updated);
    setShowEditClient(null);
  };

  const handleAdminVerify = () => {
    if (adminPinInput === "2026") {
      setIsAdmin(true);
      setShowAdminLogin(false);
      setAdminPinInput("");
    } else {
      alert("⚠️ Access Denied: Incorrect Admin PIN.");
    }
  };

  const handleAddLoan = () => {
    if (!newLoan.principal || !selectedClientId) return;
    const p = parseFloat(newLoan.principal);
    const r = parseFloat(newLoan.interestRate);
    const d = parseInt(newLoan.days);
    const { dailyPayment, totalRepayable, totalInterest, schedule } = calcLoanSchedule(p, r, d, newLoan.startDate, newLoan.excludeWeekends);
    const loan = {
      id: generateId("LN"), principal: p, interestRate: r, days: d,
      startDate: newLoan.startDate, dailyPayment, totalRepayable,
      totalInterest, schedule, status: "active",
      issuedAt: new Date().toISOString(),
      excludeWeekends: newLoan.excludeWeekends
    };
    const updated = clients.map(c =>
      c.id === selectedClientId ? { ...c, loans: [...(c.loans || []), loan] } : c
    );
    updateClients(updated);
    setNewLoan({ principal:"", interestRate:"15", days:"30", startDate: new Date().toISOString().split("T")[0], excludeWeekends: true });
    setShowAddLoan(false);
  };

  const handlePayment = () => {
    const amount = parseFloat(paymentAmount);
    if (!amount || amount <= 0 || !showPayment) return;
    const { clientId, loanId, scheduleIdx } = showPayment;
    const updated = clients.map(c => {
      if (c.id !== clientId) return c;
      return {
        ...c, loans: c.loans.map(l => {
          if (l.id !== loanId) return l;
          const newSchedule = l.schedule.map((s, i) =>
            i === scheduleIdx
              ? { ...s, paid: true, paidDate: new Date().toISOString().split("T")[0], paidAmount: amount }
              : s
          );
          let running = l.totalRepayable;
          const recalced = newSchedule.map(s => {
            if (s.paid) running = Math.max(0, running - s.paidAmount);
            return { ...s, balance: running };
          });
          return { ...l, schedule: recalced, status: recalced.every(s => s.paid) ? "completed" : "active" };
        })
      };
    });
    updateClients(updated);
    setPaymentAmount("");
    setShowPayment(null);
  };

  // ── SAVINGS ENGINE ACTIONS ─────────────────────────────────────────────────
  const handleSavingsTransaction = () => {
    const amount = parseFloat(savingsAmount);
    if (!amount || amount <= 0 || !showSavingsTx) return;
    const { type, client } = showSavingsTx;

    const updated = clients.map(c => {
      if (c.id !== client.id) return c;
      const currentBal = c.savingsBalance || 0;
      let newBal = currentBal;
      if (type === "deposit") {
        newBal += amount;
      } else {
        if (amount > currentBal) {
          alert("⚠️ Insufficient Savings Balance!");
          return c;
        }
        newBal -= amount;
      }
      
      const newLog = {
        id: generateId("TX"),
        date: new Date().toISOString().split("T")[0],
        type,
        amount,
        balanceAfter: newBal
      };

      return {
        ...c,
        savingsBalance: newBal,
        savingsLogs: [newLog, ...(c.savingsLogs || [])]
      };
    });

    updateClients(updated);
    setSavingsAmount("");
    setShowSavingsTx(null);
  };

  // Direct savings Override for administrator
  const handleAdminSavingsAdjustment = () => {
    const newBal = parseFloat(adminDirectSavingsInput);
    if (isNaN(newBal) || !showSavingsTx) return;
    const { client } = showSavingsTx;

    const updated = clients.map(c => {
      if (c.id !== client.id) return c;
      const adjustLog = {
        id: generateId("TX"),
        date: new Date().toISOString().split("T")[0],
        type: "admin_adjustment",
        amount: Math.abs(newBal - (c.savingsBalance || 0)),
        balanceAfter: newBal
      };
      return {
        ...c,
        savingsBalance: newBal,
        savingsLogs: [adjustLog, ...(c.savingsLogs || [])]
      };
    });

    updateClients(updated);
    setAdminDirectSavingsInput("");
    setShowSavingsTx(null);
  };

  // Admin single payment schedule direct override
  const handleAdminInstallmentOverride = () => {
    if (!adminEditInstallment) return;
    const { client, loan, idx } = adminEditInstallment;
    const pAmt = parseFloat(adminInstOverride.paidAmount) || 0;

    const updated = clients.map(c => {
      if (c.id !== client.id) return c;
      return {
        ...c,
        loans: c.loans.map(l => {
          if (l.id !== loan.id) return l;
          const targetSchedule = l.schedule.map((s, i) => {
            if (i === idx) {
              return {
                ...s,
                paid: adminInstOverride.paid,
                dueDate: adminInstOverride.dueDate,
                paidDate: adminInstOverride.paid ? (adminInstOverride.paidDate || new Date().toISOString().split("T")[0]) : null,
                paidAmount: adminInstOverride.paid ? pAmt : 0
              };
            }
            return s;
          });

          // Re-calculate rolling schedule balances
          let running = l.totalRepayable;
          const recalced = targetSchedule.map(s => {
            if (s.paid) running = Math.max(0, running - s.paidAmount);
            return { ...s, balance: running };
          });

          return {
            ...l,
            schedule: recalced,
            status: recalced.every(s => s.paid) ? "completed" : "active"
          };
        })
      };
    });

    updateClients(updated);
    setAdminEditInstallment(null);
  };

  const handleDeleteClient = (id) => {
    updateClients(clients.filter(c => c.id !== id));
    setConfirmDelete(null);
    setView("clients");
  };

  const getClientLoanSummary = (c) => {
    const active = c.loans?.find(l => l.status === "active");
    const overdue = active?.schedule?.filter(s => !s.paid && new Date(s.dueDate) < today).length || 0;
    const paid = active?.schedule?.filter(s => s.paid).length || 0;
    const total = active?.schedule?.length || 0;
    const balance = active ? (active.schedule.find(s => !s.paid)?.balance ?? 0) : 0;
    return { active, overdue, paid, total, balance };
  };

  // ── LOADING SCREEN ─────────────────────────────────────────────────────────
  if (loading) return (
    <div style={{
      minHeight:"100vh",background:"#060f1a",display:"flex",
      alignItems:"center",justifyContent:"center",flexDirection:"column",gap:16,
    }}>
      <div style={{
        width:48,height:48,borderRadius:14,
        background:"linear-gradient(135deg,#22c55e,#0ea5e9)",
        display:"flex",alignItems:"center",justifyContent:"center",
        fontSize:24,
      }}>💰</div>
      <div style={{color:"#4a7090",fontSize:14}}>CREDA Engine Starting...</div>
    </div>
  );

  // ── DASHBOARD VIEW ─────────────────────────────────────────────────────────
  const Dashboard = () => (
    <div>
      <div style={{marginBottom:22}}>
        <h1 style={{margin:0,fontSize:24,fontWeight:800,color:"#e8f4fd",letterSpacing:-0.5}}>Dashboard</h1>
        <p style={{margin:"4px 0 0",color:"#3a5a70",fontSize:13}}>
          {clients.length} clients · {clients.reduce((a,c) => a + (c.loans?.filter(l=>l.status==="active").length||0),0)} active loans
        </p>
      </div>

      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10,marginBottom:24}}>
        <StatCard label="Disbursed" value={formatCurrency(stats.totalDisbursed)} accent="#3b82f6" />
        <StatCard label="Collected" value={formatCurrency(stats.totalCollected)} accent="#22c55e" />
        <StatCard label="Outstanding" value={formatCurrency(stats.outstanding)} accent="#f59e0b" />
        <StatCard label="Total Savings" value={formatCurrency(stats.totalSavings)} accent="#a855f7" />
        <div style={{gridColumn:"span 2"}}>
          <StatCard label="Overdue Daily Runs" value={stats.overdueCount + " installments due"} accent="#ef4444" />
        </div>
      </div>

      {/* HISTORICAL MONTHS CARD */}
      <div style={{
        background:"rgba(255,255,255,0.02)", border:"1px solid rgba(100,180,255,0.06)",
        borderRadius:14, padding:16, marginBottom:20
      }}>
        <div style={{display:"flex", justifyContent:"space-between", alignItems:"center"}}>
          <div>
            <h3 style={{margin:0, fontSize:13, fontWeight:700, color:"#93c5fd", letterSpacing:0.5, textTransform:"uppercase"}}>Monthly Historic Breakdown</h3>
            <p style={{margin:"2px 0 0", fontSize:11, color:"#3a5a70"}}>Preserved monthly performance indices</p>
          </div>
          <button 
            onClick={() => setExpandMonthlyHistory(!expandMonthlyHistory)}
            style={{
              background:"rgba(147,197,253,0.1)", border:"none", borderRadius:8,
              color:"#93c5fd", padding:"5px 12px", fontSize:11, cursor:"pointer", fontWeight:600
            }}>
            {expandMonthlyHistory ? "Hide Breakdown" : "View Months"}
          </button>
        </div>

        {expandMonthlyHistory && (
          <div style={{marginTop:16, display:"flex", flexDirection:"column", gap:10}}>
            {monthlyHistory.length === 0 ? (
              <div style={{fontSize:11, color:"#3a5a70", textAlign:"center", padding:"10px 0"}}>No transaction history generated yet.</div>
            ) : (
              monthlyHistory.map(item => (
                <div key={item.month} style={{
                  padding:"10px 12px", background:"rgba(0,0,0,0.2)", borderRadius:10,
                  display:"flex", flexDirection:"column", gap:6, borderLeft:"3px solid #22c55e"
                }}>
                  <div style={{fontWeight:700, color:"#e8f4fd", fontSize:12}}>{formatMonth(item.month)}</div>
                  <div style={{display:"grid", gridTemplateColumns:"1fr 1fr 1fr", gap:8}}>
                    <div>
                      <div style={{fontSize:8, color:"#3a5a70"}}>DISBURSED</div>
                      <div style={{fontSize:11, fontWeight:600, color:"#93c5fd", fontFamily:"'Courier New',monospace"}}>{formatCurrency(item.disbursed)}</div>
                    </div>
                    <div>
                      <div style={{fontSize:8, color:"#3a5a70"}}>COLLECTED</div>
                      <div style={{fontSize:11, fontWeight:600, color:"#4ade80", fontFamily:"'Courier New',monospace"}}>{formatCurrency(item.collected)}</div>
                    </div>
                    <div>
                      <div style={{fontSize:8, color:"#3a5a70"}}>OUTSTANDING</div>
                      <div style={{fontSize:11, fontWeight:600, color:"#f87171", fontFamily:"'Courier New',monospace"}}>{formatCurrency(item.outstanding)}</div>
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>
        )}
      </div>

      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:12}}>
        <div style={{fontSize:14,fontWeight:700,color:"#c8dde8"}}>Recent Clients</div>
        <button onClick={() => setView("clients")} style={{background:"none",border:"none",color:"#3b82f6",fontSize:12,cursor:"pointer"}}>See all →</button>
      </div>

      {clients.length === 0 ? (
        <div style={{
          border:"1px dashed rgba(100,180,255,0.1)",borderRadius:14,padding:40,
          textAlign:"center",color:"#2a4050",
        }}>
          <div style={{fontSize:36,marginBottom:10}}>💳</div>
          <div style={{marginBottom:14,fontSize:14}}>No clients yet</div>
          <button onClick={() => { setView("clients"); setShowAddClient(true); }} style={{
            background:"linear-gradient(135deg,#22c55e,#16a34a)",border:"none",
            color:"#000",padding:"9px 22px",borderRadius:10,cursor:"pointer",fontWeight:700,fontSize:13,
          }}>+ Add First Client</button>
        </div>
      ) : (
        <div style={{display:"flex",flexDirection:"column",gap:8}}>
          {clients.slice(0,5).map(c => {
            const { active, overdue, paid, total, balance } = getClientLoanSummary(c);
            return (
              <div key={c.id}
                onClick={() => { setSelectedClientId(c.id); setView("detail"); }}
                style={{
                  background:"rgba(255,255,255,0.02)",border:"1px solid rgba(100,180,255,0.07)",
                  borderRadius:12,padding:"12px 15px",cursor:"pointer",
                  display:"flex",justifyContent:"space-between",alignItems:"center",
                }}>
                <div style={{display:"flex",alignItems:"center",gap:10}}>
                  <div style={{
                    width:36,height:36,borderRadius:10,
                    background:"linear-gradient(135deg,#1d4ed8,#3b82f6)",
                    display:"flex",alignItems:"center",justifyContent:"center",
                    fontWeight:800,fontSize:15,color:"#fff",flexShrink:0,
                  }}>{c.name.charAt(0).toUpperCase()}</div>
                  <div>
                    <div style={{fontWeight:600,color:"#dceef8",fontSize:14}}>{c.name}</div>
                    <div style={{fontSize:11,color:"#3a5a70"}}>{c.phone}</div>
                  </div>
                </div>
                <div style={{textAlign:"right"}}>
                  {active ? (
                    <>
                      <div style={{fontSize:12,fontWeight:700,color:"#60a5fa",fontFamily:"'Courier New',monospace"}}>{formatCurrency(balance)}</div>
                      <div style={{fontSize:10,color: overdue>0?"#f87171":"#3a6050"}}>{overdue>0 ? `${overdue} overdue`:`${paid}/${total} paid`}</div>
                    </>
                  ) : <div style={{fontSize:11,color:"#2a4050"}}>No active loan</div>}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );

  // ── CLIENTS VIEW ───────────────────────────────────────────────────────────
  const ClientsList = () => (
    <div>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:20}}>
        <h1 style={{margin:0,fontSize:22,fontWeight:800,color:"#e8f4fd"}}>Clients</h1>
        <button onClick={() => setShowAddClient(true)} style={{
          background:"linear-gradient(135deg,#22c55e,#16a34a)",border:"none",
          color:"#000",padding:"9px 16px",borderRadius:11,cursor:"pointer",
          fontWeight:700,fontSize:13,display:"flex",alignItems:"center",gap:6,
        }}><Icon name="plus" size={13}/> New</button>
      </div>

      {/* Advanced Search & Filter Controls */}
      <div style={{display:"flex",flexDirection:"column",gap:10,marginBottom:16}}>
        <div style={{position:"relative"}}>
          <span style={{position:"absolute",left:12,top:11,color:"#5a7a90"}}><Icon name="search" size={14}/></span>
          <input
            type="text"
            style={{...inputStyle, paddingLeft:36}}
            placeholder="Search by client name, ID or phone..."
            value={clientSearch}
            onChange={(e) => setClientSearch(e.target.value)}
          />
        </div>
        <div style={{display:"flex",gap:6,overflowX:"auto",paddingBottom:4}}>
          {[
            { id: "all", label: "All" },
            { id: "active", label: "Active Loans" },
            { id: "completed", label: "Completed" },
            { id: "none", label: "No Loans" }
          ].map(f => (
            <button
              key={f.id}
              onClick={() => setClientFilter(f.id)}
              style={{
                background: clientFilter === f.id ? "rgba(34,197,94,0.15)" : "rgba(255,255,255,0.03)",
                border: clientFilter === f.id ? "1px solid rgba(34,197,94,0.4)" : "1px solid rgba(255,255,255,0.06)",
                color: clientFilter === f.id ? "#4ade80" : "#8ab4c8",
                padding: "6px 12px", borderRadius: 8, fontSize: 11, fontWeight: 600, cursor: "pointer", whiteSpace: "nowrap"
              }}
            >
              {f.label}
            </button>
          ))}
        </div>
      </div>

      {filteredClients.length === 0 ? (
        <div style={{textAlign:"center",padding:60,color:"#2a4050",border:"1px dashed rgba(100,180,255,0.08)",borderRadius:14}}>
          <div style={{fontSize:36,marginBottom:10}}>👤</div>
          <div>No client profiles matched criteria.</div>
        </div>
      ) : (
        <div style={{display:"flex",flexDirection:"column",gap:9}}>
          {filteredClients.map(c => {
            const { active, overdue, paid, total } = getClientLoanSummary(c);
            return (
              <div key={c.id}
                onClick={() => { setSelectedClientId(c.id); setView("detail"); }}
                style={{
                  background:"rgba(255,255,255,0.025)",border:"1px solid rgba(100,180,255,0.07)",
                  borderRadius:13,padding:"14px 16px",cursor:"pointer",
                }}>
                <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom: active?10:0}}>
                  <div style={{display:"flex",gap:10,alignItems:"center"}}>
                    <div style={{
                      width:40,height:40,borderRadius:11,
                      background:"linear-gradient(135deg,#1e3a5f,#2563eb)",
                      display:"flex",alignItems:"center",justifyContent:"center",
                      fontWeight:800,fontSize:16,color:"#93c5fd",flexShrink:0,
                    }}>{c.name.charAt(0).toUpperCase()}</div>
                    <div>
                      <div style={{fontWeight:700,color:"#dceef8",fontSize:14}}>{c.name}</div>
                      <div style={{fontSize:11,color:"#3a5a70",marginTop:1}}>{c.id} · {c.phone}</div>
                    </div>
                  </div>
                  <Badge
                    color={active?"#4ade80":c.loans?.length>0?"#94a3b8":"#3a5a70"}
                    bg={active?"rgba(34,197,94,0.12)":c.loans?.length>0?"rgba(148,163,184,0.1)":"rgba(100,130,150,0.08)"}
                  >{active?"Active":c.loans?.length>0?"Done":"No Loan"}</Badge>
                </div>
                {active && (
                  <div>
                    <div style={{display:"flex",justifyContent:"space-between",fontSize:11,color:"#3a5a70",marginBottom:5}}>
                      <span>{paid}/{total} runs completed</span>
                      <span style={{color:overdue>0?"#f87171":"#3a6050"}}>{overdue>0?`${overdue} days late`:"On Schedule ✓"}</span>
                    </div>
                    <div style={{height:3,background:"rgba(255,255,255,0.06)",borderRadius:4,overflow:"hidden"}}>
                      <div style={{
                        height:"100%",width:`${(paid/total)*100}%`,
                        background:"linear-gradient(90deg,#22c55e,#4ade80)",borderRadius:4,
                      }}/>
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

  // ── LEDGER LOG VIEW ────────────────────────────────────────────────────────
  const Ledger = () => (
    <div>
      <div style={{marginBottom:22}}>
        <h1 style={{margin:0,fontSize:22,fontWeight:800,color:"#e8f4fd"}}>Ledger Log</h1>
        <p style={{margin:"4px 0 0",color:"#3a5a70",fontSize:13}}>Chronological verification ledger of all received daily runs</p>
      </div>

      {globalTransactions.length === 0 ? (
        <div style={{textAlign:"center",padding:60,color:"#2a4050",border:"1px dashed rgba(100,180,255,0.08)",borderRadius:14}}>
          <div style={{fontSize:36,marginBottom:10}}>📝</div>
          <div>No transaction histories are available yet.</div>
        </div>
      ) : (
        <div style={{display:"flex",flexDirection:"column",gap:8}}>
          {globalTransactions.map((tx, idx) => (
            <div key={idx} style={{
              background:"rgba(255,255,255,0.02)",border:"1px solid rgba(100,180,255,0.05)",
              borderRadius:12,padding:"12px 14px",
              display:"flex",justifyContent:"space-between",alignItems:"center",
            }}>
              <div>
                <div style={{fontWeight:700,color:"#e8f4fd",fontSize:13}}>{tx.clientName}</div>
                <div style={{fontSize:10,color:"#3a5a70",marginTop:2}}>
                  Installment {tx.day} of {tx.totalDays} · Paid on {formatDate(tx.paidDate)}
                </div>
              </div>
              <div style={{textAlign:"right"}}>
                <div style={{fontSize:13,color:"#4ade80",fontWeight:700,fontFamily:"'Courier New',monospace"}}>
                  +{formatCurrency(tx.paidAmount)}
                </div>
                <div style={{fontSize:9,color:"#3a5a70",marginTop:2}}>Due target: {formatDate(tx.dueDate)}</div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );

  // ── CLIENT FILE DETAIL VIEW ────────────────────────────────────────────────
  const Detail = () => {
    if (!selectedClient) return null;
    const c = selectedClient;
    const activeLoan = c.loans?.find(l => l.status === "active");
    const completedLoans = c.loans?.filter(l => l.status === "completed") || [];

    const loanSummaryPreview = useMemo(() => {
      const p = parseFloat(newLoan.principal) || 0;
      const r = parseFloat(newLoan.interestRate) || 0;
      const d = parseInt(newLoan.days) || 1;
      const totalInterest = (p * r) / 100;
      const totalRepayable = p + totalInterest;
      return { totalRepayable, daily: totalRepayable / d };
    }, [newLoan.principal, newLoan.interestRate, newLoan.days]);

    return (
      <div>
        <div style={{display:"flex",alignItems:"center",gap:12,marginBottom:20}}>
          <button onClick={() => setView("clients")} style={{
            background:"rgba(255,255,255,0.06)",border:"none",color:"#8ab4c8",
            width:34,height:34,borderRadius:9,cursor:"pointer",
            display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0,
          }}><Icon name="back" size={15}/></button>
          <div style={{
            width:44,height:44,borderRadius:12,
            background:"linear-gradient(135deg,#1d4ed8,#3b82f6)",
            display:"flex",alignItems:"center",justifyContent:"center",
            fontWeight:800,fontSize:18,color:"#fff",flexShrink:0,
          }}>{c.name.charAt(0).toUpperCase()}</div>
          <div style={{flexGrow: 1}}>
            <div style={{fontSize:18,fontWeight:800,color:"#e8f4fd"}}>{c.name}</div>
            <div style={{fontSize:11,color:"#3a5a70"}}>{c.id} · Joined {formatDate(c.createdAt)}</div>
          </div>
          <button onClick={() => setShowEditClient(c)} style={{
            background:"rgba(255,255,255,0.04)",border:"1px solid rgba(255,255,255,0.08)",
            color:"#3b82f6",width:32,height:32,borderRadius:8,cursor:"pointer",
            display:"flex",alignItems:"center",justifyContent:"center"
          }} title="Edit Profile">
            <Icon name="edit" size={14}/>
          </button>
        </div>

        {/* Dynamic client overview card */}
        <div style={{
          background:"rgba(100,180,255,0.04)",border:"1px solid rgba(100,180,255,0.08)",
          borderRadius:13,padding:"14px 16px",marginBottom:16,
          display:"grid",gridTemplateColumns:"1fr 1fr",gap:10,
        }}>
          <div><div style={{fontSize:10,color:"#3a5a70",marginBottom:3}}>PHONE</div><div style={{color:"#c8dde8",fontSize:13}}>{c.phone||"—"}</div></div>
          <div><div style={{fontSize:10,color:"#3a5a70",marginBottom:3}}>ID/BVN</div><div style={{color:"#c8dde8",fontSize:13}}>{c.idNumber||"—"}</div></div>
          <div><div style={{fontSize:10,color:"#3a5a70",marginBottom:3}}>SAVINGS BAL</div><div style={{color:"#c084fc",fontSize:13,fontWeight:700}}>{formatCurrency(c.savingsBalance || 0)}</div></div>
          <div><div style={{fontSize:10,color:"#3a5a70",marginBottom:3}}>JOINED</div><div style={{color:"#c8dde8",fontSize:13}}>{formatDate(c.createdAt)}</div></div>
          <div style={{gridColumn:"1/-1"}}><div style={{fontSize:10,color:"#3a5a70",marginBottom:3}}>ADDRESS</div><div style={{color:"#c8dde8",fontSize:13}}>{c.address||"—"}</div></div>
        </div>

        {/* Loan Operations header */}
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:12}}>
          <div style={{fontSize:15,fontWeight:700,color:"#c8dde8"}}>Client Operations</div>
          {!activeLoan && (
            <button onClick={() => setShowAddLoan(true)} style={{
              background:"linear-gradient(135deg,#22c55e,#16a34a)",border:"none",
              color:"#000",padding:"7px 15px",borderRadius:9,cursor:"pointer",
              fontWeight:700,fontSize:12,display:"flex",alignItems:"center",gap:5,
            }}><Icon name="plus" size={12}/> Issue Loan</button>
          )}
        </div>

        {/* Action Tabs including savings */}
        <div style={{display:"flex",gap:3,marginBottom:14,background:"rgba(255,255,255,0.03)",borderRadius:10,padding:3}}>
          {[
            { id: "schedule", label: "Repay Schedule" },
            { id: "history", label: "Ledger Runs" },
            { id: "savings", label: `Savings (${formatCurrency(c.savingsBalance || 0)})` }
          ].map(tab => (
            <button key={tab.id} onClick={() => setActiveTab(tab.id)} style={{
              flex:1,padding:"7px 3px",borderRadius:8,border:"none",cursor:"pointer",
              background:activeTab===tab.id?"rgba(100,180,255,0.1)":"transparent",
              color:activeTab===tab.id?(tab.id==="savings"?"#c084fc":"#93c5fd"):"#3a5a70",
              fontWeight:600,fontSize:11,
            }}>{tab.label}</button>
          ))}
        </div>

        {/* Savings Tab content view */}
        {activeTab === "savings" && (
          <div>
            <div style={{
              background:"rgba(168,85,247,0.05)", border:"1px solid rgba(168,85,247,0.15)",
              borderRadius:14, padding:16, display:"flex", flexDirection:"column", gap:14, marginBottom:16
            }}>
              <div style={{textAlign:"center"}}>
                <div style={{fontSize:10, color:"#a855f7", fontWeight:700, letterSpacing:1}}>SAVINGS ACCOUNT BALANCE</div>
                <div style={{fontSize:28, fontWeight:800, color:"#c084fc", fontFamily:"'Courier New',monospace", marginTop:6}}>{formatCurrency(c.savingsBalance || 0)}</div>
              </div>
              <div style={{display:"grid", gridTemplateColumns:"1fr 1fr", gap:10}}>
                <button 
                  onClick={() => setShowSavingsTx({ type: "deposit", client: c })}
                  style={{
                    background:"#a855f7", border:"none", color:"#fff", fontWeight:700,
                    padding:"10px", borderRadius:10, cursor:"pointer", fontSize:13
                  }}>
                  📥 Deposit Savings
                </button>
                <button 
                  onClick={() => setShowSavingsTx({ type: "withdraw", client: c })}
                  style={{
                    background:"transparent", border:"1px solid #a855f7", color:"#c084fc", fontWeight:700,
                    padding:"10px", borderRadius:10, cursor:"pointer", fontSize:13
                  }}>
                  📤 Withdraw Savings
                </button>
              </div>
            </div>

            <div style={{fontSize:12, fontWeight:700, color:"#c8dde8", marginBottom:8}}>Savings Statements Log</div>
            {(!c.savingsLogs || c.savingsLogs.length === 0) ? (
              <div style={{textAlign:"center", padding:20, color:"#2a4050", fontSize:12, border:"1px dashed rgba(168,85,247,0.08)", borderRadius:10}}>
                No savings statement lines recorded yet.
              </div>
            ) : (
              <div style={{display:"flex", flexDirection:"column", gap:6}}>
                {c.savingsLogs.map((log, idx) => (
                  <div key={idx} style={{
                    background:"rgba(255,255,255,0.01)", border:"1px solid rgba(168,85,247,0.08)",
                    borderRadius:10, padding:"10px 12px", display:"flex", justifyContent:"space-between", alignItems:"center"
                  }}>
                    <div>
                      <div style={{fontSize:12, fontWeight:600, color:log.type === "deposit" ? "#4ade80" : log.type === "withdraw" ? "#f87171" : "#c084fc"}}>
                        {log.type === "deposit" ? "Deposit" : log.type === "withdraw" ? "Withdrawal" : "Admin Override"}
                      </div>
                      <div style={{fontSize:9, color:"#3a5a70", marginTop:2}}>{formatDate(log.date)}</div>
                    </div>
                    <div style={{textAlign:"right"}}>
                      <div style={{fontSize:12, fontWeight:700, color:"#e8f4fd", fontFamily:"'Courier New',monospace"}}>
                        {log.type === "deposit" ? "+" : "-"}{formatCurrency(log.amount)}
                      </div>
                      <div style={{fontSize:9, color:"#3a5a70", marginTop:2}}>Bal: {formatCurrency(log.balanceAfter)}</div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Repayment Active Loan logic view */}
        {activeLoan && activeTab === "schedule" && (
          <>
            {/* Loan parameters panel */}
            <div style={{
              background:"linear-gradient(135deg,rgba(34,197,94,0.07),rgba(59,130,246,0.05))",
              border:"1px solid rgba(34,197,94,0.15)",borderRadius:14,padding:"16px",marginBottom:14,
            }}>
              <div style={{display:"grid", gridTemplateColumns:"repeat(3,1fr)", gap:12, marginBottom:14}}>
                {[
                  ["Principal Issued", formatCurrency(activeLoan.principal), "#93c5fd"],
                  ["Interest Rate", activeLoan.interestRate+"% flat", "#c4b5fd"],
                  ["Daily Run Pay", formatCurrency(activeLoan.dailyPayment), "#60a5fa"],
                  ["Total Expected", formatCurrency(activeLoan.totalRepayable), "#e8f4fd"],
                  ["Outstanding Balance", formatCurrency(activeLoan.schedule.find(s=>!s.paid)?.balance??0), "#f87171"],
                  ["Performance", `${activeLoan.schedule.filter(s=>s.paid).length}/${activeLoan.days} runs`, "#4ade80"],
                ].map(([l,v,color]) => (
                  <div key={l}>
                    <div style={{fontSize:9,color:"#3a5a70",marginBottom:3,letterSpacing:0.8}}>{l}</div>
                    <div style={{color,fontWeight:700,fontSize:12,fontFamily:"'Courier New',monospace"}}>{v}</div>
                  </div>
                ))}
              </div>
              <div style={{height:5,background:"rgba(255,255,255,0.06)",borderRadius:4,overflow:"hidden"}}>
                <div style={{
                  height:"100%",borderRadius:4,
                  width:`${(activeLoan.schedule.filter(s=>s.paid).length/activeLoan.days)*100}%`,
                  background:"linear-gradient(90deg,#22c55e,#4ade80)",
                  transition:"width 0.5s",
                }}/>
              </div>
            </div>

            {/* Repay schedule list lines */}
            <div style={{display:"flex",flexDirection:"column",gap:7}}>
              {activeLoan.schedule.map((s, i) => {
                const isOverdue = !s.paid && new Date(s.dueDate) < today;
                const unpaid = activeLoan.schedule.filter(x=>!x.paid);
                const isNext = !s.paid && unpaid.length > 0 && unpaid[0] === s;
                return (
                  <div key={i} style={{
                    background: s.paid?"rgba(34,197,94,0.04)":isOverdue?"rgba(239,68,68,0.07)":"rgba(255,255,255,0.02)",
                    border:`1px solid ${s.paid?"rgba(34,197,94,0.15)":isOverdue?"rgba(239,68,68,0.2)":isNext?"rgba(96,165,250,0.2)":"rgba(100,180,255,0.06)"}`,
                    borderRadius:11,padding:"10px 13px",
                    display:"flex",justifyContent:"space-between",alignItems:"center",
                  }}>
                    <div style={{display:"flex",gap:10,alignItems:"center"}}>
                      <div style={{
                        width:30,height:30,borderRadius:8,fontSize:11,fontWeight:700,flexShrink:0,
                        display:"flex",alignItems:"center",justifyContent:"center",
                        background:s.paid?"rgba(34,197,94,0.15)":isOverdue?"rgba(239,68,68,0.15)":"rgba(255,255,255,0.05)",
                        color:s.paid?"#4ade80":isOverdue?"#f87171":"#4a6880",
                      }}>{s.paid?<Icon name="check" size={13}/>:`D${i+1}`}</div>
                      <div>
                        <div style={{display:"flex",alignItems:"center",gap:6}}>
                          <span style={{fontSize:13,fontWeight:600,color:s.paid?"#4ade80":isOverdue?"#f87171":"#c8dde8"}}>
                            {formatCurrency(s.paidAmount > 0 ? s.paidAmount : activeLoan.dailyPayment)}
                          </span>
                          {isNext && <Badge color="#60a5fa" bg="rgba(96,165,250,0.12)">NEXT</Badge>}
                          {isOverdue && <Badge color="#f87171" bg="rgba(239,68,68,0.12)">LATE RUN</Badge>}
                        </div>
                        <div style={{fontSize:10,color:"#3a5a70",marginTop:2}}>
                          Due {formatDate(s.dueDate)}{s.paid&&` · Received ${formatDate(s.paidDate)}`}
                        </div>
                      </div>
                    </div>
                    
                    <div style={{textAlign:"right",flexShrink:0, display:"flex", alignItems:"center", gap:8}}>
                      <div style={{fontFamily:"'Courier New',monospace", fontSize:11}}>
                        <div style={{color:"#3a5a70", fontSize:9, textAlign:"right"}}>RUN BAL</div>
                        <div style={{color:"#e8f4fd"}}>{formatCurrency(s.balance)}</div>
                      </div>
                      
                      {!s.paid && (
                        <button onClick={() => {
                          setShowPayment({clientId:c.id,loanId:activeLoan.id,scheduleIdx:i});
                          setPaymentAmount(activeLoan.dailyPayment.toFixed(2));
                        }} style={{
                          background:"linear-gradient(135deg,#22c55e,#16a34a)",border:"none",
                          color:"#000",padding:"6px 12px",borderRadius:7,cursor:"pointer",
                          fontWeight:700,fontSize:11,
                        }}>Pay</button>
                      )}

                      {/* Admin Quick Installment Override Trigger */}
                      {isAdmin && (
                        <button 
                          onClick={() => {
                            setAdminEditInstallment({ client: c, loan: activeLoan, idx: i });
                            setAdminInstOverride({
                              paid: s.paid,
                              paidAmount: s.paidAmount || activeLoan.dailyPayment.toFixed(2),
                              dueDate: s.dueDate,
                              paidDate: s.paidDate || new Date().toISOString().split("T")[0]
                            });
                          }}
                          style={{
                            background:"rgba(245,158,11,0.1)", border:"1px solid rgba(245,158,11,0.3)",
                            color:"#f59e0b", borderRadius:6, padding:"4px 8px", cursor:"pointer", fontSize:10
                          }}>
                          Admin Override
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </>
        )}

        {/* Loan History Log view */}
        {activeLoan && activeTab === "history" && (
          <div>
            {activeLoan.schedule.filter(s=>s.paid).length === 0 ? (
              <div style={{textAlign:"center",padding:40,color:"#2a4050"}}>No historic payment logs on file yet.</div>
            ) : (
              <div style={{display:"flex",flexDirection:"column",gap:7}}>
                {activeLoan.schedule.filter(s=>s.paid).map((s,i) => (
                  <div key={i} style={{
                    background:"rgba(34,197,94,0.04)",border:"1px solid rgba(34,197,94,0.12)",
                    borderRadius:11,padding:"11px 14px",
                    display:"flex",justifyContent:"space-between",alignItems:"center",
                  }}>
                    <div style={{display:"flex",gap:9,alignItems:"center"}}>
                      <div style={{
                        width:28,height:28,borderRadius:7,
                        background:"rgba(34,197,94,0.15)",
                        display:"flex",alignItems:"center",justifyContent:"center",
                      }}><Icon name="check" size={12}/></div>
                      <div>
                        <div style={{fontSize:13,color:"#4ade80",fontWeight:600}}>{formatCurrency(s.paidAmount)}</div>
                        <div style={{fontSize:10,color:"#3a5a70"}}>Paid {formatDate(s.paidDate)}</div>
                      </div>
                    </div>
                    <div style={{fontSize:11,color:"#3a5a70",fontFamily:"'Courier New',monospace"}}>Bal: {formatCurrency(s.balance)}</div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Empty status states if client has no active loan */}
        {!activeLoan && activeTab !== "savings" && (
          <div style={{
            border:"1px dashed rgba(100,180,255,0.08)",borderRadius:13,padding:40,
            textAlign:"center",color:"#2a4050",
          }}>
            <div style={{fontSize:32,marginBottom:10}}>💰</div>
            <div style={{fontSize:13}}>{completedLoans.length>0?`${completedLoans.length} completed loan(s). Issue a new one.`:"No active loan records."}</div>
          </div>
        )}

        <button onClick={() => setConfirmDelete(c.id)} style={{
          marginTop:22,background:"rgba(239,68,68,0.08)",
          border:"1px solid rgba(239,68,68,0.15)",
          color:"#f87171",padding:"9px 18px",borderRadius:10,cursor:"pointer",
          fontWeight:600,fontSize:12,display:"flex",alignItems:"center",gap:7,
        }}><Icon name="trash" size={13}/> Delete Client Profile</button>
      </div>
    );
  };

  // ─── LAYOUT MAIN CONTROLLER ────────────────────────────────────────────────
  return (
    <div style={{minHeight:"100vh",background:"#060f1a",fontFamily:"'Segoe UI',system-ui,sans-serif",color:"#e8f4fd"}}>
      
      {/* Dynamic Admin Indicator Notice Banner */}
      {isAdmin && (
        <div style={{
          background:"#f59e0b", color:"#000", padding:"4px 12px", fontSize:11, fontWeight:700,
          textAlign:"center", display:"flex", justifyContent:"center", gap:10, alignItems:"center",
          position:"sticky", top:0, zIndex:1000
        }}>
          🛡️ SYSTEM ADMIN PRIVILEGES ACTIVATED (Overrides Active)
          <button 
            onClick={() => setIsAdmin(false)} 
            style={{
              background:"rgba(0,0,0,0.15)", border:"none", borderRadius:4, color:"#000",
              fontSize:9, fontWeight:800, padding:"2px 6px", cursor:"pointer"
            }}>
            LOCK ADMIN MODE
          </button>
        </div>
      )}

      {/* Top Header bar */}
      <div style={{
        background:"rgba(6,15,26,0.95)",borderBottom:"1px solid rgba(100,180,255,0.07)",
        padding:"14px 18px",display:"flex",justifyContent:"space-between",alignItems:"center",
        position:"sticky",top:0,zIndex:100,backdropFilter:"blur(10px)",
      }}>
        <div style={{display:"flex",alignItems:"center",gap:10}}>
          <div style={{
            width:36,height:36,borderRadius:10,
            background:"linear-gradient(135deg,#0a5c36,#0d7a48)",
            border:"1.5px solid rgba(200,146,10,0.4)",
            display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0,
          }}>
            <svg width="20" height="20" viewBox="0 0 80 80" fill="none">
              <path d="M48 22A19 19 0 1 0 48 58" stroke="white" strokeWidth="5.5" strokeLinecap="round" fill="none"/>
              <path d="M42 30L53 20L64 30" stroke="#c8920a" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" fill="none"/>
              <line x1="53" y1="20" x2="53" y2="44" stroke="#c8920a" strokeWidth="4" strokeLinecap="round"/>
            </svg>
          </div>
          <div>
            <div style={{display:"flex",flexDirection:"column",gap:0}}>
              <div style={{fontSize:14,fontWeight:800,color:"#e8f4fd",letterSpacing:1,fontFamily:"serif"}}>CREDA</div>
              <div style={{fontSize:8,color:"rgba(200,146,10,0.7)",letterSpacing:2,textTransform:"uppercase",lineHeight:1}}>Finance</div>
            </div>
          </div>
        </div>
        
        <div style={{display:"flex",alignItems:"center",gap:10}}>
          {saving && <div style={{fontSize:11,color:"#3b82f6",display:"flex",alignItems:"center",gap:4}}><Icon name="cloud" size={12}/>Saving…</div>}
          {savedFlash && !saving && <div style={{fontSize:11,color:"#22c55e",display:"flex",alignItems:"center",gap:4}}><Icon name="check" size={12}/>Saved ✓</div>}
          
          {/* Quick Admin Security Toggle Indicator */}
          <button 
            onClick={() => isAdmin ? setIsAdmin(false) : setShowAdminLogin(true)}
            style={{
              background: isAdmin ? "rgba(245,158,11,0.15)" : "rgba(255,255,255,0.06)",
              border: isAdmin ? "1px solid #f59e0b" : "1px solid rgba(255,255,255,0.1)",
              color: isAdmin ? "#f59e0b" : "#8ab4c8", width:30, height:30, borderRadius:8,
              cursor:"pointer", display:"flex", alignItems:"center", justifyContent:"center"
            }}
            title={isAdmin ? "Lock Administrator Panel" : "Activate Administrator Panel"}>
            <Icon name={isAdmin ? "unlock" : "lock"} size={14}/>
          </button>

          <button onClick={() => setShowSettings(true)} style={{
            background:"rgba(255,255,255,0.06)",border:"1px solid rgba(255,255,255,0.1)",
            color:"#8ab4c8",width:30,height:30,borderRadius:8,cursor:"pointer",
            display:"flex",alignItems:"center",justifyContent:"center",
          }} title="Settings & Backup">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 010 2.83 2 2 0 01-2.83 0l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83-2.83l.06-.06A1.65 1.65 0 004.68 15a1.65 1.65 0 00-1.51-1H3a2 2 0 010-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 012.83-2.83l.06.06A1.65 1.65 0 009 4.68a1.65 1.65 0 001-1.51V3a2 2 0 014 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 2.83l-.06.06A1.65 1.65 0 0019.4 9a1.65 1.65 0 001.51 1H21a2 2 0 010 4h-.09a1.65 1.65 0 00-1.51 1z"/></svg>
          </button>
        </div>
      </div>

      {/* Main Container */}
      <div style={{padding:"20px 16px 100px",maxWidth:540,margin:"0 auto"}}>
        {view === "dashboard" && <Dashboard/>}
        {view === "clients" && <ClientsList/>}
        {view === "ledger" && <Ledger/>}
        {view === "detail" && <Detail/>}
      </div>

      {/* Dynamic bottom system navigation */}
      <div style={{
        position:"fixed",bottom:0,left:0,right:0,
        background:"rgba(6,15,26,0.97)",borderTop:"1px solid rgba(100,180,255,0.07)",
        display:"flex",backdropFilter:"blur(12px)",zIndex: 900
      }}>
        {[
          {id:"dashboard",label:"Overview",icon:"dashboard"},
          {id:"clients",label:"Clients File",icon:"user"},
          {id:"ledger",label:"Ledger Log",icon:"ledger"},
        ].map(n => {
          const active = view===n.id || (view==="detail" && n.id==="clients");
          return (
            <button key={n.id} onClick={() => setView(n.id)} style={{
              flex:1,padding:"12px 8px 14px",
              background:"transparent",border:"none",cursor:"pointer",
              color:active?"#22c55e":"#4a6880",
              display:"flex",flexDirection:"column",alignItems:"center",gap:4,
            }}>
              <Icon name={n.icon} size={18}/>
              <span style={{fontSize:10,fontWeight:600,letterSpacing:0.4}}>{n.label}</span>
            </button>
          );
        })}
      </div>

      {/* Admin Verification Modal */}
      {showAdminLogin && (
        <Modal title="🛡️ Enter Admin Code" onClose={() => setShowAdminLogin(false)}>
          <div style={{textAlign:"center", marginBottom:14, fontSize:13, color:"#8ab4c8"}}>
            Enter security validation PIN to authorize direct ledger adjustments.
          </div>
          <Field label="Security PIN *">
            <input 
              type="password" 
              style={inputStyle} 
              value={adminPinInput} 
              onChange={e => setAdminPinInput(e.target.value)}
              placeholder="e.g. ****"
              onKeyDown={e => e.key === "Enter" && handleAdminVerify()}
              autoFocus
            />
          </Field>
          <div style={{fontSize:11, color:"#3a5a70", marginBottom:14, textAlign:"center"}}>
            Standard security master override code is <strong>2026</strong>
          </div>
          <button onClick={handleAdminVerify} style={{
            width:"100%",background:"linear-gradient(135deg,#f59e0b,#d97706)",border:"none",
            color:"#000",padding:"12px",borderRadius:12,cursor:"pointer",fontWeight:800,fontSize:14,
          }}>✓ Unlock Admin overrides</button>
        </Modal>
      )}

      {/* Admin Schedule Installment Line Editor override modal */}
      {adminEditInstallment && (
        <Modal title="🛠️ Admin Installment override" onClose={() => setAdminEditInstallment(null)}>
          <div style={{
            background:"rgba(245,158,11,0.08)", border:"1px solid rgba(245,158,11,0.2)",
            borderRadius:10, padding:12, fontSize:12, color:"#f59e0b", marginBottom:16
          }}>
            Modifying <strong>Installment {adminEditInstallment.idx + 1}</strong> of loan for <strong>{adminEditInstallment.client.name}</strong>. Values override safe ledger algorithms.
          </div>

          <div style={{display:"flex", alignItems:"center", gap:10, marginBottom:16}}>
            <label style={{fontSize:12, color:"#8ab4c8", fontWeight:600, flexGrow:1}}>Status: Marked as Paid?</label>
            <input 
              type="checkbox" 
              style={{width:20, height:20, accentColor:"#22c55e", cursor:"pointer"}}
              checked={adminInstOverride.paid} 
              onChange={e => setAdminInstOverride(prev => ({ ...prev, paid: e.target.checked }))}
            />
          </div>

          {adminInstOverride.paid && (
            <>
              <Field label="Amount Received (₦)">
                <input 
                  type="number" 
                  style={inputStyle} 
                  value={adminInstOverride.paidAmount} 
                  onChange={e => setAdminInstOverride(prev => ({ ...prev, paidAmount: e.target.value }))}
                />
              </Field>
              <Field label="Received Date">
                <input 
                  type="date" 
                  style={inputStyle} 
                  value={adminInstOverride.paidDate} 
                  onChange={e => setAdminInstOverride(prev => ({ ...prev, paidDate: e.target.value }))}
                />
              </Field>
            </>
          )}

          <Field label="Target Due Date">
            <input 
              type="date" 
              style={inputStyle} 
              value={adminInstOverride.dueDate} 
              onChange={e => setAdminInstOverride(prev => ({ ...prev, dueDate: e.target.value }))}
            />
          </Field>

          <button onClick={handleAdminInstallmentOverride} style={{
            width:"100%",background:"#f59e0b",border:"none",
            color:"#000",padding:"12px",borderRadius:12,cursor:"pointer",fontWeight:800,fontSize:14,
          }}>✓ Force Overwrite Installment</button>
        </Modal>
      )}

      {/* Savings Action (Deposit / Withdraw / Admin Override) Modal */}
      {showSavingsTx && (
        <Modal title={showSavingsTx.type === "deposit" ? "📥 Deposit Savings" : "📤 Withdraw Savings"} onClose={() => setShowSavingsTx(null)}>
          <div style={{
            background:"rgba(168,85,247,0.08)", border:"1px solid rgba(168,85,247,0.15)",
            borderRadius:10, padding:"9px 13px", marginBottom:16, fontSize:13, color:"#c084fc",
          }}>
            Client: <strong>{showSavingsTx.client.name}</strong><br/>
            Current Balance: <strong>{formatCurrency(showSavingsTx.client.savingsBalance || 0)}</strong>
          </div>

          <Field label="Amount (₦) *">
            <input 
              type="number" 
              style={inputStyle} 
              value={savingsAmount} 
              onChange={e => setSavingsAmount(e.target.value)} 
              placeholder="e.g. 10000"
              autoFocus
            />
          </Field>

          <button onClick={handleSavingsTransaction} style={{
            width:"100%",background:"linear-gradient(135deg,#a855f7,#7c3aed)",border:"none",
            color:"#fff",padding:"12px",borderRadius:12,cursor:"pointer",fontWeight:800,fontSize:14,marginBottom:20
          }}>
            Confirm {showSavingsTx.type === "deposit" ? "Deposit" : "Withdrawal"}
          </button>

          {/* Admin Manual Override Subsection within savings */}
          {isAdmin && (
            <div style={{borderTop:"1px dashed rgba(255,255,255,0.1)", paddingTop:16}}>
              <div style={{fontSize:11, color:"#f59e0b", fontWeight:700, marginBottom:8}}>🛡️ ADMIN DIRECT BALANCE ADJUSTMENT</div>
              <Field label="Manually Overwrite Balance To (₦)">
                <input 
                  type="number" 
                  style={{...inputStyle, border:"1px solid rgba(245,158,11,0.3)"}} 
                  value={adminDirectSavingsInput} 
                  onChange={e => setAdminDirectSavingsInput(e.target.value)}
                  placeholder="Direct new balance amount"
                />
              </Field>
              <button onClick={handleAdminSavingsAdjustment} style={{
                width:"100%",background:"#f59e0b",border:"none",
                color:"#000",padding:"10px",borderRadius:10,cursor:"pointer",fontWeight:700,fontSize:12,
              }}>
                Force Adjust Balance
              </button>
            </div>
          )}
        </Modal>
      )}

      {/* Add Client Modal */}
      {showAddClient && (
        <Modal title="Register New Client" onClose={() => setShowAddClient(false)}>
          <Field label="Full Name *"><input style={inputStyle} value={newClient.name} onChange={e=>setNewClient(p=>({...p,name:e.target.value}))} placeholder="e.g. Amaka Johnson"/></Field>
          <Field label="Phone Number *"><input style={inputStyle} value={newClient.phone} onChange={e=>setNewClient(p=>({...p,phone:e.target.value}))} placeholder="08012345678"/></Field>
          <Field label="Address"><input style={inputStyle} value={newClient.address} onChange={e=>setNewClient(p=>({...p,address:e.target.value}))} placeholder="Street, City"/></Field>
          <Field label="ID / BVN Number"><input style={inputStyle} value={newClient.idNumber} onChange={e=>setNewClient(p=>({...p,idNumber:e.target.value}))} placeholder="National ID or BVN"/></Field>
          <button onClick={handleAddClient} style={{
            width:"100%",background:"linear-gradient(135deg,#22c55e,#16a34a)",border:"none",
            color:"#000",padding:"12px",borderRadius:12,cursor:"pointer",fontWeight:800,fontSize:14,marginTop:6,
          }}>✓ Register Client</button>
        </Modal>
      )}

      {/* Edit Client Modal */}
      {showEditClient && (
        <Modal title="Edit Client Profile" onClose={() => setShowEditClient(null)}>
          <Field label="Full Name *">
            <input style={inputStyle} value={showEditClient.name} onChange={e=>setShowEditClient(p=>({...p,name:e.target.value}))}/>
          </Field>
          <Field label="Phone Number *">
            <input style={inputStyle} value={showEditClient.phone} onChange={e=>setShowEditClient(p=>({...p,phone:e.target.value}))}/>
          </Field>
          <Field label="Address">
            <input style={inputStyle} value={showEditClient.address || ""} onChange={e=>setShowEditClient(p=>({...p,address:e.target.value}))}/>
          </Field>
          <Field label="ID / BVN Number">
            <input style={inputStyle} value={showEditClient.idNumber || ""} onChange={e=>setShowEditClient(p=>({...p,idNumber:e.target.value}))}/>
          </Field>
          <button onClick={handleUpdateClient} style={{
            width:"100%",background:"linear-gradient(135deg,#3b82f6,#2563eb)",border:"none",
            color:"#fff",padding:"12px",borderRadius:12,cursor:"pointer",fontWeight:800,fontSize:14,marginTop:6,
          }}>✓ Save Changes</button>
        </Modal>
      )}

      {/* Add Loan Modal */}
      {showAddLoan && (
        <Modal title="Issue New Loan" onClose={() => setShowAddLoan(false)}>
          <div style={{
            background:"rgba(59,130,246,0.08)",border:"1px solid rgba(59,130,246,0.15)",
            borderRadius:9,padding:"9px 13px",marginBottom:16,fontSize:13,color:"#93c5fd",
          }}>Client: <strong>{selectedClient?.name}</strong></div>
          <Field label="Principal Amount (₦) *"><input type="number" style={inputStyle} value={newLoan.principal} onChange={e=>setNewLoan(p=>({...p,principal:e.target.value}))} placeholder="e.g. 50000"/></Field>
          <Field label="Interest Rate (% flat on principal)"><input type="number" style={inputStyle} value={newLoan.interestRate} onChange={e=>setNewLoan(p=>({...p,interestRate:e.target.value}))}/></Field>
          <Field label="Duration (Repayment Runs)"><input type="number" style={inputStyle} value={newLoan.days} onChange={e=>setNewLoan(p=>({...p,days:e.target.value}))} placeholder="e.g. 20"/></Field>
          <Field label="Start Date"><input type="date" style={inputStyle} value={newLoan.startDate} onChange={e=>setNewLoan(p=>({...p,startDate:e.target.value}))}/></Field>
          
          <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",padding:"8px 0 16px"}}>
            <span style={{fontSize:12,color:"#8ab4c8",fontWeight:600}}>Observe Weekends & Pub Holidays?</span>
            <input
              type="checkbox"
              style={{width:20,height:20,accentColor:"#22c55e",cursor:"pointer"}}
              checked={newLoan.excludeWeekends}
              onChange={(e) => setNewLoan(p=>({...p,excludeWeekends:e.target.checked}))}
            />
          </div>

          {newLoan.principal && (
            <div style={{
              background:"rgba(34,197,94,0.06)",border:"1px solid rgba(34,197,94,0.12)",
              borderRadius:10,padding:"12px 14px",marginBottom:14,
              display:"grid",gridTemplateColumns:"1fr 1fr",gap:10,
            }}>
              {(() => {
                const p=parseFloat(newLoan.principal)||0;
                const r=parseFloat(newLoan.interestRate)||0;
                const d=parseInt(newLoan.days)||1;
                const total=p+(p*r/100);
                const daily=total/d;
                return (<>
                  <div><div style={{fontSize:10,color:"#3a5a70",marginBottom:3}}>TOTAL REPAYABLE</div><div style={{color:"#4ade80",fontWeight:700,fontFamily:"'Courier New',monospace",fontSize:13}}>{formatCurrency(total)}</div></div>
                  <div><div style={{fontSize:10,color:"#3a5a70",marginBottom:3}}>DAILY RUN PAYMENT</div><div style={{color:"#60a5fa",fontWeight:700,fontFamily:"'Courier New',monospace",fontSize:13}}>{formatCurrency(daily)}</div></div>
                  <div><div style={{fontSize:10,color:"#3a5a70",marginBottom:3}}>INTEREST AMOUNT</div><div style={{color:"#c4b5fd",fontWeight:700,fontFamily:"'Courier New',monospace",fontSize:13}}>{formatCurrency(p*r/100)}</div></div>
                  <div><div style={{fontSize:10,color:"#3a5a70",marginBottom:3}}>WORKING DAYS</div><div style={{color:"#f59e0b",fontWeight:700,fontFamily:"'Courier New',monospace",fontSize:13}}>{d} days</div></div>
                </>);
              })()}
            </div>
          )}
          <button onClick={handleAddLoan} style={{
            width:"100%",background:"linear-gradient(135deg,#22c55e,#16a34a)",border:"none",
            color:"#000",padding:"12px",borderRadius:12,cursor:"pointer",fontWeight:800,fontSize:14,
          }}>✓ Issue Loan</button>
        </Modal>
      )}

      {/* Record Payment Modal */}
      {showPayment && (() => {
        const cl = clients.find(c=>c.id===showPayment.clientId);
        const ln = cl?.loans?.find(l=>l.id===showPayment.loanId);
        return (
          <Modal title="Record Payment" onClose={() => { setShowPayment(null); setPaymentAmount(""); }}>
            <div style={{textAlign:"center",marginBottom:20}}>
              <div style={{fontSize:12,color:"#3a5a70",marginBottom:4}}>Expected Run Amount</div>
              <div style={{fontSize:26,fontWeight:800,color:"#4ade80",fontFamily:"'Courier New',monospace"}}>
                {formatCurrency(ln?.dailyPayment||0)}
              </div>
              <div style={{fontSize:11,color:"#3a5a70",marginTop:4}}>Day {showPayment.scheduleIdx+1} of {ln?.days} scheduled runs</div>
            </div>
            <Field label="Amount Received (₦)">
              <input type="number" style={inputStyle} value={paymentAmount}
                onChange={e=>setPaymentAmount(e.target.value)} placeholder="Enter amount paid" autoFocus/>
            </Field>
            <button onClick={handlePayment} style={{
              width:"100%",background:"linear-gradient(135deg,#22c55e,#16a34a)",border:"none",
              color:"#000",padding:"12px",borderRadius:12,cursor:"pointer",fontWeight:800,fontSize:14,marginTop:6,
            }}>✓ Confirm Payment</button>
          </Modal>
        );
      })()}

      {/* Settings & Backup Modal */}
      {showSettings && (
        <Modal title="⚙️ Settings & Backup" onClose={() => setShowSettings(false)}>
          <div style={{display:"flex",flexDirection:"column",gap:14}}>

            <div style={{background:"rgba(34,197,94,0.06)",border:"1px solid rgba(34,197,94,0.15)",borderRadius:10,padding:"12px 14px"}}>
              <div style={{fontSize:12,color:"#4ade80",fontWeight:700,marginBottom:4}}>💾 Data Storage</div>
              <div style={{fontSize:12,color:"#6b7a8d",lineHeight:1.5}}>Your data is saved on this device's browser storage. It stays safe even after closing the app — as long as you use the same browser on the same phone.</div>
            </div>

            <div>
              <div style={{fontSize:12,color:"#8a9bb0",marginBottom:8,fontWeight:600}}>📤 EXPORT BACKUP</div>
              <button onClick={() => { exportData(clients); setShowSettings(false); }} style={{
                width:"100%",background:"linear-gradient(135deg,#22c55e,#16a34a)",border:"none",
                color:"#000",padding:"11px",borderRadius:10,cursor:"pointer",fontWeight:700,fontSize:13,
              }}>Download Backup File (.json)</button>
              <div style={{fontSize:11,color:"#4a5568",marginTop:5,textAlign:"center"}}>Save this file to Google Drive or WhatsApp yourself for safekeeping</div>
            </div>

            <div>
              <div style={{fontSize:12,color:"#8a9bb0",marginBottom:8,fontWeight:600}}>📥 RESTORE FROM BACKUP</div>
              <label style={{
                display:"block",width:"100%",background:"rgba(96,165,250,0.1)",
                border:"1px solid rgba(96,165,250,0.25)",
                color:"#60a5fa",padding:"11px",borderRadius:10,cursor:"pointer",
                fontWeight:700,fontSize:13,textAlign:"center",
              }}>
                Choose Backup File to Restore
                <input type="file" accept=".json" style={{display:"none"}} onChange={(e) => {
                  if (e.target.files[0]) {
                    importData(e.target.files[0], (data) => {
                      setClients(data);
                      setShowSettings(false);
                      alert("✅ Data restored successfully! " + data.length + " clients loaded.");
                    });
                  }
                }}/>
              </label>
              <div style={{fontSize:11,color:"#4a5568",marginTop:5,textAlign:"center"}}>Only use .json files exported from this app</div>
            </div>

            <div style={{borderTop:"1px solid rgba(255,255,255,0.06)",paddingTop:14}}>
              <div style={{fontSize:12,color:"#8a9bb0",marginBottom:8,fontWeight:600}}>📊 STORAGE INFO</div>
              <div style={{background:"rgba(255,255,255,0.03)",borderRadius:8,padding:"10px 12px"}}>
                <div style={{display:"flex",justifyContent:"space-between",fontSize:12,color:"#6b7a8d",marginBottom:4}}>
                  <span>Total Clients</span><span style={{color:"#fff",fontWeight:600}}>{clients.length}</span>
                </div>
                <div style={{display:"flex",justifyContent:"space-between",fontSize:12,color:"#6b7a8d",marginBottom:4}}>
                  <span>Active Loans</span><span style={{color:"#4ade80",fontWeight:600}}>{clients.reduce((a,c)=>a+(c.loans?.filter(l=>l.status==="active").length||0),0)}</span>
                </div>
                <div style={{display:"flex",justifyContent:"space-between",fontSize:12,color:"#6b7a8d"}}>
                  <span>Data Size</span><span style={{color:"#60a5fa",fontWeight:600}}>{(JSON.stringify(clients).length / 1024).toFixed(1)} KB</span>
                </div>
              </div>
            </div>

            <div style={{borderTop:"1px solid rgba(255,255,255,0.06)",paddingTop:14}}>
              <div style={{fontSize:12,color:"#f87171",marginBottom:8,fontWeight:600}}>⚠️ DANGER ZONE</div>
              <button onClick={() => {
                if (window.confirm("Are you sure? This will DELETE ALL clients and loans permanently.")) {
                  setClients([]);
                  localStorage.removeItem("creda_clients");
                  setShowSettings(false);
                }
              }} style={{
                width:"100%",background:"rgba(248,113,113,0.1)",
                border:"1px solid rgba(248,113,113,0.2)",
                color:"#f87171",padding:"10px",borderRadius:10,cursor:"pointer",
                fontWeight:600,fontSize:12,
              }}>🗑️ Clear All Data</button>
            </div>
          </div>
        </Modal>
      )}

      {/* Confirm Delete Modal */}
      {confirmDelete && (
        <Modal title="Delete Client?" onClose={() => setConfirmDelete(null)}>
          <p style={{color:"#8ab4c8",fontSize:14,marginBottom:20,lineHeight:1.6}}>
            This will permanently delete the client and all their loan records. This cannot be undone.
          </p>
          <div style={{display:"flex",gap:10}}>
            <button onClick={() => setConfirmDelete(null)} style={{
              flex:1,background:"rgba(255,255,255,0.05)",border:"1px solid rgba(255,255,255,0.08)",
              color:"#8ab4c8",padding:"11px",borderRadius:11,cursor:"pointer",fontWeight:700,fontSize:13,
            }}>Cancel</button>
            <button onClick={() => handleDeleteClient(confirmDelete)} style={{
              flex:1,background:"linear-gradient(135deg,#dc2626,#b91c1c)",border:"none",
              color:"#fff",padding:"11px",borderRadius:11,cursor:"pointer",fontWeight:700,fontSize:13,
            }}>Delete</button>
          </div>
        </Modal>
      )}
    </div>
  );
                                                        }
