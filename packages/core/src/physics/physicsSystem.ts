import { BoxShape, CircleShape, World, type Body, type Contact, type Fixture } from 'planck';
import { RowanError } from '../core/assert';
import type { Unsubscribe } from '../core/signal';
import type { ComponentClass, EntityId } from '../ecs/registry';
import { Vec2 } from '../math/vec2';
import { BoxCollider2D, CircleCollider2D, Rigidbody2D } from '../scene/components';
import type { Entity } from '../scene/entity';
import type { Scene } from '../scene/scene';

const VELOCITY_ITERATIONS = 8;
const POSITION_ITERATIONS = 3;
/** Shapes smaller than this are skipped; the solver cannot handle degenerate geometry. */
const MIN_SHAPE_EXTENT = 0.005;
/** How far a transform may drift from its body before it counts as moved by game code. */
const TRANSFORM_EPSILON = 1e-6;
const DEFAULT_RAYCAST_DISTANCE = 1000;

/** An entity gets a physics body when it has at least one of these. */
const BODY_COMPONENTS: readonly ComponentClass[] = [Rigidbody2D, BoxCollider2D, CircleCollider2D];

export type ContactEventKind = 'collisionEnter' | 'collisionExit' | 'triggerEnter' | 'triggerExit';

/** Something that happened between two physics bodies, reported once per involved entity. */
export interface ContactEvent {
  readonly kind: ContactEventKind;
  readonly entity: Entity;
  readonly other: Entity;
  /** World-space contact point. Only set for `collisionEnter`. */
  readonly point: Vec2 | null;
  /** Unit vector pointing from `entity` towards `other`. Only set for `collisionEnter`. */
  readonly normal: Vec2 | null;
}

export interface RaycastHit {
  readonly entity: Entity;
  /** World-space point where the ray hit. */
  readonly point: Vec2;
  /** Surface normal at the hit point. */
  readonly normal: Vec2;
  /** Distance from the ray origin to the hit point. */
  readonly distance: number;
}

/** A collider's fixture together with the values it was built from. */
interface ColliderState {
  fixture: Fixture | null;
  /** True when `values` describe the current fixture, or its deliberate absence. */
  synced: boolean;
  readonly values: number[];
}

interface BodyRecord {
  readonly entity: Entity;
  readonly body: Body;
  readonly box: ColliderState;
  readonly circle: ColliderState;
  /** The transform last exchanged with the body, used to detect moves made by game code. */
  lastX: number;
  lastY: number;
  lastRotation: number;
}

interface PendingContact {
  readonly begin: boolean;
  readonly sensor: boolean;
  readonly a: EntityId;
  readonly b: EntityId;
  readonly point: Vec2 | null;
  readonly normal: Vec2 | null;
}

/**
 * Simulates the scene's rigid bodies and colliders with planck.js.
 *
 * The components are the source of truth: every step the system creates, updates and
 * removes physics bodies so they match the components, simulates, and then writes the
 * resulting positions back to the entities' transforms.
 */
export class PhysicsSystem {
  private world: World;
  private readonly records = new Map<EntityId, BodyRecord>();
  private readonly pendingContacts: PendingContact[] = [];
  private readonly subscriptions: Unsubscribe[] = [];
  private readonly scratchPosition = new Vec2();
  private readonly scratchScale = new Vec2();
  private readonly scratchValues: number[] = [];

  constructor(
    private readonly scene: Scene,
    gravity: Readonly<Vec2>,
  ) {
    this.world = this.createWorld(gravity);
  }

  get bodyCount(): number {
    return this.records.size;
  }

  /** Creates bodies for the entities already in the scene and starts tracking changes. */
  start(): void {
    this.subscriptions.push(
      this.scene.onEntityDestroyed.connect((entity) => this.destroyRecord(entity.id)),
    );
    this.synchronize();
  }

  /** Destroys every body and stops tracking the scene. */
  stop(): void {
    for (const unsubscribe of this.subscriptions.splice(0)) {
      unsubscribe();
    }
    this.records.clear();
    this.pendingContacts.length = 0;
    this.world = this.createWorld(this.getGravity());
  }

  /** Advances the simulation and returns the contact events it produced. */
  step(deltaSeconds: number): ContactEvent[] {
    this.synchronize();
    this.world.step(deltaSeconds, VELOCITY_ITERATIONS, POSITION_ITERATIONS);
    this.writeTransforms();
    return this.drainContacts();
  }

