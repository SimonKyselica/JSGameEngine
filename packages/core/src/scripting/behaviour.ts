import type { AudioApi } from '../audio/audioSystem';
import { RowanError } from '../core/assert';
import { formatLogArguments } from '../core/logger';
import type { ComponentClass } from '../ecs/registry';
import type { Input } from '../input/input';
import type { Vec2 } from '../math/vec2';
import type { Physics2D } from '../physics/physicsSystem';
import type { Transform } from '../scene/components';
import type { Entity } from '../scene/entity';
import type { StorageApi } from '../storage/saveData';
import type { AssetsApi, SceneApi, ScriptServices, SpawnOptions, Time } from './services';

/** Details of a collision between two solid colliders. */
export interface Collision {
  /** The entity that was hit. */
  readonly other: Entity;
  /** World-space contact point. */
  readonly point: Vec2;
  /** Unit vector pointing from this entity towards the other one. */
  readonly normal: Vec2;
}

/**
 * The callbacks a script may define. All of them are optional; the engine calls the
 * ones that exist. Implement this interface to have TypeScript check their signatures.
 */
export interface ScriptLifecycle {
  /** Called once, before the script's first update. */
  onStart?(): void;
  /** Called every frame. */
  onUpdate?(deltaTime: number): void;
  /** Called at the fixed physics rate, just before each physics step. */
  onFixedUpdate?(fixedDeltaTime: number): void;
  /** Called every frame after all `onUpdate` calls. */
  onLateUpdate?(deltaTime: number): void;
  /** Called when the entity is destroyed or the scene stops. */
  onDestroy?(): void;
  /** Called when one of the entity's solid colliders starts touching another solid collider. */
  onCollisionEnter?(collision: Collision): void;
  /** Called when the entity stops touching `other`. */
  onCollisionExit?(other: Entity): void;
  /**
   * Called when the entity starts overlapping `other` and at least one of the two colliders is a
   * trigger.
   */
  onTriggerEnter?(other: Entity): void;
  /** Called when an overlap reported by `onTriggerEnter` ends. */
  onTriggerExit?(other: Entity): void;
  /** Called when the pointer moves onto the entity's `Button`. */
  onPointerEnter?(): void;
  /**
   * Called when the pointer leaves the entity's `Button`, or when the button stops being
   * interactable while the pointer is on it.
   */
  onPointerExit?(): void;
  /**
   * Called when the entity's `Button` is pressed: the left mouse button goes down on it, or
   * a finger touches it.
   */
  onPointerDown?(): void;
  /** Called when a press that began on the entity's `Button` ends, wherever the pointer is. */
  onPointerUp?(): void;
  /**
   * Called after `onPointerUp` when the press ended on the button it began on. This is the
   * callback for "the player chose this".
   */
  onClick?(): void;
  /**
   * Called when an animation of the entity's `SpriteAnimator` that does not loop has shown
   * its last frame. `clip` is the name of that animation.
   */
  onAnimationEnd?(clip: string): void;
}

/** The callbacks a `Button` raises on the scripts of its entity. */
export type PointerCallback =
  'onPointerEnter' | 'onPointerExit' | 'onPointerDown' | 'onPointerUp' | 'onClick';

/**
 * A script class: any class that extends `Behaviour`. Where a function takes one, pass the
 * class itself: `getScript(Health)`.
 */
export type BehaviourClass<T extends Behaviour = Behaviour> = new () => T;

/** Stops a timer started with `after` or `every`. Calling it again does nothing. */
export type CancelTimer = () => void;

interface Attachment {
  readonly entity: Entity;
  readonly services: ScriptServices;
  readonly scriptName: string;
}

// Kept outside the instances so scripts cannot overwrite it by accident.
const attachments = new WeakMap<Behaviour, Attachment>();

/** Connects a script instance to its entity. Called by the script system only. */
export function attachBehaviour(
  behaviour: Behaviour,
  entity: Entity,
  services: ScriptServices,
  scriptName: string,
): void {
  attachments.set(behaviour, { entity, services, scriptName });
}

function attachmentOf(behaviour: Behaviour): Attachment {
  const attachment = attachments.get(behaviour);
  if (!attachment) {
    throw new RowanError(
      'This script is not attached to an entity yet. The engine is not available in a ' +
        'constructor or field initializer; move the code to onStart().',
    );
  }
  return attachment;
}

/**
 * The base class of every script. A script file default-exports a subclass:
 *
 * ```ts
 * import { Behaviour, Vec2 } from 'rowan';
 *
 * export default class Mover extends Behaviour {
 *   static properties = { speed: { type: 'number', default: 2 } };
 *   speed = 2;
 *
 *   onUpdate(deltaTime: number) {
 *     this.transform.position.x += this.speed * deltaTime;
 *   }
 * }
 * ```
 *
 * See {@link ScriptLifecycle} for the callbacks the engine calls.
 */
