// src/App.tsx
import { useMemo, useState, useEffect } from "react";
import "./App.css";
import {
  saveDayToCloud,
  fetchDaysBetween,
  deleteDay,
  deleteDays,
  watchUser,
  emailPasswordSignIn,
  signOutApp,
} from "./lib/firebase";

/** Tipos */
type DayEntry = {
  date: string;
  amScheduled: string[];
  amOff: string[];
  pmScheduled: string[];
  pmOff: string[];
};
type DayPresence = {
  driverId: string;
  driverName: string;
  date: string;
  am: boolean;
  pm: boolean;
};
type AggRow = {
  driverId: string;
  driverName: string;
  daysLastWeek: number;
  daysThisWeek: number;
  days14d: number;
  suggest: boolean;
  reasons: string[];
};

/** Datas utilitárias */
function toDate(value: string) { return new Date(`${value}T00:00:00`); }
function formatDate(d: Date) {
  const y = d.getFullYear(); const m = String(d.getMonth()+1).padStart(2,"0"); const dd = String(d.getDate()).padStart(2,"0");
  return `${y}-${m}-${dd}`;
}
function startOfWeekMonday(d: Date) { const t = new Date(d); const day = t.getDay(); const diff = (day+6)%7; t.setDate(t.getDate()-diff); t.setHours(0,0,0,0); return t; }
function addDays(d: Date, n: number) { const t = new Date(d); t.setDate(t.getDate()+n); return t; }

/** Parser */
function normalizeBlock(text: string) {
  let t = text.trim();
  if (t.startsWith("[")) t = t.slice(1);
  if (t.endsWith("]")) t = t.slice(0,-1);
  return t.split(/\r?\n/).map(s=>s.trim()).filter(Boolean);
}
function parseDriverLine(line: string) {
  let s = line.trim();
  if (s.startsWith("[")) s = s.slice(1);
  if (s.endsWith("]")) s = s.slice(0,-1);
  const m = s.match(/^(\d{6,8})\s+(.+)$/);
  if (!m) return null;
  return { id: m[1], name: m[2].trim() };
}

/** Presenças → linhas por driver/data */
function entriesToPresences(entries: DayEntry[]): DayPresence[] {
  const out: DayPresence[] = [];
  for (const e of entries) {
    const amSet = new Set<string>(), pmSet = new Set<string>();
    const idToName = new Map<string,string>();
    for (const line of e.amScheduled) { const p = parseDriverLine(line); if (p) { amSet.add(p.id); if(!idToName.has(p.id)) idToName.set(p.id,p.name); } }
    for (const line of e.pmScheduled) { const p = parseDriverLine(line); if (p) { pmSet.add(p.id); if(!idToName.has(p.id)) idToName.set(p.id,p.name); } }
    const all = new Set<string>([...amSet,...pmSet]);
    for (const id of all) out.push({ driverId:id, driverName:idToName.get(id)||id, date:e.date, am:amSet.has(id), pm:pmSet.has(id) });
  }
  return out;
}

/** Agregação para os 14 dias e semanas correntes (sem AM/PM 14d) */
function aggregateDays(presences: DayPresence[], weekStart: Date): AggRow[] {
  const thisWeekStart = weekStart, nextWeekStart = addDays(thisWeekStart,7), lastWeekStart = addDays(thisWeekStart,-7);
  const seenDay = new Set<string>();
  type Mut = Omit<AggRow,"suggest"|"reasons"> & { suggest?: boolean; reasons?: string[] };
  const byId = new Map<string, Mut>();
  const ensure = (id:string, name:string) => {
    if (!byId.has(id)) byId.set(id, { driverId:id, driverName:name, daysLastWeek:0, daysThisWeek:0, days14d:0 });
    return byId.get(id)!;
  };

  for (const p of presences) {
    const key = `${p.driverId}|${p.date}`;
    if (seenDay.has(key)) continue;
    seenDay.add(key);
    const d = toDate(p.date);
    const row = ensure(p.driverId, p.driverName);

    // janela 14 dias: thisWeekStart-7 (inclusive) até nextWeekStart (exclusive)
    if (d >= addDays(thisWeekStart,-7) && d < nextWeekStart) {
      row.days14d += 1; // presença AM OU PM conta como 1 dia
    }
    if (d >= thisWeekStart && d < nextWeekStart) row.daysThisWeek += 1;
    else if (d >= lastWeekStart && d < thisWeekStart) row.daysLastWeek += 1;
  }

  const MAX_DAYS_THIS_WEEK = 5;
  const MAX_DAYS_14D = 9;

  const rows: AggRow[] = Array.from(byId.values()).map(r=>{
    const reasons:string[] = [];
    if (r.daysThisWeek >= MAX_DAYS_THIS_WEEK) reasons.push("muitos dias na semana");
    if (r.days14d >= MAX_DAYS_14D) reasons.push("muitos dias em 14 dias");
    return { ...r, suggest: reasons.length>0, reasons };
  });

  rows.sort((a,b)=>{
    const sa = a.suggest?0:1, sb = b.suggest?0:1;
    if (sa!==sb) return sa-sb;
    if (b.daysThisWeek!==a.daysThisWeek) return b.daysThisWeek-a.daysThisWeek;
    return b.days14d-a.days14d;
  });
  return rows;
}

