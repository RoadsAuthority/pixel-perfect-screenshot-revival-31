import { useCallback, useEffect, useRef, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  ExternalLink,
  HeartPulse,
  LoaderCircle,
  MapPin,
  Mic,
  Navigation,
  Phone,
  RefreshCw,
  Send,
  Siren,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { callArchive, normalizeAnswer, type Answer, type EmergencyAlert } from '@/lib/archive';
import type { AuthSession } from '@/lib/auth';

export const CLINIC_EMERGENCY_LINE = '+264 61 555 0199 (fictional)';

/** Hospitals near the clinic. Coordinates are approximate and only used to sort by distance. */
const FACILITIES = [
  { name: 'Hopewell Community Clinic (fictional)', note: '15 Moringa Street, Khomasdal', lat: -22.544, lng: 17.05, query: 'Khomasdal Windhoek' },
  { name: 'Katutura State Hospital', note: 'Public hospital, 24-hour casualty', lat: -22.523, lng: 17.057, query: 'Katutura State Hospital Windhoek' },
  { name: 'Windhoek Central Hospital', note: 'Public referral hospital, 24-hour casualty', lat: -22.565, lng: 17.073, query: 'Windhoek Central Hospital' },
  { name: 'Roman Catholic Hospital', note: 'Private hospital, emergency unit', lat: -22.566, lng: 17.086, query: 'Roman Catholic Hospital Windhoek' },
  { name: 'Mediclinic Windhoek', note: 'Private hospital, emergency unit', lat: -22.555, lng: 17.094, query: 'Mediclinic Windhoek' },
];

type Coords = { lat: number; lng: number; accuracy: number };

function distanceKm(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const rad = (d: number) => (d * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 6371 * 2 * Math.asin(Math.sqrt(h));
}

function directionsUrl(destination: string, from?: Coords | null): string {
  const params = new URLSearchParams({ api: '1', destination });
  if (from) params.set('origin', `${from.lat},${from.lng}`);
  return `https://www.google.com/maps/dir/?${params.toString()}`;
}

type SpeechResult = { results: { [index: number]: { [index: number]: { transcript: string } } } };
type Recognition = { lang: string; interimResults: boolean; onresult: ((e: SpeechResult) => void) | null; onend: (() => void) | null; onerror: (() => void) | null; start: () => void; stop: () => void };
type SpeechWindow = Window & { SpeechRecognition?: new () => Recognition; webkitSpeechRecognition?: new () => Recognition };

// ── Distress dialog (patients and the public) ────────────────────────────────

type DialogProps = { open: boolean; onOpenChange: (open: boolean) => void; session: AuthSession | null; url: string };

export function EmergencyDialog({ open, onOpenChange, session, url }: DialogProps) {
  const [coords, setCoords] = useState<Coords | null>(null);
  const [locating, setLocating] = useState(false);
  const [locationNote, setLocationNote] = useState('');
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [message, setMessage] = useState('');
  const [listening, setListening] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');
  const [sentId, setSentId] = useState('');
  const recognition = useRef<Recognition | null>(null);

  const locate = useCallback(() => {
    if (!navigator.geolocation) { setLocationNote('This device cannot share its location. Describe where you are in the message.'); return; }
    setLocating(true); setLocationNote('');
    navigator.geolocation.getCurrentPosition(
      (pos) => { setCoords({ lat: pos.coords.latitude, lng: pos.coords.longitude, accuracy: pos.coords.accuracy }); setLocating(false); },
      () => { setLocating(false); setLocationNote('Location was not shared. You can still send an alert — describe where you are in the message.'); },
      { enableHighAccuracy: true, timeout: 15000 },
    );
  }, []);

  useEffect(() => {
    if (open) { setSentId(''); setError(''); locate(); }
    else recognition.current?.stop();
  }, [open, locate]);

  function speak() {
    if (listening) { recognition.current?.stop(); return; }
    const sw = window as SpeechWindow;
    const Ctor = sw.SpeechRecognition ?? sw.webkitSpeechRecognition;
    if (!Ctor) { setError('Voice input is not supported in this browser. Please type instead.'); return; }
    const inst = new Ctor(); recognition.current = inst;
    inst.lang = 'en-ZA'; inst.interimResults = false;
    inst.onresult = (ev) => { const t = ev.results[0]?.[0]?.transcript; if (t) setMessage((m) => (m ? `${m} ${t}` : t)); };
    inst.onend = () => setListening(false);
    inst.onerror = () => { setListening(false); setError('Could not hear you. Check microphone permission or type instead.'); };
    try { inst.start(); setListening(true); setError(''); } catch { setError('The microphone could not start. Please type instead.'); }
  }

  async function send() {
    setSending(true); setError('');
    try {
      const data = await callArchive(url, {
        action: 'alert_create',
        user_id: session?.user_id ?? 'PUBLIC',
        channel: 'web',
        message: message.trim(),
        name: session ? '' : name.trim(),
        phone: phone.trim(),
        lat: coords?.lat, lng: coords?.lng, accuracy: coords?.accuracy,
      }, session?.token);
      setSentId(typeof data['alert_id'] === 'string' ? data['alert_id'] : 'sent');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'The alert could not be sent. Call the emergency line.');
    } finally { setSending(false); }
  }

  const nearest = coords
    ? FACILITIES.map((f) => ({ ...f, km: distanceKm(coords, f) })).sort((a, b) => a.km - b.km)
    : FACILITIES.map((f) => ({ ...f, km: NaN }));
  const patientIds = (session?.groups ?? []).filter((g) => g.startsWith('PAT-'));

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] max-w-lg overflow-y-auto">
        <DialogTitle className="flex items-center gap-2 text-destructive">
          <Siren size={20} /> Get urgent help
        </DialogTitle>
        <DialogDescription>
          Life-threatening? Call the clinic emergency line <strong className="text-foreground">{CLINIC_EMERGENCY_LINE}</strong> or go to the nearest hospital now.
        </DialogDescription>

        {sentId ? (
          <div className="mt-2 space-y-4" role="status">
            <div className="rounded-md border border-primary/30 bg-secondary p-4">
              <p className="flex items-center gap-2 font-semibold text-primary"><CheckCircle2 size={18} /> Alert sent to the clinic</p>
              <p className="mt-2 text-sm leading-6 text-secondary-foreground">
                A nurse or doctor can now see your {coords ? 'location, ' : ''}message{patientIds.length ? ' and your medical record' : ''}. Keep your phone close. If things get worse, call {CLINIC_EMERGENCY_LINE}.
              </p>
              <p className="mt-2 font-mono text-[11px] text-muted-foreground">Reference: {sentId.slice(0, 8)}</p>
            </div>
            <FacilityList facilities={nearest.slice(0, 3)} coords={coords} />
            <Button variant="outline" size="touch" className="w-full" onClick={() => onOpenChange(false)}>Close</Button>
          </div>
        ) : (
          <div className="mt-2 space-y-4">
            <section>
              <h3 className="mb-2 flex items-center gap-2 text-sm font-semibold"><MapPin size={15} /> Your location</h3>
              {locating && <p className="flex items-center gap-2 text-sm text-muted-foreground"><LoaderCircle size={14} className="animate-spin" /> Finding your location…</p>}
              {coords && (
                <p className="text-sm">
                  Found (within about {Math.round(coords.accuracy)} m).{' '}
                  <a className="text-primary underline" href={`https://www.google.com/maps?q=${coords.lat},${coords.lng}`} target="_blank" rel="noreferrer">Check on map</a>
                </p>
              )}
              {locationNote && (
                <p className="text-sm text-warning">
                  {locationNote}{' '}
                  <button type="button" className="underline" onClick={locate}>Try again</button>
                </p>
              )}
            </section>

            <FacilityList facilities={nearest.slice(0, 3)} coords={coords} />

            <section className="space-y-3">
              <h3 className="flex items-center gap-2 text-sm font-semibold"><HeartPulse size={15} /> Tell the clinic what is happening</h3>
              {session ? (
                <p className="rounded-md bg-muted/50 p-3 text-xs leading-5 text-muted-foreground">
                  Sending as <strong className="text-foreground">{session.name}</strong>
                  {patientIds.length ? <> · record {patientIds.join(', ')} will be shared with the nurse or doctor</> : null}.
                </p>
              ) : (
                <div className="grid gap-3 sm:grid-cols-2">
                  <label className="text-xs font-medium">Your name (optional)
                    <input value={name} onChange={(e) => setName(e.target.value)} maxLength={100} className="mt-1 h-11 w-full rounded-md border border-input bg-card px-3 text-sm" />
                  </label>
                  <label className="text-xs font-medium">Phone number (optional)
                    <input value={phone} onChange={(e) => setPhone(e.target.value)} maxLength={30} inputMode="tel" className="mt-1 h-11 w-full rounded-md border border-input bg-card px-3 text-sm" />
                  </label>
                </div>
              )}
              {session && (
                <label className="block text-xs font-medium">Phone number to call you back (optional)
                  <input value={phone} onChange={(e) => setPhone(e.target.value)} maxLength={30} inputMode="tel" className="mt-1 h-11 w-full rounded-md border border-input bg-card px-3 text-sm" />
                </label>
              )}
              <div>
                <label htmlFor="emergency-message" className="text-xs font-medium">What is wrong? (symptoms, who is affected, where you are)</label>
                <textarea
                  id="emergency-message"
                  value={message}
                  onChange={(e) => setMessage(e.target.value)}
                  maxLength={1000}
                  rows={3}
                  placeholder="For example: my blood sugar is very high and I feel dizzy"
                  className="mt-1 w-full rounded-md border border-input bg-card p-3 text-sm"
                />
                <Button type="button" variant="ghost" size="touch" className="px-2 text-sm text-primary" onClick={speak}>
                  <Mic size={16} /> {listening ? 'Listening… tap to stop' : 'Speak instead'}
                </Button>
              </div>
            </section>

            {error && <p className="rounded-md bg-destructive/10 p-3 text-sm text-destructive" role="alert">{error}</p>}

            <Button
              variant="destructive"
              size="touch"
              className="w-full text-base"
              disabled={sending || (!message.trim() && !coords)}
              onClick={() => void send()}
            >
              {sending ? <LoaderCircle className="animate-spin" /> : <Send size={16} />}
              {sending ? 'Sending…' : 'Send alert to the clinic'}
            </Button>
            <p className="text-center text-[11px] leading-5 text-muted-foreground">
              Demo system: alerts reach clinic staff on this dashboard only. No ambulance is dispatched automatically.
            </p>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

function FacilityList({ facilities, coords }: { facilities: (typeof FACILITIES[number] & { km: number })[]; coords: Coords | null }) {
  return (
    <section>
      <h3 className="mb-2 flex items-center gap-2 text-sm font-semibold"><Navigation size={15} /> {coords ? 'Nearest places for help' : 'Places for help in Windhoek'}</h3>
      <ul className="space-y-2">
        {facilities.map((f) => (
          <li key={f.name} className="flex items-center justify-between gap-3 rounded-md border border-border p-3">
            <div className="min-w-0">
              <p className="text-sm font-medium">{f.name}</p>
              <p className="text-xs text-muted-foreground">{f.note}{Number.isFinite(f.km) ? ` · about ${f.km.toFixed(1)} km` : ''}</p>
            </div>
            <Button asChild variant="outline" size="sm" className="shrink-0">
              <a href={directionsUrl(f.query, coords)} target="_blank" rel="noreferrer"><ExternalLink size={13} /> Directions</a>
            </Button>
          </li>
        ))}
      </ul>
    </section>
  );
}

// ── Urgent alerts panel (clinical staff) ─────────────────────────────────────

type PanelProps = { session: AuthSession; url: string; onCount?: (open: number) => void };

export function AlertsPanel({ session, url, onCount }: PanelProps) {
  const [alerts, setAlerts] = useState<EmergencyAlert[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [updated, setUpdated] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await callArchive(url, { action: 'alert_list', user_id: session.user_id }, session.token);
      const list = Array.isArray(data['alerts']) ? (data['alerts'] as EmergencyAlert[]) : [];
      setAlerts(list); setError('');
      setUpdated(new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }));
      onCount?.(list.filter((a) => a.status === 'open').length);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Alerts could not be loaded.');
    } finally { setLoading(false); }
  }, [url, session, onCount]);

  useEffect(() => {
    void load();
    const timer = window.setInterval(() => void load(), 15000);
    return () => window.clearInterval(timer);
  }, [load]);

  async function handled(alertId: string) {
    try {
      await callArchive(url, { action: 'alert_ack', user_id: session.user_id, alert_id: alertId }, session.token);
      await load();
    } catch (e) { setError(e instanceof Error ? e.message : 'Could not update the alert.'); }
  }

  const open = alerts.filter((a) => a.status === 'open');
  const done = alerts.filter((a) => a.status !== 'open');

  return (
    <div className="page-enter">
      <div className="mb-6 flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-semibold"><Siren className="text-destructive" /> Urgent Alerts</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Distress alerts from patients and the public. Refreshes every 15 seconds{updated ? ` · last checked ${updated}` : ''}.
          </p>
        </div>
        <Button variant="outline" size="touch" disabled={loading} onClick={() => void load()}>
          <RefreshCw className={loading ? 'animate-spin' : ''} /> Refresh
        </Button>
      </div>
      {error && <p className="mb-4 rounded-md bg-warning-surface p-3 text-sm text-warning" role="alert">{error}</p>}
      {alerts.length === 0 && !loading && (
        <div className="flex min-h-48 flex-col items-center justify-center border-y border-border text-center">
          <CheckCircle2 size={32} className="text-primary" />
          <p className="mt-3 font-semibold">No alerts</p>
          <p className="mt-1 text-sm text-muted-foreground">New distress alerts will appear here.</p>
        </div>
      )}
      <div className="space-y-4">
        {open.map((a) => <AlertCard key={a.alert_id} alert={a} session={session} url={url} onHandled={handled} />)}
      </div>
      {done.length > 0 && (
        <details className="mt-8">
          <summary className="cursor-pointer text-sm font-semibold text-muted-foreground">Handled ({done.length})</summary>
          <div className="mt-4 space-y-4 opacity-75">
            {done.map((a) => <AlertCard key={a.alert_id} alert={a} session={session} url={url} onHandled={handled} />)}
          </div>
        </details>
      )}
    </div>
  );
}

