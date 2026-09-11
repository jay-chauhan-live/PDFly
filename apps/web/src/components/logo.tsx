import { cn } from '@/lib/utils';

/**
 * The mark alone — a page with a folded corner, chosen because it is the one
 * silhouette that still reads as a document at favicon size.
 */
export function Mark({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 32 32"
      className={cn('size-8', className)}
      role="img"
      aria-label="PDFly"
      focusable="false"
    >
      <defs>
        <linearGradient id="pdfly-g" x1="0" y1="0" x2="32" y2="32" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#4F6BFF" />
          <stop offset="1" stopColor="#8B3DFF" />
        </linearGradient>
      </defs>
      <rect width="32" height="32" rx="7.5" fill="url(#pdfly-g)" />
      <path d="M11 6h6.4L23 11.6V24a2 2 0 0 1-2 2H11a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2Z" fill="#fff" />
      <path d="M17.4 6 23 11.6h-3.6a2 2 0 0 1-2-2V6Z" fill="#C7D0FF" />
      <path
        d="M16 13.8v6.4m0 0 2.6-2.6M16 20.2l-2.6-2.6"
        stroke="url(#pdfly-g)"
        strokeWidth="2.1"
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
      />
    </svg>
  );
}

/** Mark plus wordmark. The wordmark inherits colour, so it inverts with the theme. */
export function Logo({ className }: { className?: string }) {
  return (
    <span className={cn('inline-flex items-center gap-2.5', className)}>
      <Mark className="size-8" aria-hidden="true" />
      <span className="text-xl font-semibold tracking-tight">PDFly</span>
    </span>
  );
}
