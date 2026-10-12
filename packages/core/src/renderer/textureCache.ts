import type { AssetRecord } from '../assets/asset';
import type { AssetDatabase } from '../assets/assetDatabase';
import { describeError } from '../core/assert';
import type { Logger } from '../core/logger';
import { Signal, type Unsubscribe } from '../core/signal';
import type { Renderer2D, Texture, TextureFilter, TextureSource } from './renderer2d';

/** Turns the encoded bytes of an image file into something a renderer can upload. */
export type ImageDecoder = (bytes: Uint8Array, mimeType: string) => Promise<TextureSource>;

interface CacheEntry {
  texture: Texture | null;
  /** Pending decode, shared by everyone who asks for the texture while it loads. */
  loading: Promise<Texture | null> | null;
  failed: boolean;
}

/**
 * Loads texture assets on demand and keeps their GPU textures alive.
 * Textures are reloaded automatically when their asset changes or the GPU context is restored.
 */
export class TextureCache {
  /** Emitted with the asset id when a texture becomes available. */
  readonly onTextureLoaded = new Signal<string>();

  private readonly entries = new Map<string, CacheEntry>();
  private readonly subscriptions: Unsubscribe[];
  private disposed = false;

  constructor(
    private readonly renderer: Renderer2D,
    private readonly assets: AssetDatabase,
    private readonly decode: ImageDecoder,
    private readonly filter: TextureFilter,
    private readonly logger?: Logger,
  ) {
    this.subscriptions = [
      assets.onChanged.connect((record) => this.invalidate(record)),
      assets.onRemoved.connect((record) => this.invalidate(record)),
      renderer.onContextRestored.connect(() => this.invalidateAll()),
    ];
  }

  /**
   * The texture for an asset, or `null` while it is still loading, failed to load or
   * does not exist. Asking for a texture that is not loaded starts loading it.
   */
  get(assetId: string): Texture | null {
    const entry = this.entries.get(assetId);
    if (entry) {
      return entry.texture;
    }
    void this.load(assetId);
    return null;
  }

  /** Loads a texture and resolves once it is ready. Resolves to `null` when it cannot load. */
  load(assetId: string): Promise<Texture | null> {
    const existing = this.entries.get(assetId);
    if (existing) {
      return existing.loading ?? Promise.resolve(existing.texture);
    }
    const record = this.assets.get(assetId);
    if (this.disposed || record?.type !== 'texture') {
      return Promise.resolve(null);
    }

    const entry: CacheEntry = { texture: null, loading: null, failed: false };
    entry.loading = this.decodeAndUpload(record, entry);
    this.entries.set(assetId, entry);
    return entry.loading;
  }

  /** Loads every texture asset in the project. */
  async preloadAll(): Promise<void> {
    await Promise.all(this.assets.list('texture').map((record) => this.load(record.id)));
  }

  dispose(): void {
    this.disposed = true;
    for (const unsubscribe of this.subscriptions) {
      unsubscribe();
    }
    this.invalidateAll();
  }

  private async decodeAndUpload(record: AssetRecord, entry: CacheEntry): Promise<Texture | null> {
    try {
      const source = await this.decode(this.assets.getBytes(record.id), record.mimeType);
      // The asset may have changed or been removed while the image was decoding.
      if (this.entries.get(record.id) !== entry) {
        source.dispose?.();
        return null;
      }
      entry.texture = this.renderer.createTexture(source, this.filter);
      entry.loading = null;
      this.onTextureLoaded.emit(record.id);
      return entry.texture;
    } catch (error) {
      entry.loading = null;
      entry.failed = true;
      this.logger?.error(`Failed to load texture "${record.name}": ${describeError(error)}`);
      return null;
    }
  }

  private invalidate(record: AssetRecord): void {
    const entry = this.entries.get(record.id);
    if (!entry) {
      return;
    }
    this.entries.delete(record.id);
    if (entry.texture) {
      this.renderer.destroyTexture(entry.texture);
    }
  }

  private invalidateAll(): void {
    for (const entry of this.entries.values()) {
      if (entry.texture) {
        this.renderer.destroyTexture(entry.texture);
      }
    }
    this.entries.clear();
  }
}
