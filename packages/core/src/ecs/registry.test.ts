import { describe, expect, it, vi } from 'vitest';
import { RowanError } from '../core/assert';
import { Registry } from './registry';

class Position {
  x = 0;
}
class Velocity {
  dx = 0;
}
class Health {
  points = 100;
}

describe('Registry', () => {
  it('creates distinct entities and tracks whether they are alive', () => {
    const registry = new Registry();
    const a = registry.create();
    const b = registry.create();
    expect(a).not.toBe(b);
    expect(registry.isAlive(a)).toBe(true);
    expect(registry.entityCount).toBe(2);
    expect([...registry.entities()]).toEqual([a, b]);
  });

  it('never reuses the id of a destroyed entity', () => {
    const registry = new Registry();
    const first = registry.create();
    registry.destroy(first);
    expect(registry.create()).not.toBe(first);
    expect(registry.isAlive(first)).toBe(false);
  });

  it('adds, reads and removes components', () => {
    const registry = new Registry();
    const entity = registry.create();
    const position = registry.add(entity, Position, new Position());
    expect(registry.get(entity, Position)).toBe(position);
    expect(registry.has(entity, Position)).toBe(true);
    expect(registry.has(entity, Velocity)).toBe(false);
    expect(registry.get(entity, Velocity)).toBeUndefined();
    expect(registry.count(Position)).toBe(1);

    expect(registry.remove(entity, Position)).toBe(true);
    expect(registry.remove(entity, Position)).toBe(false);
    expect(registry.has(entity, Position)).toBe(false);
    expect(registry.count(Position)).toBe(0);
  });

  it('rejects a second component of the same type and components on dead entities', () => {
    const registry = new Registry();
    const entity = registry.create();
    registry.add(entity, Position, new Position());
    expect(() => registry.add(entity, Position, new Position())).toThrow(RowanError);
    registry.destroy(entity);
    expect(() => registry.add(entity, Velocity, new Velocity())).toThrow(RowanError);
  });

  it('lists the components of an entity', () => {
    const registry = new Registry();
    const entity = registry.create();
    const position = registry.add(entity, Position, new Position());
    const health = registry.add(entity, Health, new Health());
    expect([...registry.componentsOf(entity)]).toEqual([
      [Position, position],
      [Health, health],
    ]);
  });

  it('views entities that have every requested component', () => {
    const registry = new Registry();
    const moving = registry.create();
    const still = registry.create();
    const movingPosition = registry.add(moving, Position, new Position());
    const movingVelocity = registry.add(moving, Velocity, new Velocity());
    const stillPosition = registry.add(still, Position, new Position());

    expect([...registry.view(Position)]).toEqual([
      [moving, movingPosition],
      [still, stillPosition],
    ]);
    expect([...registry.view(Position, Velocity)]).toEqual([
      [moving, movingPosition, movingVelocity],
    ]);
    expect([...registry.view(Position, Velocity, Health)]).toEqual([]);
    expect([...registry.view(Health)]).toEqual([]);
  });

  it('removes all components when an entity is destroyed', () => {
    const registry = new Registry();
    const entity = registry.create();
    registry.add(entity, Position, new Position());
    registry.add(entity, Velocity, new Velocity());
    registry.destroy(entity);
    expect([...registry.view(Position)]).toEqual([]);
    expect(registry.count(Velocity)).toBe(0);
    expect(() => registry.destroy(entity)).not.toThrow();
  });

  it('emits events for added and removed components', () => {
    const registry = new Registry();
    const added = vi.fn();
    const removed = vi.fn();
    registry.onComponentAdded.connect(added);
    registry.onComponentRemoved.connect(removed);

    const entity = registry.create();
    const position = registry.add(entity, Position, new Position());
    expect(added).toHaveBeenCalledExactlyOnceWith({ entity, type: Position, component: position });

    registry.remove(entity, Position);
    expect(removed).toHaveBeenCalledExactlyOnceWith({
      entity,
      type: Position,
      component: position,
    });
  });

  it('announces destruction while the components are still readable', () => {
    const registry = new Registry();
    const entity = registry.create();
    registry.add(entity, Health, new Health());
    let pointsSeen: number | undefined;
    const removed = vi.fn();
    registry.onEntityDestroyed.connect((id) => {
      pointsSeen = registry.get(id, Health)?.points;
    });
    registry.onComponentRemoved.connect(removed);

    registry.destroy(entity);
    expect(pointsSeen).toBe(100);
    expect(removed).toHaveBeenCalledOnce();
  });

  it('destroys everything on clear', () => {
    const registry = new Registry();
    registry.add(registry.create(), Position, new Position());
    registry.create();
    registry.clear();
    expect(registry.entityCount).toBe(0);
    expect(registry.count(Position)).toBe(0);
  });
});