export abstract class Behaviour {
  /** Disabled scripts receive no update or physics callbacks. */
  enabled = true;

  /** The entity this script is attached to. */
  get entity(): Entity {
    return attachmentOf(this).entity;
  }

  /** Shortcut for the entity's Transform component. */
  get transform(): Transform {
    return attachmentOf(this).entity.transform;
  }

  /** The running scene: find and create entities, or load another scene. */
  get scene(): SceneApi {
    return attachmentOf(this).services.scene;
  }

  /** Keyboard and mouse input. */
  get input(): Input {
    return attachmentOf(this).services.input;
  }

  /** Velocities, forces, raycasts and other physics queries. */
  get physics(): Physics2D {
    return attachmentOf(this).services.physics;
  }

  /** Sound playback. */
  get audio(): AudioApi {
    return attachmentOf(this).services.audio;
  }

  /** Frame timing, such as the time since the previous frame. */
  get time(): Time {
    return attachmentOf(this).services.time;
  }

  /** Looks up the project's assets by name. */
  get assets(): AssetsApi {
    return attachmentOf(this).services.assets;
  }

  /** Save data: values that survive a scene change and closing the game. */
  get storage(): StorageApi {
    return attachmentOf(this).services.storage;
  }

  /** The entity's component of this type, or `undefined` when it has none. */
  getComponent<T extends object>(type: ComponentClass<T>): T | undefined {
    return this.entity.getComponent(type);
  }

  /** Like {@link Behaviour.getComponent} but throws when the component is missing. */
  requireComponent<T extends object>(type: ComponentClass<T>): T {
    return this.entity.requireComponent(type);
  }

  /** True when the entity has a component of this type. */
  hasComponent(type: ComponentClass): boolean {
    return this.entity.hasComponent(type);
  }

  /**
   * Attaches a new component to the entity, optionally overriding some of its default field values.
   */
  addComponent<T extends object>(type: ComponentClass<T>, init?: Partial<T>): T {
    return this.entity.addComponent(type, init);
  }

  /** Detaches a component from the entity. Returns `false` when the entity did not have one. */
  removeComponent(type: ComponentClass): boolean {
    return this.entity.removeComponent(type);
  }

  /**
   * Finds another script by class or by name, on this entity or on `entity`.
   * Scripts created this frame are available right away. A script that has been destroyed is
   * not found any more, which matters in `onDestroy`: when a scene ends, the script you ask
   * for may already be gone. Keep a reference from `onStart` if you need it then.
   */
  getScript<T extends Behaviour>(
    type: BehaviourClass<T> | string,
    entity: Entity = this.entity,
  ): T | undefined {
    return attachmentOf(this).services.getScript(entity, type);
  }

  /** Adds a copy of a prefab to the scene. `prefab` is a prefab asset's name or id. */
  instantiate(prefab: string, options?: SpawnOptions): Entity {
    return attachmentOf(this).services.instantiate(prefab, options);
  }

  /**
   * Destroys an entity (this script's entity by default) and its children at the end of
   * the frame, or after `delaySeconds` of game time.
   */
  destroy(target: Entity = this.entity, delaySeconds = 0): void {
    attachmentOf(this).services.destroy(target, delaySeconds);
  }

  /**
   * Calls `callback` once, after `seconds` of game time, and returns a function that
   * cancels it.
   *
   * Timers follow `Time.timeScale`, pause while the script is disabled or its entity is
   * inactive, and are cancelled when the entity is destroyed or the scene ends. Callbacks
   * run once per frame, after every script's `onUpdate`.
   */
  after(seconds: number, callback: () => void): CancelTimer {
    return attachmentOf(this).services.startTimer(this, seconds, false, callback);
  }

  /**
   * Calls `callback` every `seconds` of game time until it is cancelled, and returns the
   * function that cancels it. The interval must be at least 0.001 seconds. It does not
   * drift: when a frame is longer than the interval, the calls that were missed are made
   * in that frame. Otherwise it behaves like {@link Behaviour.after}.
   */
  every(seconds: number, callback: () => void): CancelTimer {
    return attachmentOf(this).services.startTimer(this, seconds, true, callback);
  }

  /** Writes a message to the console. */
  log(...values: unknown[]): void {
    const { services, scriptName } = attachmentOf(this);
    services.logger.info(formatLogArguments(values), scriptName);
  }

  /** Writes a warning to the console. */
  warn(...values: unknown[]): void {
    const { services, scriptName } = attachmentOf(this);
    services.logger.warn(formatLogArguments(values), scriptName);
  }

  /** Writes an error to the console. */
  error(...values: unknown[]): void {
    const { services, scriptName } = attachmentOf(this);
    services.logger.error(formatLogArguments(values), scriptName);
  }
}
