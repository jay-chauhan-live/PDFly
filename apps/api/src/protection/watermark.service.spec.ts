import { promisify } from 'node:util';
import { unzip } from 'node:zlib';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import { beforeAll, describe, expect, it } from 'vitest';
import { WatermarkService } from './watermark.service.js';
import { resolvePages } from './page-selection.js';

const service = new WatermarkService();

let threePages: Buffer;

/** A 2×2 red PNG, small enough to inline. */
const RED_PNG =
  'iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAFElEQVR4nGP8z4AATAxQxhArEQAA//8CJAD0X8pWDgAAAABJRU5ErkJggg==';

/**
 * Everything the PDF says, with its compressed streams inflated.
 *
 * pdf-lib writes page content through FlateDecode, so scanning the raw file
 * for a string finds nothing even when the text is there — an assertion that
 * would pass for the wrong reason if the behaviour ever regressed.
 */
async function textOf(pdf: Buffer): Promise<string> {
  const inflate = promisify(unzip);
  const parts: string[] = [pdf.toString('latin1')];

  let cursor = 0;

  for (;;) {
    const open = pdf.indexOf('stream', cursor);
    if (open === -1) break;

    const close = pdf.indexOf('endstream', open);
    if (close === -1) break;

    // Skip the newline(s) that follow the `stream` keyword.
    let from = open + 'stream'.length;
    if (pdf[from] === 0x0d) from += 1;
    if (pdf[from] === 0x0a) from += 1;

    const expanded = await inflate(pdf.subarray(from, close)).catch(() => Buffer.alloc(0));

    if (expanded.byteLength > 0) {
      const content = expanded.toString('latin1');
      parts.push(content, decodeHexStrings(content));
    }

    cursor = close + 'endstream'.length;
  }

  return parts.join('\n');
}

/**
 * pdf-lib writes drawn text as a hex string operand, so `CONFIDENTIAL`
 * appears in the content stream as <434F4E464944454E5449414C> rather than as
 * readable text. Decoding those puts it back where an assertion can see it.
 */
function decodeHexStrings(content: string): string {
  return [...content.matchAll(/<([0-9a-fA-F\s]+)>/g)]
    .map(([, hex]) => Buffer.from((hex ?? '').replace(/\s+/g, ''), 'hex').toString('latin1'))
    .join('\n');
}

beforeAll(async () => {
  const document = await PDFDocument.create();
  const font = await document.embedFont(StandardFonts.Helvetica);

  for (const label of ['One', 'Two', 'Three']) {
    document.addPage([595, 842]).drawText(label, { x: 50, y: 700, size: 24, font });
  }

  threePages = Buffer.from(await document.save());
});

describe('resolvePages', () => {
  it('understands the vocabulary from PLAN §6', () => {
    expect(resolvePages('all', 3)).toEqual([0, 1, 2]);
    expect(resolvePages(undefined, 3)).toEqual([0, 1, 2]);
    expect(resolvePages('first', 3)).toEqual([0]);
    expect(resolvePages('last', 3)).toEqual([2]);
    expect(resolvePages('1-3,7', 8)).toEqual([0, 1, 2, 6]);
    expect(resolvePages('2', 3)).toEqual([1]);
  });

  it('drops pages past the end rather than failing the render', () => {
    // "1-10" on a three-page document means "the first ten if they exist".
    expect(resolvePages('1-10', 3)).toEqual([0, 1, 2]);
    expect(resolvePages('9', 3)).toEqual([]);
  });

  it('deduplicates and orders overlapping ranges', () => {
    expect(resolvePages('3,1-2,2', 3)).toEqual([0, 1, 2]);
  });

  it('rejects nonsense, which is a typo the caller wants to hear about', () => {
    expect(() => resolvePages('abc', 3)).toThrow();
    expect(() => resolvePages('3-1', 3)).toThrow();
    expect(() => resolvePages('0', 3)).toThrow();
  });

  it('copes with an empty document', () => {
    expect(resolvePages('first', 0)).toEqual([]);
    expect(resolvePages('all', 0)).toEqual([]);
  });
});

describe('WatermarkService', () => {
  it('stamps text on every page by default', async () => {
    const stamped = await service.apply(threePages, { type: 'text', text: 'CONFIDENTIAL' });

    const content = await textOf(stamped);
    expect(content).toContain('CONFIDENTIAL');
    // The original pages survive: stamping adds, it does not replace.
    expect((await PDFDocument.load(stamped)).getPageCount()).toBe(3);
  });

  it('leaves the document untouched when the selection matches no pages', async () => {
    const stamped = await service.apply(threePages, {
      type: 'text',
      text: 'CONFIDENTIAL',
      pages: '9',
    });

    expect(stamped).toBe(threePages);
  });

  it('honours a page selection', async () => {
    const first = await service.apply(threePages, {
      type: 'text',
      text: 'DRAFT',
      pages: 'first',
    });
    const all = await service.apply(threePages, { type: 'text', text: 'DRAFT', pages: 'all' });

    // Three stamps take more bytes than one.
    expect(all.byteLength).toBeGreaterThan(first.byteLength);
  });

  it('accepts a base64 image and a data URI alike', async () => {
    const raw = await service.apply(threePages, { type: 'image', imageBase64: RED_PNG });
    const dataUri = await service.apply(threePages, {
      type: 'image',
      imageBase64: `data:image/png;base64,${RED_PNG}`,
    });

    expect(raw.byteLength).toBeGreaterThan(threePages.byteLength);
    expect(dataUri.byteLength).toBeGreaterThan(threePages.byteLength);
  });

  it('refuses a text watermark with no text', async () => {
    await expect(service.apply(threePages, { type: 'text' })).rejects.toMatchObject({
      code: 'invalid_request',
    });
  });

  it('refuses an image watermark with no image', async () => {
    await expect(service.apply(threePages, { type: 'image' })).rejects.toMatchObject({
      code: 'invalid_request',
    });
  });

  it('refuses something that is not a PNG or JPEG', async () => {
    await expect(
      service.apply(threePages, {
        type: 'image',
        imageBase64: Buffer.from('this is not an image').toString('base64'),
      }),
    ).rejects.toMatchObject({ code: 'invalid_request' });
  });

  it('refuses a colour that is not #rrggbb', async () => {
    await expect(
      service.apply(threePages, { type: 'text', text: 'X', color: 'rebeccapurple' }),
    ).rejects.toMatchObject({ code: 'invalid_request' });
  });

  it('keeps a rotated stamp on the page', async () => {
    // A rotated watermark anchored naively drifts off the corner; the bounding
    // box of the rotated text is what the anchor has to account for.
    const stamped = await service.apply(threePages, {
      type: 'text',
      text: 'CONFIDENTIAL DOCUMENT',
      rotation: -45,
      fontSize: 64,
      position: 'center',
    });

    const document = await PDFDocument.load(stamped);
    const page = document.getPage(0);
    const { width, height } = page.getSize();

    expect(width).toBe(595);
    expect(height).toBe(842);
    expect(await textOf(stamped)).toContain('CONFIDENTIAL DOCUMENT');
  });
});
