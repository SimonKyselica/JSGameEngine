import { describe, expect, it } from 'vitest';
import { AssetDatabase } from '../assets/assetDatabase';
import { Color } from '../math/color';
import { Vec2 } from '../math/vec2';
import { CameraView } from '../renderer/cameraView';
import { decodeImageHeadless } from '../renderer/imageDecoder';
import { HeadlessRenderer } from '../renderer/renderer2d';
import { SceneRenderer } from '../renderer/sceneRenderer';
import { HeadlessTextRasterizer } from '../renderer/textLayout';
import { TextureCache } from '../renderer/textureCache';
import {
  Camera,
  MAX_PARTICLES,
  ParticleEmitter,
  ParticleState,
  ScreenAnchor,
  SpriteRenderer,
} from '../scene/components';
import type { Entity } from '../scene/entity';
import { Scene } from '../scene/scene';
import { createTestProject, startTestGame } from '../testing/fixtures';
import { ParticleSystem } from './particleSystem';

interface World {
  scene: Scene;
  system: ParticleSystem;
  entity: Entity;
  emitter: ParticleEmitter;
  /** The particles that are alive, as [x, y] pairs rounded to thousandths. */
  positions(): number[][];
  state(): ParticleState;
}

/** An emitter at (10, 0) that sends particles straight up at 2 units per second. */
function createWorld(fields: Partial<ParticleEmitter> = {}): World {
  const scene = new Scene();
  const system = new ParticleSystem(scene);
  system.start();
  const entity = scene.createEntity('Emitter');
  entity.transform.position.set(10, 0);
  const emitter = entity.addComponent(ParticleEmitter, {
    rate: 10,
    lifetime: 1,
    speed: 2,
    spread: 0,
    ...fields,
  });
  const state = (): ParticleState => entity.requireComponent(ParticleState);
  return {
    scene,
    system,
    entity,
    emitter,
    state,
    positions() {
      const particles = state();
      return Array.from({ length: particles.count }, (_, index) => [
        Math.round(particles.x[index]! * 1000) / 1000,
        Math.round(particles.y[index]! * 1000) / 1000,
      ]);
    },
  };
}

