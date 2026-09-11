'use client';

import { Eye, EyeOff, ShieldCheck } from 'lucide-react';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import {
  WATERMARK_POSITIONS,
  type Permissions,
  type Protection,
  type Watermark,
  type WatermarkPosition,
} from '@/lib/api';

const PERMISSION_LABELS: { key: keyof Permissions; label: string; hint?: string }[] = [
  { key: 'print', label: 'Print' },
  { key: 'highResolutionPrint', label: 'Print at high resolution', hint: 'Off allows proofs only' },
  { key: 'copy', label: 'Copy text and images' },
  { key: 'modify', label: 'Modify the document' },
  { key: 'annotate', label: 'Add comments' },
  { key: 'fillForms', label: 'Fill in forms' },
  { key: 'assemble', label: 'Reorder or rotate pages' },
];

export function WatermarkPanel({
  watermark,
  onChange,
}: {
  watermark: Watermark | undefined;
  onChange: (next: Watermark | undefined) => void;
}) {
  const enabled = watermark !== undefined;
  const current = watermark ?? { type: 'text' as const };

  const set = <K extends keyof Watermark>(key: K, value: Watermark[K]) =>
    onChange({ ...current, [key]: value });

  return (
    <div className="flex flex-col gap-3">
      <label className="flex items-center gap-2 text-sm font-medium">
        <Checkbox
          checked={enabled}
          onChange={(event) =>
            onChange(
              event.target.checked
                ? { type: 'text', text: 'CONFIDENTIAL', opacity: 0.12, rotation: -45, fontSize: 64 }
                : undefined,
            )
          }
        />
        Watermark
      </label>

      {enabled ? (
        <div className="flex flex-col gap-3 border-l pl-4">
          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-1.5">
              <Label htmlFor="wm-type">Type</Label>
              <Select
                id="wm-type"
                value={current.type}
                onChange={(event) => set('type', event.target.value as Watermark['type'])}
              >
                <option value="text">Text</option>
                <option value="image">Image</option>
              </Select>
            </div>

            <div className="grid gap-1.5">
              <Label htmlFor="wm-position">Position</Label>
              <Select
                id="wm-position"
                value={current.position ?? 'center'}
                onChange={(event) => set('position', event.target.value as WatermarkPosition)}
              >
                {WATERMARK_POSITIONS.map((position) => (
                  <option key={position} value={position}>
                    {position}
                  </option>
                ))}
              </Select>
            </div>
          </div>

          {current.type === 'text' ? (
            <>
              <div className="grid gap-1.5">
                <Label htmlFor="wm-text">Text</Label>
                <Input
                  id="wm-text"
                  value={current.text ?? ''}
                  maxLength={200}
                  onChange={(event) => set('text', event.target.value)}
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="grid gap-1.5">
                  <Label htmlFor="wm-size">Font size ({current.fontSize ?? 64})</Label>
                  <input
                    id="wm-size"
                    type="range"
                    min={8}
                    max={200}
                    value={current.fontSize ?? 64}
                    className="accent-primary"
                    onChange={(event) => set('fontSize', Number(event.target.value))}
                  />
                </div>

                <div className="grid gap-1.5">
                  <Label htmlFor="wm-color">Colour</Label>
                  <input
                    id="wm-color"
                    type="color"
                    value={current.color ?? '#000000'}
                    className="border-input h-9 w-full rounded-md border bg-transparent px-1"
                    onChange={(event) => set('color', event.target.value)}
                  />
                </div>
              </div>
            </>
          ) : (
            <div className="grid gap-1.5">
              <Label htmlFor="wm-image">Image</Label>
              <input
                id="wm-image"
                type="file"
                accept="image/png,image/jpeg"
                className="text-sm"
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  if (!file) return;

                  const reader = new FileReader();
                  reader.onload = () => set('imageBase64', String(reader.result));
                  reader.readAsDataURL(file);
                }}
              />
              <p className="text-muted-foreground text-xs">
                PNG or JPEG. Sent with the request until the assets endpoint lands.
              </p>
            </div>
          )}

          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-1.5">
              <Label htmlFor="wm-opacity">
                Opacity ({Math.round((current.opacity ?? 0.12) * 100)}%)
              </Label>
              <input
                id="wm-opacity"
                type="range"
                min={1}
                max={100}
                value={Math.round((current.opacity ?? 0.12) * 100)}
                className="accent-primary"
                onChange={(event) => set('opacity', Number(event.target.value) / 100)}
              />
            </div>

            <div className="grid gap-1.5">
              <Label htmlFor="wm-rotation">Rotation ({current.rotation ?? -45}°)</Label>
              <input
                id="wm-rotation"
                type="range"
                min={-180}
                max={180}
                value={current.rotation ?? -45}
                className="accent-primary"
                onChange={(event) => set('rotation', Number(event.target.value))}
              />
            </div>
          </div>

          <div className="grid gap-1.5">
            <Label htmlFor="wm-pages">Pages</Label>
            <Input
              id="wm-pages"
              value={current.pages ?? 'all'}
              placeholder="all, first, last, or 1-3,7"
              onChange={(event) => set('pages', event.target.value)}
            />
          </div>
        </div>
      ) : null}
    </div>
  );
}

