/**
 * Client for the clinic archive API (FastAPI on Render).
 *
 * The browser holds no documents and makes no access decisions: the server
 * verifies the PIN, filters Bedrock retrieval by the user's access groups,
 * and returns only documents the user may read.
 */

/** Primary access group of the signed-in user (lower case), or 'public'. */
export type Role = string;

export type ArchiveDoc = {
  doc_id: string;
  title: string;
  type: string;
  folder: string;
  date: string;
  patient_id: string;
};

export type Source = { doc_id: string; title: string; snippet: string; reference: string; url?: string | undefined };
export type Answer = { answer: string; is_unknown: boolean; status: 'answered' | 'unknown' | 'restricted'; sources: Source[] };
export type AuditEntry = { timestamp: string; user_id: string; role: Role; channel: 'web' | 'voice' | 'ussd'; question: string; status: Answer['status']; sources: string[] };

type ArchiveRequestBase = { user_id: string };
export type ArchiveRequest =
  | (ArchiveRequestBase & { action: 'verify'; pin: string; channel: 'web' })
  | (ArchiveRequestBase & { action: 'ask'; channel: 'web' | 'voice' | 'ussd'; query: string })
  | (ArchiveRequestBase & { action: 'summary'; channel: 'web' | 'voice' | 'ussd'; query: string; doc_id: string })
  | (ArchiveRequestBase & { action: 'documents' })
  | (ArchiveRequestBase & { action: 'logs'; channel: 'web'; query: '' })
  | (ArchiveRequestBase & { action: 'ussd'; channel: 'ussd'; query: ''; ussd_session_id: string; ussd_text: string });

export function unknown(restricted = false): Answer {
  return {
    answer: restricted
      ? "I don't know. Your current access does not include that document. Please ask an authorised clinic staff member."
      : "I don't know. I couldn't find that information in the documents you can access. Please ask the clinic for help.",
    is_unknown: true,
    status: restricted ? 'restricted' : 'unknown',
    sources: [],
  };
}

export function normalizeAnswer(raw: unknown): Answer {
  if (!raw || typeof raw !== 'object') throw new Error('The clinic service returned an unreadable response.');
  const data = raw as Record<string, unknown>;
  if (data['is_unknown'] === true || data['status'] === 'restricted') return { ...unknown(data['status'] === 'restricted'), answer: typeof data['answer'] === 'string' ? data['answer'] : unknown().answer };
  const text = typeof data['answer'] === 'string' ? data['answer'] : typeof data['summary'] === 'string' ? data['summary'] : '';
  if (!text) throw new Error('The clinic service did not return an answer.');
  const rawSources = Array.isArray(data['sources']) ? data['sources'] : Array.isArray(data['citations']) ? data['citations'] : [];
  const sources: Source[] = rawSources.flatMap((value: unknown) => {
    if (!value || typeof value !== 'object') return [];
    const s = value as Record<string, unknown>;
    return [{ doc_id: String(s['doc_id'] ?? ''), title: String(s['title'] ?? s['document_title'] ?? 'Source document'), snippet: String(s['snippet'] ?? s['quote'] ?? ''), reference: String(s['reference'] ?? s['doc_id'] ?? ''), url: typeof s['url'] === 'string' && /^https:\/\//.test(s['url']) ? s['url'] : undefined }];
  });
  return { answer: text, is_unknown: false, status: 'answered', sources };
}

export function normalizeDocuments(raw: Record<string, unknown>): ArchiveDoc[] {
  if (!Array.isArray(raw['documents'])) throw new Error('The clinic service did not return a document list.');
  return raw['documents'].flatMap((value: unknown) => {
    if (!value || typeof value !== 'object') return [];
    const d = value as Record<string, unknown>;
    if (typeof d['doc_id'] !== 'string' || !d['doc_id']) return [];
    return [{
      doc_id: d['doc_id'],
      title: String(d['title'] ?? d['doc_id']),
      type: String(d['type'] ?? ''),
      folder: String(d['folder'] ?? ''),
      date: String(d['date'] ?? ''),
      patient_id: String(d['patient_id'] ?? ''),
    }];
  });
}

export async function callArchive(
  url: string,
  body: ArchiveRequest,
  /** Bearer token from the verified session. When provided it is sent as Authorization header. */
  token?: string,
): Promise<Record<string, unknown>> {
  if (!url.trim()) throw new Error('Add the clinic API URL in connection settings first.');
  let parsed: URL;
  try { parsed = new URL(url); } catch { throw new Error('Enter a valid HTTPS clinic API URL.'); }
  if (parsed.protocol !== 'https:') throw new Error('The clinic API URL must use HTTPS.');
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (token) headers['Authorization'] = `Bearer ${token}`;
  let response: Response;
  try {
    response = await fetch(parsed, { method: 'POST', headers, body: JSON.stringify(body) });
  } catch {
    throw new Error('The clinic service could not be reached. It may be waking up — wait a moment and try again.');
  }
  if (!response.ok) {
    let message = '';
    try { const err = (await response.json()) as Record<string, unknown>; if (typeof err['message'] === 'string') message = err['message']; } catch { /* not JSON */ }
    if (response.status === 401 || response.status === 403) throw new Error(message || 'The clinic service denied access. Check your ID and PIN.');
    throw new Error(message || `The clinic service could not complete this request (${response.status}). Please try again later.`);
  }
  const raw: unknown = await response.json();
  if (!raw || typeof raw !== 'object') throw new Error('The clinic service returned an unreadable response.');
  const data = raw as Record<string, unknown>;
  if (typeof data['body'] === 'string') return JSON.parse(data['body']) as Record<string, unknown>;
  return data;
}
