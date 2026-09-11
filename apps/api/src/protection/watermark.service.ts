import { Injectable, Logger } from '@nestjs/common';
import { degrees, PDFDocument, rgb, StandardFonts, type PDFFont, type PDFPage } from 'pdf-lib';
import { ProblemError } from '../common/errors/problem.js';
import { resolvePages } from './page-selection.js';
import type { WatermarkDto } from '../pdf/dto/render-pdf.dto.js';

/** Nine-point grid, as a fraction of the page in each axis. */
const ANCHORS = {
  'top-left': [0.15, 0.85],
  top: [0.5, 0.85],
  'top-right': [0.85, 0.85],
  left: [0.15, 0.5],
  center: [0.5, 0.5],
  right: [0.85, 0.5],
  'bottom-left': [0.15, 0.15],
  bottom: [0.5, 0.15],
  'bottom-right': [0.85, 0.15],
} as const;

export type WatermarkPosition = keyof typeof ANCHORS;

/**
 * Stamps a watermark onto a rendered PDF (PLAN §3).
 *
 * Deliberately not a CSS overlay injected before rendering. That would be
 * cheaper, but it lives inside the caller's document where their own styles
 * can override it, and `position: fixed` repeating on every printed page is
 * unreliable across Chromium versions. Stamping afterwards is deterministic,
 * covers pages the HTML never anticipated, and is the only approach that
 * works if watermarking is ever enforced by plan tier rather than requested.
 */
@Injectable()
export class WatermarkService {
  private readonly logger = new Logger(WatermarkService.name);

  async apply(pdf: Buffer, watermark: WatermarkDto): Promise<Buffer> {
    const document = await PDFDocument.load(pdf, { updateMetadata: false });
    const pages = document.getPages();
    const indices = resolvePages(watermark.pages, pages.length);

    if (indices.length === 0) {
      this.logger.debug('watermark selected no pages; leaving the document alone');
      return pdf;
    }

    if (watermark.type === 'image') {
      await this.stampImage(document, pages, indices, watermark);
    } else {
      await this.stampText(document, pages, indices, watermark);
    }

    return Buffer.from(await document.save());
  }

  private async stampText(
    document: PDFDocument,
    pages: PDFPage[],
    indices: number[],
    watermark: WatermarkDto,
  ): Promise<void> {
    const text = watermark.text?.trim();

    if (!text) {
      throw new ProblemError('invalid_request', 400, 'A text watermark needs `text`');
    }

    const font = await document.embedFont(StandardFonts.HelveticaBold);
    const size = watermark.fontSize ?? 64;
    const colour = parseColour(watermark.color ?? '#000000');
    const rotation = watermark.rotation ?? -45;
    const opacity = watermark.opacity ?? 0.12;

    for (const index of indices) {
      const page = pages[index];
      if (!page) continue;

      const { x, y } = anchorFor(page, watermark.position, textExtent(font, text, size, rotation));

      page.drawText(text, {
        x,
        y,
        size,
        font,
        color: rgb(colour.r, colour.g, colour.b),
        opacity,
        rotate: degrees(rotation),
      });
    }
  }

  private async stampImage(
    document: PDFDocument,
    pages: PDFPage[],
    indices: number[],
    watermark: WatermarkDto,
  ): Promise<void> {
    if (!watermark.imageBase64) {
      throw new ProblemError('invalid_request', 400, 'An image watermark needs `imageBase64`');
    }

    const bytes = decodeImage(watermark.imageBase64);
    const image = await this.embed(document, bytes);

    // Scale relative to the page rather than to fixed points, so the same
    // watermark looks right on A4 and on a poster.
    const opacity = watermark.opacity ?? 0.12;
    const rotation = watermark.rotation ?? 0;

    for (const index of indices) {
      const page = pages[index];
      if (!page) continue;

      const { width: pageWidth } = page.getSize();
      const scale = ((watermark.scale ?? 0.4) * pageWidth) / image.width;
      const width = image.width * scale;
      const height = image.height * scale;

      const { x, y } = anchorFor(page, watermark.position, { width, height });

      page.drawImage(image, {
        x,
        y,
        width,
        height,
        opacity,
        rotate: degrees(rotation),
      });
    }
  }

  private async embed(document: PDFDocument, bytes: Buffer) {
    // PNG and JPEG are what pdf-lib can embed; anything else is a caller
    // error, not a render failure to debug later.
    try {
      return isPng(bytes) ? await document.embedPng(bytes) : await document.embedJpg(bytes);
    } catch {
      throw new ProblemError('invalid_request', 400, 'Watermark image must be a PNG or JPEG');
    }
  }
}

function isPng(bytes: Buffer): boolean {
  return bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
}

function decodeImage(value: string): Buffer {
  const base64 = value.startsWith('data:') ? (value.split(',')[1] ?? '') : value;
  const bytes = Buffer.from(base64, 'base64');

  if (bytes.byteLength === 0) {
    throw new ProblemError('invalid_request', 400, 'Watermark image is not valid base64');
  }

  return bytes;
}

/**
 * The bounding box a rotated line of text occupies, used to centre it on its
 * anchor. Without this a rotated watermark drifts off the corner of the page.
 */
function textExtent(
  font: PDFFont,
  text: string,
  size: number,
  rotation: number,
): { width: number; height: number } {
  const width = font.widthOfTextAtSize(text, size);
  const height = font.heightAtSize(size);
  const radians = (rotation * Math.PI) / 180;
  const cos = Math.abs(Math.cos(radians));
  const sin = Math.abs(Math.sin(radians));

  return {
    width: width * cos + height * sin,
    height: width * sin + height * cos,
  };
}

function anchorFor(
  page: PDFPage,
  position: WatermarkPosition | undefined,
  extent: { width: number; height: number },
): { x: number; y: number } {
  const { width: pageWidth, height: pageHeight } = page.getSize();
  const [fx, fy] = ANCHORS[position ?? 'center'];

  // pdf-lib draws from the text's origin, so the anchor is shifted by half the
  // extent to make the stamp sit centred on its anchor point.
  return {
    x: pageWidth * fx - extent.width / 2,
    y: pageHeight * fy - extent.height / 2,
  };
}

function parseColour(value: string): { r: number; g: number; b: number } {
  const hex = /^#?([0-9a-f]{6})$/i.exec(value.trim());

  if (!hex?.[1]) {
    throw new ProblemError(
      'invalid_request',
      400,
      `Watermark colour must be #rrggbb, got "${value}"`,
    );
  }

  const int = Number.parseInt(hex[1], 16);

  return {
    r: ((int >> 16) & 0xff) / 255,
    g: ((int >> 8) & 0xff) / 255,
    b: (int & 0xff) / 255,
  };
}