describe('ParticleSystem', () => {
  it('sends out particles at the rate of the emitter, at the place of its entity', () => {
    const { system, emitter, positions } = createWorld();
    system.update(0.1);
    expect(positions()).toEqual([[10, 0]]);
    expect(emitter.particleCount).toBe(1);

    system.update(0.25);
    // The first has flown for a quarter of a second. Two and a half more were due during
    // that time, a tenth of a second apart, and each is as far along as if it had left then.
    expect(positions()).toEqual([
      [10, 0.5],
      [10, 0.3],
      [10, 0.1],
    ]);
    // The half that was left over is owed, and comes out with the next half.
    system.update(0.05);
    expect(emitter.particleCount).toBe(4);
  });

  it('spaces the particles of a stream evenly, whatever the frame rate is', () => {
    // One second in frames of a 32nd and of a 128th: fractions a float holds exactly.
    const run = (frames: number): number[][] => {
      const { system, positions } = createWorld({ rate: 40, lifetime: 10 });
      for (let frame = 0; frame < frames; frame++) {
        system.update(1 / frames);
      }
      return positions();
    };
    const slow = run(32);
    expect(slow).toHaveLength(40);
    // A particle every 40th of a second at 2 units per second: 0.05 units apart.
    expect(slow.slice(0, 3)).toEqual([
      [10, 1.95],
      [10, 1.9],
      [10, 1.85],
    ]);
    expect(slow[39]).toEqual([10, 0]);
    expect(run(128)).toEqual(slow);
  });

  it('leaves out a particle that would have come and gone within the frame', () => {
    const { system, emitter } = createWorld({ lifetime: 0.02 });
    // Two were due, 0.15 and 0.05 seconds before the end of the frame: both are over.
    system.update(0.25);
    expect(emitter.particleCount).toBe(0);
    // The one that is due at the very end of this frame is there to be seen.
    system.update(0.05);
    expect(emitter.particleCount).toBe(1);
  });

  it('removes particles when their lifetime is over', () => {
    const { system, emitter } = createWorld({ lifetime: 0.3 });
    system.update(0.1);
    system.update(0.1);
    system.update(0.1);
    expect(emitter.particleCount).toBe(3);
    system.update(0.1);
    // The first one is 0.3 seconds old now, and a new one took its place.
    expect(emitter.particleCount).toBe(3);

    emitter.emitting = false;
    system.update(0.2);
    expect(emitter.particleCount).toBe(1);
    system.update(0.2);
    expect(emitter.particleCount).toBe(0);
  });

  it('sends a burst out at once, even while the emitter is not emitting', () => {
    const { system, emitter } = createWorld({ emitting: false });
    system.update(0.1);
    expect(emitter.particleCount).toBe(0);
    emitter.burst(5);
    emitter.burst(2.9);
    emitter.burst(-4);
    emitter.burst(Number.NaN);
    system.update(0.1);
    expect(emitter.particleCount).toBe(7);
    system.update(0.1);
    expect(emitter.particleCount).toBe(7);
  });

  it('never has more particles alive than the emitter allows', () => {
    const { system, emitter, state } = createWorld({ maxParticles: 4, rate: 100 });
    system.update(0.1);
    system.update(0.1);
    expect(emitter.particleCount).toBe(4);
    emitter.burst(50);
    system.update(0.1);
    expect(emitter.particleCount).toBe(4);

    // Fewer are allowed: the ones that no longer fit are dropped. More: the rest stay.
    emitter.maxParticles = 2;
    emitter.emitting = false;
    system.update(0.01);
    expect(emitter.particleCount).toBe(2);
    emitter.maxParticles = 1e9;
    system.update(0.01);
    expect(emitter.particleCount).toBe(2);
    expect(state().x.length).toBe(MAX_PARTICLES);
  });

  it('fans the particles out around the direction of the emitter', () => {
    const { system, state, emitter } = createWorld({
      rate: 200,
      direction: 0,
      spread: Math.PI / 2,
      speed: 1,
    });
    system.update(0.25);
    const particles = state();
    const angles = Array.from({ length: particles.count }, (_, index) =>
      Math.atan2(particles.velocityY[index]!, particles.velocityX[index]!),
    );
    expect(angles).toHaveLength(50);
    expect(Math.min(...angles)).toBeGreaterThanOrEqual(-Math.PI / 4);
    expect(Math.max(...angles)).toBeLessThanOrEqual(Math.PI / 4);
    // They really do fan out, on both sides of the direction.
    expect(Math.min(...angles)).toBeLessThan(-0.5);
    expect(Math.max(...angles)).toBeGreaterThan(0.5);
    expect(emitter.particleCount).toBe(50);
  });

  it('sends particles the way the entity is turned, and leaves them behind when it moves', () => {
    const { system, entity, positions } = createWorld({ direction: 0, rate: 10 });
    entity.transform.rotation = Math.PI;
    system.update(0.1);
    entity.transform.position.set(50, 50);
    system.update(0.5);
    // Sent out to the left from (10, 0); the entity has moved on, the particle has not.
    expect(positions()[0]).toEqual([9, 0]);
  });

  it('pulls particles along with the gravity of the emitter', () => {
    const { system, positions, emitter } = createWorld({ gravity: new Vec2(4, -10) });
    system.update(0.1);
    emitter.emitting = false;
    system.update(0.5);
    // After half a second: velocity (2, -3), having started at (0, 2).
    expect(positions()).toEqual([[11, -1.5]]);
  });

  it('lets gravity act on a particle from the moment it was due', () => {
    const { system, state } = createWorld({ gravity: new Vec2(0, -10) });
    system.update(0.25);
    // Due 0.15 and 0.05 seconds before the end of the frame, at 2 units per second upwards:
    // 2t - 5t² is how high each has got, and 2 - 10t how fast it still rises.
    const particles = state();
    expect(particles.count).toBe(2);
    expect(particles.y[0]).toBeCloseTo(0.1875, 5);
    expect(particles.y[1]).toBeCloseTo(0.0875, 5);
    expect(particles.velocityY[0]).toBeCloseTo(0.5, 5);
    expect(particles.velocityY[1]).toBeCloseTo(1.5, 5);
    expect(particles.age[0]).toBeCloseTo(0.15, 5);
  });

  it('plays the same every time, and differently for different emitters', () => {
    const run = (extraEntities: number): number[][] => {
      const { scene, system, positions } = createWorld({ spread: Math.PI, rate: 50 });
      for (let index = 0; index < extraEntities; index++) {
        scene.createEntity('Other');
      }
      system.update(0.2);
      system.update(0.2);
      return positions();
    };
    expect(run(0)).toEqual(run(0));

    const scene = new Scene();
    const system = new ParticleSystem(scene);
    const emitters = [0, 1].map(() =>
      scene.createEntity('Emitter').addComponent(ParticleEmitter, { spread: Math.PI, rate: 50 }),
    );
    system.update(0.2);
    const [first, second] = scene.rootEntities.map((entity) =>
      entity.requireComponent(ParticleState),
    );
    expect(emitters[0]!.particleCount).toBe(10);
    expect([...first!.velocityX.subarray(0, 10)]).not.toEqual([
      ...second!.velocityX.subarray(0, 10),
    ]);
  });

  it('freezes the particles of an inactive entity and of a frame without time', () => {
    const { system, entity, positions } = createWorld();
    system.update(0.1);
    system.update(0);
    expect(positions()).toEqual([[10, 0]]);
    entity.active = false;
    system.update(0.5);
    expect(positions()).toEqual([[10, 0]]);
  });

  it('copes with values a script got wrong', () => {
    const { system, emitter } = createWorld({
      lifetime: Number.NaN,
      speed: Number.NaN,
      direction: Number.NaN,
      spread: Number.NaN,
      gravity: new Vec2(Number.NaN, Infinity),
      maxParticles: Number.NaN,
    });
    emitter.burst(5);
    expect(() => system.update(0.1)).not.toThrow();
    expect(emitter.particleCount).toBe(0);

    emitter.maxParticles = 10;
    emitter.lifetime = 1;
    emitter.rate = Number.NaN;
    emitter.burst(3);
    system.update(0.1);
    system.update(0.1);
    expect(emitter.particleCount).toBe(3);

    // A rate without a meaning sends nothing out, and leaves nothing behind that would
    // keep the emitter from working once the rate is a number again.
    emitter.rate = Infinity;
    system.update(0.1);
    expect(emitter.particleCount).toBe(3);
    emitter.rate = 10;
    system.update(0.1);
    expect(emitter.particleCount).toBe(4);
  });

  it('takes the particles away with the emitter, and with the scene', () => {
    const { scene, system, entity } = createWorld();
    system.update(0.1);
    entity.removeComponent(ParticleEmitter);
    expect(entity.hasComponent(ParticleState)).toBe(false);

    const again = entity.addComponent(ParticleEmitter, { rate: 10 });
    system.update(0.1);
    expect(again.particleCount).toBe(1);
    system.stop();
    expect(scene.registry.count(ParticleState)).toBe(0);
    expect(again.particleCount).toBe(0);
  });

  it('keeps the particles of an emitter under a screen anchor on the screen, in pixels', () => {
    const { scene, system, entity, emitter, positions, state } = createWorld({ speed: 200 });
    // A camera that shows the 720 pixels of the screen's height as 7.2 units, turned a
    // quarter: the screen does not care where in the world it is.
    const camera = scene.createEntity('Camera');
    camera.addComponent(Camera, { orthographicSize: 3.6 });
    camera.transform.position.set(40, 30);
    camera.transform.rotation = Math.PI / 2;
    entity.addComponent(ScreenAnchor, { horizontal: 'left', vertical: 'bottom' });
    entity.transform.position.set(100, 50);

    system.update(0.1);
    expect(state().onScreen).toBe(true);
    // 100 pixels from the left and 50 from the bottom, counted from the middle of 1280x720.
    expect(positions()).toEqual([[-540, -310]]);
    emitter.emitting = false;
    camera.transform.position.set(-7, 2);
    system.update(0.5);
    // "Up" is up on the screen, and the speed is in pixels per second.
    expect(positions()).toEqual([[-540, -210]]);

    // An emitter that goes back into the world starts afresh: pixels are not world units.
    entity.removeComponent(ScreenAnchor);
    system.update(0.1);
    expect(state().onScreen).toBe(false);
    expect(emitter.particleCount).toBe(0);
  });
});

