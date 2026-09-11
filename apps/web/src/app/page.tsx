import { Logo } from '@/components/logo';
import { ThemeToggle } from '@/components/theme-toggle';
import { Button } from '@/components/ui/button';

/**
 * Placeholder shell. The real overview — renders today, success rate, p95
 * duration, recent failures — arrives with the dashboard in Phase 2.
 */
export default function HomePage() {
  return (
    <div className="mx-auto flex min-h-dvh max-w-3xl flex-col gap-10 px-6 py-16">
      <header className="flex items-start justify-between gap-4">
        <div className="space-y-2">
          <h1>
            <Logo />
          </h1>
          <p className="text-muted-foreground text-sm">
            HTML to PDF, with password protection and watermarking.
          </p>
        </div>
        <ThemeToggle />
      </header>

      <section className="space-y-4">
        <h2 className="text-sm font-medium">Phase 1 — render core</h2>
        <ul className="text-muted-foreground space-y-1.5 text-sm">
          <li>Isolated Playwright pool: HTML in, PDF out, no database access</li>
          <li>
            <code>POST /v1/pdf</code> — synchronous render, stored and recorded
          </li>
          <li>JavaScript and external assets refused unless explicitly enabled</li>
          <li>Watermarking, encryption and real API tokens land in Phases 4 and 5</li>
        </ul>
        <Button variant="outline" size="sm" asChild>
          <a href="http://localhost:3001/health">Check api health</a>
        </Button>
      </section>
    </div>
  );
}
