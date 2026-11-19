import { createFileRoute } from '@tanstack/react-router';
import { Fragment, useEffect, useRef, useState } from 'react';
import {
  AlertTriangle,
  ArrowRight,
  AudioLines,
  BookOpen,
  CalendarDays,
  Check,
  CheckCircle2,
  ChevronRight,
  CircleHelp,
  ClipboardList,
  Eye,
  EyeOff,
  FileText,
  FlaskConical,
  HeartPulse,
  History,
  LoaderCircle,
  LockKeyhole,
  LogIn,
  LogOut,
  MapPin,
  Mic,
  Settings2,
  Siren,
  ShieldCheck,
  Smartphone,
  Sparkles,
  Volume2,
  X,
  ExternalLink,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { FeaturePhone } from '@/components/feature-phone';
import { AlertsPanel, EmergencyDialog } from '@/components/emergency';
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
      { name: 'description', content: 'Ask questions in plain language and get answers linked to the clinic documents you are allowed to see.' },
      { property: 'og:title', content: 'Ask the Archive — Hopewell Community Clinic' },
      { property: 'og:description', content: 'Source-backed answers from clinic records, with access by staff role.' },
      { property: 'og:type', content: 'website' },
      { name: 'twitter:card', content: 'summary_large_image' },
    ],
  }),
  component: Index,
});

type SpeechResult = { results: { [index: number]: { [index: number]: { transcript: string } } } };
type Recognition = { lang: string; interimResults: boolean; onresult: ((e: SpeechResult) => void) | null; onend: (() => void) | null; onerror: (() => void) | null; start: () => void; stop: () => void };
type SpeechWindow = Window & { SpeechRecognition?: new () => Recognition; webkitSpeechRecognition?: new () => Recognition };

const ALL_TABS = [
  { id: 'ask', label: 'Simple Ask & Voice', icon: AudioLines, signedIn: false, clinical: false },
  { id: 'summaries', label: 'Document Summaries', icon: FileText, signedIn: false, clinical: false },
  { id: 'phone', label: 'Feature Phone', icon: Smartphone, signedIn: false, clinical: false },
  { id: 'alerts', label: 'Urgent Alerts', icon: Siren, signedIn: true, clinical: true },
  { id: 'logs', label: 'Who Asked What', icon: History, signedIn: true, clinical: false },
] as const;

type TabId = (typeof ALL_TABS)[number]['id'];

/** Quick questions per access group (see clinic-documents/TEST_QUESTIONS.md). */
const STAFF_PROMPTS = [
  { text: 'Which contracts or leases expire next year?', icon: ClipboardList },
  { text: 'Which vaccines expire soonest?', icon: CalendarDays },
  { text: "What are Maria Nangolo's allergies?", icon: HeartPulse },
];
const CLINICAL_PROMPTS = [
  { text: "What are Maria Nangolo's allergies?", icon: HeartPulse },
  { text: "What was Johannes Haufiku's HbA1c result?", icon: FlaskConical },
  { text: 'What is the dose of adrenaline for anaphylaxis in an adult?', icon: AlertTriangle },
];
const PATIENT_PROMPTS = [
  { text: 'What allergies do I have?', icon: HeartPulse },
  { text: 'When is my next appointment or vaccine due?', icon: CalendarDays },
  { text: 'What were my latest test results?', icon: FlaskConical },
];
const PUBLIC_PROMPTS = [
  { text: 'When is the next vaccination outreach clinic?', icon: CalendarDays },
  { text: 'What should I do if a baby is choking?', icon: AlertTriangle },
  { text: 'How do I treat a burn?', icon: BookOpen },
];

function promptsFor(groups: string[]) {
  if (groups.includes('Clinical')) return CLINICAL_PROMPTS;
  if (groups.includes('Staff')) return STAFF_PROMPTS;
  if (groups.some((g) => g.startsWith('PAT-'))) return PATIENT_PROMPTS;
  return PUBLIC_PROMPTS;
}

/** Fictional demo accounts shown in the sign-in dialog. */
const DEMO_ACCOUNTS = [
  { label: 'Maria Nangolo · patient', id: 'PAT-001', pin: '1111' },
  { label: 'Johannes Haufiku · patient', id: 'PAT-002', pin: '2222' },
  { label: 'Loide Iipinge · parent', id: 'PAT-003', pin: '3333' },
  { label: 'Selma Amutenya · clerk', id: 'CLK-001', pin: '4444' },
  { label: 'Sister Ndapewa Haufiku · nurse', id: 'NUR-001', pin: '5555' },
  { label: 'Dr Anna-Marie van Wyk · doctor', id: 'DOC-001', pin: '6666' },
];