export function ProtectionPanel({
  protection,
  onChange,
}: {
  protection: Protection | undefined;
  onChange: (next: Protection | undefined) => void;
}) {
  const [reveal, setReveal] = useState(false);
  const enabled = protection !== undefined;
  const current = protection ?? {};
  const permissions = current.permissions ?? {};

  const setPermission = (key: keyof Permissions, value: boolean) =>
    onChange({ ...current, permissions: { ...permissions, [key]: value } });

  return (
    <div className="flex flex-col gap-3">
      <label className="flex items-center gap-2 text-sm font-medium">
        <Checkbox
          checked={enabled}
          onChange={(event) => onChange(event.target.checked ? { permissions: {} } : undefined)}
        />
        Password protection
      </label>

      {enabled ? (
        <div className="flex flex-col gap-3 border-l pl-4">
          <p className="text-muted-foreground flex items-start gap-1.5 text-xs">
            <ShieldCheck className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
            AES-256. Passwords are used for this render and never stored — not in your history, not
            in our logs. Lose one and the document is gone.
          </p>

          <div className="grid gap-1.5">
            <Label htmlFor="pr-user">Password to open</Label>
            <div className="flex gap-2">
              <Input
                id="pr-user"
                type={reveal ? 'text' : 'password'}
                autoComplete="new-password"
                value={current.userPassword ?? ''}
                placeholder="Leave empty to allow opening"
                onChange={(event) =>
                  onChange({ ...current, userPassword: event.target.value || undefined })
                }
              />
              <Button
                type="button"
                variant="outline"
                size="icon"
                aria-label={reveal ? 'Hide passwords' : 'Show passwords'}
                onClick={() => setReveal((shown) => !shown)}
              >
                {reveal ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
              </Button>
            </div>
          </div>

          <div className="grid gap-1.5">
            <Label htmlFor="pr-owner">Password to change permissions</Label>
            <Input
              id="pr-owner"
              type={reveal ? 'text' : 'password'}
              autoComplete="new-password"
              value={current.ownerPassword ?? ''}
              placeholder="Generated and discarded if empty"
              onChange={(event) =>
                onChange({ ...current, ownerPassword: event.target.value || undefined })
              }
            />
            <p className="text-muted-foreground text-xs">
              Left empty, one is generated and thrown away, so nobody can lift the restrictions
              below.
            </p>
          </div>

          <fieldset className="grid gap-2">
            <legend className="mb-1 text-sm leading-none font-medium">Allowed</legend>
            {PERMISSION_LABELS.map(({ key, label, hint }) => (
              <label key={key} className="flex items-center gap-2 text-sm">
                <Checkbox
                  checked={permissions[key] !== false}
                  onChange={(event) => setPermission(key, event.target.checked)}
                />
                {label}
                {hint ? <span className="text-muted-foreground text-xs">— {hint}</span> : null}
              </label>
            ))}
          </fieldset>
        </div>
      ) : null}
    </div>
  );
}
