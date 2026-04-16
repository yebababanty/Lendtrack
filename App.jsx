import { useState, useEffect, useMemo } from "react";

// \u2500\u2500\u2500 STORAGE HELPERS \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
async function loadClients() {
  try {
    const result = await window.storage.get("lendtrack_clients");
    return result ? JSON.parse(result.value) : [];
  } catch {
    return [];
  }
}

async function saveClients(clients) {
  try {
    await window.storage.set("lendtrack_clients", JSON.stringify(clients));
  } catch (e) {
    console.error("Save failed:", e);
  }
}

// \u2500\u2500\u2500 UTILS \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
function generateId(prefix = "CL") {
  return prefix + Date.now().toString().slice(-6) + Math.floor(Math.random() * 100);
}

function formatCurrency(amount) {
  return "\u20a6" + Number(amount || 0).toLocaleString("en-NG", { minimumFractionDigits: 2 });
}

function formatDate(dateStr) {
  if (!dateStr) return "\u2014";
  return new Date(dateStr).toLocaleDateString("en-NG", { day: "2-digit", month: "short", year: "numeric" });
}

function calcLoanSchedule(principal, interestRate, months, startDate) {
  const monthlyInterest = (principal * interestRate) / 100;
  const totalRepayable = principal + monthlyInterest * months;
  const monthlyPayment = totalRepayable / months;
  const schedule = [];
  let balance = totalRepayable;
  const start = new Date(startDate);
  for (let i = 1; i <= months; i++) {
    const dueDate = new Date(start);
    dueDate.setMonth(dueDate.getMonth() + i);
    balance = Math.max(0, balance - monthlyPayment);
    schedule.push({
      month: i,
      dueDate: dueDate.toISOString().split("T")[0],
      payment: monthlyPayment,
      balance,
      paid: false,
      paidDate: null,
      paidAmount: 0,
    });
  }
  return { monthlyPayment, totalRepayable, monthlyInterest, schedule };
}

// \u2500\u2500\u2500 ICONS \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
const Icon = ({ name, size = 16 }) => {
  const icons = {
    plus: <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>,
    user: <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="8" r="4"/><path d="M4 20c0-4 3.6-7 8-7s8 3 8 7"/></svg>,
    check: <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="20 6 9 17 4 12"/></svg>,
    back: <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="15 18 9 12 15 6"/></svg>,
    dashboard: <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/></svg>,
    trash: <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6"/><path d="M10 11v6M14 11v6M9 6V4h6v2"/></svg>,
    save: <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M19 21H5a2 2 0 01-2-2V5a2 2 0 012-2h11l5 5v11a2 2 0 01-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/></svg>,
    cloud: <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 10h-1.26A8 8 0 109 20h9a5 5 0 000-10z"/></svg>,
  };
  return icons[name] || null;
};

// \u2500\u2500\u2500 COMPONENTS \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
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
          }}>\u00d7</button>
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

