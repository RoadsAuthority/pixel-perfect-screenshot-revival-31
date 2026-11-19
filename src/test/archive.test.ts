import { describe, expect, it } from 'vitest';
import { canAccess, demoAsk, documents, normalizeAnswer, profiles, verifyProfile } from '@/lib/archive';
describe('Archive access rules', () => {
  it('verifies Patient P042 only with ID P042 and PIN 1111', () => { expect(verifyProfile('P042', '1111')?.id).toBe('P042'); expect(verifyProfile('P042', '2222')).toBeNull(); });
  it('verifies Patient P099 only with ID P099 and PIN 2222', () => { expect(verifyProfile('P099', '2222')?.id).toBe('P099'); expect(verifyProfile('P099', '1111')).toBeNull(); });
  it('verifies Clinic Clerk with CLK-1 and 3333', () => { expect(verifyProfile('CLK-1', '3333')?.role).toBe('clerk'); expect(verifyProfile('CLK-1', '1111')).toBeNull(); });
  it('verifies Registered Nurse with NRS-1 and 4444', () => { expect(verifyProfile('NRS-1', '4444')?.role).toBe('nurse'); expect(verifyProfile('NRS-1', '3333')).toBeNull(); });
  it('limits Patient P042 to public info and their own records', () => { const p = profiles[0]; expect(documents.filter(d => canAccess(p, d)).map(d => d.id)).toEqual(['clinic-schedule', 'fever-guide', 'report-p042', 'referral-p042']); });
  it('limits Patient P099 to public info and their own records', () => { const p = profiles[1]; expect(documents.filter(d => canAccess(p, d)).map(d => d.id)).toEqual(['clinic-schedule', 'fever-guide', 'report-p099']); });
  it('gives clerk public and staff records but no patient records', () => { const p = profiles[2]; expect(documents.filter(d => canAccess(p, d)).map(d => d.id)).toEqual(['clinic-schedule', 'fever-guide', 'oxygen-contract', 'cold-chain']); });
  it('gives registered nurse access to every document', () => { expect(documents.filter(d => canAccess(profiles[3], d))).toHaveLength(7); });
  it('does not reveal restricted patient answers or source snippets', () => { const answer = demoAsk(profiles[0], 'Show patient P099 report'); expect(answer.status).toBe('restricted'); expect(answer.is_unknown).toBe(true); expect(answer.sources).toEqual([]); });
  it('honours backend is_unknown even when an answer and sources are supplied', () => { const answer = normalizeAnswer({ answer: 'Not found in the archive.', is_unknown: true, sources: [{ title: 'Private report' }] }); expect(answer.is_unknown).toBe(true); expect(answer.status).toBe('unknown'); expect(answer.sources).toEqual([]); });
  it('returns unknown rather than fabricating a missing answer', () => { expect(demoAsk(profiles[3], 'What is my diagnosis of diabetes?').status).toBe('unknown'); });
});