import { useEffect, useRef, useState } from 'react';
import { ChevronDown, ExternalLink, FileText, Highlighter, ListChecks, LoaderCircle, ScanLine } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { callArchive, type ArchiveDocText, type KeyDetail, type KeyDetails, type Source } from '@/lib/archive';
import { highlightSegments } from '@/lib/highlight';

/** Dialog classes that make a dialog full-screen on phones and centred on larger screens. */
export const MOBILE_FULLSCREEN =
  'max-sm:left-0 max-sm:top-0 max-sm:h-[100dvh] max-sm:max-h-none max-sm:max-w-none max-sm:translate-x-0 max-sm:translate-y-0';

export type ViewerTab = 'text' | 'details' | 'scan';

type Props = {
  /** The source to show, or null when closed. */
  source: Source | null;
  onClose: () => void;
  url: string;
  token?: string | undefined;
  userId: string;
  /** Which view to open first. */
  initialTab?: ViewerTab | undefined;
};

const CATEGORY_LABEL: Record<KeyDetail['category'], string> = {
  date: 'Dates and deadlines',
  party: 'Parties and people',
  amount: 'Amounts',
  id: 'IDs and references',
  condition: 'Conditions',
  medication: 'Medicines',
  result: 'Results',
  other: 'Other facts',
};
const CATEGORY_ORDER: KeyDetail['category'][] = ['date', 'party', 'amount', 'medication', 'condition', 'result', 'id', 'other'];

