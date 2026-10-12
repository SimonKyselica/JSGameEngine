import { describe, expect, it } from 'vitest';
import { AssetDatabase } from '../assets/assetDatabase';
import { RowanError } from '../core/assert';
import { Logger } from '../core/logger';
import { Color } from '../math/color';
import { Vec2 } from '../math/vec2';
import { SpriteRenderer, TextRenderer } from '../scene/components';
import { Scene } from '../scene/scene';
import { CameraView } from './cameraView';
import { CanvasTextRasterizer, formatCanvasFont } from './canvasTextRasterizer';
import { decodeImageHeadless } from './imageDecoder';
import { HeadlessRenderer, type TextureSource } from './renderer2d';
import { SceneRenderer } from './sceneRenderer';
import {
  getRasterPixelsPerEm,
  getRasterSize,
  getTextRect,
  getTextStyle,
  HeadlessTextRasterizer,
  layoutText,
  MAX_TEXT_TEXTURE_SIZE,
  type TextLayout,
  type TextStyle,
} from './textLayout';
import { TextTextureCache } from './textTextureCache';
import { TextureCache } from './textureCache';

const PLAIN: TextStyle = { font: 'sans-serif', bold: false, italic: false };

/** A text component with some fields changed, as a script or the inspector would leave it. */
function textWith(fields: Partial<TextRenderer>): TextRenderer {
  return Object.assign(new TextRenderer(), fields);
}

/** Rounds away the last bits of floating-point noise so sizes can be compared exactly. */
const rounded = (values: readonly number[]): number[] =>
  values.map((value) => Math.round(value * 1e6) / 1e6);

describe('layoutText', () => {
  // The headless rasterizer measures every character as half an em wide.
  const measurer = new HeadlessTextRasterizer();

  it('measures a single line', () => {
    expect(layoutText(textWith({ text: 'Score' }), measurer)).toEqual({
      lines: ['Score'],
      lineWidths: [2.5],
      width: 2.5,
      height: 1.2,
      lineHeight: 1.2,
      align: 'center',
    });
  });

  it('starts a new line at every kind of line break and keeps empty lines', () => {
    const layout = layoutText(
      textWith({ text: 'one\nthree\r\n\rxy', lineHeight: 2, align: 'right' }),
      measurer,
    );
    expect(layout.lines).toEqual(['one', 'three', '', 'xy']);
    expect(layout.lineWidths).toEqual([1.5, 2.5, 0, 1]);
    expect(layout.width).toBe(2.5);
    expect(layout.height).toBe(8);
    expect(layout.align).toBe('right');
  });

  it('gives an empty text one line without width', () => {
    expect(layoutText(textWith({ text: '' }), measurer)).toMatchObject({
      lines: [''],
      width: 0,
      height: 1.2,
    });
  });

  it('measures in the style of the component', () => {
    const styles: TextStyle[] = [];
    const recorder = {
      measureLine: (_line: string, style: TextStyle) => {
        styles.push(style);
        return 1;
      },
    };
    layoutText(textWith({ font: 'monospace', bold: true, italic: true }), recorder);
    expect(styles).toEqual([{ font: 'monospace', bold: true, italic: true }]);
    expect(layoutText(textWith({ text: 'abcd', font: 'monospace' }), measurer).width).toBe(2.4);
  });

  it('shows a value that is not a string the way String() prints it', () => {
    // Scripts are not type-checked, and `label.text = score` is an easy thing to write.
    const content = (value: unknown): readonly string[] =>
      layoutText(textWith({ text: value as string }), measurer).lines;
    expect(content(42)).toEqual(['42']);
    expect(content(true)).toEqual(['true']);
    expect(content(null)).toEqual(['']);
    expect(content(undefined)).toEqual(['']);
  });

  it('falls back to usable values for a broken line height, font or measurement', () => {
    for (const lineHeight of [0, -1, Number.NaN, Infinity]) {
      expect(layoutText(textWith({ lineHeight }), measurer).lineHeight).toBe(1.2);
    }
    expect(getTextStyle(textWith({ font: 'Comic Sans' as 'serif' })).font).toBe('sans-serif');
    const broken = { measureLine: () => Number.NaN };
    expect(layoutText(textWith({ text: 'abc' }), broken).width).toBe(0);
  });
});