// \u2500\u2500\u2500 MAIN APP \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
export default function App() {
  const [clients, setClients] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [savedFlash, setSavedFlash] = useState(false);
  const [view, setView] = useState("dashboard");
  const [selectedClientId, setSelectedClientId] = useState(null);
  const [activeTab, setActiveTab] = useState("schedule");

  // Modals
  const [showAddClient, setShowAddClient] = useState(false);
  const [showAddLoan, setShowAddLoan] = useState(false);
  const [showPayment, setShowPayment] = useState(null);
  const [paymentAmount, setPaymentAmount] = useState("");
  const [confirmDelete, setConfirmDelete] = useState(null);

  // Form state
  const [newClient, setNewClient] = useState({ name:"", phone:"", address:"", idNumber:"" });
  const [newLoan, setNewLoan] = useState({
    principal:"", interestRate:"10", months:"10",
    startDate: new Date().toISOString().split("T")[0],
  });

  // Load from storage on mount
  useEffect(() => {
    loadClients().then(data => {
      setClients(data);
      setLoading(false);
    });
  }, []);

  // Save to storage whenever clients change (skip initial load)
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

  // \u2500\u2500 STATS \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
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
    return { totalDisbursed, totalExpected, totalCollected, outstanding, overdueCount };
  }, [clients]);

  // \u2500\u2500 ACTIONS \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
  const handleAddClient = () => {
    if (!newClient.name.trim() || !newClient.phone.trim()) return;
    const client = {
      ...newClient,
      id: generateId("CL"),
      loans: [],
      createdAt: new Date().toISOString().split("T")[0],
    };
    const updated = [client, ...clients];
    updateClients(updated);
    setNewClient({ name:"", phone:"", address:"", idNumber:"" });
    setShowAddClient(false);
  };

  const handleAddLoan = () => {
    if (!newLoan.principal || !selectedClientId) return;
    const p = parseFloat(newLoan.principal);
    const r = parseFloat(newLoan.interestRate);
    const m = parseInt(newLoan.months);
    const { monthlyPayment, totalRepayable, monthlyInterest, schedule } = calcLoanSchedule(p, r, m, newLoan.startDate);
    const loan = {
      id: generateId("LN"), principal: p, interestRate: r, months: m,
      startDate: newLoan.startDate, monthlyPayment, totalRepayable,
      monthlyInterest, schedule, status: "active",
      issuedAt: new Date().toISOString(),
    };
    const updated = clients.map(c =>
      c.id === selectedClientId ? { ...c, loans: [...c.loans, loan] } : c
    );
    updateClients(updated);
    setNewLoan({ principal:"", interestRate:"10", months:"10", startDate: new Date().toISOString().split("T")[0] });
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

  const handleDeleteClient = (id) => {
    updateClients(clients.filter(c => c.id !== id));
    setConfirmDelete(null);
    setView("clients");
  };

  // \u2500\u2500 RENDER HELPERS \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
  const getClientLoanSummary = (c) => {
    const active = c.loans?.find(l => l.status === "active");
    const overdue = active?.schedule?.filter(s => !s.paid && new Date(s.dueDate) < today).length || 0;
    const paid = active?.schedule?.filter(s => s.paid).length || 0;
    const total = active?.schedule?.length || 0;
    const balance = active ? (active.schedule.find(s => !s.paid)?.balance ?? 0) : 0;
    return { active, overdue, paid, total, balance };
  };

  // \u2500\u2500 LOADING SCREEN \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
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
      }}>\ud83d\udcb0</div>
      <div style={{color:"#4a7090",fontSize:14}}>Loading your data\u2026</div>
    </div>
  );

  // \u2500\u2500 DASHBOARD \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
  const Dashboard = () => (
    <div>
      <div style={{marginBottom:22}}>
        <h1 style={{margin:0,fontSize:24,fontWeight:800,color:"#e8f4fd",letterSpacing:-0.5}}>Dashboard</h1>
        <p style={{margin:"4px 0 0",color:"#3a5a70",fontSize:13}}>{clients.length} clients \u00b7 {clients.reduce((a,c) => a + (c.loans?.filter(l=>l.status==="active").length||0),0)} active loans</p>
      </div>
      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10,marginBottom:24}}>
        <StatCard label="Disbursed" value={formatCurrency(stats.totalDisbursed)} accent="#3b82f6" />
        <StatCard label="Collected" value={formatCurrency(stats.totalCollected)} accent="#22c55e" />
        <StatCard label="Outstanding" value={formatCurrency(stats.outstanding)} accent="#f59e0b" />
        <StatCard label="Overdue" value={stats.overdueCount + " payments"} accent="#ef4444" />
      </div>

      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:12}}>
        <div style={{fontSize:14,fontWeight:700,color:"#c8dde8"}}>Recent Clients</div>
        <button onClick={() => setView("clients")} style={{background:"none",border:"none",color:"#3b82f6",fontSize:12,cursor:"pointer"}}>See all \u2192</button>
      </div>

      {clients.length === 0 ? (
        <div style={{
          border:"1px dashed rgba(100,180,255,0.1)",borderRadius:14,padding:40,
          textAlign:"center",color:"#2a4050",
        }}>
          <div style={{fontSize:36,marginBottom:10}}>\ud83d\udcb3</div>
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

  // \u2500\u2500 CLIENTS \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
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
      {clients.length === 0 ? (
        <div style={{textAlign:"center",padding:60,color:"#2a4050",border:"1px dashed rgba(100,180,255,0.08)",borderRadius:14}}>
          <div style={{fontSize:36,marginBottom:10}}>\ud83d\udc64</div>
          <div>No clients yet. Add one to get started.</div>
        </div>
      ) : (
        <div style={{display:"flex",flexDirection:"column",gap:9}}>
          {clients.map(c => {
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
                      <div style={{fontSize:11,color:"#3a5a70",marginTop:1}}>{c.id} \u00b7 {c.phone}</div>
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
                      <span>{paid}/{total} payments made</span>
                      <span style={{color:overdue>0?"#f87171":"#3a6050"}}>{overdue>0?`${overdue} overdue`:"On track \u2713"}</span>
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

  // \u2500\u2500 DETAIL \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
  const Detail = () => {
    if (!selectedClient) return null;
    const c = selectedClient;
    const activeLoan = c.loans?.find(l => l.status === "active");
    const completedLoans = c.loans?.filter(l => l.status === "completed") || [];

    const loanSummaryPreview = useMemo(() => {
      const p = parseFloat(newLoan.principal) || 0;
      const r = parseFloat(newLoan.interestRate) || 0;
      const m = parseInt(newLoan.months) || 1;
      const totalInterest = (p * r / 100) * m;
      const totalRepayable = p + totalInterest;
      return { totalRepayable, monthly: totalRepayable / m };
    }, [newLoan.principal, newLoan.interestRate, newLoan.months]);

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
          <div>
            <div style={{fontSize:18,fontWeight:800,color:"#e8f4fd"}}>{c.name}</div>
            <div style={{fontSize:11,color:"#3a5a70"}}>{c.id} \u00b7 Joined {formatDate(c.createdAt)}</div>
          </div>
        </div>

        {/* Info card */}
        <div style={{
          background:"rgba(100,180,255,0.04)",border:"1px solid rgba(100,180,255,0.08)",
          borderRadius:13,padding:"14px 16px",marginBottom:16,
          display:"grid",gridTemplateColumns:"1fr 1fr",gap:10,
        }}>
          <div><div style={{fontSize:10,color:"#3a5a70",marginBottom:3}}>PHONE</div><div style={{color:"#c8dde8",fontSize:13}}>{c.phone||"\u2014"}</div></div>
          <div><div style={{fontSize:10,color:"#3a5a70",marginBottom:3}}>ID/BVN</div><div style={{color:"#c8dde8",fontSize:13}}>{c.idNumber||"\u2014"}</div></div>
          <div style={{gridColumn:"1/-1"}}><div style={{fontSize:10,color:"#3a5a70",marginBottom:3}}>ADDRESS</div><div style={{color:"#c8dde8",fontSize:13}}>{c.address||"\u2014"}</div></div>
        </div>

        {/* Loan section */}
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:12}}>
          <div style={{fontSize:15,fontWeight:700,color:"#c8dde8"}}>
            {activeLoan ? "Active Loan" : "Loans"}
          </div>
          {!activeLoan && (
            <button onClick={() => setShowAddLoan(true)} style={{
              background:"linear-gradient(135deg,#22c55e,#16a34a)",border:"none",
              color:"#000",padding:"7px 15px",borderRadius:9,cursor:"pointer",
              fontWeight:700,fontSize:12,display:"flex",alignItems:"center",gap:5,
            }}><Icon name="plus" size={12}/> Issue Loan</button>
          )}
        </div>

        {activeLoan ? (
          <>
            {/* Loan summary */}
            <div style={{
              background:"linear-gradient(135deg,rgba(34,197,94,0.07),rgba(59,130,246,0.05))",
              border:"1px solid rgba(34,197,94,0.15)",borderRadius:14,padding:"16px",marginBottom:14,
            }}>
              <div style={{display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:12,marginBottom:14}}>
                {[
                  ["Principal", formatCurrency(activeLoan.principal), "#93c5fd"],
                  ["Interest", activeLoan.interestRate+"% /mo", "#c4b5fd"],
                  ["Monthly", formatCurrency(activeLoan.monthlyPayment), "#60a5fa"],
                  ["Total Due", formatCurrency(activeLoan.totalRepayable), "#e8f4fd"],
                  ["Balance", formatCurrency(activeLoan.schedule.find(s=>!s.paid)?.balance??0), "#f87171"],
                  ["Progress", `${activeLoan.schedule.filter(s=>s.paid).length}/${activeLoan.months}`, "#4ade80"],
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
                  width:`${(activeLoan.schedule.filter(s=>s.paid).length/activeLoan.months)*100}%`,
                  background:"linear-gradient(90deg,#22c55e,#4ade80)",
                  transition:"width 0.5s",
                }}/>
              </div>
            </div>

            {/* Tabs */}
            <div style={{display:"flex",gap:3,marginBottom:14,background:"rgba(255,255,255,0.03)",borderRadius:10,padding:3}}>
              {["schedule","history"].map(tab => (
                <button key={tab} onClick={() => setActiveTab(tab)} style={{
                  flex:1,padding:"7px",borderRadius:8,border:"none",cursor:"pointer",
                  background:activeTab===tab?"rgba(100,180,255,0.1)":"transparent",
                  color:activeTab===tab?"#93c5fd":"#3a5a70",
                  fontWeight:600,fontSize:12,textTransform:"capitalize",
                }}>{tab}</button>
              ))}
            </div>

            {/* Schedule */}
            {activeTab === "schedule" && (
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
                        }}>{s.paid?<Icon name="check" size={13}/>:`M${i+1}`}</div>
                        <div>
                          <div style={{display:"flex",alignItems:"center",gap:6}}>
                            <span style={{fontSize:13,fontWeight:600,color:s.paid?"#4ade80":isOverdue?"#f87171":"#c8dde8"}}>
                              {formatCurrency(activeLoan.monthlyPayment)}
                            </span>
                            {isNext && <Badge color="#60a5fa" bg="rgba(96,165,250,0.12)">NEXT</Badge>}
                            {isOverdue && <Badge color="#f87171" bg="rgba(239,68,68,0.12)">OVERDUE</Badge>}
                          </div>
                          <div style={{fontSize:10,color:"#3a5a70",marginTop:2}}>
                            Due {formatDate(s.dueDate)}{s.paid&&` \u00b7 Paid ${formatDate(s.paidDate)}`}
                          </div>
                        </div>
                      </div>
                      <div style={{textAlign:"right",flexShrink:0}}>
                        <div style={{fontSize:11,color:"#3a5a70",marginBottom:5,fontFamily:"'Courier New',monospace"}}>
                          {formatCurrency(s.balance)}
                        </div>
                        {!s.paid && (
                          <button onClick={() => {
                            setShowPayment({clientId:c.id,loanId:activeLoan.id,scheduleIdx:i});
                            setPaymentAmount(activeLoan.monthlyPayment.toFixed(2));
                          }} style={{
                            background:"linear-gradient(135deg,#22c55e,#16a34a)",border:"none",
                            color:"#000",padding:"4px 11px",borderRadius:7,cursor:"pointer",
                            fontWeight:700,fontSize:11,
                          }}>Pay</button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            {/* History */}
            {activeTab === "history" && (
              <div>
                {activeLoan.schedule.filter(s=>s.paid).length === 0 ? (
                  <div style={{textAlign:"center",padding:40,color:"#2a4050"}}>No payments yet</div>
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
          </>
        ) : (
          <div style={{
            border:"1px dashed rgba(100,180,255,0.08)",borderRadius:13,padding:40,
            textAlign:"center",color:"#2a4050",
          }}>
            <div style={{fontSize:32,marginBottom:10}}>\ud83d\udcb0</div>
            <div style={{fontSize:13}}>{completedLoans.length>0?`${completedLoans.length} completed loan(s). Issue a new one.`:"No loan yet."}</div>
          </div>
        )}

        <button onClick={() => setConfirmDelete(c.id)} style={{
          marginTop:22,background:"rgba(239,68,68,0.08)",
          border:"1px solid rgba(239,68,68,0.15)",
          color:"#f87171",padding:"9px 18px",borderRadius:10,cursor:"pointer",
          fontWeight:600,fontSize:12,display:"flex",alignItems:"center",gap:7,
        }}><Icon name="trash" size={13}/> Delete Client</button>
      </div>
    );
  };

  // \u2500\u2500\u2500 LAYOUT \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
  return (
    <div style={{minHeight:"100vh",background:"#060f1a",fontFamily:"'Segoe UI',system-ui,sans-serif",color:"#e8f4fd"}}>
      {/* Top bar */}
      <div style={{
        background:"rgba(6,15,26,0.95)",borderBottom:"1px solid rgba(100,180,255,0.07)",
        padding:"14px 18px",display:"flex",justifyContent:"space-between",alignItems:"center",
        position:"sticky",top:0,zIndex:100,backdropFilter:"blur(10px)",
      }}>
        <div style={{display:"flex",alignItems:"center",gap:10}}>
          <div style={{
            width:32,height:32,borderRadius:9,
            background:"linear-gradient(135deg,#22c55e,#0ea5e9)",
            display:"flex",alignItems:"center",justifyContent:"center",fontSize:16,
          }}>\ud83d\udcb0</div>
          <div>
            <div style={{fontSize:15,fontWeight:800,color:"#e8f4fd",letterSpacing:-0.3}}>LendTrack</div>
          </div>
        </div>
        <div style={{display:"flex",alignItems:"center",gap:8}}>
          {saving && <div style={{fontSize:11,color:"#3b82f6",display:"flex",alignItems:"center",gap:4}}><Icon name="cloud" size={12}/>Saving\u2026</div>}
          {savedFlash && !saving && <div style={{fontSize:11,color:"#22c55e",display:"flex",alignItems:"center",gap:4}}><Icon name="check" size={12}/>Saved \u2713</div>}
        </div>
      </div>

      {/* Main */}
      <div style={{padding:"20px 16px 100px",maxWidth:540,margin:"0 auto"}}>
        {view === "dashboard" && <Dashboard/>}
        {view === "clients" && <ClientsList/>}
        {view === "detail" && <Detail/>}
      </div>

      {/* Bottom nav */}
      <div style={{
        position:"fixed",bottom:0,left:0,right:0,
        background:"rgba(6,15,26,0.97)",borderTop:"1px solid rgba(100,180,255,0.07)",
        display:"flex",backdropFilter:"blur(12px)",
      }}>
        {[
          {id:"dashboard",label:"Overview",icon:"dashboard"},
          {id:"clients",label:"Clients",icon:"user"},
        ].map(n => {
          const active = view===n.id || (view==="detail" && n.id==="clients");
          return (
            <button key={n.id} onClick={() => setView(n.id)} style={{
              flex:1,padding:"12px 8px 14px",
              background:"transparent",border:"none",cursor:"pointer",
              color:active?"#22c55e":"#2a4050",
              display:"flex",flexDirection:"column",alignItems:"center",gap:4,
            }}>
              <Icon name={n.icon} size={18}/>
              <span style={{fontSize:10,fontWeight:600,letterSpacing:0.4}}>{n.label}</span>
            </button>
          );
        })}
      </div>

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
          }}>\u2713 Register Client</button>
        </Modal>
      )}

      {/* Add Loan Modal */}
      {showAddLoan && (
        <Modal title="Issue New Loan" onClose={() => setShowAddLoan(false)}>
          <div style={{
            background:"rgba(59,130,246,0.08)",border:"1px solid rgba(59,130,246,0.15)",
            borderRadius:9,padding:"9px 13px",marginBottom:16,fontSize:13,color:"#93c5fd",
          }}>Client: <strong>{selectedClient?.name}</strong></div>
          <Field label="Principal Amount (\u20a6) *"><input type="number" style={inputStyle} value={newLoan.principal} onChange={e=>setNewLoan(p=>({...p,principal:e.target.value}))} placeholder="e.g. 500000"/></Field>
          <Field label="Monthly Interest Rate (%)"><input type="number" style={inputStyle} value={newLoan.interestRate} onChange={e=>setNewLoan(p=>({...p,interestRate:e.target.value}))}/></Field>
          <Field label="Duration (Months)"><input type="number" style={inputStyle} value={newLoan.months} onChange={e=>setNewLoan(p=>({...p,months:e.target.value}))}/></Field>
          <Field label="Start Date"><input type="date" style={inputStyle} value={newLoan.startDate} onChange={e=>setNewLoan(p=>({...p,startDate:e.target.value}))}/></Field>
          {newLoan.principal && (
            <div style={{
              background:"rgba(34,197,94,0.06)",border:"1px solid rgba(34,197,94,0.12)",
              borderRadius:10,padding:"12px 14px",marginBottom:14,
              display:"grid",gridTemplateColumns:"1fr 1fr",gap:10,
            }}>
              <div><div style={{fontSize:10,color:"#3a5a70",marginBottom:3}}>TOTAL REPAYABLE</div><div style={{color:"#4ade80",fontWeight:700,fontFamily:"'Courier New',monospace",fontSize:13}}>{formatCurrency(newLoan.principal && newLoan.interestRate && newLoan.months ? (() => { const p=parseFloat(newLoan.principal)||0; const r=parseFloat(newLoan.interestRate)||0; const m=parseInt(newLoan.months)||1; return p+(p*r/100)*m; })() : 0)}</div></div>
              <div><div style={{fontSize:10,color:"#3a5a70",marginBottom:3}}>MONTHLY PAYMENT</div><div style={{color:"#60a5fa",fontWeight:700,fontFamily:"'Courier New',monospace",fontSize:13}}>{formatCurrency(newLoan.principal && newLoan.interestRate && newLoan.months ? (() => { const p=parseFloat(newLoan.principal)||0; const r=parseFloat(newLoan.interestRate)||0; const m=parseInt(newLoan.months)||1; const total=p+(p*r/100)*m; return total/m; })() : 0)}</div></div>
            </div>
          )}
          <button onClick={handleAddLoan} style={{
            width:"100%",background:"linear-gradient(135deg,#22c55e,#16a34a)",border:"none",
            color:"#000",padding:"12px",borderRadius:12,cursor:"pointer",fontWeight:800,fontSize:14,
          }}>\u2713 Issue Loan</button>
        </Modal>
      )}

      {/* Record Payment Modal */}
      {showPayment && (() => {
        const cl = clients.find(c=>c.id===showPayment.clientId);
        const ln = cl?.loans?.find(l=>l.id===showPayment.loanId);
        return (
          <Modal title="Record Payment" onClose={() => { setShowPayment(null); setPaymentAmount(""); }}>
            <div style={{textAlign:"center",marginBottom:20}}>
              <div style={{fontSize:12,color:"#3a5a70",marginBottom:4}}>Expected Amount</div>
              <div style={{fontSize:26,fontWeight:800,color:"#4ade80",fontFamily:"'Courier New',monospace"}}>
                {formatCurrency(ln?.monthlyPayment||0)}
              </div>
              <div style={{fontSize:11,color:"#3a5a70",marginTop:4}}>Month {showPayment.scheduleIdx+1}
