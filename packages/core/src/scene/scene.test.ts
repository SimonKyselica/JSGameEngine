import { describe, expect, it, vi } from 'vitest';
import { RowanError } from '../core/assert';
import { isUuid } from '../core/uuid';
import { Vec2 } from '../math/vec2';
import { Camera, Hierarchy, Identity, ScreenAnchor, SpriteRenderer, Transform } from './components';
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

  it('finds a descendant by name in hierarchy order', () => {
    const scene = new Scene();
    const root = scene.createEntity('Root');
    const arm = scene.createEntity('Arm', { parent: root });
    const handOnArm = scene.createEntity('Hand', { parent: arm });
    const leg = scene.createEntity('Leg', { parent: root });
    scene.createEntity('Hand', { parent: root });

    // The arm's subtree is listed before the later sibling that is also called "Hand".
    expect(root.findChild('Hand')).toBe(handOnArm);
    expect(root.findChild('Leg')).toBe(leg);
    expect(root.findChild('Root')).toBeNull();
    expect(leg.findChild('Hand')).toBeNull();
  });

  it('finds a component on the entity itself, then on descendants or ancestors', () => {
    const scene = new Scene();
    const root = scene.createEntity('Root');
    const rootSprite = root.addComponent(SpriteRenderer);
    const middle = scene.createEntity('Middle', { parent: root });
    const first = scene.createEntity('First', { parent: middle });
    const firstCamera = first.addComponent(Camera);
    scene.createEntity('Second', { parent: middle }).addComponent(Camera);

    expect(root.getComponentInChildren(SpriteRenderer)).toBe(rootSprite);
    expect(root.getComponentInChildren(Camera)).toBe(firstCamera);
    expect(first.getComponentInChildren(SpriteRenderer)).toBeUndefined();

    expect(first.getComponentInParent(Camera)).toBe(firstCamera);
    expect(first.getComponentInParent(SpriteRenderer)).toBe(rootSprite);
    expect(root.getComponentInParent(Camera)).toBeUndefined();
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

/** Rounds away floating-point noise so positions can be compared exactly. */
const rounded = (vector: Vec2): number[] =>
  vector.toArray().map((value) => Math.round(value * 1e6) / 1e6);

describe('Scene cameras', () => {
  it('finds the first active primary camera, in the order the cameras were added', () => {
    const scene = new Scene();
    expect(scene.findPrimaryCamera()).toBeNull();
    const first = scene.createEntity('First');
    first.addComponent(Camera, { primary: false });
    const second = scene.createEntity('Second');
    second.addComponent(Camera);
    const third = scene.createEntity('Third');
    third.addComponent(Camera);
    expect(scene.findPrimaryCamera()).toBe(second);

    second.active = false;
    expect(scene.findPrimaryCamera()).toBe(third);
    third.requireComponent(Camera).primary = false;
    // Without a camera marked as primary, the first active one is used.
    expect(scene.findPrimaryCamera()).toBe(first);
  });

  it('forgets cameras that were removed or destroyed', () => {
    const scene = new Scene();
    const first = scene.createEntity('First');
    first.addComponent(Camera);
    const second = scene.createEntity('Second');
    second.addComponent(Camera);

    first.removeComponent(Camera);
    expect(scene.findPrimaryCamera()).toBe(second);
    second.destroy();
    expect(scene.findPrimaryCamera()).toBeNull();
    // A camera that is added again is the newest one, as in the scene's component order.
    const third = scene.createEntity('Third');
    third.addComponent(Camera);
    first.addComponent(Camera);
    expect(scene.findPrimaryCamera()).toBe(third);
  });
});

describe('Scene screen anchors', () => {
  /**
   * A 1000x500 pixel screen seen through a camera that shows 10 world units from top to
   * bottom: one pixel is 0.02 units, and the screen is 20 by 10 units in the world.
   */
  function createScreen(): { scene: Scene; camera: ReturnType<Scene['createEntity']> } {
    const scene = new Scene();
    scene.screenSize.set(1000, 500);
    const camera = scene.createEntity('Camera');
    camera.addComponent(Camera, { orthographicSize: 5 });
    return { scene, camera };
  }

  it('places an anchored entity in pixels from its corner of the screen', () => {
    const { scene, camera } = createScreen();
    camera.transform.position.set(100, 50);
    const label = scene.createEntity('Label');
    label.addComponent(ScreenAnchor, { horizontal: 'left', vertical: 'top' });
    label.transform.position.set(50, -25);

    // The top-left corner of the view is at (90, 55); 50 pixels are one unit.
    expect(rounded(label.worldPosition)).toEqual([91, 54.5]);
    expect(rounded(scene.getWorldScale(label))).toEqual([0.02, 0.02]);
    expect(label.worldRotation).toBe(0);
  });

  it('measures from every corner, edge and the center', () => {
    const { scene } = createScreen();
    const entity = scene.createEntity('Entity');
    const anchor = entity.addComponent(ScreenAnchor);
    const placeAt = (
      horizontal: ScreenAnchor['horizontal'],
      vertical: ScreenAnchor['vertical'],
    ): number[] => {
      anchor.horizontal = horizontal;
      anchor.vertical = vertical;
      return rounded(entity.worldPosition);
    };
    expect(placeAt('center', 'middle')).toEqual([0, 0]);
    expect(placeAt('left', 'middle')).toEqual([-10, 0]);
    expect(placeAt('right', 'middle')).toEqual([10, 0]);
    expect(placeAt('center', 'top')).toEqual([0, 5]);
    expect(placeAt('center', 'bottom')).toEqual([0, -5]);
    expect(placeAt('right', 'bottom')).toEqual([10, -5]);
  });

  it('keeps an anchored entity in place on the screen when the camera moves, zooms or turns', () => {
    const { scene, camera } = createScreen();
    const label = scene.createEntity('Label');
    label.addComponent(ScreenAnchor, { horizontal: 'right', vertical: 'top' });
    label.transform.position.set(-100, -50);
    label.transform.scale.set(2, 2);

    camera.transform.position.set(-30, 7);
    expect(rounded(label.worldPosition)).toEqual([-22, 11]);

    // Twice the view: every pixel covers twice as much of the world.
    camera.requireComponent(Camera).orthographicSize = 10;
    expect(rounded(label.worldPosition)).toEqual([-14, 15]);
    expect(rounded(scene.getWorldScale(label))).toEqual([0.08, 0.08]);

    // Turned a quarter turn, the screen's "right" is the world's "up".
    camera.transform.rotation = Math.PI / 2;
    expect(rounded(label.worldPosition)).toEqual([-38, 23]);
    expect(label.worldRotation).toBeCloseTo(Math.PI / 2);
  });

  it('puts the children of an anchored entity on the screen with it', () => {
    const { scene } = createScreen();
    const panel = scene.createEntity('Panel');
    panel.addComponent(ScreenAnchor, { horizontal: 'left', vertical: 'bottom' });
    panel.transform.position.set(100, 100);
    const icon = scene.createEntity('Icon', { parent: panel });
    icon.transform.position.set(50, 0);
    const world = scene.createEntity('World');

    expect(rounded(icon.worldPosition)).toEqual([-7, -3]);
    expect([panel, icon, world].map((entity) => scene.isOnScreen(entity))).toEqual([
      true,
      true,
      false,
    ]);
  });

  it('lets an anchored entity ignore where its own parent is', () => {
    const { scene } = createScreen();
    const parent = scene.createEntity('Parent');
    parent.transform.position.set(500, 500);
    parent.transform.scale.set(3, 3);
    const label = scene.createEntity('Label', { parent });
    label.addComponent(ScreenAnchor);
    label.transform.position.set(50, 0);
    expect(rounded(label.worldPosition)).toEqual([1, 0]);

    // Moving it elsewhere in the hierarchy changes nothing about where it is.
    scene.setParent(label, null);
    expect(label.transform.position.toArray()).toEqual([50, 0]);
    expect(rounded(label.worldPosition)).toEqual([1, 0]);
  });

  it('turns a world position into pixels when an anchored entity is moved', () => {
    const { scene, camera } = createScreen();
    camera.transform.position.set(40, 0);
    const label = scene.createEntity('Label');
    label.addComponent(ScreenAnchor, { horizontal: 'left', vertical: 'top' });

    // The view's top-left corner is at (30, 5). One unit right and down is 50 pixels each.
    label.setWorldPosition(new Vec2(31, 4));
    expect(rounded(label.transform.position)).toEqual([50, -50]);
    expect(rounded(label.worldPosition)).toEqual([31, 4]);

    camera.transform.rotation = Math.PI / 2;
    label.setWorldRotation(Math.PI);
    expect(label.transform.rotation).toBeCloseTo(Math.PI / 2);
    expect(label.worldRotation).toBeCloseTo(Math.PI);
  });

  it('centers the screen on the origin, 10 units high, in a scene without a camera', () => {
    const scene = new Scene();
    scene.screenSize.set(1000, 500);
    const label = scene.createEntity('Label');
    label.addComponent(ScreenAnchor, { horizontal: 'right', vertical: 'top' });
    expect(rounded(label.worldPosition)).toEqual([10, 5]);
    expect(rounded(scene.getScreenToWorld().getScale())).toEqual([0.02, 0.02]);
  });

  it('copes with a camera that is itself anchored, and with a screen without a size', () => {
    const { scene, camera } = createScreen();
    camera.addComponent(ScreenAnchor);
    camera.transform.position.set(3, 4);
    const label = scene.createEntity('Label');
    label.addComponent(ScreenAnchor);
    // The camera's anchor is left aside when the screen is placed, so this ends.
    expect(rounded(label.worldPosition)).toEqual([3, 4]);

    scene.screenSize.set(0, 0);
    expect(Number.isFinite(label.worldPosition.x)).toBe(true);
  });

  it('follows the size of the screen', () => {
    const { scene } = createScreen();
    const label = scene.createEntity('Label');
    label.addComponent(ScreenAnchor, { horizontal: 'right', vertical: 'top' });
    scene.screenSize.set(2000, 1000);
    // Twice the pixels on the same view: the corner stays, a pixel is half as large.
    expect(rounded(label.worldPosition)).toEqual([10, 5]);
    expect(rounded(scene.getWorldScale(label))).toEqual([0.01, 0.01]);
  });
});
