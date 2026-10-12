import { assert } from '../core/assert';
import { Signal } from '../core/signal';
import { generateUuid } from '../core/uuid';
import { Registry, type EntityId } from '../ecs/registry';
import { Mat3 } from '../math/mat3';
import { Vec2 } from '../math/vec2';
import { Hierarchy, Identity, Transform } from './components';
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

/** A collection of entities arranged in a transform hierarchy. */
export class Scene {
  readonly registry = new Registry();
  /** Emitted after an entity has been created with its built-in components. */
  readonly onEntityCreated = new Signal<Entity>();
  /** Emitted just before an entity is destroyed, while its components are still readable. */
  readonly onEntityDestroyed = new Signal<Entity>();

  private readonly handles = new Map<EntityId, Entity>();
  private readonly uuidIndex = new Map<string, EntityId>();
  private readonly roots: EntityId[] = [];
  private readonly scratch = new Mat3();

  constructor(public name = 'Untitled') {}

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
    let current: EntityId | null = entity.id;
    while (current !== null) {
      if (!this.registry.get(current, Identity)!.active) {
        return false;
      }
      current = this.hierarchyOf(current).parent;
    }
    return true;
  }

  /** The matrix that maps the entity's local space to world space. */
  getWorldMatrix(entity: Entity, out = new Mat3()): Mat3 {
    const transform = entity.transform;
    out.compose(transform.position, transform.rotation, transform.scale);
    let parent = this.hierarchyOf(entity.id).parent;
    while (parent !== null) {
      const parentTransform = this.registry.get(parent, Transform)!;
      this.scratch.compose(
        parentTransform.position,
        parentTransform.rotation,
        parentTransform.scale,
      );
      out.premultiply(this.scratch);
      parent = this.hierarchyOf(parent).parent;
    }
    return out;
  }

  getWorldPosition(entity: Entity, out = new Vec2()): Vec2 {
    if (this.hierarchyOf(entity.id).parent === null) {
      return out.copy(entity.transform.position);
    }
    return this.getWorldMatrix(entity).getTranslation(out);
  }

  getWorldRotation(entity: Entity): number {
    if (this.hierarchyOf(entity.id).parent === null) {
      return entity.transform.rotation;
    }
    return this.getWorldMatrix(entity).getRotation();
  }

  getWorldScale(entity: Entity, out = new Vec2()): Vec2 {
    if (this.hierarchyOf(entity.id).parent === null) {
      return out.copy(entity.transform.scale);
    }
    return this.getWorldMatrix(entity).getScale(out);
  }

  /**
   * Moves the entity to a world-space position. If a parent is scaled to zero the world
   * position is undefined, and the local position is set directly instead.
   */
  setWorldPosition(entity: Entity, position: Readonly<Vec2>): void {
    const parentInverse = this.getParentInverseMatrix(entity);
    if (parentInverse) {
      parentInverse.transformPoint(position, entity.transform.position);
    } else {
      entity.transform.position.copy(position);
    }
  }

  setWorldRotation(entity: Entity, radians: number): void {
    const parent = entity.parent;
    entity.transform.rotation = parent ? radians - this.getWorldRotation(parent) : radians;
  }

  private getParentInverseMatrix(entity: Entity): Mat3 | null {
    const parent = entity.parent;
    if (!parent) {
      return null;
    }
    const matrix = this.getWorldMatrix(parent);
    return matrix.invert() ? matrix : null;
  }

  private applyWorldMatrix(entity: Entity, worldMatrix: Mat3): void {
    const local = worldMatrix.clone();
    const parentInverse = this.getParentInverseMatrix(entity);
    if (parentInverse) {
      local.premultiply(parentInverse);
    } else if (entity.parent) {
      // The parent is scaled to zero, so no local transform can reproduce the world one.
      return;
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
