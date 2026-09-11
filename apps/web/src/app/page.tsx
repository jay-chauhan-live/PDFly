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
          <h1 className="text-3xl font-semibold tracking-tight">Inkwell</h1>
          <p className="text-muted-foreground text-sm">
            HTML to PDF, with password protection and watermarking.
          </p>
        </div>
        <ThemeToggle />
      </header>

      <section className="space-y-4">
        <h2 className="text-sm font-medium">Phase 0 — foundation</h2>
        <ul className="text-muted-foreground space-y-1.5 text-sm">
          <li>Monorepo, Docker Compose, CI</li>
          <li>NestJS api with validated config, structured logging, health checks</li>
          <li>Prisma schema and first migration</li>
          <li>Next.js app with shadcn/ui and theme switching</li>
        </ul>
        <Button variant="outline" size="sm" asChild>
          <a href="http://localhost:3001/health">Check api health</a>
        </Button>
      </section>
    </div>
  );
}
