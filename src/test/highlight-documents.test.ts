import { describe, expect, it } from 'vitest';
import { highlightSegments } from '@/lib/highlight';
import documents from '../../backend/src/documents.json';

type Doc = { doc_id: string; text: string };

/**
 * The server only ever returns passages that are exact text (or whole lines) of a
 * document. Check that the viewer can highlight every such line in every real document,
 * including column-aligned table rows.
 */
describe('highlighting the real clinic documents', () => {
  const docs = documents as Doc[];

  it('has all the documents', () => {
    expect(docs.length).toBeGreaterThanOrEqual(22);
  });

  for (const doc of docs) {
    it(`highlights every line of ${doc.doc_id}`, () => {
      const lines = doc.text.split('\n').map((l) => l.trim()).filter((l) => l.length >= 4 && !/^[=-]+$/.test(l));
      for (const line of lines) {
        const marked = highlightSegments(doc.text, [line]).filter((s) => s.mark).map((s) => s.text.trim());
        expect(marked.some((m) => m.includes(line.replace(/^["'.\s]+|["'.\s]+$/g, '').slice(0, 20))), `${doc.doc_id}: ${line}`).toBe(true);
      }
    });
  }

  it('highlights a model-style quote with different spacing in a table row', () => {
    const lab = docs.find((d) => d.doc_id === 'PAT-002-LAB');
    expect(lab).toBeDefined();
    const marked = highlightSegments(lab?.text ?? '', ['HbA1c 8.1 % 4.0-5.6 % HIGH']).filter((s) => s.mark);
    expect(marked).toHaveLength(1);
    expect(marked[0]?.text).toMatch(/^HbA1c\s+8\.1 %\s+4\.0-5\.6 %\s+HIGH$/);
  });
});
