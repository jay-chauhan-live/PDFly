'use client';

import { AlertCircle, FileText, Gauge, Percent } from 'lucide-react';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { StatusBadge } from '@/components/documents/status-badge';
import { useAuth } from '@/components/auth-provider';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import {
  ApiError,
  getUsage,
  listDocuments,
  type DocumentSummary,
  type UsageResponse,
} from '@/lib/api';
import { formatBytes, formatDuration, formatRelative } from '@/lib/format';
import { cn } from '@/lib/utils';

export default function OverviewPage() {
  const { user } = useAuth();

  const [usage, setUsage] = useState<UsageResponse | null>(null);
  const [failures, setFailures] = useState<DocumentSummary[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    Promise.all([getUsage(30), listDocuments({ status: 'failed', limit: 5 })])
      .then(([usageResult, failed]) => {
        setUsage(usageResult);
        setFailures(failed.data);
      })
      .catch((caught: unknown) => {
        setError(caught instanceof ApiError ? caught.message : 'Could not load your metrics.');
      })
      .finally(() => setLoaded(true));
  }, []);

  const performance = usage?.performance;
  const today = usage?.today;

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Overview</h1>
        <p className="text-muted-foreground text-sm">
          {user ? `${user.org.name} · ${user.org.plan} plan` : null}
        </p>
      </div>

      <p aria-live="polite" className="text-destructive min-h-5 text-sm">
        {error}
      </p>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Metric
          label="Renders today"
          value={loaded ? (usage?.today.renders.toLocaleString() ?? '0') : '—'}
          detail={
            usage
              ? `${usage.today.pages.toLocaleString()} pages · ${formatBytes(usage.today.bytes)}`
              : ' '
          }
          Icon={FileText}
        />
        <Metric
          label="Success rate"
          // From the same counters as "Renders today", not the documents
          // table: two cards describing the same events must not disagree.
          value={
            today && today.renders > 0
              ? `${Math.round(((today.renders - today.failures) / today.renders) * 100)}%`
              : '—'
          }
          detail={
            today && today.renders > 0
              ? `${today.failures} failed of ${today.renders}`
              : 'Nothing rendered today'
          }
          Icon={Percent}
        />
        <Metric
          label="p95 duration"
          value={formatDuration(performance?.p95DurationMs ?? null)}
          detail={
            performance?.p50DurationMs != null
              ? `median ${formatDuration(performance.p50DurationMs)}`
              : ' '
          }
          Icon={Gauge}
        />
        <Metric
          label="This month"
          value={loaded ? (usage?.month.renders.toLocaleString() ?? '0') : '—'}
          detail={usage ? `${usage.month.pages.toLocaleString()} pages` : ' '}
          Icon={FileText}
        />
      </div>

      {usage && usage.daily.length > 0 ? <RenderChart days={usage.daily} /> : null}

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <AlertCircle className="size-4" aria-hidden="true" />
            Recent failures
          </CardTitle>
          <CardDescription>
            {failures.length === 0 && loaded
              ? 'Nothing has failed. '
              : 'The most recent renders that did not produce a PDF.'}
            {failures.length === 0 && loaded ? (
              <Link href="/playground" className="underline underline-offset-4">
                Render something
              </Link>
            ) : null}
          </CardDescription>
        </CardHeader>

        {failures.length > 0 ? (
          <CardContent>
            <ul className="divide-y">
              {failures.map((failure) => (
                <li key={failure.id} className="flex items-center justify-between gap-4 py-2">
                  <div className="min-w-0">
                    <Link
                      href={`/documents/${failure.id}`}
                      className="truncate font-medium underline-offset-4 hover:underline"
                    >
                      {failure.title ?? 'Untitled'}
                    </Link>
                    <p className="text-muted-foreground font-mono text-xs">{failure.errorCode}</p>
                  </div>
                  <div className="flex shrink-0 items-center gap-3">
                    <span className="text-muted-foreground text-xs">
                      {formatRelative(failure.createdAt)}
                    </span>
                    <StatusBadge status={failure.status} />
                  </div>
                </li>
              ))}
            </ul>
          </CardContent>
        ) : null}
      </Card>
    </div>
  );
}

function Metric({
  label,
  value,
  detail,
  Icon,
}: {
  label: string;
  value: string;
  detail: string;
  Icon: typeof FileText;
}) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardDescription className="flex items-center gap-1.5">
          <Icon className="size-3.5" aria-hidden="true" />
          {label}
        </CardDescription>
        <CardTitle className="text-2xl tabular-nums">{value}</CardTitle>
      </CardHeader>
      <CardContent>
        <p className="text-muted-foreground min-h-4 text-xs">{detail}</p>
      </CardContent>
    </Card>
  );
}

/**
 * Bars rather than a chart library: one series of daily counts does not need
 * an axis system, a tooltip engine, or 40 kB of JavaScript. The numbers are
 * in the table underneath for anyone who needs the exact figures.
 */
function RenderChart({ days }: { days: { date: string; renders: number; failures: number }[] }) {
  const peak = Math.max(1, ...days.map((day) => day.renders));

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base">Renders</CardTitle>
        <CardDescription>
          Last {days.length} day{days.length === 1 ? '' : 's'}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="flex h-28 items-end gap-1" role="img" aria-label={summarise(days)}>
          {days.map((day) => (
            <div
              key={day.date}
              // h-full, because a percentage height only resolves against a
              // parent with a definite one — otherwise every bar collapses.
              className="group relative flex h-full flex-1 flex-col justify-end gap-px"
            >
              {day.failures > 0 ? (
                <div
                  className="bg-destructive/70 rounded-t-sm"
                  style={{ height: `${(day.failures / peak) * 100}%` }}
                />
              ) : null}
              <div
                className={cn(
                  'rounded-t-sm transition-colors',
                  day.renders > 0 ? 'bg-primary/80 group-hover:bg-primary' : 'bg-muted',
                )}
                style={{
                  height: `${((day.renders - day.failures) / peak) * 100}%`,
                  // A quiet day is still a day: leave a baseline tick so the
                  // axis reads as a timeline rather than a gap.
                  minHeight: 2,
                }}
              />
              <span className="bg-foreground text-background pointer-events-none absolute bottom-full left-1/2 z-10 mb-1 hidden -translate-x-1/2 rounded px-1.5 py-0.5 text-xs whitespace-nowrap group-hover:block">
                {day.date}: {day.renders}
              </span>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

function summarise(days: { date: string; renders: number }[]): string {
  const total = days.reduce((sum, day) => sum + day.renders, 0);
  return `${total} renders over the last ${days.length} days`;
}
