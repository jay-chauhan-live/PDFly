'use client';

import { useAuth } from '@/components/auth-provider';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

/**
 * Overview. The real metrics — renders today, success rate, p95 duration,
 * recent failures (PLAN §9) — need the usage counters from Phase 4.
 */
export default function OverviewPage() {
  const { user } = useAuth();

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Overview</h1>
        <p className="text-muted-foreground text-sm">
          {user ? `${user.org.name} · ${user.org.plan} plan` : null}
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Phase 2 — auth and dashboard shell</CardTitle>
          <CardDescription>
            Registration, login, rotating refresh tokens and the protected shell are in place.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ul className="text-muted-foreground space-y-1.5 text-sm">
            <li>Playground, documents and settings are next (Phases 3 and 4)</li>
            <li>Render metrics appear once usage counters land in Phase 4</li>
            <li>Email verification and password reset arrive with SMTP in Phase 6</li>
          </ul>
        </CardContent>
      </Card>
    </div>
  );
}
