import type { AudioApi } from '../audio/audioSystem';
import { RowanError } from '../core/assert';
import { formatLogArguments } from '../core/logger';
import type { ComponentClass } from '../ecs/registry';
import type { Input } from '../input/input';
import type { Vec2 } from '../math/vec2';
import type { Physics2D } from '../physics/physicsSystem';
import type { Transform } from '../scene/components';
import type { Entity } from '../scene/entity';
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
  onCollisionEnter?(collision: Collision): void;
  onCollisionExit?(other: Entity): void;
  onTriggerEnter?(other: Entity): void;
  onTriggerExit?(other: Entity): void;
}

export type BehaviourClass<T extends Behaviour = Behaviour> = new () => T;

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

  get scene(): SceneApi {
    return attachmentOf(this).services.scene;
  }

  get input(): Input {
    return attachmentOf(this).services.input;
  }

  get physics(): Physics2D {
    return attachmentOf(this).services.physics;
  }

  get audio(): AudioApi {
    return attachmentOf(this).services.audio;
  }

  get time(): Time {
    return attachmentOf(this).services.time;
  }

  get assets(): AssetsApi {
    return attachmentOf(this).services.assets;
  }

  getComponent<T extends object>(type: ComponentClass<T>): T | undefined {
    return this.entity.getComponent(type);
  }

  /** Like {@link Behaviour.getComponent} but throws when the component is missing. */
  requireComponent<T extends object>(type: ComponentClass<T>): T {
    return this.entity.requireComponent(type);
  }

  hasComponent(type: ComponentClass): boolean {
    return this.entity.hasComponent(type);
  }

  addComponent<T extends object>(type: ComponentClass<T>, init?: Partial<T>): T {
    return this.entity.addComponent(type, init);
  }

  removeComponent(type: ComponentClass): boolean {
    return this.entity.removeComponent(type);
  }

  /**
   * Finds another script by class or by name, on this entity or on `entity`.
   * Scripts created this frame are available right away.
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

  /** Writes a message to the console. */
  log(...values: unknown[]): void {
    const { services, scriptName } = attachmentOf(this);
    services.logger.info(formatLogArguments(values), scriptName);
  }

  warn(...values: unknown[]): void {
    const { services, scriptName } = attachmentOf(this);
    services.logger.warn(formatLogArguments(values), scriptName);
  }

  error(...values: unknown[]): void {
    const { services, scriptName } = attachmentOf(this);
    services.logger.error(formatLogArguments(values), scriptName);
  }
}