describe('getTextRect', () => {
  const measurer = new HeadlessTextRasterizer();
  const rectOf = (fields: Partial<TextRenderer>): number[] => {
    const text = textWith({ text: 'abcd', fontSize: 2, ...fields });
    const rect = getTextRect(text, layoutText(text, measurer));
    return rounded([rect.x, rect.y, rect.width, rect.height]);
  };

  it('centers the text on the entity by default', () => {
    // Four characters at a font size of 2 are 4 units wide; one line is 2.4 units high.
    expect(rectOf({})).toEqual([-2, -1.2, 4, 2.4]);
  });

  it('starts or ends the text at the entity when aligned to a side', () => {
    expect(rectOf({ align: 'left' })).toEqual([0, -1.2, 4, 2.4]);
    expect(rectOf({ align: 'right' })).toEqual([-4, -1.2, 4, 2.4]);
  });

  it('hangs the text below the entity or stands it on top', () => {
    expect(rectOf({ verticalAlign: 'top' })).toEqual([-2, -2.4, 4, 2.4]);
    expect(rectOf({ verticalAlign: 'bottom' })).toEqual([-2, 0, 4, 2.4]);
  });

  it('writes into the rectangle it is given', () => {
    const text = textWith({ text: 'ab' });
    const layout = layoutText(text, measurer);
    const out = getTextRect(text, layout);
    expect(getTextRect(text, layout, out)).toBe(out);
  });
});

describe('getRasterPixelsPerEm', () => {
  const layout = layoutText(textWith({ text: 'abcd' }), new HeadlessTextRasterizer());

  it('uses the exact size on screen for small text', () => {
    expect(getRasterPixelsPerEm(layout, 12)).toBe(12);
    expect(getRasterPixelsPerEm(layout, 12.2)).toBe(13);
    expect(getRasterPixelsPerEm(layout, 32)).toBe(32);
  });

  it('rounds larger text up to one of a few sizes, so zooming rarely rasterizes again', () => {
    // The sizes above 32 are 35, 39, 42, 46, 50, 54, 59 and 64, then the same doubled.
    expect(getRasterPixelsPerEm(layout, 40)).toBe(42);
    expect(getRasterPixelsPerEm(layout, 41)).toBe(42);
    expect(getRasterPixelsPerEm(layout, 43)).toBe(46);
    expect(getRasterPixelsPerEm(layout, 64)).toBe(64);
    expect(getRasterPixelsPerEm(layout, 100)).toBe(108);
  });

  it('keeps the resolution within sensible limits', () => {
    expect(getRasterPixelsPerEm(layout, 0.5)).toBe(4);
    expect(getRasterPixelsPerEm(layout, -3)).toBe(4);
    expect(getRasterPixelsPerEm(layout, Number.NaN)).toBe(4);
    expect(getRasterPixelsPerEm(layout, 100000)).toBe(512);
  });

  it('lowers the resolution of text that would not fit into one texture', () => {
    const long = layoutText(textWith({ text: 'x'.repeat(200) }), new HeadlessTextRasterizer());
    // 100 em of text plus padding at 20 pixels per em is the widest that fits 2048 pixels.
    expect(getRasterPixelsPerEm(long, 64)).toBe(20);
    expect(getRasterSize(long, 20).width).toBeLessThanOrEqual(MAX_TEXT_TEXTURE_SIZE);
    const endless = layoutText(textWith({ text: 'x'.repeat(10000) }), new HeadlessTextRasterizer());
    expect(getRasterPixelsPerEm(endless, 64)).toBe(1);
    expect(getRasterSize(endless, 1).width).toBe(MAX_TEXT_TEXTURE_SIZE);
  });
});

