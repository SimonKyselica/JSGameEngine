import { describe, expect, it, vi } from 'vitest';
import { RowanError } from '../core/assert';
import { isUuid } from '../core/uuid';
import { Vec2 } from '../math/vec2';
import { Camera, Hierarchy, Identity, SpriteRenderer, Transform } from './components';
import { Scene } from './scene';

const names = (entities: { name: string }[]): string[] => entities.map((entity) => entity.name);

describe('Scene entities', () => {
  it('creates entities with identity, transform and hierarchy', () => {
    const scene = new Scene('Level');
    const entity = scene.createEntity('Player');
    expect(scene.name).toBe('Level');
    expect(entity.name).toBe('Player');
    expect(isUuid(entity.uuid)).toBe(true);
    expect(entity.active).toBe(true);
    expect(entity.tag).toBe('');
    expect(entity.hasComponent(Identity)).toBe(true);
    expect(entity.hasComponent(Transform)).toBe(true);
    expect(entity.hasComponent(Hierarchy)).toBe(true);
    expect(entity.transform.scale.toArray()).toEqual([1, 1]);
    expect(scene.entityCount).toBe(1);
  });

  it('returns the same handle for the same entity', () => {
    const scene = new Scene();
    const entity = scene.createEntity();
    expect(scene.getEntity(entity.id)).toBe(entity);
    expect(scene.findByUuid(entity.uuid)).toBe(entity);
    expect([...scene.entities()]).toEqual([entity]);
  });

  it('uses a given uuid and rejects duplicates', () => {
    const scene = new Scene();
    scene.createEntity('A', { uuid: 'fixed-id' });
    expect(scene.findByUuid('fixed-id')?.name).toBe('A');
    expect(() => scene.createEntity('B', { uuid: 'fixed-id' })).toThrow(RowanError);
  });

  it('finds entities by name and tag in hierarchy order', () => {
    const scene = new Scene();
    const parent = scene.createEntity('Parent');
    const second = scene.createEntity('Coin');
    const first = scene.createEntity('Coin', { parent });
    first.tag = 'pickup';
    second.tag = 'pickup';
    expect(scene.findByName('Coin')).toBe(first);
    expect(scene.findByName('Missing')).toBeNull();
    expect(scene.findByTag('pickup')).toEqual([first, second]);
    expect(scene.findByUuid('missing')).toBeNull();
  });

  it('adds, reads and removes components through the entity handle', () => {
    const scene = new Scene();
    const entity = scene.createEntity();
    const sprite = entity.addComponent(SpriteRenderer, { sortingOrder: 3 });
    expect(sprite.sortingOrder).toBe(3);
    expect(entity.getComponent(SpriteRenderer)).toBe(sprite);
    expect(entity.requireComponent(SpriteRenderer)).toBe(sprite);
    expect(entity.getComponent(Camera)).toBeUndefined();
    expect(() => entity.requireComponent(Camera)).toThrow('has no Camera component');
    expect(entity.removeComponent(SpriteRenderer)).toBe(true);
    expect(entity.removeComponent(SpriteRenderer)).toBe(false);
  });

  it('names components by their schema in errors, not by their class name', () => {
    const entity = new Scene().createEntity('Hero');
    // Stands in for a minified build, where the class is no longer called SpriteRenderer.
    const Minified = { q: class extends SpriteRenderer {} }.q;
    expect(Minified.name).toBe('q');
    expect(() => entity.requireComponent(Minified)).toThrow(
      'Entity "Hero" has no SpriteRenderer component',
    );
    expect(() => entity.removeComponent(Transform)).toThrow(
      'The Transform component cannot be removed',
    );
    expect(() => entity.removeComponent(Hierarchy)).toThrow(
      'The Hierarchy component cannot be removed',
    );
  });

  it('protects the built-in components from removal', () => {
    const entity = new Scene().createEntity();
    expect(() => entity.removeComponent(Transform)).toThrow(RowanError);
    expect(() => entity.removeComponent(Identity)).toThrow(RowanError);
    expect(() => entity.removeComponent(Hierarchy)).toThrow(RowanError);
  });

  it('destroys an entity together with its descendants', () => {
    const scene = new Scene();
    const parent = scene.createEntity('Parent');
    const child = scene.createEntity('Child', { parent });
    const grandchild = scene.createEntity('Grandchild', { parent: child });
    const other = scene.createEntity('Other');
    const childUuid = child.uuid;
    const destroyed: string[] = [];
    scene.onEntityDestroyed.connect((entity) => destroyed.push(entity.name));

    parent.destroy();
    expect(destroyed).toEqual(['Grandchild', 'Child', 'Parent']);
    expect(parent.isValid).toBe(false);
    expect(grandchild.isValid).toBe(false);
    expect(scene.rootEntities).toEqual([other]);
    expect(scene.findByUuid(childUuid)).toBeNull();
    expect(parent.toString()).toContain('destroyed');
    expect(() => parent.name).toThrow('has been destroyed');
    expect(() => scene.destroyEntity(parent)).not.toThrow();
  });

  it('removes a destroyed child from its parent', () => {
    const scene = new Scene();
    const parent = scene.createEntity('Parent');
    const child = scene.createEntity('Child', { parent });
    child.destroy();
    expect(parent.children).toEqual([]);
    expect(parent.isValid).toBe(true);
  });

  it('announces created entities and clears the scene', () => {
    const scene = new Scene();
    const created = vi.fn();
    scene.onEntityCreated.connect(created);
    const entity = scene.createEntity('A');
    scene.createEntity('B', { parent: entity });
    expect(created).toHaveBeenCalledTimes(2);
    scene.clear();
    expect(scene.entityCount).toBe(0);
    expect(scene.rootEntities).toEqual([]);
  });
});

