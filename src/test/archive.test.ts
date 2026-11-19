import { afterEach, describe, expect, it, vi } from 'vitest';
import { callArchive, normalizeAnswer, normalizeDocuments } from '@/lib/archive';
import { sessionFromVerify, staffGroups } from '@/lib/auth';

afterEach(() => vi.unstubAllGlobals());

describe('normalizeAnswer', () => {
  it('honours backend is_unknown even when an answer and sources are supplied', () => {
    const answer = normalizeAnswer({ answer: 'Not found in the archive.', is_unknown: true, sources: [{ title: 'Private report' }] });
    expect(answer.is_unknown).toBe(true);
    expect(answer.status).toBe('unknown');
    expect(answer.sources).toEqual([]);
  });

  it('keeps sources and only accepts https source links', () => {
    const answer = normalizeAnswer({
      answer: 'Daniel Ipinge is blood group A negative.',
      sources: [
        { doc_id: 'LAB-RPT-2026-0436', title: 'Laboratory Report Daniel Ipinge', snippet: 'Blood group A', reference: 'LAB-RPT-2026-0436', url: 'https://s3.example/signed' },
        { doc_id: 'X', title: 'Bad link', url: 'javascript:alert(1)' },
      ],
    });
    expect(answer.sources[0]?.url).toBe('https://s3.example/signed');
    expect(answer.sources[1]?.url).toBeUndefined();
  });

  it('rejects a response with no answer text', () => {
    expect(() => normalizeAnswer({ sources: [] })).toThrow();
  });
});

describe('normalizeDocuments', () => {
  it('parses the server document list and drops malformed rows', () => {
    const docs = normalizeDocuments({
      documents: [
        { doc_id: 'HCC-POL-001', title: 'Clinic Confidentiality Policy', type: 'Policy or Procedure', folder: 'Clinic_Policies', date: '2026-01-15', patient_id: '' },
        { title: 'missing id' },
      ],
    });
    expect(docs).toHaveLength(1);
    expect(docs[0]?.doc_id).toBe('HCC-POL-001');
  });

  it('throws when the server returns no list', () => {
    expect(() => normalizeDocuments({})).toThrow();
  });
});

describe('sessionFromVerify', () => {
  const ok = { authenticated: true, user_id: 'DOC-001', name: 'Dr Anna-Marie van Wyk', role: 'doctors', groups: ['Doctors', 'Everyone'], scope: 'Doctors: Consultation Record', token: 'tok' };

  it('builds a session from a valid verify response', () => {
    const s = sessionFromVerify(ok, 'DOC-001', 'https://api.example/archive');
    expect(s.groups).toEqual(['Doctors', 'Everyone']);
    expect(staffGroups(s)).toEqual(['Doctors']);
    expect(s.api_url).toBe('https://api.example/archive');
  });

  it('refuses a response without explicit authentication', () => {
    expect(() => sessionFromVerify({ ...ok, authenticated: false }, 'DOC-001', 'https://x')).toThrow();
  });

  it('refuses a response for a different user or without staff groups', () => {
    expect(() => sessionFromVerify(ok, 'NUR-001', 'https://x')).toThrow();
    expect(() => sessionFromVerify({ ...ok, groups: ['Everyone'] }, 'DOC-001', 'https://x')).toThrow();
  });
});

describe('callArchive', () => {
  it('refuses non-HTTPS endpoints', async () => {
    await expect(callArchive('http://insecure.example/archive', { action: 'documents', user_id: 'PUBLIC' })).rejects.toThrow('HTTPS');
  });

  it('sends the bearer token and surfaces the server message on errors', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ message: 'Your session has expired. Sign in again.' }), { status: 401 }));
    vi.stubGlobal('fetch', fetchMock);
    await expect(callArchive('https://api.example/archive', { action: 'documents', user_id: 'DOC-001' }, 'tok')).rejects.toThrow('Your session has expired');
    const init = fetchMock.mock.calls[0]?.[1] as RequestInit;
    expect((init.headers as Record<string, string>)['Authorization']).toBe('Bearer tok');
  });
});