describe('getRasterSize', () => {
  it('adds padding around the text on every side', () => {
    const layout = layoutText(textWith({ text: 'abcd' }), new HeadlessTextRasterizer());
    // 2 em by 1.2 em at 20 pixels per em, plus 5 pixels of padding on each side.
    expect(getRasterSize(layout, 20)).toEqual({ width: 50, height: 34 });
    expect(getRasterSize(layout, 10)).toEqual({ width: 26, height: 18 });
  });

  it('never returns an empty image', () => {
    const empty = layoutText(textWith({ text: '' }), new HeadlessTextRasterizer());
    expect(getRasterSize(empty, 0).width).toBe(1);
  });
});

describe('HeadlessTextRasterizer', () => {
  it('measures every character as half an em, or 0.6 em in the monospace font', () => {
    const rasterizer = new HeadlessTextRasterizer();
    expect(rasterizer.measureLine('abcd', PLAIN)).toBe(2);
    expect(rasterizer.measureLine('abcd', { ...PLAIN, font: 'serif', bold: true })).toBe(2);
    expect(rasterizer.measureLine('abcd', { ...PLAIN, font: 'monospace' })).toBe(2.4);
  });

  it('records what it is asked to draw and returns an image of the right size', () => {
    const rasterizer = new HeadlessTextRasterizer();
    const layout = layoutText(textWith({ text: 'ab\ncd' }), rasterizer);
    const style = { ...PLAIN, bold: true };
    expect(rasterizer.rasterize(layout, style, 20)).toEqual(getRasterSize(layout, 20));
    expect(rasterizer.rasterized).toEqual([{ text: 'ab\ncd', style, pixelsPerEm: 20 }]);
  });
});

describe('CanvasTextRasterizer', () => {
  interface DrawnLine {
    text: string;
    x: number;
    y: number;
    font: string;
    baseline: string;
    fill: string;
  }

  /** Stands in for a canvas: half an em per character, and a record of what was drawn. */
  function createFakeCanvas(): { canvas: HTMLCanvasElement; drawn: DrawnLine[] } {
    const drawn: DrawnLine[] = [];
    const context = {
      font: '',
      textBaseline: '',
      textAlign: '',
      fillStyle: '',
      canvas: null as unknown,
      measureText(text: string) {
        const pixels = Number(/(\d+(?:\.\d+)?)px/.exec(this.font)?.[1]);
        return { width: text.length * pixels * 0.5 };
      },
      fillText(text: string, x: number, y: number) {
        drawn.push({
          text,
          x,
          y,
          font: this.font,
          baseline: this.textBaseline,
          fill: this.fillStyle,
        });
      },
    };
    const canvas = {
      width: 0,
      height: 0,
      getContext: (kind: string) => (kind === '2d' ? context : null),
    };
    context.canvas = canvas;
    return { canvas: canvas as unknown as HTMLCanvasElement, drawn };
  }

  it('writes the font the way a canvas takes it', () => {
    expect(formatCanvasFont(PLAIN, 24)).toBe('24px sans-serif');
    expect(formatCanvasFont({ font: 'serif', bold: true, italic: false }, 10)).toBe(
      'bold 10px serif',
    );
    expect(formatCanvasFont({ font: 'monospace', bold: true, italic: true }, 8)).toBe(
      'italic bold 8px monospace',
    );
  });

  it('measures lines in em, whatever size it measures at', () => {
    const rasterizer = new CanvasTextRasterizer(() => createFakeCanvas().canvas);
    expect(rasterizer.measureLine('abcd', PLAIN)).toBe(2);
    expect(rasterizer.measureLine('', PLAIN)).toBe(0);
  });

  it('draws each line in white, centered on its row, and returns the canvas', () => {
    const { canvas, drawn } = createFakeCanvas();
    const rasterizer = new CanvasTextRasterizer(() => canvas);
    const text = textWith({ text: 'abcd\n\nab', bold: true, align: 'left' });
    const layout = layoutText(text, rasterizer);

    const source = rasterizer.rasterize(layout, getTextStyle(text), 20);
    // 2 em by 3 lines of 1.2 em at 20 pixels per em, plus 5 pixels of padding all round.
    expect(source).toEqual({ width: 50, height: 82, image: canvas });
    expect([canvas.width, canvas.height]).toEqual([50, 82]);
    expect(drawn).toEqual([
      {
        text: 'abcd',
        x: 5,
        y: 17,
        font: 'bold 20px sans-serif',
        baseline: 'middle',
        fill: '#ffffff',
      },
      {
        text: 'ab',
        x: 5,
        y: 65,
        font: 'bold 20px sans-serif',
        baseline: 'middle',
        fill: '#ffffff',
      },
    ]);
  });

  it('lines shorter lines up with the widest one', () => {
    const { canvas, drawn } = createFakeCanvas();
    const rasterizer = new CanvasTextRasterizer(() => canvas);
    const positions = (align: TextRenderer['align']): number[] => {
      drawn.length = 0;
      const text = textWith({ text: 'abcd\nab', align });
      rasterizer.rasterize(layoutText(text, rasterizer), getTextStyle(text), 20);
      return drawn.map((line) => line.x);
    };
    // The short line is 20 pixels narrower than the 40-pixel box that starts at x = 5.
    expect(positions('left')).toEqual([5, 5]);
    expect(positions('center')).toEqual([5, 15]);
    expect(positions('right')).toEqual([5, 25]);
  });

  it('creates its canvas once, the first time it is needed', () => {
    let created = 0;
    const rasterizer = new CanvasTextRasterizer(() => {
      created++;
      return createFakeCanvas().canvas;
    });
    expect(created).toBe(0);
    rasterizer.measureLine('a', PLAIN);
    rasterizer.measureLine('b', PLAIN);
    expect(created).toBe(1);
  });

  it('says what is wrong when the browser has no 2D canvas', () => {
    const blocked = { getContext: () => null } as unknown as HTMLCanvasElement;
    const rasterizer = new CanvasTextRasterizer(() => blocked);
    expect(() => rasterizer.measureLine('a', PLAIN)).toThrow(RowanError);
    expect(() => rasterizer.measureLine('a', PLAIN)).toThrow(/did not provide a 2D canvas/);
  });
});

