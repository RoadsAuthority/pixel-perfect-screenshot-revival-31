import { createFileRoute } from '@tanstack/react-router';
import { useEffect, useRef, useState } from 'react';
import {
  AlertTriangle,
  BookOpen,
  CalendarDays,
  ClipboardList,
  FileText,
  FlaskConical,
  HeartPulse,
  History,
  LoaderCircle,
  LockKeyhole,
  LogIn,
  ListChecks,
  LogOut,
  MessageCircleQuestion,
  Radio,
  Mic,
  Search,
  Settings2,
  ShieldCheck,
  Siren,
  Smartphone,
  Sparkles,
  UserRound,
  X,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { FeaturePhone } from '@/components/feature-phone';
import { AlertBanner, AlertsPanel, EmergencyDialog, useAlertWatcher } from '@/components/emergency';
import { AnswerCard } from '@/components/answer-card';
import { DocumentViewer, MOBILE_FULLSCREEN, type ViewerTab } from '@/components/document-viewer';
import { useLiveShare, type LiveShare } from '@/hooks/use-live-share';
import {
  callArchive,
  normalizeAnswer,
  normalizeDocuments,
  type Answer,
  type ArchiveDoc,
  type AuditEntry,
  type Source,
} from '@/lib/archive';
import { staffGroups } from '@/lib/auth';
import { useAuth } from '@/hooks/use-auth';
import { DEFAULT_API_URL } from '@/lib/api-config';

export const Route = createFileRoute('/')({
  head: () => ({
    meta: [
      { title: 'Ask the Archive — Hopewell Community Clinic' },
      { name: 'description', content: 'Ask questions in plain language and get short answers linked to the clinic documents you are allowed to see.' },
      { name: 'theme-color', content: '#0f5a4c' },
      { property: 'og:title', content: 'Ask the Archive — Hopewell Community Clinic' },
      { property: 'og:description', content: 'Source-backed answers from clinic records, with access by role.' },
      { property: 'og:type', content: 'website' },
    ],
  }),
  component: Index,
});

type SpeechResult = { results: { [index: number]: { [index: number]: { transcript: string } } } };
type Recognition = { lang: string; interimResults: boolean; onresult: ((e: SpeechResult) => void) | null; onend: (() => void) | null; onerror: (() => void) | null; start: () => void; stop: () => void };
type SpeechWindow = Window & { SpeechRecognition?: new () => Recognition; webkitSpeechRecognition?: new () => Recognition };

type TabId = 'ask' | 'documents' | 'phone' | 'alerts' | 'logs';
const TABS: { id: TabId; label: string; short: string; icon: typeof FileText; signedIn: boolean; clinical: boolean }[] = [
  { id: 'ask', label: 'Ask', short: 'Ask', icon: MessageCircleQuestion, signedIn: false, clinical: false },
  { id: 'documents', label: 'Documents', short: 'Docs', icon: FileText, signedIn: false, clinical: false },
  { id: 'phone', label: 'Basic phone', short: 'Phone', icon: Smartphone, signedIn: false, clinical: false },
  { id: 'alerts', label: 'Urgent alerts', short: 'Alerts', icon: Siren, signedIn: true, clinical: true },
  { id: 'logs', label: 'History', short: 'History', icon: History, signedIn: true, clinical: false },
];

/** Quick questions per access group (see clinic-documents/TEST_QUESTIONS.md). */
const PROMPTS = {
  clinical: [
    { text: "What are Maria Nangolo's allergies?", icon: HeartPulse },
    { text: "What was Johannes Haufiku's HbA1c result?", icon: FlaskConical },
    { text: 'What is the adrenaline dose for anaphylaxis in an adult?', icon: AlertTriangle },
    { text: 'Has Tomas Amukoto had an emergency before? What was done?', icon: Siren },
  ],
  staff: [
    { text: 'Which contracts or leases expire next year?', icon: ClipboardList },
    { text: 'Which vaccines expire soonest?', icon: CalendarDays },
    { text: "What are Maria Nangolo's allergies?", icon: HeartPulse },
  ],
  patient: [
    { text: 'What allergies do I have?', icon: HeartPulse },
    { text: 'When is my next appointment or vaccine due?', icon: CalendarDays },
    { text: 'What were my latest test results?', icon: FlaskConical },
    { text: 'What happened in my last emergency?', icon: Siren },
  ],
  public: [
    { text: 'When is the next vaccination outreach clinic?', icon: CalendarDays },
    { text: 'What should I do if a baby is choking?', icon: AlertTriangle },
    { text: 'How do I treat a burn?', icon: BookOpen },
  ],
};

function promptsFor(groups: string[]) {
  if (groups.includes('Clinical')) return PROMPTS.clinical;
  if (groups.includes('Staff')) return PROMPTS.staff;
  if (groups.some((g) => g.startsWith('PAT-'))) return PROMPTS.patient;
  return PROMPTS.public;
}

/** Fictional demo accounts shown in the sign-in dialog. */
const DEMO_ACCOUNTS = [
  { label: 'Maria Nangolo · patient', id: 'PAT-001', pin: '1111' },
  { label: 'Johannes Haufiku · patient', id: 'PAT-002', pin: '2222' },
  { label: 'Loide Iipinge · parent', id: 'PAT-003', pin: '3333' },
  { label: 'Tomas Amukoto · patient (heart failure)', id: 'PAT-004', pin: '7777' },
  { label: 'Selma Amutenya · clerk', id: 'CLK-001', pin: '4444' },
  { label: 'Sister Ndapewa Haufiku · nurse', id: 'NUR-001', pin: '5555' },
  { label: 'Dr Anna-Marie van Wyk · doctor', id: 'DOC-001', pin: '6666' },
];

function roleLabel(groups: string[]): string {
  if (groups.includes('Clinical')) return 'Clinical staff';
  if (groups.includes('Staff')) return 'Clinic staff';
  if (groups.some((g) => g.startsWith('PAT-'))) return 'Patient';
  return 'Public';
}

function Index() {
  const { session, login, logout, loading: signingIn } = useAuth();

  // ── Connection ────────────────────────────────────────────────────────────
  const [url, setUrl] = useState(DEFAULT_API_URL);
  useEffect(() => { if (session?.api_url) setUrl(session.api_url); }, [session]);

  // ── UI state ──────────────────────────────────────────────────────────────
  const [tab, setTab] = useState<TabId>('ask');
  const [query, setQuery] = useState('');
  const [answer, setAnswer] = useState<Answer | null>(null);
  const [summary, setSummary] = useState<Answer | null>(null);
  const [summaryFor, setSummaryFor] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [logs, setLogs] = useState<AuditEntry[]>([]);
  const [docs, setDocs] = useState<ArchiveDoc[]>([]);
  const [docFilter, setDocFilter] = useState('');
  const [source, setSource] = useState<Source | null>(null);
  const [viewerTab, setViewerTab] = useState<ViewerTab>('text');
  const [liveShare, setLiveShare] = useState<LiveShare | null>(null);
  const live = useLiveShare(liveShare);
  const [listening, setListening] = useState(false);
  const [speaking, setSpeaking] = useState(false);
  const [voiceNotice, setVoiceNotice] = useState('');
  const [distress, setDistress] = useState(false);
  const [signInOpen, setSignInOpen] = useState(false);
  const [accountOpen, setAccountOpen] = useState(false);
  const [settings, setSettings] = useState(false);
  const [gateUserId, setGateUserId] = useState('');
  const [gatePin, setGatePin] = useState('');
  const [gateError, setGateError] = useState('');
  const recognition = useRef<Recognition | null>(null);
  const questionRef = useRef<HTMLTextAreaElement>(null);
  const summaryRef = useRef<HTMLDivElement>(null);

  useEffect(() => () => { recognition.current?.stop(); window.speechSynthesis?.cancel(); }, []);

  // Documents this user (or the public) may read, from the server.
  useEffect(() => {
    if (!url.trim()) { setDocs([]); return; }
    let cancelled = false;
    callArchive(url, { action: 'documents', user_id: session?.user_id ?? 'PUBLIC' }, session?.token)
      .then((data) => { if (!cancelled) setDocs(normalizeDocuments(data)); })
      .catch((e: unknown) => { if (!cancelled) { setDocs([]); setError(e instanceof Error ? e.message : 'Documents could not be loaded.'); } });
    return () => { cancelled = true; };
  }, [url, session]);

  const groups = staffGroups(session);
  const isClinical = groups.includes('Clinical');
  const alertWatch = useAlertWatcher(isClinical ? session : null, url);
  const openAlerts = alertWatch.alerts.filter((a) => a.status === 'open').length;
  const visibleTabs = TABS.filter((t) => (!t.signedIn || session) && (!t.clinical || isClinical));
  const docTypes = Array.from(new Set(docs.map((d) => d.type))).sort();
  const filteredDocs = docFilter
    ? docs.filter((d) => `${d.title} ${d.doc_id} ${d.type}`.toLowerCase().includes(docFilter.toLowerCase()))
    : docs;
  const prompts = promptsFor(groups);
  const firstName = session?.name.replace(/^(Dr|Sister|Nurse)\s+/, '').split(/[\s,]/)[0] ?? '';

  function go(next: TabId) {
    setTab(next); setError('');
    if (next === 'logs') void fetchLogs();
    window.scrollTo({ top: 0 });
  }

  // ── Sign in / out ─────────────────────────────────────────────────────────
  async function handleSignIn(e: React.FormEvent) {
    e.preventDefault();
    setGateError('');
    try {
      await login(url, gateUserId.trim().toUpperCase(), gatePin);
      setAnswer(null); setSummary(null); setLogs([]);
      setSignInOpen(false); setGateUserId(''); setGatePin('');
    } catch (err) {
      setGateError(err instanceof Error ? err.message : 'Sign-in failed.');
    }
  }

  function handleLogout() {
    logout();
    setAccountOpen(false);
    setAnswer(null); setSummary(null); setSource(null); setError(''); setLogs([]); setTab('ask');
    window.speechSynthesis?.cancel(); setSpeaking(false);
    recognition.current?.stop();
  }

  // ── Archive calls ─────────────────────────────────────────────────────────
  async function ask(question: string, channel: 'web' | 'voice' = 'web') {
    if (!question.trim() || busy) return;
    setBusy(true); setError('');
    try {
      const result = normalizeAnswer(await callArchive(url, { action: 'ask', user_id: session?.user_id ?? 'PUBLIC', channel, query: question }, session?.token));
      setAnswer(result);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'The clinic service could not be reached.');
    } finally { setBusy(false); }
  }

  async function summarise(doc: ArchiveDoc) {
    if (busy) return;
    setBusy(true); setError(''); setSummaryFor(doc.title);
    window.setTimeout(() => summaryRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 50);
    try {
      const result = normalizeAnswer(await callArchive(url, {
        action: 'summary', user_id: session?.user_id ?? 'PUBLIC', channel: 'web',
        query: `Summarise document ${doc.doc_id} (${doc.title}) in plain language.`, doc_id: doc.doc_id,
      }, session?.token));
      setSummary(result);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'The summary could not be made.');
    } finally { setBusy(false); }
  }

  async function fetchLogs() {
    if (!session) return;
    try {
      const data = await callArchive(url, { action: 'logs', user_id: session.user_id, channel: 'web', query: '' }, session.token);
      if (!Array.isArray(data['logs'])) throw new Error('The clinic service did not return a history.');
      setLogs(data['logs'] as AuditEntry[]);
    } catch (e) { setError(e instanceof Error ? e.message : 'History could not be loaded.'); }
  }

  // ── Voice ─────────────────────────────────────────────────────────────────
  function startVoice() {
    if (listening) { recognition.current?.stop(); return; }
    const sw = window as SpeechWindow;
    const Ctor = sw.SpeechRecognition ?? sw.webkitSpeechRecognition;
    if (!Ctor) { setVoiceNotice('Voice input is not supported in this browser. Please type your question.'); questionRef.current?.focus(); return; }
    const inst = new Ctor(); recognition.current = inst;
    inst.lang = 'en-ZA'; inst.interimResults = false;
    inst.onresult = (ev) => { const t = ev.results[0]?.[0]?.transcript; if (t) { setQuery(t); void ask(t, 'voice'); } };
    inst.onend = () => setListening(false);
    inst.onerror = () => { setListening(false); setVoiceNotice('Could not hear you. Check microphone permission or type instead.'); };
    try { inst.start(); setListening(true); setVoiceNotice(''); } catch { setVoiceNotice('The microphone could not start. Please type your question.'); }
  }

  function read(text: string) {
    if (!window.speechSynthesis) { setVoiceNotice('Read aloud is not available in this browser.'); return; }
    if (speaking) { window.speechSynthesis.cancel(); setSpeaking(false); return; }
    const u = new SpeechSynthesisUtterance(text); u.lang = 'en-ZA'; u.rate = 0.9;
    u.onend = () => setSpeaking(false); u.onerror = () => setSpeaking(false);
    setSpeaking(true); window.speechSynthesis.speak(u);
  }

  // ── Layout ────────────────────────────────────────────────────────────────
  return (
    <div className="min-h-[100dvh] bg-background pb-[calc(76px+env(safe-area-inset-bottom))] md:pb-0">
      <a href="#main" className="sr-only focus:not-sr-only focus:absolute focus:z-50 focus:bg-card focus:p-4">Skip to content</a>

      {/* Header */}
      <header className="sticky top-0 z-30 border-b border-border bg-card/95 backdrop-blur" style={{ paddingTop: 'env(safe-area-inset-top)' }}>
        <div className="mx-auto flex h-14 max-w-5xl items-center justify-between gap-2 px-4 md:h-16 md:px-6">
          <button type="button" onClick={() => go('ask')} className="flex min-w-0 items-center gap-2.5 text-left">
            <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-primary text-primary-foreground"><HeartPulse size={19} /></span>
            <span className="min-w-0">
              <span className="block truncate text-[15px] font-bold leading-tight">Ask the Archive</span>
              <span className="block truncate text-[11px] text-muted-foreground">Hopewell Community Clinic</span>
            </span>
          </button>

          <div className="flex shrink-0 items-center gap-2">
            <Button variant="destructive" size="sm" className="h-10 rounded-full px-4" onClick={() => setDistress(true)}>
              <Siren size={15} /> Emergency
            </Button>
            {session ? (
              <button
                type="button"
                onClick={() => setAccountOpen(true)}
                className="grid h-10 w-10 place-items-center rounded-full bg-secondary text-sm font-semibold text-primary ring-1 ring-border"
                aria-label={`Account: ${session.name}`}
              >
                {(firstName[0] ?? 'U').toUpperCase()}
              </button>
            ) : (
              <Button variant="outline" size="sm" className="h-10 rounded-full px-4" onClick={() => setSignInOpen(true)}>
                <LogIn size={15} /> <span className="hidden sm:inline">Sign in</span>
              </Button>
            )}
          </div>
        </div>

        {/* Desktop tabs */}
        <nav className="mx-auto hidden max-w-5xl gap-1 px-6 md:flex" aria-label="Sections">
          {visibleTabs.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => go(t.id)}
              aria-current={tab === t.id ? 'page' : undefined}
              className={`relative flex h-11 items-center gap-2 px-3 text-sm transition ${tab === t.id ? 'font-semibold text-primary' : 'text-muted-foreground hover:text-foreground'}`}
            >
              <t.icon size={16} /> {t.label}
              {t.id === 'alerts' && openAlerts > 0 && <span className="rounded-full bg-destructive px-1.5 text-[11px] text-destructive-foreground">{openAlerts}</span>}
              {tab === t.id && <span className="absolute inset-x-2 bottom-0 h-0.5 rounded-full bg-primary" />}
            </button>
          ))}
        </nav>
      </header>

      {isClinical && session && <AlertBanner watch={alertWatch} onView={() => go('alerts')} />}

      {liveShare && (
        <div role="status" className="border-b border-destructive/40 bg-destructive text-destructive-foreground">
          <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-2 px-4 py-2 text-sm md:px-6">
            <p className="flex items-center gap-2">
              <Radio size={16} className="animate-pulse" />
              Sharing your live location with the clinic{liveShare.simulation ? ' (demo simulation)' : ''}
              <span className="text-xs opacity-90">
                {live.lastSent ? `· last sent ${live.lastSent.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}` : '· starting…'}
                {live.error ? ` · ${live.error}` : ''}
              </span>
            </p>
            <Button size="sm" variant="secondary" onClick={() => setLiveShare(null)}>Stop sharing</Button>
          </div>
        </div>
      )}

      <main id="main" className="mx-auto max-w-5xl px-4 py-5 md:px-6 md:py-8">
        {error && (
          <div role="alert" className="mb-4 flex items-start gap-3 rounded-xl border border-warning/20 bg-warning-surface p-3 text-sm text-warning">
            <AlertTriangle size={18} className="mt-0.5 shrink-0" />
            <p className="flex-1">{error}</p>
            <button type="button" aria-label="Dismiss" onClick={() => setError('')}><X size={16} /></button>
          </div>
        )}

        {/* ── ASK ─────────────────────────────────────────────────────────── */}
        {tab === 'ask' && (
          <div className="page-enter grid gap-6 lg:grid-cols-[minmax(0,1fr)_280px]">
            <section className="space-y-5">
              <div>
                <h1 className="text-2xl font-semibold leading-tight md:text-[28px]">
                  {session ? `Hi ${firstName}, what would you like to know?` : 'What would you like to know?'}
                </h1>
                <p className="mt-1.5 text-sm text-muted-foreground">
                  {session ? `Signed in as ${roleLabel(groups).toLowerCase()} · answers only use records you may see.` : 'Ask about clinic hours, vaccinations or first aid. Sign in to ask about records.'}
                </p>
              </div>

              <form
                onSubmit={(e) => { e.preventDefault(); void ask(query); }}
                className="rounded-2xl border border-input bg-card p-3 shadow-sm focus-within:ring-2 focus-within:ring-ring"
              >
                <label htmlFor="question" className="sr-only">Your question</label>
                <textarea
                  ref={questionRef}
                  id="question"
                  rows={3}
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void ask(query); } }}
                  placeholder="Type your question…"
                  className="w-full resize-none bg-transparent px-2 py-1.5 text-base outline-none"
                  disabled={busy}
                />
                <div className="flex items-center justify-between gap-2 pt-2">
                  <Button type="button" variant={listening ? 'destructive' : 'secondary'} className="h-11 rounded-full px-4" onClick={startVoice} disabled={busy}>
                    <Mic size={17} /> {listening ? 'Listening…' : 'Speak'}
                  </Button>
                  <Button type="submit" variant="clinic" className="h-11 rounded-full px-5" disabled={busy || !query.trim()}>
                    {busy ? <LoaderCircle className="animate-spin" /> : <Sparkles size={16} />} {busy ? 'Checking…' : 'Ask'}
                  </Button>
                </div>
              </form>
              {voiceNotice && <p className="text-xs text-warning" role="status">{voiceNotice}</p>}

              <div className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 md:mx-0 md:flex-wrap md:overflow-visible md:px-0">
                {prompts.map((p) => (
                  <button
                    key={p.text}
                    type="button"
                    disabled={busy}
                    onClick={() => { setQuery(p.text); void ask(p.text); }}
                    className="flex shrink-0 items-center gap-2 rounded-full border border-border bg-card px-3.5 py-2 text-left text-[13px] shadow-sm transition hover:border-primary/40 disabled:opacity-60 md:shrink"
                  >
                    <p.icon size={15} className="shrink-0 text-primary" /> <span className="max-w-[16rem] truncate md:max-w-none md:whitespace-normal">{p.text}</span>
                  </button>
                ))}
              </div>

              <AnswerCard answer={answer} onOpenSource={(src) => { setViewerTab('text'); setSource(src); }} onListen={read} speaking={speaking} />
            </section>

            <aside className="space-y-4">
              <section className="rounded-2xl bg-secondary p-4">
                <h2 className="flex items-center gap-2 text-sm font-semibold text-primary"><ShieldCheck size={16} /> What you can see</h2>
                <ul className="mt-3 flex flex-wrap gap-1.5">
                  {docTypes.map((t) => <li key={t} className="rounded-full bg-card px-2.5 py-1 text-xs text-secondary-foreground">{t}</li>)}
                  {docTypes.length === 0 && <li className="text-xs text-muted-foreground">Connecting…</li>}
                </ul>
                <p className="mt-3 text-[11px] leading-5 text-muted-foreground">Other records are hidden by the server, not just by this screen.</p>
                {!session && (
                  <Button variant="outline" size="sm" className="mt-3 w-full" onClick={() => setSignInOpen(true)}><LogIn size={14} /> Sign in to see your records</Button>
                )}
              </section>
              <section className="rounded-2xl border border-border bg-card p-4 text-sm">
                <p className="font-semibold">We never guess.</p>
                <p className="mt-1 text-xs leading-5 text-muted-foreground">If the answer isn't in the records you can see, you'll get “I don't know”.</p>
              </section>
              <button
                type="button"
                onClick={() => setDistress(true)}
                className="flex w-full items-center gap-3 rounded-2xl border border-destructive/30 bg-destructive/5 p-4 text-left"
              >
                <Siren size={22} className="shrink-0 text-destructive" />
                <span>
                  <span className="block text-sm font-semibold text-destructive">Need urgent care?</span>
                  <span className="block text-xs leading-5 text-muted-foreground">Send your location and symptoms to the clinic and find the nearest hospital.</span>
                </span>
              </button>
            </aside>
          </div>
        )}

        {/* ── DOCUMENTS ───────────────────────────────────────────────────── */}
        {tab === 'documents' && (
          <div className="page-enter space-y-5">
            <div>
              <h1 className="text-2xl font-semibold">Documents</h1>
              <p className="mt-1 text-sm text-muted-foreground">{docs.length} documents you can open · tap “Summarise” for a short plain-language version.</p>
            </div>
            <label className="relative block">
              <span className="sr-only">Search documents</span>
              <Search size={16} className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <input
                type="search"
                value={docFilter}
                onChange={(e) => setDocFilter(e.target.value)}
                placeholder="Search by name, ID or type"
                className="h-12 w-full rounded-full border border-input bg-card pl-10 pr-4 text-base"
              />
            </label>

            {(summary || (busy && summaryFor)) && (
              <div ref={summaryRef} className="scroll-mt-20 space-y-2">
                <p className="text-xs font-medium text-muted-foreground">Summary of {summaryFor}</p>
                {busy && !summary ? (
                  <p className="flex items-center gap-2 rounded-2xl border border-border bg-card p-5 text-sm text-muted-foreground"><LoaderCircle size={16} className="animate-spin" /> Summarising…</p>
                ) : (
                  <AnswerCard answer={summary} onOpenSource={(src) => { setViewerTab('text'); setSource(src); }} onListen={read} speaking={speaking} />
                )}
              </div>
            )}

            <ul className="divide-y divide-border overflow-hidden rounded-2xl border border-border bg-card">
              {filteredDocs.map((d) => (
                <li key={d.doc_id} className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center">
                  <div className="flex min-w-0 flex-1 items-start gap-3">
                    <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-secondary text-primary"><FileText size={18} /></span>
                    <span className="min-w-0">
                      <span className="block text-sm font-medium leading-5">{d.title}</span>
                      <span className="block text-xs text-muted-foreground">{d.type} · {d.doc_id}{d.date ? ` · ${d.date}` : ''}</span>
                    </span>
                  </div>
                  <div className="flex gap-2 sm:shrink-0">
                    <Button variant="outline" size="sm" className="h-10 flex-1 rounded-full sm:flex-none" onClick={() => { setViewerTab('text'); setSource({ doc_id: d.doc_id, title: d.title, snippet: '', reference: d.doc_id, type: d.type, date: d.date, quotes: [] }); }}>
                      <BookOpen size={14} /> Open
                    </Button>
                    <Button variant="outline" size="sm" className="h-10 flex-1 rounded-full sm:flex-none" onClick={() => { setViewerTab('details'); setSource({ doc_id: d.doc_id, title: d.title, snippet: '', reference: d.doc_id, type: d.type, date: d.date, quotes: [] }); }}>
                      <ListChecks size={14} /> Key details
                    </Button>
                    <Button variant="clinic" size="sm" className="h-10 flex-1 rounded-full sm:flex-none" disabled={busy} onClick={() => { setSummary(null); void summarise(d); }}>
                      <Sparkles size={14} /> Summarise
                    </Button>
                  </div>
                </li>
              ))}
              {filteredDocs.length === 0 && <li className="p-6 text-center text-sm text-muted-foreground">No documents match.</li>}
            </ul>
          </div>
        )}

        {/* ── BASIC PHONE (USSD) ───────────────────────────────────────────── */}
        {tab === 'phone' && (
          <div className="page-enter">
            <h1 className="text-2xl font-semibold">Basic phone (USSD &amp; SMS)</h1>
            <p className="mb-6 mt-1 text-sm text-muted-foreground">Clinic answers without a smartphone. Dial, then sign in with your clinic ID and PIN.</p>
            <FeaturePhone
              key={session?.user_id ?? 'public'}
              liveUssd={async (phoneSession, text) => {
                try {
                  return await callArchive(url, { action: 'ussd', user_id: session?.user_id ?? 'PUBLIC', channel: 'ussd', query: '', ussd_session_id: phoneSession, ussd_text: text }, session?.token);
                } catch (e) {
                  setError(e instanceof Error ? e.message : 'Phone service unavailable.');
                  return null;
                }
              }}
            />
          </div>
        )}

        {/* ── URGENT ALERTS (clinical staff) ──────────────────────────────── */}
        {tab === 'alerts' && session && isClinical && <AlertsPanel session={session} url={url} watch={alertWatch} />}

        {/* ── HISTORY ─────────────────────────────────────────────────────── */}
        {tab === 'logs' && session && (
          <div className="page-enter space-y-5">
            <div className="flex flex-wrap items-end justify-between gap-3">
              <div>
                <h1 className="text-2xl font-semibold">History</h1>
                <p className="mt-1 text-sm text-muted-foreground">
                  {groups.includes('Staff') ? 'Every question asked in the archive (staff see all users).' : 'Your own questions, newest first.'}
                </p>
              </div>
              <Button variant="outline" size="sm" className="h-10 rounded-full" onClick={() => void fetchLogs()}><History size={14} /> Refresh</Button>
            </div>
            {logs.length === 0 ? (
              <p className="rounded-2xl border border-dashed border-border p-8 text-center text-sm text-muted-foreground">No questions yet.</p>
            ) : (
              <ul className="space-y-2">
                {logs.map((l, i) => {
                  const when = new Date(l.timestamp);
                  return (
                    <li key={`${l.timestamp}-${i}`} className="rounded-2xl border border-border bg-card p-4">
                      <div className="flex items-start justify-between gap-3">
                        <p className="text-sm font-medium leading-5">{l.question}</p>
                        <span className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] ${l.status === 'answered' ? 'bg-secondary text-primary' : 'bg-warning-surface text-warning'}`}>
                          {l.status === 'answered' ? 'Answered' : "Didn't know"}
                        </span>
                      </div>
                      <p className="mt-2 text-xs text-muted-foreground">
                        {when.toLocaleDateString()} {when.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} · {l.user_id} · {l.channel}
                        {Array.isArray(l.sources) && l.sources.length ? ` · ${l.sources.join(', ')}` : ''}
                      </p>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        )}

        <footer className="mt-10 flex flex-wrap items-center justify-between gap-2 border-t border-border pt-4 text-[11px] text-muted-foreground">
          <span>Fictional demonstration records · access enforced by the clinic service</span>
          <button type="button" className="inline-flex items-center gap-1 underline-offset-2 hover:underline" onClick={() => setSettings(true)}>
            <Settings2 size={12} /> Connection
          </button>
        </footer>
      </main>

      {/* Mobile bottom navigation */}
      <nav
        className="fixed inset-x-0 bottom-0 z-30 border-t border-border bg-card/95 backdrop-blur md:hidden"
        style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
        aria-label="Sections"
      >
        <div className="mx-auto grid max-w-md" style={{ gridTemplateColumns: `repeat(${visibleTabs.length}, minmax(0, 1fr))` }}>
          {visibleTabs.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => go(t.id)}
              aria-current={tab === t.id ? 'page' : undefined}
              className={`relative flex h-16 flex-col items-center justify-center gap-1 text-[11px] ${tab === t.id ? 'font-semibold text-primary' : 'text-muted-foreground'}`}
            >
              <span className={`grid h-7 w-12 place-items-center rounded-full ${tab === t.id ? 'bg-secondary' : ''}`}><t.icon size={19} /></span>
              {t.short}
              {t.id === 'alerts' && openAlerts > 0 && (
                <span className="absolute right-[calc(50%-22px)] top-1.5 grid h-4 min-w-4 place-items-center rounded-full bg-destructive px-1 text-[10px] text-destructive-foreground">{openAlerts}</span>
              )}
            </button>
          ))}
        </div>
      </nav>

      {/* ── Dialogs ───────────────────────────────────────────────────────── */}
      <DocumentViewer source={source} onClose={() => { setSource(null); setViewerTab('text'); }} url={url} token={session?.token} userId={session?.user_id ?? 'PUBLIC'} initialTab={viewerTab} />

      <EmergencyDialog open={distress} onOpenChange={setDistress} session={session} url={url} onSent={setLiveShare} />

      <Dialog open={signInOpen} onOpenChange={(v) => { setSignInOpen(v); setGateError(''); }}>
        <DialogContent className={`max-w-sm ${MOBILE_FULLSCREEN} max-sm:content-start`}>
          <DialogTitle className="flex items-center gap-2"><LockKeyhole size={18} className="text-primary" /> Sign in</DialogTitle>
          <DialogDescription>Patients see their own records. Staff see what their role allows.</DialogDescription>
          <form onSubmit={(e) => { void handleSignIn(e); }} className="space-y-3">
            <label className="block text-sm font-medium">Clinic ID
              <input value={gateUserId} onChange={(e) => setGateUserId(e.target.value)} autoComplete="username" autoCapitalize="characters" placeholder="e.g. PAT-001" className="mt-1.5 h-12 w-full rounded-xl border border-input bg-card px-3 text-base" required />
            </label>
            <label className="block text-sm font-medium">PIN
              <input value={gatePin} onChange={(e) => setGatePin(e.target.value)} type="password" inputMode="numeric" maxLength={4} autoComplete="current-password" placeholder="4 digits" className="mt-1.5 h-12 w-full rounded-xl border border-input bg-card px-3 text-base" required />
            </label>
            {gateError && <p className="rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive" role="alert">{gateError}</p>}
            <Button type="submit" variant="clinic" className="h-12 w-full rounded-full text-base" disabled={signingIn || !gateUserId.trim() || !gatePin.trim()}>
              {signingIn ? <LoaderCircle className="animate-spin" /> : <LogIn size={16} />} {signingIn ? 'Checking…' : 'Sign in'}
            </Button>
          </form>
          <details className="rounded-xl border border-border bg-muted/40 p-3 text-xs">
            <summary className="cursor-pointer font-medium text-muted-foreground">Demo accounts (fictional)</summary>
            <ul className="mt-2 space-y-1">
              {DEMO_ACCOUNTS.map((a) => (
                <li key={a.id}>
                  <button type="button" className="flex w-full justify-between gap-2 rounded-lg px-2 py-1.5 text-left hover:bg-card" onClick={() => { setGateUserId(a.id); setGatePin(a.pin); }}>
                    <span>{a.label}</span><span className="font-mono text-foreground">{a.id} · {a.pin}</span>
                  </button>
                </li>
              ))}
            </ul>
          </details>
        </DialogContent>
      </Dialog>

      <Dialog open={accountOpen} onOpenChange={setAccountOpen}>
        <DialogContent className="max-w-sm">
          <DialogTitle className="flex items-center gap-2"><UserRound size={18} className="text-primary" /> {session?.name}</DialogTitle>
          <DialogDescription>{session?.user_id} · {roleLabel(groups)}</DialogDescription>
          <div className="rounded-xl bg-secondary p-3 text-xs leading-5 text-secondary-foreground">
            <p className="font-medium">You can see</p>
            <p className="mt-1">{session?.scope}</p>
          </div>
          <Button variant="outline" className="h-11 w-full rounded-full" onClick={handleLogout}><LogOut size={15} /> Sign out</Button>
        </DialogContent>
      </Dialog>

      <Dialog open={settings} onOpenChange={setSettings}>
        <DialogContent className="max-w-md">
          <DialogTitle className="flex items-center gap-2"><Settings2 size={18} className="text-primary" /> Connection</DialogTitle>
          <DialogDescription>The clinic archive service this app talks to. Not saved on this device.</DialogDescription>
          <input
            type="url"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            disabled={!!session}
            className="h-12 w-full rounded-xl border border-input bg-card px-3 text-sm"
          />
          {session && <p className="text-xs text-muted-foreground">Sign out to change the connection.</p>}
          <Button variant="clinic" className="h-11 rounded-full" onClick={() => setSettings(false)}>Done</Button>
        </DialogContent>
      </Dialog>
    </div>
  );
}
