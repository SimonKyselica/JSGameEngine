import { RowanError } from '../core/assert';
import { generateUuid } from '../core/uuid';
import type { Vec2 } from '../math/vec2';
import { COMPONENT_TYPES, getComponentTypeByName, Identity, Transform } from './components';
import type { Entity } from './entity';
import { Scene } from './scene';
import { deserializeComponent, serializeComponent, type SerializedComponent } from './schema';

export const SCENE_FORMAT = 'rowan.scene';
export const PREFAB_FORMAT = 'rowan.prefab';
/** Bump when the serialized layout changes, and add a migration in `parseEntities`. */
export const SCENE_VERSION = 1;

export interface SerializedEntity {
  uuid: string;
  /** Uuid of the parent entity, or `null` for a root. */
  parent: string | null;
  /** Component data keyed by the component's schema name. */
  components: Record<string, SerializedComponent>;
}

export interface SceneData {
  format: typeof SCENE_FORMAT;
  version: number;
  name: string;
  /** Entities in hierarchy order: every parent appears before its children. */
  entities: SerializedEntity[];
}

/** A reusable entity subtree. The first entity is the root. */
export interface PrefabData {
  format: typeof PREFAB_FORMAT;
  version: number;
  name: string;
  entities: SerializedEntity[];
}

export interface DeserializeOptions {
  /** Called for recoverable problems, such as a component type this build does not know. */
  readonly onWarning?: (message: string) => void;
}

export interface InstantiateOptions extends DeserializeOptions {
  readonly parent?: Entity | null;
  /** World-space position for the new root. Defaults to the position stored in the prefab. */
  readonly position?: Readonly<Vec2>;
  /** World-space rotation in radians for the new root. */
  readonly rotation?: number;
  readonly name?: string;
}

export function serializeEntity(entity: Entity): SerializedEntity {
  const components: Record<string, SerializedComponent> = {};
  for (const type of COMPONENT_TYPES) {
    const component = entity.getComponent(type);
    if (component) {
      components[type.schema.name] = serializeComponent(component, type.schema);
    }
  }
  return { uuid: entity.uuid, parent: entity.parent?.uuid ?? null, components };
}

export function serializeScene(scene: Scene): SceneData {
  return {
    format: SCENE_FORMAT,
    version: SCENE_VERSION,
    name: scene.name,
    entities: scene.entitiesInHierarchyOrder().map(serializeEntity),
  };
}

/** Builds a new scene from serialized data. Throws a {@link RowanError} for malformed data. */
export function deserializeScene(data: unknown, options: DeserializeOptions = {}): Scene {
  const parsed = parseSceneData(data);
  const scene = new Scene(parsed.name);
  addEntities(scene, parsed.entities, false, null, options);
  return scene;
}

/** A deep copy of a scene. Entities keep their uuids. */
export function cloneScene(scene: Scene): Scene {
  return deserializeScene(serializeScene(scene));
}

/** Captures an entity and its descendants as a prefab. */
export function createPrefab(root: Entity, name = root.name): PrefabData {
  const entities: SerializedEntity[] = [];
  const visit = (entity: Entity): void => {
    entities.push(serializeEntity(entity));
    for (const child of entity.children) {
      visit(child);
    }
  };
  visit(root);
  entities[0]!.parent = null;
  return { format: PREFAB_FORMAT, version: SCENE_VERSION, name, entities };
}

/** Adds a copy of a prefab to the scene with fresh uuids and returns its root entity. */
export function instantiatePrefab(
  scene: Scene,
  data: unknown,
  options: InstantiateOptions = {},
): Entity {
  const prefab = parsePrefabData(data);
  const roots = addEntities(scene, prefab.entities, true, options.parent ?? null, options);
  const root = roots[0]!;
  if (options.name !== undefined) {
    root.name = options.name;
  }
  if (options.position) {
    root.setWorldPosition(options.position);
  }
  if (options.rotation !== undefined) {
    root.setWorldRotation(options.rotation);
  }
  return root;
}

/** Copies an entity and its descendants, placing the copy right after the original. */
export function duplicateEntity(entity: Entity): Entity {
  const scene = entity.scene;
  const parent = entity.parent;
  const siblingNames = (parent ? parent.children : scene.rootEntities).map(
    (sibling) => sibling.name,
  );
  const copy = instantiatePrefab(scene, createPrefab(entity), {
    parent,
    name: makeUniqueName(entity.name, siblingNames),
  });
  scene.setParent(copy, parent, {
    keepWorldTransform: false,
    index: scene.getSiblingIndex(entity) + 1,
  });
  return copy;
}

/**
 * Picks a name that is not in `taken` by adding or increasing a ` (n)` suffix:
 * `Crate` becomes `Crate (1)`, and `Crate (1)` becomes `Crate (2)`.
 */
export function makeUniqueName(name: string, taken: readonly string[]): string {
  if (!taken.includes(name)) {
    return name;
  }
  const match = /^(.*) \((\d+)\)$/.exec(name);
  const base = match ? match[1]! : name;
  let counter = match ? Number(match[2]) + 1 : 1;
  while (taken.includes(`${base} (${counter})`)) {
    counter++;
  }
  return `${base} (${counter})`;
}