describe('Scene hierarchy', () => {
  it('tracks parents, children and root order', () => {
    const scene = new Scene();
    const a = scene.createEntity('A');
    const b = scene.createEntity('B');
    const c = scene.createEntity('C', { parent: a });
    expect(names(scene.rootEntities)).toEqual(['A', 'B']);
    expect(c.parent).toBe(a);
    expect(a.children).toEqual([c]);
    expect(b.parent).toBeNull();
    expect(names(scene.entitiesInHierarchyOrder())).toEqual(['A', 'C', 'B']);
  });

  it('re-parents and inserts at a sibling index', () => {
    const scene = new Scene();
    const parent = scene.createEntity('Parent');
    const a = scene.createEntity('A', { parent });
    const b = scene.createEntity('B', { parent });
    const c = scene.createEntity('C');
    scene.setParent(c, parent, { index: 1 });
    expect(parent.children).toEqual([a, c, b]);
    expect(scene.getSiblingIndex(c)).toBe(1);

    c.setParent(null);
    expect(c.parent).toBeNull();
    expect(parent.children).toEqual([a, b]);
    expect(names(scene.rootEntities)).toEqual(['Parent', 'C']);
  });

  it('reorders within the same parent', () => {
    const scene = new Scene();
    const a = scene.createEntity('A');
    scene.createEntity('B');
    scene.createEntity('C');
    scene.setParent(a, null, { index: 2 });
    expect(names(scene.rootEntities)).toEqual(['B', 'C', 'A']);
  });

  it('refuses to create cycles', () => {
    const scene = new Scene();
    const parent = scene.createEntity('Parent');
    const child = scene.createEntity('Child', { parent });
    expect(() => scene.setParent(parent, child)).toThrow('itself or one of its descendants');
    expect(() => scene.setParent(parent, parent)).toThrow(RowanError);
    expect(scene.isSameOrDescendant(child, parent)).toBe(true);
    expect(scene.isSameOrDescendant(parent, child)).toBe(false);
  });

  it('refuses entities from another scene', () => {
    const scene = new Scene();
    const foreign = new Scene().createEntity();
    expect(() => scene.setParent(scene.createEntity(), foreign)).toThrow(RowanError);
    expect(() => scene.setParent(foreign, null)).toThrow(RowanError);
  });

  it('treats an entity as inactive when any ancestor is inactive', () => {
    const scene = new Scene();
    const parent = scene.createEntity('Parent');
    const child = scene.createEntity('Child', { parent });
    expect(child.activeInHierarchy).toBe(true);
    parent.active = false;
    expect(child.active).toBe(true);
    expect(child.activeInHierarchy).toBe(false);
  });
});

