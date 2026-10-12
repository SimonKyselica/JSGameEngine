import { Rect } from '../math/rect';
import { TEXT_FONTS, type TextAlign, type TextFont, type TextRenderer } from '../scene/components';
import type { TextureSource } from './renderer2d';

/**
 * Empty room around rasterized text, in em. Strokes reach outside the box a layout gives
 * them: slanted letters lean over its edge, and descenders hang below a tight line.
 */
export const TEXT_PADDING = 0.25;
/** The longest side a text texture may have, in pixels. Longer text is drawn less sharply. */
export const MAX_TEXT_TEXTURE_SIZE = 2048;

/** Used when a component's line height is not a usable number. */
const DEFAULT_LINE_HEIGHT = 1.2;
const MIN_PIXELS_PER_EM = 4;
const MAX_PIXELS_PER_EM = 512;
/** Up to this size text is rasterized at exactly the size it has on screen. */
const EXACT_PIXELS_PER_EM = 32;
/** Above it, sizes are rounded up to this many steps per doubling. */
const RASTER_STEPS_PER_OCTAVE = 8;
/**
 * A size this little above a whole number of pixels is taken to be that number. The size
 * on screen is the product of several factors, and 28 pixels can arrive as 28.000000000004,
 * which must not be rounded up to 29.
 */
const RASTER_TOLERANCE = 1e-3;

/** The part of a text's appearance that decides the shape of its letters, and so its width. */
export interface TextStyle {
  readonly font: TextFont;
  readonly bold: boolean;
  readonly italic: boolean;
}

/**
 * Measures text. Lengths are in em, multiples of the font size, so a measurement holds
 * for every size the text is drawn at.
 */
export interface TextMeasurer {
  /** The width of a single line of text in em. */
  measureLine(line: string, style: Readonly<TextStyle>): number;
}

/**
 * Measures text and turns it into images. This is the engine's only way to draw letters,
 * so a platform that can do this can show text.
 */
export interface TextRasterizer extends TextMeasurer {
  /**
   * Draws laid-out text in white on a transparent background, `pixelsPerEm` pixels to the
   * em. The image has the size {@link getRasterSize} gives, with the text centered in it.
   * The source may be reused by the next call, so it has to be uploaded right away.
   */
  rasterize(
    layout: Readonly<TextLayout>,
    style: Readonly<TextStyle>,
    pixelsPerEm: number,
  ): TextureSource;
}

/** A text broken into lines and measured. All lengths are in em. */
export interface TextLayout {
  readonly lines: readonly string[];
  /** The width of each line. */
  readonly lineWidths: readonly number[];
  /** The width of the widest line. */
  readonly width: number;
  /** The height of all lines together. */
  readonly height: number;
  /** The distance from one line to the next. */
  readonly lineHeight: number;
  /** How lines narrower than the widest one are placed. */
  readonly align: TextAlign;
}

/** The style of a text component, with a font the engine knows even if a script set another. */
export function getTextStyle(text: Readonly<TextRenderer>): TextStyle {
  const font = (TEXT_FONTS as readonly string[]).includes(text.font) ? text.font : TEXT_FONTS[0];
  return { font, bold: Boolean(text.bold), italic: Boolean(text.italic) };
}

/**
 * Breaks the text of a component into lines and measures them.
 *
 * Scripts are not type-checked, so `label.text = score` with a number is an easy thing to
 * write. Anything that is not a string is shown the way `String()` prints it.
 */
export function layoutText(text: Readonly<TextRenderer>, measurer: TextMeasurer): TextLayout {
  const content: unknown = text.text;
  // A number prints as its digits and a Vec2 as "Vec2(3, 4)". A plain object prints as
  // "[object Object]", which is what the lint rule warns about; here it is wanted, because
  // seeing that on screen shows the script's author what went wrong.
  // eslint-disable-next-line @typescript-eslint/no-base-to-string
  const written = typeof content === 'string' ? content : String(content ?? '');
  const style = getTextStyle(text);
  const lines = written.split(/\r\n|\r|\n/);
  const lineWidths = lines.map((line) => {
    const width = line === '' ? 0 : measurer.measureLine(line, style);
    return Number.isFinite(width) && width > 0 ? width : 0;
  });
  const lineHeight =
    Number.isFinite(text.lineHeight) && text.lineHeight > 0 ? text.lineHeight : DEFAULT_LINE_HEIGHT;
  return {
    lines,
    lineWidths,
    width: Math.max(0, ...lineWidths),
    height: lines.length * lineHeight,
    lineHeight,
    align: text.align,
  };
}