/** Validates scene data loaded from JSON. */
export function parseSceneData(data: unknown): SceneData {
  const object = expectDocument(data, SCENE_FORMAT, 'scene');
  return {
    format: SCENE_FORMAT,
    version: SCENE_VERSION,
    name: typeof object.name === 'string' ? object.name : 'Untitled',
    entities: parseEntities(object.entities, 'scene.entities'),
  };
}

/** Validates prefab data loaded from JSON. */
export function parsePrefabData(data: unknown): PrefabData {
  const object = expectDocument(data, PREFAB_FORMAT, 'prefab');
  const entities = parseEntities(object.entities, 'prefab.entities');
  if (entities.length === 0) {
    throw new RowanError('prefab.entities: a prefab needs at least one entity');
  }
  if (entities[0]!.parent !== null) {
    throw new RowanError('prefab.entities[0]: the first entity must be the root');
  }
  return {
    format: PREFAB_FORMAT,
    version: SCENE_VERSION,
    name: typeof object.name === 'string' ? object.name : 'Prefab',
    entities,
  };
}

function expectDocument(data: unknown, format: string, label: string): Record<string, unknown> {
  if (!isRecord(data)) {
    throw new RowanError(`${label}: expected an object`);
  }
  if (data.format !== format) {
    throw new RowanError(
      `${label}: expected format "${format}" but found "${String(data.format)}"`,
    );
  }
  if (typeof data.version !== 'number' || !Number.isInteger(data.version) || data.version < 1) {
    throw new RowanError(`${label}: missing or invalid version`);
  }
  if (data.version > SCENE_VERSION) {
    throw new RowanError(
      `${label}: version ${data.version} was saved by a newer version of Rowan ` +
        `(this build reads up to version ${SCENE_VERSION})`,
    );
  }
  return data;
}

function parseEntities(value: unknown, path: string): SerializedEntity[] {
  if (!Array.isArray(value)) {
    throw new RowanError(`${path}: expected an array`);
  }
  const seen = new Set<string>();
  return value.map((item: unknown, index) => {
    const itemPath = `${path}[${index}]`;
    if (!isRecord(item)) {
      throw new RowanError(`${itemPath}: expected an object`);
    }
    const { uuid, parent, components } = item;
    if (typeof uuid !== 'string' || uuid === '') {
      throw new RowanError(`${itemPath}.uuid: expected a non-empty string`);
    }
    if (seen.has(uuid)) {
      throw new RowanError(`${itemPath}.uuid: duplicate uuid "${uuid}"`);
    }
    seen.add(uuid);
    if (parent !== null && typeof parent !== 'string') {
      throw new RowanError(`${itemPath}.parent: expected a uuid or null`);
    }
    if (!isRecord(components)) {
      throw new RowanError(`${itemPath}.components: expected an object`);
    }
    for (const [name, component] of Object.entries(components)) {
      if (!isRecord(component)) {
        throw new RowanError(`${itemPath}.components.${name}: expected an object`);
      }
    }
    return {
      uuid,
      parent,
      components: components as Record<string, SerializedComponent>,
    };
  });
}

/**
 * Creates entities from serialized data and returns the ones that ended up without a
 * serialized parent. Those are attached to `parent` when one is given.
 */
function addEntities(
  scene: Scene,
  entities: readonly SerializedEntity[],
  generateUuids: boolean,
  parent: Entity | null,
  options: DeserializeOptions,
): Entity[] {
  const created = new Map<string, Entity>();
  for (const [index, data] of entities.entries()) {
    const entity = scene.createEntity('Entity', {
      uuid: generateUuids ? generateUuid() : data.uuid,
    });
    created.set(data.uuid, entity);
    applyComponents(entity, data, `entities[${index}]`, options);
  }

  const roots: Entity[] = [];
  for (const data of entities) {
    const entity = created.get(data.uuid)!;
    if (data.parent !== null) {
      const serializedParent = created.get(data.parent);
      if (serializedParent && !scene.isSameOrDescendant(serializedParent, entity)) {
        scene.setParent(entity, serializedParent, { keepWorldTransform: false });
        continue;
      }
      options.onWarning?.(
        `Entity "${entity.name}" refers to a missing or invalid parent and was moved to the root`,
      );
    }
    // Re-inserting every root keeps their serialized order, also among existing siblings.
    roots.push(entity);
    scene.setParent(entity, parent, { keepWorldTransform: false });
  }
  return roots;
}

function applyComponents(
  entity: Entity,
  data: SerializedEntity,
  path: string,
  options: DeserializeOptions,
): void {
  for (const [name, componentData] of Object.entries(data.components)) {
    const type = getComponentTypeByName(name);
    if (!type) {
      options.onWarning?.(`${path}: skipped unknown component "${name}"`);
      continue;
    }
    const component =
      type === Identity || type === Transform
        ? entity.requireComponent(type)
        : entity.addComponent(type);
    deserializeComponent(component, type.schema, componentData, `${path}.components.${name}`);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
