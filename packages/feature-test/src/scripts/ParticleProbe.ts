import { Behaviour, Color, ParticleEmitter, Vec2, type ScriptLifecycle } from 'rowan';
import { harnessOf } from './support';
import type TestHarness from './TestHarness';

/**
 * Exercises particles.
 *
 * Expects to sit on an emitter that is not emitting and whose particles live for 0.2
 * seconds. The probe sends out a burst and watches the particles come and go.
 */
export default class ParticleProbe extends Behaviour implements ScriptLifecycle {
  private test!: TestHarness;
  private emitter!: ParticleEmitter;
  private burstAt = -1;

  onStart(): void {
    this.test = harnessOf(this);
    this.emitter = this.requireComponent(ParticleEmitter);
    const { test, emitter } = this;

    test.check(
      'ParticleEmitter fields',
      !emitter.emitting &&
        emitter.rate === 30 &&
        emitter.lifetime === 0.2 &&
        emitter.speed === 3 &&
        emitter.direction === 0 &&
        emitter.spread === 1 &&
        emitter.gravity.equals(new Vec2(0, -4)) &&
        emitter.startSize === 0.3 &&
        emitter.endSize === 0.1 &&
        emitter.startColor.equals(new Color(1, 0.2, 0.8, 1)) &&
        emitter.endColor.equals(new Color(1, 0.2, 0.8, 0)) &&
        emitter.texture === null &&
        emitter.maxParticles === 8 &&
        emitter.sortingOrder === 6,
    );
    test.check(
      'ParticleEmitter.particleCount is 0 before anything is sent out',
      emitter.particleCount === 0,
    );
    test.expectLater('ParticleEmitter.burst sends out that many particles at once');
    test.expectLater('an emitter never has more particles than maxParticles');
    test.expectLater('particles disappear when their lifetime is over');
    emitter.burst(5);
  }

  onLateUpdate(): void {
    const { test, emitter } = this;
    if (this.burstAt === -1) {
      // The burst asked for in onStart comes out with the first frame.
      test.settle(
        'ParticleEmitter.burst sends out that many particles at once',
        emitter.particleCount === 5,
        `${emitter.particleCount} particles`,
      );
      // Twenty more do not fit: eight is all this emitter may have.
      emitter.burst(20);
      this.burstAt = this.time.elapsed;
      return;
    }
    if (this.burstAt === -2) {
      return;
    }
    if (emitter.particleCount === 8) {
      test.pass('an emitter never has more particles than maxParticles');
    }
    // Well after the lifetime of the last burst.
    if (this.time.elapsed - this.burstAt > 0.4) {
      test.settle(
        'particles disappear when their lifetime is over',
        emitter.particleCount === 0,
        `${emitter.particleCount} particles are left`,
      );
      this.burstAt = -2;
    }
  }
}
