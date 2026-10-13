import { describe, expect, it } from 'vitest';
import { SpriteAnimator, SpriteRenderer, type AnimationClip } from '../scene/components';
import type { Entity } from '../scene/entity';
import {
  addScript,
  attachScript,
  createTestProject,
  startTestGame,
  type RunningGame,
} from '../testing/fixtures';
import { getClipDuration, getClipFrame } from './animationSystem';

const WALK: AnimationClip = {
  name: 'walk',
  firstFrame: 4,
  lastFrame: 7,
  framesPerSecond: 10,
  loop: true,
};
const JUMP: AnimationClip = {
  name: 'jump',
  firstFrame: 8,
  lastFrame: 10,
  framesPerSecond: 10,
  loop: false,
};

/** Logs every animation that ends on its entity. */
const LISTENER = `
  import { Behaviour } from 'rowan';
  export default class Listener extends Behaviour {
    onAnimationEnd(clip) { this.log('ended ' + clip); }
  }`;

interface AnimationGame extends RunningGame {
  hero: Entity;
  animator: SpriteAnimator;
  sprite: SpriteRenderer;
  /** Advances the game by a time in seconds, in one frame. */
  advance(seconds: number): void;
}

async function startAnimationGame(fields: Partial<SpriteAnimator> = {}): Promise<AnimationGame> {
  const project = createTestProject((scene, { assets }) => {
    const hero = scene.createEntity('Hero');
    hero.addComponent(SpriteRenderer, { columns: 4, rows: 3 });
    hero.addComponent(SpriteAnimator, {
      clips: [{ ...WALK }, { ...JUMP }],
      clip: 'walk',
      ...fields,
    });
    attachScript(hero, addScript(assets, 'Listener.ts', LISTENER));
  });
  const game = await startTestGame(project);
  const hero = game.game.scene.findByName('Hero')!;
  return {
    ...game,
    hero,
    animator: hero.requireComponent(SpriteAnimator),
    sprite: hero.requireComponent(SpriteRenderer),
    advance: (seconds) => game.game.update(seconds),
  };
}

describe('animation clips', () => {
  it('last as long as their frames take at their speed', () => {
    expect(getClipDuration(WALK)).toBeCloseTo(0.4);
    expect(getClipDuration({ ...WALK, framesPerSecond: 0 })).toBe(Infinity);
    // A clip whose last frame is before its first has that one frame.
    expect(getClipDuration({ ...WALK, lastFrame: 0 })).toBeCloseTo(0.1);
  });

  it('show one frame after another, and start over when they loop', () => {
    const frames = [0, 0.05, 0.1, 0.25, 0.39, 0.4, 0.85].map((time) => getClipFrame(WALK, time));
    expect(frames).toEqual([4, 4, 5, 6, 7, 4, 4]);
  });

  it('stay on their last frame when they do not loop', () => {
    expect([0, 0.15, 0.25, 0.3, 5].map((time) => getClipFrame(JUMP, time))).toEqual([
      8, 9, 10, 10, 10,
    ]);
  });

  it('show their first frame for times and speeds that make no sense', () => {
    expect(getClipFrame(WALK, -1)).toBe(4);
    expect(getClipFrame(WALK, Number.NaN)).toBe(4);
    expect(getClipFrame({ ...WALK, framesPerSecond: Number.NaN }, 1)).toBe(4);
    expect(getClipFrame({ ...WALK, framesPerSecond: -3 }, 1)).toBe(4);
  });
});

