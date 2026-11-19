/** A run of document text, marked when it is part of a cited passage. */
export type Segment = { text: string; mark: boolean };

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Split `text` into segments, marking every occurrence of any quote.
 * Matching ignores case and differences in spacing/line breaks.
 */
export function highlightSegments(text: string, quotes: string[]): Segment[] {
  const ranges: [number, number][] = [];
  for (const quote of quotes) {
    const words = quote.trim().replace(/^["'.\s]+|["'.\s]+$/g, '').split(/\s+/).filter(Boolean);
    if (words.length === 0 || words.join(' ').length < 3) continue;
    const pattern = new RegExp(words.map(escapeRegExp).join('\\s+'), 'gi');
    for (const m of text.matchAll(pattern)) {
      if (m.index !== undefined && m[0].length > 0) ranges.push([m.index, m.index + m[0].length]);
    }
  }
  if (ranges.length === 0) return [{ text, mark: false }];

  ranges.sort((a, b) => a[0] - b[0]);
  const merged: [number, number][] = [];
  for (const [start, end] of ranges) {
    const last = merged[merged.length - 1];
    if (last && start <= last[1]) last[1] = Math.max(last[1], end);
    else merged.push([start, end]);
  }

  const segments: Segment[] = [];
  let cursor = 0;
  for (const [start, end] of merged) {
    if (start > cursor) segments.push({ text: text.slice(cursor, start), mark: false });
    segments.push({ text: text.slice(start, end), mark: true });
    cursor = end;
  }
  if (cursor < text.length) segments.push({ text: text.slice(cursor), mark: false });
  return segments;
}