/** Shows a whole source document: highlighted text, extracted key details, and the original scan. */
export function DocumentViewer({ source, onClose, url, token, userId, initialTab }: Props) {
  const [doc, setDoc] = useState<ArchiveDocText | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [current, setCurrent] = useState(0);
  const [tab, setTab] = useState<ViewerTab>('text');
  const [details, setDetails] = useState<KeyDetails | null>(null);
  const [detailsLoading, setDetailsLoading] = useState(false);
  const [detailsError, setDetailsError] = useState('');
  const [activeQuote, setActiveQuote] = useState<string | null>(null);
  const body = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setDoc(null); setError(''); setCurrent(0); setDetails(null); setDetailsError(''); setActiveQuote(null);
    setTab(initialTab ?? 'text');
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
  }, [source, url, token, userId, initialTab]);

  // Key details are extracted on first view of that tab.
  useEffect(() => {
    if (tab !== 'details' || details || detailsLoading || !source?.doc_id) return;
    setDetailsLoading(true); setDetailsError('');
    callArchive(url, { action: 'extract', user_id: userId, doc_id: source.doc_id }, token)
      .then((data) => setDetails(data as unknown as KeyDetails))
      .catch((e: unknown) => setDetailsError(e instanceof Error ? e.message : 'Key details could not be extracted.'))
      .finally(() => setDetailsLoading(false));
  }, [tab, details, detailsLoading, source, url, token, userId]);

  const quotes = activeQuote ? [activeQuote] : (source?.quotes ?? []);
  const segments = doc ? highlightSegments(doc.text, quotes) : [];
  const markCount = segments.filter((s) => s.mark).length;

  // Scroll the current highlight into view.
  useEffect(() => {
    if (tab !== 'text') return;
    const marks = body.current?.querySelectorAll('mark');
    const target = marks?.[current];
    if (target) target.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }, [doc, current, tab, activeQuote]);

  function showInDocument(detail: KeyDetail) {
    setActiveQuote(detail.quote);
    setCurrent(0);
    setTab('text');
  }

  const tabs: { id: ViewerTab; label: string; icon: typeof FileText }[] = [
    { id: 'text', label: 'Document', icon: FileText },
    { id: 'details', label: 'Key details', icon: ListChecks },
    ...(doc?.scan_url ? [{ id: 'scan' as const, label: 'Original scan', icon: ScanLine }] : []),
  ];

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
          <div className="mt-3 flex gap-1 overflow-x-auto" role="tablist">
            {tabs.map((t) => (
              <button
                key={t.id}
                type="button"
                role="tab"
                aria-selected={tab === t.id}
                onClick={() => setTab(t.id)}
                className={`flex shrink-0 items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium ${tab === t.id ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground'}`}
              >
                <t.icon size={13} /> {t.label}
              </button>
            ))}
          </div>
          {doc && tab === 'text' && (
            <div className="mt-3 flex flex-wrap items-center gap-2">
              {markCount > 0 ? (
                <>
                  <span className="inline-flex items-center gap-1.5 rounded-full bg-warning-surface px-2.5 py-1 text-xs font-medium text-warning">
                    <Highlighter size={13} /> {activeQuote ? 'Showing where this detail comes from' : `${markCount} highlighted ${markCount === 1 ? 'passage' : 'passages'} used in the answer`}
                  </span>
                  {markCount > 1 && (
                    <Button variant="outline" size="sm" onClick={() => setCurrent((c) => (c + 1) % markCount)}>
                      <ChevronDown size={13} /> Next ({current + 1}/{markCount})
                    </Button>
                  )}
                  {activeQuote && <Button variant="ghost" size="sm" onClick={() => setActiveQuote(null)}>Clear</Button>}
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

          {doc && tab === 'text' && (
            <pre className="whitespace-pre-wrap break-words font-mono text-[13px] leading-6 text-foreground">
              {segments.map((seg, i) =>
                seg.mark
                  ? <mark key={i} className="rounded bg-yellow-200 px-0.5 text-foreground ring-2 ring-yellow-300/60">{seg.text}</mark>
                  : <span key={i}>{seg.text}</span>,
              )}
            </pre>
          )}

          {tab === 'details' && (
            <div className="space-y-4 py-1">
              {detailsLoading && <p className="flex items-center gap-2 py-6 text-sm text-muted-foreground"><LoaderCircle size={16} className="animate-spin" /> Reading the document for dates, parties and amounts…</p>}
              {detailsError && <p className="text-sm text-warning">{detailsError}</p>}
              {details && (
                <>
                  {details.summary && <p className="text-sm font-medium leading-6">{details.summary}</p>}
                  {details.details.length === 0 && <p className="text-sm text-muted-foreground">No key details could be traced to the text.</p>}
                  {CATEGORY_ORDER.filter((c) => details.details.some((d) => d.category === c)).map((cat) => (
                    <section key={cat}>
                      <h3 className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">{CATEGORY_LABEL[cat]}</h3>
                      <ul className="divide-y divide-border overflow-hidden rounded-xl border border-border">
                        {details.details.filter((d) => d.category === cat).map((d, i) => (
                          <li key={`${d.label}-${i}`} className="flex items-start gap-3 bg-card px-3 py-2.5">
                            <span className="min-w-0 flex-1">
                              <span className="block text-xs text-muted-foreground">{d.label}</span>
                              <span className="block text-sm font-medium [font-variant-numeric:tabular-nums]">{d.value}</span>
                            </span>
                            <Button variant="ghost" size="sm" className="shrink-0 text-xs" onClick={() => showInDocument(d)}>
                              <Highlighter size={12} /> Show in document
                            </Button>
                          </li>
                        ))}
                      </ul>
                    </section>
                  ))}
                  <p className="text-[11px] text-muted-foreground">Extracted by AI. Every detail is linked to the exact line it comes from; details that could not be traced are left out.</p>
                </>
              )}
            </div>
          )}

          {tab === 'scan' && doc?.scan_url && (
            <div className="space-y-2 py-1">
              <p className="text-xs text-muted-foreground">The original scanned page. The “Document” tab shows the text read from it by OCR.</p>
              <a href={doc.scan_url} target="_blank" rel="noreferrer">
                <img src={doc.scan_url} alt={`Original scan of ${doc.title}`} className="w-full rounded-md border border-border" />
              </a>
            </div>
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
