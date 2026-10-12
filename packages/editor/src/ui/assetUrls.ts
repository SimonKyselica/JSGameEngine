import type { AssetDatabase, AssetRecord, Unsubscribe } from '@rowan/core';

/**
 * Hands out object URLs for binary assets, so the UI can show textures in `<img>` and
 * play sounds in `<audio>`. URLs are revoked when their asset changes or goes away.
 */
export class AssetUrlCache {
  private readonly urls = new Map<string, string>();
  private readonly subscriptions: Unsubscribe[];

  constructor(private readonly assets: AssetDatabase) {
    const revoke = (record: AssetRecord): void => this.revoke(record.id);
    this.subscriptions = [assets.onChanged.connect(revoke), assets.onRemoved.connect(revoke)];
  }

  /** A URL for the asset's content, or `null` when it is not a binary asset. */
  get(record: AssetRecord): string | null {
    if (record.type !== 'texture' && record.type !== 'audio') {
      return null;
    }
    let url = this.urls.get(record.id);
    if (!url) {
      const bytes = this.assets.getBytes(record.id) as Uint8Array<ArrayBuffer>;
      url = URL.createObjectURL(new Blob([bytes], { type: record.mimeType }));
      this.urls.set(record.id, url);
    }
    return url;
  }

  dispose(): void {
    for (const unsubscribe of this.subscriptions) {
      unsubscribe();
    }
    for (const id of [...this.urls.keys()]) {
      this.revoke(id);
    }
  }

  private revoke(id: string): void {
    const url = this.urls.get(id);
    if (url) {
      URL.revokeObjectURL(url);
      this.urls.delete(id);
    }
  }
}