describe('particles in a game', () => {
  it('advance with game time, after the scripts have been updated', async () => {
    const project = createTestProject((scene) => {
      scene.createEntity('Emitter').addComponent(ParticleEmitter, { rate: 60, lifetime: 10 });
    });
    const game = await startTestGame(project);
    const emitter = game.game.scene.findByName('Emitter')!.requireComponent(ParticleEmitter);
    game.step(30);
    expect(emitter.particleCount).toBe(30);

    game.game.time.timeScale = 0;
    game.step(30);
    expect(emitter.particleCount).toBe(30);
    game.game.stop();
    expect(emitter.particleCount).toBe(0);
  });
});

describe('drawing particles', () => {
  function createSetup(fields: Partial<ParticleEmitter>): {
    scene: Scene;
    system: ParticleSystem;
    renderer: HeadlessRenderer;
    sceneRenderer: SceneRenderer;
    emitter: ParticleEmitter;
    draw: () => void;
  } {
    const assets = new AssetDatabase();
    const renderer = new HeadlessRenderer(200, 100);
    const textures = new TextureCache(renderer, assets, decodeImageHeadless, 'linear');
    const sceneRenderer = new SceneRenderer(
      renderer,
      textures,
      assets,
      new HeadlessTextRasterizer(),
    );
    const scene = new Scene();
    const system = new ParticleSystem(scene);
    const emitter = scene.createEntity('Emitter').addComponent(ParticleEmitter, {
      emitting: false,
      spread: 0,
      speed: 2,
      lifetime: 1,
      ...fields,
    });
    const view = new CameraView(new Vec2(), 0, 5, 2);
    return {
      scene,
      system,
      renderer,
      sceneRenderer,
      emitter,
      draw: () => sceneRenderer.render(scene, view, Color.black()),
    };
  }

  it('draws a quad for every particle, changing size and color over its life', () => {
    const { system, renderer, emitter, draw } = createSetup({
      startSize: 1,
      endSize: 0.5,
      startColor: new Color(1, 0, 0, 1),
      endColor: new Color(0, 0, 1, 0.5),
      sortingOrder: 4,
    });
    emitter.burst(1);
    system.update(0.1);
    draw();
    let quad = renderer.quads[0]!;
    expect(quad.transform.getScale().toArray()).toEqual([1, 1]);
    expect(quad.color.toArray()).toEqual([1, 0, 0, 1]);
    expect(quad.texture).toBeNull();

    // Halfway through its life: halfway between the two sizes and colors, one unit up.
    system.update(0.5);
    draw();
    quad = renderer.quads[0]!;
    expect(quad.transform.getScale().toArray()).toEqual([0.75, 0.75]);
    // "Up" is a quarter turn, whose cosine is not quite 0 in floating point.
    expect(quad.transform.getTranslation().x).toBeCloseTo(0);
    expect(quad.transform.getTranslation().y).toBeCloseTo(1);
    expect(quad.color.toArray()).toEqual([0.5, 0, 0.5, 0.75]);
  });

  it('skips particles that are out of sight, without a size or fully transparent', () => {
    const { scene, system, renderer, sceneRenderer, emitter, draw } = createSetup({
      startSize: 0.5,
      endSize: 0.5,
      endColor: Color.white(),
      lifetime: 10,
      speed: 4,
    });
    emitter.burst(1);
    system.update(0.1);
    draw();
    expect(renderer.quads).toHaveLength(1);

    // Two seconds later the particle is 8 units up, above a view that ends at 5.
    for (let step = 0; step < 8; step++) {
      system.update(0.25);
    }
    draw();
    expect(renderer.quads).toHaveLength(0);
    expect(sceneRenderer.stats.culled).toBe(1);

    const faded = scene.createEntity('Faded').addComponent(ParticleEmitter, {
      emitting: false,
      startColor: new Color(1, 1, 1, 0),
      endColor: new Color(1, 1, 1, 0),
    });
    const sizeless = scene.createEntity('Sizeless').addComponent(ParticleEmitter, {
      emitting: false,
      startSize: Number.NaN,
    });
    faded.burst(3);
    sizeless.burst(3);
    system.update(0.01);
    draw();
    expect(renderer.quads).toHaveLength(0);
  });

  it('sorts particles with everything else, and hides them with their entity', () => {
    const { scene, system, renderer, emitter, draw } = createSetup({
      startSize: 1,
      endSize: 1,
      sortingOrder: 4,
    });
    const red = new Color(1, 0, 0, 1);
    const blue = new Color(0, 0, 1, 1);
    scene.createEntity('Above').addComponent(SpriteRenderer, { color: red, sortingOrder: 5 });
    scene.createEntity('Below').addComponent(SpriteRenderer, { color: blue, sortingOrder: 3 });
    emitter.burst(2);
    system.update(0.01);
    draw();
    expect(renderer.quads.map((quad) => quad.color.toHex())).toEqual([
      '#0000ff',
      '#ffffff',
      '#ffffff',
      '#ff0000',
    ]);
    scene.findByName('Emitter')!.active = false;
    draw();
    expect(renderer.quads).toHaveLength(2);
  });

  it('draws the particles of an emitter on the screen over the world, where the camera looks', () => {
    const { scene, system, renderer, emitter, draw } = createSetup({
      startSize: 20,
      endSize: 20,
      speed: 100,
      sortingOrder: -1,
    });
    // 720 pixels of screen on 7.2 units: a pixel is a hundredth of a unit.
    const camera = scene.createEntity('Camera');
    camera.addComponent(Camera, { orthographicSize: 3.6 });
    camera.transform.position.set(1, 1);
    const entity = scene.findByName('Emitter')!;
    entity.addComponent(ScreenAnchor);
    entity.transform.position.set(50, -100);
    scene.createEntity('World').addComponent(SpriteRenderer, { sortingOrder: 9 });

    emitter.burst(1);
    system.update(0.1);
    system.update(0.5);
    draw();
    // What is on the screen comes after the world, whatever its sorting order is.
    const quad = renderer.quads[1]!;
    expect(renderer.quads).toHaveLength(2);
    // (50, -100) and 50 pixels up from there, seen from a camera at (1, 1).
    expect(quad.transform.getTranslation().x).toBeCloseTo(1.5);
    expect(quad.transform.getTranslation().y).toBeCloseTo(0.5);
    expect(quad.transform.getScale().x).toBeCloseTo(0.2);

    // The particle stays where it is on the screen when the camera moves on.
    camera.transform.position.set(-2, 0);
    draw();
    expect(renderer.quads[1]!.transform.getTranslation().x).toBeCloseTo(-1.5);
    expect(renderer.quads[1]!.transform.getTranslation().y).toBeCloseTo(-0.5);
  });
});
