import { describe, expect, it } from 'vitest';
import { renderRequestSchema } from './contract.js';

describe('renderRequestSchema', () => {
  it('defaults to the safe posture: no JavaScript, no external assets', () => {
    const parsed = renderRequestSchema.parse({ html: '<p>hi</p>' });

    expect(parsed.javascript).toBe(false);
    expect(parsed.allowExternalAssets).toBe(false);
    expect(parsed.printBackground).toBe(true);
  });

  it('rejects an empty document', () => {
    expect(renderRequestSchema.safeParse({ html: '' }).success).toBe(false);
  });

  it('rejects a scale outside Chromium’s supported range', () => {
    expect(renderRequestSchema.safeParse({ html: '<p>x</p>', scale: 5 }).success).toBe(false);
  });
});