  getGravity(out = new Vec2()): Vec2 {
    const gravity = this.world.getGravity();
    return out.set(gravity.x, gravity.y);
  }

  setGravity(gravity: Readonly<Vec2>): void {
    this.world.setGravity({ x: gravity.x, y: gravity.y });
    // Sleeping bodies ignore gravity changes until something wakes them.
    for (const record of this.records.values()) {
      record.body.setAwake(true);
    }
  }

  /** True when the entity has a rigidbody or collider and therefore a physics body. */
  hasBody(entity: Entity): boolean {
    return entity.isValid && needsBody(entity);
  }

  getLinearVelocity(entity: Entity, out = new Vec2()): Vec2 {
    const velocity = this.requireBody(entity).getLinearVelocity();
    return out.set(velocity.x, velocity.y);
  }

  setLinearVelocity(entity: Entity, velocity: Readonly<Vec2>): void {
    const body = this.requireBody(entity);
    body.setLinearVelocity({ x: velocity.x, y: velocity.y });
    body.setAwake(true);
  }

  /** Angular velocity in radians per second, counter-clockwise. */
  getAngularVelocity(entity: Entity): number {
    return this.requireBody(entity).getAngularVelocity();
  }

  setAngularVelocity(entity: Entity, radiansPerSecond: number): void {
    const body = this.requireBody(entity);
    body.setAngularVelocity(radiansPerSecond);
    body.setAwake(true);
  }

  /** Applies a continuous force in newtons at the body's center of mass. */
  applyForce(entity: Entity, force: Readonly<Vec2>): void {
    this.requireBody(entity).applyForceToCenter({ x: force.x, y: force.y }, true);
  }

  /** Applies an instant change of momentum at the body's center of mass. */
  applyImpulse(entity: Entity, impulse: Readonly<Vec2>): void {
    const body = this.requireBody(entity);
    body.applyLinearImpulse({ x: impulse.x, y: impulse.y }, body.getWorldCenter(), true);
  }

  applyTorque(entity: Entity, torque: number): void {
    this.requireBody(entity).applyTorque(torque, true);
  }

  getMass(entity: Entity): number {
    return this.requireBody(entity).getMass();
  }

  /**
   * Finds the closest collider along a ray. Triggers are ignored unless `includeTriggers`
   * is set. The ray sees bodies where they were after the most recent physics step.
   */
  raycast(
    origin: Readonly<Vec2>,
    direction: Readonly<Vec2>,
    maxDistance = DEFAULT_RAYCAST_DISTANCE,
    includeTriggers = false,
  ): RaycastHit | null {
    const length = Math.hypot(direction.x, direction.y);
    if (length === 0 || !(maxDistance > 0) || !Number.isFinite(maxDistance)) {
      return null;
    }
    const end = {
      x: origin.x + (direction.x / length) * maxDistance,
      y: origin.y + (direction.y / length) * maxDistance,
    };

    let hitEntity: EntityId | null = null;
    let hitFraction = 1;
    const hitPoint = new Vec2();
    const hitNormal = new Vec2();
    this.world.rayCast({ x: origin.x, y: origin.y }, end, (fixture, point, normal, fraction) => {
      if (fixture.isSensor() && !includeTriggers) {
        return -1; // skip this fixture and keep going
      }
      hitEntity = fixture.getBody().getUserData() as EntityId;
      hitFraction = fraction;
      hitPoint.set(point.x, point.y);
      hitNormal.set(normal.x, normal.y);
      return fraction; // shorten the ray so only closer fixtures are reported from now on
    });

    if (hitEntity === null || !this.scene.registry.isAlive(hitEntity)) {
      return null;
    }
    return {
      entity: this.scene.getEntity(hitEntity),
      point: hitPoint,
      normal: hitNormal,
      distance: hitFraction * maxDistance,
    };
  }

  /** Every entity that has a collider (including triggers) containing the point. */
  overlapPoint(point: Readonly<Vec2>): Entity[] {
    const target = { x: point.x, y: point.y };
    const found = new Set<EntityId>();
    this.world.queryAABB({ lowerBound: target, upperBound: target }, (fixture) => {
      if (fixture.testPoint(target)) {
        found.add(fixture.getBody().getUserData() as EntityId);
      }
      return true;
    });
    return [...found]
      .filter((id) => this.scene.registry.isAlive(id))
      .map((id) => this.scene.getEntity(id));
  }

