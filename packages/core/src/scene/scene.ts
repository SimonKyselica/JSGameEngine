import { assert } from '../core/assert';
import { Signal } from '../core/signal';
import { generateUuid } from '../core/uuid';
import { Registry, type EntityId } from '../ecs/registry';
import { Mat3 } from '../math/mat3';
import { Vec2 } from '../math/vec2';
import { Camera, Hierarchy, Identity, ScreenAnchor, Transform } from './components';
import { Entity } from './entity';

export interface CreateEntityOptions {
  /** Use a specific uuid, for example when loading a saved scene. */
  readonly uuid?: string;
  readonly parent?: Entity | null;
}

export interface SetParentOptions {
  /** Keep the entity where it is in world space. Defaults to `true`. */
  readonly keepWorldTransform?: boolean;
  /** Position among the new siblings. Defaults to the end. */
  readonly index?: number;
}

/** How many world units the screen is high in a scene that has no camera to say so. */
const DEFAULT_VIEW_HEIGHT = 10;

/** A collection of entities arranged in a transform hierarchy. */
export class Scene {
  readonly registry = new Registry();
  /**
   * The size of the screen that entities with a `ScreenAnchor` are placed on, in pixels: the
   * resolution in the project settings. Whoever creates a scene for a project sets it.
   */
  readonly screenSize = new Vec2(1280, 720);
  /** Emitted after an entity has been created with its built-in components. */
  readonly onEntityCreated = new Signal<Entity>();
  /** Emitted just before an entity is destroyed, while its components are still readable. */
  readonly onEntityDestroyed = new Signal<Entity>();

  private readonly handles = new Map<EntityId, Entity>();
  private readonly uuidIndex = new Map<string, EntityId>();
  private readonly roots: EntityId[] = [];
  /** The entities with a camera, in the order the cameras were added. */
  private readonly cameraIds: EntityId[] = [];
  private readonly scratch = new Mat3();
  private readonly anchorScratch = new Mat3();
  private readonly cameraScratch = new Mat3();
  private readonly offsetScratch = new Mat3();
  private readonly positionScratch = new Vec2();
  private readonly scaleScratch = new Vec2();

  constructor(public name = 'Untitled') {
    // The primary camera is looked up for every entity on the screen, every time its place
    // in the world is asked for. Keeping the cameras at hand makes that cheap.
    this.registry.onComponentAdded.connect(({ entity, type }) => {
      if (type === Camera) {
        this.cameraIds.push(entity);
      }
    });
    this.registry.onComponentRemoved.connect(({ entity, type }) => {
      if (type === Camera) {
        removeItem(this.cameraIds, entity);
      }
    });
  }

  get entityCount(): number {
    return this.registry.entityCount;
  }

  /** Entities without a parent, in hierarchy order. */
  get rootEntities(): Entity[] {
    return this.roots.map((id) => this.getEntity(id));
  }

  createEntity(name = 'Entity', options: CreateEntityOptions = {}): Entity {
    const uuid = options.uuid ?? generateUuid();
    assert(!this.uuidIndex.has(uuid), `An entity with uuid ${uuid} already exists in the scene`);

    const id = this.registry.create();
    const identity = new Identity();
    identity.uuid = uuid;
    identity.name = name;
    this.registry.add(id, Identity, identity);
    this.registry.add(id, Transform, new Transform());
    this.registry.add(id, Hierarchy, new Hierarchy());
    this.uuidIndex.set(uuid, id);
    this.roots.push(id);

    const entity = this.getEntity(id);
    if (options.parent) {
      this.setParent(entity, options.parent, { keepWorldTransform: false });
    }
    this.onEntityCreated.emit(entity);
    return entity;
  }

  /** Destroys an entity and all of its descendants. Does nothing if it is already gone. */
  destroyEntity(entity: Entity): void {
    if (!this.owns(entity)) {
      return;
    }
    const hierarchy = this.hierarchyOf(entity.id);
    for (const child of [...hierarchy.children]) {
      this.destroyEntity(this.getEntity(child));
    }

    this.onEntityDestroyed.emit(entity);
    removeItem(this.siblingsOf(hierarchy.parent), entity.id);
    this.uuidIndex.delete(entity.uuid);
    this.registry.destroy(entity.id);
    this.handles.delete(entity.id);
  }

