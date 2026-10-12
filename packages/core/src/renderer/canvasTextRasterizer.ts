import { RowanError } from '../core/assert';
import type { TextureSource } from './renderer2d';
import { getRasterSize, type TextLayout, type TextRasterizer, type TextStyle } from './textLayout';

/** Lines are measured at this font size and the result is divided by it to get em. */
const MEASURE_PIXELS = 100;

/**
 * The CSS font a style stands for at a size in pixels, as the `font` of a 2D canvas takes
 * it. The engine's font names are CSS generic font families, so they are used as they are.
 */
export function formatCanvasFont(style: Readonly<TextStyle>, pixelSize: number): string {
  return `${style.italic ? 'italic ' : ''}${style.bold ? 'bold ' : ''}${pixelSize}px ${style.font}`;
}

/**
 * Draws text with the browser's own text engine, on a 2D canvas that is then uploaded as a
 * texture. That gives the engine every script and font the browser can show.
 */
export class CanvasTextRasterizer implements TextRasterizer {
  private canvas: HTMLCanvasElement | null = null;
  private context: CanvasRenderingContext2D | null = null;

  /**
   * @param createCanvas Makes the canvas the text is drawn on. It is called once, the first
   *   time text is measured or drawn.
   */
  constructor(
    private readonly createCanvas: () => HTMLCanvasElement = () => document.createElement('canvas'),
  ) {}

  measureLine(line: string, style: Readonly<TextStyle>): number {
    const context = this.requireContext();
    context.font = formatCanvasFont(style, MEASURE_PIXELS);
    return context.measureText(line).width / MEASURE_PIXELS;
  }

  rasterize(
    layout: Readonly<TextLayout>,
    style: Readonly<TextStyle>,
    pixelsPerEm: number,
  ): TextureSource {
    const context = this.requireContext();
    const canvas = context.canvas;
    const { width, height } = getRasterSize(layout, pixelsPerEm);
    // Assigning the size also clears the canvas and resets the context, which is why the
    // drawing state is set afterwards.
    canvas.width = width;
    canvas.height = height;
    context.font = formatCanvasFont(style, pixelsPerEm);
    context.textBaseline = 'middle';
    context.textAlign = 'left';
    context.fillStyle = '#ffffff';

    const boxWidth = layout.width * pixelsPerEm;
    const left = (width - boxWidth) / 2;
    const top = (height - layout.height * pixelsPerEm) / 2;
    for (const [index, line] of layout.lines.entries()) {
      if (line === '') {
        continue;
      }
      const slack = boxWidth - (layout.lineWidths[index] ?? 0) * pixelsPerEm;
      const indent = layout.align === 'left' ? 0 : layout.align === 'right' ? slack : slack / 2;
      context.fillText(line, left + indent, top + (index + 0.5) * layout.lineHeight * pixelsPerEm);
    }
    return { width, height, image: canvas };
  }

  private requireContext(): CanvasRenderingContext2D {
    if (!this.context) {
      this.canvas ??= this.createCanvas();
      this.context = this.canvas.getContext('2d');
      if (!this.context) {
        throw new RowanError(
          'Text cannot be drawn because the browser did not provide a 2D canvas. ' +
            'Check that canvas drawing is not blocked by a browser setting or an extension.',
        );
      }
    }
    return this.context;
  }
}
