import sharp from 'sharp';

/** Axis-aligned bounding box in absolute pixel coordinates of the screenshot. */
export type Bbox = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export type Annotation = {
  bbox: Bbox;
  /** Short label drawn next to the box, e.g. "1" or "1: ENG in TH page". */
  label: string;
  /** Optional CSS-style hex color, default red. */
  color?: string;
};

/**
 * Render annotations onto a screenshot using an SVG overlay composited via sharp.
 * Returns a PNG buffer.
 */
export async function annotateScreenshot(
  pngBuffer: Buffer,
  annotations: Annotation[],
): Promise<Buffer> {
  const meta = await sharp(pngBuffer).metadata();
  const W = meta.width ?? 1440;
  const H = meta.height ?? 900;

  // Clamp bboxes so we don't draw off-canvas; skip ones that are obviously bogus.
  const safe = annotations
    .map((a) => {
      const x = Math.max(0, Math.min(W - 1, Math.round(a.bbox.x)));
      const y = Math.max(0, Math.min(H - 1, Math.round(a.bbox.y)));
      const w = Math.max(2, Math.min(W - x, Math.round(a.bbox.width)));
      const h = Math.max(2, Math.min(H - y, Math.round(a.bbox.height)));
      return { ...a, bbox: { x, y, width: w, height: h } };
    })
    .filter((a) => a.bbox.width > 2 && a.bbox.height > 2);

  const escape = (s: string) =>
    s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

  const shapes = safe
    .map((a) => {
      const color = a.color ?? '#ff2d2d';
      const { x, y, width, height } = a.bbox;
      // Tag rectangle and label text positioned just above the bbox (or below
      // if the bbox starts at the top of the screenshot).
      const labelY = y > 22 ? y - 6 : y + height + 18;
      const labelText = escape(a.label);
      // Approximate label background width: ~8px per char, min 22.
      const tagW = Math.max(22, labelText.length * 9 + 10);
      const tagH = 20;
      const tagX = x;
      const tagYRect = y > 22 ? y - tagH - 2 : y + height + 2;
      return `
        <rect x="${x}" y="${y}" width="${width}" height="${height}"
              fill="none" stroke="${color}" stroke-width="3" />
        <rect x="${tagX}" y="${tagYRect}" width="${tagW}" height="${tagH}"
              fill="${color}" stroke="${color}" stroke-width="1" rx="3" ry="3" />
        <text x="${tagX + 5}" y="${labelY}"
              font-family="Helvetica, Arial, sans-serif"
              font-size="14" font-weight="700" fill="white">${labelText}</text>
      `;
    })
    .join('');

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">${shapes}</svg>`;

  return sharp(pngBuffer)
    .composite([{ input: Buffer.from(svg), top: 0, left: 0 }])
    .png()
    .toBuffer();
}