  /** Destroys every entity in the scene. */
  clear(): void {
    for (const root of [...this.roots]) {
      this.destroyEntity(this.getEntity(root));
    }
  }

  /** The handle for an entity id. The id must belong to a living entity of this scene. */
  getEntity(id: EntityId): Entity {
    let handle = this.handles.get(id);
    if (!handle) {
      assert(this.registry.isAlive(id), `Entity ${id} does not exist in scene "${this.name}"`);
      handle = new Entity(this, id);
      this.handles.set(id, handle);
    }
    return handle;
  }

  /** All entities in creation order. */
  *entities(): IterableIterator<Entity> {
    for (const id of this.registry.entities()) {
      yield this.getEntity(id);
    }
  }

  /** All entities depth-first in hierarchy order: each parent before its children. */
  entitiesInHierarchyOrder(): Entity[] {
    const result: Entity[] = [];
    const visit = (id: EntityId): void => {
      result.push(this.getEntity(id));
      for (const child of this.hierarchyOf(id).children) {
        visit(child);
      }
    };
    for (const root of this.roots) {
      visit(root);
    }
    return result;
  }

  findByUuid(uuid: string): Entity | null {
    const id = this.uuidIndex.get(uuid);
    return id === undefined ? null : this.getEntity(id);
  }

  /** The first entity with the given name in hierarchy order, or `null`. */
  findByName(name: string): Entity | null {
    const visit = (ids: readonly EntityId[]): EntityId | null => {
      for (const id of ids) {
        if (this.registry.get(id, Identity)!.name === name) {
          return id;
        }
        const found = visit(this.hierarchyOf(id).children);
        if (found !== null) {
          return found;
        }
      }
      return null;
    };
    const id = visit(this.roots);
    return id === null ? null : this.getEntity(id);
  }

  /** Every entity with the given tag, in hierarchy order. */
  findByTag(tag: string): Entity[] {
    return this.entitiesInHierarchyOrder().filter((entity) => entity.tag === tag);
  }

  /**
   * Moves an entity under a new parent, or to the scene root when `parent` is `null`.
   * Throws when the move would make an entity its own ancestor.
   */
  setParent(child: Entity, parent: Entity | null, options: SetParentOptions = {}): void {
    assert(this.owns(child), 'Cannot re-parent an entity that is not part of this scene');
    assert(parent === null || this.owns(parent), 'The new parent is not part of this scene');
    assert(
      parent === null || !this.isSameOrDescendant(parent, child),
      `Cannot parent "${child.name}" to itself or one of its descendants`,
    );

    const keepWorldTransform = options.keepWorldTransform ?? true;
    const worldMatrix = keepWorldTransform ? this.getWorldMatrix(child) : null;

    const hierarchy = this.hierarchyOf(child.id);
    removeItem(this.siblingsOf(hierarchy.parent), child.id);
    hierarchy.parent = parent?.id ?? null;
    const siblings = this.siblingsOf(hierarchy.parent);
    const index = Math.min(Math.max(options.index ?? siblings.length, 0), siblings.length);
    siblings.splice(index, 0, child.id);

    if (worldMatrix) {
      this.applyWorldMatrix(child, worldMatrix);
    }
  }

  /** The entity's position among its siblings. */
  getSiblingIndex(entity: Entity): number {
    return this.siblingsOf(this.hierarchyOf(entity.id).parent).indexOf(entity.id);
  }

  /** True when `entity` is `ancestor` or sits anywhere below it in the hierarchy. */
  isSameOrDescendant(entity: Entity, ancestor: Entity): boolean {
    let current: EntityId | null = entity.id;
    while (current !== null) {
      if (current === ancestor.id) {
        return true;
      }
      current = this.hierarchyOf(current).parent;
    }
    return false;
  }

  /** True when the entity and all of its ancestors are active. */
  isActiveInHierarchy(entity: Entity): boolean {
    return this.isActiveId(entity.id);
  }

