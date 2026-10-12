import { describeError } from '../core/assert';
import type { Logger } from '../core/logger';
import type { Unsubscribe } from '../core/signal';
import type { EntityId } from '../ecs/registry';
import type { TextRenderer } from '../scene/components';
import type { Renderer2D, Texture } from './renderer2d';
import {
  getRasterPixelsPerEm,
  getTextStyle,
  layoutText,
  type TextLayout,
  type TextRasterizer,
} from './textLayout';

/** The layout and the texture of one entity's text, kept from frame to frame. */
export interface CachedText {
  /** The measured text, or `null` when it could not be measured. */
  readonly layout: TextLayout | null;
  /** The resolution `texture` was rasterized at. */
  readonly pixelsPerEm: number;
}

interface Entry extends CachedText {
  layout: TextLayout | null;
  pixelsPerEm: number;
  texture: Texture | null;
  /** Set when measuring or drawing failed, so it is not tried again every frame. */
  failed: boolean;
  /** The frame the text was last asked for. Texts that are not asked for are dropped. */
  frame: number;
  // The values the layout was made from. It is made again when one of them changes.
  text: unknown;
  font: string;
  bold: boolean;
  italic: boolean;
  align: string;
  lineHeight: number;
}

/**
 * Keeps the textures of the texts that are on screen. A text is measured and rasterized
 * again only when what it says, its style or its size on screen changes, and its texture
 * is freed once it has not been drawn for a frame.
 */
export class TextTextureCache {
  private readonly entries = new Map<EntityId, Entry>();
  private readonly unsubscribe: Unsubscribe;
  private frame = 0;
  private reportedFailure = false;

  constructor(
    private readonly renderer: Renderer2D,
    private readonly rasterizer: TextRasterizer,
    private readonly logger?: Logger,
  ) {
    this.unsubscribe = renderer.onContextRestored.connect(() => this.clear());
  }

  /** Number of texts that currently have an entry. */
  get size(): number {
    return this.entries.size;
  }

  /**
   * Returns the entry for an entity's text with an up-to-date layout, and marks the text
   * as used in this frame.
   */
  prepare(id: EntityId, text: Readonly<TextRenderer>): CachedText {
    let entry = this.entries.get(id);
    if (!entry) {
      entry = {
        layout: null,
        pixelsPerEm: 0,
        texture: null,
        failed: false,
        frame: this.frame,
        text: undefined,
        font: '',
        bold: false,
        italic: false,
        align: '',
        lineHeight: 0,
      };
      this.entries.set(id, entry);
      this.relayout(entry, text);
    } else if (
      // Object.is, because a script can set NaN, which `!==` would call a change every frame.
      !Object.is(entry.text, text.text) ||
      entry.font !== text.font ||
      entry.bold !== text.bold ||
      entry.italic !== text.italic ||
      entry.align !== text.align ||
      !Object.is(entry.lineHeight, text.lineHeight)
    ) {
      this.relayout(entry, text);
    }
    entry.frame = this.frame;
    return entry;
  }

  /**
   * The texture of a prepared text, rasterized for a size on screen of `pixelsPerEm`.
   * Returns `null` when the text could not be drawn. The resolution that was actually
   * used is in the entry's `pixelsPerEm`.
   */
  getTexture(
    cached: CachedText,
    text: Readonly<TextRenderer>,
    pixelsPerEm: number,
  ): Texture | null {
    const entry = cached as Entry;
    const layout = entry.layout;
    if (!layout || entry.failed) {
      return null;
    }
    const resolution = getRasterPixelsPerEm(layout, pixelsPerEm);
    if (entry.texture && entry.pixelsPerEm === resolution) {
      return entry.texture;
    }
    this.release(entry);
    try {
      const source = this.rasterizer.rasterize(layout, getTextStyle(text), resolution);
      // Text is smoothed even in a pixel-art project: it is drawn at the size it is shown at.
      entry.texture = this.renderer.createTexture(source, 'linear');
      entry.pixelsPerEm = resolution;
    } catch (error) {
      this.fail(entry, error);
    }
    return entry.texture;
  }

  /** Ends a frame: frees the textures of the texts that were not asked for during it. */
  endFrame(): void {
    for (const [id, entry] of this.entries) {
      if (entry.frame !== this.frame) {
        this.release(entry);
        this.entries.delete(id);
      }
    }
    this.frame++;
  }

  /** Frees every texture. The texts are rasterized again the next time they are drawn. */
  clear(): void {
    for (const entry of this.entries.values()) {
      this.release(entry);
    }
    this.entries.clear();
  }

  dispose(): void {
    this.unsubscribe();
    this.clear();
  }

  private relayout(entry: Entry, text: Readonly<TextRenderer>): void {
    this.release(entry);
    entry.text = text.text;
    entry.font = text.font;
    entry.bold = text.bold;
    entry.italic = text.italic;
    entry.align = text.align;
    entry.lineHeight = text.lineHeight;
    entry.failed = false;
    try {
      entry.layout = layoutText(text, this.rasterizer);
    } catch (error) {
      entry.layout = null;
      this.fail(entry, error);
    }
  }

  private release(entry: Entry): void {
    if (entry.texture) {
      this.renderer.destroyTexture(entry.texture);
      entry.texture = null;
    }
  }

  private fail(entry: Entry, error: unknown): void {
    entry.failed = true;
    // The cause is the same for every text, so one message says it all.
    if (!this.reportedFailure) {
      this.reportedFailure = true;
      this.logger?.error(`Text could not be drawn: ${describeError(error)}`);
    }
  }
}
