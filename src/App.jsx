import { useState, useEffect, useMemo, useCallback } from "react";
import { initializeApp } from "firebase/app";
import { getFirestore, doc, setDoc, getDoc, onSnapshot } from "firebase/firestore";

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

async function fbGet(id) {
  try { const s = await getDoc(doc(db, "creda", id)); return s.exists() ? s.data().value : null; }
  catch (e) { return null; }
}
async function fbSet(id, value) {
  try { await setDoc(doc(db, "creda", id), { value }); } catch (e) { console.error(e); }
}
function fbListen(id, cb) {
  return onSnapshot(doc(db, "creda", id), s => { if (s.exists()) cb(s.data().value); });
}

// ─── NIGERIAN HOLIDAYS ────────────────────────────────────────────────────────
function getEaster(y) {
  const a = y % 19, b = Math.floor(y / 100), c = y % 100, d = Math.floor(b / 4), e = b % 4,
    f = Math.floor((b + 8) / 25), g = Math.floor((b - f + 1) / 3), h = (19 * a + b - d - g + 15) % 30,
    i = Math.floor(c / 4), k = c % 4, l = (32 + 2 * e + 2 * i - h - k) % 7, m = Math.floor((a + 11 * h + 22 * l) / 451),
    mo = Math.floor((h + l - 7 * m + 114) / 31), dy = ((h + l - 7 * m + 114) % 31) + 1;
  return new Date(y, mo - 1, dy);
}
function getNigerianHolidays(y) {
  const h = {};
  [["01-01", "New Year's Day"], ["05-01", "Workers Day"], ["06-12", "Democracy Day"],
  ["10-01", "Independence Day"], ["12-25", "Christmas Day"], ["12-26", "Boxing Day"]].forEach(([k, v]) => h[`${y}-${k}`] = v);
  const e = getEaster(y), gf = new Date(e), em = new Date(e);
  gf.setDate(e.getDate() - 2); em.setDate(e.getDate() + 1);
  h[gf.toISOString().split("T")[0]] = "Good Friday";
  h[e.toISOString().split("T")[0]] = "Easter Sunday";
  h[em.toISOString().split("T")[0]] = "Easter Monday";
  if (y === 2026) { h["2026-03-30"] = "Eid-ul-Fitr"; h["2026-06-06"] = "Eid-ul-Adha"; }
  if (y === 2027) { h["2027-03-20"] = "Eid-ul-Fitr"; h["2027-05-27"] = "Eid-ul-Adha"; }
  return h;
}
function isHoliday(d) { if (!d) return null; return getNigerianHolidays(new Date(d).getFullYear())[d] || null; }
function isWorkday(d) { const day = new Date(d).getDay(); return day !== 0 && day !== 6 && !isHoliday(d); }
function getWorkdays(start, count) {
  const days = [], cur = new Date(start); cur.setDate(cur.getDate() + 1);
  while (days.length < count) { const ds = cur.toISOString().split("T")[0]; if (isWorkday(ds)) days.push(ds); cur.setDate(cur.getDate() + 1); }
  return days;
}

// ─── DEFAULTS ─────────────────────────────────────────────────────────────────
const DEFAULT_USERS = [
  { id: "admin_001", username: "Yebaba", password: "Go5win619$", role: "admin", name: "Admin", createdAt: "2026-04-21", active: true }
];

// ─── UTILS ───────────────────────────────────────────────────────────────────
const uid = (p = "") => p + Date.now().toString().slice(-6) + Math.floor(Math.random() * 100);
const fc = (n) => "₦" + Number(n || 0).toLocaleString("en-NG", { minimumFractionDigits: 2 });
const fd = (s) => s ? new Date(s).toLocaleDateString("en-NG", { day: "2-digit", month: "short", year: "numeric" }) : "—";
const mk = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
const mlabel = (k) => { const [y, m] = k.split("-"); return new Date(y, m - 1).toLocaleDateString("en-NG", { month: "long", year: "numeric" }); };
const todayStr = new Date().toISOString().split("T")[0];

function calcLoan(principal, rate, days, startDate) {
  const interest = (principal * rate) / 100, total = principal + interest, daily = total / days;
  const workdays = getWorkdays(startDate, days);
  let bal = total;
  const schedule = workdays.map((date, i) => {
    bal = Math.max(0, bal - daily);
    return { day: i + 1, dueDate: date, payment: daily, balance: bal, paid: false, paidDate: null, paidAmount: 0 };
  });
  return { daily, total, interest, schedule };
}

// ─── COLORS ──────────────────────────────────────────────────────────────────
const G = "#0a5c36", GM = "#0d7a48", GOLD = "#c8920a", GL = "#e8b420";
const RED = "#f87171", BLUE = "#60a5fa", PURPLE = "#c4b5fd";

// ─── SMALL COMPONENTS ────────────────────────────────────────────────────────
function Modal({ title, onClose, children }) {
  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,8,20,0.93)", zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "center", padding: 16, backdropFilter: "blur(8px)" }}>
      <div style={{ background: "#0d1b2a", border: "1px solid rgba(100,180,255,0.08)", borderRadius: 20, width: "100%", maxWidth: 500, maxHeight: "92vh", overflowY: "auto", boxShadow: "0 40px 100px rgba(0,0,0,0.7)" }}>
        <div style={{ padding: "20px 22px 14px", borderBottom: "1px solid rgba(100,180,255,0.08)", display: "flex", justifyContent: "space-between", alignItems: "center", position: "sticky", top: 0, background: "#0d1b2a", borderRadius: "20px 20px 0 0", zIndex: 1 }}>
          <h2 style={{ margin: 0, fontSize: 17, fontWeight: 700, color: "#e8f4fd" }}>{title}</h2>
          <button onClick={onClose} style={{ background: "rgba(255,255,255,0.06)", border: "none", color: "#8ab4c8", width: 30, height: 30, borderRadius: 8, cursor: "pointer", fontSize: 17 }}>×</button>
        </div>
        <div style={{ padding: "20px 22px" }}>{children}</div>
      </div>
    </div>
  );
}

function Fld({ label, children }) {
  return <div style={{ marginBottom: 14 }}><label style={{ display: "block", fontSize: 11, color: "#3a5a70", marginBottom: 5, letterSpacing: 0.8, textTransform: "uppercase" }}>{label}</label>{children}</div>;
}

function GBtn({ onClick, children, color = G, text = "#000", full, style = {}, disabled }) {
  return <button onClick={onClick} disabled={disabled} style={{ background: `linear-gradient(135deg,${color},${color}cc)`, border: "none", color: text, padding: "11px 18px", borderRadius: 11, cursor: disabled ? "not-allowed" : "pointer", fontWeight: 700, fontSize: 13, width: full ? "100%" : undefined, opacity: disabled ? 0.5 : 1, ...style }}>{children}</button>;
}

function Badge({ label, color, bg }) {
  return <span style={{ fontSize: 10, padding: "2px 9px", borderRadius: 20, background: bg, color, fontWeight: 700 }}>{label}</span>;
}

function StatCard({ label, value, accent, sub }) {
  return (
    <div style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(100,180,255,0.08)", borderRadius: 14, padding: "14px 16px", borderTop: `2px solid ${accent}` }}>
      <div style={{ fontSize: 9, color: "#3a5a70", letterSpacing: 1.2, textTransform: "uppercase", marginBottom: 6 }}>{label}</div>
      <div style={{ fontSize: 17, fontWeight: 800, color: "#e8f4fd", fontFamily: "monospace" }}>{value}</div>
      {sub && <div style={{ fontSize: 10, color: "#3a5a70", marginTop: 3 }}>{sub}</div>}
    </div>
  );
}

function SearchBar({ value, onChange, placeholder }) {
  return (
    <div style={{ position: "relative", marginBottom: 14 }}>
      <span style={{ position: "absolute", left: 12, top: "50%", transform: "translateY(-50%)", color: "#3a5a70", fontSize: 14 }}>🔍</span>
      <input style={{ width: "100%", padding: "10px 13px 10px 34px", background: "rgba(100,180,255,0.05)", border: "1px solid rgba(100,180,255,0.15)", borderRadius: 10, color: "#e8f4fd", fontSize: 14, outline: "none", boxSizing: "border-box" }}
        value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder || "Search…"} />
    </div>
  );
}

function Toast({ msg, type }) {
  if (!msg) return null;
  const bg = type === "error" ? "rgba(248,113,113,0.15)" : "rgba(34,197,94,0.15)";
  const border = type === "error" ? "rgba(248,113,113,0.3)" : "rgba(34,197,94,0.3)";
  const color = type === "error" ? RED : "#4ade80";
  return <div style={{ position: "fixed", top: 70, left: "50%", transform: "translateX(-50%)", background: bg, border: `1px solid ${border}`, color, padding: "10px 20px", borderRadius: 12, zIndex: 9999, fontWeight: 700, fontSize: 13, backdropFilter: "blur(8px)", whiteSpace: "nowrap" }}>{msg}</div>;
}

const IS = { width: "100%", padding: "10px 13px", background: "rgba(100,180,255,0.05)", border: "1px solid rgba(100,180,255,0.15)", borderRadius: 10, color: "#e8f4fd", fontSize: 14, outline: "none", boxSizing: "border-box", fontFamily: "inherit" };

