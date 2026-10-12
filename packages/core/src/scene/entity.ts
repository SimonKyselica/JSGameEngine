import { RowanError } from '../core/assert';
import type { ComponentClass, EntityId } from '../ecs/registry';
import type { Vec2 } from '../math/vec2';
import { Hierarchy, Identity, Transform } from './components';
import type { Scene } from './scene';

/**
 * A handle to one entity in a scene. Handles are cheap, and a scene always returns the
 * same handle for the same entity, so they can be compared with `===`.
 */
export class Entity {
  constructor(
    readonly scene: Scene,
    readonly id: EntityId,
  ) {}

  /** False once the entity has been destroyed. */
  get isValid(): boolean {
    return this.scene.registry.isAlive(this.id);
  }

  get uuid(): string {
    return this.identity.uuid;
  }

  get name(): string {
    return this.identity.name;
  }

  set name(value: string) {
    this.identity.name = value;
  }

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

  get transform(): Transform {
    return this.requireComponent(Transform);
  }

  get parent(): Entity | null {
    const parent = this.requireComponent(Hierarchy).parent;
    return parent === null ? null : this.scene.getEntity(parent);
  }

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

  setWorldPosition(position: Readonly<Vec2>): void {
    this.scene.setWorldPosition(this, position);
  }

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

  getComponent<T extends object>(type: ComponentClass<T>): T | undefined {
    return this.scene.registry.get(this.id, type);
  }

  /** Like {@link Entity.getComponent} but throws when the component is missing. */
  requireComponent<T extends object>(type: ComponentClass<T>): T {
    const component = this.scene.registry.get(this.id, type);
    if (component === undefined) {
      throw new RowanError(
        this.isValid
          ? `Entity "${this.name}" has no ${type.name} component`
          : `Entity ${this.id} has been destroyed`,
      );
    }
    return component;
  }

  hasComponent(type: ComponentClass): boolean {
    return this.scene.registry.has(this.id, type);
  }

  /** Detaches a component. Returns `false` when the entity did not have one. */
  removeComponent(type: ComponentClass): boolean {
    if (type === Identity || type === Transform || type === Hierarchy) {
      throw new RowanError(`The ${type.name} component cannot be removed`);
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

  toString(): string {
    return this.isValid ? `Entity(${this.name})` : `Entity(destroyed #${this.id})`;
  }

  private get identity(): Identity {
    return this.requireComponent(Identity);
  }
}
