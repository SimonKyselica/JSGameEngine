import {
  Behaviour,
  BoxCollider2D,
  Rigidbody2D,
  Vec2,
  type Collision,
  type Entity,
  type ScriptLifecycle,
} from 'rowan';
import { harnessOf } from './support';
import type TestHarness from './TestHarness';

/**
 * Exercises rigid bodies, box colliders and the physics API.
 *
 * Expects to sit on "Crate", a dynamic 1x1 box at (-6, 0) above the static "Ground".
 * It also drives "Floater" (dynamic, no gravity), "Platform" (kinematic) and "Wall"
 * (a static 1x1 box at (9, 0)), and inspects "Launched", which has an initial velocity. Everything runs in fixed updates, so the sequence is
 * the same on every machine.
 */
export default class PhysicsProbe extends Behaviour implements ScriptLifecycle {
  private test!: TestHarness;
  private floater!: Entity;
  private platform!: Entity;
  private wall!: Entity;
  private step = 0;
  private jumped = false;
  private platformY = 0;
  private floaterY = 0;

  onStart(): void {
    const { physics, entity } = this;
    this.test = harnessOf(this);
    const test = this.test;
    this.floater = this.find('Floater');
    this.platform = this.find('Platform');
    this.wall = this.find('Wall');

    const body = this.requireComponent(Rigidbody2D);
    test.check(
      'Rigidbody2D defaults',
      body.bodyType === 'dynamic' &&
        body.gravityScale === 1 &&
        body.linearDamping === 0 &&
        body.angularDamping === 0.05 &&
        !body.fixedRotation &&
        !body.continuous,
    );
    const collider = this.requireComponent(BoxCollider2D);
    test.check(
      'BoxCollider2D defaults',
      collider.offset.equals(Vec2.zero()) &&
        collider.size.equals(Vec2.one()) &&
        collider.density === 1 &&
        collider.friction === 0.4 &&
        collider.restitution === 0 &&
        !collider.isTrigger,
    );

    test.check(
      'Physics2D.hasBody',
      physics.hasBody(entity) && !physics.hasBody(this.find('Main Camera')),
    );
    test.near('Physics2D.getMass', physics.getMass(entity), 1);
    test.check('Physics2D.gravity', physics.gravity.equals(new Vec2(0, -9.81)));

    const hit = physics.raycast(new Vec2(-6, 5), new Vec2(0, -1));
    test.check('Physics2D.raycast finds the closest collider', hit?.entity === entity);
    test.near('RaycastHit.distance', hit?.distance ?? 0, 4.5, 0.01);
    test.check(
      'RaycastHit.point and normal',
      hit !== null &&
        hit.point.equals(new Vec2(-6, 0.5), 0.01) &&
        hit.normal.equals(Vec2.up(), 0.01),
    );
    test.check(
      'Physics2D.raycast respects the maximum distance',
      physics.raycast(new Vec2(-6, 5), new Vec2(0, -1), 2) === null,
    );
    test.check(
      'Physics2D.overlapPoint',
      physics.overlapPoint(new Vec2(-6, 0)).includes(entity) &&
        physics.overlapPoint(new Vec2(9, 1.5)).length === 0,
    );

    // Straight down from above the crate: the crate first, then the ground beneath it.
    const hits = physics.raycastAll(new Vec2(-6, 5), new Vec2(0, -1));
    test.check(
      'Physics2D.raycastAll reports every collider, nearest first',
      hits.length === 2 &&
        hits[0]?.entity === entity &&
        hits[1]?.entity.name === 'Ground' &&
        hits[0].distance < hits[1].distance,
    );
    const nearby = physics.overlapCircle(new Vec2(-6, 0), 1);
    test.check(
      'Physics2D.overlapCircle finds the colliders within reach',
      nearby.length === 1 &&
        nearby[0] === entity &&
        physics.overlapCircle(new Vec2(-6, 0), 3).length === 2 &&
        physics.overlapCircle(new Vec2(-6, 3), 1).length === 0,
    );

    test.check(
      'a Rigidbody2D starts at rest by default',
      body.initialVelocity.equals(Vec2.zero()) && body.initialAngularVelocity === 0,
    );
    const launched = this.find('Launched');
    const launchedBody = launched.requireComponent(Rigidbody2D);
    test.check(
      'Rigidbody2D.initialVelocity starts a body moving',
      launchedBody.initialVelocity.equals(new Vec2(0, 2)) &&
        physics.getVelocity(launched).equals(new Vec2(0, 2)),
    );
    test.check(
      'Rigidbody2D.initialAngularVelocity starts a body spinning',
      launchedBody.initialAngularVelocity === 1 && physics.getAngularVelocity(launched) === 1,
    );

    test.expectLater('onCollisionEnter reports the other entity and the contact');
    test.expectLater('onCollisionExit reports the other entity');
    test.expectLater('the physics sequence finished');
  }

