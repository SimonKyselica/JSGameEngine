import type { Unsubscribe } from '../core/signal';
import { MAX_PARTICLES, ParticleEmitter, ParticleState } from '../scene/components';
import type { Entity } from '../scene/entity';
import type { Scene } from '../scene/scene';
import { Mat3 } from '../math/mat3';
import { Vec2 } from '../math/vec2';

/** How many particles an emitter may have alive: a whole number from 0 to the engine's limit. */
function getCapacity(emitter: Readonly<ParticleEmitter>): number {
  const wanted = emitter.maxParticles;
  return Number.isFinite(wanted) ? Math.min(Math.max(0, Math.floor(wanted)), MAX_PARTICLES) : 0;
}

/** Gives the state room for `capacity` particles, keeping those that are alive and fit. */
function resize(state: ParticleState, capacity: number): void {
  const grow = (values: Float32Array): Float32Array<ArrayBuffer> => {
    const next = new Float32Array(capacity);
    next.set(values.subarray(0, Math.min(state.count, capacity)));
    return next;
  };
  state.x = grow(state.x);
  state.y = grow(state.y);
  state.velocityX = grow(state.velocityX);
  state.velocityY = grow(state.velocityY);
  state.age = grow(state.age);
  state.lifetime = grow(state.lifetime);
  state.count = Math.min(state.count, capacity);
}

/**
 * The next of an emitter's random numbers, from 0 up to but not including 1. Every emitter
 * has a sequence of its own that starts from its entity, so a game looks the same each time
 * it is played, which is what lets tests assert on it.
 */
function nextRandom(state: ParticleState): number {
  state.seed = (Math.imul(state.seed, 1664525) + 1013904223) >>> 0;
  return state.seed / 0x100000000;
}

/**
 * Simulates the particles of every `ParticleEmitter`: sends new ones out, moves the ones
 * that are alive, and removes the ones whose time is up.
 */
export class ParticleSystem {
  private readonly subscriptions: Unsubscribe[] = [];
  private readonly origin = new Vec2();
  private readonly world = new Mat3();
  private readonly toScreen = new Mat3();

  constructor(private readonly scene: Scene) {}

  start(): void {
    this.subscriptions.push(
      this.scene.registry.onComponentRemoved.connect(({ entity, type }) => {
        // An emitter that is removed takes its particles with it.
        if (type === ParticleEmitter && this.scene.registry.isAlive(entity)) {
          this.scene.registry.remove(entity, ParticleState);
        }
      }),
    );
  }

  /** Removes every particle. Called when the scene stops. */
  stop(): void {
    for (const unsubscribe of this.subscriptions.splice(0)) {
      unsubscribe();
    }
    const { registry } = this.scene;
    for (const [id, emitter] of [...registry.view(ParticleEmitter)]) {
      registry.remove(id, ParticleState);
      emitter._setParticleCount(0);
    }
  }

  /** Advances the particles by `deltaTime` seconds of game time. */
  update(deltaTime: number): void {
    const { scene } = this;
    const { registry } = scene;
    for (const [id, emitter] of registry.view(ParticleEmitter)) {
      const entity = scene.getEntity(id);
      if (!entity.activeInHierarchy) {
        continue;
      }
      let state = registry.get(id, ParticleState);
      if (!state) {
        state = registry.add(id, ParticleState, new ParticleState());
        // Never 0, which would be the one seed this kind of sequence cannot leave.
        state.seed = id + 1;
      }
      const onScreen = scene.isOnScreen(entity);
      if (state.onScreen !== onScreen) {
        // The particles were placed in the units of the other space and cannot come along.
        state.onScreen = onScreen;
        state.count = 0;
      }
      const capacity = getCapacity(emitter);
      if (state.x.length !== capacity) {
        resize(state, capacity);
      }
      if (deltaTime > 0) {
        this.advance(state, emitter, deltaTime);
      }
      this.emit(state, emitter, entity, deltaTime);
      emitter._setParticleCount(state.count);
    }
  }