describe('TextTextureCache', () => {
  it('lays a text out once and again only when what decides its shape changes', () => {
    const rasterizer = new HeadlessTextRasterizer();
    const cache = new TextTextureCache(new HeadlessRenderer(), rasterizer);
    const text = textWith({ text: 'Lives: 3' });
    const first = cache.prepare(1, text).layout;
    text.color = new Color(1, 0, 0, 1);
    text.fontSize = 3;
    text.sortingOrder = 7;
    expect(cache.prepare(1, text).layout).toBe(first);

    const changes: (() => void)[] = [
      () => (text.text = 'Lives: 2'),
      () => (text.font = 'serif'),
      () => (text.bold = true),
      () => (text.italic = true),
      () => (text.align = 'left'),
      () => (text.lineHeight = 2),
    ];
    let previous: TextLayout | null = first;
    for (const change of changes) {
      change();
      const layout = cache.prepare(1, text).layout;
      expect(layout).not.toBe(previous);
      previous = layout;
    }
  });

  it('does not take NaN for a change in every frame', () => {
    const cache = new TextTextureCache(new HeadlessRenderer(), new HeadlessTextRasterizer());
    const text = textWith({ text: Number.NaN as unknown as string, lineHeight: Number.NaN });
    const first = cache.prepare(1, text).layout;
    expect(first?.lines).toEqual(['NaN']);
    expect(cache.prepare(1, text).layout).toBe(first);
  });

  it('keeps one texture per text and replaces it when the resolution changes', () => {
    const renderer = new HeadlessRenderer();
    const rasterizer = new HeadlessTextRasterizer();
    const cache = new TextTextureCache(renderer, rasterizer);
    const text = textWith({ text: 'abcd' });

    const entry = cache.prepare(1, text);
    const texture = cache.getTexture(entry, text, 20);
    expect(texture).toMatchObject({ width: 50, height: 34 });
    expect(entry.pixelsPerEm).toBe(20);
    expect(cache.getTexture(entry, text, 20)).toBe(texture);
    // 19.5 pixels on screen still round up to the texture that exists.
    expect(cache.getTexture(entry, text, 19.5)).toBe(texture);
    expect(rasterizer.rasterized).toHaveLength(1);

    const sharper = cache.getTexture(entry, text, 30);
    expect(sharper).not.toBe(texture);
    expect(entry.pixelsPerEm).toBe(30);
    expect(renderer.textureCount).toBe(1);
  });

  it('frees the textures of texts that were not asked for during a frame', () => {
    const renderer = new HeadlessRenderer();
    const cache = new TextTextureCache(renderer, new HeadlessTextRasterizer());
    const kept = textWith({ text: 'kept' });
    const dropped = textWith({ text: 'dropped' });
    cache.getTexture(cache.prepare(1, kept), kept, 16);
    cache.getTexture(cache.prepare(2, dropped), dropped, 16);
    cache.endFrame();
    expect(renderer.textureCount).toBe(2);

    cache.prepare(1, kept);
    cache.endFrame();
    expect(renderer.textureCount).toBe(1);
    expect(cache.size).toBe(1);
  });

  it('drops every texture when the GPU context is restored or the cache is disposed', () => {
    const renderer = new HeadlessRenderer();
    const rasterizer = new HeadlessTextRasterizer();
    const cache = new TextTextureCache(renderer, rasterizer);
    const text = textWith({ text: 'abcd' });
    cache.getTexture(cache.prepare(1, text), text, 16);

    renderer.onContextRestored.emit();
    expect(renderer.textureCount).toBe(0);
    cache.getTexture(cache.prepare(1, text), text, 16);
    expect(rasterizer.rasterized).toHaveLength(2);

    cache.dispose();
    expect(renderer.textureCount).toBe(0);
    // A disposed cache no longer listens to the renderer.
    cache.getTexture(cache.prepare(1, text), text, 16);
    renderer.onContextRestored.emit();
    expect(renderer.textureCount).toBe(1);
  });
});