// ─── LOGIN ────────────────────────────────────────────────────────────────────
function Login({ onLogin }) {
  const [uname, setUname] = useState(""), [pwd, setPwd] = useState(""), [err, setErr] = useState(""), [busy, setBusy] = useState(false), [show, setShow] = useState(false);
  const doLogin = async () => {
    setBusy(true); setErr("");
    try {
      const stored = await fbGet("users");
      const list = stored || DEFAULT_USERS;
      if (!stored) await fbSet("users", DEFAULT_USERS);
      const found = list.find(u => u.username === uname.trim() && u.password === pwd.trim() && u.active);
      if (found) onLogin(found); else setErr("Invalid username or password.");
    } catch (e) { setErr("Connection error. Check internet."); }
    setBusy(false);
  };
  return (
    <div style={{ minHeight: "100vh", background: "#060f1a", display: "flex", alignItems: "center", justifyContent: "center", padding: 20, backgroundImage: "radial-gradient(ellipse at 30% 20%,rgba(10,92,54,0.15) 0%,transparent 60%)" }}>
      <div style={{ width: "100%", maxWidth: 380 }}>
        <div style={{ textAlign: "center", marginBottom: 36 }}>
          <div style={{ width: 68, height: 68, borderRadius: 20, background: `linear-gradient(135deg,${G},${GM})`, border: "2px solid rgba(200,146,10,0.4)", display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 14px" }}>
            <svg width="36" height="36" viewBox="0 0 80 80" fill="none"><path d="M48 22A19 19 0 1 0 48 58" stroke="white" strokeWidth="5.5" strokeLinecap="round" fill="none" /><path d="M42 30L53 20L64 30" stroke="#c8920a" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" fill="none" /><line x1="53" y1="20" x2="53" y2="44" stroke="#c8920a" strokeWidth="4" strokeLinecap="round" /></svg>
          </div>
          <div style={{ fontFamily: "serif", fontSize: 30, fontWeight: 800, color: "#e8f4fd", letterSpacing: 3 }}>CREDA</div>
          <div style={{ fontSize: 10, color: "rgba(200,146,10,0.7)", letterSpacing: 3, textTransform: "uppercase" }}>Finance</div>
          <div style={{ fontSize: 11, color: "#3a5a70", marginTop: 4 }}>RC-9566021 · Ogbomoso, Oyo State</div>
        </div>
        <div style={{ background: "#0d1b2a", border: "1px solid rgba(100,180,255,0.08)", borderRadius: 20, padding: "28px 24px", boxShadow: "0 20px 60px rgba(0,0,0,0.4)" }}>
          <div style={{ fontSize: 18, fontWeight: 700, color: "#e8f4fd", marginBottom: 4 }}>Welcome Back</div>
          <div style={{ fontSize: 12, color: "#3a5a70", marginBottom: 22 }}>Sign in with your account</div>
          <Fld label="Username"><input style={IS} value={uname} onChange={e => setUname(e.target.value)} onKeyDown={e => e.key === "Enter" && doLogin()} placeholder="Enter username" autoFocus /></Fld>
          <Fld label="Password">
            <div style={{ position: "relative" }}>
              <input type={show ? "text" : "password"} style={{ ...IS, paddingRight: 40 }} value={pwd} onChange={e => setPwd(e.target.value)} onKeyDown={e => e.key === "Enter" && doLogin()} placeholder="Enter password" />
              <button onClick={() => setShow(s => !s)} style={{ position: "absolute", right: 10, top: "50%", transform: "translateY(-50%)", background: "none", border: "none", color: "#3a5a70", cursor: "pointer", fontSize: 14 }}>{show ? "🙈" : "👁️"}</button>
            </div>
          </Fld>
          {err && <div style={{ background: "rgba(248,113,113,0.1)", border: "1px solid rgba(248,113,113,0.2)", borderRadius: 8, padding: "8px 12px", fontSize: 12, color: RED, marginBottom: 14 }}>{err}</div>}
          <GBtn onClick={doLogin} full style={{ padding: "13px", fontSize: 14, opacity: busy ? 0.7 : 1 }}>{busy ? "Signing in…" : "Sign In →"}</GBtn>
        </div>
        <div style={{ textAlign: "center", fontSize: 11, color: "#3a5a70", marginTop: 14 }}>☁️ Powered by Firebase</div>
      </div>
    </div>
  );
}

// ─── MAIN APP ─────────────────────────────────────────────────────────────────
export default function App() {
  const [user, setUser] = useState(null);
  const [clients, setClients] = useState([]);
  const [monthly, setMonthly] = useState({});
  const [savings, setSavings] = useState({});
  const [users, setUsers] = useState(DEFAULT_USERS);
  const [pending, setPending] = useState([]);
  const [auditLog, setAuditLog] = useState([]);
  const [loading, setLoading] = useState(true);
  const [sync, setSync] = useState("offline");
  const [view, setView] = useState("dash");
  const [selId, setSelId] = useState(null);
  const [ptab, setPtab] = useState("schedule");
  const [atab, setAtab] = useState("overview");
  const [search, setSearch] = useState("");
  const [toast, setToast] = useState({ msg: "", type: "success" });
  const [dateFilter, setDateFilter] = useState({ from: "", to: "" });
  const [acctTab, setAcctTab] = useState("daily");
  // Admin dashboard mode: "admin" or "accountant"
  const [adminMode, setAdminMode] = useState("admin");

  // modals
  const [mAddClient, setMAddClient] = useState(false);
  const [mAddLoan, setMAddLoan] = useState(false);
  const [mPay, setMPay] = useState(null);
  const [mSav, setMSav] = useState(null);
  const [mSettings, setMSettings] = useState(false);
  const [mAddUser, setMAddUser] = useState(false);
  const [mResetPwd, setMResetPwd] = useState(null);
  const [mDel, setMDel] = useState(null);
  const [mProfile, setMProfile] = useState(false);
  const [mNotes, setMNotes] = useState(null);
  const [mEditClient, setMEditClient] = useState(null);
  const [mLateFee, setMLateFee] = useState(null);
  const [mExtend, setMExtend] = useState(null);

  const [payAmt, setPayAmt] = useState("");
  const [savAmt, setSavAmt] = useState("");
  const [savNote, setSavNote] = useState("");
  const [savType, setSavType] = useState("deposit");
  const [noteText, setNoteText] = useState("");
  const [lateFeeAmt, setLateFeeAmt] = useState("");
  const [extendDays, setExtendDays] = useState("");

  const [nc, setNc] = useState({ name: "", phone: "", address: "", idNumber: "", union: "", email: "", guarantor: "" });
  const [nl, setNl] = useState({ principal: "", rate: "15", days: "20", start: todayStr });
  const [nu, setNu] = useState({ name: "", username: "", password: "", role: "officer" });
  const [profileEdit, setProfileEdit] = useState({ name: "", username: "", oldPassword: "", newPassword: "", confirmPassword: "" });

  const today = new Date();
  const curMonth = mk(today);
  const isAdmin = user?.role === "admin";
  const isAccountant = user?.role === "accountant";
  const isOfficer = user?.role === "officer";
  // Admin viewing accountant dashboard
  const viewingAsAccountant = isAdmin && adminMode === "accountant";

  const showToast = useCallback((msg, type = "success") => {
    setToast({ msg, type });
    setTimeout(() => setToast({ msg: "", type: "success" }), 3000);
  }, []);

  // ── FIREBASE LISTENERS + FORCE RESET ──────────────────────────────────────
  useEffect(() => {
    setSync("syncing");
    fbSet("users", DEFAULT_USERS);
    const unsubs = [
      fbListen("clients", v => setClients(v || [])),
      fbListen("monthly", v => setMonthly(v || {})),
      fbListen("savings", v => setSavings(v || {})),
      fbListen("users", v => setUsers(v || DEFAULT_USERS)),
      fbListen("pending", v => setPending(v || [])),
      fbListen("auditLog", v => setAuditLog(v || [])),
    ];
    setTimeout(() => { setLoading(false); setSync("synced"); }, 1800);
    return () => unsubs.forEach(u => u());
  }, []);

  // ── SAVE WRAPPERS ─────────────────────────────────────────────────────────
  const sc = async v => { setClients(v); setSync("syncing"); await fbSet("clients", v); setSync("synced"); };
  const sm = async v => { setMonthly(v); setSync("syncing"); await fbSet("monthly", v); setSync("synced"); };
  const ss = async v => { setSavings(v); setSync("syncing"); await fbSet("savings", v); setSync("synced"); };
  const su = async v => { setUsers(v); setSync("syncing"); await fbSet("users", v); setSync("synced"); };
  const sp = async v => { setPending(v); setSync("syncing"); await fbSet("pending", v); setSync("synced"); };

  const addAudit = async (action, detail) => {
    const entry = { id: uid("AUD"), action, detail, by: user?.name, role: user?.role, at: new Date().toISOString(), date: todayStr };
    const updated = [entry, ...auditLog].slice(0, 500);
    setAuditLog(updated);
    await fbSet("auditLog", updated);
  };

  // ── COMPUTED ──────────────────────────────────────────────────────────────
  const myClients = useMemo(() => (isAdmin || isAccountant) ? clients : clients.filter(c => c.assignedTo === user?.id), [clients, user, isAdmin, isAccountant]);
  const selClient = clients.find(c => c.id === selId);
  const curMonthData = monthly[curMonth] || { loans: [], totalDisbursed: 0, totalInterest: 0, clientIds: [] };
  const myPending = isAdmin ? pending : pending.filter(p => p.requestedBy === user?.id);

  const stats = useMemo(() => {
    let disbursed = 0, expected = 0, collected = 0, overdue = 0, active = 0, overdueAmt = 0;
    myClients.forEach(c => c.loans?.forEach(l => {
      disbursed += l.principal; expected += l.total || 0;
      if (l.status === "active") active++;
      l.schedule?.forEach(s => {
        if (s.paid) collected += s.paidAmount;
        else if (new Date(s.dueDate) < today) { overdue++; overdueAmt += s.payment || 0; }
      });
    }));
    const totalSav = Object.values(savings).reduce((a, s) => a + (s.balance || 0), 0);
    const collectionRate = expected > 0 ? ((collected / expected) * 100).toFixed(1) : 0;
    return { disbursed, expected, collected, overdue, active, totalSav, outstanding: expected - collected, overdueAmt, collectionRate };
  }, [myClients, savings]);

  // ── DAILY COLLECTION DATA ─────────────────────────────────────────────────
  const dailyData = useMemo(() => {
    const map = {};
    clients.forEach(c => {
      c.loans?.forEach(l => {
        l.schedule?.forEach(s => {
          const d = s.dueDate;
          if (!map[d]) map[d] = { expected: 0, collected: 0, payments: [], clients: new Set() };
          map[d].expected += s.payment || l.daily || 0;
          map[d].clients.add(c.name);
          if (s.paid) {
            map[d].collected += s.paidAmount || 0;
            map[d].payments.push({ client: c.name, officer: c.assignedName, amount: s.paidAmount, date: s.paidDate });
          }
        });
      });
    });
    return Object.entries(map).sort((a, b) => b[0].localeCompare(a[0])).map(([date, data]) => ({
      date, expected: data.expected, collected: data.collected,
      shortfall: Math.max(0, data.expected - data.collected),
      payments: data.payments, clientCount: data.clients.size,
      rate: data.expected > 0 ? ((data.collected / data.expected) * 100).toFixed(1) : 0
    }));
  }, [clients]);

  const filteredDailyData = useMemo(() => {
    return dailyData.filter(d => {
      if (dateFilter.from && d.date < dateFilter.from) return false;
      if (dateFilter.to && d.date > dateFilter.to) return false;
      return true;
    });
  }, [dailyData, dateFilter]);

  // ── MONTHLY RECORD ────────────────────────────────────────────────────────
  function recMonth(loan, cId, cName) {
    const k = mk(new Date(loan.startDate));
    const m = { ...monthly };
    if (!m[k]) m[k] = { loans: [], totalDisbursed: 0, totalInterest: 0, clientIds: [] };
    m[k].loans.push({ loanId: loan.id, clientId: cId, clientName: cName, principal: loan.principal, interestRate: loan.interestRate, totalRepayable: loan.total, interest: loan.interest, days: loan.days, startDate: loan.startDate });
    m[k].totalDisbursed += loan.principal;
    m[k].totalInterest += loan.interest;
    m[k].clientIds = [...new Set([...(m[k].clientIds || []), cId])];
    sm(m);
  }

  // ── ACTIONS ───────────────────────────────────────────────────────────────
  function doAddClient() {
    if (!nc.name.trim() || !nc.phone.trim()) { showToast("Name and phone required", "error"); return; }
    sc([{ ...nc, id: uid("CL"), loans: [], notes: [], createdAt: todayStr, assignedTo: user?.id, assignedName: user?.name, creditScore: 100 }, ...clients]);
    addAudit("ADD_CLIENT", `Added: ${nc.name}`);
    setNc({ name: "", phone: "", address: "", idNumber: "", union: "", email: "", guarantor: "" });
    setMAddClient(false);
    showToast("Client registered!");
  }

  function doEditClient() {
    if (!mEditClient?.name?.trim()) return;
    sc(clients.map(c => c.id === selId ? { ...c, ...mEditClient } : c));
    addAudit("EDIT_CLIENT", `Edited: ${mEditClient.name}`);
    setMEditClient(null);
    showToast("Client updated!");
  }

  function doLoan() {
    if (!nl.principal || !selId) return;
    const p = parseFloat(nl.principal), r = parseFloat(nl.rate), d = parseInt(nl.days);
    if (p <= 0 || d <= 0) { showToast("Invalid loan details", "error"); return; }
    const calc = calcLoan(p, r, d, nl.start);
    if (isAdmin) {
      const loan = { id: uid("LN"), principal: p, interestRate: r, days: d, startDate: nl.start, ...calc, status: "active", issuedAt: new Date().toISOString(), issuedBy: user?.name };
      sc(clients.map(c => c.id === selId ? { ...c, loans: [...(c.loans || []), loan] } : c));
      recMonth(loan, selId, selClient?.name);
      addAudit("ISSUE_LOAN", `${fc(p)} to ${selClient?.name}`);
      showToast("Loan issued!");
    } else {
      sp([...pending, { id: uid("REQ"), clientId: selId, clientName: selClient?.name, requestedBy: user?.id, requestedByName: user?.name, principal: p, interestRate: r, days: d, startDate: nl.start, ...calc, requestedAt: new Date().toISOString() }]);
      addAudit("REQUEST_LOAN", `${fc(p)} for ${selClient?.name}`);
      showToast("Request submitted!");
    }
    setNl({ principal: "", rate: "15", days: "20", start: todayStr });
    setMAddLoan(false);
  }

  function doApprove(req) {
    const calc = calcLoan(req.principal, req.interestRate, req.days, req.startDate);
    const loan = { id: uid("LN"), principal: req.principal, interestRate: req.interestRate, days: req.days, startDate: req.startDate, ...calc, status: "active", issuedAt: new Date().toISOString(), requestedBy: req.requestedBy, issuedBy: user?.name };
    sc(clients.map(c => c.id === req.clientId ? { ...c, loans: [...(c.loans || []), loan] } : c));
    recMonth(loan, req.clientId, req.clientName);
    sp(pending.filter(p => p.id !== req.id));
    addAudit("APPROVE_LOAN", `${fc(req.principal)} for ${req.clientName}`);
    showToast("Loan approved!");
  }

  function doReject(id) {
    const req = pending.find(p => p.id === id);
    sp(pending.filter(p => p.id !== id));
    addAudit("REJECT_LOAN", `Rejected: ${req?.clientName}`);
    showToast("Rejected", "error");
  }

  function doPay() {
    const amt = parseFloat(payAmt);
    if (!amt || !mPay) return;
    const { cId, lId, idx } = mPay;
    sc(clients.map(c => {
      if (c.id !== cId) return c;
      const newLoans = c.loans.map(l => {
        if (l.id !== lId) return l;
        const sch = l.schedule.map((s, i) => i === idx ? { ...s, paid: true, paidDate: todayStr, paidAmount: amt, by: user?.name } : s);
        let run = l.total || 0;
        const rec = sch.map(s => { if (s.paid) run = Math.max(0, run - s.paidAmount); return { ...s, balance: run }; });
        return { ...l, schedule: rec, status: rec.every(s => s.paid) ? "completed" : "active" };
      });
      return { ...c, loans: newLoans, creditScore: Math.min(100, (c.creditScore || 100) + 1) };
    }));
    addAudit("PAYMENT", `${fc(amt)} from ${clients.find(c => c.id === cId)?.name}`);
    showToast("Payment recorded!");
    setPayAmt(""); setMPay(null);
  }

  function doSavings() {
    const amt = parseFloat(savAmt);
    if (!amt || !mSav) return;
    const { cId } = mSav;
    const s = { ...savings };
    if (!s[cId]) s[cId] = { balance: 0, transactions: [] };
    if (savType === "withdrawal" && s[cId].balance < amt) { showToast("Insufficient balance", "error"); return; }
    const delta = savType === "deposit" ? amt : -amt;
    const newBal = Math.max(0, s[cId].balance + delta);
    s[cId].transactions.push({ id: uid("SV"), type: savType, amount: amt, note: savNote, date: todayStr, after: newBal, by: user?.name });
    s[cId].balance = newBal;
    ss(s);
    addAudit("SAVINGS", `${savType} ${fc(amt)}`);
    showToast(`${savType === "deposit" ? "Deposit" : "Withdrawal"} done!`);
    setSavAmt(""); setSavNote(""); setSavType("deposit"); setMSav(null);
  }

  function doAddUser() {
    if (!nu.name || !nu.username || !nu.password) { showToast("All fields required", "error"); return; }
    if (users.find(u => u.username === nu.username)) { showToast("Username exists!", "error"); return; }
    su([...users, { ...nu, id: uid("USR"), createdAt: todayStr, active: true }]);
    addAudit("ADD_USER", `${nu.name} (${nu.role})`);
    setNu({ name: "", username: "", password: "", role: "officer" });
    setMAddUser(false);
    showToast("Staff created!");
  }

  function doDeleteClient(id) {
    const cl = clients.find(c => c.id === id);
    sc(clients.filter(c => c.id !== id));
    addAudit("DELETE_CLIENT", `${cl?.name}`);
    setMDel(null); setView("clients");
    showToast("Client deleted");
  }

  function doAddNote() {
    if (!noteText.trim() || !mNotes) return;
    sc(clients.map(c => c.id === mNotes ? { ...c, notes: [...(c.notes || []), { id: uid("N"), text: noteText, by: user?.name, date: todayStr }] } : c));
    setNoteText(""); showToast("Note added!");
  }

  function doAddLateFee() {
    const amt = parseFloat(lateFeeAmt);
    if (!amt || !mLateFee) return;
    const { cId, lId } = mLateFee;
    sc(clients.map(c => {
      if (c.id !== cId) return c;
      return {
        ...c,
        loans: c.loans.map(l => l.id !== lId ? l : { ...l, lateFees: [...(l.lateFees || []), { amount: amt, date: todayStr, by: user?.name }], total: (l.total || 0) + amt }),
        creditScore: Math.max(0, (c.creditScore || 100) - 5)
      };
    }));
    addAudit("LATE_FEE", `${fc(amt)} applied`);
    setLateFeeAmt(""); setMLateFee(null);
    showToast("Late fee applied!");
  }

  function doExtendLoan() {
    const extra = parseInt(extendDays);
    if (!extra || !mExtend) return;
    const { cId, lId } = mExtend;
    sc(clients.map(c => {
      if (c.id !== cId) return c;
      return {
        ...c, loans: c.loans.map(l => {
          if (l.id !== lId) return l;
          const lastDate = l.schedule[l.schedule.length - 1]?.dueDate || todayStr;
          const extraSch = getWorkdays(lastDate, extra).map((date, i) => ({ day: l.days + i + 1, dueDate: date, payment: l.daily, balance: 0, paid: false, paidDate: null, paidAmount: 0 }));
          return { ...l, days: l.days + extra, schedule: [...l.schedule, ...extraSch], extensions: [...(l.extensions || []), { days: extra, date: todayStr, by: user?.name }] };
        })
      };
    }));
    addAudit("EXTEND_LOAN", `+${extra} days`);
    setExtendDays(""); setMExtend(null);
    showToast(`Extended by ${extra} days!`);
  }

  function doUpdateProfile() {
    if (!profileEdit.oldPassword) { showToast("Enter current password", "error"); return; }
    if (profileEdit.oldPassword !== user.password) { showToast("Wrong current password", "error"); return; }
    if (profileEdit.newPassword && profileEdit.newPassword !== profileEdit.confirmPassword) { showToast("Passwords don't match", "error"); return; }
    if (profileEdit.newPassword && profileEdit.newPassword.length < 4) { showToast("Min 4 chars", "error"); return; }
    if (profileEdit.username && profileEdit.username !== user.username && users.find(u => u.username === profileEdit.username && u.id !== user.id)) { showToast("Username taken", "error"); return; }
    const updated = { ...user, name: profileEdit.name || user.name, username: profileEdit.username || user.username, password: profileEdit.newPassword || user.password };
    su(users.map(u => u.id === user.id ? updated : u));
    setUser(updated);
    addAudit("PROFILE_UPDATE", "Updated profile");
    setMProfile(false);
    showToast("Profile updated!");
  }

  function exportBackup() {
    const blob = new Blob([JSON.stringify({ clients, monthly, savings, users, pending, auditLog, v: "5.0", at: new Date().toISOString() }, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob), a = document.createElement("a");
    a.href = url; a.download = `creda_backup_${todayStr}.json`; a.click(); URL.revokeObjectURL(url);
    showToast("Backup downloaded!");
  }

  function exportCSV(data, filename) {
    if (!data.length) return;
    const keys = Object.keys(data[0]);
    const csv = [keys.join(","), ...data.map(row => keys.map(k => `"${row[k] ?? ""}"`).join(","))].join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob), a = document.createElement("a");
    a.href = url; a.download = filename; a.click(); URL.revokeObjectURL(url);
    showToast("CSV exported!");
  }

  // ── LOADING ───────────────────────────────────────────────────────────────
  if (loading) return (
    <div style={{ minHeight: "100vh", background: "#060f1a", display: "flex", alignItems: "center", justifyContent: "center", flexDirection: "column", gap: 14 }}>
      <div style={{ width: 60, height: 60, borderRadius: 16, background: `linear-gradient(135deg,${G},${GM})`, border: "2px solid rgba(200,146,10,0.4)", display: "flex", alignItems: "center", justifyContent: "center" }}>
        <svg width="32" height="32" viewBox="0 0 80 80" fill="none"><path d="M48 22A19 19 0 1 0 48 58" stroke="white" strokeWidth="5.5" strokeLinecap="round" fill="none" /><path d="M42 30L53 20L64 30" stroke="#c8920a" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" fill="none" /><line x1="53" y1="20" x2="53" y2="44" stroke="#c8920a" strokeWidth="4" strokeLinecap="round" /></svg>
      </div>
      <div style={{ color: "#e8f4fd", fontSize: 16, fontWeight: 700, fontFamily: "serif", letterSpacing: 2 }}>CREDA Finance</div>
      <div style={{ color: "#3a5a70", fontSize: 12 }}>Connecting…</div>
    </div>
  );

  if (!user) return <Login onLogin={u => { setUser(u); setProfileEdit({ name: u.name, username: u.username, oldPassword: "", newPassword: "", confirmPassword: "" }); }} />;

  // ── ACCOUNTANT VIEW ───────────────────────────────────────────────────────
  const AccountantPanel = () => {
    const todayData = dailyData.find(d => d.date === todayStr);
    const weekTotal = { expected: 0, collected: 0 };
    const last7 = dailyData.filter(d => (new Date() - new Date(d.date)) / 86400000 <= 7);
    last7.forEach(d => { weekTotal.expected += d.expected; weekTotal.collected += d.collected; });

    return (
      <div>
        <div style={{ marginBottom: 14 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <div>
              <h1 style={{ margin: 0, fontSize: 22, fontWeight: 800, color: "#e8f4fd" }}>📊 Finance View</h1>
              <p style={{ margin: "2px 0 0", color: "#3a5a70", fontSize: 12 }}>Daily & Weekly Collection Overview</p>
            </div>
            {isAdmin && <button onClick={() => setAdminMode("admin")} style={{ background: `linear-gradient(135deg,${GOLD},#a07010)`, border: "none", color: "#000", padding: "8px 14px", borderRadius: 10, cursor: "pointer", fontWeight: 700, fontSize: 11 }}>🔐 Admin View</button>}
          </div>
        </div>

        {/* Today Hero */}
        <div style={{ background: "linear-gradient(135deg,rgba(10,92,54,0.15),rgba(59,130,246,0.08))", border: "1px solid rgba(10,92,54,0.3)", borderRadius: 16, padding: "16px", marginBottom: 14 }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: G, marginBottom: 12, letterSpacing: 1 }}>📅 TODAY — {fd(todayStr)}</div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 10 }}>
            {[["Expected", fc(todayData?.expected || 0), BLUE], ["Collected", fc(todayData?.collected || 0), "#4ade80"],
            ["Shortfall", fc(todayData?.shortfall || 0), RED], ["Rate", `${todayData?.rate || 0}%`, GOLD]].map(([l, v, c]) => (
              <div key={l} style={{ background: "rgba(255,255,255,0.05)", borderRadius: 10, padding: "10px 12px" }}>
                <div style={{ fontSize: 9, color: "#3a5a70", letterSpacing: 1, textTransform: "uppercase" }}>{l}</div>
                <div style={{ fontSize: 16, fontWeight: 800, color: c, fontFamily: "monospace" }}>{v}</div>
              </div>
            ))}
          </div>
          {todayData?.payments?.length > 0 && <div style={{ fontSize: 11, color: "#8ab4c8" }}>{todayData.payments.length} payment(s) by {[...new Set(todayData.payments.map(p => p.officer))].filter(Boolean).join(", ") || "admin"}</div>}
        </div>

        {/* Overall Stats */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 14 }}>
          <StatCard label="Total Disbursed" value={fc(stats.disbursed)} accent={BLUE} />
          <StatCard label="Total Collected" value={fc(stats.collected)} accent={G} sub={`${stats.collectionRate}% rate`} />
          <StatCard label="Outstanding" value={fc(stats.outstanding)} accent={GOLD} />
          <StatCard label="Overdue Amount" value={fc(stats.overdueAmt)} accent={RED} sub={`${stats.overdue} installments`} />
        </div>

        {/* Tabs */}
        <div style={{ display: "flex", gap: 3, marginBottom: 14, background: "rgba(255,255,255,0.03)", borderRadius: 12, padding: 3 }}>
          {[["daily", "📋 Daily"], ["weekly", "📊 Weekly"], ["officers", "👥 Officers"], ["report", "📈 Report"]].map(([t, l]) => (
            <button key={t} onClick={() => setAcctTab(t)} style={{ flex: 1, padding: "8px 4px", borderRadius: 9, border: "none", cursor: "pointer", background: acctTab === t ? "rgba(100,180,255,0.12)" : "transparent", color: acctTab === t ? "#93c5fd" : "#3a5a70", fontWeight: 600, fontSize: 11, whiteSpace: "nowrap" }}>{l}</button>
          ))}
        </div>

        {/* Date Filter */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr auto", gap: 8, marginBottom: 14, alignItems: "end" }}>
          <Fld label="From"><input type="date" style={IS} value={dateFilter.from} onChange={e => setDateFilter(p => ({ ...p, from: e.target.value }))} /></Fld>
          <Fld label="To"><input type="date" style={IS} value={dateFilter.to} onChange={e => setDateFilter(p => ({ ...p, to: e.target.value }))} /></Fld>
          <button onClick={() => setDateFilter({ from: "", to: "" })} style={{ background: "rgba(255,255,255,0.06)", border: "none", color: "#8ab4c8", padding: "10px 12px", borderRadius: 10, cursor: "pointer", marginBottom: 14 }}>Clear</button>
        </div>

        {/* DAILY */}
        {acctTab === "daily" && (
          <div>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: "#c8dde8" }}>Daily Log</div>
              <button onClick={() => exportCSV(filteredDailyData.map(d => ({ Date: d.date, Expected: d.expected, Collected: d.collected, Shortfall: d.shortfall, Rate: d.rate + "%" })), `daily_${todayStr}.csv`)}
                style={{ fontSize: 11, background: "rgba(96,165,250,0.1)", border: "1px solid rgba(96,165,250,0.2)", color: BLUE, padding: "6px 12px", borderRadius: 8, cursor: "pointer", fontWeight: 600 }}>📥 CSV</button>
            </div>
            {filteredDailyData.length === 0 ? <div style={{ textAlign: "center", padding: 40, color: "#3a5a70", border: "1px dashed rgba(100,180,255,0.08)", borderRadius: 14 }}>No data</div>
              : filteredDailyData.map(d => (
                <div key={d.date} style={{ background: d.date === todayStr ? "rgba(10,92,54,0.1)" : "rgba(255,255,255,0.025)", border: `1px solid ${d.date === todayStr ? "rgba(10,92,54,0.3)" : "rgba(100,180,255,0.08)"}`, borderRadius: 13, padding: "14px", marginBottom: 10 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
                    <div>
                      <div style={{ fontWeight: 700, color: "#e8f4fd", fontSize: 14 }}>{fd(d.date)}{d.date === todayStr ? " 🟢" : ""}</div>
                      <div style={{ fontSize: 10, color: "#3a5a70" }}>{d.clientCount} clients · {isHoliday(d.date) ? `🎉 ${isHoliday(d.date)}` : isWorkday(d.date) ? "Workday" : "Weekend"}</div>
                    </div>
                    <div style={{ textAlign: "right" }}>
                      <div style={{ fontSize: 12, fontWeight: 700, color: parseFloat(d.rate) >= 80 ? "#4ade80" : parseFloat(d.rate) >= 50 ? GOLD : RED }}>{d.rate}%</div>
                    </div>
                  </div>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8 }}>
                    {[["Expected", fc(d.expected), BLUE], ["Collected", fc(d.collected), "#4ade80"], ["Shortfall", fc(d.shortfall), d.shortfall > 0 ? RED : "#3a5a70"]].map(([l, v, c]) => (
                      <div key={l} style={{ background: "rgba(255,255,255,0.04)", borderRadius: 8, padding: "8px 10px" }}>
                        <div style={{ fontSize: 9, color: "#3a5a70", letterSpacing: 1 }}>{l}</div>
                        <div style={{ fontSize: 13, fontWeight: 700, color: c, fontFamily: "monospace" }}>{v}</div>
                      </div>
                    ))}
                  </div>
                  {d.payments.length > 0 && <div style={{ marginTop: 10 }}>{d.payments.map((p, i) => (
                    <div key={i} style={{ display: "flex", justifyContent: "space-between", fontSize: 11, padding: "4px 0", borderTop: "1px solid rgba(100,180,255,0.06)" }}>
                      <span style={{ color: "#8ab4c8" }}>{p.client} <span style={{ color: "#3a5a70" }}>via {p.officer || "admin"}</span></span>
                      <span style={{ color: "#4ade80", fontFamily: "monospace" }}>{fc(p.amount)}</span>
                    </div>
                  ))}</div>}
                </div>
              ))}
          </div>
        )}

        {/* WEEKLY */}
        {acctTab === "weekly" && (
          <div>
            <div style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(100,180,255,0.08)", borderRadius: 14, padding: "14px", marginBottom: 14 }}>
              <div style={{ fontSize: 12, fontWeight: 700, color: "#c8dde8", marginBottom: 10 }}>Last 7 Days</div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10 }}>
                {[["Expected", fc(weekTotal.expected), BLUE], ["Collected", fc(weekTotal.collected), "#4ade80"],
                ["Rate", weekTotal.expected > 0 ? ((weekTotal.collected / weekTotal.expected) * 100).toFixed(1) + "%" : "0%", GOLD]].map(([l, v, c]) => (
                  <div key={l} style={{ background: "rgba(255,255,255,0.04)", borderRadius: 9, padding: "10px 12px" }}>
                    <div style={{ fontSize: 9, color: "#3a5a70" }}>{l}</div>
                    <div style={{ fontSize: 14, fontWeight: 800, color: c, fontFamily: "monospace" }}>{v}</div>
                  </div>
                ))}
              </div>
            </div>
            {last7.map(d => (
              <div key={d.date} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", background: "rgba(255,255,255,0.025)", border: "1px solid rgba(100,180,255,0.08)", borderRadius: 11, padding: "12px 14px", marginBottom: 8 }}>
                <div><div style={{ fontWeight: 600, color: "#e8f4fd", fontSize: 13 }}>{fd(d.date)}</div><div style={{ fontSize: 10, color: "#3a5a70" }}>{d.clientCount} clients</div></div>
                <div style={{ display: "flex", gap: 16, alignItems: "center" }}>
                  <div style={{ textAlign: "right" }}><div style={{ fontSize: 11, color: BLUE, fontFamily: "monospace" }}>{fc(d.expected)}</div><div style={{ fontSize: 9, color: "#3a5a70" }}>expected</div></div>
                  <div style={{ textAlign: "right" }}><div style={{ fontSize: 11, color: "#4ade80", fontFamily: "monospace" }}>{fc(d.collected)}</div><div style={{ fontSize: 9, color: "#3a5a70" }}>collected</div></div>
                  <div style={{ width: 34, height: 34, borderRadius: "50%", background: `conic-gradient(#22c55e ${d.rate * 3.6}deg, rgba(255,255,255,0.05) 0deg)`, display: "flex", alignItems: "center", justifyContent: "center" }}>
                    <div style={{ width: 24, height: 24, borderRadius: "50%", background: "#0d1b2a", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 8, fontWeight: 700, color: "#4ade80" }}>{d.rate}%</div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* OFFICERS */}
        {acctTab === "officers" && (
          <div>
            <div style={{ fontSize: 13, fontWeight: 700, color: "#c8dde8", marginBottom: 14 }}>Officer Performance</div>
            {users.filter(u => u.role === "officer" && u.active).length === 0
              ? <div style={{ textAlign: "center", padding: 40, color: "#3a5a70", border: "1px dashed rgba(100,180,255,0.08)", borderRadius: 14 }}>No officers yet</div>
              : users.filter(u => u.role === "officer" && u.active).map(off => {
                const oc = clients.filter(c => c.assignedTo === off.id);
                const col = oc.reduce((a, c) => a + (c.loans?.flatMap(l => l.schedule || []).filter(s => s.paid).reduce((x, s) => x + s.paidAmount, 0) || 0), 0);
                const exp = oc.reduce((a, c) => a + (c.loans?.reduce((x, l) => x + (l.total || 0), 0) || 0), 0);
                const rate = exp > 0 ? ((col / exp) * 100).toFixed(1) : 0;
                const todayCol = oc.reduce((a, c) => a + (c.loans?.flatMap(l => l.schedule || []).filter(s => s.paid && s.paidDate === todayStr).reduce((x, s) => x + s.paidAmount, 0) || 0), 0);
                return (
                  <div key={off.id} style={{ background: "rgba(255,255,255,0.025)", border: "1px solid rgba(100,180,255,0.08)", borderRadius: 14, padding: "14px", marginBottom: 12 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12 }}>
                      <div style={{ width: 42, height: 42, borderRadius: 12, background: `linear-gradient(135deg,${G},${GM})`, display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 800, fontSize: 17, color: "#fff" }}>{off.name.charAt(0)}</div>
                      <div><div style={{ fontWeight: 700, color: "#e8f4fd" }}>{off.name}</div><div style={{ fontSize: 11, color: "#3a5a70" }}>@{off.username} · {oc.length} clients</div></div>
                    </div>
                    <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 8 }}>
                      {[["Today", fc(todayCol), "#4ade80"], ["Collected", fc(col), BLUE], ["Expected", fc(exp), GOLD], ["Rate", `${rate}%`, parseFloat(rate) >= 80 ? "#4ade80" : parseFloat(rate) >= 50 ? GOLD : RED]].map(([l, v, c]) => (
                        <div key={l} style={{ background: "rgba(255,255,255,0.04)", borderRadius: 8, padding: "8px 10px" }}><div style={{ fontSize: 9, color: "#3a5a70" }}>{l}</div><div style={{ fontSize: 12, fontWeight: 800, color: c, fontFamily: "monospace" }}>{v}</div></div>
                      ))}
                    </div>
                  </div>
                );
              })}
          </div>
        )}

        {/* REPORT */}
        {acctTab === "report" && (
          <div>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: "#c8dde8" }}>Financial Report</div>
              <button onClick={() => exportCSV(filteredDailyData.map(d => ({ Date: d.date, Expected: d.expected, Collected: d.collected, Shortfall: d.shortfall, Clients: d.clientCount, Rate: d.rate + "%" })), `report_${todayStr}.csv`)}
                style={{ fontSize: 11, background: "rgba(96,165,250,0.1)", border: "1px solid rgba(96,165,250,0.2)", color: BLUE, padding: "6px 12px", borderRadius: 8, cursor: "pointer", fontWeight: 600 }}>📥 CSV</button>
            </div>
            <div style={{ background: "rgba(10,92,54,0.1)", border: "1px solid rgba(10,92,54,0.2)", borderRadius: 14, padding: "14px", marginBottom: 14 }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: G, marginBottom: 10 }}>ALL-TIME</div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                {[["Disbursed", fc(stats.disbursed), BLUE], ["Collected", fc(stats.collected), "#4ade80"], ["Outstanding", fc(stats.outstanding), GOLD], ["Overdue", fc(stats.overdueAmt), RED], ["Savings", fc(stats.totalSav), PURPLE], ["Rate", `${stats.collectionRate}%`, "#4ade80"]].map(([l, v, c]) => (
                  <div key={l} style={{ background: "rgba(255,255,255,0.04)", borderRadius: 9, padding: "10px 12px" }}><div style={{ fontSize: 9, color: "#3a5a70" }}>{l}</div><div style={{ fontSize: 14, fontWeight: 800, color: c, fontFamily: "monospace" }}>{v}</div></div>
                ))}
              </div>
            </div>
            {Object.keys(monthly).sort().reverse().map(k => {
              const d = monthly[k];
              const mCol = clients.reduce((a, c) => a + (c.loans?.flatMap(l => l.schedule || []).filter(s => s.paid && mk(new Date(s.paidDate)) === k).reduce((x, s) => x + s.paidAmount, 0) || 0), 0);
              return (
                <div key={k} style={{ background: "rgba(255,255,255,0.025)", border: "1px solid rgba(100,180,255,0.08)", borderRadius: 14, overflow: "hidden", marginBottom: 12 }}>
                  <div style={{ background: "rgba(10,92,54,0.3)", padding: "12px 16px", display: "flex", justifyContent: "space-between" }}>
                    <div style={{ fontSize: 14, fontWeight: 700, color: "#e8f4fd" }}>{mlabel(k)}</div>
                    <div style={{ textAlign: "right" }}><div style={{ fontSize: 13, fontWeight: 800, color: BLUE, fontFamily: "monospace" }}>{fc(d.totalDisbursed)}</div><div style={{ fontSize: 10, color: GOLD }}>+{fc(d.totalInterest)}</div></div>
                  </div>
                  <div style={{ padding: "10px 16px", display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8 }}>
                    {[["Disbursed", fc(d.totalDisbursed), BLUE], ["Collected", fc(mCol), "#4ade80"], ["Clients", d.clientIds?.length || 0, PURPLE]].map(([l, v, c]) => (
                      <div key={l}><div style={{ fontSize: 9, color: "#3a5a70" }}>{l}</div><div style={{ fontSize: 13, fontWeight: 700, color: c, fontFamily: "monospace" }}>{v}</div></div>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    );
  };

  // ── ADMIN PANEL ───────────────────────────────────────────────────────────
  const AdminPanel = () => (
    <div>
      <div style={{ marginBottom: 14 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div>
            <h1 style={{ margin: 0, fontSize: 22, fontWeight: 800, color: "#e8f4fd" }}>🔐 Admin Panel</h1>
            <p style={{ margin: "2px 0 0", color: "#3a5a70", fontSize: 12 }}>CREDA Finance · RC-9566021</p>
          </div>
          <button onClick={() => setAdminMode("accountant")} style={{ background: `linear-gradient(135deg,${PURPLE},#7c3aed)`, border: "none", color: "#fff", padding: "8px 14px", borderRadius: 10, cursor: "pointer", fontWeight: 700, fontSize: 11 }}>📊 Finance View</button>
        </div>
      </div>

      <div style={{ display: "flex", gap: 3, marginBottom: 14, background: "rgba(255,255,255,0.03)", borderRadius: 12, padding: 3, overflowX: "auto" }}>
        {[["overview", "📊"], ["staff", "👥"], ["pending", `⏳${pending.length > 0 ? `(${pending.length})` : ""}`], ["monthly", "📅"], ["audit", "📝"]].map(([t, l]) => (
          <button key={t} onClick={() => setAtab(t)} style={{ flex: 1, minWidth: 50, padding: "8px 4px", borderRadius: 9, border: "none", cursor: "pointer", background: atab === t ? "rgba(100,180,255,0.12)" : "transparent", color: atab === t ? "#93c5fd" : "#3a5a70", fontWeight: 600, fontSize: 11 }}>{l}</button>
        ))}
      </div>

      {atab === "overview" && <>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 12 }}>
          <StatCard label="Total Disbursed" value={fc(stats.disbursed)} accent={BLUE} />
          <StatCard label="Total Collected" value={fc(stats.collected)} accent={G} sub={`${stats.collectionRate}% rate`} />
          <StatCard label="Outstanding" value={fc(stats.outstanding)} accent={GOLD} />
          <StatCard label="Total Savings" value={fc(stats.totalSav)} accent={PURPLE} />
        </div>
        <div style={{ background: "rgba(10,92,54,0.1)", border: "1px solid rgba(10,92,54,0.25)", borderRadius: 14, padding: "14px", marginBottom: 12 }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: G, marginBottom: 10 }}>📅 {mlabel(curMonth)}</div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8 }}>
            {[["Disbursed", fc(curMonthData.totalDisbursed), BLUE], ["Interest", fc(curMonthData.totalInterest), GOLD], ["Clients", curMonthData.clientIds?.length || 0, PURPLE]].map(([l, v, c]) => (
              <div key={l} style={{ background: "rgba(255,255,255,0.04)", borderRadius: 8, padding: "8px 10px" }}><div style={{ fontSize: 9, color: "#3a5a70", letterSpacing: 1 }}>{l}</div><div style={{ fontSize: 14, fontWeight: 800, color: c, fontFamily: "monospace" }}>{v}</div></div>
            ))}
          </div>
        </div>
        <div style={{ fontSize: 13, fontWeight: 700, color: "#c8dde8", marginBottom: 10 }}>Staff Performance</div>
        {users.filter(u => u.role === "officer" && u.active).length === 0
          ? <div style={{ textAlign: "center", padding: 24, color: "#3a5a70", border: "1px dashed rgba(100,180,255,0.08)", borderRadius: 12 }}>No staff yet</div>
          : users.filter(u => u.role === "officer" && u.active).map(u => {
            const sc2 = clients.filter(c => c.assignedTo === u.id);
            const col = sc2.reduce((a, c) => a + (c.loans?.flatMap(l => l.schedule || []).filter(s => s.paid).reduce((x, s) => x + s.paidAmount, 0) || 0), 0);
            return (
              <div key={u.id} style={{ background: "rgba(255,255,255,0.025)", border: "1px solid rgba(100,180,255,0.08)", borderRadius: 12, padding: "12px 14px", marginBottom: 8, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
                  <div style={{ width: 36, height: 36, borderRadius: 10, background: `linear-gradient(135deg,${G},${GM})`, display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 800, fontSize: 15, color: "#fff" }}>{u.name.charAt(0)}</div>
                  <div><div style={{ fontWeight: 700, color: "#e8f4fd", fontSize: 13 }}>{u.name}</div><div style={{ fontSize: 10, color: "#3a5a70" }}>{sc2.length} clients</div></div>
                </div>
                <div style={{ textAlign: "right" }}><div style={{ fontSize: 13, color: BLUE, fontFamily: "monospace", fontWeight: 700 }}>{fc(col)}</div></div>
              </div>
            );
          })}
      </>}

      {atab === "staff" && <>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: "#c8dde8" }}>Staff ({users.length})</div>
          <GBtn onClick={() => setMAddUser(true)} style={{ padding: "8px 14px", fontSize: 12 }}>+ Add</GBtn>
        </div>
        {users.map(u => {
          const sc2 = clients.filter(c => c.assignedTo === u.id);
          return (
            <div key={u.id} style={{ background: "rgba(255,255,255,0.025)", border: "1px solid rgba(100,180,255,0.08)", borderRadius: 13, padding: "14px", marginBottom: 10 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
                <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
                  <div style={{ width: 42, height: 42, borderRadius: 12, background: u.role === "admin" ? `linear-gradient(135deg,${GOLD},#a07010)` : `linear-gradient(135deg,${G},${GM})`, display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 800, fontSize: 17, color: "#fff" }}>{u.name.charAt(0)}</div>
                  <div><div style={{ fontWeight: 700, color: "#e8f4fd" }}>{u.name}</div><div style={{ fontSize: 11, color: "#3a5a70" }}>@{u.username} · {fd(u.createdAt)}</div></div>
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: 4, alignItems: "flex-end" }}>
                  <Badge label={u.role} color={u.role === "admin" ? GOLD : "#4ade80"} bg={u.role === "admin" ? "rgba(200,146,10,0.12)" : "rgba(34,197,94,0.12)"} />
                  <Badge label={u.active ? "Active" : "Inactive"} color={u.active ? "#4ade80" : RED} bg={u.active ? "rgba(34,197,94,0.1)" : "rgba(248,113,113,0.1)"} />
                </div>
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: u.id !== "admin_001" ? 10 : 0 }}>
                <div style={{ background: "rgba(255,255,255,0.04)", borderRadius: 8, padding: "8px 10px" }}><div style={{ fontSize: 9, color: "#3a5a70" }}>CLIENTS</div><div style={{ fontSize: 16, fontWeight: 800, color: BLUE }}>{sc2.length}</div></div>
                <div style={{ background: "rgba(255,255,255,0.04)", borderRadius: 8, padding: "8px 10px" }}><div style={{ fontSize: 9, color: "#3a5a70" }}>ACTIVE</div><div style={{ fontSize: 16, fontWeight: 800, color: G }}>{sc2.reduce((a, c) => a + (c.loans?.filter(l => l.status === "active").length || 0), 0)}</div></div>
              </div>
              {u.id !== "admin_001" && (
                <div style={{ display: "flex", gap: 8 }}>
                  <button onClick={() => su(users.map(x => x.id === u.id ? { ...x, active: !x.active } : x))} style={{ flex: 1, background: u.active ? "rgba(248,113,113,0.1)" : "rgba(34,197,94,0.1)", border: `1px solid ${u.active ? "rgba(248,113,113,0.2)" : "rgba(34,197,94,0.2)"}`, color: u.active ? RED : "#4ade80", padding: "8px", borderRadius: 9, cursor: "pointer", fontWeight: 600, fontSize: 12 }}>{u.active ? "Deactivate" : "Activate"}</button>
                  <button onClick={() => setMResetPwd(u)} style={{ flex: 1, background: "rgba(96,165,250,0.1)", border: "1px solid rgba(96,165,250,0.2)", color: BLUE, padding: "8px", borderRadius: 9, cursor: "pointer", fontWeight: 600, fontSize: 12 }}>Reset Pwd</button>
                </div>
              )}
            </div>
          );
        })}
      </>}

      {atab === "pending" && <>
        <div style={{ fontSize: 13, fontWeight: 700, color: "#c8dde8", marginBottom: 14 }}>Pending ({pending.length})</div>
        {pending.length === 0 ? <div style={{ textAlign: "center", padding: 40, color: "#3a5a70", border: "1px dashed rgba(100,180,255,0.08)", borderRadius: 14 }}>✅ None</div>
          : pending.map(req => (
            <div key={req.id} style={{ background: "rgba(255,255,255,0.025)", border: "1px solid rgba(200,146,10,0.2)", borderRadius: 13, padding: "14px", marginBottom: 10 }}>
              <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 10 }}>
                <div><div style={{ fontWeight: 700, color: "#e8f4fd" }}>{req.clientName}</div><div style={{ fontSize: 11, color: "#3a5a70" }}>By {req.requestedByName} · {fd(req.requestedAt)}</div></div>
                <Badge label="Pending" color={GOLD} bg="rgba(200,146,10,0.12)" />
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 8, marginBottom: 12 }}>
                {[["Principal", fc(req.principal), BLUE], ["Daily", fc(req.daily), G], ["Total", fc(req.total), "#e8f4fd"], ["Days", req.days + "d", PURPLE], ["Rate", req.interestRate + "%", GOLD], ["Start", fd(req.startDate), "#8ab4c8"]].map(([l, v, c]) => (
                  <div key={l} style={{ background: "rgba(255,255,255,0.04)", borderRadius: 8, padding: "6px 10px" }}><div style={{ fontSize: 9, color: "#3a5a70" }}>{l}</div><div style={{ fontSize: 12, fontWeight: 700, color: c, fontFamily: "monospace" }}>{v}</div></div>
                ))}
              </div>
              <div style={{ display: "flex", gap: 8 }}>
                <button onClick={() => doApprove(req)} style={{ flex: 1, background: `linear-gradient(135deg,${G},${GM})`, border: "none", color: "#000", padding: "10px", borderRadius: 10, cursor: "pointer", fontWeight: 700 }}>✓ Approve</button>
                <button onClick={() => doReject(req.id)} style={{ flex: 1, background: "rgba(248,113,113,0.1)", border: "1px solid rgba(248,113,113,0.2)", color: RED, padding: "10px", borderRadius: 10, cursor: "pointer", fontWeight: 700 }}>✕ Reject</button>
              </div>
            </div>
          ))}
      </>}

      {atab === "monthly" && <>
        <div style={{ background: "rgba(10,92,54,0.1)", border: "1px solid rgba(10,92,54,0.2)", borderRadius: 14, padding: "14px", marginBottom: 14 }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: G, marginBottom: 10 }}>ALL-TIME</div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
            {[["Disbursed", fc(stats.disbursed), BLUE], ["Collected", fc(stats.collected), G], ["Interest", fc(Object.values(monthly).reduce((a, m) => a + (m.totalInterest || 0), 0)), GOLD], ["Outstanding", fc(stats.outstanding), RED]].map(([l, v, c]) => (
              <div key={l} style={{ background: "rgba(255,255,255,0.04)", borderRadius: 9, padding: "10px 12px" }}><div style={{ fontSize: 9, color: "#3a5a70" }}>{l}</div><div style={{ fontSize: 14, fontWeight: 800, color: c, fontFamily: "monospace" }}>{v}</div></div>
            ))}
          </div>
        </div>
        {Object.keys(monthly).sort().reverse().map(k => {
          const d = monthly[k];
          return (
            <div key={k} style={{ background: "rgba(255,255,255,0.025)", border: "1px solid rgba(100,180,255,0.08)", borderRadius: 14, overflow: "hidden", marginBottom: 12 }}>
              <div style={{ background: "rgba(10,92,54,0.3)", padding: "12px 16px", display: "flex", justifyContent: "space-between" }}>
                <div style={{ fontSize: 14, fontWeight: 700, color: "#e8f4fd" }}>{mlabel(k)}</div>
                <div style={{ textAlign: "right" }}><div style={{ fontSize: 13, fontWeight: 800, color: BLUE, fontFamily: "monospace" }}>{fc(d.totalDisbursed)}</div><div style={{ fontSize: 10, color: GOLD }}>+{fc(d.totalInterest)}</div></div>
              </div>
              {d.loans?.map((ln, i) => (
                <div key={i} style={{ display: "flex", justifyContent: "space-between", padding: "8px 16px", borderBottom: "1px solid rgba(100,180,255,0.06)" }}>
                  <div><div style={{ fontSize: 12, color: "#e8f4fd", fontWeight: 600 }}>{ln.clientName}</div><div style={{ fontSize: 10, color: "#3a5a70" }}>{ln.days}d · {ln.interestRate}%</div></div>
                  <div style={{ textAlign: "right" }}><div style={{ fontSize: 13, color: BLUE, fontFamily: "monospace", fontWeight: 700 }}>{fc(ln.principal)}</div><div style={{ fontSize: 10, color: GOLD }}>+{fc(ln.interest)}</div></div>
                </div>
              ))}
            </div>
          );
        })}
      </>}

      {atab === "audit" && <>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: "#c8dde8" }}>Audit ({auditLog.length})</div>
          <button onClick={() => exportCSV(auditLog.map(a => ({ Action: a.action, Detail: a.detail, By: a.by, Role: a.role, Date: a.date })), `audit_${todayStr}.csv`)}
            style={{ fontSize: 11, background: "rgba(96,165,250,0.1)", border: "1px solid rgba(96,165,250,0.2)", color: BLUE, padding: "6px 12px", borderRadius: 8, cursor: "pointer", fontWeight: 600 }}>📥</button>
        </div>
        {auditLog.length === 0 ? <div style={{ textAlign: "center", padding: 40, color: "#3a5a70" }}>No activity</div>
          : auditLog.slice(0, 50).map(a => (
            <div key={a.id} style={{ display: "flex", justifyContent: "space-between", background: "rgba(255,255,255,0.02)", border: "1px solid rgba(100,180,255,0.06)", borderRadius: 10, padding: "10px 13px", marginBottom: 7 }}>
              <div><div style={{ fontSize: 12, fontWeight: 600, color: "#e8f4fd" }}>{a.action.replace(/_/g, " ")}</div><div style={{ fontSize: 11, color: "#8ab4c8" }}>{a.detail}</div><div style={{ fontSize: 10, color: "#3a5a70" }}>{a.by} ({a.role})</div></div>
              <div style={{ fontSize: 10, color: "#3a5a70", whiteSpace: "nowrap" }}>{fd(a.date)}</div>
            </div>
          ))}
      </>}
    </div>
  );

  // ── OFFICER DASHBOARD ─────────────────────────────────────────────────────
  const OfficerDash = () => {
    const todayExp = myClients.reduce((a, c) => a + (c.loans?.flatMap(l => l.schedule || []).filter(s => s.dueDate === todayStr && !s.paid).reduce((x, s) => x + (s.payment || 0), 0) || 0), 0);
    const todayCol = myClients.reduce((a, c) => a + (c.loans?.flatMap(l => l.schedule || []).filter(s => s.paidDate === todayStr).reduce((x, s) => x + s.paidAmount, 0) || 0), 0);
    return (
      <div>
        <div style={{ marginBottom: 14 }}><h1 style={{ margin: 0, fontSize: 22, fontWeight: 800, color: "#e8f4fd" }}>My Dashboard</h1><p style={{ margin: "2px 0 0", color: "#3a5a70", fontSize: 12 }}>{user?.name} · Officer</p></div>
        {myPending.length > 0 && <div style={{ background: "rgba(200,146,10,0.1)", border: "1px solid rgba(200,146,10,0.25)", borderRadius: 12, padding: "10px 14px", marginBottom: 12, display: "flex", gap: 10, alignItems: "center" }}><span>⏳</span><div style={{ fontSize: 12, fontWeight: 700, color: GOLD }}>{myPending.length} Pending</div></div>}
        <div style={{ background: "linear-gradient(135deg,rgba(10,92,54,0.12),rgba(59,130,246,0.06))", border: "1px solid rgba(10,92,54,0.25)", borderRadius: 14, padding: "14px", marginBottom: 14 }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: G, marginBottom: 10 }}>📅 TODAY</div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
            {[["Expected", fc(todayExp), BLUE], ["Collected", fc(todayCol), "#4ade80"]].map(([l, v, c]) => (
              <div key={l} style={{ background: "rgba(255,255,255,0.05)", borderRadius: 10, padding: "10px 12px" }}><div style={{ fontSize: 9, color: "#3a5a70", letterSpacing: 1 }}>{l}</div><div style={{ fontSize: 16, fontWeight: 800, color: c, fontFamily: "monospace" }}>{v}</div></div>
            ))}
          </div>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 14 }}>
          <StatCard label="Clients" value={myClients.length} accent={BLUE} />
          <StatCard label="Active" value={stats.active} accent={G} />
          <StatCard label="Collected" value={fc(stats.collected)} accent={PURPLE} />
          <StatCard label="Overdue" value={stats.overdue} accent={RED} />
        </div>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}><div style={{ fontSize: 13, fontWeight: 700, color: "#c8dde8" }}>My Clients</div><button onClick={() => setView("clients")} style={{ background: "none", border: "none", color: BLUE, fontSize: 12, cursor: "pointer" }}>See all →</button></div>
        {myClients.length === 0
          ? <div style={{ border: "1px dashed rgba(100,180,255,0.08)", borderRadius: 14, padding: 40, textAlign: "center", color: "#3a5a70" }}><div style={{ fontSize: 36, marginBottom: 10 }}>💳</div><div style={{ marginBottom: 14 }}>No clients</div><GBtn onClick={() => setMAddClient(true)}>+ Add Client</GBtn></div>
          : myClients.slice(0, 6).map(c => {
            const al = c.loans?.find(l => l.status === "active");
            const od = al?.schedule?.filter(s => !s.paid && new Date(s.dueDate) < today).length || 0;
            return (
              <div key={c.id} onClick={() => { setSelId(c.id); setView("detail"); }} style={{ background: "rgba(255,255,255,0.025)", border: "1px solid rgba(100,180,255,0.08)", borderRadius: 12, padding: "12px 15px", cursor: "pointer", display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <div style={{ width: 36, height: 36, borderRadius: 10, background: "linear-gradient(135deg,#1d4ed8,#3b82f6)", display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 800, fontSize: 15, color: "#fff" }}>{c.name.charAt(0).toUpperCase()}</div>
                  <div><div style={{ fontWeight: 600, color: "#e8f4fd", fontSize: 14 }}>{c.name}</div><div style={{ fontSize: 10, color: "#3a5a70" }}>{c.phone}</div></div>
                </div>
                <div style={{ textAlign: "right" }}>{al ? <div style={{ fontSize: 12, fontWeight: 700, color: od > 0 ? RED : BLUE, fontFamily: "monospace" }}>{fc(al.schedule.find(s => !s.paid)?.balance ?? 0)}</div> : <div style={{ fontSize: 11, color: "#3a5a70" }}>No loan</div>}</div>
              </div>
            );
          })}
      </div>
    );
  };

  // ── CLIENTS LIST ──────────────────────────────────────────────────────────
  const ClientsList = () => {
    const filtered = myClients.filter(c => c.name.toLowerCase().includes(search.toLowerCase()) || c.phone.includes(search) || (c.union || "").toLowerCase().includes(search.toLowerCase()));
    return (
      <div>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
          <h1 style={{ margin: 0, fontSize: 22, fontWeight: 800, color: "#e8f4fd" }}>{isAdmin ? "All Clients" : "My Clients"}</h1>
          <GBtn onClick={() => setMAddClient(true)} style={{ padding: "9px 16px", fontSize: 13 }}>+ New</GBtn>
        </div>
        <SearchBar value={search} onChange={setSearch} placeholder="Search name, phone, union…" />
        {filtered.length === 0 ? <div style={{ textAlign: "center", padding: 60, color: "#3a5a70", border: "1px dashed rgba(100,180,255,0.08)", borderRadius: 14 }}><div style={{ fontSize: 36, marginBottom: 10 }}>👤</div><div>{search ? "No match" : "No clients"}</div></div>
          : filtered.map(c => {
            const al = c.loans?.find(l => l.status === "active");
            const paid = al?.schedule?.filter(s => s.paid).length || 0;
            const tot = al?.schedule?.length || 0;
            const od = al?.schedule?.filter(s => !s.paid && new Date(s.dueDate) < today).length || 0;
            const sav = savings[c.id]?.balance || 0;
            return (
              <div key={c.id} onClick={() => { setSelId(c.id); setView("detail"); }} style={{ background: "rgba(255,255,255,0.025)", border: "1px solid rgba(100,180,255,0.08)", borderRadius: 13, padding: "14px 16px", cursor: "pointer", marginBottom: 9 }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: al ? 10 : 0 }}>
                  <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
                    <div style={{ width: 40, height: 40, borderRadius: 11, background: "linear-gradient(135deg,#1e3a5f,#2563eb)", display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 800, fontSize: 16, color: "#93c5fd" }}>{c.name.charAt(0).toUpperCase()}</div>
                    <div>
                      <div style={{ fontWeight: 700, color: "#e8f4fd", fontSize: 14 }}>{c.name}</div>
                      <div style={{ fontSize: 11, color: "#3a5a70" }}>{c.phone}{c.union ? ` · ${c.union}` : ""}</div>
                      {isAdmin && <div style={{ fontSize: 10, color: GOLD }}>👤 {c.assignedName || "—"}</div>}
                    </div>
                  </div>
                  <div style={{ textAlign: "right" }}>
                    <Badge label={al ? "Active" : c.loans?.length > 0 ? "Done" : "No Loan"} color={al ? "#4ade80" : "#3a5a70"} bg={al ? "rgba(34,197,94,0.12)" : "rgba(100,130,150,0.08)"} />
                    {sav > 0 && <div style={{ fontSize: 10, color: PURPLE, marginTop: 3 }}>💰 {fc(sav)}</div>}
                  </div>
                </div>
                {al && <div><div style={{ display: "flex", justifyContent: "space-between", fontSize: 11, color: "#3a5a70", marginBottom: 5 }}><span>{paid}/{tot}</span><span style={{ color: od > 0 ? RED : "#3a6050" }}>{od > 0 ? `${od} overdue` : "✓"}</span></div><div style={{ height: 3, background: "rgba(255,255,255,0.06)", borderRadius: 4, overflow: "hidden" }}><div style={{ height: "100%", width: `${tot > 0 ? (paid / tot) * 100 : 0}%`, background: "linear-gradient(90deg,#22c55e,#4ade80)", borderRadius: 4 }} /></div></div>}
              </div>
            );
          })}
      </div>
    );
  };

  // ── CLIENT DETAIL ─────────────────────────────────────────────────────────
  const Detail = () => {
    if (!selClient) return null;
    const c = clients.find(x => x.id === selId) || selClient;
    if (isOfficer && c.assignedTo !== user?.id) return <div style={{ textAlign: "center", padding: 60, color: "#3a5a70" }}>🔒 Access denied</div>;
    const al = c.loans?.find(l => l.status === "active");
    const cSav = savings[c.id] || { balance: 0, transactions: [] };
    const hasPending = pending.some(p => p.clientId === c.id);
    const completed = c.loans?.filter(l => l.status === "completed") || [];
    const totalLF = al?.lateFees?.reduce((a, f) => a + f.amount, 0) || 0;

    return (
      <div>
        <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 18 }}>
          <button onClick={() => setView("clients")} style={{ background: "rgba(255,255,255,0.06)", border: "none", color: "#8ab4c8", width: 34, height: 34, borderRadius: 9, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="15 18 9 12 15 6" /></svg></button>
          <div style={{ width: 44, height: 44, borderRadius: 12, background: "linear-gradient(135deg,#1d4ed8,#3b82f6)", display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 800, fontSize: 18, color: "#fff" }}>{c.name.charAt(0).toUpperCase()}</div>
          <div style={{ flex: 1 }}><div style={{ fontSize: 18, fontWeight: 800, color: "#e8f4fd" }}>{c.name}</div><div style={{ fontSize: 11, color: "#3a5a70" }}>{c.id} · {fd(c.createdAt)}</div></div>
          <div style={{ display: "flex", gap: 6 }}>
            <button onClick={() => setMNotes(c.id)} style={{ background: "rgba(96,165,250,0.1)", border: "1px solid rgba(96,165,250,0.2)", color: BLUE, padding: "6px 10px", borderRadius: 8, cursor: "pointer", fontSize: 11, fontWeight: 700 }}>📝</button>
            {isAdmin && <button onClick={() => setMEditClient({ name: c.name, phone: c.phone, address: c.address, idNumber: c.idNumber, union: c.union, email: c.email, guarantor: c.guarantor })} style={{ background: "rgba(200,146,10,0.1)", border: "1px solid rgba(200,146,10,0.2)", color: GOLD, padding: "6px 10px", borderRadius: 8, cursor: "pointer", fontSize: 11, fontWeight: 700 }}>✏️</button>}
          </div>
        </div>

        {/* Credit Score */}
        <div style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(100,180,255,0.08)", borderRadius: 12, padding: "12px 16px", marginBottom: 14, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div><div style={{ fontSize: 9, color: "#3a5a70", letterSpacing: 1 }}>CREDIT SCORE</div><div style={{ fontSize: 22, fontWeight: 800, color: (c.creditScore || 100) >= 80 ? "#4ade80" : (c.creditScore || 100) >= 50 ? GOLD : RED }}>{c.creditScore || 100}</div></div>
          <div style={{ width: 50, height: 50, borderRadius: "50%", background: `conic-gradient(${(c.creditScore || 100) >= 80 ? "#22c55e" : (c.creditScore || 100) >= 50 ? GOLD : RED} ${(c.creditScore || 100) * 3.6}deg, rgba(255,255,255,0.05) 0deg)`, display: "flex", alignItems: "center", justifyContent: "center" }}>
            <div style={{ width: 36, height: 36, borderRadius: "50%", background: "#060f1a", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 10, fontWeight: 800, color: "#e8f4fd" }}>{c.creditScore || 100}</div>
          </div>
        </div>

        {/* Info */}
        <div style={{ background: "rgba(100,180,255,0.04)", border: "1px solid rgba(100,180,255,0.08)", borderRadius: 13, padding: "14px 16px", marginBottom: 14, display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
          {[["PHONE", c.phone || "—"], ["ID/BVN", c.idNumber || "—"], ["UNION", c.union || "—"], ["EMAIL", c.email || "—"], ["GUARANTOR", c.guarantor || "—"]].map(([l, v]) => (
            <div key={l}><div style={{ fontSize: 9, color: "#3a5a70", marginBottom: 2 }}>{l}</div><div style={{ color: "#e8f4fd", fontSize: 13 }}>{v}</div></div>
          ))}
          <div style={{ gridColumn: "1/-1" }}><div style={{ fontSize: 9, color: "#3a5a70", marginBottom: 2 }}>ADDRESS</div><div style={{ color: "#e8f4fd", fontSize: 13 }}>{c.address || "—"}</div></div>
        </div>

        {/* Notes */}
        {(c.notes || []).length > 0 && <div style={{ background: "rgba(200,146,10,0.06)", border: "1px solid rgba(200,146,10,0.15)", borderRadius: 12, padding: "12px 14px", marginBottom: 14 }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: GOLD, marginBottom: 8 }}>📝 Notes ({c.notes.length})</div>
          {c.notes.slice(-3).reverse().map(n => <div key={n.id} style={{ fontSize: 12, color: "#e8f4fd", padding: "6px 0", borderBottom: "1px solid rgba(200,146,10,0.1)" }}><div>{n.text}</div><div style={{ fontSize: 10, color: "#3a5a70", marginTop: 2 }}>— {n.by} · {fd(n.date)}</div></div>)}
        </div>}

        {/* Savings */}
        <div style={{ background: "linear-gradient(135deg,rgba(196,181,253,0.1),rgba(139,92,246,0.06))", border: "1px solid rgba(196,181,253,0.2)", borderRadius: 14, padding: "14px 16px", marginBottom: 14 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: cSav.transactions.length > 0 ? 10 : 0 }}>
            <div><div style={{ fontSize: 9, color: PURPLE, fontWeight: 700, letterSpacing: 1 }}>SAVINGS</div><div style={{ fontSize: 22, fontWeight: 800, color: "#c4b5fd", fontFamily: "monospace" }}>{fc(cSav.balance)}</div></div>
            <button onClick={() => setMSav({ cId: c.id })} style={{ background: "rgba(196,181,253,0.18)", border: "1px solid rgba(196,181,253,0.3)", color: "#c4b5fd", padding: "8px 14px", borderRadius: 9, cursor: "pointer", fontWeight: 700, fontSize: 12 }}>+ / -</button>
          </div>
          {cSav.transactions.slice(-3).reverse().map(t => <div key={t.id} style={{ display: "flex", justifyContent: "space-between", fontSize: 11, borderTop: "1px solid rgba(196,181,253,0.1)", paddingTop: 6, marginTop: 6 }}><span style={{ color: "#8ab4c8" }}>{t.type === "deposit" ? "📥" : "📤"} {t.note || t.type} · {fd(t.date)}</span><span style={{ color: t.type === "deposit" ? "#4ade80" : RED }}>{t.type === "deposit" ? "+" : "-"}{fc(t.amount)}</span></div>)}
        </div>

        {/* Completed */}
        {completed.length > 0 && <div style={{ background: "rgba(34,197,94,0.04)", border: "1px solid rgba(34,197,94,0.1)", borderRadius: 12, padding: "12px 14px", marginBottom: 14 }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: "#4ade80", marginBottom: 8 }}>✅ Completed ({completed.length})</div>
          {completed.map(l => <div key={l.id} style={{ display: "flex", justifyContent: "space-between", fontSize: 12, padding: "6px 0", borderBottom: "1px solid rgba(34,197,94,0.08)" }}><span style={{ color: "#8ab4c8" }}>{fd(l.startDate)} · {l.days}d</span><span style={{ color: "#4ade80", fontFamily: "monospace" }}>{fc(l.principal)}</span></div>)}
        </div>}

        {/* Active Loan Header */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
          <div style={{ fontSize: 15, fontWeight: 700, color: "#c8dde8" }}>{al ? "Active Loan" : "Loans"}</div>
          {!al && !hasPending && <GBtn onClick={() => setMAddLoan(true)} style={{ padding: "7px 15px", fontSize: 12 }}>{isAdmin ? "+ Issue" : "+ Request"}</GBtn>}
          {hasPending && <Badge label="⏳ Pending" color={GOLD} bg="rgba(200,146,10,0.12)" />}
        </div>

        {al && isAdmin && <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
          <button onClick={() => setMLateFee({ cId: c.id, lId: al.id })} style={{ flex: 1, background: "rgba(248,113,113,0.1)", border: "1px solid rgba(248,113,113,0.2)", color: RED, padding: "8px", borderRadius: 9, cursor: "pointer", fontWeight: 600, fontSize: 11 }}>+ Late Fee</button>
          <button onClick={() => setMExtend({ cId: c.id, lId: al.id })} style={{ flex: 1, background: "rgba(96,165,250,0.1)", border: "1px solid rgba(96,165,250,0.2)", color: BLUE, padding: "8px", borderRadius: 9, cursor: "pointer", fontWeight: 600, fontSize: 11 }}>⏩ Extend</button>
        </div>}

        {al ? <>
          <div style={{ background: "linear-gradient(135deg,rgba(34,197,94,0.07),rgba(59,130,246,0.05))", border: "1px solid rgba(34,197,94,0.15)", borderRadius: 14, padding: "14px", marginBottom: 12 }}>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 10, marginBottom: 12 }}>
              {[["Principal", fc(al.principal), "#93c5fd"], ["Interest", al.interestRate + "%", PURPLE], ["Daily", fc(al.daily), BLUE], ["Total", fc(al.total), "#e8f4fd"], ["Balance", fc(al.schedule.find(s => !s.paid)?.balance ?? 0), RED], ["Progress", `${al.schedule.filter(s => s.paid).length}/${al.schedule.length}`, "#4ade80"]].map(([l, v, col]) => (
                <div key={l}><div style={{ fontSize: 9, color: "#3a5a70", marginBottom: 2 }}>{l}</div><div style={{ color: col, fontWeight: 700, fontSize: 12, fontFamily: "monospace" }}>{v}</div></div>
              ))}
            </div>
            {totalLF > 0 && <div style={{ fontSize: 11, color: RED, marginBottom: 8 }}>⚠️ Late Fees: {fc(totalLF)}</div>}
            {al.extensions?.length > 0 && <div style={{ fontSize: 11, color: BLUE, marginBottom: 8 }}>🔄 Extended {al.extensions.length}x</div>}
            <div style={{ height: 4, background: "rgba(255,255,255,0.06)", borderRadius: 4, overflow: "hidden" }}><div style={{ height: "100%", borderRadius: 4, width: `${(al.schedule.filter(s => s.paid).length / al.schedule.length) * 100}%`, background: "linear-gradient(90deg,#22c55e,#4ade80)" }} /></div>
          </div>

          <div style={{ display: "flex", gap: 3, marginBottom: 12, background: "rgba(255,255,255,0.03)", borderRadius: 10, padding: 3 }}>
            {["schedule", "history"].map(t => <button key={t} onClick={() => setPtab(t)} style={{ flex: 1, padding: "7px", borderRadius: 8, border: "none", cursor: "pointer", background: ptab === t ? "rgba(100,180,255,0.1)" : "transparent", color: ptab === t ? "#93c5fd" : "#3a5a70", fontWeight: 600, fontSize: 12, textTransform: "capitalize" }}>{t}</button>)}
          </div>

          {ptab === "schedule" && al.schedule.map((s, i) => {
            const od = !s.paid && new Date(s.dueDate) < today;
            const isNext = !s.paid && al.schedule.filter(x => !x.paid)[0] === s;
            const hol = isHoliday(s.dueDate);
            return (
              <div key={i} style={{ background: s.paid ? "rgba(34,197,94,0.04)" : od ? "rgba(239,68,68,0.07)" : "rgba(255,255,255,0.02)", border: `1px solid ${s.paid ? "rgba(34,197,94,0.15)" : od ? "rgba(239,68,68,0.2)" : isNext ? "rgba(96,165,250,0.2)" : "rgba(100,180,255,0.06)"}`, borderRadius: 11, padding: "10px 13px", display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 7 }}>
                <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
                  <div style={{ width: 28, height: 28, borderRadius: 7, fontSize: 11, fontWeight: 700, display: "flex", alignItems: "center", justifyContent: "center", background: s.paid ? "rgba(34,197,94,0.15)" : od ? "rgba(239,68,68,0.15)" : "rgba(255,255,255,0.05)", color: s.paid ? "#4ade80" : od ? RED : "#3a5a70" }}>{s.paid ? "✓" : `D${i + 1}`}</div>
                  <div>
                    <div style={{ display: "flex", gap: 4, flexWrap: "wrap", alignItems: "center" }}>
                      <span style={{ fontSize: 13, fontWeight: 600, color: s.paid ? "#4ade80" : od ? RED : "#e8f4fd" }}>{fc(al.daily)}</span>
                      {isNext && <span style={{ fontSize: 9, padding: "1px 6px", borderRadius: 10, background: "rgba(96,165,250,0.15)", color: BLUE, fontWeight: 700 }}>NEXT</span>}
                      {od && <span style={{ fontSize: 9, padding: "1px 6px", borderRadius: 10, background: "rgba(239,68,68,0.15)", color: RED, fontWeight: 700 }}>OVERDUE</span>}
                      {hol && <span style={{ fontSize: 9, padding: "1px 6px", borderRadius: 10, background: "rgba(232,180,32,0.15)", color: GL, fontWeight: 700 }}>🎉</span>}
                    </div>
                    <div style={{ fontSize: 10, color: "#3a5a70", marginTop: 1 }}>{fd(s.dueDate)}{s.paid ? ` · ${s.by}` : ""}</div>
                  </div>
                </div>
                <div style={{ textAlign: "right", flexShrink: 0 }}>
                  <div style={{ fontSize: 11, color: "#3a5a70", marginBottom: 4, fontFamily: "monospace" }}>{fc(s.balance)}</div>
                  {!s.paid && <button onClick={() => { setMPay({ cId: c.id, lId: al.id, idx: i }); setPayAmt(al.daily.toFixed(2)); }} style={{ background: "linear-gradient(135deg,#22c55e,#16a34a)", border: "none", color: "#000", padding: "4px 11px", borderRadius: 7, cursor: "pointer", fontWeight: 700, fontSize: 11 }}>Pay</button>}
                </div>
              </div>
            );
          })}

          {ptab === "history" && (al.schedule.filter(s => s.paid).length === 0
            ? <div style={{ textAlign: "center", padding: 40, color: "#3a5a70" }}>No payments</div>
            : al.schedule.filter(s => s.paid).map((s, i) => (
              <div key={i} style={{ background: "rgba(34,197,94,0.04)", border: "1px solid rgba(34,197,94,0.12)", borderRadius: 11, padding: "11px 14px", display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 7 }}>
                <div style={{ display: "flex", gap: 9, alignItems: "center" }}><div style={{ width: 26, height: 26, borderRadius: 7, background: "rgba(34,197,94,0.15)", display: "flex", alignItems: "center", justifyContent: "center", color: "#4ade80", fontSize: 12 }}>✓</div><div><div style={{ fontSize: 13, color: "#4ade80", fontWeight: 600 }}>{fc(s.paidAmount)}</div><div style={{ fontSize: 10, color: "#3a5a70" }}>{fd(s.paidDate)} · {s.by}</div></div></div>
                <div style={{ fontSize: 11, color: "#3a5a70", fontFamily: "monospace" }}>{fc(s.balance)}</div>
              </div>
            )))}
        </> : <div style={{ border: "1px dashed rgba(100,180,255,0.08)", borderRadius: 13, padding: 40, textAlign: "center", color: "#3a5a70" }}><div style={{ fontSize: 32, marginBottom: 10 }}>💰</div><div>{completed.length > 0 ? "Completed. Issue new." : "No loan yet."}</div></div>}

        {isAdmin && <button onClick={() => setMDel(c.id)} style={{ marginTop: 20, background: "rgba(239,68,68,0.08)", border: "1px solid rgba(239,68,68,0.15)", color: RED, padding: "9px 18px", borderRadius: 10, cursor: "pointer", fontWeight: 600, fontSize: 12 }}>🗑️ Delete</button>}
      </div>
    );
  };

  // ── RENDER ────────────────────────────────────────────────────────────────
  const dashLabel = isAdmin ? (adminMode === "admin" ? "Admin" : "Finance") : isOfficer ? "Dashboard" : "Dashboard";
  const dashIcon = isAdmin ? (adminMode === "admin" ? "🔐" : "📊") : "📊";

  return (
    <div style={{ minHeight: "100vh", background: "#060f1a", fontFamily: "'Segoe UI',system-ui,sans-serif", color: "#e8f4fd" }}>
      <Toast msg={toast.msg} type={toast.type} />

      {/* TOP BAR */}
      <div style={{ background: "rgba(6,15,26,0.97)", borderBottom: "1px solid rgba(100,180,255,0.08)", padding: "10px 16px", display: "flex", justifyContent: "space-between", alignItems: "center", position: "sticky", top: 0, zIndex: 100, backdropFilter: "blur(10px)" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <div style={{ width: 34, height: 34, borderRadius: 9, background: `linear-gradient(135deg,${G},${GM})`, border: "1.5px solid rgba(200,146,10,0.4)", display: "flex", alignItems: "center", justifyContent: "center" }}>
            <svg width="18" height="18" viewBox="0 0 80 80" fill="none"><path d="M48 22A19 19 0 1 0 48 58" stroke="white" strokeWidth="5.5" strokeLinecap="round" fill="none" /><path d="M42 30L53 20L64 30" stroke="#c8920a" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" fill="none" /><line x1="53" y1="20" x2="53" y2="44" stroke="#c8920a" strokeWidth="4" strokeLinecap="round" /></svg>
          </div>
          <div><div style={{ fontSize: 13, fontWeight: 800, color: "#e8f4fd", letterSpacing: 1, fontFamily: "serif" }}>CREDA</div><div style={{ fontSize: 7, color: "rgba(200,146,10,0.7)", letterSpacing: 2, textTransform: "uppercase", lineHeight: 1 }}>Finance</div></div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ fontSize: 10, color: sync === "synced" ? "#4ade80" : sync === "syncing" ? BLUE : GOLD, fontWeight: 600 }}>{sync === "synced" ? "☁️" : "⟳"}</span>
          {pending.length > 0 && isAdmin && <div style={{ background: "rgba(200,146,10,0.15)", color: GOLD, fontSize: 10, padding: "3px 8px", borderRadius: 20, fontWeight: 700 }}>⏳{pending.length}</div>}
          <button onClick={() => { setMProfile(true); setProfileEdit({ name: user?.name, username: user?.username, oldPassword: "", newPassword: "", confirmPassword: "" }); }} style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", background: "none", border: "none", cursor: "pointer" }}>
            <div style={{ fontSize: 11, color: "#e8f4fd", fontWeight: 600 }}>{user?.name?.split(" ")[0]}</div>
            <div style={{ fontSize: 9, color: isAdmin ? GOLD : G, fontWeight: 700, textTransform: "uppercase" }}>{isAdmin ? (adminMode === "admin" ? "Admin" : "Finance") : "Officer"}</div>
          </button>
          <button onClick={() => { if (window.confirm("Sign out?")) { setUser(null); setView("dash"); setAdminMode("admin"); } }} style={{ background: "rgba(248,113,113,0.1)", border: "1px solid rgba(248,113,113,0.15)", color: RED, padding: "5px 10px", borderRadius: 8, cursor: "pointer", fontSize: 10, fontWeight: 700 }}>Out</button>
          {isAdmin && <button onClick={() => setMSettings(true)} style={{ background: "rgba(255,255,255,0.06)", border: "1px solid rgba(100,180,255,0.08)", color: "#8ab4c8", width: 28, height: 28, borderRadius: 8, cursor: "pointer", fontSize: 12 }}>⚙️</button>}
        </div>
      </div>

      {/* CONTENT */}
      <div style={{ padding: "20px 16px 100px", maxWidth: 540, margin: "0 auto" }}>
        {view === "dash" ? (isAdmin ? (adminMode === "accountant" ? <AccountantPanel /> : <AdminPanel />) : <OfficerDash />) : view === "clients" ? <ClientsList /> : view === "detail" ? <Detail /> : <OfficerDash />}
      </div>

      {/* BOTTOM NAV */}
      <div style={{ position: "fixed", bottom: 0, left: 0, right: 0, background: "rgba(6,15,26,0.97)", borderTop: "1px solid rgba(100,180,255,0.08)", display: "flex", backdropFilter: "blur(12px)" }}>
        {[{ id: "dash", label: dashLabel, icon: dashIcon }, { id: "clients", label: "Clients", icon: "👥" }].map(n => {
          const act = view === n.id || (view === "detail" && n.id === "clients");
          return <button key={n.id} onClick={() => setView(n.id)} style={{ flex: 1, padding: "12px 8px 14px", background: "transparent", border: "none", cursor: "pointer", color: act ? "#22c55e" : "#3a5a70", display: "flex", flexDirection: "column", alignItems: "center", gap: 4 }}><span style={{ fontSize: 18 }}>{n.icon}</span><span style={{ fontSize: 10, fontWeight: 600 }}>{n.label}</span></button>;
        })}
      </div>

      {/* ── MODALS ──────────────────────────────────────────────────────── */}

      {mAddClient && <Modal title="Register Client" onClose={() => setMAddClient(false)}>
        <Fld label="Name *"><input style={IS} value={nc.name} onChange={e => setNc(p => ({ ...p, name: e.target.value }))} autoFocus /></Fld>
        <Fld label="Phone *"><input style={IS} value={nc.phone} onChange={e => setNc(p => ({ ...p, phone: e.target.value }))} /></Fld>
        <Fld label="Union"><input style={IS} value={nc.union} onChange={e => setNc(p => ({ ...p, union: e.target.value }))} /></Fld>
        <Fld label="Address"><input style={IS} value={nc.address} onChange={e => setNc(p => ({ ...p, address: e.target.value }))} /></Fld>
        <Fld label="Email"><input style={IS} value={nc.email} onChange={e => setNc(p => ({ ...p, email: e.target.value }))} /></Fld>
        <Fld label="Guarantor"><input style={IS} value={nc.guarantor} onChange={e => setNc(p => ({ ...p, guarantor: e.target.value }))} /></Fld>
        <Fld label="ID/BVN"><input style={IS} value={nc.idNumber} onChange={e => setNc(p => ({ ...p, idNumber: e.target.value }))} /></Fld>
        <div style={{ background: "rgba(96,165,250,0.08)", borderRadius: 9, padding: "9px 12px", marginBottom: 14, fontSize: 12, color: "#8ab4c8" }}>Assigned: <strong style={{ color: "#e8f4fd" }}>{user?.name}</strong></div>
        <GBtn onClick={doAddClient} full style={{ padding: "12px" }}>✓ Register</GBtn>
      </Modal>}

      {mEditClient && <Modal title="Edit Client" onClose={() => setMEditClient(null)}>
        {[["Name", "name"], ["Phone", "phone"], ["Union", "union"], ["Address", "address"], ["Email", "email"], ["Guarantor", "guarantor"], ["ID/BVN", "idNumber"]].map(([l, k]) => (
          <Fld key={k} label={l}><input style={IS} value={mEditClient[k] || ""} onChange={e => setMEditClient(p => ({ ...p, [k]: e.target.value }))} /></Fld>
        ))}
        <GBtn onClick={doEditClient} full style={{ padding: "12px" }}>✓ Save</GBtn>
      </Modal>}

      {mAddLoan && <Modal title={isAdmin ? "Issue Loan" : "Request Loan"} onClose={() => setMAddLoan(false)}>
        <div style={{ background: "rgba(59,130,246,0.08)", borderRadius: 9, padding: "9px 13px", marginBottom: 14, fontSize: 13, color: "#93c5fd" }}>Client: <strong>{selClient?.name}</strong></div>
        {!isAdmin && <div style={{ background: "rgba(200,146,10,0.08)", borderRadius: 9, padding: "9px 12px", marginBottom: 14, fontSize: 12, color: GOLD }}>⏳ Admin must approve</div>}
        <Fld label="Principal (₦) *"><input type="number" style={IS} value={nl.principal} onChange={e => setNl(p => ({ ...p, principal: e.target.value }))} /></Fld>
        <Fld label="Rate (%)"><input type="number" style={IS} value={nl.rate} onChange={e => setNl(p => ({ ...p, rate: e.target.value }))} /></Fld>
        <Fld label="Days"><input type="number" style={IS} value={nl.days} onChange={e => setNl(p => ({ ...p, days: e.target.value }))} /></Fld>
        <Fld label="Start"><input type="date" style={IS} value={nl.start} onChange={e => setNl(p => ({ ...p, start: e.target.value }))} /></Fld>
        {nl.principal && (() => { const p = parseFloat(nl.principal) || 0, r = parseFloat(nl.rate) || 0, d = parseInt(nl.days) || 1, t = p + (p * r / 100); return <div style={{ background: "rgba(34,197,94,0.06)", borderRadius: 10, padding: "12px", marginBottom: 14, display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}><div><div style={{ fontSize: 9, color: "#3a5a70" }}>TOTAL</div><div style={{ color: "#4ade80", fontWeight: 700, fontFamily: "monospace" }}>{fc(t)}</div></div><div><div style={{ fontSize: 9, color: "#3a5a70" }}>DAILY</div><div style={{ color: BLUE, fontWeight: 700, fontFamily: "monospace" }}>{fc(t / d)}</div></div></div>; })()}
        <GBtn onClick={doLoan} full style={{ padding: "12px" }}>{isAdmin ? "✓ Issue" : "📤 Request"}</GBtn>
      </Modal>}

      {mPay && (() => { const cl = clients.find(c => c.id === mPay.cId), ln = cl?.loans?.find(l => l.id === mPay.lId); return <Modal title="Payment" onClose={() => { setMPay(null); setPayAmt(""); }}><div style={{ textAlign: "center", marginBottom: 20 }}><div style={{ fontSize: 12, color: "#3a5a70" }}>Expected</div><div style={{ fontSize: 28, fontWeight: 800, color: "#4ade80", fontFamily: "monospace" }}>{fc(ln?.daily || 0)}</div><div style={{ fontSize: 11, color: "#3a5a70", marginTop: 4 }}>Day {mPay.idx + 1} · {cl?.name}</div></div><Fld label="Amount (₦)"><input type="number" style={IS} value={payAmt} onChange={e => setPayAmt(e.target.value)} autoFocus /></Fld><GBtn onClick={doPay} full style={{ padding: "12px" }}>✓ Confirm</GBtn></Modal>; })()}

      {mSav && <Modal title="💰 Savings" onClose={() => { setMSav(null); setSavAmt(""); setSavNote(""); setSavType("deposit"); }}>
        <div style={{ display: "flex", gap: 8, marginBottom: 16 }}>{["deposit", "withdrawal"].map(t => <button key={t} onClick={() => setSavType(t)} style={{ flex: 1, padding: "10px", borderRadius: 10, border: `1px solid ${savType === t ? (t === "deposit" ? "rgba(34,197,94,0.4)" : "rgba(248,113,113,0.4)") : "rgba(100,180,255,0.08)"}`, background: savType === t ? (t === "deposit" ? "rgba(34,197,94,0.1)" : "rgba(248,113,113,0.1)") : "transparent", color: savType === t ? (t === "deposit" ? "#4ade80" : RED) : "#3a5a70", cursor: "pointer", fontWeight: 700, fontSize: 13, textTransform: "capitalize" }}>{t === "deposit" ? "📥 Deposit" : "📤 Withdraw"}</button>)}</div>
        <Fld label="Amount"><input type="number" style={IS} value={savAmt} onChange={e => setSavAmt(e.target.value)} autoFocus /></Fld>
        <Fld label="Note"><input style={IS} value={savNote} onChange={e => setSavNote(e.target.value)} /></Fld>
        <div style={{ background: "rgba(255,255,255,0.03)", borderRadius: 9, padding: "10px 13px", marginBottom: 14 }}><div style={{ fontSize: 11, color: "#3a5a70" }}>Balance</div><div style={{ fontSize: 18, fontWeight: 800, color: "#c4b5fd", fontFamily: "monospace" }}>{fc(savings[mSav.cId]?.balance || 0)}</div></div>
        <button onClick={doSavings} style={{ width: "100%", background: savType === "deposit" ? `linear-gradient(135deg,${G},${GM})` : "linear-gradient(135deg,#dc2626,#b91c1c)", border: "none", color: savType === "deposit" ? "#000" : "#fff", padding: "12px", borderRadius: 12, cursor: "pointer", fontWeight: 700, fontSize: 14 }}>✓ {savType === "deposit" ? "Deposit" : "Withdraw"}</button>
      </Modal>}

      {mNotes && <Modal title="📝 Notes" onClose={() => { setMNotes(null); setNoteText(""); }}>
        <Fld label="Add Note"><textarea style={{ ...IS, height: 80, resize: "vertical" }} value={noteText} onChange={e => setNoteText(e.target.value)} /></Fld>
        <GBtn onClick={doAddNote} full style={{ padding: "11px", marginBottom: 16 }}>+ Add</GBtn>
        {(clients.find(c => c.id === mNotes)?.notes || []).length === 0 ? <div style={{ textAlign: "center", padding: 20, color: "#3a5a70", fontSize: 12 }}>No notes</div>
          : [...(clients.find(c => c.id === mNotes)?.notes || [])].reverse().map(n => <div key={n.id} style={{ background: "rgba(255,255,255,0.03)", borderRadius: 10, padding: "10px 12px", marginBottom: 8 }}><div style={{ fontSize: 13, color: "#e8f4fd" }}>{n.text}</div><div style={{ fontSize: 10, color: "#3a5a70", marginTop: 4 }}>— {n.by} · {fd(n.date)}</div></div>)}
      </Modal>}

      {mLateFee && <Modal title="Late Fee" onClose={() => { setMLateFee(null); setLateFeeAmt(""); }}>
        <div style={{ background: "rgba(248,113,113,0.08)", borderRadius: 9, padding: "10px 12px", marginBottom: 14, fontSize: 12, color: RED }}>⚠️ Adds penalty to loan total</div>
        <Fld label="Amount (₦)"><input type="number" style={IS} value={lateFeeAmt} onChange={e => setLateFeeAmt(e.target.value)} autoFocus /></Fld>
        <GBtn onClick={doAddLateFee} full color={RED} text="#fff" style={{ padding: "12px" }}>Apply</GBtn>
      </Modal>}

      {mExtend && <Modal title="Extend Loan" onClose={() => { setMExtend(null); setExtendDays(""); }}>
        <Fld label="Extra Days"><input type="number" style={IS} value={extendDays} onChange={e => setExtendDays(e.target.value)} autoFocus /></Fld>
        <GBtn onClick={doExtendLoan} full color={BLUE} text="#000" style={{ padding: "12px" }}>⏩ Extend</GBtn>
      </Modal>}

      {mAddUser && <Modal title="Add Staff" onClose={() => setMAddUser(false)}>
        <Fld label="Name *"><input style={IS} value={nu.name} onChange={e => setNu(p => ({ ...p, name: e.target.value }))} autoFocus /></Fld>
        <Fld label="Username *"><input style={IS} value={nu.username} onChange={e => setNu(p => ({ ...p, username: e.target.value.toLowerCase().replace(/\s/g, "") }))} /></Fld>
        <Fld label="Password *"><input type="password" style={IS} value={nu.password} onChange={e => setNu(p => ({ ...p, password: e.target.value }))} /></Fld>
        <Fld label="Role"><select style={IS} value={nu.role} onChange={e => setNu(p => ({ ...p, role: e.target.value }))}><option value="officer">Officer</option><option value="accountant">Accountant</option></select></Fld>
        <GBtn onClick={doAddUser} full style={{ padding: "12px" }}>✓ Create</GBtn>
      </Modal>}

      {mResetPwd && (() => { const [np, setNp] = useState(""); return <Modal title="Reset Password" onClose={() => setMResetPwd(null)}>
        <div style={{ fontSize: 13, color: "#8ab4c8", marginBottom: 16 }}>For: <strong style={{ color: "#e8f4fd" }}>{mResetPwd.name}</strong></div>
        <Fld label="New Password"><input type="password" style={IS} value={np} onChange={e => setNp(e.target.value)} autoFocus /></Fld>
        <GBtn onClick={() => { if (np.length >= 4) { su(users.map(u => u.id === mResetPwd.id ? { ...u, password: np } : u)); setMResetPwd(null); showToast("Reset!"); } else showToast("Min 4 chars", "error"); }} full style={{ padding: "12px" }}>✓ Reset</GBtn>
      </Modal>; })()}

      {mProfile && <Modal title="👤 My Profile" onClose={() => setMProfile(false)}>
        <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 20, padding: "12px", background: "rgba(255,255,255,0.03)", borderRadius: 12 }}>
          <div style={{ width: 50, height: 50, borderRadius: 14, background: `linear-gradient(135deg,${G},${GM})`, display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 800, fontSize: 22, color: "#fff" }}>{user?.name?.charAt(0)}</div>
          <div><div style={{ fontWeight: 700, color: "#e8f4fd", fontSize: 16 }}>{user?.name}</div><div style={{ fontSize: 12, color: "#3a5a70" }}>@{user?.username} · {user?.role}</div></div>
        </div>
        <div style={{ background: "rgba(200,146,10,0.08)", borderRadius: 9, padding: "9px 12px", marginBottom: 16, fontSize: 12, color: GOLD }}>🔐 Enter current password to save changes</div>
        <Fld label="Current Password *"><input type="password" style={IS} value={profileEdit.oldPassword} onChange={e => setProfileEdit(p => ({ ...p, oldPassword: e.target.value }))} /></Fld>
        <Fld label="Name"><input style={IS} value={profileEdit.name} onChange={e => setProfileEdit(p => ({ ...p, name: e.target.value }))} /></Fld>
        <Fld label="New Username"><input style={IS} value={profileEdit.username} onChange={e => setProfileEdit(p => ({ ...p, username: e.target.value.toLowerCase().replace(/\s/g, "") }))} /></Fld>
        <Fld label="New Password"><input type="password" style={IS} value={profileEdit.newPassword} onChange={e => setProfileEdit(p => ({ ...p, newPassword: e.target.value }))} placeholder="Leave blank to keep" /></Fld>
        <Fld label="Confirm"><input type="password" style={IS} value={profileEdit.confirmPassword} onChange={e => setProfileEdit(p => ({ ...p, confirmPassword: e.target.value }))} /></Fld>
        <GBtn onClick={doUpdateProfile} full style={{ padding: "12px" }}>✓ Update</GBtn>
      </Modal>}

      {mSettings && <Modal title="⚙️ Settings" onClose={() => setMSettings(false)}>
        <div style={{ background: "rgba(34,197,94,0.06)", borderRadius: 10, padding: "12px 14px", marginBottom: 14 }}><div style={{ fontSize: 12, color: "#4ade80", fontWeight: 700 }}>☁️ Firebase Synced</div></div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8, marginBottom: 14 }}>
          {[["Clients", clients.length], ["Staff", users.length], ["Records", Object.keys(monthly).length]].map(([l, v]) => <div key={l} style={{ background: "rgba(255,255,255,0.04)", borderRadius: 8, padding: "8px 10px" }}><div style={{ fontSize: 9, color: "#3a5a70" }}>{l}</div><div style={{ fontSize: 14, fontWeight: 700, color: "#e8f4fd" }}>{v}</div></div>)}
        </div>
        <GBtn onClick={() => { exportBackup(); setMSettings(false); }} full style={{ padding: "11px", marginBottom: 10 }}>📤 Backup</GBtn>
        <button onClick={() => exportCSV(clients.map(c => ({ Name: c.name, Phone: c.phone, Union: c.union || "", Officer: c.assignedName || "" })), `clients_${todayStr}.csv`)} style={{ width: "100%", background: "rgba(96,165,250,0.1)", border: "1px solid rgba(96,165,250,0.2)", color: BLUE, padding: "11px", borderRadius: 10, cursor: "pointer", fontWeight: 700, fontSize: 13, marginBottom: 10 }}>📊 Clients CSV</button>
        <label style={{ display: "block", width: "100%", background: "rgba(96,165,250,0.1)", border: "1px solid rgba(96,165,250,0.25)", color: BLUE, padding: "11px", borderRadius: 10, cursor: "pointer", fontWeight: 700, fontSize: 13, textAlign: "center", boxSizing: "border-box", marginBottom: 10 }}>📥 Restore<input type="file" accept=".json" style={{ display: "none" }} onChange={e => { if (e.target.files[0]) { const reader = new FileReader(); reader.onload = ev => { try { const d = JSON.parse(ev.target.result); sc(d.clients || []); sm(d.monthly || {}); ss(d.savings || {}); su(d.users || DEFAULT_USERS); sp(d.pending || []); if (d.auditLog) { setAuditLog(d.auditLog); fbSet("auditLog", d.auditLog); } setMSettings(false); showToast("✅ Restored!"); } catch (err) { showToast("Error: " + err.message, "error"); } }; reader.readAsText(e.target.files[0]); } }} /></label>
        <button onClick={() => { if (window.confirm("DELETE ALL?")) { sc([]); sm({}); ss({}); sp([]); setMSettings(false); showToast("Cleared"); } }} style={{ width: "100%", background: "rgba(248,113,113,0.1)", border: "1px solid rgba(248,113,113,0.2)", color: RED, padding: "10px", borderRadius: 10, cursor: "pointer", fontWeight: 600, fontSize: 12 }}>🗑️ Clear All</button>
      </Modal>}

      {mDel && <Modal title="Delete?" onClose={() => setMDel(null)}>
        <p style={{ color: "#8ab4c8", fontSize: 14, marginBottom: 20 }}>Permanently delete this client?</p>
        <div style={{ display: "flex", gap: 10 }}>
          <button onClick={() => setMDel(null)} style={{ flex: 1, background: "rgba(255,255,255,0.05)", border: "1px solid rgba(100,180,255,0.08)", color: "#8ab4c8", padding: "11px", borderRadius: 11, cursor: "pointer", fontWeight: 700 }}>Cancel</button>
          <button onClick={() => doDeleteClient(mDel)} style={{ flex: 1, background: "linear-gradient(135deg,#dc2626,#b91c1c)", border: "none", color: "#fff", padding: "11px", borderRadius: 11, cursor: "pointer", fontWeight: 700 }}>Delete</button>
        </div>
      </Modal>}
    </div>
  );
                                                                                              }