  /**
   * The entity whose camera the game is drawn from: the first active camera marked as
   * primary, or the first active camera when none is marked.
   */
  findPrimaryCamera(): Entity | null {
    let fallback: EntityId | null = null;
    // This runs for every entity on the screen, which is why the cameras are kept in a
    // plain array instead of being looked up in the registry each time.
    for (const id of this.cameraIds) {
      if (!this.isActiveId(id)) {
        continue;
      }
      if (this.registry.get(id, Camera)!.primary) {
        return this.getEntity(id);
      }
      fallback ??= id;
    }
    return fallback === null ? null : this.getEntity(fallback);
  }

  /**
   * True when the entity is placed on the screen rather than in the world: it, or an entity
   * above it in the hierarchy, has a `ScreenAnchor`.
   */
  isOnScreen(entity: Entity): boolean {
    if (this.registry.count(ScreenAnchor) === 0) {
      return false;
    }
    let current: EntityId | null = entity.id;
    while (current !== null) {
      if (this.registry.has(current, ScreenAnchor)) {
        return true;
      }
      current = this.hierarchyOf(current).parent;
    }
    return false;
  }

  /**
   * The matrix that maps the screen to the world: a point in pixels from the center of the
   * screen, with Y up, to the place in the world that the primary camera shows there. It is
   * what puts entities with a `ScreenAnchor` in front of the camera wherever the camera is.
   *
   * Without a camera the screen is centered on the world's origin.
   */
  getScreenToWorld(out = new Mat3()): Mat3 {
    const height = Math.max(this.screenSize.y, 1);
    const camera = this.findPrimaryCamera();
    if (!camera) {
      const unitsPerPixel = DEFAULT_VIEW_HEIGHT / height;
      return out.set(unitsPerPixel, 0, 0, unitsPerPixel, 0, 0);
    }
    // Where the camera is, leaving aside a ScreenAnchor on the camera itself or above it:
    // the screen cannot be placed relative to itself.
    const matrix = this.composeWorldMatrix(camera.id, this.cameraScratch, false);
    const halfHeight = Math.max(
      Math.abs(this.registry.get(camera.id, Camera)!.orthographicSize),
      1e-6,
    );
    const unitsPerPixel = (halfHeight * 2) / height;
    return out.compose(
      matrix.getTranslation(this.positionScratch),
      matrix.getRotation(),
      this.scaleScratch.set(unitsPerPixel, unitsPerPixel),
    );
  }

  /** The matrix that maps the entity's local space to world space. */
  getWorldMatrix(entity: Entity, out = new Mat3()): Mat3 {
    return this.composeWorldMatrix(entity.id, out, true);
  }

  getWorldPosition(entity: Entity, out = new Vec2()): Vec2 {
    if (this.isPlacedInWorld(entity)) {
      return out.copy(entity.transform.position);
    }
    return this.getWorldMatrix(entity).getTranslation(out);
  }

  getWorldRotation(entity: Entity): number {
    if (this.isPlacedInWorld(entity)) {
      return entity.transform.rotation;
    }
    return this.getWorldMatrix(entity).getRotation();
  }

  getWorldScale(entity: Entity, out = new Vec2()): Vec2 {
    if (this.isPlacedInWorld(entity)) {
      return out.copy(entity.transform.scale);
    }
    return this.getWorldMatrix(entity).getScale(out);
  }

  /**
   * Moves the entity to a world-space position. If a parent is scaled to zero the world
   * position is undefined, and the local position is set directly instead.
   */
  setWorldPosition(entity: Entity, position: Readonly<Vec2>): void {
    const parentMatrix = this.getParentMatrix(entity);
    if (parentMatrix?.invert()) {
      parentMatrix.transformPoint(position, entity.transform.position);
    } else {
      entity.transform.position.copy(position);
    }
  }

  setWorldRotation(entity: Entity, radians: number): void {
    if (this.registry.has(entity.id, ScreenAnchor)) {
      // On the screen, "upright" is how the camera is turned.
      entity.transform.rotation = radians - this.getScreenToWorld(this.anchorScratch).getRotation();
      return;
    }
    const parent = entity.parent;
    entity.transform.rotation = parent ? radians - this.getWorldRotation(parent) : radians;
  }

