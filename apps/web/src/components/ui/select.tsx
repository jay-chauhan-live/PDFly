import type { ComponentProps } from 'react';

import { cn } from '@/lib/utils';

/**
 * A native `<select>` wearing the shadcn input styling.
 *
 * The Radix listbox is worth its weight when an option needs an icon or a
 * description. These are short lists of plain strings, where the platform
 * control is smaller, keyboard- and screen-reader-correct for free, and gets
 * the native picker on a phone.
 */
export function Select({ className, ...props }: ComponentProps<'select'>) {
  return (
    <select
      data-slot="select"
      className={cn(
        'border-input bg-background focus-visible:border-ring focus-visible:ring-ring/50 h-9 w-full rounded-md border px-3 py-1 text-sm shadow-xs transition-[color,box-shadow] outline-none focus-visible:ring-[3px] disabled:cursor-not-allowed disabled:opacity-50',
        className,
      )}
      {...props}
    />
  );
}