  private createWorld(gravity: Readonly<Vec2>): World {
    const world = new World({ gravity: { x: gravity.x, y: gravity.y } });
    world.on('begin-contact', (contact) => this.queueContact(contact, true));
    world.on('end-contact', (contact) => this.queueContact(contact, false));
    return world;
  }

  /** Makes the physics world match the scene's components and transforms. */
  private synchronize(): void {
    const registry = this.scene.registry;
    for (const type of BODY_COMPONENTS) {
      for (const [id] of registry.view(type)) {
        if (!this.records.has(id)) {
          this.createRecord(this.scene.getEntity(id));
        }
      }
    }
    for (const record of this.records.values()) {
      if (needsBody(record.entity)) {
        this.syncRecord(record);
      } else {
        this.destroyRecord(record.entity.id);
      }
    }
  }

  /** The entity's body, created on the spot when the entity was added this frame. */
  private requireBody(entity: Entity): Body {
    if (!this.hasBody(entity)) {
      throw new RowanError(
        `"${entity.isValid ? entity.name : 'destroyed entity'}" has no physics body. ` +
          'Add a Rigidbody2D or a collider component first.',
      );
    }
    const record = this.records.get(entity.id) ?? this.createRecord(entity);
    return record.body;
  }

  private createRecord(entity: Entity): BodyRecord {
    const position = this.scene.getWorldPosition(entity, this.scratchPosition);
    const rotation = this.scene.getWorldRotation(entity);
    const body = this.world.createBody({
      type: 'static',
      position: { x: position.x, y: position.y },
      angle: rotation,
      userData: entity.id,
    });
    const record: BodyRecord = {
      entity,
      body,
      box: { fixture: null, synced: false, values: [] },
      circle: { fixture: null, synced: false, values: [] },
      lastX: position.x,
      lastY: position.y,
      lastRotation: rotation,
    };
    this.records.set(entity.id, record);
    this.syncRecord(record);
    return record;
  }

  private destroyRecord(id: EntityId): void {
    const record = this.records.get(id);
    if (record) {
      this.records.delete(id);
      this.world.destroyBody(record.body);
    }
  }

  private syncRecord(record: BodyRecord): void {
    const { entity, body } = record;
    const rigidbody = entity.getComponent(Rigidbody2D);

    // Setters wake the body or reset its mass, so only call them for real changes.
    const type = rigidbody?.bodyType ?? 'static';
    if (body.getType() !== type) {
      body.setType(type);
    }
    if (rigidbody) {
      if (body.getGravityScale() !== rigidbody.gravityScale) {
        body.setGravityScale(rigidbody.gravityScale);
        body.setAwake(true);
      }
      if (body.getLinearDamping() !== rigidbody.linearDamping) {
        body.setLinearDamping(rigidbody.linearDamping);
      }
      if (body.getAngularDamping() !== rigidbody.angularDamping) {
        body.setAngularDamping(rigidbody.angularDamping);
      }
      if (body.isFixedRotation() !== rigidbody.fixedRotation) {
        body.setFixedRotation(rigidbody.fixedRotation);
      }
      if (body.isBullet() !== rigidbody.continuous) {
        body.setBullet(rigidbody.continuous);
      }
    }

    const active = entity.activeInHierarchy;
    if (body.isActive() !== active) {
      body.setActive(active);
    }

    const position = this.scene.getWorldPosition(entity, this.scratchPosition);
    const rotation = this.scene.getWorldRotation(entity);
    const moved =
      Math.abs(position.x - record.lastX) > TRANSFORM_EPSILON ||
      Math.abs(position.y - record.lastY) > TRANSFORM_EPSILON ||
      Math.abs(rotation - record.lastRotation) > TRANSFORM_EPSILON;
    // A NaN or infinite transform would corrupt the whole simulation, so it is ignored.
    const finite =
      Number.isFinite(position.x) && Number.isFinite(position.y) && Number.isFinite(rotation);
    if (moved && finite) {
      // Game code moved the entity: teleport the body to follow it.
      body.setTransform({ x: position.x, y: position.y }, rotation);
      body.setAwake(true);
      record.lastX = position.x;
      record.lastY = position.y;
      record.lastRotation = rotation;
    }

    const scale = this.scene.getWorldScale(entity, this.scratchScale);
    this.syncBox(record, entity.getComponent(BoxCollider2D), scale);
    this.syncCircle(record, entity.getComponent(CircleCollider2D), scale);
  }