describe('Scene transforms', () => {
  it('combines parent and child transforms into world space', () => {
    const scene = new Scene();
    const parent = scene.createEntity('Parent');
    parent.transform.position.set(10, 0);
    parent.transform.rotation = Math.PI / 2;
    parent.transform.scale.set(2, 2);
    const child = scene.createEntity('Child', { parent });
    child.transform.position.set(1, 0);

    // The child's local (1, 0) is scaled to (2, 0), rotated to (0, 2), then moved.
    expect(child.worldPosition.equals(new Vec2(10, 2))).toBe(true);
    expect(child.worldRotation).toBeCloseTo(Math.PI / 2);
    expect(scene.getWorldScale(child).equals(new Vec2(2, 2))).toBe(true);
    expect(scene.getWorldScale(parent).equals(new Vec2(2, 2))).toBe(true);
    expect(scene.getWorldMatrix(child).transformPoint(new Vec2()).equals(new Vec2(10, 2))).toBe(
      true,
    );
  });

  it('sets world position and rotation through the parent', () => {
    const scene = new Scene();
    const parent = scene.createEntity('Parent');
    parent.transform.position.set(5, 5);
    parent.transform.rotation = Math.PI / 2;
    const child = scene.createEntity('Child', { parent });

    child.setWorldPosition(new Vec2(5, 8));
    expect(child.transform.position.equals(new Vec2(3, 0))).toBe(true);
    expect(child.worldPosition.equals(new Vec2(5, 8))).toBe(true);

    child.setWorldRotation(Math.PI);
    expect(child.transform.rotation).toBeCloseTo(Math.PI / 2);

    parent.setWorldPosition(new Vec2(1, 2));
    parent.setWorldRotation(0.5);
    expect(parent.transform.position.toArray()).toEqual([1, 2]);
    expect(parent.transform.rotation).toBe(0.5);
  });

  it('keeps the world transform when re-parenting by default', () => {
    const scene = new Scene();
    const parent = scene.createEntity('Parent');
    parent.transform.position.set(4, 4);
    parent.transform.scale.set(2, 2);
    const child = scene.createEntity('Child');
    child.transform.position.set(6, 4);

    child.setParent(parent);
    expect(child.transform.position.equals(new Vec2(1, 0))).toBe(true);
    expect(child.transform.scale.equals(new Vec2(0.5, 0.5))).toBe(true);
    expect(child.worldPosition.equals(new Vec2(6, 4))).toBe(true);

    child.setParent(null);
    expect(child.transform.position.equals(new Vec2(6, 4))).toBe(true);
    expect(child.transform.scale.equals(new Vec2(1, 1))).toBe(true);
  });

  it('keeps the local transform when asked to', () => {
    const scene = new Scene();
    const parent = scene.createEntity('Parent');
    parent.transform.position.set(4, 4);
    const child = scene.createEntity('Child');
    child.transform.position.set(1, 1);
    child.setParent(parent, false);
    expect(child.transform.position.toArray()).toEqual([1, 1]);
    expect(child.worldPosition.toArray()).toEqual([5, 5]);
  });

  it('copes with a parent that is scaled to zero', () => {
    const scene = new Scene();
    const parent = scene.createEntity('Parent');
    parent.transform.scale.set(0, 0);
    const child = scene.createEntity('Child');
    child.transform.position.set(3, 3);

    expect(() => child.setParent(parent)).not.toThrow();
    expect(child.transform.position.toArray()).toEqual([3, 3]);
    expect(() => child.setWorldPosition(new Vec2(1, 1))).not.toThrow();
    expect(child.transform.position.toArray()).toEqual([1, 1]);
  });
});