/** Componente principal */
export default function App() {
  // Estado de sessão
  const [userEmail, setUserEmail] = useState<string | null>(null);
  const [authReady, setAuthReady] = useState(false);

  // Observa login/logout
  useEffect(() => {
    const unsub = watchUser((u) => {
      setUserEmail(u?.email ?? null);
      setAuthReady(true);
    });
    return () => unsub();
  }, []);

  // Form de login
  const [loginEmail, setLoginEmail] = useState("");
  const [loginPass, setLoginPass] = useState("");
  const [loginLoading, setLoginLoading] = useState(false);
  async function doLogin(e?: React.FormEvent) {
    e?.preventDefault();
    setLoginLoading(true);
    try {
      await emailPasswordSignIn(loginEmail.trim(), loginPass);
    } catch (err: any) {
      alert("Falha no login: " + (err?.message ?? "ver console"));
      console.error(err);
    } finally {
      setLoginLoading(false);
    }
  }
  async function doLogout() {
    try { await signOutApp(); } catch (e) { console.error(e); }
  }

  // Conectividade (informativo)
  const [online, setOnline] = useState<boolean>(navigator.onLine);
  useEffect(() => {
    const on = () => setOnline(true); const off = () => setOnline(false);
    window.addEventListener("online", on); window.addEventListener("offline", off);
    return () => { window.removeEventListener("online", on); window.removeEventListener("offline", off); };
  }, []);

  

  // Form diário
  const [dateInput,setDateInput] = useState("");
  const [amScheduleText,setAmScheduleText] = useState("");
  const [amOffText,setAmOffText] = useState("");
  const [pmScheduleText,setPmScheduleText] = useState("");
  const [pmOffText,setPmOffText] = useState("");

  // Dados locais
  const [dayEntries,setDayEntries] = useState<DayEntry[]>(()=>{ try{ const raw=localStorage.getItem("egx_day_entries_v2"); return raw?JSON.parse(raw):[]; }catch{ return []; }});
  const [selectedDates, setSelectedDates] = useState<Record<string, boolean>>({});

  // Carrega últimos 14 dias (só depois de saber se há usuário)
  useEffect(() => {
    if (!userEmail) return; // sem usuário, não busca nuvem
    const today = new Date();
    const start = new Date(today); start.setDate(start.getDate() - 13);
    const startStr = formatDate(start);
    const endStr = formatDate(today);

    fetchDaysBetween(startStr, endStr)
      .then((days) => {
        setDayEntries(prev => {
          const map = new Map<string, any>();
          for (const d of prev) map.set(d.date, d);
          for (const d of days) map.set(d.date, d);
          return Array.from(map.values()).sort((a,b)=>a.date.localeCompare(b.date));
        });
      })
      .catch((e) => console.error("Erro ao buscar na nuvem:", e));
  }, [userEmail]);

  // Salvar um dia
  async function saveDay(){
    if(!dateInput){ alert("Escolha a data primeiro"); return; }
    const entry = {
      date: dateInput,
      amScheduled: normalizeBlock(amScheduleText),
      amOff: normalizeBlock(amOffText),
      pmScheduled: normalizeBlock(pmScheduleText),
      pmOff: normalizeBlock(pmOffText),
    };

    // local
    const next = [...dayEntries.filter(d=>d.date!==entry.date), entry].sort((a,b)=>a.date.localeCompare(b.date));
    setDayEntries(next);
    try { localStorage.setItem("egx_day_entries_v2", JSON.stringify(next)); } catch {}

    // nuvem
    try {
      await saveDayToCloud(entry);
      alert(online ? "Dia salvo!" : "Dia salvo (offline). Sincroniza quando voltar a internet.");
    } catch (e) {
      console.error(e);
      alert("Salvou local. Falhou na nuvem (veja o console).");
    }
  }

  function clearForm(){ setAmScheduleText(""); setAmOffText(""); setPmScheduleText(""); setPmOffText(""); }
  function clearAll(){
    if(!confirm("Apagar TODOS os dias localmente? (não remove do Firestore)")) return;
    setDayEntries([]); setSelectedDates({});
    try{ localStorage.removeItem("egx_day_entries_v2"); }catch{}
  }

  async function deleteSingleDate(date: string) {
    const proceed = confirm(`Apagar o dia ${date} localmente e no Firestore?`);
    if(!proceed) return;
    try { await deleteDay(date); } catch (e) { console.error(e); alert("Falha ao apagar na nuvem."); return; }
    const next = dayEntries.filter(d => d.date !== date);
    setDayEntries(next);
    try { localStorage.setItem("egx_day_entries_v2", JSON.stringify(next)); } catch {}
    setSelectedDates(prev => { const copy = { ...prev }; delete copy[date]; return copy; });
  }

  async function deleteSelectedDates() {
    const dates = Object.entries(selectedDates).filter(([,v])=>v).map(([k])=>k);
    if (dates.length === 0) { alert("Nenhuma data selecionada."); return; }
    const proceed = confirm(`Apagar ${dates.length} dia(s) selecionado(s) localmente e no Firestore?`);
    if(!proceed) return;
    try { await deleteDays(dates); } catch (e) { console.error(e); alert("Falha ao apagar na nuvem."); return; }
    const setDates = new Set(dates);
    const next = dayEntries.filter(d => !setDates.has(d.date));
    setDayEntries(next); setSelectedDates({});
    try { localStorage.setItem("egx_day_entries_v2", JSON.stringify(next)); } catch {}
    alert("Datas selecionadas apagadas.");
  }

  // Semanas e resumo
  const today = new Date();
  const thisWeekStart = useMemo(()=>startOfWeekMonday(today),[today]);
  const lastWeekStart = addDays(thisWeekStart,-7), nextWeekStart = addDays(thisWeekStart,7), thisWeekEnd = addDays(nextWeekStart,-1), lastWeekEnd = addDays(thisWeekStart,-1);
  const presences = useMemo(()=>entriesToPresences(dayEntries),[dayEntries]);
  const rows = useMemo(()=>aggregateDays(presences,thisWeekStart),[presences,thisWeekStart]);
  const savedDates = dayEntries.map(d=>d.date).sort();

  // ---------- TELA DE LOGIN (bloqueia a UI) ----------
  if (!authReady || !userEmail) {
    return (
      <div className="app">
        <header className="header">
          <div className="logo">EGX</div>
          <div style={{flex:1}}>
            <h1 className="title">EGX Schedule Balancer</h1>
            <div className="subtitle">Acesso restrito — faça login para continuar.</div>
          </div>
        </header>

        <section className="card" style={{maxWidth:420}}>
          <form onSubmit={doLogin} style={{display:"grid", gap:8}}>
            <label style={{display:"grid", gap:4}}>
              <span>E-mail</span>
              <input
                className="input"
                type="email"
                autoComplete="username"
                value={loginEmail}
                onChange={(e)=>setLoginEmail(e.target.value)}
                required
              />
            </label>
            <label style={{display:"grid", gap:4}}>
              <span>Senha</span>
              <input
                className="input"
                type="password"
                autoComplete="current-password"
                value={loginPass}
                onChange={(e)=>setLoginPass(e.target.value)}
                required
              />
            </label>
            <button className="btn primary" type="submit" disabled={loginLoading}>
              {loginLoading ? "Entrando..." : "Entrar"}
            </button>
            {!online && <div className="subtitle">Você está offline. O login requer internet.</div>}
          </form>
        </section>
      </div>
    );
  }

  // ---------- APP LOGADO ----------
  return (
    <div className="app">
      {/* Header */}
      <header className="header">
        <div className="logo">EGX</div>
        <div style={{flex:1}}>
          <h1 className="title">EGX Schedule Balancer</h1>
          <div className="subtitle">EGX Logistics</div> 
        </div>
        <div className="subtitle" style={{display:"flex", gap:8, alignItems:"center"}}>
          <span>{userEmail}</span>
          <button className="btn" onClick={doLogout}>Sair</button>
        </div>
      </header>

      {!online && (
        <section className="card" style={{ borderColor: "#f59e0b" }}>
          Você está <b>offline</b>. O Firestore funciona em modo offline e sincroniza quando voltar.
        </section>
      )}

      {/* Info + Ações */}
      <section className="grid">
        <section className="card">
          <div style={{fontWeight:600, marginBottom:6}}>Janelas</div>
          <div className="subtitle">
            <div>Semana passada: {formatDate(lastWeekStart)} → {formatDate(lastWeekEnd)}</div>
            <div>Semana atual: {formatDate(thisWeekStart)} → {formatDate(thisWeekEnd)}</div>
          </div>
        </section>
        <section className="card">
          <div style={{fontWeight:600, marginBottom:6}}>Ações</div>
          <div style={{display:"flex", gap:8, flexWrap:"wrap"}}>
            <button className="btn" onClick={()=>{
              const header = ["driverId","driverName","daysLastWeek","daysThisWeek","days14d","suggestDayOff","reasons"];
              const lines = [header.join(",")];
              for (const r of rows) lines.push([
                r.driverId,
                `"${r.driverName}"`,
                r.daysLastWeek,
                r.daysThisWeek,
                r.days14d,
                r.suggest?"YES":"NO",
                `"${r.reasons.join("; ")}"`
              ].join(","));
              const blob = new Blob([lines.join("\n")],{type:"text/csv;charset=utf-8;"}); const url = URL.createObjectURL(blob); const a=document.createElement("a"); a.href=url; a.download=`egx-days-summary-${Date.now()}.csv`; a.click(); URL.revokeObjectURL(url);
            }}>Exportar CSV (resumo)</button>
            <button className="btn" onClick={clearAll}>Limpar TODOS os dias (local)</button>
            <button className="btn primary" onClick={deleteSelectedDates}>Apagar selecionados (local + nuvem)</button>
          </div>
        </section>
      </section>

      {/* Form diário */}
      <section className="card" style={{marginTop:12}}>
        <div style={{fontWeight:600, marginBottom:8}}>Daily Schedule (manual)</div>

        <div className="row">
          <label style={{display:"flex", flexDirection:"column", gap:4}}>
            <span>Data</span>
            <input className="input" type="date" value={dateInput} onChange={(e)=>setDateInput(e.target.value)}/>
          </label>
          <button className="btn primary" onClick={saveDay}>Save day</button>
          <button className="btn" onClick={clearForm}>Limpar campos</button>
        </div>

        <div className="grid" style={{marginTop:10}}>
          <label style={{display:"flex", flexDirection:"column", gap:4}}>
            <span>AM Schedule — cole drivers</span>
            <textarea className="textarea" value={amScheduleText} onChange={(e)=>setAmScheduleText(e.target.value)} placeholder={`1011982 Karanjot (EGX Logistics)\n1012219 Nicolas (EGX Logistics)`}/>
          </label>
          <label style={{display:"flex", flexDirection:"column", gap:4}}>
            <span>AM Off — cole drivers</span>
            <textarea className="textarea" value={amOffText} onChange={(e)=>setAmOffText(e.target.value)}/>
          </label>
          <label style={{display:"flex", flexDirection:"column", gap:4}}>
            <span>PM Schedule — cole drivers</span>
            <textarea className="textarea" value={pmScheduleText} onChange={(e)=>setPmScheduleText(e.target.value)}/>
          </label>
          <label style={{display:"flex", flexDirection:"column", gap:4}}>
            <span>PM Off — cole drivers</span>
            <textarea className="textarea" value={pmOffText} onChange={(e)=>setPmOffText(e.target.value)}/>
          </label>
        </div>

        {savedDates.length>0 && (
          <div className="meta" style={{marginTop:8}}>
            <b>Dias salvos:</b>
            <div style={{display:"flex", flexWrap:"wrap", gap:8, marginTop:6}}>
              {savedDates.map(date => {
                const checked = !!selectedDates[date];
                return (
                  <div key={date} style={{
                    display:"flex", alignItems:"center", gap:6,
                    border:"1px solid var(--line)", padding:"6px 10px",
                    borderRadius:8, background:"#f8fafc"
                  }}>
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={(e)=>setSelectedDates(prev=>({ ...prev, [date]: e.target.checked }))}
                      title="Selecionar para apagar em lote"
                    />
                    <span>{date}</span>
                    <button className="btn" onClick={()=>deleteSingleDate(date)} title={`Apagar ${date} (local + nuvem)`}>🗑️</button>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </section>

      {/* Resumo */}
      <section className="card" style={{marginTop:12}}>
        <div style={{display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:8}}>
          <div style={{fontWeight:600}}>Resumo por driver (últimos 14 dias)</div>
        </div>

        {rows.length===0 ? (
          <div className="subtitle" style={{padding:8}}>Sem dados ainda. Salve um dia (AM/PM).</div>
        ) : (
          <div className="tablewrap">
            <table>
              <thead>
                <tr>
                  <th>Driver</th>
                  <th>Dias (LW)</th>
                  <th>Dias (TW)</th>
                  <th>Dias (14d)</th>
                  <th>Sugestão</th>
                </tr>
              </thead>
              <tbody>
                {rows.map(r=>(
                  <tr key={r.driverId}>
                    <td style={{fontWeight:600}}>{r.driverName}</td>
                    <td style={{textAlign:"center"}}>{r.daysLastWeek}</td>
                    <td style={{textAlign:"center"}}>{r.daysThisWeek}</td>
                    <td style={{textAlign:"center"}}>{r.days14d}</td>
                    <td>
                      {r.suggest
                        ? <span className="badge-warn">Sugerir Day Off ({r.reasons.join("; ")})</span>
                        : <span className="badge-ok">OK</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <div className="footer">Regras: presença em AM ou PM conta <b>1 dia</b>. OFF não conta dia. Sem horas.</div>
    </div>
  );
}
