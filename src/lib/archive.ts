export type Role = 'patient' | 'clerk' | 'nurse' | 'public';
export type Profile = { id: string; name: string; role: Role; pin: string; scope: string };
export const profiles: [Profile, Profile, Profile, Profile] = [
  { id: 'P042', name: 'Patient P042', role: 'patient', pin: '1111', scope: 'Public info + your own reports' },
  { id: 'P099', name: 'Patient P099', role: 'patient', pin: '2222', scope: 'Public info + your own reports' },
  { id: 'CLK-1', name: 'Clinic Clerk', role: 'clerk', pin: '3333', scope: 'Public info + staff documents' },
  { id: 'NRS-1', name: 'Registered Nurse', role: 'nurse', pin: '4444', scope: 'Public info + staff + all patient records' },
];
export type ArchiveDocument = { id: string; title: string; category: 'public' | 'staff' | 'patient'; patient?: string; code: string; text: string; summary: string; date: string };
export const documents: ArchiveDocument[] = [
  { id: 'clinic-schedule', title: 'Mobile Clinic Schedule 2026–2027', category: 'public', code: 'SCH-01', date: '12 Nov 2026', text: 'DEMO DOCUMENT — FICTIONAL DATA\n\nThe mobile clinic visits Riverside Community Hall on the first Tuesday of each month, 09:00–14:00. The next scheduled visits are 1 December 2026 and 5 January 2027. Bring your clinic card and any medicines you take. Patients are seen in arrival order. Contact the clinic before travelling to confirm the visit.', summary: 'The next mobile clinic visits are 1 December 2026 and 5 January 2027, from 9 am to 2 pm at Riverside Community Hall. Bring your clinic card and medicines. Please confirm with the clinic before travelling.' },
  { id: 'fever-guide', title: 'Fever & Hydration Guide', category: 'public', code: 'GDE-02', date: '4 Nov 2026', text: 'DEMO DOCUMENT — FICTIONAL DATA\n\nGeneral clinic guidance: people with a fever should speak to a health worker. Drink fluids regularly if able. Seek urgent clinical help for trouble breathing, confusion, inability to drink, or a child who is unusually sleepy. This guide does not diagnose a condition or replace an assessment by a nurse.', summary: 'Speak to a health worker about a fever. Drink fluids if you can. Trouble breathing, confusion, or being unable to drink needs urgent clinical help. This guide cannot tell you what illness you have.' },
  { id: 'oxygen-contract', title: 'MediSupplies Oxygen Contract', category: 'staff', code: 'CON-03', date: '2 Nov 2026', text: 'DEMO DOCUMENT — FICTIONAL DATA\n\nMediSupplies oxygen supply agreement. Contract expires on 30 June 2027. The clinic clerk should begin renewal review by 31 March 2027. Monthly delivery and cylinder inspections are included in the agreement.', summary: 'The oxygen supply contract ends on 30 June 2027. Start checking renewal by 31 March 2027. It includes monthly deliveries and cylinder inspections.' },
  { id: 'cold-chain', title: 'Cold Chain Expiry Log', category: 'staff', code: 'EXP-04', date: '10 Nov 2026', text: 'DEMO DOCUMENT — FICTIONAL DATA\n\nCold chain expiry log: temperature-monitoring calibration expires on 31 May 2027. Cold-box service agreement expires on 30 September 2027. Arrange calibration and renewal before these dates. No vaccine batch expiry information is recorded in this log.', summary: 'Temperature-monitoring calibration ends on 31 May 2027. The cold-box service agreement ends on 30 September 2027. Arrange checks before those dates. This log does not list vaccine expiry dates.' },
  { id: 'report-p042', title: 'Patient P042 Lab & Visit Report', category: 'patient', patient: 'P042', code: 'LAB-05', date: '9 Nov 2026', text: 'DEMO DOCUMENT — FICTIONAL DATA\n\nPatient P042 attended a routine visit on 9 November 2026. The report records a haemoglobin result below the laboratory reference range. The nurse requested a follow-up visit to discuss the result. No diagnosis or medication change is recorded. Follow-up is scheduled for 23 November 2026.', summary: 'Your report says one blood test result was lower than the lab’s usual range. The nurse wants to discuss it with you on 23 November 2026. The report does not record a diagnosis or a change to your medicines.' },
  { id: 'report-p099', title: 'Patient P099 Radiology Note', category: 'patient', patient: 'P099', code: 'RAD-06', date: '6 Nov 2026', text: 'DEMO DOCUMENT — FICTIONAL DATA\n\nPatient P099 radiology note dated 6 November 2026. The radiologist reports no acute fracture on the image reviewed. A clinical review is advised if pain persists. The note does not contain a treatment plan.', summary: 'The image reviewed did not show a new broken bone. If pain continues, the note advises a clinical review. It does not include a treatment plan.' },
  { id: 'referral-p042', title: 'Scanned Referral Slip P042', category: 'patient', patient: 'P042', code: 'REF-07', date: '9 Nov 2026', text: 'DEMO DOCUMENT — FICTIONAL DATA\n\nTranscription of scanned referral: Patient P042 referred for follow-up assessment at the district clinic. Bring the referral slip and clinic card. The appointment time is not legible on the scan. Contact the district clinic to confirm the appointment.', summary: 'You were referred to the district clinic for a follow-up assessment. Bring your referral slip and clinic card. The appointment time cannot be read from the scan, so ask the clinic to confirm it.' },
];
export function canAccess(profile: Profile | null, doc: ArchiveDocument) {
  if (doc.category === 'public') return true;
  if (!profile) return false;
  if (profile.role === 'nurse') return true;
  if (profile.role === 'clerk') return doc.category === 'staff';
  return doc.category === 'patient' && doc.patient === profile.id;
}
export function verifyProfile(id: string, pin: string) { return profiles.find(p => p.id === id && p.pin === pin) ?? null; }
export type Source = { doc_id: string; title: string; snippet: string; reference: string; url?: string | undefined };
export type Answer = { answer: string; is_unknown: boolean; status: 'answered' | 'unknown' | 'restricted'; sources: Source[] };
export function unknown(restricted = false): Answer { return { answer: restricted ? "I don't know. Your current access does not include that document. Please ask an authorised clinic staff member." : "I don't know. I couldn't find that information in the available documents. Please ask the clinic for help.", is_unknown: true, status: restricted ? 'restricted' : 'unknown', sources: [] }; }
export function summarize(profile: Profile | null, id: string): Answer {
  const doc = documents.find(d => d.id === id);
  if (!doc) return unknown();
  if (!canAccess(profile, doc)) return unknown(true);
  return { answer: doc.summary, is_unknown: false, status: 'answered', sources: [{ doc_id: doc.id, title: doc.title, snippet: doc.text.split('\n\n')[1] ?? '', reference: doc.code }] };
}
export function demoAsk(profile: Profile | null, query: string): Answer {
  const q = query.toLowerCase();
  let id: string | undefined;
  if (/p099/.test(q)) id = 'report-p099';
  else if (/referral|scan/.test(q)) id = 'referral-p042';
  else if (/p042/.test(q)) id = 'report-p042';
  else if (/my.*(report|result)|blood|lab|recent report/.test(q)) id = profile?.role === 'patient' ? `report-${profile.id.toLowerCase()}` : undefined;
  else if (/oxygen|medisupplies|contract/.test(q)) id = 'oxygen-contract';
  else if (/cold|expir|suppl/.test(q)) id = 'cold-chain';
  else if (/fever|hydrat/.test(q)) id = 'fever-guide';
  else if (/mobile|schedule|visit|clinic visiting/.test(q)) id = 'clinic-schedule';
  return id ? summarize(profile, id) : unknown();
}
export type AuditEntry = { timestamp: string; user_id: string; role: Role; channel: 'web' | 'voice' | 'ussd'; question: string; status: Answer['status']; sources: string[] };
export function normalizeAnswer(raw: unknown): Answer {
  if (!raw || typeof raw !== 'object') throw new Error('The clinic service returned an unreadable response.');
  const data = raw as Record<string, unknown>;
  if (data['is_unknown'] === true || data['status'] === 'restricted') return { ...unknown(data['status'] === 'restricted'), answer: typeof data['answer'] === 'string' ? data['answer'] : unknown().answer };
  const text = typeof data['answer'] === 'string' ? data['answer'] : typeof data['summary'] === 'string' ? data['summary'] : '';
  if (!text) throw new Error('The clinic service did not return an answer.');
  const sources: Source[] = Array.isArray(data['sources']) ? data['sources'].flatMap((value: unknown) => {
    if (!value || typeof value !== 'object') return [];
    const s = value as Record<string, unknown>;
    return [{ doc_id: String(s['doc_id'] ?? ''), title: String(s['title'] ?? s['document_title'] ?? 'Source document'), snippet: String(s['snippet'] ?? s['quote'] ?? ''), reference: String(s['reference'] ?? s['doc_id'] ?? ''), url: typeof s['url'] === 'string' && /^https:\/\//.test(s['url']) ? s['url'] : undefined }];
  }) : [];
  return { answer: text, is_unknown: false, status: 'answered', sources };
}
export async function callArchive(url: string, body: Record<string, unknown>): Promise<Record<string, unknown>> {
  if (!url.trim()) throw new Error('Add your clinic API URL in connection settings before using Live API.');
  let parsed: URL;
  try { parsed = new URL(url); } catch { throw new Error('Enter a valid HTTPS clinic API URL.'); }
  if (parsed.protocol !== 'https:') throw new Error('The clinic API URL must use HTTPS.');
  const response = await fetch(parsed, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  if (!response.ok) throw new Error(response.status === 401 || response.status === 403 ? 'The clinic service denied access. Check your ID and PIN.' : `The clinic service could not complete this request (${response.status}). Please try again later.`);
  const raw: unknown = await response.json();
  if (!raw || typeof raw !== 'object') throw new Error('The clinic service returned an unreadable response.');
  const data = raw as Record<string, unknown>;
  if (typeof data['body'] === 'string') return JSON.parse(data['body']) as Record<string, unknown>;
  return data;
}