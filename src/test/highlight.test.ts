import { describe, expect, it } from 'vitest';
import { highlightSegments } from '@/lib/highlight';

const DOC = 'ALLERGIES\n- Penicillin: rash and swelling of the face (2019).\nBlood group: not tested.';

describe('highlightSegments', () => {
  it('marks a quote even when spacing and case differ', () => {
    const segs = highlightSegments(DOC, ['penicillin:   RASH and swelling']);
    expect(segs.filter((s) => s.mark).map((s) => s.text)).toEqual(['Penicillin: rash and swelling']);
    expect(segs.map((s) => s.text).join('')).toBe(DOC);
  });

  it('marks several quotes and merges overlaps', () => {
    const segs = highlightSegments(DOC, ['rash and swelling', 'swelling of the face', 'not tested']);
    expect(segs.filter((s) => s.mark).map((s) => s.text)).toEqual(['rash and swelling of the face', 'not tested']);
  });

  it('treats regex characters in quotes literally', () => {
    const segs = highlightSegments(DOC, ['the face (2019).']);
    expect(segs.some((s) => s.mark && s.text === 'the face (2019)')).toBe(true);
  });

  it('returns the whole text unmarked when nothing matches', () => {
    expect(highlightSegments(DOC, ['peanuts', ''])).toEqual([{ text: DOC, mark: false }]);
  });
});