describe('SceneRenderer with texts', () => {
  /** A 200x100 pixel view that shows 10 world units from top to bottom: 10 pixels per unit. */
  const VIEW = new CameraView(new Vec2(), 0, 5, 2);

  function createSetup(
    rasterizer = new HeadlessTextRasterizer(),
    logger?: Logger,
  ): {
    scene: Scene;
    renderer: HeadlessRenderer;
    rasterizer: HeadlessTextRasterizer;
    sceneRenderer: SceneRenderer;
    draw: () => void;
  } {
    const assets = new AssetDatabase();
    const renderer = new HeadlessRenderer(200, 100);
    const textures = new TextureCache(renderer, assets, decodeImageHeadless, 'linear');
    const sceneRenderer = new SceneRenderer(renderer, textures, assets, rasterizer, logger);
    const scene = new Scene();
    const draw = (): void => sceneRenderer.render(scene, VIEW, Color.black());
    return { scene, renderer, rasterizer, sceneRenderer, draw };
  }

  it('draws a text as one quad in its color, sized from what was rasterized', () => {
    const { scene, renderer, rasterizer, sceneRenderer, draw } = createSetup();
    const entity = scene.createEntity('Label');
    entity.transform.position.set(3, 1);
    entity.addComponent(TextRenderer, {
      text: 'Hello',
      fontSize: 2,
      bold: true,
      color: new Color(1, 0.5, 0, 1),
    });
    draw();

    // A font size of 2 units at 10 pixels per unit is 20 pixels per em.
    expect(rasterizer.rasterized).toEqual([
      { text: 'Hello', style: { font: 'sans-serif', bold: true, italic: false }, pixelsPerEm: 20 },
    ]);
    expect(renderer.quads).toHaveLength(1);
    const quad = renderer.quads[0]!;
    // 2.5 em by 1.2 em plus padding is 60x34 pixels, each a tenth of a unit.
    expect(quad.texture).toEqual({ width: 60, height: 34 });
    expect(rounded(quad.transform.getScale().toArray())).toEqual([6, 3.4]);
    expect(rounded(quad.transform.getTranslation().toArray())).toEqual([3, 1]);
    expect(quad.color.toHex()).toBe('#ff8000');
    expect([quad.flipX, quad.flipY]).toEqual([false, false]);
    expect(sceneRenderer.stats).toEqual({ drawn: 1, culled: 0 });
  });

  it('places the quad by the alignment of the text', () => {
    const { scene, renderer, draw } = createSetup();
    scene.createEntity('Corner').addComponent(TextRenderer, {
      text: 'Hello',
      fontSize: 2,
      align: 'left',
      verticalAlign: 'top',
    });
    draw();
    // The text itself is 5 by 2.4 units and starts at the entity, going right and down.
    expect(rounded(renderer.quads[0]!.transform.getTranslation().toArray())).toEqual([2.5, -1.2]);
  });

  it('follows the scale of the entity and rasterizes for the size on screen', () => {
    const { scene, renderer, rasterizer, draw } = createSetup();
    const entity = scene.createEntity('Big');
    // A negative scale mirrors the text; its size on screen is what counts.
    entity.transform.scale.set(-3, 1.5);
    entity.addComponent(TextRenderer, { text: 'ab', fontSize: 1 });
    draw();

    // The larger of the two scale factors decides: 1 unit * 3 * 10 pixels per unit.
    expect(rasterizer.rasterized[0]!.pixelsPerEm).toBe(30);
    const quad = renderer.quads[0]!;
    // 1 em by 1.2 em plus 8 pixels of padding per side at 30 pixels per em: 46x52 pixels.
    expect(quad.texture).toEqual({ width: 46, height: 52 });
    expect(rounded(quad.transform.getScale().toArray()).map(Math.abs)).toEqual([4.6, 2.6]);
  });

  it('turns with the entity', () => {
    const { scene, renderer, draw } = createSetup();
    const entity = scene.createEntity('Sign');
    entity.transform.rotation = Math.PI / 2;
    entity.addComponent(TextRenderer, { text: 'ab', align: 'left' });
    draw();
    const quad = renderer.quads[0]!;
    expect(quad.transform.getRotation()).toBeCloseTo(Math.PI / 2);
    // Text that would run to the right of the entity now runs upwards from it.
    const center = quad.transform.getTranslation();
    expect(rounded([center.x, center.y])).toEqual([0, 0.25]);
  });

  it('sorts texts together with sprites, and puts a text over a sprite of the same order', () => {
    const { scene, renderer, draw } = createSetup();
    const sprite = (color: Color, sortingOrder: number): void => {
      scene.createEntity('Sprite').addComponent(SpriteRenderer, { color, sortingOrder });
    };
    const text = (color: Color, sortingOrder: number): void => {
      scene.createEntity('Text').addComponent(TextRenderer, { color, sortingOrder });
    };
    text(new Color(0, 1, 0), 0);
    sprite(new Color(1, 0, 0), 0);
    sprite(new Color(0, 0, 1), 1);
    text(new Color(1, 1, 0), -1);
    draw();
    expect(renderer.quads.map((quad) => quad.color.toHex())).toEqual([
      '#ffff00',
      '#ff0000',
      '#00ff00',
      '#0000ff',
    ]);
  });

  it('rasterizes a text again only when it changes, not when it is tinted or moved', () => {
    const { scene, renderer, rasterizer, draw } = createSetup();
    const entity = scene.createEntity('Score');
    const text = entity.addComponent(TextRenderer, { text: 'Score: 0' });
    draw();
    draw();
    text.color.set(1, 0, 0, 0.5);
    entity.transform.position.set(1, 1);
    text.verticalAlign = 'top';
    draw();
    expect(rasterizer.rasterized).toHaveLength(1);

    text.text = 'Score: 10';
    draw();
    expect(rasterizer.rasterized.map((entry) => entry.text)).toEqual(['Score: 0', 'Score: 10']);
    expect(renderer.textureCount).toBe(1);
  });

  it('shows a number that a script assigned as the text', () => {
    const { scene, rasterizer, draw } = createSetup();
    scene.createEntity('Score').addComponent(TextRenderer, { text: 1500 as unknown as string });
    draw();
    expect(rasterizer.rasterized[0]!.text).toBe('1500');
  });

  it('skips hidden, transparent, empty, sizeless and inactive texts', () => {
    const { scene, renderer, rasterizer, draw } = createSetup();
    scene.createEntity('Shown').addComponent(TextRenderer);
    scene.createEntity('Hidden').addComponent(TextRenderer, { visible: false });
    scene.createEntity('Clear').addComponent(TextRenderer, { color: new Color(1, 1, 1, 0) });
    scene.createEntity('Empty').addComponent(TextRenderer, { text: '' });
    scene.createEntity('Spaces').addComponent(TextRenderer, { text: '\n\n' });
    for (const fontSize of [0, -1, Number.NaN, Infinity]) {
      scene.createEntity('Sizeless').addComponent(TextRenderer, { fontSize });
    }
    const inactive = scene.createEntity('Inactive');
    inactive.addComponent(TextRenderer);
    inactive.active = false;

    draw();
    expect(renderer.quads).toHaveLength(1);
    expect(rasterizer.rasterized).toHaveLength(1);
  });

  it('does not rasterize a text that is out of sight', () => {
    const { scene, renderer, rasterizer, sceneRenderer, draw } = createSetup();
    const far = scene.createEntity('Far');
    far.transform.position.set(100, 0);
    far.addComponent(TextRenderer);
    draw();
    expect(rasterizer.rasterized).toHaveLength(0);
    expect(sceneRenderer.stats).toEqual({ drawn: 0, culled: 1 });

    far.transform.position.set(0, 0);
    draw();
    expect(renderer.quads).toHaveLength(1);
  });

  it('frees the texture of a text that is no longer drawn', () => {
    const { scene, renderer, sceneRenderer, draw } = createSetup();
    const first = scene.createEntity('First');
    const text = first.addComponent(TextRenderer);
    scene.createEntity('Second').addComponent(TextRenderer, { text: 'Other' });
    draw();
    expect(renderer.textureCount).toBe(2);

    text.visible = false;
    draw();
    expect(renderer.textureCount).toBe(1);
    first.destroy();
    scene.findByName('Second')!.destroy();
    draw();
    expect(renderer.textureCount).toBe(0);

    scene.createEntity('Third').addComponent(TextRenderer);
    draw();
    sceneRenderer.dispose();
    expect(renderer.textureCount).toBe(0);
  });

  it('keeps drawing the rest and reports once when text cannot be rasterized', () => {
    class BrokenRasterizer extends HeadlessTextRasterizer {
      attempts = 0;
      override rasterize(): TextureSource {
        this.attempts++;
        throw new RowanError('the canvas is gone');
      }
    }
    const messages: string[] = [];
    const logger = new Logger();
    logger.addSink((entry) => messages.push(`${entry.level}: ${entry.message}`));
    const rasterizer = new BrokenRasterizer();
    const { scene, renderer, draw } = createSetup(rasterizer, logger);
    const text = scene.createEntity('Label').addComponent(TextRenderer);
    scene.createEntity('Other').addComponent(TextRenderer, { text: 'Other' });
    scene.createEntity('Sprite').addComponent(SpriteRenderer);

    draw();
    draw();
    draw();
    expect(renderer.quads).toHaveLength(1);
    expect(messages).toEqual(['error: Text could not be drawn: the canvas is gone']);
    // One attempt per text, not one per frame.
    expect(rasterizer.attempts).toBe(2);

    text.text = 'Changed';
    draw();
    expect(rasterizer.attempts).toBe(3);
    expect(messages).toHaveLength(1);
  });

  it('survives a rasterizer that cannot even measure', () => {
    const messages: string[] = [];
    const logger = new Logger();
    logger.addSink((entry) => messages.push(entry.message));
    class BlindRasterizer extends HeadlessTextRasterizer {
      override measureLine(): number {
        throw new RowanError('no 2D canvas');
      }
    }
    const { scene, renderer, draw } = createSetup(new BlindRasterizer(), logger);
    scene.createEntity('Label').addComponent(TextRenderer);
    draw();
    draw();
    expect(renderer.quads).toHaveLength(0);
    expect(messages).toEqual(['Text could not be drawn: no 2D canvas']);
  });
});
