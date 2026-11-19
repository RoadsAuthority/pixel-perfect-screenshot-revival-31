import { createFileRoute } from '@tanstack/react-router';
import { useEffect, useRef, useState } from 'react';
import { ArrowRight, AudioLines, BookOpen, CalendarDays, Check, CheckCircle2, ChevronRight, CircleHelp, ClipboardList, FileText, HeartPulse, History, LockKeyhole, Mic, Settings2, ShieldCheck, Smartphone, Sparkles, Stethoscope, UserRound, UsersRound, Volume2, X, LoaderCircle, ExternalLink } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { Dialog, DialogContent, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { FeaturePhone } from '@/components/feature-phone';
import { profiles, documents, canAccess, verifyProfile, demoAsk, summarize, callArchive, normalizeAnswer, type Profile, type Answer, type AuditEntry, type Source } from '@/lib/archive';

export const Route = createFileRoute('/')({
  head: () => ({ meta: [
    { title: 'Ask the Archive — Rural Health Clinic' },
    { name: 'description', content: 'Ask questions, hear simple answers, and read source-backed clinic documents with access suited to your role.' },
    { property: 'og:title', content: 'Ask the Archive — Rural Health Clinic' },
    { property: 'og:description', content: 'Trusted clinic information, simple document summaries, and feature-phone access for rural communities.' },
    { property: 'og:type', content: 'website' }, { name: 'twitter:card', content: 'summary_large_image' },
  ] }), component: Index,
});

type SpeechResult = { results: { [index: number]: { [index: number]: { transcript: string } } } };
type Recognition = { lang: string; interimResults: boolean; onresult: ((event: SpeechResult) => void) | null; onend: (() => void) | null; onerror: (() => void) | null; start: () => void; stop: () => void };
type SpeechWindow = Window & { SpeechRecognition?: new () => Recognition; webkitSpeechRecognition?: new () => Recognition };
const tabs = [{ id: 'ask', label: 'Simple Ask & Voice', icon: AudioLines }, { id: 'summaries', label: 'Document Summaries', icon: FileText }, { id: 'phone', label: 'Feature Phone', icon: Smartphone }, { id: 'logs', label: 'Who Asked What', icon: History }];

function Index() {
  const [selected, setSelected] = useState(profiles[0]);
  const [verified, setVerified] = useState<Profile | null>(null);
  const [pin, setPin] = useState('');
  const [pinError, setPinError] = useState('');
  const [mode, setMode] = useState(true);
  const [url, setUrl] = useState('');
  const [settings, setSettings] = useState(false);
  const [tab, setTab] = useState('ask');
  const [query, setQuery] = useState('');
  const [answer, setAnswer] = useState<Answer | null>(null);
  const [summary, setSummary] = useState<Answer | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [logs, setLogs] = useState<AuditEntry[]>([]);
  const [source, setSource] = useState<Source | null>(null);
  const [listening, setListening] = useState(false);
  const [speaking, setSpeaking] = useState(false);
  const [voiceNotice, setVoiceNotice] = useState('');
  const recognition = useRef<Recognition | null>(null);
  const questionRef = useRef<HTMLTextAreaElement>(null);
  const liveAuthorized = useRef(false);
  const availableDocs = documents.filter(d => canAccess(verified, d));
  useEffect(() => () => { recognition.current?.stop(); window.speechSynthesis?.cancel(); }, []);

  function clearPrivateState() { setAnswer(null); setSummary(null); setSource(null); setError(''); setLogs([]); window.speechSynthesis?.cancel(); setSpeaking(false); recognition.current?.stop(); }
  function switchProfile(p: Profile) { clearPrivateState(); setSelected(p); setVerified(null); setPin(''); setPinError(''); liveAuthorized.current = false; }
  function switchMode(value: boolean) { clearPrivateState(); setMode(value); setVerified(null); setPin(''); liveAuthorized.current = false; }
  async function verify() {
    setPinError('');
    if (mode) {
      const person = verifyProfile(selected.id, pin);
      if (!person) { setPinError('That PIN is incorrect. Please try again.'); return; }
      setVerified(person);
    } else {
      setBusy(true);
      try {
        // Successful access to this authenticated request must be enforced by AWS.
        const data = await callArchive(url, { action: 'ask', user_id: selected.id, pin, channel: 'web', query: 'When is the mobile clinic visiting?' });
        if (data['authenticated'] !== true && data['verified'] !== true) throw new Error('The clinic service must explicitly confirm your ID and PIN before private access is enabled.');
        normalizeAnswer(data); liveAuthorized.current = true; setVerified({ ...selected, pin });
      } catch (e) { setPinError(e instanceof Error ? e.message : 'Could not verify your ID and PIN.'); }
      finally { setBusy(false); }
    }
  }
  async function run(question: string, channel: 'web' | 'voice' | 'ussd' = 'web', identity?: Profile, docId?: string): Promise<Answer | null> {
    if (!question.trim() || busy) return null;
    const person = identity ?? verified;
    if (!mode && (!person || !liveAuthorized.current)) { setError('Verify your ID and PIN before asking the live clinic service.'); return null; }
    setBusy(true); setError('');
    try {
      const result = mode ? docId ? summarize(person, docId) : demoAsk(person, question) : normalizeAnswer(await callArchive(url, { action: docId ? 'summary' : 'ask', user_id: person?.id ?? selected.id, pin: person?.pin ?? pin, channel, query: question, ...(docId ? { doc_id: docId } : {}) }));
      if (docId) setSummary(result); else if (channel !== 'ussd') setAnswer(result);
      if (mode) setLogs(prev => [{ timestamp: new Date().toISOString(), user_id: person?.id ?? 'PUBLIC', role: person?.role ?? 'public', channel, question, status: result.status, sources: result.sources.map(s => s.reference) }, ...prev]);
      return result;
    } catch (e) { setError(e instanceof Error ? e.message : 'The clinic service could not be reached. No answer has been substituted.'); return null; }
    finally { setBusy(false); }
  }
  async function fetchLogs() {
    setBusy(true); setError('');
    try {
      if (!verified || !liveAuthorized.current) throw new Error('Verify your ID and PIN to request live history.');
      const data = await callArchive(url, { action: 'logs', user_id: verified.id, pin: verified.pin, channel: 'web', query: '' });
      if (!Array.isArray(data['logs'])) throw new Error('The clinic service did not return an audit log.');
      setLogs(data['logs'] as AuditEntry[]);
    } catch (e) { setError(e instanceof Error ? e.message : 'History could not be loaded.'); } finally { setBusy(false); }
  }
  function startVoice() {
    if (listening) { recognition.current?.stop(); return; }
    const speechWindow = window as SpeechWindow;
    const Constructor = speechWindow.SpeechRecognition ?? speechWindow.webkitSpeechRecognition;
    if (!Constructor) { setVoiceNotice('Voice input is not supported in this browser. You can type your question instead.'); questionRef.current?.focus(); return; }
    const instance = new Constructor(); recognition.current = instance; instance.lang = 'en-ZA'; instance.interimResults = false;
    instance.onresult = event => { const text = event.results[0]?.[0]?.transcript; if (text) { setQuery(text); void run(text, 'voice'); } };
    instance.onend = () => setListening(false); instance.onerror = () => { setListening(false); setVoiceNotice('We could not hear your question. Check microphone permission or type it below.'); };
    try { instance.start(); setListening(true); setVoiceNotice(''); } catch { setVoiceNotice('The microphone could not start. Please type your question.'); }
  }
  function read(text: string) {
    if (!window.speechSynthesis) { setVoiceNotice('Read aloud is unavailable in this browser.'); return; }
    if (speaking) { window.speechSynthesis.cancel(); setSpeaking(false); return; }
    const utterance = new SpeechSynthesisUtterance(text); utterance.lang = 'en-ZA'; utterance.rate = .9; utterance.onend = () => setSpeaking(false); utterance.onerror = () => setSpeaking(false); setSpeaking(true); window.speechSynthesis.speak(utterance);
  }
  function renderAnswer(result: Answer | null) {
    if (!result) return <div className="answer-card empty-answer"><div className="archive-visual" aria-hidden="true"><FileText strokeWidth={1.3}/><FileText strokeWidth={1.3}/></div><h3 className="text-base font-semibold">Your answer will appear here</h3><p className="mt-2 max-w-sm text-sm leading-6 text-muted-foreground">Ask a question above. We’ll show a simple answer<br className="hidden sm:block"/> and the document it came from.</p><div className="mt-5 flex items-center gap-1.5 text-xs text-muted-foreground"><ShieldCheck size={14}/>Only information you’re allowed to see</div></div>;
    return <div className="answer-card" aria-live="polite"><div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-5 py-4"><div className={`flex items-center gap-2 text-sm font-semibold ${result.is_unknown ? 'text-warning' : 'text-primary'}`}>{result.is_unknown ? <CircleHelp size={19}/> : <CheckCircle2 size={19}/>} {result.is_unknown ? "I don't know" : 'From the clinic archive'}{mode && <span className="rounded bg-muted px-2 py-1 text-[10px] font-medium text-muted-foreground">DEMO ANSWER</span>}</div><Button variant="ghost" size="touch" onClick={() => read(result.answer)}><Volume2/>{speaking ? 'Stop reading' : 'Listen Aloud'}</Button></div><p className="px-5 py-5 text-base leading-8">{result.answer}</p>{result.sources.map((s, i) => <div key={`${s.doc_id}-${i}`} className="border-t border-border bg-muted/40 px-5 py-4"><div className="mb-2 flex items-start gap-2 text-xs font-semibold text-primary"><FileText size={15}/>{s.title}<span className="ml-auto shrink-0 font-normal text-muted-foreground">{s.reference}</span></div><blockquote className="border-l-2 border-primary/30 pl-3 text-sm leading-6 text-muted-foreground">“{s.snippet}”</blockquote><Button variant="link" className="mt-2 h-11 px-0 text-xs" onClick={() => setSource(s)}>View Source Document<ArrowRight/></Button></div>)}</div>;
  }
  const prompts = [
    { text: 'When is the mobile clinic visiting?', icon: CalendarDays },
    { text: selected.role === 'patient' ? 'What did my recent report say?' : 'Which contracts expire next year?', icon: selected.role === 'patient' ? HeartPulse : ClipboardList },
    { text: selected.role === 'patient' ? 'What should I know about fever?' : 'Which supplies expire next year?', icon: selected.role === 'patient' ? BookOpen : CalendarDays },
    { text: 'Summarize a document', icon: FileText },
  ];
  const viewedDoc = source ? documents.find(d => d.id === source.doc_id && canAccess(verified, d)) : null;
  return <div className="min-h-screen">
    <a href="#main-workspace" className="sr-only focus:not-sr-only focus:absolute focus:z-50 focus:bg-card focus:p-4">Skip to questions</a>
    <header className="border-b border-border bg-card"><div className="app-shell flex h-[88px] items-center justify-between gap-4"><div className="flex items-center gap-3"><div className="brand-mark"><HeartPulse size={25}/></div><div><div className="brand-title text-xl font-bold">Ask the Archive<span className="text-primary">.</span></div><div className="brand-subtitle mt-1 text-xs text-muted-foreground">RURAL HEALTH CLINIC</div></div></div><div className="flex items-center gap-3"><span className={`flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium ${mode ? 'bg-warning-surface text-warning' : 'bg-secondary text-primary'}`}><span className="h-1.5 w-1.5 rounded-full bg-current"/>{mode ? 'Demo Mode' : 'Live API'}</span><Switch aria-label="Enable Live API" checked={!mode} onCheckedChange={v => { if (v && !url) setSettings(true); switchMode(!v); }}/><Button aria-label="Connection settings" title="Connection settings" variant="ghost" size="icon" onClick={() => setSettings(true)}><Settings2/></Button></div></div></header>
    <section className="border-b border-border bg-card/45"><div className="app-shell pb-5 pt-6"><div className="mb-3 flex flex-wrap items-center justify-between gap-2"><h2 className="text-xs font-semibold text-muted-foreground">WHO IS ASKING?</h2><span className="flex items-center gap-1.5 text-xs text-muted-foreground"><LockKeyhole size={12}/>Your role keeps your information private</span></div><div className="profile-grid">{profiles.map(p => { const Icon = p.role === 'nurse' ? Stethoscope : p.role === 'clerk' ? ClipboardList : UserRound; return <Button key={p.id} variant="ghost" className="profile-choice" aria-pressed={selected.id === p.id} onClick={() => switchProfile(p)}><span className="profile-icon"><Icon size={19}/></span><span className="min-w-0"><span className="profile-name block text-sm font-semibold">{p.name}</span><span className="mt-1 block text-[11px] font-normal text-muted-foreground">{p.role === 'patient' ? 'Patient' : p.role === 'clerk' ? 'Administrative staff' : 'Clinical staff'}</span></span>{selected.id === p.id && <CheckCircle2 className="ml-auto shrink-0 text-primary"/>}</Button>; })}</div>
      <div className="verification-bar mt-4 flex items-center justify-between gap-3"><div className="flex items-center gap-2 text-xs"><ShieldCheck className="size-4 text-primary"/><span className="text-muted-foreground">Current access:</span><span className="font-medium text-primary">{verified ? verified.scope : 'Public clinic information only'}</span></div>{verified ? <span className="flex items-center gap-1.5 text-xs font-medium text-primary"><CheckCircle2 size={14}/>{mode ? 'Demo PIN verified' : 'API session verified'} · {verified.id}</span> : <form onSubmit={e => { e.preventDefault(); void verify(); }} className="flex items-center gap-2"><label htmlFor="profile-pin" className="text-xs text-muted-foreground">{mode ? `Demo PIN: ${selected.pin}` : 'Enter PIN'}</label><input id="profile-pin" aria-label="Verification PIN" type="password" inputMode="numeric" maxLength={4} value={pin} onChange={e => setPin(e.target.value)} className="h-11 w-20 rounded-md border border-input bg-card px-3 text-sm" placeholder="••••" autoComplete="off"/><Button variant="outline" size="touch" className="px-3 text-xs" disabled={busy}>Verify PIN<ArrowRight/></Button></form>}</div>{pinError && <p className="mt-3 text-sm text-destructive" role="alert">{pinError}</p>}
    </div></section>
    <div className="app-shell"><nav className="workspace-tabs" role="tablist" aria-label="Clinic workspace">{tabs.map(t => <Button key={t.id} id={`tab-${t.id}`} role="tab" aria-selected={tab === t.id} aria-controls="main-workspace" variant="ghost" className="workspace-tab" onClick={() => { setTab(t.id); setError(''); if (t.id === 'logs' && !mode) void fetchLogs(); }}><t.icon size={17}/>{t.label}{t.id === 'logs' && logs.length > 0 && <span className="rounded bg-secondary px-1.5 py-.5 text-[10px] text-primary">{logs.length}</span>}</Button>)}</nav>
    <main id="main-workspace" role="tabpanel" aria-labelledby={`tab-${tab}`} className="pb-10 pt-8">
      {error && <div role="alert" className="mb-5 flex items-start gap-3 rounded-md border border-warning/20 bg-warning-surface p-4 text-sm text-warning"><CircleHelp size={19}/><p className="flex-1">{error}</p><Button aria-label="Dismiss error" variant="ghost" size="icon" onClick={() => setError('')}><X/></Button></div>}
      {tab === 'ask' && <div className="ask-grid page-enter"><section><div className="mb-6"><div className="mb-2 flex items-center gap-2 text-xs font-medium text-primary"><span className="h-1.5 w-1.5 rounded-full bg-primary"/>A LITTLE CLARITY, WHEN YOU NEED IT</div><h1 className="text-[28px] font-semibold leading-tight">What would you like to know?</h1><p className="mt-3 text-sm leading-6 text-muted-foreground">Ask about clinic visits, your reports, or the information you need.</p></div><form onSubmit={e => { e.preventDefault(); void run(query); }}><label htmlFor="question" className="mb-2 block text-sm font-medium">Your question</label><div className="question-box"><textarea ref={questionRef} id="question" placeholder="For example, when is the mobile clinic coming to my area?" value={query} onChange={e => setQuery(e.target.value)} disabled={busy}/><div className="question-toolbar"><Button type="button" variant="ghost" size="touch" className="px-2 text-sm text-primary" disabled={busy} onClick={startVoice}><Mic/>{listening ? 'Listening… Tap to stop' : 'Tap to Speak'}</Button><Button variant="clinic" size="touch" type="submit" disabled={busy || !query.trim()}>{busy ? <LoaderCircle className="animate-spin"/> : <Sparkles/>}{busy ? 'Checking archive…' : 'Ask the Archive'}<ArrowRight/></Button></div></div></form>{voiceNotice && <p className="mt-3 text-xs leading-6 text-warning" role="status">{voiceNotice}</p>}<div className="mb-3 mt-5 text-xs font-medium text-muted-foreground">OR, START WITH A QUESTION</div><div className="prompt-grid">{prompts.map(p => <Button key={p.text} variant="ghost" className="prompt" disabled={busy} onClick={() => { if (p.text === 'Summarize a document') setTab('summaries'); else { setQuery(p.text); void run(p.text); } }}><p.icon size={18}/><span>{p.text}</span><ChevronRight className="prompt-arrow size-4"/></Button>)}</div><div className="mb-3 mt-7 flex items-center justify-between"><h2 className="text-sm font-semibold">Your answer</h2><span className="flex items-center gap-1 text-[11px] text-muted-foreground"><BookOpen size={13}/>Backed by source documents</span></div>{renderAnswer(answer)}</section><aside className="ask-sidebar"><section className="side-section"><div className="scope-box"><div className="flex items-center gap-2 text-sm font-semibold text-primary"><ShieldCheck size={19}/>Your information, protected</div><p className="mt-3 text-xs leading-6 text-secondary-foreground">{verified ? `${verified.name} can see:` : 'Until your PIN is verified, you can see:'}</p><ul className="mt-2 space-y-2.5 text-xs text-secondary-foreground"><li className="flex items-center gap-2"><Check size={14}/>Public clinic information</li>{verified?.role === 'patient' && <li className="flex items-center gap-2"><Check size={14}/>Your own patient reports</li>}{verified && verified.role !== 'patient' && <li className="flex items-center gap-2"><Check size={14}/>Staff contracts & expiry logs</li>}{verified?.role === 'nurse' && <li className="flex items-center gap-2"><Check size={14}/>All patient records</li>}<li className="flex items-start gap-2 text-muted-foreground"><LockKeyhole size={13} className="mt-0.5 shrink-0"/>{verified?.role === 'nurse' ? 'Only authorised clinic access' : 'Other patient records stay private'}</li></ul></div></section><section className="side-section"><h2 className="flex items-center gap-2 text-sm font-semibold"><BookOpen size={17} className="text-primary"/>In your archive<span className="ml-auto text-xs font-normal text-muted-foreground">{availableDocs.length} documents</span></h2><div className="mt-4 space-y-4">{availableDocs.slice(0,3).map(d => <div key={d.id} className="flex items-start gap-2.5"><FileText size={16} className="mt-0.5 shrink-0 text-muted-foreground"/><div><p className="text-xs font-medium leading-5">{d.title}</p><p className="mt-1 text-[10px] text-muted-foreground">{d.category === 'public' ? 'Public information' : d.category === 'staff' ? 'Staff document' : 'Personal report'}</p></div></div>)}</div><Button variant="link" className="mt-4 h-11 px-0 text-xs" onClick={() => setTab('summaries')}>Browse your documents<ArrowRight/></Button></section><section className="side-section"><div className="flex gap-2.5"><CircleHelp size={19} className="mt-0.5 shrink-0 text-muted-foreground"/><div><h3 className="text-sm font-semibold">It’s okay if we don’t know.</h3><p className="mt-2 text-xs leading-6 text-muted-foreground">If the answer isn’t in your documents, we’ll say so. We won’t guess about your health.</p></div></div></section><section className="side-section border-0"><div className="flex gap-2.5"><HeartPulse size={19} className="shrink-0 text-warning"/><p className="text-[11px] leading-6 text-muted-foreground">For a health emergency, contact your nearest clinic. This archive does not replace a nurse or doctor.</p></div></section></aside></div>}
      {tab === 'summaries' && <div className="page-enter"><div className="mb-6"><h1 className="text-2xl font-semibold">Your documents, in simple words</h1><p className="mt-3 text-sm text-muted-foreground">{availableDocs.length} accessible documents · {mode ? 'Fictional demonstration archive' : 'Live summaries requested from your clinic'}</p></div><div className="document-list">{availableDocs.map(d => <article key={d.id} className="document-item"><div className="flex items-start gap-3"><div className="rounded-md bg-secondary p-2.5 text-primary"><FileText size={22}/></div><div className="min-w-0"><h2 className="text-sm font-semibold leading-6">{d.title}</h2><p className="mt-1 text-xs text-muted-foreground">{d.category === 'public' ? 'Public clinic information' : d.category === 'staff' ? 'Staff document' : 'Patient report'} · {mode ? d.date : 'Sample document ID'}</p></div></div><div className="mt-4 flex flex-wrap gap-2"><Button variant="clinic" size="touch" className="text-xs" disabled={busy} onClick={() => void run(`Summarize ${d.title}`, 'web', undefined, d.id)}><Sparkles/>Summarise This Document</Button>{mode && <Button variant="ghost" size="touch" className="text-xs" onClick={() => setSource({ doc_id: d.id, title: d.title, snippet: '', reference: d.code })}><BookOpen/>Preview</Button>}</div></article>)}</div><div className="mt-8"><h2 className="mb-3 text-sm font-semibold">Document summary</h2>{renderAnswer(summary)}</div></div>}
      {tab === 'phone' && <div><div className="mb-8"><h1 className="text-2xl font-semibold">Feature Phone (USSD & SMS)</h1><p className="mt-3 text-sm text-muted-foreground">Clinic answers, even without a smartphone.</p></div><FeaturePhone key={`${mode}-${selected.id}`} mode={mode} profile={verified} run={(q,c,p) => run(q,c,p)} liveUssd={async (session,text) => { try { return await callArchive(url, { action: 'ussd', user_id: verified?.id ?? selected.id, pin: verified?.pin ?? pin, channel: 'ussd', query: '', ussd_session_id: session, ussd_text: text }); } catch(e) { setError(e instanceof Error ? e.message : 'Phone service unavailable.'); return null; } }}/></div>}
      {tab === 'logs' && <div className="page-enter"><div className="mb-6 flex flex-wrap items-center justify-between gap-4"><div><h1 className="text-2xl font-semibold">Who Asked What</h1><p className="mt-3 text-sm text-muted-foreground">{mode ? 'Activity from this demo session. Switching profiles clears the view for privacy.' : 'Activity returned by your clinic service.'}</p></div>{!mode && <Button variant="outline" size="touch" disabled={busy} onClick={() => void fetchLogs()}><History/>Refresh history</Button>}</div>{logs.length ? <div className="overflow-x-auto rounded-md border border-border bg-card"><table className="audit-table"><thead><tr>{['Time', 'User / Role', 'Channel', 'Question', 'Status', 'Sources'].map(h => <th key={h}>{h}</th>)}</tr></thead><tbody>{logs.map((l,i) => <tr key={i}><td className="whitespace-nowrap">{new Date(l.timestamp).toLocaleTimeString([], {hour: '2-digit', minute: '2-digit'})}<div className="mt-1 text-[10px] text-muted-foreground">{new Date(l.timestamp).toLocaleDateString()}</div></td><td>{l.user_id}<div className="mt-1 text-[11px] capitalize text-muted-foreground">{l.role}</div></td><td>{l.channel}</td><td className="min-w-48 max-w-sm leading-6">{l.question}</td><td><span className={`rounded px-2 py-1 text-xs ${l.status === 'answered' ? 'bg-secondary text-primary' : 'bg-warning-surface text-warning'}`}>{l.status}</span></td><td>{Array.isArray(l.sources) ? l.sources.join(', ') || '—' : '—'}</td></tr>)}</tbody></table></div> : <div className="flex min-h-64 flex-col items-center justify-center border-y border-border text-center"><History size={35} className="text-primary"/><h2 className="mt-4 font-semibold">No questions yet</h2><p className="mt-2 text-sm text-muted-foreground">Your recent archive questions will appear here.</p></div>}</div>}
    </main><footer className="flex flex-wrap items-center justify-between gap-3 border-t border-border py-5 text-[11px] text-muted-foreground"><span className="flex items-center gap-1.5"><HeartPulse size={13}/>Made for care. Built on trust.</span><span className="flex items-center gap-1.5">{mode ? <><span className="h-1.5 w-1.5 rounded-full bg-warning"/>Demo archive · Fictional data only</> : <><span className="h-1.5 w-1.5 rounded-full bg-primary"/>Live API · Access enforced by clinic service</>}</span></footer></div>
    <Dialog open={settings} onOpenChange={setSettings}><DialogContent><DialogTitle>Clinic connection settings</DialogTitle><DialogDescription>Use Demo Mode for fictional sample documents, or connect your AWS clinic service.</DialogDescription><label htmlFor="api-url" className="mt-2 text-sm font-medium">AWS API Gateway URL</label><input id="api-url" type="url" value={url} onChange={e => { setUrl(e.target.value); setVerified(null); liveAuthorized.current = false; }} placeholder="https://your-clinic.execute-api.region.amazonaws.com/archive" className="h-12 w-full rounded-md border border-input bg-card px-3 text-sm"/><p className="text-xs leading-6 text-muted-foreground">Your service must allow requests from this app and check every ID, PIN, and document permission. Connection settings are not saved on this device.</p><div className="flex justify-end gap-2"><Button variant="outline" size="touch" onClick={() => { switchMode(true); setSettings(false); }}>Use Demo Mode</Button><Button variant="clinic" size="touch" disabled={!url.trim()} onClick={() => { switchMode(false); setSettings(false); }}>Use Live API<ArrowRight/></Button></div></DialogContent></Dialog>
    <Dialog open={!!source} onOpenChange={v => { if (!v) setSource(null); }}><DialogContent className="max-h-[85vh] max-w-2xl overflow-y-auto"><DialogTitle>{source?.title}</DialogTitle><DialogDescription>{source?.reference} · {mode ? 'Fictional demonstration document' : 'Source provided by the clinic service'}</DialogDescription>{mode && viewedDoc ? <div className="whitespace-pre-wrap rounded-md border border-border bg-muted/40 p-5 text-sm leading-8">{viewedDoc.text}</div> : source?.url ? <Button asChild variant="clinic" size="touch"><a href={source.url} target="_blank" rel="noreferrer">Open Source Document<ExternalLink/></a></Button> : <div className="text-sm leading-7"><blockquote>{source?.snippet}</blockquote><p className="mt-4 text-muted-foreground">The full source document is not available here. Ask the clinic for the original.</p></div>}</DialogContent></Dialog>
  </div>;
}
