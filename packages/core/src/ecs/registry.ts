import { assert } from '../core/assert';
import { Signal } from '../core/signal';

/** An opaque entity identifier. Ids are never reused within one registry. */
export type EntityId = number;

/** A component type. Components are plain data classes with a zero-argument constructor. */
export type ComponentClass<T extends object = object> = new () => T;

export interface ComponentEvent {
  readonly entity: EntityId;
  readonly type: ComponentClass;
  readonly component: object;
}

/**
 * The entity-component store. It knows nothing about scenes, hierarchies or systems;
 * it only maps entities to component instances and lets callers query them.
 */
export class Registry {
  /** Emitted after a component is attached. */
  readonly onComponentAdded = new Signal<ComponentEvent>();
  /** Emitted after a component is detached, including when its entity is destroyed. */
  readonly onComponentRemoved = new Signal<ComponentEvent>();
  /** Emitted before an entity's components are removed, so listeners can still read them. */
  readonly onEntityDestroyed = new Signal<EntityId>();

  private nextId: EntityId = 1;
  private readonly alive = new Set<EntityId>();
  private readonly stores = new Map<ComponentClass, Map<EntityId, object>>();

  get entityCount(): number {
    return this.alive.size;
  }

  create(): EntityId {
    const id = this.nextId++;
    this.alive.add(id);
    return id;
  }

  isAlive(entity: EntityId): boolean {
    return this.alive.has(entity);
  }

  /** Destroys an entity and all of its components. Does nothing if it is already gone. */
  destroy(entity: EntityId): void {
    if (!this.alive.has(entity)) {
      return;
    }
    this.onEntityDestroyed.emit(entity);
    for (const [type, store] of this.stores) {
      const component = store.get(entity);
      if (component !== undefined) {
        store.delete(entity);
        this.onComponentRemoved.emit({ entity, type, component });
      }
    }
    this.alive.delete(entity);
  }

  add<T extends object>(entity: EntityId, type: ComponentClass<T>, component: T): T {
    assert(this.alive.has(entity), `Cannot add ${type.name} to destroyed entity ${entity}`);
    let store = this.stores.get(type);
    if (!store) {
      store = new Map();
      this.stores.set(type, store);
    }
    assert(!store.has(entity), `Entity ${entity} already has a ${type.name} component`);
    store.set(entity, component);
    this.onComponentAdded.emit({ entity, type, component });
    return component;
  }

  get<T extends object>(entity: EntityId, type: ComponentClass<T>): T | undefined {
    return this.stores.get(type)?.get(entity) as T | undefined;
  }

  has(entity: EntityId, type: ComponentClass): boolean {
    return this.stores.get(type)?.has(entity) ?? false;
  }

  /** Detaches a component. Returns `false` when the entity did not have one. */
  remove(entity: EntityId, type: ComponentClass): boolean {
    const store = this.stores.get(type);
    const component = store?.get(entity);
    if (!store || component === undefined) {
      return false;
    }
    store.delete(entity);
    this.onComponentRemoved.emit({ entity, type, component });
    return true;
  }

  /** All living entities, in creation order. */
  entities(): IterableIterator<EntityId> {
    return this.alive.values();
  }

  /** Every component attached to an entity, paired with its type. */
  *componentsOf(entity: EntityId): IterableIterator<[ComponentClass, object]> {
    for (const [type, store] of this.stores) {
      const component = store.get(entity);
      if (component !== undefined) {
        yield [type, component];
      }
    }
  }

  /** The number of entities that have a component of the given type. */
  count(type: ComponentClass): number {
    return this.stores.get(type)?.size ?? 0;
  }

  /**
   * Iterates entities that have all of the given component types.
   *
   * The view is live: do not add or remove the queried component types while iterating.
   * Collect the results into an array first when the loop body mutates the registry.
   */
  view<A extends object>(a: ComponentClass<A>): IterableIterator<[EntityId, A]>;
  view<A extends object, B extends object>(
    a: ComponentClass<A>,
    b: ComponentClass<B>,
  ): IterableIterator<[EntityId, A, B]>;
  view<A extends object, B extends object, C extends object>(
    a: ComponentClass<A>,
    b: ComponentClass<B>,
    c: ComponentClass<C>,
  ): IterableIterator<[EntityId, A, B, C]>;
  *view(...types: ComponentClass[]): IterableIterator<[EntityId, ...object[]]> {
    const stores: Map<EntityId, object>[] = [];
    for (const type of types) {
      const store = this.stores.get(type);
      if (!store || store.size === 0) {
        return;
      }
      stores.push(store);
    }

    const first = stores[0]!;
    for (const [entity, component] of first) {
      const result: [EntityId, ...object[]] = [entity, component];
      let complete = true;
      for (let index = 1; index < stores.length; index++) {
        const other = stores[index]!.get(entity);
        if (other === undefined) {
          complete = false;
          break;
        }
        result.push(other);
      }
      if (complete) {
        yield result;
      }
    }
  }

  /** Destroys every entity. Entity ids keep counting up so stale ids stay invalid. */
  clear(): void {
    for (const entity of [...this.alive]) {
      this.destroy(entity);
    }
  }
}