  private syncBox(record: BodyRecord, collider: BoxCollider2D | undefined, scale: Vec2): void {
    const state = record.box;
    if (!collider) {
      this.clearFixture(record, state);
      return;
    }
    const halfWidth = Math.abs(collider.size.x * scale.x) / 2;
    const halfHeight = Math.abs(collider.size.y * scale.y) / 2;
    const offsetX = collider.offset.x * scale.x;
    const offsetY = collider.offset.y * scale.y;
    if (!this.updateColliderValues(state, collider, halfWidth, halfHeight, offsetX, offsetY)) {
      return;
    }
    this.clearFixture(record, state);
    state.synced = true;
    if (isUsableShape(halfWidth, halfHeight, offsetX, offsetY)) {
      state.fixture = record.body.createFixture({
        shape: new BoxShape(halfWidth, halfHeight, { x: offsetX, y: offsetY }, 0),
        ...getMaterial(state),
      });
    }
  }

  private syncCircle(
    record: BodyRecord,
    collider: CircleCollider2D | undefined,
    scale: Vec2,
  ): void {
    const state = record.circle;
    if (!collider) {
      this.clearFixture(record, state);
      return;
    }
    // A circle cannot be squashed, so it follows the larger of the two scale axes.
    const radius = Math.abs(collider.radius) * Math.max(Math.abs(scale.x), Math.abs(scale.y));
    const offsetX = collider.offset.x * scale.x;
    const offsetY = collider.offset.y * scale.y;
    if (!this.updateColliderValues(state, collider, radius, radius, offsetX, offsetY)) {
      return;
    }
    this.clearFixture(record, state);
    state.synced = true;
    if (isUsableShape(radius, radius, offsetX, offsetY)) {
      state.fixture = record.body.createFixture({
        shape: new CircleShape({ x: offsetX, y: offsetY }, radius),
        ...getMaterial(state),
      });
    }
  }

  /**
   * Stores the values a fixture is built from. Returns `false` when they are unchanged,
   * which means the existing fixture is still correct.
   */
  private updateColliderValues(
    state: ColliderState,
    collider: BoxCollider2D | CircleCollider2D,
    extentX: number,
    extentY: number,
    offsetX: number,
    offsetY: number,
  ): boolean {
    const next = this.scratchValues;
    next[0] = extentX;
    next[1] = extentY;
    next[2] = offsetX;
    next[3] = offsetY;
    next[4] = sanitizeMaterial(collider.density);
    next[5] = sanitizeMaterial(collider.friction);
    next[6] = sanitizeMaterial(collider.restitution);
    next[7] = collider.isTrigger ? 1 : 0;

    const current = state.values;
    let changed = !state.synced;
    for (let index = 0; index < next.length; index++) {
      if (current[index] !== next[index]) {
        current[index] = next[index]!;
        changed = true;
      }
    }
    return changed;
  }

  private clearFixture(record: BodyRecord, state: ColliderState): void {
    if (state.fixture) {
      record.body.destroyFixture(state.fixture);
      state.fixture = null;
    }
    state.synced = false;
  }

  /** Copies the simulated positions of moving bodies back to their entities. */
  private writeTransforms(): void {
    for (const record of this.records.values()) {
      const { body, entity } = record;
      if (body.getType() === 'static' || !body.isActive() || !body.isAwake()) {
        continue;
      }
      const position = body.getPosition();
      const rotation = body.getAngle();
      this.scene.setWorldPosition(entity, this.scratchPosition.set(position.x, position.y));
      this.scene.setWorldRotation(entity, rotation);
      record.lastX = position.x;
      record.lastY = position.y;
      record.lastRotation = rotation;
    }
  }

  private queueContact(contact: Contact, begin: boolean): void {
    const fixtureA = contact.getFixtureA();
    const fixtureB = contact.getFixtureB();
    const sensor = fixtureA.isSensor() || fixtureB.isSensor();

    let point: Vec2 | null = null;
    let normal: Vec2 | null = null;
    if (begin && !sensor) {
      const manifold = contact.getWorldManifold(null);
      const firstPoint = manifold?.points[0];
      if (manifold && firstPoint) {
        point = new Vec2(firstPoint.x, firstPoint.y);
        normal = new Vec2(manifold.normal.x, manifold.normal.y);
      }
    }
    this.pendingContacts.push({
      begin,
      sensor,
      a: fixtureA.getBody().getUserData() as EntityId,
      b: fixtureB.getBody().getUserData() as EntityId,
      point,
      normal,
    });
  }