  /**
   * Composes the world matrix of an entity from its own transform and those above it. The
   * walk up the hierarchy ends at the first entity with a `ScreenAnchor`, whose transform is
   * relative to the screen instead of to its parent.
   *
   * @param honourAnchors `false` ignores every `ScreenAnchor`, as if all entities were in
   *   the world.
   */
  private composeWorldMatrix(id: EntityId, out: Mat3, honourAnchors: boolean): Mat3 {
    const transform = this.registry.get(id, Transform)!;
    out.compose(transform.position, transform.rotation, transform.scale);
    // Most scenes have nothing on the screen, and then no entity needs to be asked.
    const anchored = honourAnchors && this.registry.count(ScreenAnchor) > 0;
    let current = id;
    for (;;) {
      const anchor = anchored ? this.registry.get(current, ScreenAnchor) : undefined;
      if (anchor) {
        return out.premultiply(this.getAnchorMatrix(anchor, this.anchorScratch));
      }
      const parent = this.hierarchyOf(current).parent;
      if (parent === null) {
        return out;
      }
      const parentTransform = this.registry.get(parent, Transform)!;
      this.scratch.compose(
        parentTransform.position,
        parentTransform.rotation,
        parentTransform.scale,
      );
      out.premultiply(this.scratch);
      current = parent;
    }
  }

  /**
   * The matrix of the space an anchored entity's transform is relative to: pixels from its
   * corner, edge or center of the screen, mapped to the world.
   */
  private getAnchorMatrix(anchor: Readonly<ScreenAnchor>, out: Mat3): Mat3 {
    const halfWidth = Math.max(this.screenSize.x, 1) / 2;
    const halfHeight = Math.max(this.screenSize.y, 1) / 2;
    const x =
      anchor.horizontal === 'left' ? -halfWidth : anchor.horizontal === 'right' ? halfWidth : 0;
    // Screen space has Y up like the world, so the top edge is the positive one.
    const y =
      anchor.vertical === 'top' ? halfHeight : anchor.vertical === 'bottom' ? -halfHeight : 0;
    return this.getScreenToWorld(out).multiply(this.offsetScratch.set(1, 0, 0, 1, x, y));
  }

  /** True when the entity's transform is its place in the world, with nothing in between. */
  private isPlacedInWorld(entity: Entity): boolean {
    return (
      this.hierarchyOf(entity.id).parent === null && !this.registry.has(entity.id, ScreenAnchor)
    );
  }

  /**
   * The matrix of the space the entity's transform is relative to: the screen for an entity
   * with a `ScreenAnchor`, otherwise its parent. `null` when that space is the world itself.
   */
  private getParentMatrix(entity: Entity): Mat3 | null {
    const anchor = this.registry.get(entity.id, ScreenAnchor);
    if (anchor) {
      return this.getAnchorMatrix(anchor, new Mat3());
    }
    const parent = entity.parent;
    return parent ? this.getWorldMatrix(parent) : null;
  }

  private isActiveId(id: EntityId): boolean {
    let current: EntityId | null = id;
    while (current !== null) {
      if (!this.registry.get(current, Identity)!.active) {
        return false;
      }
      current = this.hierarchyOf(current).parent;
    }
    return true;
  }

  private applyWorldMatrix(entity: Entity, worldMatrix: Mat3): void {
    const local = worldMatrix.clone();
    const parentMatrix = this.getParentMatrix(entity);
    if (parentMatrix) {
      if (!parentMatrix.invert()) {
        // The parent is scaled to zero, so no local transform can reproduce the world one.
        return;
      }
      local.premultiply(parentMatrix);
    }
    const transform = entity.transform;
    local.getTranslation(transform.position);
    transform.rotation = local.getRotation();
    local.getScale(transform.scale);
  }

  private owns(entity: Entity): boolean {
    return entity.scene === this && this.registry.isAlive(entity.id);
  }

  private hierarchyOf(id: EntityId): Hierarchy {
    const hierarchy = this.registry.get(id, Hierarchy);
    assert(hierarchy, `Entity ${id} does not exist in scene "${this.name}"`);
    return hierarchy;
  }

  private siblingsOf(parent: EntityId | null): EntityId[] {
    return parent === null ? this.roots : this.hierarchyOf(parent).children;
  }
}

function removeItem<T>(items: T[], item: T): void {
  const index = items.indexOf(item);
  if (index !== -1) {
    items.splice(index, 1);
  }
}
