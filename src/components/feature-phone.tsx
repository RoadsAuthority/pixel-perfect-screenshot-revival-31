import { useState } from 'react';
import { Signal, BatteryFull, Phone, RotateCcw, MessageSquare, CheckCircle2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import type { Answer } from '@/lib/archive';

type Props = {
  /** Sends one USSD step to the clinic service; returns the raw response or null on error. */
  liveUssd: (session: string, text: string) => Promise<Record<string, unknown> | null>;
};

const DIAL_CODE = '*123*50#';
const IDLE_SCREEN = 'Ask the Archive\nHopewell Community Clinic\n\nDial *123*50#';

function pickString(result: Record<string, unknown>, ...keys: string[]): string {
  for (const key of keys) if (typeof result[key] === 'string') return result[key] as string;
  return '';
}

export function FeaturePhone({ liveUssd }: Props) {
  const [step, setStep] = useState<'dial' | 'active' | 'end'>('dial');
  const [input, setInput] = useState(DIAL_CODE);
  const [session, setSession] = useState('');
  const [history, setHistory] = useState('');
  const [screen, setScreen] = useState(IDLE_SCREEN);
  const [notice, setNotice] = useState('');
  const [sms, setSms] = useState<Answer | null>(null);
  const [busy, setBusy] = useState(false);

  function reset() {
    setStep('dial'); setInput(DIAL_CODE); setSms(null); setScreen(IDLE_SCREEN);
    setNotice(''); setHistory(''); setSession('');
  }

  async function send() {
    if (!input.trim() || busy) return;
    if (step === 'dial' && input !== DIAL_CODE) { setNotice(`Dial ${DIAL_CODE} to connect to the clinic archive.`); return; }
    setBusy(true); setNotice('');
    try {
      const nextSession = session || `ussd-${crypto.randomUUID()}`;
      setSession(nextSession);
      const nextText = step === 'dial' ? '' : history ? `${history}*${input}` : input;
      const result = await liveUssd(nextSession, nextText);
      if (!result) return;
      const response = pickString(result, 'next_ussd_screen', 'response');
      if (!/^(CON|END)\b/.test(response)) { setNotice('The clinic service did not return a phone screen.'); return; }
      setScreen(response); setHistory(nextText); setStep(response.startsWith('END') ? 'end' : 'active');
      const message = pickString(result, 'sms_text');
      if (message) {
        const reference = pickString(result, 'reference');
        setSms({
          answer: message,
          is_unknown: result['is_unknown'] === true,
          status: result['is_unknown'] === true ? 'unknown' : 'answered',
          sources: reference ? [{ title: 'SMS reference', reference, doc_id: reference, snippet: '' }] : [],
        });
      }
      setInput('');
    } finally { setBusy(false); }
  }

  const askingPin = /PIN/i.test(screen) && step === 'active';

  return <div className="page-enter grid gap-10 md:grid-cols-[330px_1fr]">
    <div className="flex justify-center"><div className="phone">
      <div className="mb-4 flex items-center justify-between px-1"><Signal size={15}/><span className="text-xs font-semibold">CLINIC CONNECT</span><BatteryFull size={19}/></div>
      <div className="phone-screen" role="status">{screen}</div>
      {step !== 'end' && <form onSubmit={e => { e.preventDefault(); void send(); }} className="mt-3">
        <label className="sr-only" htmlFor="phone-input">Phone entry</label>
        <input id="phone-input" value={input} onChange={e => setInput(e.target.value)} type={askingPin ? 'password' : 'text'} autoComplete="off" className="h-11 w-full rounded bg-phone-screen px-3 text-foreground" />
        <Button type="submit" variant="secondary" size="touch" className="mt-3 w-full" disabled={busy}><Phone/>{busy ? 'Connecting…' : step === 'dial' ? 'Dial' : 'Send'}</Button>
      </form>}
      <div className="mt-4 grid grid-cols-3 gap-2">{['1','2','3','4','5','6','7','8','9','*','0','#'].map(key => <Button key={key} variant="ghost" className="phone-key" aria-label={`Key ${key}`} disabled={step === 'end' || busy} onClick={() => setInput(v => v + key)}>{key}</Button>)}</div>
      <Button variant="ghost" className="mt-3 w-full text-primary-foreground" onClick={reset}><RotateCcw/>Restart session</Button>
    </div></div>
    <div>
      <h2 className="text-xl font-semibold">A small phone. The same trusted information.</h2>
      <p className="mt-3 max-w-lg text-sm leading-7 text-muted-foreground">Clinic staff on a basic phone can sign in with their staff ID and PIN and get answers by SMS. The same access rules apply as on the web.</p>
      <div className="mt-6 border-y border-border py-5"><div className="flex items-center gap-2 text-sm font-semibold"><MessageSquare className="size-5 text-primary"/>Follow-Up SMS Received</div>
        {sms ? <div role="status" className="mt-4 rounded-md border border-border bg-card p-5"><div className="mb-3 flex items-center gap-2 text-xs font-semibold text-primary"><CheckCircle2 size={15}/>CLINIC ARCHIVE · SMS</div><p className="text-sm leading-7">{sms.answer}</p><p className="mt-4 text-xs text-muted-foreground">Source: {sms.sources.map(s => s.reference).join(', ') || 'No source available'}</p></div> : <p className="mt-3 text-sm text-muted-foreground">No messages yet.</p>}
      </div>
      {notice && <p className="mt-4 rounded-md bg-warning-surface p-4 text-sm text-warning" role="alert">{notice}</p>}
      <p className="mt-5 text-xs leading-6 text-muted-foreground">This is a simulation; no SMS is sent to a real phone.</p>
    </div>
  </div>;
}
