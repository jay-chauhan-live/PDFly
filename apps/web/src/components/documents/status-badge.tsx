import { cn } from '@/lib/utils';
import type { DocumentStatus } from '@/lib/api';

/**
 * Status carries a colour and a word. Colour alone would be meaningless to
 * anyone who cannot distinguish these hues, and invisible to a screen reader.
 */
const TONE: Record<DocumentStatus, string> = {
  completed: 'border-emerald-600/30 bg-emerald-600/10 text-emerald-700 dark:text-emerald-400',
  failed: 'border-destructive/30 bg-destructive/10 text-destructive',
  rendering: 'border-amber-600/30 bg-amber-600/10 text-amber-700 dark:text-amber-400',
  queued: 'border-border bg-muted text-muted-foreground',
  expired: 'border-border bg-muted text-muted-foreground',
};

export function StatusBadge({ status }: { status: DocumentStatus }) {
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium',
        TONE[status],
      )}
    >
      {status}
    </span>
  );
}
