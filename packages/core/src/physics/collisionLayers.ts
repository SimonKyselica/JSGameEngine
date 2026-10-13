/** The layer every entity is on unless it says otherwise. It always exists and comes first. */
export const DEFAULT_LAYER = 'Default';
/** The physics library keeps a layer in one of sixteen bits, so there cannot be more. */
export const MAX_COLLISION_LAYERS = 16;

/**
 * The collision layers of a project: their names, and the pairs of them that pass through
 * each other. Every other pair collides.
 */
export interface CollisionLayerSettings {
  /** The names of the layers. The first one is always `Default`. */
  layers: string[];
  /** Pairs of layers that do not collide. A layer paired with itself ignores its own kind. */
  ignoredLayerPairs: [string, string][];
}

/** The layers of a project that has not set any up: one layer, which collides with itself. */
export function createDefaultLayers(): CollisionLayerSettings {
  return { layers: [DEFAULT_LAYER], ignoredLayerPairs: [] };
}

/**
 * Validates collision layer settings, dropping what cannot be used: names that are empty or
 * used twice, layers beyond the sixteenth, and pairs that name a layer that does not exist.
 */
export function parseCollisionLayers(
  layers: unknown,
  ignoredPairs: unknown,
): CollisionLayerSettings {
  const names = [DEFAULT_LAYER];
  if (Array.isArray(layers)) {
    for (const item of layers as unknown[]) {
      const name = typeof item === 'string' ? item.trim() : '';
      if (name !== '' && !names.includes(name) && names.length < MAX_COLLISION_LAYERS) {
        names.push(name);
      }
    }
  }
  const pairs: [string, string][] = [];
  if (Array.isArray(ignoredPairs)) {
    for (const item of ignoredPairs as unknown[]) {
      if (!Array.isArray(item) || item.length !== 2) {
        continue;
      }
      const [first, second] = item as unknown[];
      if (
        typeof first === 'string' &&
        typeof second === 'string' &&
        names.includes(first) &&
        names.includes(second) &&
        !pairs.some(([a, b]) => (a === first && b === second) || (a === second && b === first))
      ) {
        pairs.push([first, second]);
      }
    }
  }
  return { layers: names, ignoredLayerPairs: pairs };
}

/**
 * Adds a layer to the settings. Returns `false`, and changes nothing, when the name is
 * empty or taken or when there is no room for another layer.
 */
export function addCollisionLayer(settings: CollisionLayerSettings, name: string): boolean {
  const trimmed = name.trim();
  if (
    trimmed === '' ||
    settings.layers.includes(trimmed) ||
    settings.layers.length >= MAX_COLLISION_LAYERS
  ) {
    return false;
  }
  settings.layers.push(trimmed);
  return true;
}

/**
 * Removes a layer and everything the settings say about it. The default layer stays.
 * Entities that were on the removed layer count as being on the default layer from then on.
 */
export function removeCollisionLayer(settings: CollisionLayerSettings, name: string): boolean {
  const index = settings.layers.indexOf(name);
  if (name === DEFAULT_LAYER || index === -1) {
    return false;
  }
  settings.layers.splice(index, 1);
  settings.ignoredLayerPairs = settings.ignoredLayerPairs.filter(
    ([first, second]) => first !== name && second !== name,
  );
  return true;
}

/** True when the settings let two layers collide. Layers they do not know collide. */
export function layersCollide(
  settings: Readonly<CollisionLayerSettings>,
  first: string,
  second: string,
): boolean {
  return !settings.ignoredLayerPairs.some(
    ([a, b]) => (a === first && b === second) || (a === second && b === first),
  );
}

/** Lets two layers collide, or pass through each other, in the settings. */
export function setLayersCollide(
  settings: CollisionLayerSettings,
  first: string,
  second: string,
  collide: boolean,
): void {
  settings.ignoredLayerPairs = settings.ignoredLayerPairs.filter(
    ([a, b]) => !((a === first && b === second) || (a === second && b === first)),
  );
  if (!collide) {
    settings.ignoredLayerPairs.push([first, second]);
  }
}

/**
 * The collision layers in the form the physics simulation uses: for every layer the bit that
 * stands for it, and the bits of the layers it collides with.
 */
export class CollisionLayers {
  private readonly categories = new Map<string, number>();
  private readonly masks = new Map<string, number>();

  constructor(settings: Readonly<CollisionLayerSettings> = createDefaultLayers()) {
    const names = settings.layers.slice(0, MAX_COLLISION_LAYERS);
    names.forEach((name, index) => this.categories.set(name, 1 << index));
    for (const name of names) {
      let mask = 0;
      for (const other of names) {
        if (layersCollide(settings, name, other)) {
          mask |= this.categories.get(other)!;
        }
      }
      this.masks.set(name, mask);
    }
  }

  /** The bit of a layer. A name that is not a layer counts as the default layer. */
  getCategory(layer: string): number {
    return this.categories.get(layer) ?? 1;
  }

  /** The bits of the layers a layer collides with. */
  getMask(layer: string): number {
    return this.masks.get(layer) ?? this.masks.get(DEFAULT_LAYER) ?? 1;
  }
}