  onCollisionEnter(collision: Collision): void {
    if (this.jumped || collision.other.name !== 'Ground') {
      return;
    }
    this.jumped = true;
    // The ground is below the crate, so the normal points down and the contact is on its top.
    this.test.check('Collision.normal points at the other entity', collision.normal.y < -0.9);
    this.test.near('Collision.point', collision.point.y, -2.5, 0.05);
    this.test.pass('onCollisionEnter reports the other entity and the contact');
    this.physics.applyImpulse(this.entity, new Vec2(0, 6));
    this.test.near(
      'Physics2D.applyImpulse changes velocity at once',
      this.physics.getVelocity(this.entity).y,
      6,
      0.5,
    );
  }

  onCollisionExit(other: Entity): void {
    if (other.name === 'Ground') {
      this.test.pass('onCollisionExit reports the other entity');
    }
  }

  onFixedUpdate(): void {
    const { physics, test, floater, platform } = this;
    const step = this.step++;
    const floaterBody = floater.requireComponent(Rigidbody2D);

    if (step < 30) {
      physics.applyForce(floater, new Vec2(2, 0));
    } else if (step === 30) {
      // A force of 2 on a mass of 1 for half a second.
      test.near('Physics2D.applyForce accelerates a body', physics.getVelocity(floater).x, 1, 0.1);
      physics.setVelocity(floater, Vec2.zero());
      test.check(
        'Physics2D.setVelocity and getVelocity',
        physics.getVelocity(floater).length() === 0,
      );
      physics.setAngularVelocity(floater, 2);
      test.check(
        'Physics2D.setAngularVelocity and getAngularVelocity',
        physics.getAngularVelocity(floater) === 2,
      );
      physics.setAngularVelocity(floater, 0);
    } else if (step < 40) {
      physics.applyTorque(floater, 5);
    } else if (step === 40) {
      test.check('Physics2D.applyTorque spins a body', physics.getAngularVelocity(floater) > 1);
      physics.setAngularVelocity(floater, 0);
      floaterBody.fixedRotation = true;
    } else if (step < 50) {
      physics.applyTorque(floater, 5);
    } else if (step === 50) {
      test.check(
        'Rigidbody2D.fixedRotation blocks rotation',
        physics.getAngularVelocity(floater) === 0,
      );
      floaterBody.linearDamping = 8;
      floaterBody.angularDamping = 1;
      floaterBody.continuous = true;
      physics.setVelocity(floater, new Vec2(4, 0));
    } else if (step === 80) {
      test.check('Rigidbody2D.linearDamping slows a body', physics.getVelocity(floater).x < 1);
      this.platformY = platform.transform.position.y;
      physics.setVelocity(platform, new Vec2(0, 1));
    } else if (step === 110) {
      const platformBody = platform.requireComponent(Rigidbody2D);
      test.check('Rigidbody2D.bodyType kinematic', platformBody.bodyType === 'kinematic');
      test.near(
        'a kinematic body moves at its velocity',
        platform.transform.position.y - this.platformY,
        0.5,
        0.05,
      );
      platformBody.bodyType = 'static';
      this.platformY = platform.transform.position.y;

      floaterBody.gravityScale = 1;
      this.floaterY = floater.transform.position.y;
      physics.gravity = new Vec2(0, -5);
      test.check('Physics2D.gravity can be changed', physics.gravity.equals(new Vec2(0, -5)));
      this.wall.requireComponent(BoxCollider2D).size.set(1, 4);
    } else if (step === 130) {
      test.check(
        'a body switched to static stops',
        platform.transform.position.y === this.platformY,
      );
      test.check('Rigidbody2D.gravityScale', floater.transform.position.y < this.floaterY);
      test.check(
        'a resized collider is picked up',
        physics.overlapPoint(new Vec2(9, 1.5)).includes(this.wall),
      );
      physics.gravity = new Vec2(0, -9.81);
      test.pass('the physics sequence finished');
    }
  }

  private find(name: string): Entity {
    const entity = this.scene.findByName(name);
    if (!entity) {
      throw new Error(`PhysicsProbe needs an entity called "${name}"`);
    }
    return entity;
  }
}