function Index() {
  const { session, login, logout } = useAuth();

  // ── Connection ────────────────────────────────────────────────────────────
  const [url, setUrl] = useState(DEFAULT_API_URL);
  const [settings, setSettings] = useState(false);

  // ── Sign-in gate ──────────────────────────────────────────────────────────
  const [gateUserId, setGateUserId] = useState('');
  const [gatePin, setGatePin] = useState('');
  const [gateError, setGateError] = useState('');
  const [gateOpen, setGateOpen] = useState(false);

  // ── UI state ──────────────────────────────────────────────────────────────
  const [tab, setTab] = useState<TabId>('ask');
  const [privacyBlur, setPrivacyBlur] = useState(false);
  const [query, setQuery] = useState('');
  const [answer, setAnswer] = useState<Answer | null>(null);
  const [summary, setSummary] = useState<Answer | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [logs, setLogs] = useState<AuditEntry[]>([]);
  const [docs, setDocs] = useState<ArchiveDoc[]>([]);
  const [docFilter, setDocFilter] = useState('');
  const [source, setSource] = useState<Source | null>(null);
  const [listening, setListening] = useState(false);
  const [speaking, setSpeaking] = useState(false);
  const [voiceNotice, setVoiceNotice] = useState('');
  const [distress, setDistress] = useState(false);
  const recognition = useRef<Recognition | null>(null);
  const questionRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => () => { recognition.current?.stop(); window.speechSynthesis?.cancel(); }, []);

  // A session verified via /login carries its API URL: use it.
  useEffect(() => { if (session?.api_url) setUrl(session.api_url); }, [session]);

  // Load the documents this user (or the public) may read, from the server.
  useEffect(() => {
    if (!url.trim()) { setDocs([]); return; }
    let cancelled = false;
    callArchive(url, { action: 'documents', user_id: session?.user_id ?? 'PUBLIC' }, session?.token)
      .then((data) => { if (!cancelled) setDocs(normalizeDocuments(data)); })
      .catch((e: unknown) => { if (!cancelled) { setDocs([]); setError(e instanceof Error ? e.message : 'Documents could not be loaded.'); } });
    return () => { cancelled = true; };
  }, [url, session]);

  const groups = staffGroups(session);
  const visibleTabs = ALL_TABS.filter((t) => (!t.signedIn || session) && (!t.clinical || groups.includes('Clinical')));
  const docTypes = Array.from(new Set(docs.map((d) => d.type))).sort();
  const filteredDocs = docFilter ? docs.filter((d) => `${d.title} ${d.doc_id} ${d.type}`.toLowerCase().includes(docFilter.toLowerCase())) : docs;

  // ── Auth helpers ──────────────────────────────────────────────────────────
  function handleLogout() {
    logout();
    setAnswer(null); setSummary(null); setSource(null);
    setError(''); setLogs([]); setTab('ask');
    window.speechSynthesis?.cancel(); setSpeaking(false);
    recognition.current?.stop();
  }

  async function handleGateSubmit(e: React.FormEvent) {
    e.preventDefault();
    setGateError('');
    if (!url.trim()) { setGateOpen(false); setSettings(true); return; }
    try {
      await login(url, gateUserId.trim().toUpperCase(), gatePin);
      setAnswer(null); setSummary(null); setLogs([]);
      setGateOpen(false); setGateUserId(''); setGatePin('');
    } catch (err) {
      setGateError(err instanceof Error ? err.message : 'Sign-in failed.');
    }
  }

  // ── Archive call ──────────────────────────────────────────────────────────
  async function run(question: string, channel: 'web' | 'voice' = 'web', docId?: string): Promise<Answer | null> {
    if (!question.trim() || busy) return null;
    setBusy(true); setError('');
    try {
      const user_id = session?.user_id ?? 'PUBLIC';
      const request = docId
        ? { action: 'summary' as const, user_id, channel, query: question, doc_id: docId }
        : { action: 'ask' as const, user_id, channel, query: question };
      const result = normalizeAnswer(await callArchive(url, request, session?.token));
      if (docId) setSummary(result); else setAnswer(result);
      return result;
    } catch (e) {
      setError(e instanceof Error ? e.message : 'The clinic service could not be reached.');
      return null;
    } finally { setBusy(false); }
  }

  async function fetchLogs() {
    if (!session) { setError('Sign in to see the question history.'); return; }
    setBusy(true); setError('');
    try {
      const data = await callArchive(url, { action: 'logs', user_id: session.user_id, channel: 'web', query: '' }, session.token);
      if (!Array.isArray(data['logs'])) throw new Error('The clinic service did not return an audit log.');
      setLogs(data['logs'] as AuditEntry[]);
    } catch (e) { setError(e instanceof Error ? e.message : 'History could not be loaded.'); }
    finally { setBusy(false); }
  }

  // ── Voice ─────────────────────────────────────────────────────────────────
  function startVoice() {
    if (listening) { recognition.current?.stop(); return; }
    const sw = window as SpeechWindow;
    const Ctor = sw.SpeechRecognition ?? sw.webkitSpeechRecognition;
    if (!Ctor) { setVoiceNotice('Voice input is not supported in this browser. Type your question instead.'); questionRef.current?.focus(); return; }
    const inst = new Ctor(); recognition.current = inst;
    inst.lang = 'en-ZA'; inst.interimResults = false;
    inst.onresult = (ev) => { const t = ev.results[0]?.[0]?.transcript; if (t) { setQuery(t); void run(t, 'voice'); } };
    inst.onend = () => setListening(false);
    inst.onerror = () => { setListening(false); setVoiceNotice('Could not hear your question. Check microphone permission or type it below.'); };
    try { inst.start(); setListening(true); setVoiceNotice(''); } catch { setVoiceNotice('The microphone could not start. Please type your question.'); }
  }

  function read(text: string) {
    if (!window.speechSynthesis) { setVoiceNotice('Read aloud is unavailable in this browser.'); return; }
    if (speaking) { window.speechSynthesis.cancel(); setSpeaking(false); return; }
    const u = new SpeechSynthesisUtterance(text); u.lang = 'en-ZA'; u.rate = 0.9;
    u.onend = () => setSpeaking(false); u.onerror = () => setSpeaking(false);
    setSpeaking(true); window.speechSynthesis.speak(u);
  }

  // ── Group-aware quick prompts ─────────────────────────────────────────────
  const prompts = [
    ...promptsFor(groups),
    { text: 'Summarize a document', icon: FileText },
  ];

  // ── Answer renderer ───────────────────────────────────────────────────────
  function renderAnswer(result: Answer | null) {
    const blurClass = privacyBlur ? 'select-none blur-sm transition-all' : 'transition-all';
    if (!result) {
      return (
        <div className="answer-card empty-answer">
          <div className="archive-visual" aria-hidden="true">
            <FileText strokeWidth={1.3} /><FileText strokeWidth={1.3} />
          </div>
          <h3 className="text-base font-semibold">Your answer will appear here</h3>
          <p className="mt-2 max-w-sm text-sm leading-6 text-muted-foreground">
            Ask a question above. We'll show a simple answer and the document it came from.
          </p>
          <div className="mt-5 flex items-center gap-1.5 text-xs text-muted-foreground">
            <ShieldCheck size={14} /> Only information you're allowed to see
          </div>
        </div>
      );
    }
    return (
      <div className="answer-card" aria-live="polite">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-5 py-4">
          <div className={`flex items-center gap-2 text-sm font-semibold ${result.is_unknown ? 'text-warning' : 'text-primary'}`}>
            {result.is_unknown ? <CircleHelp size={19} /> : <CheckCircle2 size={19} />}
            {result.is_unknown ? "I don't know" : 'From the clinic archive'}
          </div>
          <div className="flex items-center gap-2">
            {privacyBlur && (
              <span className="flex items-center gap-1 rounded-full bg-warning-surface px-2.5 py-1 text-[11px] text-warning">
                <EyeOff size={12} /> Blurred
              </span>
            )}
            <Button variant="ghost" size="touch" onClick={() => read(result.answer)}>
              <Volume2 /> {speaking ? 'Stop' : 'Listen'}
            </Button>
          </div>
        </div>
        <p className={`px-5 py-5 text-base leading-8 ${blurClass}`}>{result.answer}</p>
        {result.sources.map((s, i) => (
          <div key={`${s.doc_id}-${i}`} className={`border-t border-border bg-muted/40 px-5 py-4 ${blurClass}`}>
            <div className="mb-2 flex items-start gap-2 text-xs font-semibold text-primary">
              <FileText size={15} />
              {s.title}
              <span className="ml-auto shrink-0 font-normal text-muted-foreground">{s.reference}</span>
            </div>
            <blockquote className="border-l-2 border-primary/30 pl-3 text-sm leading-6 text-muted-foreground">
              "{s.snippet}"
            </blockquote>
            <Button variant="link" className="mt-2 h-11 px-0 text-xs" onClick={() => setSource(s)}>
              View Source Document <ArrowRight />
            </Button>
          </div>
        ))}
      </div>
    );
  }

  return (
    <div className="min-h-screen">
      <a href="#main-workspace" className="sr-only focus:not-sr-only focus:absolute focus:z-50 focus:bg-card focus:p-4">
        Skip to questions
      </a>

      {/* ── HEADER ─────────────────────────────────────────────────────────── */}
      <header className="sticky top-0 z-30 border-b border-border bg-card/95 backdrop-blur-sm">
        <div className="app-shell flex h-16 items-center justify-between gap-3">
          {/* Brand */}
          <div className="flex items-center gap-2.5 shrink-0">
            <div className="brand-mark !h-9 !w-9">
              <HeartPulse size={20} />
            </div>
            <div>
              <div className="text-base font-bold leading-tight">
                Ask the Archive<span className="text-primary">.</span>
              </div>
              <div className="text-[10px] font-medium uppercase tracking-widest text-muted-foreground">
                Hopewell Community Clinic
              </div>
            </div>
          </div>

          {/* Right side — changes based on auth state */}
          <div className="flex items-center gap-2">
            {session ? (
              <>
                {/* Active user badge */}
                <span className="hidden items-center gap-1.5 rounded-full bg-secondary px-3 py-1.5 text-xs font-medium text-primary sm:flex">
                  <ShieldCheck size={12} />
                  {session.name}
                  <span className="rounded bg-primary/10 px-1.5 py-0.5 text-[10px] capitalize">
                    {groups.join(' · ')}
                  </span>
                </span>
                {/* Privacy blur toggle */}
                <Button
                  variant="ghost"
                  size="touch"
                  className="hidden gap-1.5 text-xs sm:flex"
                  aria-pressed={privacyBlur}
                  onClick={() => setPrivacyBlur((v) => !v)}
                  title={privacyBlur ? 'Disable privacy blur' : 'Enable privacy blur'}
                >
                  {privacyBlur ? <EyeOff size={15} /> : <Eye size={15} />}
                  <span className="hidden md:inline">{privacyBlur ? 'Unblur' : 'Privacy Blur'}</span>
                </Button>
                {/* Lock / sign out */}
                <Button
                  variant="outline"
                  size="touch"
                  className="text-xs"
                  onClick={handleLogout}
                  title="Lock and sign out"
                >
                  <LogOut size={14} />
                  <span className="hidden sm:inline">Lock</span>
                </Button>
              </>
            ) : (
              <>
                <Button
                  variant="outline"
                  size="touch"
                  className="text-xs"
                  onClick={() => setGateOpen(true)}
                >
                  <LogIn size={14} /> Sign in
                </Button>
              </>
            )}
            <Button
              variant="destructive"
              size="touch"
              className="text-xs"
              onClick={() => setDistress(true)}
            >
              <Siren size={14} /> <span className="hidden sm:inline">Emergency</span>
            </Button>
            <Button
              aria-label="Connection settings"
              variant="ghost"
              size="icon"
              onClick={() => setSettings(true)}
            >
              <Settings2 size={18} />
            </Button>
          </div>
        </div>

        {/* Access scope bar — shown only when signed in */}
        {session && (
          <div className="border-t border-border bg-secondary/40">
            <div className="app-shell flex items-center justify-between gap-3 py-2">
              <div className="flex items-center gap-2 text-xs">
                <ShieldCheck size={13} className="text-primary" />
                <span className="text-muted-foreground">Access scope:</span>
                <span className="font-medium text-primary">{session.scope}</span>
              </div>
            </div>
          </div>
        )}
      </header>

      {/* ── SIGN-IN GATE (shown when not signed in, above workspace) ───────── */}
      {!session && (
        <section className="border-b border-border bg-gradient-to-b from-secondary/60 to-card/20">
          <div className="app-shell py-8">
            <div className="mx-auto max-w-sm text-center">
              <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-secondary">
                <LockKeyhole size={22} className="text-primary" />
              </div>
              <h2 className="text-lg font-semibold">Sign in to see clinic records</h2>
              <p className="mt-1.5 text-sm text-muted-foreground">
                Clinic hours, vaccination dates and emergency guides are open to everyone. Sign in with your clinic ID and PIN to see your own records, or the records your staff role allows.
              </p>
              <div className="mt-5 flex flex-wrap justify-center gap-3">
                <Button variant="clinic" size="touch" onClick={() => setGateOpen(true)}>
                  <LogIn size={15} /> Sign in with ID & PIN
                </Button>
                <Button variant="outline" size="touch" onClick={() => setTab('ask')}>
                  Continue as public
                </Button>
              </div>
            </div>
          </div>
        </section>
      )}

      {/* ── WORKSPACE ─────────────────────────────────────────────────────── */}
      <div className="app-shell">
        <nav className="workspace-tabs" role="tablist" aria-label="Clinic workspace">
          {visibleTabs.map((t) => (
            <Button
              key={t.id}
              id={`tab-${t.id}`}
              role="tab"
              aria-selected={tab === t.id}
              aria-controls="main-workspace"
              variant="ghost"
              className="workspace-tab"
              onClick={() => {
                setTab(t.id);
                setError('');
                if (t.id === 'logs') void fetchLogs();
              }}
            >
              <t.icon size={17} />
              {t.label}
              {t.id === 'logs' && logs.length > 0 && (
                <span className="rounded bg-secondary px-1.5 py-0.5 text-[10px] text-primary">
                  {logs.length}
                </span>
              )}
            </Button>
          ))}
        </nav>

        <main id="main-workspace" role="tabpanel" aria-labelledby={`tab-${tab}`} className="pb-10 pt-8">
          {error && (
            <div role="alert" className="mb-5 flex items-start gap-3 rounded-md border border-warning/20 bg-warning-surface p-4 text-sm text-warning">
              <CircleHelp size={19} />
              <p className="flex-1">{error}</p>
              <Button aria-label="Dismiss error" variant="ghost" size="icon" onClick={() => setError('')}><X /></Button>
            </div>
          )}

          {/* ── ASK TAB ──────────────────────────────────────────────────── */}
          {tab === 'ask' && (
            <div className="ask-grid page-enter">
              {/* Left column */}
              <section className="space-y-6">
                {/* Question card */}
                <div className="rounded-xl border border-border bg-card p-6 shadow-sm">
                  <div className="mb-4">
                    <div className="mb-1.5 flex items-center gap-2 text-xs font-medium text-primary">
                      <span className="h-1.5 w-1.5 rounded-full bg-primary" />
                      A LITTLE CLARITY, WHEN YOU NEED IT
                    </div>
                    <h1 className="text-[26px] font-semibold leading-tight">
                      What would you like to know?
                    </h1>
                    <p className="mt-2 text-sm leading-6 text-muted-foreground">
                      Ask about vaccinations, emergencies, your records or clinic operations. Every answer links to its source.
                    </p>
                  </div>

                  <form onSubmit={(e) => { e.preventDefault(); void run(query); }}>
                    <label htmlFor="question" className="mb-2 block text-sm font-medium">
                      Your question
                    </label>
                    <div className="question-box">
                      <textarea
                        ref={questionRef}
                        id="question"
                        placeholder="For example, when is the next vaccination outreach clinic?"
                        value={query}
                        onChange={(e) => setQuery(e.target.value)}
                        disabled={busy}
                      />
                      <div className="question-toolbar">
                        <Button
                          type="button"
                          variant="ghost"
                          size="touch"
                          className="px-2 text-sm text-primary"
                          disabled={busy}
                          onClick={startVoice}
                        >
                          <Mic />
                          {listening ? 'Listening… Tap to stop' : 'Tap to Speak'}
                        </Button>
                        <Button
                          variant="clinic"
                          size="touch"
                          type="submit"
                          disabled={busy || !query.trim()}
                        >
                          {busy ? <LoaderCircle className="animate-spin" /> : <Sparkles />}
                          {busy ? 'Checking archive…' : 'Ask the Archive'}
                          <ArrowRight />
                        </Button>
                      </div>
                    </div>
                  </form>

                  {voiceNotice && (
                    <p className="mt-3 text-xs leading-6 text-warning" role="status">
                      {voiceNotice}
                    </p>
                  )}

                  <div className="mb-3 mt-5 text-xs font-medium text-muted-foreground">
                    OR, START WITH A QUESTION
                  </div>
                  <div className="prompt-grid">
                    {prompts.map((p) => (
                      <Button
                        key={p.text}
                        variant="ghost"
                        className="prompt"
                        disabled={busy}
                        onClick={() => {
                          if (p.text === 'Summarize a document') { setTab('summaries'); setError(''); }
                          else { setQuery(p.text); void run(p.text); }
                        }}
                      >
                        <p.icon size={18} />
                        <span>{p.text}</span>
                        <ChevronRight className="prompt-arrow size-4" />
                      </Button>
                    ))}
                  </div>
                </div>

                {/* Answer card */}
                <div>
                  <div className="mb-3 flex items-center justify-between">
                    <h2 className="text-sm font-semibold">Your answer</h2>
                    <span className="flex items-center gap-1 text-[11px] text-muted-foreground">
                      <BookOpen size={13} /> Backed by source documents
                    </span>
                  </div>
                  {renderAnswer(answer)}
                </div>

                {/* Emergency distress trigger */}
                <div className="rounded-xl border border-destructive/20 bg-destructive/5 p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex items-start gap-2.5">
                      <AlertTriangle size={18} className="mt-0.5 shrink-0 text-destructive" />
                      <div>
                        <h3 className="text-sm font-semibold text-destructive">Need urgent care?</h3>
                        <p className="mt-1 text-xs leading-5 text-muted-foreground">
                          Chronic illness getting worse, or an emergency? Send your location and what is happening to the clinic, and see the nearest hospital.
                        </p>
                      </div>
                    </div>
                    <Button
                      variant="outline"
                      size="touch"
                      className="shrink-0 border-destructive/30 text-xs text-destructive hover:bg-destructive/10"
                      onClick={() => setDistress(true)}
                    >
                      <Siren size={14} /> Get urgent help
                    </Button>
                  </div>
                </div>
              </section>

              {/* Right column */}
              <aside className="ask-sidebar">
                {/* Access status */}
                <section className="side-section">
                  <div className="scope-box">
                    <div className="flex items-center gap-2 text-sm font-semibold text-primary">
                      <ShieldCheck size={18} /> Your information, protected
                    </div>
                    <p className="mt-3 text-xs leading-6 text-secondary-foreground">
                      {session ? `${session.name} can see:` : 'Until you sign in, you can see:'}
                    </p>
                    <ul className="mt-2 space-y-2.5 text-xs text-secondary-foreground">
                      {docTypes.map((t) => (
                        <li key={t} className="flex items-center gap-2"><Check size={14} /> {t}</li>
                      ))}
                      {docTypes.length === 0 && <li className="text-muted-foreground">Connecting to the clinic archive…</li>}
                      <li className="flex items-start gap-2 text-muted-foreground">
                        <LockKeyhole size={13} className="mt-0.5 shrink-0" />
                        Other records are hidden by the server, not just by this screen
                      </li>
                    </ul>
                    {!session && (
                      <Button
                        variant="outline"
                        size="touch"
                        className="mt-4 w-full text-xs"
                        onClick={() => setGateOpen(true)}
                      >
                        <LogIn size={13} /> Sign in to see clinic records
                      </Button>
                    )}
                  </div>
                </section>

                {/* Accessible archive files — only shown when signed in */}
                {session && (
                  <section className="side-section">
                    <h2 className="flex items-center gap-2 text-sm font-semibold">
                      <BookOpen size={17} className="text-primary" />
                      In your archive
                      <span className="ml-auto text-xs font-normal text-muted-foreground">
                        {docs.length} documents
                      </span>
                    </h2>
                    <div className="mt-4 space-y-4">
                      {docs.slice(0, 3).map((d) => (
                        <div key={d.doc_id} className="flex items-start gap-2.5">
                          <FileText size={16} className="mt-0.5 shrink-0 text-muted-foreground" />
                          <div>
                            <p className="text-xs font-medium leading-5">{d.title}</p>
                            <p className="mt-1 text-[10px] text-muted-foreground">
                              {d.type} · {d.doc_id}
                            </p>
                          </div>
                        </div>
                      ))}
                    </div>
                    <Button variant="link" className="mt-4 h-11 px-0 text-xs" onClick={() => setTab('summaries')}>
                      Browse your documents <ArrowRight />
                    </Button>
                  </section>
                )}

                {/* It's okay if we don't know */}
                <section className="side-section">
                  <div className="flex gap-2.5">
                    <CircleHelp size={19} className="mt-0.5 shrink-0 text-muted-foreground" />
                    <div>
                      <h3 className="text-sm font-semibold">It's okay if we don't know.</h3>
                      <p className="mt-2 text-xs leading-6 text-muted-foreground">
                        If the answer isn't in the records you can see, we'll say so. We never guess about a patient.
                      </p>
                    </div>
                  </div>
                </section>

                {/* Emergency note */}
                <section className="side-section border-0">
                  <div className="flex gap-2.5">
                    <HeartPulse size={19} className="shrink-0 text-warning" />
                    <p className="text-[11px] leading-6 text-muted-foreground">
                      For a health emergency, contact your nearest clinic. This archive does not replace a nurse or doctor.
                    </p>
                  </div>
                </section>
              </aside>
            </div>
          )}

          {/* ── SUMMARIES TAB ─────────────────────────────────────────────── */}
          {tab === 'summaries' && (
            <div className="page-enter">
              <div className="mb-6">
                <h1 className="text-2xl font-semibold">Documents, in simple words</h1>
                <p className="mt-3 text-sm text-muted-foreground">
                  {docs.length} documents you can access · summaries are written live from the source
                </p>
                <input
                  type="search"
                  aria-label="Filter documents"
                  placeholder="Filter by name, ID or type, e.g. Maria or Laboratory"
                  value={docFilter}
                  onChange={(e) => setDocFilter(e.target.value)}
                  className="mt-4 h-11 w-full max-w-md rounded-md border border-input bg-card px-3 text-sm"
                />
              </div>
              <div className="mb-8">
                <h2 className="mb-3 text-sm font-semibold">Document summary</h2>
                {renderAnswer(summary)}
              </div>
              <div className="document-list">
                {filteredDocs.map((d) => (
                  <article key={d.doc_id} className="document-item">
                    <div className="flex items-start gap-3">
                      <div className="rounded-md bg-secondary p-2.5 text-primary">
                        <FileText size={22} />
                      </div>
                      <div className="min-w-0">
                        <h2 className="text-sm font-semibold leading-6">{d.title}</h2>
                        <p className="mt-1 text-xs text-muted-foreground">
                          {d.type} · {d.doc_id}{d.date ? ` · ${d.date}` : ''}
                        </p>
                      </div>
                    </div>
                    <div className="mt-4 flex flex-wrap gap-2">
                      <Button
                        variant="clinic"
                        size="touch"
                        className="text-xs"
                        disabled={busy}
                        onClick={() => void run(`Summarise document ${d.doc_id} (${d.title}) in plain language.`, 'web', d.doc_id)}
                      >
                        <Sparkles /> Summarise This Document
                      </Button>
                    </div>
                  </article>
                ))}
              </div>
            </div>
          )}

          {/* ── FEATURE PHONE TAB ─────────────────────────────────────────── */}
          {tab === 'phone' && (
            <div>
              <div className="mb-8">
                <h1 className="text-2xl font-semibold">Feature Phone (USSD &amp; SMS)</h1>
                <p className="mt-3 text-sm text-muted-foreground">Clinic answers, even without a smartphone. Sign in on the phone with your clinic ID and PIN.</p>
              </div>
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

          {/* ── LOGS TAB (staff/admin only — tabs filtered by role) ───────── */}
          {/* ── URGENT ALERTS TAB (clinical staff only) ───────────────────────── */}
          {tab === 'alerts' && session && groups.includes('Clinical') && (
            <AlertsPanel session={session} url={url} />
          )}

          {tab === 'logs' && (
            <div className="page-enter">
              <div className="mb-6 flex flex-wrap items-center justify-between gap-4">
                <div>
                  <h1 className="text-2xl font-semibold">Who Asked What</h1>
                  <p className="mt-3 text-sm text-muted-foreground">
                    {groups.includes('Staff')
                      ? 'Every question asked in the archive, newest first (staff see all users).'
                      : "Your own questions, newest first. Clinic staff can see everyone's."}
                  </p>
                </div>
                <Button variant="outline" size="touch" disabled={busy} onClick={() => void fetchLogs()}>
                  <History /> Refresh history
                </Button>
              </div>
              {logs.length > 0 ? (
                <div className="overflow-x-auto rounded-md border border-border bg-card">
                  <table className="audit-table">
                    <thead>
                      <tr>
                        {['Time', 'User / Role', 'Channel', 'Question', 'Status', 'Sources'].map((h) => (
                          <th key={h}>{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {logs.map((l, i) => (
                        <tr key={i}>
                          <td className="whitespace-nowrap">
                            {new Date(l.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                            <div className="mt-1 text-[10px] text-muted-foreground">
                              {new Date(l.timestamp).toLocaleDateString()}
                            </div>
                          </td>
                          <td>
                            {l.user_id}
                            <div className="mt-1 text-[11px] capitalize text-muted-foreground">{l.role}</div>
                          </td>
                          <td>{l.channel}</td>
                          <td className="min-w-48 max-w-sm leading-6">{l.question}</td>
                          <td>
                            <span className={`rounded px-2 py-1 text-xs ${l.status === 'answered' ? 'bg-secondary text-primary' : 'bg-warning-surface text-warning'}`}>
                              {l.status}
                            </span>
                          </td>
                          <td>{Array.isArray(l.sources) ? l.sources.join(', ') || '—' : '—'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <div className="flex min-h-64 flex-col items-center justify-center border-y border-border text-center">
                  <History size={35} className="text-primary" />
                  <h2 className="mt-4 font-semibold">No questions yet</h2>
                  <p className="mt-2 text-sm text-muted-foreground">Your recent archive questions will appear here.</p>
                </div>
              )}
            </div>
          )}
        </main>

        <footer className="flex flex-wrap items-center justify-between gap-3 border-t border-border py-5 text-[11px] text-muted-foreground">
          <span className="flex items-center gap-1.5">
            <HeartPulse size={13} /> Made for care. Built on trust.
          </span>
          <span className="flex items-center gap-1.5">
            <span className="h-1.5 w-1.5 rounded-full bg-primary" /> Fictional demonstration records · Access enforced by the clinic service
          </span>
        </footer>
      </div>

      {/* ── SIGN-IN DIALOG ─────────────────────────────────────────────────── */}
      <Dialog open={gateOpen} onOpenChange={(v) => { setGateOpen(v); setGateError(''); }}>
        <DialogContent className="max-w-sm">
          <DialogTitle className="flex items-center gap-2">
            <LockKeyhole size={18} className="text-primary" /> Sign in to the Archive
          </DialogTitle>
          <DialogDescription>
            Enter your clinic ID and 4-digit PIN. Patients see their own records; staff see what their role allows.
          </DialogDescription>

          <form onSubmit={(e) => { void handleGateSubmit(e); }} className="mt-2 space-y-4">
            <div>
              <label htmlFor="gate-id" className="mb-1.5 block text-sm font-medium">Clinic ID</label>
              <input
                id="gate-id"
                type="text"
                autoComplete="username"
                placeholder="e.g. PAT-001 or NUR-001"
                value={gateUserId}
                onChange={(e) => setGateUserId(e.target.value)}
                className="h-12 w-full rounded-md border border-input bg-card px-3 text-sm"
                required
              />
            </div>
            <div>
              <label htmlFor="gate-pin" className="mb-1.5 block text-sm font-medium">PIN</label>
              <input
                id="gate-pin"
                type="password"
                inputMode="numeric"
                maxLength={4}
                autoComplete="current-password"
                placeholder="4-digit PIN"
                value={gatePin}
                onChange={(e) => setGatePin(e.target.value)}
                className="h-12 w-full rounded-md border border-input bg-card px-3 text-sm"
                required
              />
            </div>

            {gateError && (
              <p className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive" role="alert">
                {gateError}
              </p>
            )}

            <Button
              type="submit"
              variant="clinic"
              size="touch"
              className="w-full"
              disabled={busy || !gateUserId.trim() || !gatePin.trim()}
            >
              {busy ? <LoaderCircle className="animate-spin" /> : <LogIn size={15} />}
              {busy ? 'Verifying…' : 'Sign in'}
            </Button>
          </form>

          {/* Fictional demo accounts */}
          <details className="mt-3 rounded-md border border-border bg-muted/30 p-3 text-xs">
            <summary className="cursor-pointer select-none font-medium text-muted-foreground hover:text-foreground">
              Demo accounts (fictional)
            </summary>
            <div className="mt-3 grid grid-cols-[1fr_auto] gap-x-4 gap-y-1.5 text-muted-foreground">
              {DEMO_ACCOUNTS.map((a) => (
                <Fragment key={a.id}>
                  <span>{a.label}</span><span className="font-mono text-foreground">{a.id} · {a.pin}</span>
                </Fragment>
              ))}
            </div>
          </details>
        </DialogContent>
      </Dialog>

      {/* ── CONNECTION SETTINGS DIALOG ────────────────────────────────────── */}
      <Dialog open={settings} onOpenChange={setSettings}>
        <DialogContent className="max-w-lg">
          <DialogTitle className="flex items-center gap-2">
            <Settings2 size={18} className="text-primary" /> Clinic connection
          </DialogTitle>
          <DialogDescription>
            The address of the clinic archive service. It is not saved on this device.
          </DialogDescription>
          <div className="mt-2 space-y-4">
            <div>
              <label htmlFor="api-url-settings" className="mb-1.5 block text-sm font-medium">Clinic API URL</label>
              <input
                id="api-url-settings"
                type="url"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                disabled={!!session}
                placeholder="https://your-service.onrender.com/archive"
                className="h-12 w-full rounded-md border border-input bg-card px-3 text-sm"
              />
              {session && <p className="mt-2 text-xs text-muted-foreground">Sign out to change the connection.</p>}
            </div>
            <div className="flex justify-end">
              <Button variant="clinic" size="touch" disabled={!url.trim()} onClick={() => setSettings(false)}>
                Done <ArrowRight />
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* ── EMERGENCY / DISTRESS DIALOG ─────────────────────────────────── */}
      <EmergencyDialog open={distress} onOpenChange={setDistress} session={session} url={url} />

      {/* ── SOURCE DOCUMENT DIALOG ────────────────────────────────────────── */}
      <Dialog open={!!source} onOpenChange={(v) => { if (!v) setSource(null); }}>
        <DialogContent className="max-h-[85vh] max-w-2xl overflow-y-auto">
          <DialogTitle>{source?.title}</DialogTitle>
          <DialogDescription>
            {source?.reference} · Source provided by the clinic service
          </DialogDescription>
          {source?.snippet && (
            <blockquote className="whitespace-pre-wrap rounded-md border border-border bg-muted/40 p-5 text-sm leading-7">
              {source.snippet}
            </blockquote>
          )}
          {source?.url
            ? (
              <div>
                <Button asChild variant="clinic" size="touch">
                  <a href={source.url} target="_blank" rel="noreferrer">Open Full Source Document <ExternalLink /></a>
                </Button>
                <p className="mt-2 text-xs text-muted-foreground">This private link expires after 5 minutes. Ask again for a fresh link.</p>
              </div>
            )
            : <p className="text-sm text-muted-foreground">The full source document is not available here. Ask the clinic for the original.</p>}
        </DialogContent>
      </Dialog>
    </div>
  );
}