describe('AnimationSystem', () => {
  it('moves the sprite through the frames of the clip that plays', async () => {
    const game = await startAnimationGame();
    const seen: number[] = [];
    for (let step = 0; step < 6; step++) {
      game.advance(0.1);
      seen.push(game.sprite.frame);
    }
    // The frame in which a clip starts shows its first frame, however long that frame took.
    expect(seen).toEqual([4, 5, 6, 7, 4, 5]);
    expect(game.animator.time).toBeCloseTo(0.1);
  });

  it('starts another clip from its first frame when a script chooses it', async () => {
    const game = await startAnimationGame();
    game.advance(0);
    game.advance(0.25);
    expect(game.sprite.frame).toBe(6);

    game.animator.clip = 'jump';
    game.advance(0.2);
    expect(game.sprite.frame).toBe(8);
    expect(game.animator.time).toBe(0);
    game.advance(0.1);
    expect(game.sprite.frame).toBe(9);
  });

  it('carries on when the same clip is chosen again, as scripts do every frame', async () => {
    const game = await startAnimationGame();
    game.advance(0);
    for (let step = 0; step < 3; step++) {
      game.animator.clip = 'walk';
      game.advance(0.1);
    }
    expect(game.sprite.frame).toBe(7);
  });

  it('stops a clip that does not loop on its last frame and tells the scripts once', async () => {
    const game = await startAnimationGame({ clip: 'jump' });
    game.advance(0);
    game.advance(0.25);
    expect(game.sprite.frame).toBe(10);
    expect(game.messages()).toEqual([]);

    game.advance(0.1);
    game.advance(0.1);
    game.advance(0.1);
    expect(game.sprite.frame).toBe(10);
    expect(game.animator.time).toBeCloseTo(0.3);
    expect(game.messages()).toEqual(['ended jump']);
  });

  it('plays a finished clip again when its time is set back', async () => {
    const game = await startAnimationGame({ clip: 'jump' });
    game.advance(0);
    // The game never lets a single frame count for more than a quarter of a second.
    game.advance(0.2);
    game.advance(0.2);
    expect(game.messages()).toEqual(['ended jump']);
    game.animator.time = 0;
    game.advance(0.15);
    expect(game.sprite.frame).toBe(9);
    game.advance(0.2);
    expect(game.messages()).toEqual(['ended jump', 'ended jump']);
  });

  it('never tells the scripts that a looping clip has ended', async () => {
    const game = await startAnimationGame();
    game.advance(0);
    for (let step = 0; step < 20; step++) {
      game.advance(0.25);
    }
    expect(game.messages()).toEqual([]);
    // The time stays within one round of the clip.
    expect(game.animator.time).toBeLessThan(0.4);
  });

  it('starts from the time the animator was given in the scene', async () => {
    const game = await startAnimationGame({ time: 0.2 });
    game.advance(0);
    expect(game.sprite.frame).toBe(6);
  });

  it('freezes on its frame while it is not playing', async () => {
    const game = await startAnimationGame({ playing: false, time: 0.1 });
    game.advance(0);
    game.advance(0.25);
    expect(game.sprite.frame).toBe(5);
    game.animator.playing = true;
    game.advance(0.1);
    expect(game.sprite.frame).toBe(6);
  });

  it('plays faster and slower with its speed, and with the speed of game time', async () => {
    const game = await startAnimationGame({ speed: 2 });
    game.advance(0);
    game.advance(0.1);
    expect(game.sprite.frame).toBe(6);

    game.animator.speed = 0;
    game.advance(0.25);
    expect(game.sprite.frame).toBe(6);

    game.animator.speed = 1;
    game.game.time.timeScale = 0.5;
    game.advance(0.2);
    expect(game.sprite.frame).toBe(7);
    game.game.time.timeScale = 0;
    game.advance(0.25);
    expect(game.sprite.frame).toBe(7);
  });

  it('leaves the sprite alone when no clip has the chosen name', async () => {
    const game = await startAnimationGame({ clip: 'swim' });
    game.sprite.frame = 3;
    game.advance(0);
    game.advance(0.25);
    expect(game.sprite.frame).toBe(3);

    game.animator.clip = '';
    game.advance(0.25);
    expect(game.sprite.frame).toBe(3);
  });

  it('skips animators on inactive entities and without a sprite', async () => {
    const game = await startAnimationGame();
    game.advance(0);
    game.hero.active = false;
    game.advance(0.25);
    expect(game.sprite.frame).toBe(4);

    game.hero.active = true;
    game.hero.removeComponent(SpriteRenderer);
    expect(() => game.advance(0.25)).not.toThrow();
  });

  it('copes with values a script got wrong', async () => {
    const game = await startAnimationGame();
    game.advance(0);
    game.animator.time = Number.NaN;
    game.animator.speed = Number.NaN;
    game.advance(0.1);
    expect(game.sprite.frame).toBe(4);
    expect(game.animator.time).toBe(0);

    game.animator.clips[0]!.framesPerSecond = 0;
    game.animator.speed = 1;
    game.advance(0.25);
    expect(game.sprite.frame).toBe(4);
  });

  it('lets a script react to the end of one animation by choosing the next', async () => {
    const project = createTestProject((scene, { assets }) => {
      const hero = scene.createEntity('Hero');
      hero.addComponent(SpriteRenderer, { columns: 4, rows: 3 });
      hero.addComponent(SpriteAnimator, { clips: [{ ...WALK }, { ...JUMP }], clip: 'jump' });
      const script = `
        import { Behaviour, SpriteAnimator } from 'rowan';
        export default class Lander extends Behaviour {
          onAnimationEnd(clip) {
            if (clip === 'jump') this.requireComponent(SpriteAnimator).clip = 'walk';
          }
        }`;
      attachScript(hero, addScript(assets, 'Lander.ts', script));
    });
    const game = await startTestGame(project);
    const sprite = game.game.scene.findByName('Hero')!.requireComponent(SpriteRenderer);
    game.game.update(0);
    game.game.update(0.2);
    game.game.update(0.2);
    // The jump has ended and the script has chosen the walk, which starts in the next frame.
    expect(sprite.frame).toBe(10);
    game.game.update(0.1);
    expect(sprite.frame).toBe(4);
    game.game.update(0.1);
    expect(sprite.frame).toBe(5);
  });

  it('forgets an animator that was removed, so that a new one starts afresh', async () => {
    const game = await startAnimationGame();
    game.advance(0);
    game.advance(0.25);
    game.hero.removeComponent(SpriteAnimator);
    const fresh = game.hero.addComponent(SpriteAnimator, {
      clips: [{ ...JUMP }],
      clip: 'jump',
      time: 0.1,
    });
    game.advance(0.05);
    // It starts from its own time, not from where the old one had got to.
    expect(game.sprite.frame).toBe(9);
    expect(fresh.time).toBe(0.1);
  });
});