  /** Moves the living particles and drops the ones that have reached the end of their life. */
  private advance(
    state: ParticleState,
    emitter: Readonly<ParticleEmitter>,
    deltaTime: number,
  ): void {
    const { x, y, velocityX, velocityY, age, lifetime } = state;
    const gravityX = Number.isFinite(emitter.gravity.x) ? emitter.gravity.x : 0;
    const gravityY = Number.isFinite(emitter.gravity.y) ? emitter.gravity.y : 0;
    let index = 0;
    while (index < state.count) {
      age[index]! += deltaTime;
      if (age[index]! >= lifetime[index]!) {
        // The last particle takes the place of the dead one; the order does not matter.
        const last = --state.count;
        x[index] = x[last]!;
        y[index] = y[last]!;
        velocityX[index] = velocityX[last]!;
        velocityY[index] = velocityY[last]!;
        age[index] = age[last]!;
        lifetime[index] = lifetime[last]!;
        continue;
      }
      velocityX[index]! += gravityX * deltaTime;
      velocityY[index]! += gravityY * deltaTime;
      x[index]! += velocityX[index]! * deltaTime;
      y[index]! += velocityY[index]! * deltaTime;
      index++;
    }
  }

  /** Sends out the particles that are due: those asked for at once, and those of the rate. */
  private emit(
    state: ParticleState,
    emitter: ParticleEmitter,
    entity: Entity,
    deltaTime: number,
  ): void {
    const bursts = emitter._takeBursts();
    const rate = Number.isFinite(emitter.rate) ? emitter.rate : 0;
    let stream = 0;
    if (emitter.emitting && rate > 0 && deltaTime > 0) {
      state.owed += rate * deltaTime;
      stream = Math.floor(state.owed);
      state.owed -= stream;
    }
    const room = state.x.length - state.count;
    const fromBursts = Math.min(bursts, room);
    const sending = fromBursts + Math.min(stream, room - fromBursts);
    // Written so that a lifetime of NaN, which a script can produce, sends nothing out.
    if (sending <= 0 || !(emitter.lifetime > 0)) {
      return;
    }

    const world = this.scene.getWorldMatrix(entity, this.world);
    if (state.onScreen) {
      // The particles of an emitter on the screen live on the screen, in its pixels.
      const toScreen = this.scene.getScreenToWorld(this.toScreen);
      if (toScreen.invert()) {
        world.premultiply(toScreen);
      }
    }
    const origin = world.getTranslation(this.origin);
    const forward =
      world.getRotation() + (Number.isFinite(emitter.direction) ? emitter.direction : 0);
    const spread = Number.isFinite(emitter.spread) ? emitter.spread : 0;
    const speed = Number.isFinite(emitter.speed) ? emitter.speed : 0;
    const gravityX = Number.isFinite(emitter.gravity.x) ? emitter.gravity.x : 0;
    const gravityY = Number.isFinite(emitter.gravity.y) ? emitter.gravity.y : 0;
    for (let sent = 0; sent < sending; sent++) {
      // A burst starts where the emitter is. The particles of the rate were due at even
      // intervals during the frame, the oldest first, and each starts as far along as it
      // would have got by now: a stream is as even at 30 frames a second as it is at 144.
      const headStart = sent < fromBursts ? 0 : (state.owed + (sending - 1 - sent)) / rate;
      if (headStart >= emitter.lifetime) {
        // It would have come and gone within the frame.
        continue;
      }
      const angle = forward + (nextRandom(state) - 0.5) * spread;
      const velocityX = Math.cos(angle) * speed;
      const velocityY = Math.sin(angle) * speed;
      const index = state.count++;
      state.x[index] = origin.x + (velocityX + 0.5 * gravityX * headStart) * headStart;
      state.y[index] = origin.y + (velocityY + 0.5 * gravityY * headStart) * headStart;
      state.velocityX[index] = velocityX + gravityX * headStart;
      state.velocityY[index] = velocityY + gravityY * headStart;
      state.age[index] = headStart;
      state.lifetime[index] = emitter.lifetime;
    }
  }
}
