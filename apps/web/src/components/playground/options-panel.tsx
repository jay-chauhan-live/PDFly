'use client';

import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { PAGE_FORMATS, WAIT_UNTIL, type PageFormat, type RenderOptions } from '@/lib/api';

const MARGIN_SIDES = ['top', 'right', 'bottom', 'left'] as const;

const capitalise = (value: string) => value.charAt(0).toUpperCase() + value.slice(1);

export function OptionsPanel({
  options,
  onChange,
}: {
  options: RenderOptions;
  onChange: (next: RenderOptions) => void;
}) {
  const set = <K extends keyof RenderOptions>(key: K, value: RenderOptions[K]) =>
    onChange({ ...options, [key]: value });

  const setMargin = (side: (typeof MARGIN_SIDES)[number], value: string) =>
    onChange({ ...options, margin: { ...options.margin, [side]: value } });

  return (
    <div className="flex flex-col gap-5">
      <section className="flex flex-col gap-3">
        <h3 className="text-sm font-medium">Page setup</h3>

        <div className="grid grid-cols-2 gap-3">
          <div className="grid gap-1.5">
            <Label htmlFor="format">Format</Label>
            <Select
              id="format"
              value={options.format ?? 'A4'}
              onChange={(event) => set('format', event.target.value as PageFormat)}
            >
              {PAGE_FORMATS.map((format) => (
                <option key={format} value={format}>
                  {format}
                </option>
              ))}
            </Select>
          </div>

          <div className="grid gap-1.5">
            <Label htmlFor="orientation">Orientation</Label>
            <Select
              id="orientation"
              value={options.landscape ? 'landscape' : 'portrait'}
              onChange={(event) => set('landscape', event.target.value === 'landscape')}
            >
              <option value="portrait">Portrait</option>
              <option value="landscape">Landscape</option>
            </Select>
          </div>
        </div>

        <fieldset className="grid gap-1.5">
          <legend className="mb-1.5 text-sm leading-none font-medium">Margins</legend>
          <div className="grid grid-cols-4 gap-2">
            {MARGIN_SIDES.map((side) => (
              <div key={side} className="grid gap-1">
                <Label htmlFor={`margin-${side}`} className="text-muted-foreground text-xs">
                  {capitalise(side)}
                </Label>
                <Input
                  id={`margin-${side}`}
                  value={options.margin?.[side] ?? ''}
                  placeholder="15mm"
                  onChange={(event) => setMargin(side, event.target.value)}
                />
              </div>
            ))}
          </div>
        </fieldset>

        <div className="grid gap-1.5">
          <Label htmlFor="scale">Scale ({(options.scale ?? 1).toFixed(2)}×)</Label>
          <input
            id="scale"
            type="range"
            min={0.1}
            max={2}
            step={0.05}
            value={options.scale ?? 1}
            className="accent-primary"
            onChange={(event) => set('scale', Number(event.target.value))}
          />
        </div>
      </section>

      <section className="flex flex-col gap-3">
        <h3 className="text-sm font-medium">Rendering</h3>

        <label className="flex items-center gap-2 text-sm">
          <Checkbox
            checked={options.printBackground ?? true}
            onChange={(event) => set('printBackground', event.target.checked)}
          />
          Print background colours and images
        </label>

        <label className="flex items-center gap-2 text-sm">
          <Checkbox
            checked={options.javascript ?? false}
            onChange={(event) => set('javascript', event.target.checked)}
          />
          Run JavaScript
        </label>
        <p className="text-muted-foreground -mt-1 text-xs">
          Off by default: every script that runs is code from the document being rendered.
        </p>

        <label className="flex items-center gap-2 text-sm">
          <Checkbox
            checked={options.allowExternalAssets ?? false}
            onChange={(event) => set('allowExternalAssets', event.target.checked)}
          />
          Allow external assets
        </label>
        <p className="text-muted-foreground -mt-1 text-xs">
          Off by default: images, fonts and stylesheets loaded over the network are blocked, and
          only inline (<code>data:</code>) or uploaded assets render. Turn this on to fetch remote
          URLs such as a hosted logo. Private and loopback addresses are always refused; name the
          hosts you trust with <code>assetHostAllowlist</code> in the API call.
        </p>

        <div className="grid gap-1.5">
          <Label htmlFor="waitUntil">Wait until</Label>
          <Select
            id="waitUntil"
            value={options.waitUntil ?? 'load'}
            onChange={(event) => set('waitUntil', event.target.value as RenderOptions['waitUntil'])}
          >
            {WAIT_UNTIL.map((value) => (
              <option key={value} value={value}>
                {value}
              </option>
            ))}
          </Select>
        </div>
      </section>

      <section className="flex flex-col gap-3">
        <h3 className="text-sm font-medium">Header and footer</h3>
        <p className="text-muted-foreground -mt-1 text-xs">
          HTML fragments. Chromium substitutes <code>pageNumber</code>, <code>totalPages</code>,{' '}
          <code>title</code> and <code>date</code> into elements carrying those classes.
        </p>

        <div className="grid gap-1.5">
          <Label htmlFor="headerTemplate">Header</Label>
          <textarea
            id="headerTemplate"
            rows={2}
            value={options.headerTemplate ?? ''}
            placeholder="<div style='font-size:9px'>Draft</div>"
            className="border-input focus-visible:border-ring focus-visible:ring-ring/50 rounded-md border bg-transparent px-3 py-2 font-mono text-xs shadow-xs outline-none focus-visible:ring-[3px]"
            onChange={(event) => set('headerTemplate', event.target.value)}
          />
        </div>

        <div className="grid gap-1.5">
          <Label htmlFor="footerTemplate">Footer</Label>
          <textarea
            id="footerTemplate"
            rows={2}
            value={options.footerTemplate ?? ''}
            placeholder="<div style='font-size:9px'>Page <span class='pageNumber'></span></div>"
            className="border-input focus-visible:border-ring focus-visible:ring-ring/50 rounded-md border bg-transparent px-3 py-2 font-mono text-xs shadow-xs outline-none focus-visible:ring-[3px]"
            onChange={(event) => set('footerTemplate', event.target.value)}
          />
        </div>
      </section>
    </div>
  );
}
