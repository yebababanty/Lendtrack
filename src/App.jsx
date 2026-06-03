import { useState, useEffect, useMemo } from "react";
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
  try { const s = await getDoc(doc(db,"creda",id)); return s.exists()?s.data().value:null; }
  catch(e){ return null; }
}
async function fbSet(id, value) {
  try { await setDoc(doc(db,"creda",id),{value}); } catch(e){ console.error(e); }
}
function fbListen(id, cb) {
  return onSnapshot(doc(db,"creda",id), s=>{ if(s.exists()) cb(s.data().value); });
}

// ─── NIGERIAN HOLIDAYS ────────────────────────────────────────────────────────
function getEaster(y){
  const a=y%19,b=Math.floor(y/100),c=y%100,d=Math.floor(b/4),e=b%4,
    f=Math.floor((b+8)/25),g=Math.floor((b-f+1)/3),h=(19*a+b-d-g+15)%30,
    i=Math.floor(c/4),k=c%4,l=(32+2*e+2*i-h-k)%7,m=Math.floor((a+11*h+22*l)/451),
    mo=Math.floor((h+l-7*m+114)/31),dy=((h+l-7*m+114)%31)+1;
  return new Date(y,mo-1,dy);
}
function getNigerianHolidays(y){
  const h={};
  [["01-01","New Year's Day"],["05-01","Workers Day"],["06-12","Democracy Day"],["10-01","Independence Day"],["12-25","Christmas Day"],["12-26","Boxing Day"]].forEach(([k,v])=>h[`${y}-${k}`]=v);
  const e=getEaster(y), gf=new Date(e), em=new Date(e);
  gf.setDate(e.getDate()-2); em.setDate(e.getDate()+1);
  h[gf.toISOString().split("T")[0]]="Good Friday";
  h[e.toISOString().split("T")[0]]="Easter Sunday";
  h[em.toISOString().split("T")[0]]="Easter Monday";
  if(y===2026){h["2026-03-30"]="Eid-ul-Fitr";h["2026-06-06"]="Eid-ul-Adha";}
  if(y===2027){h["2027-03-20"]="Eid-ul-Fitr";h["2027-05-27"]="Eid-ul-Adha";}
  return h;
}
function isHoliday(d){ if(!d) return null; return getNigerianHolidays(new Date(d).getFullYear())[d]||null; }
function isWorkday(d){ const day=new Date(d).getDay(); return day!==0&&day!==6&&!isHoliday(d); }
function getWorkdays(start,count){
  const days=[],cur=new Date(start); cur.setDate(cur.getDate()+1);
  while(days.length<count){ const ds=cur.toISOString().split("T")[0]; if(isWorkday(ds)) days.push(ds); cur.setDate(cur.getDate()+1); }
  return days;
}

// ─── DEFAULTS ─────────────────────────────────────────────────────────────────
const DEFAULT_USERS=[{id:"admin_001",username:"admin",password:"creda2026",role:"admin",name:"Daniel Agunbiade",createdAt:"2026-04-21",active:true}];

// ─── UTILS ───────────────────────────────────────────────────────────────────
const uid=(p="")=>p+Date.now().toString().slice(-6)+Math.floor(Math.random()*100);
const fc=(n)=>"₦"+Number(n||0).toLocaleString("en-NG",{minimumFractionDigits:2});
const fd=(s)=>s?new Date(s).toLocaleDateString("en-NG",{day:"2-digit",month:"short",year:"numeric"}):"—";
const mk=(d=new Date())=>`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}`;
const mlabel=(k)=>{ const[y,m]=k.split("-"); return new Date(y,m-1).toLocaleDateString("en-NG",{month:"long",year:"numeric"}); };

function calcLoan(principal,rate,days,startDate){
  const interest=(principal*rate)/100, total=principal+interest, daily=total/days;
  const workdays=getWorkdays(startDate,days);
  let bal=total;
  const schedule=workdays.map((date,i)=>{ bal=Math.max(0,bal-daily); return{day:i+1,dueDate:date,payment:daily,balance:bal,paid:false,paidDate:null,paidAmount:0}; });
  return{daily,total,interest,schedule};
}

// ─── COLORS ──────────────────────────────────────────────────────────────────
const G="#0a5c36",GM="#0d7a48",GOLD="#c8920a",GL="#e8b420",RED="#f87171",BLUE="#60a5fa",PURPLE="#c4b5fd";
const BG="#060f1a",CARD="#0d1b2a",LINE="rgba(100,180,255,0.08)",INK="#e8f4fd",SOFT="#8ab4c8",DIM="#3a5a70";
const IS={width:"100%",padding:"10px 13px",background:"rgba(100,180,255,0.05)",border:"1px solid rgba(100,180,255,0.15)",borderRadius:10,color:INK,fontSize:14,outline:"none",boxSizing:"border-box",fontFamily:"inherit"};

// ─── SMALL COMPONENTS ────────────────────────────────────────────────────────
function Modal({title,onClose,children}){
  return(
    <div style={{position:"fixed",inset:0,background:"rgba(0,8,20,0.93)",zIndex:1000,display:"flex",alignItems:"center",justifyContent:"center",padding:16,backdropFilter:"blur(8px)"}}>
      <div style={{background:CARD,border:`1px solid ${LINE}`,borderRadius:20,width:"100%",maxWidth:500,maxHeight:"92vh",overflowY:"auto",boxShadow:"0 40px 100px rgba(0,0,0,0.7)"}}>
        <div style={{padding:"20px 22px 14px",borderBottom:`1px solid ${LINE}`,display:"flex",justifyContent:"space-between",alignItems:"center",position:"sticky",top:0,background:CARD,borderRadius:"20px 20px 0 0"}}>
          <h2 style={{margin:0,fontSize:17,fontWeight:700,color:INK}}>{title}</h2>
          <button onClick={onClose} style={{background:"rgba(255,255,255,0.06)",border:"none",color:SOFT,width:30,height:30,borderRadius:8,cursor:"pointer",fontSize:17}}>×</button>
        </div>
        <div style={{padding:"20px 22px"}}>{children}</div>
      </div>
    </div>
  );
}
function Fld({label,children}){return <div style={{marginBottom:14}}><label style={{display:"block",fontSize:11,color:DIM,marginBottom:5,letterSpacing:0.8,textTransform:"uppercase"}}>{label}</label>{children}</div>;}
function GBtn({onClick,children,color=G,text="#000",full,style={}}){return <button onClick={onClick} style={{background:`linear-gradient(135deg,${color},${color}cc)`,border:"none",color:text,padding:"11px 18px",borderRadius:11,cursor:"pointer",fontWeight:700,fontSize:13,width:full?"100%":undefined,...style}}>{children}</button>;}
function Badge({label,color,bg}){return <span style={{fontSize:10,padding:"2px 9px",borderRadius:20,background:bg,color,fontWeight:700}}>{label}</span>;}
function Card({label,value,accent}){
  return(
    <div style={{background:"rgba(255,255,255,0.03)",border:`1px solid ${LINE}`,borderRadius:14,padding:"14px 16px",borderTop:`2px solid ${accent}`}}>
      <div style={{fontSize:9,color:DIM,letterSpacing:1.2,textTransform:"uppercase",marginBottom:6}}>{label}</div>
      <div style={{fontSize:17,fontWeight:800,color:INK,fontFamily:"monospace"}}>{value}</div>
    </div>
  );
}