  /** Turns the contacts collected during the step into one event per involved entity. */
  private drainContacts(): ContactEvent[] {
    const events: ContactEvent[] = [];
    const registry = this.scene.registry;
    for (const contact of this.pendingContacts.splice(0)) {
      // Contacts that end because an entity was destroyed are not reported.
      if (!registry.isAlive(contact.a) || !registry.isAlive(contact.b)) {
        continue;
      }
      const entityA = this.scene.getEntity(contact.a);
      const entityB = this.scene.getEntity(contact.b);
      const kind = getContactKind(contact);
      events.push(
        { kind, entity: entityA, other: entityB, point: contact.point, normal: contact.normal },
        {
          kind,
          entity: entityB,
          other: entityA,
          point: contact.point?.clone() ?? null,
          normal: contact.normal?.clone().negate() ?? null,
        },
      );
    }
    return events;
  }
}

/** True when a shape is large enough and finite, so the solver can work with it. */
function isUsableShape(
  extentX: number,
  extentY: number,
  offsetX: number,
  offsetY: number,
): boolean {
  return (
    extentX >= MIN_SHAPE_EXTENT &&
    extentY >= MIN_SHAPE_EXTENT &&
    Number.isFinite(extentX + extentY + offsetX + offsetY)
  );
}

/** Material values must be finite and non-negative for the solver to stay stable. */
function sanitizeMaterial(value: number): number {
  return Number.isFinite(value) && value > 0 ? value : 0;
}

/** The fixture material stored by `updateColliderValues`. */
function getMaterial(state: ColliderState): {
  density: number;
  friction: number;
  restitution: number;
  isSensor: boolean;
} {
  const values = state.values;
  return {
    density: values[4]!,
    friction: values[5]!,
    restitution: values[6]!,
    isSensor: values[7] === 1,
  };
}

function needsBody(entity: Entity): boolean {
  return BODY_COMPONENTS.some((type) => entity.hasComponent(type));
}

function getContactKind(contact: PendingContact): ContactEventKind {
  if (contact.sensor) {
    return contact.begin ? 'triggerEnter' : 'triggerExit';
  }
  return contact.begin ? 'collisionEnter' : 'collisionExit';
}

/** The physics functions available to scripts as `this.physics`. */
export class Physics2D {
  constructor(private readonly system: PhysicsSystem) {}

  /** World gravity in units per second squared. Assign a new vector to change it. */
  get gravity(): Vec2 {
    return this.system.getGravity();
  }

  set gravity(value: Readonly<Vec2>) {
    this.system.setGravity(value);
  }

  /** True when the entity has a rigidbody or collider. */
  hasBody(entity: Entity): boolean {
    return this.system.hasBody(entity);
  }

  getVelocity(entity: Entity): Vec2 {
    return this.system.getLinearVelocity(entity);
  }

  setVelocity(entity: Entity, velocity: Readonly<Vec2>): void {
    this.system.setLinearVelocity(entity, velocity);
  }

  /** Angular velocity in radians per second, counter-clockwise. */
  getAngularVelocity(entity: Entity): number {
    return this.system.getAngularVelocity(entity);
  }

  setAngularVelocity(entity: Entity, radiansPerSecond: number): void {
    this.system.setAngularVelocity(entity, radiansPerSecond);
  }

  /** Applies a continuous force. Call it every fixed update while the force acts. */
  applyForce(entity: Entity, force: Readonly<Vec2>): void {
    this.system.applyForce(entity, force);
  }

  /** Applies an instant push, for example a jump. */
  applyImpulse(entity: Entity, impulse: Readonly<Vec2>): void {
    this.system.applyImpulse(entity, impulse);
  }

  applyTorque(entity: Entity, torque: number): void {
    this.system.applyTorque(entity, torque);
  }

  getMass(entity: Entity): number {
    return this.system.getMass(entity);
  }

  /** Finds the closest solid collider along a ray, or `null` when nothing is hit. */
  raycast(
    origin: Readonly<Vec2>,
    direction: Readonly<Vec2>,
    maxDistance?: number,
  ): RaycastHit | null {
    return this.system.raycast(origin, direction, maxDistance);
  }

  /** Every entity with a collider that contains the point. */
  overlapPoint(point: Readonly<Vec2>): Entity[] {
    return this.system.overlapPoint(point);
  }
}
