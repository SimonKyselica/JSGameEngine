import {
  Behaviour,
  BoxCollider2D,
  CircleCollider2D,
  Vec2,
  type Entity,
  type ScriptLifecycle,
} from 'rowan';
import { harnessOf } from './support';
import type TestHarness from './TestHarness';

/**
 * Exercises triggers, circle colliders and restitution.
 *
 * Expects to sit on "Trigger Zone", a trigger box that the dynamic "Ball" falls through
 * before it bounces on a static floor below.
 */
export default class TriggerProbe extends Behaviour implements ScriptLifecycle {
  private test!: TestHarness;
  private ball: Entity | null = null;
  private reachedFloor = false;

  onStart(): void {
    this.test = harnessOf(this);
    const test = this.test;
    this.ball = this.scene.findByName('Ball');

    test.check('BoxCollider2D.isTrigger', this.requireComponent(BoxCollider2D).isTrigger);
    const circle = this.ball?.getComponent(CircleCollider2D);
    test.check(
      'CircleCollider2D fields',
      circle?.radius === 0.25 &&
        circle.restitution === 0.8 &&
        circle.offset.equals(Vec2.zero()) &&
        circle.density === 1 &&
        circle.friction === 0.4 &&
        !circle.isTrigger,
    );
    test.check(
      'a trigger does not block raycasts',
      this.physics.raycast(new Vec2(0, 1), new Vec2(0, -1))?.entity.name === 'Ball Floor',
    );

    test.expectLater('onTriggerEnter reports the entering entity');
    test.expectLater('onTriggerExit reports the leaving entity');
    test.expectLater('restitution makes a body bounce');
  }

  onTriggerEnter(other: Entity): void {
    if (other === this.ball) {
      this.test.pass('onTriggerEnter reports the entering entity');
    }
  }

  onTriggerExit(other: Entity): void {
    if (other === this.ball) {
      this.test.pass('onTriggerExit reports the leaving entity');
    }
  }

  onFixedUpdate(): void {
    if (!this.ball) {
      return;
    }
    if (this.ball.transform.position.y < -2) {
      this.reachedFloor = true;
    }
    if (this.reachedFloor && this.physics.getVelocity(this.ball).y > 2) {
      this.test.pass('restitution makes a body bounce');
    }
  }
}
