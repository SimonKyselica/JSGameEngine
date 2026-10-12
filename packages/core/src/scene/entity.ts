import { RowanError } from '../core/assert';
import { getComponentTypeName, type ComponentClass, type EntityId } from '../ecs/registry';
import type { Vec2 } from '../math/vec2';
import { Hierarchy, Identity, Transform } from './components';
import type { Scene } from './scene';

/**
 * A handle to one entity in a scene. Handles are cheap, and a scene always returns the
 * same handle for the same entity, so they can be compared with `===`.
 */
export class Entity {
  constructor(
    /**
     * The engine's scene object that owns the entity. Scripts normally use `this.scene` instead.
     */
    readonly scene: Scene,
    /**
     * A number that identifies the entity while the scene runs. It differs between runs; use `uuid`
     * for anything that is saved.
     */
    readonly id: EntityId,
  ) {}

  /** False once the entity has been destroyed. */
  get isValid(): boolean {
    return this.scene.registry.isAlive(this.id);
  }

  /** A unique id that stays the same when the scene is saved and loaded. */
  get uuid(): string {
    return this.identity.uuid;
  }

  /** The name of the entity. Names do not have to be unique. */
  get name(): string {
    return this.identity.name;
  }

  set name(value: string) {
    this.identity.name = value;
  }

  /** A free-form label for finding groups of entities with `scene.findByTag`. */
  get tag(): string {
    return this.identity.tag;
  }

  set tag(value: string) {
    this.identity.tag = value;
  }

  /** Whether this entity itself is switched on. See {@link Entity.activeInHierarchy}. */
  get active(): boolean {
    return this.identity.active;
  }

  set active(value: boolean) {
    this.identity.active = value;
  }

  /** True when this entity and all of its ancestors are active. */
  get activeInHierarchy(): boolean {
    return this.scene.isActiveInHierarchy(this);
  }

  /** The entity's Transform component: position, rotation and scale relative to its parent. */
  get transform(): Transform {
    return this.requireComponent(Transform);
  }

  /** The entity this one is attached to, or `null` at the top level of the scene. */
  get parent(): Entity | null {
    const parent = this.requireComponent(Hierarchy).parent;
    return parent === null ? null : this.scene.getEntity(parent);
  }

  /** The entities attached to this one, in hierarchy order. The array is a copy. */
  get children(): Entity[] {
    return this.requireComponent(Hierarchy).children.map((child) => this.scene.getEntity(child));
  }

  /** The position in world space. Returns a copy; use {@link Entity.setWorldPosition} to move. */
  get worldPosition(): Vec2 {
    return this.scene.getWorldPosition(this);
  }

  /** The rotation in world space, in radians. */
  get worldRotation(): number {
    return this.scene.getWorldRotation(this);
  }

  /** Moves the entity to a position in world space, whatever its parents' transforms are. */
  setWorldPosition(position: Readonly<Vec2>): void {
    this.scene.setWorldPosition(this, position);
  }

  /** Turns the entity to a rotation in world space, in radians. */
  setWorldRotation(radians: number): void {
    this.scene.setWorldRotation(this, radians);
  }

  /** Re-parents the entity. Pass `null` to move it to the scene root. */
  setParent(parent: Entity | null, keepWorldTransform = true): void {
    this.scene.setParent(this, parent, { keepWorldTransform });
  }

  /** Attaches a new component, optionally overriding some of its default field values. */
  addComponent<T extends object>(type: ComponentClass<T>, init?: Partial<T>): T {
    const component = new type();
    if (init) {
      Object.assign(component, init);
    }
    return this.scene.registry.add(this.id, type, component);
  }

  /** The component of this type, or `undefined` when the entity has none. */
  getComponent<T extends object>(type: ComponentClass<T>): T | undefined {
    return this.scene.registry.get(this.id, type);
  }

  /** Like {@link Entity.getComponent} but throws when the component is missing. */
  requireComponent<T extends object>(type: ComponentClass<T>): T {
    const component = this.scene.registry.get(this.id, type);
    if (component === undefined) {
      throw new RowanError(
        this.isValid
          ? `Entity "${this.name}" has no ${getComponentTypeName(type)} component`
          : `Entity ${this.id} has been destroyed`,
      );
    }
    return component;
  }

  /** True when the entity has a component of this type. */
  hasComponent(type: ComponentClass): boolean {
    return this.scene.registry.has(this.id, type);
  }

  /**
   * The first descendant with this name, or `null`. Descendants are searched in hierarchy
   * order, the order the editor lists them in: each child, then that child's own children.
   */
  findChild(name: string): Entity | null {
    for (const child of this.children) {
      if (child.name === name) {
        return child;
      }
      const found = child.findChild(name);
      if (found) {
        return found;
      }
    }
    return null;
  }

  /**
   * The component of this type on this entity or, failing that, on its first descendant
   * that has one, searched in hierarchy order.
   */
  getComponentInChildren<T extends object>(type: ComponentClass<T>): T | undefined {
    const own = this.getComponent(type);
    if (own !== undefined) {
      return own;
    }
    for (const child of this.children) {
      const found = child.getComponentInChildren(type);
      if (found !== undefined) {
        return found;
      }
    }
    return undefined;
  }

  /** The component of this type on this entity or, failing that, on its nearest ancestor. */
  getComponentInParent<T extends object>(type: ComponentClass<T>): T | undefined {
    return this.getComponent(type) ?? this.parent?.getComponentInParent(type);
  }

  /** Detaches a component. Returns `false` when the entity did not have one. */
  removeComponent(type: ComponentClass): boolean {
    if (type === Hierarchy) {
      throw new RowanError('The Hierarchy component cannot be removed');
    }
    if (type === Identity || type === Transform) {
      throw new RowanError(`The ${getComponentTypeName(type)} component cannot be removed`);
    }
    return this.scene.registry.remove(this.id, type);
  }

  /**
   * Destroys this entity and its descendants immediately. Scripts should normally call
   * `Behaviour.destroy`, which waits until the end of the frame.
   */
  destroy(): void {
    this.scene.destroyEntity(this);
  }

  /** A readable form such as `Entity(Player)`, handy for logging. */
  toString(): string {
    return this.isValid ? `Entity(${this.name})` : `Entity(destroyed #${this.id})`;
  }

  private get identity(): Identity {
    return this.requireComponent(Identity);
  }
}