function AlertCard({ alert, session, url, onHandled }: { alert: EmergencyAlert; session: AuthSession; url: string; onHandled: (id: string) => Promise<void> }) {
  const [question, setQuestion] = useState('');
  const [answer, setAnswer] = useState<Answer | null>(null);
  const [asking, setAsking] = useState(false);
  const [error, setError] = useState('');
  const patient = alert.patient_ids[0] ?? '';
  const when = new Date(alert.timestamp);

  async function ask(q: string) {
    if (!q.trim()) return;
    setAsking(true); setError('');
    try {
      const full = patient ? `About patient ${patient} (${alert.name}): ${q}` : q;
      setAnswer(normalizeAnswer(await callArchive(url, { action: 'ask', user_id: session.user_id, channel: 'web', query: full }, session.token)));
    } catch (e) { setError(e instanceof Error ? e.message : 'The question could not be answered.'); }
    finally { setAsking(false); }
  }

  return (
    <article className={`rounded-xl border p-5 ${alert.status === 'open' ? 'border-destructive/40 bg-destructive/5' : 'border-border bg-card'}`}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="flex flex-wrap items-center gap-2 font-semibold">
            <AlertTriangle size={17} className="text-destructive" />
            {alert.name || 'Unknown person'}
            {patient
              ? <span className="rounded bg-secondary px-2 py-0.5 font-mono text-xs text-primary">{patient}</span>
              : <span className="rounded bg-muted px-2 py-0.5 text-xs text-muted-foreground">Not registered</span>}
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            {when.toLocaleDateString()} {when.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
            {alert.phone ? <> · <Phone size={11} className="inline" /> {alert.phone}</> : null}
            {alert.status !== 'open' && alert.handled_by ? ` · handled by ${alert.handled_by}` : ''}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {alert.lat && alert.lng && (
            <Button asChild variant="outline" size="sm">
              <a href={`https://www.google.com/maps?q=${alert.lat},${alert.lng}`} target="_blank" rel="noreferrer">
                <MapPin size={13} /> Location{alert.accuracy_m ? ` (±${Math.round(Number(alert.accuracy_m))} m)` : ''}
              </a>
            </Button>
          )}
          {alert.status === 'open' && (
            <Button variant="clinic" size="sm" onClick={() => void onHandled(alert.alert_id)}><CheckCircle2 size={13} /> Mark handled</Button>
          )}
        </div>
      </div>

      <blockquote className="mt-4 rounded-md border-l-4 border-destructive/50 bg-card p-3 text-sm leading-6">
        {alert.message || <span className="text-muted-foreground">No message — location only.</span>}
      </blockquote>

      <div className="mt-4">
        {patient ? (
          <div className="flex flex-wrap gap-2">
            <Button variant="secondary" size="sm" disabled={asking} onClick={() => void ask('Emergency summary: allergies, long-term conditions, current medication and emergency contact.')}>
              <HeartPulse size={13} /> Emergency summary
            </Button>
            <Button variant="ghost" size="sm" disabled={asking} onClick={() => void ask('What were the most recent test results and visit notes?')}>
              Latest results &amp; visits
            </Button>
          </div>
        ) : (
          <p className="text-xs text-muted-foreground">Not a registered patient: no medical record to retrieve. Call back or ask questions about clinic protocols below.</p>
        )}
        <form className="mt-3 flex gap-2" onSubmit={(e) => { e.preventDefault(); void ask(question); }}>
          <input
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            placeholder={patient ? 'Ask about this patient, e.g. Is she allergic to anything?' : 'e.g. What is the anaphylaxis protocol?'}
            className="h-10 min-w-0 flex-1 rounded-md border border-input bg-card px-3 text-sm"
          />
          <Button type="submit" size="sm" disabled={asking || !question.trim()}>{asking ? <LoaderCircle className="animate-spin" /> : 'Ask'}</Button>
        </form>
        {error && <p className="mt-2 text-sm text-destructive">{error}</p>}
        {answer && (
          <div className="mt-3 rounded-md border border-border bg-card p-3 text-sm leading-6" aria-live="polite">
            <p className={answer.is_unknown ? 'text-warning' : ''}>{answer.answer}</p>
            {answer.sources.length > 0 && (
              <p className="mt-2 text-xs text-muted-foreground">
                Sources: {answer.sources.map((s, i) => (
                  <span key={s.doc_id}>{i > 0 ? ', ' : ''}{s.url ? <a className="text-primary underline" href={s.url} target="_blank" rel="noreferrer">{s.reference}</a> : s.reference}</span>
                ))}
              </p>
            )}
          </div>
        )}
      </div>
    </article>
  );
}
