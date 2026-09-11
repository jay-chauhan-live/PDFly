import type { ComponentProps } from 'react';

import { cn } from '@/lib/utils';

/** Native checkbox, tinted to the theme's accent colour. */
export function Checkbox({ className, ...props }: ComponentProps<'input'>) {
  return (
    <input
      type="checkbox"
      data-slot="checkbox"
      className={cn(
        'border-input accent-primary focus-visible:border-ring focus-visible:ring-ring/50 size-4 rounded-[4px] border shadow-xs outline-none focus-visible:ring-[3px] disabled:cursor-not-allowed disabled:opacity-50',
        className,
      )}
      {...props}
    />
  );
}