// ─── LOGIN ────────────────────────────────────────────────────────────────────
function Login({onLogin}){
  const[uname,setUname]=useState(""),[ pwd,setPwd]=useState(""),[ err,setErr]=useState(""),[ busy,setBusy]=useState(false);

  const doLogin=async()=>{
    setBusy(true); setErr("");
    try{
      const stored=await fbGet("users");
      const list=stored||DEFAULT_USERS;
      if(!stored) await fbSet("users",DEFAULT_USERS);
      const found=list.find(u=>u.username===uname.trim()&&u.password===pwd.trim()&&u.active);
      if(found) onLogin(found); else setErr("Invalid username or password.");
    }catch(e){ setErr("Connection error. Check internet and retry."); }
    setBusy(false);
  };

  return(
    <div style={{minHeight:"100vh",background:BG,display:"flex",alignItems:"center",justifyContent:"center",padding:20,backgroundImage:"radial-gradient(ellipse at 30% 20%,rgba(10,92,54,0.15) 0%,transparent 60%)"}}>
      <div style={{width:"100%",maxWidth:380}}>
        <div style={{textAlign:"center",marginBottom:36}}>
          <div style={{width:68,height:68,borderRadius:20,background:`linear-gradient(135deg,${G},${GM})`,border:"2px solid rgba(200,146,10,0.4)",display:"flex",alignItems:"center",justifyContent:"center",margin:"0 auto 14px"}}>
            <svg width="36" height="36" viewBox="0 0 80 80" fill="none"><path d="M48 22A19 19 0 1 0 48 58" stroke="white" strokeWidth="5.5" strokeLinecap="round" fill="none"/><path d="M42 30L53 20L64 30" stroke="#c8920a" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" fill="none"/><line x1="53" y1="20" x2="53" y2="44" stroke="#c8920a" strokeWidth="4" strokeLinecap="round"/></svg>
          </div>
          <div style={{fontFamily:"serif",fontSize:30,fontWeight:800,color:INK,letterSpacing:3}}>CREDA</div>
          <div style={{fontSize:10,color:"rgba(200,146,10,0.7)",letterSpacing:3,textTransform:"uppercase"}}>Finance</div>
          <div style={{fontSize:11,color:DIM,marginTop:4}}>RC-9566021 · Ogbomoso, Oyo State</div>
        </div>
        <div style={{background:CARD,border:`1px solid ${LINE}`,borderRadius:20,padding:"28px 24px",boxShadow:"0 20px 60px rgba(0,0,0,0.4)"}}>
          <div style={{fontSize:18,fontWeight:700,color:INK,marginBottom:4}}>Welcome Back</div>
          <div style={{fontSize:12,color:DIM,marginBottom:22}}>Sign in with your account</div>
          <Fld label="Username"><input style={IS} value={uname} onChange={e=>setUname(e.target.value)} onKeyDown={e=>e.key==="Enter"&&doLogin()} placeholder="Enter username" autoFocus/></Fld>
          <Fld label="Password"><input type="password" style={IS} value={pwd} onChange={e=>setPwd(e.target.value)} onKeyDown={e=>e.key==="Enter"&&doLogin()} placeholder="Enter password"/></Fld>
          {err&&<div style={{background:"rgba(248,113,113,0.1)",border:"1px solid rgba(248,113,113,0.2)",borderRadius:8,padding:"8px 12px",fontSize:12,color:RED,marginBottom:14}}>{err}</div>}
          <GBtn onClick={doLogin} full style={{padding:"13px",fontSize:14,opacity:busy?0.7:1}}>{busy?"Signing in…":"Sign In →"}</GBtn>
        </div>
        <div style={{textAlign:"center",fontSize:11,color:DIM,marginTop:14}}>☁️ Powered by Firebase · Syncs across all phones</div>
      </div>
    </div>
  );
}

