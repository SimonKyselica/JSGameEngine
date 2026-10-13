import type { Unsubscribe } from '../core/signal';
import type { EntityId } from '../ecs/registry';
import { SpriteAnimator, SpriteRenderer, type AnimationClip } from '../scene/components';
import type { Entity } from '../scene/entity';
import type { Scene } from '../scene/scene';

/** What the system remembers about one animator between frames. */
interface AnimatorState {
  /** The clip that was playing in the previous frame, to notice when a script changes it. */
  clip: string;
  /** True once a clip that does not loop has reached its end and its scripts were told. */
  ended: boolean;
}

/** The number of frames a clip has. A clip whose last frame is before its first has one. */
function getFrameCount(clip: Readonly<AnimationClip>): number {
  const count = Math.floor(clip.lastFrame) - Math.floor(clip.firstFrame) + 1;
  return Number.isFinite(count) ? Math.max(1, count) : 1;
}

/**
 * How long a clip takes from its first frame to the end of its last, in seconds. A clip
 * without a usable speed takes forever: it shows its first frame and stays there.
 */
export function getClipDuration(clip: Readonly<AnimationClip>): number {
  return clip.framesPerSecond > 0 ? getFrameCount(clip) / clip.framesPerSecond : Infinity;
}

/** The frame of the sprite sheet that a clip shows `time` seconds after it started. */
export function getClipFrame(clip: Readonly<AnimationClip>, time: number): number {
  const count = getFrameCount(clip);
  const first = Number.isFinite(clip.firstFrame) ? Math.floor(clip.firstFrame) : 0;
  // Written so that a time or a speed of NaN, which a script can produce, shows frame one.
  const elapsed =
    time > 0 && clip.framesPerSecond > 0 ? Math.floor(time * clip.framesPerSecond) : 0;
  return first + (clip.loop ? elapsed % count : Math.min(elapsed, count - 1));
}

/**
 * Advances every `SpriteAnimator` and writes the frame it has reached into the
 * `SpriteRenderer` of the same entity.
 */
export class AnimationSystem {
  private readonly states = new Map<EntityId, AnimatorState>();
  private readonly subscriptions: Unsubscribe[] = [];
  /** The animations that ended in this update. Their scripts are told after the loop. */
  private readonly ended: { entity: Entity; clip: string }[] = [];

  /** @param onEnd Tells the scripts of an entity that an animation of theirs has ended. */
  constructor(
    private readonly scene: Scene,
    private readonly onEnd: (entity: Entity, clip: string) => void,
  ) {}

  start(): void {
    this.subscriptions.push(
      this.scene.registry.onComponentRemoved.connect(({ entity, type }) => {
        if (type === SpriteAnimator) {
          this.states.delete(entity);
        }
      }),
    );
  }

  stop(): void {
    for (const unsubscribe of this.subscriptions.splice(0)) {
      unsubscribe();
    }
    this.states.clear();
    this.ended.length = 0;
  }

  /** Advances the animations by `deltaTime` seconds of game time. */
  update(deltaTime: number): void {
    const { scene, states, ended } = this;
    for (const [id, animator, sprite] of scene.registry.view(SpriteAnimator, SpriteRenderer)) {
      const entity = scene.getEntity(id);
      if (!entity.activeInHierarchy) {
        continue;
      }
      const clip = findClip(animator);
      let state = states.get(id);
      // A clip shows the frame it starts on for the frame it starts in, and moves on from
      // the next one. Otherwise a long frame would skip the beginning of every animation.
      let starting = false;
      if (!state) {
        // The first time round the animator keeps its `time`, as the place to start from.
        state = { clip: animator.clip, ended: false };
        states.set(id, state);
        starting = true;
      } else if (state.clip !== animator.clip) {
        state.clip = animator.clip;
        state.ended = false;
        animator.time = 0;
        starting = true;
      }
      if (!clip) {
        continue;
      }

      const duration = getClipDuration(clip);
      // Written so that a time of NaN, which a script can produce, starts over.
      let time = animator.time > 0 ? animator.time : 0;
      if (!starting && animator.playing && animator.speed > 0 && deltaTime > 0) {
        time += deltaTime * animator.speed;
      }
      if (clip.loop) {
        // Kept within one round, so that it does not lose precision in a long game.
        if (time >= duration) {
          time %= duration;
        }
      } else if (time >= duration) {
        time = duration;
        if (!state.ended) {
          state.ended = true;
          ended.push({ entity, clip: clip.name });
        }
      } else {
        // Set back by a script: the animation plays again and will end again.
        state.ended = false;
      }
      animator.time = time;
      sprite.frame = getClipFrame(clip, time);
    }

    // Told afterwards, because a script may answer by adding or removing animators. In
    // most frames nothing has ended, and then nothing is copied.
    if (ended.length > 0) {
      for (const { entity, clip } of ended.splice(0)) {
        if (entity.isValid) {
          this.onEnd(entity, clip);
        }
      }
    }
  }
}

function findClip(animator: Readonly<SpriteAnimator>): AnimationClip | undefined {
  for (const clip of animator.clips) {
    if (clip.name === animator.clip) {
      return clip;
    }
  }
  return undefined;
}