/**
 * The rectangle a laid-out text covers relative to its entity, in local units: the units
 * of the entity's transform, before its scale is applied.
 */
export function getTextRect(
  text: Readonly<TextRenderer>,
  layout: Readonly<TextLayout>,
  out = new Rect(),
): Rect {
  out.width = layout.width * text.fontSize;
  out.height = layout.height * text.fontSize;
  out.x = text.align === 'left' ? 0 : text.align === 'right' ? -out.width : -out.width / 2;
  // World Y points up, so a text that hangs below its entity has a negative minimum.
  out.y =
    text.verticalAlign === 'bottom'
      ? 0
      : text.verticalAlign === 'top'
        ? -out.height
        : -out.height / 2;
  return out;
}

/**
 * The resolution to rasterize a text at, given how many pixels an em covers on screen.
 *
 * Small text is drawn at exactly its size. Larger text is rounded up to the next of a few
 * fixed sizes, so that zooming does not rasterize it again for every pixel it grows. Text
 * too long for one texture gets a lower resolution rather than being cut off.
 */
export function getRasterPixelsPerEm(
  layout: Readonly<TextLayout>,
  desiredPixelsPerEm: number,
): number {
  // The comparison is written so that NaN ends up at the minimum.
  const clamped = !(desiredPixelsPerEm > MIN_PIXELS_PER_EM)
    ? MIN_PIXELS_PER_EM
    : Math.min(desiredPixelsPerEm, MAX_PIXELS_PER_EM);
  const quantized =
    clamped <= EXACT_PIXELS_PER_EM
      ? Math.ceil(clamped - RASTER_TOLERANCE)
      : Math.ceil(
          2 ** (Math.ceil(Math.log2(clamped) * RASTER_STEPS_PER_OCTAVE) / RASTER_STEPS_PER_OCTAVE),
        );
  const longestSide = Math.max(layout.width, layout.height) + 2 * TEXT_PADDING;
  const limit = Math.floor(MAX_TEXT_TEXTURE_SIZE / longestSide);
  return Math.max(1, Math.min(quantized, limit));
}

/** The size in pixels of the image a laid-out text is rasterized into, padding included. */
export function getRasterSize(
  layout: Readonly<TextLayout>,
  pixelsPerEm: number,
): { width: number; height: number } {
  const padding = Math.ceil(pixelsPerEm * TEXT_PADDING);
  const side = (em: number): number =>
    Math.max(1, Math.min(MAX_TEXT_TEXTURE_SIZE, Math.ceil(em * pixelsPerEm) + 2 * padding));
  return { width: side(layout.width), height: side(layout.height) };
}

/** One call to {@link HeadlessTextRasterizer.rasterize}. */
export interface RasterizedText {
  /** The lines that were drawn, joined with line breaks. */
  readonly text: string;
  readonly style: TextStyle;
  readonly pixelsPerEm: number;
}

/**
 * A text rasterizer that draws nothing and records what it was asked to draw. Used for
 * automated tests and for running games without a display, together with the
 * `HeadlessRenderer`.
 *
 * Its measurements are made up but fixed, so tests can assert on exact sizes: every
 * character is half an em wide, or 0.6 em in the monospace font.
 */
export class HeadlessTextRasterizer implements TextRasterizer {
  /** Every text that was rasterized, oldest first. */
  readonly rasterized: RasterizedText[] = [];

  measureLine(line: string, style: Readonly<TextStyle>): number {
    return line.length * (style.font === 'monospace' ? 0.6 : 0.5);
  }

  rasterize(
    layout: Readonly<TextLayout>,
    style: Readonly<TextStyle>,
    pixelsPerEm: number,
  ): TextureSource {
    this.rasterized.push({ text: layout.lines.join('\n'), style: { ...style }, pixelsPerEm });
    // No pixels: a HeadlessRenderer only looks at the size.
    return getRasterSize(layout, pixelsPerEm);
  }
}
