import { CheckCircle2, ChevronRight, CircleHelp, FileText, Highlighter, ShieldCheck, Volume2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import type { Answer, Source } from '@/lib/archive';

type Props = {
  answer: Answer | null;
  onOpenSource: (source: Source) => void;
  onListen?: ((text: string) => void) | undefined;
  speaking?: boolean | undefined;
  emptyText?: string | undefined;
};

/** Splits an older-style answer ("summary\n• point\n• point") into summary and points. */
function parts(answer: Answer): { summary: string; points: string[] } {
  if (answer.summary || (answer.points && answer.points.length)) {
    return { summary: answer.summary ?? '', points: answer.points ?? [] };
  }
  const lines = answer.answer.split('\n').map((l) => l.trim()).filter(Boolean);
  const points = lines.filter((l) => /^[•\-*]\s/.test(l)).map((l) => l.replace(/^[•\-*]\s+/, ''));
  const summary = lines.filter((l) => !/^[•\-*]\s/.test(l)).join(' ');
  return { summary, points };
}

/** A short, plain-language answer with tappable sources underneath. */
export function AnswerCard({ answer, onOpenSource, onListen, speaking, emptyText }: Props) {
  if (!answer) {
    return (
      <div className="rounded-2xl border border-dashed border-border bg-card/60 px-5 py-8 text-center">
        <p className="text-sm text-muted-foreground">{emptyText ?? 'Your answer will appear here, with the documents it came from.'}</p>
        <p className="mt-2 inline-flex items-center gap-1.5 text-xs text-muted-foreground"><ShieldCheck size={13} /> Only information you are allowed to see</p>
      </div>
    );
  }

  if (answer.is_unknown) {
    return (
      <div className="rounded-2xl border border-warning/30 bg-warning-surface p-5" aria-live="polite">
        <p className="flex items-center gap-2 font-semibold text-warning"><CircleHelp size={19} /> I don't know</p>
        <p className="mt-2 text-sm leading-6 text-foreground/80">{answer.answer.replace(/^I don't know\.\s*/, '')}</p>
      </div>
    );
  }

  const { summary, points } = parts(answer);
  const spoken = [summary, ...points].filter(Boolean).join('. ');

  return (
    <div className="overflow-hidden rounded-2xl border border-border bg-card shadow-sm" aria-live="polite">
      <div className="p-5">
        <div className="mb-3 flex items-center justify-between gap-2">
          <p className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-primary">
            <CheckCircle2 size={15} /> Answer
          </p>
          {onListen && (
            <Button variant="ghost" size="sm" onClick={() => onListen(spoken)}>
              <Volume2 size={14} /> {speaking ? 'Stop' : 'Listen'}
            </Button>
          )}
        </div>
        {summary && <p className="text-lg font-semibold leading-7">{summary}</p>}
        {points.length > 0 && (
          <ul className="mt-3 space-y-2">
            {points.map((p) => (
              <li key={p} className="flex gap-2.5 text-[15px] leading-6">
                <span className="mt-2.5 h-1.5 w-1.5 shrink-0 rounded-full bg-primary" aria-hidden="true" />
                <span>{p}</span>
              </li>
            ))}
          </ul>
        )}
      </div>

      {answer.sources.length > 0 && (
        <div className="border-t border-border bg-muted/40 px-3 py-3">
          <p className="px-2 pb-2 text-xs font-medium text-muted-foreground">Where this comes from — tap to see it highlighted</p>
          <ul className="space-y-1.5">
            {answer.sources.map((s) => {
              const count = s.quotes?.length ?? 0;
              return (
                <li key={s.doc_id || s.reference}>
                  <button
                    type="button"
                    onClick={() => onOpenSource(s)}
                    className="flex w-full items-center gap-3 rounded-xl bg-card px-3 py-3 text-left shadow-sm ring-1 ring-border transition hover:ring-primary/40 focus-visible:outline-2 focus-visible:outline-ring"
                  >
                    <FileText size={18} className="shrink-0 text-primary" />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium">{s.title}</span>
                      <span className="block truncate text-xs text-muted-foreground">
                        {count > 0 ? `“${s.quotes?.[0]}”` : [s.reference, s.date].filter(Boolean).join(' · ')}
                      </span>
                    </span>
                    {count > 0 && (
                      <span className="hidden shrink-0 items-center gap-1 rounded-full bg-warning-surface px-2 py-0.5 text-[11px] text-warning sm:inline-flex">
                        <Highlighter size={11} /> {count}
                      </span>
                    )}
                    <ChevronRight size={16} className="shrink-0 text-muted-foreground" />
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}
