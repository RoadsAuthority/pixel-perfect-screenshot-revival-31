import { useEffect, useRef, useState } from 'react';
import { ChevronDown, ExternalLink, FileText, Highlighter, LoaderCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { callArchive, type ArchiveDocText, type Source } from '@/lib/archive';
import { highlightSegments } from '@/lib/highlight';

/** Dialog classes that make a dialog full-screen on phones and centred on larger screens. */
export const MOBILE_FULLSCREEN =
  'max-sm:left-0 max-sm:top-0 max-sm:h-[100dvh] max-sm:max-h-none max-sm:max-w-none max-sm:translate-x-0 max-sm:translate-y-0';

type Props = {
  /** The source to show, or null when closed. */
  source: Source | null;
  onClose: () => void;
  url: string;
  token?: string | undefined;
  userId: string;
};

/** Shows a whole source document with the passages behind the answer highlighted. */
export function DocumentViewer({ source, onClose, url, token, userId }: Props) {
  const [doc, setDoc] = useState<ArchiveDocText | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [current, setCurrent] = useState(0);
  const body = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setDoc(null); setError(''); setCurrent(0);
    if (!source?.doc_id) return;
    let cancelled = false;
    setLoading(true);
    callArchive(url, { action: 'document', user_id: userId, doc_id: source.doc_id }, token)
      .then((data) => {
        if (cancelled) return;
        if (typeof data['text'] !== 'string') throw new Error('The document could not be opened.');
        setDoc(data as unknown as ArchiveDocText);
      })
      .catch((e: unknown) => { if (!cancelled) setError(e instanceof Error ? e.message : 'The document could not be opened.'); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [source, url, token, userId]);

  const quotes = source?.quotes ?? [];
  const segments = doc ? highlightSegments(doc.text, quotes) : [];
  const markCount = segments.filter((s) => s.mark).length;

  // Scroll the current highlight into view.
  useEffect(() => {
    const marks = body.current?.querySelectorAll('mark');
    const target = marks?.[current];
    if (target) target.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }, [doc, current]);

  return (
    <Dialog open={!!source} onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent className={`flex max-h-[88vh] max-w-2xl flex-col gap-3 p-0 ${MOBILE_FULLSCREEN}`}>
        <div className="border-b border-border px-5 pb-3 pt-5 pr-12">
          <DialogTitle className="flex items-start gap-2 text-base leading-6">
            <FileText size={18} className="mt-0.5 shrink-0 text-primary" /> {doc?.title ?? source?.title}
          </DialogTitle>
          <DialogDescription className="mt-1 text-xs">
            {[source?.reference, doc?.type ?? source?.type, doc?.date ?? source?.date].filter(Boolean).join(' · ')}
          </DialogDescription>
          {doc && (
            <div className="mt-3 flex flex-wrap items-center gap-2">
              {markCount > 0 ? (
                <>
                  <span className="inline-flex items-center gap-1.5 rounded-full bg-warning-surface px-2.5 py-1 text-xs font-medium text-warning">
                    <Highlighter size={13} /> {markCount} highlighted {markCount === 1 ? 'passage' : 'passages'} used in the answer
                  </span>
                  {markCount > 1 && (
                    <Button variant="outline" size="sm" onClick={() => setCurrent((c) => (c + 1) % markCount)}>
                      <ChevronDown size={13} /> Next ({current + 1}/{markCount})
                    </Button>
                  )}
                </>
              ) : (
                <span className="text-xs text-muted-foreground">Showing the full document.</span>
              )}
            </div>
          )}
        </div>

        <div ref={body} className="min-h-0 flex-1 overflow-y-auto px-5 pb-5">
          {loading && <p className="flex items-center gap-2 py-8 text-sm text-muted-foreground"><LoaderCircle size={16} className="animate-spin" /> Opening document…</p>}
          {error && (
            <div className="space-y-3 py-4 text-sm">
              <p className="text-warning">{error}</p>
              {source?.snippet && <blockquote className="rounded-md border-l-4 border-primary/40 bg-muted/50 p-3 leading-6">{source.snippet}</blockquote>}
            </div>
          )}
          {doc && (
            <pre className="whitespace-pre-wrap break-words font-mono text-[13px] leading-6 text-foreground">
              {segments.map((seg, i) =>
                seg.mark
                  ? <mark key={i} className="rounded bg-yellow-200 px-0.5 text-foreground ring-2 ring-yellow-300/60">{seg.text}</mark>
                  : <span key={i}>{seg.text}</span>,
              )}
            </pre>
          )}
        </div>

        {source?.url && (
          <div className="border-t border-border px-5 py-3">
            <a href={source.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 text-xs text-primary underline">
              <ExternalLink size={12} /> Download original file (link valid for 5 minutes)
            </a>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
