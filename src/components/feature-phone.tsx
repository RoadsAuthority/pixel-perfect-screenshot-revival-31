import { useState } from 'react';
import { Signal, BatteryFull, Send, Phone, RotateCcw, MessageSquare, CheckCircle2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { type Answer, type Profile, verifyProfile } from '@/lib/archive';

type Props = { mode: boolean; profile: Profile | null; run: (query: string, channel: 'ussd', identity?: Profile) => Promise<Answer | null>; liveUssd: (session: string, text: string) => Promise<Record<string, unknown> | null> };
export function FeaturePhone({ mode, run, liveUssd }: Props) {
  const [step, setStep] = useState<'dial' | 'id' | 'pin' | 'menu' | 'question' | 'end'>('dial');
  const [input, setInput] = useState('*123*50#');
  const [id, setId] = useState('');
  const [identity, setIdentity] = useState<Profile | null>(null);
  const [session, setSession] = useState('');
  const [history, setHistory] = useState('');
  const [screen, setScreen] = useState('');
  const [notice, setNotice] = useState('');
  const [sms, setSms] = useState<Answer | null>(null);
  const [busy, setBusy] = useState(false);
  function reset() { setStep('dial'); setInput('*123*50#'); setSms(null); setScreen(''); setNotice(''); setIdentity(null); setHistory(''); setSession(''); }
  async function send() {
    if (!input.trim() || busy) return;
    setBusy(true); setNotice('');
    try {
      if (!mode) {
        const nextSession = session || `ussd-${crypto.randomUUID()}`;
        setSession(nextSession);
        const nextText = step === 'dial' ? '' : history ? `${history}*${input}` : input;
        const result = await liveUssd(nextSession, nextText);
        if (result) {
          const response = typeof result['response'] === 'string' ? result['response'] : typeof result['ussd_response'] === 'string' ? result['ussd_response'] : typeof result['ussd_text'] === 'string' ? result['ussd_text'] : '';
          if (!/^(CON|END)\b/.test(response)) { setNotice('The clinic service did not return a CON or END phone screen.'); return; }
          setScreen(response); setHistory(nextText); setStep(response.startsWith('END') ? 'end' : 'question');
          const message = typeof result['sms'] === 'string' ? result['sms'] : typeof result['sms_message'] === 'string' ? result['sms_message'] : '';
          if (message) setSms({ answer: message, is_unknown: result['is_unknown'] === true, status: result['is_unknown'] === true ? 'unknown' : 'answered', sources: typeof result['reference'] === 'string' ? [{ title: 'SMS reference', reference: result['reference'], doc_id: '', snippet: '' }] : [] });
        }
        setInput(''); return;
      }
      if (step === 'dial') {
        if (input !== '*123*50#') { setNotice('Dial *123*50# to connect to the clinic archive.'); return; }
        setStep('id');
      } else if (step === 'id') {
        setId(input.trim().toUpperCase()); setStep('pin');
      } else if (step === 'pin') {
        const person = verifyProfile(id, input);
        if (!person) { setNotice('ID or PIN is incorrect. Try your demo PIN again.'); return; }
        setIdentity(person); setStep('menu');
      } else {
        if (!identity) { setNotice('Please restart and verify your ID and PIN.'); return; }
        if (step === 'menu' && input === '3') { setStep('question'); setInput(''); return; }
        const query = step === 'menu' ? input === '1' ? 'When is the mobile clinic visiting?' : input === '2' ? identity.role === 'patient' ? 'What did my recent report say?' : 'Which contracts expire next year?' : '' : input;
        if (!query) { setNotice('Choose 1, 2, or 3.'); return; }
        const result = await run(query, 'ussd', identity);
        if (result) { setSms(result); setStep('end'); }
      }
      setInput('');
    } finally { setBusy(false); }
  }
  const demoScreen = step === 'dial' ? 'Ask the Archive\nRural Health Clinic\n\nDial *123*50#' : step === 'id' ? 'CON Welcome to the clinic.\n\nEnter your patient or staff ID:' : step === 'pin' ? `CON ID: ${id}\n\nEnter your 4-digit PIN:` : step === 'menu' ? `CON Welcome, ${identity?.name}.\n\n1. Mobile clinic visits\n2. ${identity?.role === 'patient' ? 'My latest report' : 'Contract expiry'}\n3. Ask a question` : step === 'question' ? 'CON Type your short question:' : 'END Your answer has been sent by SMS.\n\nThank you for using the clinic archive.';
  return <div className="page-enter grid gap-10 md:grid-cols-[330px_1fr]">
    <div className="flex justify-center"><div className="phone">
      <div className="mb-4 flex items-center justify-between px-1"><Signal size={15}/><span className="text-xs font-semibold">CLINIC CONNECT</span><BatteryFull size={19}/></div>
      <div className="phone-screen" role="status">{mode ? demoScreen : screen || demoScreen}</div>
      {step !== 'end' && <form onSubmit={e => { e.preventDefault(); void send(); }} className="mt-3">
        <label className="sr-only" htmlFor="phone-input">Phone entry</label><input id="phone-input" value={input} onChange={e => setInput(e.target.value)} type={step === 'pin' ? 'password' : 'text'} autoComplete="off" className="h-11 w-full rounded bg-phone-screen px-3 text-foreground" />
        <Button type="submit" variant="secondary" size="touch" className="mt-3 w-full" disabled={busy}><Phone/>{busy ? 'Connecting…' : step === 'dial' ? 'Dial' : 'Send'}</Button>
      </form>}
      <div className="mt-4 grid grid-cols-3 gap-2">{['1','2','3','4','5','6','7','8','9','*','0','#'].map(key => <Button key={key} variant="ghost" className="phone-key" aria-label={`Key ${key}`} disabled={step === 'end' || busy} onClick={() => setInput(v => v + key)}>{key}</Button>)}</div>
      <Button variant="ghost" className="mt-3 w-full text-primary-foreground" onClick={reset}><RotateCcw/>Restart session</Button>
    </div></div>
    <div>
      <h2 className="text-xl font-semibold">A small phone. The same trusted information.</h2>
      <p className="mt-3 max-w-lg text-sm leading-7 text-muted-foreground">Clinic information for people without a smartphone. Your ID and PIN keep personal reports private.</p>
      <div className="mt-6 border-y border-border py-5"><div className="flex items-center gap-2 text-sm font-semibold"><MessageSquare className="size-5 text-primary"/>Follow-Up SMS Received</div>
        {sms ? <div role="status" className="mt-4 rounded-md border border-border bg-card p-5"><div className="mb-3 flex items-center gap-2 text-xs font-semibold text-primary"><CheckCircle2 size={15}/>CLINIC ARCHIVE · {mode ? 'DEMO SMS' : 'LIVE SMS'}</div><p className="text-sm leading-7">{sms.answer}</p><p className="mt-4 text-xs text-muted-foreground">Source: {sms.sources.map(s => s.reference).join(', ') || 'No source available'}</p></div> : <p className="mt-3 text-sm text-muted-foreground">No messages yet.</p>}
      </div>
      {notice && <p className="mt-4 rounded-md bg-warning-surface p-4 text-sm text-warning" role="alert">{notice}</p>}
      {mode && <p className="mt-5 text-xs leading-6 text-muted-foreground">Demo IDs & PINs: P042 · 1111, P099 · 2222, CLK-1 · 3333, NRS-1 · 4444. This is a simulation; no SMS is sent to a real phone.</p>}
    </div>
  </div>;
}