// ─── MAIN APP ─────────────────────────────────────────────────────────────────
export default function App(){
  const[user,setUser]=useState(null);
  const[clients,setClients]=useState([]);
  const[monthly,setMonthly]=useState({});
  const[savings,setSavings]=useState({});
  const[users,setUsers]=useState(DEFAULT_USERS);
  const[pending,setPending]=useState([]);
  const[loading,setLoading]=useState(true);
  const[sync,setSync]=useState("offline");
  const[view,setView]=useState("dash");
  const[selId,setSelId]=useState(null);
  const[ptab,setPtab]=useState("schedule");
  const[atab,setAtab]=useState("overview");

  // modals
  const[mAddClient,setMAddClient]=useState(false);
  const[mAddLoan,setMAddLoan]=useState(false);
  const[mPay,setMPay]=useState(null);
  const[mSav,setMSav]=useState(null);
  const[mSettings,setMSettings]=useState(false);
  const[mAddUser,setMAddUser]=useState(false);
  const[mResetPwd,setMResetPwd]=useState(null);
  const[mDel,setMDel]=useState(null);
  const[payAmt,setPayAmt]=useState("");
  const[savAmt,setSavAmt]=useState("");
  const[savNote,setSavNote]=useState("");
  const[savType,setSavType]=useState("deposit");

  const[nc,setNc]=useState({name:"",phone:"",address:"",idNumber:"",union:""});
  const[nl,setNl]=useState({principal:"",rate:"15",days:"20",start:new Date().toISOString().split("T")[0]});
  const[nu,setNu]=useState({name:"",username:"",password:""});

  const today=new Date(), todayStr=today.toISOString().split("T")[0];
  const curMonth=mk(today);
  const isAdmin=user?.role==="admin";

  // ── FIREBASE LISTENERS ────────────────────────────────────────────────────
  useEffect(()=>{
    setSync("syncing");
    fbGet("users").then(u=>{ if(!u) fbSet("users",DEFAULT_USERS); });
    const unsubs=[
      fbListen("clients",  v=>{ setClients(v||[]); }),
      fbListen("monthly",  v=>{ setMonthly(v||{}); }),
      fbListen("savings",  v=>{ setSavings(v||{}); }),
      fbListen("users",    v=>{ setUsers(v||DEFAULT_USERS); }),
      fbListen("pending",  v=>{ setPending(v||[]); }),
    ];
    setTimeout(()=>{ setLoading(false); setSync("synced"); },1800);
    return()=>unsubs.forEach(u=>u());
  },[]);

  // ── SAVE WRAPPERS ─────────────────────────────────────────────────────────
  const sc=async v=>{ setClients(v);  setSync("syncing"); await fbSet("clients",v);  setSync("synced"); };
  const sm=async v=>{ setMonthly(v);  setSync("syncing"); await fbSet("monthly",v);  setSync("synced"); };
  const ss=async v=>{ setSavings(v);  setSync("syncing"); await fbSet("savings",v);  setSync("synced"); };
  const su=async v=>{ setUsers(v);    setSync("syncing"); await fbSet("users",v);    setSync("synced"); };
  const sp=async v=>{ setPending(v);  setSync("syncing"); await fbSet("pending",v);  setSync("synced"); };

  // ── COMPUTED ──────────────────────────────────────────────────────────────
  const myClients=useMemo(()=>isAdmin?clients:clients.filter(c=>c.assignedTo===user?.id),[clients,user,isAdmin]);
  const selClient=clients.find(c=>c.id===selId);
  const curMonthData=monthly[curMonth]||{loans:[],totalDisbursed:0,totalInterest:0,clientIds:[]};
  const myPending=isAdmin?pending:pending.filter(p=>p.requestedBy===user?.id);

  const stats=useMemo(()=>{
    let disbursed=0,expected=0,collected=0,overdue=0,active=0;
    myClients.forEach(c=>c.loans?.forEach(l=>{
      disbursed+=l.principal; expected+=l.total||0;
      if(l.status==="active") active++;
      l.schedule?.forEach(s=>{ if(s.paid) collected+=s.paidAmount; else if(new Date(s.dueDate)<today) overdue++; });
    }));
    const totalSav=Object.values(savings).reduce((a,s)=>a+(s.balance||0),0);
    return{disbursed,expected,collected,overdue,active,totalSav,outstanding:expected-collected};
  },[myClients,savings]);

  // ── MONTHLY RECORD ────────────────────────────────────────────────────────
  function recMonth(loan,cId,cName){
    const k=mk(new Date(loan.startDate));
    const m={...monthly};
    if(!m[k]) m[k]={loans:[],totalDisbursed:0,totalInterest:0,clientIds:[]};
    m[k].loans.push({loanId:loan.id,clientId:cId,clientName:cName,principal:loan.principal,interestRate:loan.interestRate,totalRepayable:loan.total,interest:loan.interest,days:loan.days,startDate:loan.startDate});
    m[k].totalDisbursed+=loan.principal;
    m[k].totalInterest+=loan.interest;
    m[k].clientIds=[...new Set([...(m[k].clientIds||[]),cId])];
    sm(m);
  }

  // ── ACTIONS ───────────────────────────────────────────────────────────────
  function doAddClient(){
    if(!nc.name.trim()||!nc.phone.trim()) return;
    sc([{...nc,id:uid("CL"),loans:[],createdAt:todayStr,assignedTo:user?.id,assignedName:user?.name},...clients]);
    setNc({name:"",phone:"",address:"",idNumber:"",union:""});
    setMAddClient(false);
  }

  function doLoan(){
    if(!nl.principal||!selId) return;
    const p=parseFloat(nl.principal),r=parseFloat(nl.rate),d=parseInt(nl.days);
    const calc=calcLoan(p,r,d,nl.start);
    if(isAdmin){
      const loan={id:uid("LN"),principal:p,interestRate:r,days:d,startDate:nl.start,...calc,status:"active",issuedAt:new Date().toISOString()};
      sc(clients.map(c=>c.id===selId?{...c,loans:[...c.loans,loan]}:c));
      recMonth(loan,selId,selClient?.name);
    } else {
      sp([...pending,{id:uid("REQ"),clientId:selId,clientName:selClient?.name,requestedBy:user?.id,requestedByName:user?.name,principal:p,interestRate:r,days:d,startDate:nl.start,...calc,requestedAt:new Date().toISOString()}]);
    }
    setNl({principal:"",rate:"15",days:"20",start:todayStr});
    setMAddLoan(false);
  }

  function doApprove(req){
    const calc=calcLoan(req.principal,req.interestRate,req.days,req.startDate);
    const loan={id:uid("LN"),principal:req.principal,interestRate:req.interestRate,days:req.days,startDate:req.startDate,...calc,status:"active",issuedAt:new Date().toISOString(),requestedBy:req.requestedBy};
    sc(clients.map(c=>c.id===req.clientId?{...c,loans:[...c.loans,loan]}:c));
    recMonth(loan,req.clientId,req.clientName);
    sp(pending.filter(p=>p.id!==req.id));
  }

  function doReject(id){ sp(pending.filter(p=>p.id!==id)); }

  function doPay(){
    const amt=parseFloat(payAmt);
    if(!amt||!mPay) return;
    const{cId,lId,idx}=mPay;
    sc(clients.map(c=>{
      if(c.id!==cId) return c;
      return{...c,loans:c.loans.map(l=>{
        if(l.id!==lId) return l;
        const sch=l.schedule.map((s,i)=>i===idx?{...s,paid:true,paidDate:todayStr,paidAmount:amt,by:user?.name}:s);
        let run=l.total||0;
        const rec=sch.map(s=>{ if(s.paid) run=Math.max(0,run-s.paidAmount); return{...s,balance:run}; });
        return{...l,schedule:rec,status:rec.every(s=>s.paid)?"completed":"active"};
      })};
    }));
    setPayAmt(""); setMPay(null);
  }

  function doSavings(){
    const amt=parseFloat(savAmt);
    if(!amt||!mSav) return;
    const{cId}=mSav;
    const s={...savings};
    if(!s[cId]) s[cId]={balance:0,transactions:[]};
    const delta=savType==="deposit"?amt:-amt;
    const newBal=Math.max(0,s[cId].balance+delta);
    s[cId].transactions.push({id:uid("SV"),type:savType,amount:amt,note:savNote,date:todayStr,after:newBal,by:user?.name});
    s[cId].balance=newBal;
    ss(s);
    setSavAmt(""); setSavNote(""); setSavType("deposit"); setMSav(null);
  }

  function doAddUser(){
    if(!nu.name||!nu.username||!nu.password) return;
    if(users.find(u=>u.username===nu.username)){ alert("Username already exists!"); return; }
    su([...users,{...nu,id:uid("USR"),role:"officer",createdAt:todayStr,active:true}]);
    setNu({name:"",username:"",password:""});
    setMAddUser(false);
  }

  function doDeleteClient(id){ sc(clients.filter(c=>c.id!==id)); setMDel(null); setView("clients"); }

  function exportBackup(){
    const blob=new Blob([JSON.stringify({clients,monthly,savings,users,pending,v:"4.1",at:new Date().toISOString()},null,2)],{type:"application/json"});
    const url=URL.createObjectURL(blob), a=document.createElement("a");
    a.href=url; a.download=`creda_backup_${todayStr}.json`; a.click(); URL.revokeObjectURL(url);
  }

  // ── LOADING ───────────────────────────────────────────────────────────────
  if(loading) return(
    <div style={{minHeight:"100vh",background:BG,display:"flex",alignItems:"center",justifyContent:"center",flexDirection:"column",gap:14}}>
      <div style={{width:60,height:60,borderRadius:16,background:`linear-gradient(135deg,${G},${GM})`,border:"2px solid rgba(200,146,10,0.4)",display:"flex",alignItems:"center",justifyContent:"center"}}>
        <svg width="32" height="32" viewBox="0 0 80 80" fill="none"><path d="M48 22A19 19 0 1 0 48 58" stroke="white" strokeWidth="5.5" strokeLinecap="round" fill="none"/><path d="M42 30L53 20L64 30" stroke="#c8920a" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" fill="none"/><line x1="53" y1="20" x2="53" y2="44" stroke="#c8920a" strokeWidth="4" strokeLinecap="round"/></svg>
      </div>
      <div style={{color:INK,fontSize:16,fontWeight:700,fontFamily:"serif",letterSpacing:2}}>CREDA Finance</div>
      <div style={{color:DIM,fontSize:12}}>Connecting to cloud…</div>
    </div>
  );

  if(!user) return <Login onLogin={setUser}/>;

  // ── ADMIN PANEL ───────────────────────────────────────────────────────────
  const AdminPanel=()=>(
    <div>
      <div style={{marginBottom:14}}>
        <h1 style={{margin:0,fontSize:22,fontWeight:800,color:INK}}>Admin Panel</h1>
        <p style={{margin:"2px 0 0",color:DIM,fontSize:12}}>CREDA Finance · RC-9566021</p>
      </div>

      <div style={{display:"flex",gap:3,marginBottom:14,background:"rgba(255,255,255,0.03)",borderRadius:12,padding:3,overflowX:"auto"}}>
        {[["overview","📊 Overview"],["staff","👥 Staff"],["pending",`⏳ Loans${pending.length>0?` (${pending.length})`:""}`],["monthly","📅 Monthly"]].map(([t,l])=>(
          <button key={t} onClick={()=>setAtab(t)} style={{flex:1,minWidth:70,padding:"8px 4px",borderRadius:9,border:"none",cursor:"pointer",background:atab===t?"rgba(100,180,255,0.12)":"transparent",color:atab===t?"#93c5fd":DIM,fontWeight:600,fontSize:11,whiteSpace:"nowrap"}}>{l}</button>
        ))}
      </div>

      {/* OVERVIEW */}
      {atab==="overview"&&<>
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10,marginBottom:12}}>
          <Card label="Total Disbursed" value={fc(stats.disbursed)} accent={BLUE}/>
          <Card label="Total Collected" value={fc(stats.collected)} accent={G}/>
          <Card label="Outstanding" value={fc(stats.outstanding)} accent={GOLD}/>
          <Card label="Total Savings" value={fc(stats.totalSav)} accent={PURPLE}/>
        </div>

        <div style={{background:"rgba(10,92,54,0.1)",border:"1px solid rgba(10,92,54,0.25)",borderRadius:14,padding:"14px",marginBottom:12}}>
          <div style={{fontSize:13,fontWeight:700,color:G,marginBottom:10}}>📅 {mlabel(curMonth)}</div>
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:8}}>
            {[["Disbursed",fc(curMonthData.totalDisbursed),BLUE],["Interest",fc(curMonthData.totalInterest),GOLD],["Clients",curMonthData.clientIds?.length||0,PURPLE]].map(([l,v,c])=>(
              <div key={l} style={{background:"rgba(255,255,255,0.04)",borderRadius:8,padding:"8px 10px"}}>
                <div style={{fontSize:9,color:DIM,letterSpacing:1,textTransform:"uppercase"}}>{l}</div>
                <div style={{fontSize:14,fontWeight:800,color:c,fontFamily:"monospace"}}>{v}</div>
              </div>
            ))}
          </div>
        </div>

        <div style={{fontSize:13,fontWeight:700,color:"#c8dde8",marginBottom:10}}>Staff Performance</div>
        {users.filter(u=>u.role!=="admin"&&u.active).length===0
          ?<div style={{textAlign:"center",padding:24,color:DIM,border:`1px dashed ${LINE}`,borderRadius:12,fontSize:13}}>No staff yet. Add from Staff tab.</div>
          :users.filter(u=>u.role!=="admin"&&u.active).map(u=>{
            const sc2=clients.filter(c=>c.assignedTo===u.id);
            const col=sc2.reduce((a,c)=>a+(c.loans?.flatMap(l=>l.schedule||[]).filter(s=>s.paid).reduce((x,s)=>x+s.paidAmount,0)||0),0);
            return(
              <div key={u.id} style={{background:"rgba(255,255,255,0.025)",border:`1px solid ${LINE}`,borderRadius:12,padding:"12px 14px",marginBottom:8,display:"flex",justifyContent:"space-between",alignItems:"center"}}>
                <div style={{display:"flex",gap:10,alignItems:"center"}}>
                  <div style={{width:36,height:36,borderRadius:10,background:`linear-gradient(135deg,${G},${GM})`,display:"flex",alignItems:"center",justifyContent:"center",fontWeight:800,fontSize:15,color:"#fff"}}>{u.name.charAt(0)}</div>
                  <div>
                    <div style={{fontWeight:700,color:INK,fontSize:13}}>{u.name}</div>
                    <div style={{fontSize:10,color:DIM}}>@{u.username} · {sc2.length} clients</div>
                  </div>
                </div>
                <div style={{textAlign:"right"}}>
                  <div style={{fontSize:13,color:BLUE,fontFamily:"monospace",fontWeight:700}}>{fc(col)}</div>
                  <div style={{fontSize:10,color:DIM}}>{sc2.reduce((a,c)=>a+(c.loans?.filter(l=>l.status==="active").length||0),0)} active loans</div>
                </div>
              </div>
            );
          })
        }
      </>}

      {/* STAFF */}
      {atab==="staff"&&<>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:14}}>
          <div style={{fontSize:13,fontWeight:700,color:"#c8dde8"}}>Staff Accounts ({users.filter(u=>u.role!=="admin").length})</div>
          <GBtn onClick={()=>setMAddUser(true)} style={{padding:"8px 14px",fontSize:12}}>+ Add Staff</GBtn>
        </div>
        {users.map(u=>{
          const sc2=clients.filter(c=>c.assignedTo===u.id);
          return(
            <div key={u.id} style={{background:"rgba(255,255,255,0.025)",border:`1px solid ${LINE}`,borderRadius:13,padding:"14px",marginBottom:10}}>
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:10}}>
                <div style={{display:"flex",gap:10,alignItems:"center"}}>
                  <div style={{width:42,height:42,borderRadius:12,background:u.role==="admin"?`linear-gradient(135deg,${GOLD},#a07010)`:`linear-gradient(135deg,${G},${GM})`,display:"flex",alignItems:"center",justifyContent:"center",fontWeight:800,fontSize:17,color:"#fff"}}>{u.name.charAt(0)}</div>
                  <div>
                    <div style={{fontWeight:700,color:INK}}>{u.name}</div>
                    <div style={{fontSize:11,color:DIM}}>@{u.username} · Joined {fd(u.createdAt)}</div>
                  </div>
                </div>
                <div style={{display:"flex",flexDirection:"column",gap:4,alignItems:"flex-end"}}>
                  <Badge label={u.role==="admin"?"Admin":"Officer"} color={u.role==="admin"?GOLD:"#4ade80"} bg={u.role==="admin"?"rgba(200,146,10,0.12)":"rgba(34,197,94,0.12)"}/>
                  <Badge label={u.active?"Active":"Inactive"} color={u.active?"#4ade80":RED} bg={u.active?"rgba(34,197,94,0.1)":"rgba(248,113,113,0.1)"}/>
                </div>
              </div>
              <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8,marginBottom:u.id!=="admin_001"?10:0}}>
                <div style={{background:"rgba(255,255,255,0.04)",borderRadius:8,padding:"8px 10px"}}><div style={{fontSize:9,color:DIM}}>CLIENTS</div><div style={{fontSize:16,fontWeight:800,color:BLUE}}>{sc2.length}</div></div>
                <div style={{background:"rgba(255,255,255,0.04)",borderRadius:8,padding:"8px 10px"}}><div style={{fontSize:9,color:DIM}}>ACTIVE LOANS</div><div style={{fontSize:16,fontWeight:800,color:G}}>{sc2.reduce((a,c)=>a+(c.loans?.filter(l=>l.status==="active").length||0),0)}</div></div>
              </div>
              {u.id!=="admin_001"&&(
                <div style={{display:"flex",gap:8}}>
                  <button onClick={()=>su(users.map(x=>x.id===u.id?{...x,active:!x.active}:x))} style={{flex:1,background:u.active?"rgba(248,113,113,0.1)":"rgba(34,197,94,0.1)",border:`1px solid ${u.active?"rgba(248,113,113,0.2)":"rgba(34,197,94,0.2)"}`,color:u.active?RED:"#4ade80",padding:"8px",borderRadius:9,cursor:"pointer",fontWeight:600,fontSize:12}}>{u.active?"Deactivate":"Activate"}</button>
                  <button onClick={()=>setMResetPwd(u)} style={{flex:1,background:"rgba(96,165,250,0.1)",border:"1px solid rgba(96,165,250,0.2)",color:BLUE,padding:"8px",borderRadius:9,cursor:"pointer",fontWeight:600,fontSize:12}}>Reset Password</button>
                </div>
              )}
            </div>
          );
        })}
      </>}

      {/* PENDING LOANS */}
      {atab==="pending"&&<>
        <div style={{fontSize:13,fontWeight:700,color:"#c8dde8",marginBottom:14}}>Pending Approvals ({pending.length})</div>
        {pending.length===0
          ?<div style={{textAlign:"center",padding:40,color:DIM,border:`1px dashed ${LINE}`,borderRadius:14}}><div style={{fontSize:32,marginBottom:8}}>✅</div><div>No pending requests</div></div>
          :pending.map(req=>(
            <div key={req.id} style={{background:"rgba(255,255,255,0.025)",border:"1px solid rgba(200,146,10,0.2)",borderRadius:13,padding:"14px",marginBottom:10}}>
              <div style={{display:"flex",justifyContent:"space-between",marginBottom:10}}>
                <div><div style={{fontWeight:700,color:INK}}>{req.clientName}</div><div style={{fontSize:11,color:DIM}}>By {req.requestedByName} · {fd(req.requestedAt)}</div></div>
                <Badge label="Pending" color={GOLD} bg="rgba(200,146,10,0.12)"/>
              </div>
              <div style={{display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:8,marginBottom:12}}>
                {[["Principal",fc(req.principal),BLUE],["Daily",fc(req.daily),G],["Total",fc(req.total),INK],["Days",req.days+"d",PURPLE],["Rate",req.interestRate+"%",GOLD],["Start",fd(req.startDate),SOFT]].map(([l,v,c])=>(
                  <div key={l} style={{background:"rgba(255,255,255,0.04)",borderRadius:8,padding:"6px 10px"}}><div style={{fontSize:9,color:DIM}}>{l}</div><div style={{fontSize:12,fontWeight:700,color:c,fontFamily:"monospace"}}>{v}</div></div>
                ))}
              </div>
              <div style={{display:"flex",gap:8}}>
                <button onClick={()=>doApprove(req)} style={{flex:1,background:`linear-gradient(135deg,${G},${GM})`,border:"none",color:"#000",padding:"10px",borderRadius:10,cursor:"pointer",fontWeight:700,fontSize:13}}>✓ Approve</button>
                <button onClick={()=>doReject(req.id)} style={{flex:1,background:"rgba(248,113,113,0.1)",border:"1px solid rgba(248,113,113,0.2)",color:RED,padding:"10px",borderRadius:10,cursor:"pointer",fontWeight:700,fontSize:13}}>✕ Reject</button>
              </div>
            </div>
          ))
        }
      </>}

      {/* MONTHLY */}
      {atab==="monthly"&&<>
        <div style={{background:"rgba(10,92,54,0.1)",border:"1px solid rgba(10,92,54,0.2)",borderRadius:14,padding:"14px",marginBottom:14}}>
          <div style={{fontSize:11,fontWeight:700,color:G,marginBottom:10,letterSpacing:1}}>ALL-TIME TOTALS</div>
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10}}>
            {[["Disbursed",fc(stats.disbursed),BLUE],["Collected",fc(stats.collected),G],["Interest",fc(Object.values(monthly).reduce((a,m)=>a+(m.totalInterest||0),0)),GOLD],["Outstanding",fc(stats.outstanding),RED]].map(([l,v,c])=>(
              <div key={l} style={{background:"rgba(255,255,255,0.04)",borderRadius:9,padding:"10px 12px"}}><div style={{fontSize:9,color:DIM,marginBottom:2}}>{l}</div><div style={{fontSize:14,fontWeight:800,color:c,fontFamily:"monospace"}}>{v}</div></div>
            ))}
          </div>
        </div>
        {Object.keys(monthly).sort().reverse().map(k=>{
          const d=monthly[k];
          return(
            <div key={k} style={{background:"rgba(255,255,255,0.025)",border:`1px solid ${LINE}`,borderRadius:14,overflow:"hidden",marginBottom:12}}>
              <div style={{background:"rgba(10,92,54,0.3)",padding:"12px 16px",display:"flex",justifyContent:"space-between"}}>
                <div style={{fontSize:14,fontWeight:700,color:INK}}>{mlabel(k)}</div>
                <div style={{textAlign:"right"}}><div style={{fontSize:13,fontWeight:800,color:BLUE,fontFamily:"monospace"}}>{fc(d.totalDisbursed)}</div><div style={{fontSize:10,color:GOLD}}>+{fc(d.totalInterest)}</div></div>
              </div>
              {d.loans?.map((ln,i)=>(
                <div key={i} style={{display:"flex",justifyContent:"space-between",padding:"8px 16px",borderBottom:`1px solid ${LINE}`}}>
                  <div><div style={{fontSize:12,color:INK,fontWeight:600}}>{ln.clientName}</div><div style={{fontSize:10,color:DIM}}>{ln.days}d · {ln.interestRate}%</div></div>
                  <div style={{textAlign:"right"}}><div style={{fontSize:13,color:BLUE,fontFamily:"monospace",fontWeight:700}}>{fc(ln.principal)}</div><div style={{fontSize:10,color:GOLD}}>+{fc(ln.interest)}</div></div>
                </div>
              ))}
            </div>
          );
        })}
        {Object.keys(monthly).length===0&&<div style={{textAlign:"center",padding:40,color:DIM,border:`1px dashed ${LINE}`,borderRadius:14}}>No monthly records yet.</div>}
      </>}
    </div>
  );

  // ── OFFICER DASHBOARD ─────────────────────────────────────────────────────
  const OfficerDash=()=>(
    <div>
      <div style={{marginBottom:14}}>
        <h1 style={{margin:0,fontSize:22,fontWeight:800,color:INK}}>My Dashboard</h1>
        <p style={{margin:"2px 0 0",color:DIM,fontSize:12}}>{user?.name} · Loan Officer</p>
      </div>
      {myPending.length>0&&(
        <div style={{background:"rgba(200,146,10,0.1)",border:"1px solid rgba(200,146,10,0.25)",borderRadius:12,padding:"10px 14px",marginBottom:12,display:"flex",gap:10,alignItems:"center"}}>
          <span>⏳</span><div style={{fontSize:12,fontWeight:700,color:GOLD}}>{myPending.length} Loan Request{myPending.length>1?"s":""} Awaiting Admin Approval</div>
        </div>
      )}
      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10,marginBottom:14}}>
        <Card label="My Clients" value={myClients.length} accent={BLUE}/>
        <Card label="Active Loans" value={stats.active} accent={G}/>
        <Card label="Collected" value={fc(stats.collected)} accent={PURPLE}/>
        <Card label="Overdue" value={stats.overdue} accent={RED}/>
      </div>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:12}}>
        <div style={{fontSize:13,fontWeight:700,color:"#c8dde8"}}>My Clients</div>
        <button onClick={()=>setView("clients")} style={{background:"none",border:"none",color:BLUE,fontSize:12,cursor:"pointer"}}>See all →</button>
      </div>
      {myClients.length===0
        ?<div style={{border:`1px dashed ${LINE}`,borderRadius:14,padding:40,textAlign:"center",color:DIM}}><div style={{fontSize:36,marginBottom:10}}>💳</div><div style={{marginBottom:14}}>No clients yet</div><GBtn onClick={()=>setMAddClient(true)}>+ Add First Client</GBtn></div>
        :myClients.slice(0,6).map(c=>{
          const al=c.loans?.find(l=>l.status==="active");
          const od=al?.schedule?.filter(s=>!s.paid&&new Date(s.dueDate)<today).length||0;
          return(
            <div key={c.id} onClick={()=>{setSelId(c.id);setView("detail");}} style={{background:"rgba(255,255,255,0.025)",border:`1px solid ${LINE}`,borderRadius:12,padding:"12px 15px",cursor:"pointer",display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:8}}>
              <div style={{display:"flex",alignItems:"center",gap:10}}>
                <div style={{width:36,height:36,borderRadius:10,background:"linear-gradient(135deg,#1d4ed8,#3b82f6)",display:"flex",alignItems:"center",justifyContent:"center",fontWeight:800,fontSize:15,color:"#fff"}}>{c.name.charAt(0).toUpperCase()}</div>
                <div><div style={{fontWeight:600,color:INK,fontSize:14}}>{c.name}</div><div style={{fontSize:10,color:DIM}}>{c.phone}</div></div>
              </div>
              <div style={{textAlign:"right"}}>
                {al?<div style={{fontSize:12,fontWeight:700,color:od>0?RED:BLUE,fontFamily:"monospace"}}>{fc(al.schedule.find(s=>!s.paid)?.balance??0)}</div>:<div style={{fontSize:11,color:DIM}}>No loan</div>}
              </div>
            </div>
          );
        })
      }
    </div>
  );

  // ── CLIENTS LIST ──────────────────────────────────────────────────────────
  const ClientsList=()=>(
    <div>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:18}}>
        <h1 style={{margin:0,fontSize:22,fontWeight:800,color:INK}}>{isAdmin?"All Clients":"My Clients"}</h1>
        <GBtn onClick={()=>setMAddClient(true)} style={{padding:"9px 16px",fontSize:13}}>+ New</GBtn>
      </div>
      {myClients.length===0
        ?<div style={{textAlign:"center",padding:60,color:DIM,border:`1px dashed ${LINE}`,borderRadius:14}}><div style={{fontSize:36,marginBottom:10}}>👤</div><div>No clients yet.</div></div>
        :myClients.map(c=>{
          const al=c.loans?.find(l=>l.status==="active");
          const paid=al?.schedule?.filter(s=>s.paid).length||0;
          const tot=al?.schedule?.length||0;
          const od=al?.schedule?.filter(s=>!s.paid&&new Date(s.dueDate)<today).length||0;
          const sav=savings[c.id]?.balance||0;
          return(
            <div key={c.id} onClick={()=>{setSelId(c.id);setView("detail");}} style={{background:"rgba(255,255,255,0.025)",border:`1px solid ${LINE}`,borderRadius:13,padding:"14px 16px",cursor:"pointer",marginBottom:9}}>
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:al?10:0}}>
                <div style={{display:"flex",gap:10,alignItems:"center"}}>
                  <div style={{width:40,height:40,borderRadius:11,background:"linear-gradient(135deg,#1e3a5f,#2563eb)",display:"flex",alignItems:"center",justifyContent:"center",fontWeight:800,fontSize:16,color:"#93c5fd"}}>{c.name.charAt(0).toUpperCase()}</div>
                  <div>
                    <div style={{fontWeight:700,color:INK,fontSize:14}}>{c.name}</div>
                    <div style={{fontSize:11,color:DIM}}>{c.phone}{c.union?` · ${c.union}`:""}</div>
                    {isAdmin&&<div style={{fontSize:10,color:GOLD}}>👤 {c.assignedName||"Unassigned"}</div>}
                  </div>
                </div>
                <div style={{textAlign:"right"}}>
                  <Badge label={al?"Active":c.loans?.length>0?"Done":"No Loan"} color={al?"#4ade80":DIM} bg={al?"rgba(34,197,94,0.12)":"rgba(100,130,150,0.08)"}/>
                  {sav>0&&<div style={{fontSize:10,color:PURPLE,marginTop:3}}>💰 {fc(sav)}</div>}
                </div>
              </div>
              {al&&(
                <div>
                  <div style={{display:"flex",justifyContent:"space-between",fontSize:11,color:DIM,marginBottom:5}}><span>{paid}/{tot} payments</span><span style={{color:od>0?RED:"#3a6050"}}>{od>0?`${od} overdue`:"On track ✓"}</span></div>
                  <div style={{height:3,background:"rgba(255,255,255,0.06)",borderRadius:4,overflow:"hidden"}}><div style={{height:"100%",width:`${tot>0?(paid/tot)*100:0}%`,background:"linear-gradient(90deg,#22c55e,#4ade80)",borderRadius:4}}/></div>
                </div>
              )}
            </div>
          );
        })
      }
    </div>
  );

  // ── CLIENT DETAIL ─────────────────────────────────────────────────────────
  const Detail=()=>{
    if(!selClient) return null;
    const c=clients.find(x=>x.id===selId)||selClient;
    if(!isAdmin&&c.assignedTo!==user?.id) return <div style={{textAlign:"center",padding:60,color:DIM}}><div style={{fontSize:36,marginBottom:10}}>🔒</div><div>Access denied.</div></div>;
    const al=c.loans?.find(l=>l.status==="active");
    const cSav=savings[c.id]||{balance:0,transactions:[]};
    const hasPending=pending.some(p=>p.clientId===c.id);
    return(
      <div>
        <div style={{display:"flex",alignItems:"center",gap:12,marginBottom:18}}>
          <button onClick={()=>setView("clients")} style={{background:"rgba(255,255,255,0.06)",border:"none",color:SOFT,width:34,height:34,borderRadius:9,cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center"}}>
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="15 18 9 12 15 6"/></svg>
          </button>
          <div style={{width:44,height:44,borderRadius:12,background:"linear-gradient(135deg,#1d4ed8,#3b82f6)",display:"flex",alignItems:"center",justifyContent:"center",fontWeight:800,fontSize:18,color:"#fff"}}>{c.name.charAt(0).toUpperCase()}</div>
          <div>
            <div style={{fontSize:18,fontWeight:800,color:INK}}>{c.name}</div>
            <div style={{fontSize:11,color:DIM}}>{c.id} · Joined {fd(c.createdAt)}{isAdmin?` · ${c.assignedName||"Unassigned"}`:""}</div>
          </div>
        </div>

        {/* Info */}
        <div style={{background:"rgba(100,180,255,0.04)",border:"1px solid rgba(100,180,255,0.08)",borderRadius:13,padding:"14px 16px",marginBottom:14,display:"grid",gridTemplateColumns:"1fr 1fr",gap:10}}>
          {[["PHONE",c.phone||"—"],["ID/BVN",c.idNumber||"—"],["UNION",c.union||"—"]].map(([l,v])=>(
            <div key={l}><div style={{fontSize:9,color:DIM,marginBottom:2}}>{l}</div><div style={{color:INK,fontSize:13}}>{v}</div></div>
          ))}
          <div style={{gridColumn:"1/-1"}}><div style={{fontSize:9,color:DIM,marginBottom:2}}>ADDRESS</div><div style={{color:INK,fontSize:13}}>{c.address||"—"}</div></div>
        </div>

        {/* Savings */}
        <div style={{background:"linear-gradient(135deg,rgba(196,181,253,0.1),rgba(139,92,246,0.06))",border:"1px solid rgba(196,181,253,0.2)",borderRadius:14,padding:"14px 16px",marginBottom:14}}>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:cSav.transactions.length>0?10:0}}>
            <div>
              <div style={{fontSize:9,color:PURPLE,fontWeight:700,letterSpacing:1,textTransform:"uppercase",marginBottom:2}}>Savings Balance</div>
              <div style={{fontSize:22,fontWeight:800,color:"#c4b5fd",fontFamily:"monospace"}}>{fc(cSav.balance)}</div>
            </div>
            <button onClick={()=>setMSav({cId:c.id})} style={{background:"rgba(196,181,253,0.18)",border:"1px solid rgba(196,181,253,0.3)",color:"#c4b5fd",padding:"8px 14px",borderRadius:9,cursor:"pointer",fontWeight:700,fontSize:12}}>+ / - Savings</button>
          </div>
          {cSav.transactions.slice(-3).reverse().map(t=>(
            <div key={t.id} style={{display:"flex",justifyContent:"space-between",fontSize:11,borderTop:"1px solid rgba(196,181,253,0.1)",paddingTop:6,marginTop:6}}>
              <span style={{color:SOFT}}>{t.type==="deposit"?"📥":"📤"} {t.note||t.type} · {fd(t.date)}</span>
              <span style={{color:t.type==="deposit"?"#4ade80":RED}}>{t.type==="deposit"?"+":"-"}{fc(t.amount)}</span>
            </div>
          ))}
        </div>

        {/* Loan section */}
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:12}}>
          <div style={{fontSize:15,fontWeight:700,color:"#c8dde8"}}>{al?"Active Loan":"Loans"}</div>
          {!al&&!hasPending&&<GBtn onClick={()=>setMAddLoan(true)} style={{padding:"7px 15px",fontSize:12}}>{isAdmin?"+ Issue Loan":"+ Request Loan"}</GBtn>}
          {hasPending&&<Badge label="⏳ Pending Approval" color={GOLD} bg="rgba(200,146,10,0.12)"/>}
        </div>

        {!isAdmin&&!al&&!hasPending&&(
          <div style={{background:"rgba(200,146,10,0.06)",border:"1px solid rgba(200,146,10,0.15)",borderRadius:10,padding:"10px 13px",marginBottom:12,fontSize:12,color:SOFT}}>
            ℹ️ Tap "Request Loan" — Admin will review and approve before disbursement.
          </div>
        )}

        {al?(
          <>
            <div style={{background:"linear-gradient(135deg,rgba(34,197,94,0.07),rgba(59,130,246,0.05))",border:"1px solid rgba(34,197,94,0.15)",borderRadius:14,padding:"14px",marginBottom:12}}>
              <div style={{display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:10,marginBottom:12}}>
                {[["Principal",fc(al.principal),"#93c5fd"],["Interest",al.interestRate+"%",PURPLE],["Daily",fc(al.daily),BLUE],["Total",fc(al.total),INK],["Balance",fc(al.schedule.find(s=>!s.paid)?.balance??0),RED],["Progress",`${al.schedule.filter(s=>s.paid).length}/${al.days}d`,"#4ade80"]].map(([l,v,col])=>(
                  <div key={l}><div style={{fontSize:9,color:DIM,marginBottom:2}}>{l}</div><div style={{color:col,fontWeight:700,fontSize:12,fontFamily:"monospace"}}>{v}</div></div>
                ))}
              </div>
              <div style={{height:4,background:"rgba(255,255,255,0.06)",borderRadius:4,overflow:"hidden"}}><div style={{height:"100%",borderRadius:4,width:`${(al.schedule.filter(s=>s.paid).length/al.days)*100}%`,background:"linear-gradient(90deg,#22c55e,#4ade80)"}}/></div>
            </div>

            <div style={{display:"flex",gap:3,marginBottom:12,background:"rgba(255,255,255,0.03)",borderRadius:10,padding:3}}>
              {["schedule","history"].map(t=>(
                <button key={t} onClick={()=>setPtab(t)} style={{flex:1,padding:"7px",borderRadius:8,border:"none",cursor:"pointer",background:ptab===t?"rgba(100,180,255,0.1)":"transparent",color:ptab===t?"#93c5fd":DIM,fontWeight:600,fontSize:12,textTransform:"capitalize"}}>{t}</button>
              ))}
            </div>

            {ptab==="schedule"&&al.schedule.map((s,i)=>{
              const od=!s.paid&&new Date(s.dueDate)<today;
              const isNext=!s.paid&&al.schedule.filter(x=>!x.paid)[0]===s;
              const hol=isHoliday(s.dueDate);
              return(
                <div key={i} style={{background:s.paid?"rgba(34,197,94,0.04)":od?"rgba(239,68,68,0.07)":"rgba(255,255,255,0.02)",border:`1px solid ${s.paid?"rgba(34,197,94,0.15)":od?"rgba(239,68,68,0.2)":isNext?"rgba(96,165,250,0.2)":"rgba(100,180,255,0.06)"}`,borderRadius:11,padding:"10px 13px",display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:7}}>
                  <div style={{display:"flex",gap:10,alignItems:"center"}}>
                    <div style={{width:28,height:28,borderRadius:7,fontSize:11,fontWeight:700,display:"flex",alignItems:"center",justifyContent:"center",background:s.paid?"rgba(34,197,94,0.15)":od?"rgba(239,68,68,0.15)":"rgba(255,255,255,0.05)",color:s.paid?"#4ade80":od?RED:DIM}}>{s.paid?"✓":`D${i+1}`}</div>
                    <div>
                      <div style={{display:"flex",gap:4,flexWrap:"wrap",alignItems:"center"}}>
                        <span style={{fontSize:13,fontWeight:600,color:s.paid?"#4ade80":od?RED:INK}}>{fc(al.daily)}</span>
                        {isNext&&<span style={{fontSize:9,padding:"1px 6px",borderRadius:10,background:"rgba(96,165,250,0.15)",color:BLUE,fontWeight:700}}>NEXT</span>}
                        {od&&<span style={{fontSize:9,padding:"1px 6px",borderRadius:10,background:"rgba(239,68,68,0.15)",color:RED,fontWeight:700}}>OVERDUE</span>}
                        {hol&&<span style={{fontSize:9,padding:"1px 6px",borderRadius:10,background:"rgba(232,180,32,0.15)",color:GL,fontWeight:700}}>🎉 HOL</span>}
                      </div>
                      <div style={{fontSize:10,color:DIM,marginTop:1}}>{fd(s.dueDate)}{hol?` · ${hol}`:""}{s.paid?` · Paid by ${s.by||"officer"}`:""}</div>
                    </div>
                  </div>
                  <div style={{textAlign:"right",flexShrink:0}}>
                    <div style={{fontSize:11,color:DIM,marginBottom:4,fontFamily:"monospace"}}>{fc(s.balance)}</div>
                    {!s.paid&&<button onClick={()=>{setMPay({cId:c.id,lId:al.id,idx:i});setPayAmt(al.daily.toFixed(2));}} style={{background:"linear-gradient(135deg,#22c55e,#16a34a)",border:"none",color:"#000",padding:"4px 11px",borderRadius:7,cursor:"pointer",fontWeight:700,fontSize:11}}>Pay</button>}
                  </div>
                </div>
              );
            })}

            {ptab==="history"&&(
              al.schedule.filter(s=>s.paid).length===0
                ?<div style={{textAlign:"center",padding:40,color:DIM}}>No payments yet</div>
                :al.schedule.filter(s=>s.paid).map((s,i)=>(
                  <div key={i} style={{background:"rgba(34,197,94,0.04)",border:"1px solid rgba(34,197,94,0.12)",borderRadius:11,padding:"11px 14px",display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:7}}>
                    <div style={{display:"flex",gap:9,alignItems:"center"}}>
                      <div style={{width:26,height:26,borderRadius:7,background:"rgba(34,197,94,0.15)",display:"flex",alignItems:"center",justifyContent:"center",color:"#4ade80",fontSize:12}}>✓</div>
                      <div><div style={{fontSize:13,color:"#4ade80",fontWeight:600}}>{fc(s.paidAmount)}</div><div style={{fontSize:10,color:DIM}}>{fd(s.paidDate)} · by {s.by||"officer"}</div></div>
                    </div>
                    <div style={{fontSize:11,color:DIM,fontFamily:"monospace"}}>Bal: {fc(s.balance)}</div>
                  </div>
                ))
            )}
          </>
        ):(
          <div style={{border:`1px dashed ${LINE}`,borderRadius:13,padding:40,textAlign:"center",color:DIM}}>
            <div style={{fontSize:32,marginBottom:10}}>💰</div>
            <div style={{fontSize:13}}>{c.loans?.filter(l=>l.status==="completed").length>0?"Previous loans completed. Issue a new one.":"No loan issued yet."}</div>
          </div>
        )}

        {isAdmin&&<button onClick={()=>setMDel(c.id)} style={{marginTop:20,background:"rgba(239,68,68,0.08)",border:"1px solid rgba(239,68,68,0.15)",color:RED,padding:"9px 18px",borderRadius:10,cursor:"pointer",fontWeight:600,fontSize:12}}>🗑️ Delete Client</button>}
      </div>
    );
  };

  // ── RENDER ────────────────────────────────────────────────────────────────
  return(
    <div style={{minHeight:"100vh",background:BG,fontFamily:"'Segoe UI',system-ui,sans-serif",color:INK}}>

      {/* TOP BAR */}
      <div style={{background:"rgba(6,15,26,0.97)",borderBottom:`1px solid ${LINE}`,padding:"10px 16px",display:"flex",justifyContent:"space-between",alignItems:"center",position:"sticky",top:0,zIndex:100,backdropFilter:"blur(10px)"}}>
        <div style={{display:"flex",alignItems:"center",gap:10}}>
          <div style={{width:34,height:34,borderRadius:9,background:`linear-gradient(135deg,${G},${GM})`,border:"1.5px solid rgba(200,146,10,0.4)",display:"flex",alignItems:"center",justifyContent:"center"}}>
            <svg width="18" height="18" viewBox="0 0 80 80" fill="none"><path d="M48 22A19 19 0 1 0 48 58" stroke="white" strokeWidth="5.5" strokeLinecap="round" fill="none"/><path d="M42 30L53 20L64 30" stroke="#c8920a" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" fill="none"/><line x1="53" y1="20" x2="53" y2="44" stroke="#c8920a" strokeWidth="4" strokeLinecap="round"/></svg>
          </div>
          <div>
            <div style={{fontSize:13,fontWeight:800,color:INK,letterSpacing:1,fontFamily:"serif"}}>CREDA</div>
            <div style={{fontSize:7,color:"rgba(200,146,10,0.7)",letterSpacing:2,textTransform:"uppercase",lineHeight:1}}>Finance</div>
          </div>
        </div>
        <div style={{display:"flex",alignItems:"center",gap:8}}>
          <span style={{fontSize:10,color:sync==="synced"?"#4ade80":sync==="syncing"?BLUE:GOLD,fontWeight:600}}>
            {sync==="synced"?"☁️ Synced":sync==="syncing"?"⟳ Syncing…":"⚠️ Offline"}
          </span>
          {pending.length>0&&isAdmin&&<div style={{background:"rgba(200,146,10,0.15)",color:GOLD,fontSize:10,padding:"3px 8px",borderRadius:20,fontWeight:700}}>⏳{pending.length}</div>}
          <div style={{display:"flex",flexDirection:"column",alignItems:"flex-end"}}>
            <div style={{fontSize:11,color:INK,fontWeight:600}}>{user?.name?.split(" ")[0]}</div>
            <div style={{fontSize:9,color:isAdmin?GOLD:G,fontWeight:700,textTransform:"uppercase"}}>{isAdmin?"Admin":"Officer"}</div>
          </div>
          <button onClick={()=>{if(window.confirm("Sign out?")){ setUser(null); setView("dash"); }}} style={{background:"rgba(248,113,113,0.1)",border:"1px solid rgba(248,113,113,0.15)",color:RED,padding:"5px 10px",borderRadius:8,cursor:"pointer",fontSize:10,fontWeight:700}}>Out</button>
          {isAdmin&&<button onClick={()=>setMSettings(true)} style={{background:"rgba(255,255,255,0.06)",border:`1px solid ${LINE}`,color:SOFT,width:28,height:28,borderRadius:8,cursor:"pointer",fontSize:12}}>⚙️</button>}
        </div>
      </div>

      {/* MAIN CONTENT */}
      <div style={{padding:"20px 16px 100px",maxWidth:540,margin:"0 auto"}}>
        {view==="dash"?(isAdmin?<AdminPanel/>:<OfficerDash/>):view==="clients"?<ClientsList/>:view==="detail"?<Detail/>:<OfficerDash/>}
      </div>

      {/* BOTTOM NAV */}
      <div style={{position:"fixed",bottom:0,left:0,right:0,background:"rgba(6,15,26,0.97)",borderTop:`1px solid ${LINE}`,display:"flex",backdropFilter:"blur(12px)"}}>
        {[{id:"dash",label:isAdmin?"Admin":"Dashboard",icon:isAdmin?"🔐":"📊"},{id:"clients",label:"Clients",icon:"👥"}].map(n=>{
          const act=view===n.id||(view==="detail"&&n.id==="clients");
          return <button key={n.id} onClick={()=>setView(n.id)} style={{flex:1,padding:"12px 8px 14px",background:"transparent",border:"none",cursor:"pointer",color:act?"#22c55e":DIM,display:"flex",flexDirection:"column",alignItems:"center",gap:4}}><span style={{fontSize:18}}>{n.icon}</span><span style={{fontSize:10,fontWeight:600}}>{n.label}</span></button>;
        })}
      </div>

      {/* ── MODALS ─────────────────────────────────────────────────────────── */}

      {mAddClient&&(
        <Modal title="Register New Client" onClose={()=>setMAddClient(false)}>
          <Fld label="Full Name *"><input style={IS} value={nc.name} onChange={e=>setNc(p=>({...p,name:e.target.value}))} placeholder="e.g. Amaka Johnson" autoFocus/></Fld>
          <Fld label="Phone Number *"><input style={IS} value={nc.phone} onChange={e=>setNc(p=>({...p,phone:e.target.value}))} placeholder="08012345678"/></Fld>
          <Fld label="Union / Group"><input style={IS} value={nc.union} onChange={e=>setNc(p=>({...p,union:e.target.value}))} placeholder="e.g. Oja-Oba Traders"/></Fld>
          <Fld label="Address"><input style={IS} value={nc.address} onChange={e=>setNc(p=>({...p,address:e.target.value}))} placeholder="Street, City"/></Fld>
          <Fld label="ID / BVN"><input style={IS} value={nc.idNumber} onChange={e=>setNc(p=>({...p,idNumber:e.target.value}))} placeholder="NIN or BVN"/></Fld>
          <div style={{background:"rgba(96,165,250,0.08)",border:"1px solid rgba(96,165,250,0.15)",borderRadius:9,padding:"9px 12px",marginBottom:14,fontSize:12,color:SOFT}}>Assigned to: <strong style={{color:INK}}>{user?.name}</strong></div>
          <GBtn onClick={doAddClient} full style={{padding:"12px"}}>✓ Register Client</GBtn>
        </Modal>
      )}

      {mAddLoan&&(
        <Modal title={isAdmin?"Issue Loan":"Request Loan Approval"} onClose={()=>setMAddLoan(false)}>
          <div style={{background:"rgba(59,130,246,0.08)",border:"1px solid rgba(59,130,246,0.15)",borderRadius:9,padding:"9px 13px",marginBottom:14,fontSize:13,color:"#93c5fd"}}>Client: <strong>{selClient?.name}</strong></div>
          {!isAdmin&&<div style={{background:"rgba(200,146,10,0.08)",border:"1px solid rgba(200,146,10,0.2)",borderRadius:9,padding:"9px 12px",marginBottom:14,fontSize:12,color:GOLD}}>⏳ Admin must approve before loan is disbursed.</div>}
          <Fld label="Principal (₦) *"><input type="number" style={IS} value={nl.principal} onChange={e=>setNl(p=>({...p,principal:e.target.value}))} placeholder="e.g. 50000"/></Fld>
          <Fld label="Interest Rate (% flat)"><input type="number" style={IS} value={nl.rate} onChange={e=>setNl(p=>({...p,rate:e.target.value}))}/></Fld>
          <Fld label="Duration (Working Days)"><input type="number" style={IS} value={nl.days} onChange={e=>setNl(p=>({...p,days:e.target.value}))} placeholder="e.g. 20"/></Fld>
          <Fld label="Start Date"><input type="date" style={IS} value={nl.start} onChange={e=>setNl(p=>({...p,start:e.target.value}))}/></Fld>
          {nl.principal&&(()=>{
            const p=parseFloat(nl.principal)||0,r=parseFloat(nl.rate)||0,d=parseInt(nl.days)||1,total=p+(p*r/100),daily=total/d;
            return(<div style={{background:"rgba(34,197,94,0.06)",border:"1px solid rgba(34,197,94,0.12)",borderRadius:10,padding:"12px",marginBottom:14,display:"grid",gridTemplateColumns:"1fr 1fr",gap:10}}>
              <div><div style={{fontSize:9,color:DIM,marginBottom:2}}>TOTAL REPAYABLE</div><div style={{color:"#4ade80",fontWeight:700,fontFamily:"monospace"}}>{fc(total)}</div></div>
              <div><div style={{fontSize:9,color:DIM,marginBottom:2}}>DAILY PAYMENT</div><div style={{color:BLUE,fontWeight:700,fontFamily:"monospace"}}>{fc(daily)}</div></div>
            </div>);
          })()}
          <GBtn onClick={doLoan} full style={{padding:"12px"}}>{isAdmin?"✓ Issue Loan":"📤 Send for Approval"}</GBtn>
        </Modal>
      )}

      {mPay&&(()=>{
        const cl=clients.find(c=>c.id===mPay.cId);
        const ln=cl?.loans?.find(l=>l.id===mPay.lId);
        return(
          <Modal title="Record Payment" onClose={()=>{setMPay(null);setPayAmt("");}}>
            <div style={{textAlign:"center",marginBottom:20}}>
              <div style={{fontSize:12,color:DIM,marginBottom:4}}>Expected Amount</div>
              <div style={{fontSize:28,fontWeight:800,color:"#4ade80",fontFamily:"monospace"}}>{fc(ln?.daily||0)}</div>
              <div style={{fontSize:11,color:DIM,marginTop:4}}>Day {mPay.idx+1} of {ln?.days} working days</div>
            </div>
            <Fld label="Amount Received (₦)"><input type="number" style={IS} value={payAmt} onChange={e=>setPayAmt(e.target.value)} placeholder="Enter amount" autoFocus/></Fld>
            <GBtn onClick={doPay} full style={{padding:"12px"}}>✓ Confirm Payment</GBtn>
          </Modal>
        );
      })()}

      {mSav&&(
        <Modal title="💰 Savings" onClose={()=>{setMSav(null);setSavAmt("");setSavNote("");setSavType("deposit");}}>
          <div style={{display:"flex",gap:8,marginBottom:16}}>
            {["deposit","withdrawal"].map(t=>(
              <button key={t} onClick={()=>setSavType(t)} style={{flex:1,padding:"10px",borderRadius:10,border:`1px solid ${savType===t?(t==="deposit"?"rgba(34,197,94,0.4)":"rgba(248,113,113,0.4)"):LINE}`,background:savType===t?(t==="deposit"?"rgba(34,197,94,0.1)":"rgba(248,113,113,0.1)"):"transparent",color:savType===t?(t==="deposit"?"#4ade80":RED):DIM,cursor:"pointer",fontWeight:700,fontSize:13,textTransform:"capitalize"}}>{t==="deposit"?"📥 Deposit":"📤 Withdraw"}</button>
            ))}
          </div>
          <Fld label="Amount (₦)"><input type="number" style={IS} value={savAmt} onChange={e=>setSavAmt(e.target.value)} autoFocus/></Fld>
          <Fld label="Note (optional)"><input style={IS} value={savNote} onChange={e=>setSavNote(e.target.value)} placeholder="e.g. Weekly savings"/></Fld>
          <div style={{background:"rgba(255,255,255,0.03)",borderRadius:9,padding:"10px 13px",marginBottom:14}}>
            <div style={{fontSize:11,color:DIM,marginBottom:3}}>Current Balance</div>
            <div style={{fontSize:18,fontWeight:800,color:"#c4b5fd",fontFamily:"monospace"}}>{fc(savings[mSav.cId]?.balance||0)}</div>
          </div>
          <button onClick={doSavings} style={{width:"100%",background:savType==="deposit"?`linear-gradient(135deg,${G},${GM})`:"linear-gradient(135deg,#dc2626,#b91c1c)",border:"none",color:savType==="deposit"?"#000":"#fff",padding:"12px",borderRadius:12,cursor:"pointer",fontWeight:700,fontSize:14}}>✓ Confirm {savType==="deposit"?"Deposit":"Withdrawal"}</button>
        </Modal>
      )}

      {mAddUser&&(
        <Modal title="Add New Staff" onClose={()=>setMAddUser(false)}>
          <Fld label="Full Name *"><input style={IS} value={nu.name} onChange={e=>setNu(p=>({...p,name:e.target.value}))} placeholder="e.g. Fatima Alabi" autoFocus/></Fld>
          <Fld label="Username *"><input style={IS} value={nu.username} onChange={e=>setNu(p=>({...p,username:e.target.value.toLowerCase().replace(/\s/g,"")}))} placeholder="e.g. fatima"/></Fld>
          <Fld label="Password *"><input type="password" style={IS} value={nu.password} onChange={e=>setNu(p=>({...p,password:e.target.value}))} placeholder="Create a password"/></Fld>
          <div style={{background:"rgba(34,197,94,0.06)",border:"1px solid rgba(34,197,94,0.15)",borderRadius:9,padding:"10px 12px",marginBottom:14,fontSize:12,color:SOFT}}>
            ✅ Staff will ONLY see their assigned clients.<br/>❌ No access to Admin panel or other staff data.
          </div>
          <GBtn onClick={doAddUser} full style={{padding:"12px"}}>✓ Create Staff Account</GBtn>
        </Modal>
      )}

      {mResetPwd&&(()=>{
        const[np,setNp]=useState("");
        return(
          <Modal title="Reset Password" onClose={()=>setMResetPwd(null)}>
            <div style={{fontSize:13,color:SOFT,marginBottom:16}}>Resetting password for <strong style={{color:INK}}>{mResetPwd.name}</strong></div>
            <Fld label="New Password"><input type="password" style={IS} value={np} onChange={e=>setNp(e.target.value)} placeholder="Min 4 characters" autoFocus/></Fld>
            <GBtn onClick={()=>{ if(np.length>=4){ su(users.map(u=>u.id===mResetPwd.id?{...u,password:np}:u)); setMResetPwd(null); alert("Password reset successfully!"); } else alert("Min 4 characters required."); }} full style={{padding:"12px"}}>✓ Reset Password</GBtn>
          </Modal>
        );
      })()}

      {mSettings&&(
        <Modal title="⚙️ Settings & Backup" onClose={()=>setMSettings(false)}>
          <div style={{background:"rgba(34,197,94,0.06)",border:"1px solid rgba(34,197,94,0.15)",borderRadius:10,padding:"12px 14px",marginBottom:14}}>
            <div style={{fontSize:12,color:"#4ade80",fontWeight:700,marginBottom:4}}>☁️ Firebase Cloud Storage</div>
            <div style={{fontSize:12,color:SOFT}}>All data syncs in real time across all phones. Project: creda-finance</div>
          </div>
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:8,marginBottom:14}}>
            {[["Clients",clients.length],["Staff",users.length],["Month Records",Object.keys(monthly).length]].map(([l,v])=>(
              <div key={l} style={{background:"rgba(255,255,255,0.04)",borderRadius:8,padding:"8px 10px"}}><div style={{fontSize:9,color:DIM}}>{l}</div><div style={{fontSize:14,fontWeight:700,color:INK}}>{v}</div></div>
            ))}
          </div>
          <GBtn onClick={()=>{exportBackup();setMSettings(false);}} full style={{padding:"11px",marginBottom:10}}>📤 Download Full Backup (.json)</GBtn>
          <div style={{marginBottom:10}}>
            <label style={{display:"block",width:"100%",background:"rgba(96,165,250,0.1)",border:"1px solid rgba(96,165,250,0.25)",color:BLUE,padding:"11px",borderRadius:10,cursor:"pointer",fontWeight:700,fontSize:13,textAlign:"center",boxSizing:"border-box"}}>
              📥 Restore From Backup (.json)
              <input type="file" accept=".json" style={{display:"none"}} onChange={(e)=>{
                if(e.target.files[0]){
                  const reader=new FileReader();
                  reader.onload=(ev)=>{
                    try{
                      const data=JSON.parse(ev.target.result);
                      const c=data.clients||[];
                      const m=data.monthly||data.monthlyRecords||{};
                      const s=data.savings||data.savingsRecords||{};
                      const u=data.users||DEFAULT_USERS;
                      const p=data.pendingLoans||[];
                      sc(c); sm(m); ss(s); su(u); sp(p);
                      fbSet("clients",c); fbSet("monthly",m); fbSet("savings",s); fbSet("users",u); fbSet("pendingLoans",p);
                      setMSettings(false);
                      alert("✅ Data restored! "+c.length+" clients loaded into Firebase.");
                    } catch(err){ alert("Could not read file: "+err.message); }
                  };
                  reader.readAsText(e.target.files[0]);
                }
              }}/>
            </label>
          </div>
          <button onClick={()=>{ if(window.confirm("DELETE ALL DATA from Firebase? This cannot be undone.")){ sc([]); sm({}); ss({}); sp([]); setMSettings(false); }}} style={{width:"100%",background:"rgba(248,113,113,0.1)",border:"1px solid rgba(248,113,113,0.2)",color:RED,padding:"10px",borderRadius:10,cursor:"pointer",fontWeight:600,fontSize:12}}>🗑️ Clear All Data from Firebase</button>
        </Modal>
      )}

      {mDel&&(
        <Modal title="Delete Client?" onClose={()=>setMDel(null)}>
          <p style={{color:SOFT,fontSize:14,marginBottom:20,lineHeight:1.6}}>This will permanently delete the client and all their loan and savings data from Firebase. This cannot be undone.</p>
          <div style={{display:"flex",gap:10}}>
            <button onClick={()=>setMDel(null)} style={{flex:1,background:"rgba(255,255,255,0.05)",border:`1px solid ${LINE}`,color:SOFT,padding:"11px",borderRadius:11,cursor:"pointer",fontWeight:700}}>Cancel</button>
            <button onClick={()=>doDeleteClient(mDel)} style={{flex:1,background:"linear-gradient(135deg,#dc2626,#b91c1c)",border:"none",color:"#fff",padding:"11px",borderRadius:11,cursor:"pointer",fontWeight:700}}>Delete</button>
          </div>
        </Modal>
      )}
    </div>
  );
}
