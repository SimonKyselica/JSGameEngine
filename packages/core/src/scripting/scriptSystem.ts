import { getNameWithoutExtension } from '../assets/asset';
import type { AssetDatabase } from '../assets/assetDatabase';
import type { Logger } from '../core/logger';
import type { Unsubscribe } from '../core/signal';
import type { EntityId } from '../ecs/registry';
import { Vec2 } from '../math/vec2';
import type { ContactEvent } from '../physics/physicsSystem';
import { ScriptComponent, type ScriptBinding } from '../scene/components';
import type { Entity } from '../scene/entity';
import type { Scene } from '../scene/scene';
import {
  attachBehaviour,
  type Behaviour,
  type BehaviourClass,
  type ScriptLifecycle,
} from './behaviour';
import type { ScriptModuleLoader } from './scriptModuleLoader';
import { getScriptProperties, toRuntimeValue } from './scriptProperties';
import type { ScriptServices } from './services';

type LifecycleHook = keyof ScriptLifecycle;

interface ScriptInstance {
  readonly behaviour: Behaviour;
  readonly entity: Entity;
  readonly binding: ScriptBinding;
  /** The script asset the instance was created from. */
  readonly scriptId: string;
  readonly scriptName: string;
  started: boolean;
  destroyed: boolean;
}

/**
 * Creates a script instance for every script attached to an entity and drives their
 * lifecycle callbacks. An exception thrown by a script is logged and never stops the game.
 */
export class ScriptSystem {
  private instances: ScriptInstance[] = [];
  private readonly byBinding = new Map<ScriptBinding, ScriptInstance>();
  private readonly byEntity = new Map<EntityId, ScriptInstance[]>();
  /** Scripts that failed to load or construct. Each one is reported only once. */
  private readonly failedScripts = new Set<string>();
  private readonly subscriptions: Unsubscribe[] = [];
  private readonly services: ScriptServices;

  constructor(
    private readonly scene: Scene,
    private readonly assets: AssetDatabase,
    private readonly loader: ScriptModuleLoader,
    services: Omit<ScriptServices, 'getScript'>,
    private readonly logger: Logger,
  ) {
    this.services = {
      ...services,
      getScript: (entity, type) => this.getScript(entity, type),
    };
  }

  get instanceCount(): number {
    return this.instances.length;
  }

  /** Instantiates the scripts already in the scene and calls their `onStart`. */
  start(): void {
    this.subscriptions.push(
      this.scene.onEntityDestroyed.connect((entity) => this.destroyEntityInstances(entity.id)),
    );
    this.syncInstances();
    this.runHook(null);
  }

  /** Calls `onDestroy` on every script and detaches from the scene. */
  stop(): void {
    for (const unsubscribe of this.subscriptions.splice(0)) {
      unsubscribe();
    }
    for (const instance of this.instances) {
      this.destroyInstance(instance);
    }
    this.instances = [];
    this.failedScripts.clear();
  }

  update(deltaTime: number): void {
    this.syncInstances();
    this.runHook('onUpdate', deltaTime);
  }

  fixedUpdate(fixedDeltaTime: number): void {
    this.syncInstances();
    this.runHook('onFixedUpdate', fixedDeltaTime);
  }

  lateUpdate(deltaTime: number): void {
    this.runHook('onLateUpdate', deltaTime);
  }

  /** Forwards physics contact events to the scripts of the entities involved. */
  dispatchContacts(events: readonly ContactEvent[]): void {
    for (const event of events) {
      const instances = this.byEntity.get(event.entity.id);
      if (!instances || !event.other.isValid) {
        continue;
      }
      for (const instance of [...instances]) {
        if (!this.prepare(instance)) {
          continue;
        }
        switch (event.kind) {
          case 'collisionEnter':
            this.call(instance, 'onCollisionEnter', {
              other: event.other,
              point: event.point ?? event.entity.worldPosition,
              normal: event.normal ?? new Vec2(),
            });
            break;
          case 'collisionExit':
            this.call(instance, 'onCollisionExit', event.other);
            break;
          case 'triggerEnter':
            this.call(instance, 'onTriggerEnter', event.other);
            break;
          case 'triggerExit':
            this.call(instance, 'onTriggerExit', event.other);
            break;
        }
      }
    }
  }

  /** Every live script instance on an entity, in the order they are attached. */
  getScripts(entity: Entity): Behaviour[] {
    this.createEntityInstances(entity);
    return (this.byEntity.get(entity.id) ?? []).map((instance) => instance.behaviour);
  }

  /** Finds a script on an entity by its class, its class name or its asset name. */
  getScript<T extends Behaviour>(entity: Entity, type: BehaviourClass<T> | string): T | undefined {
    this.createEntityInstances(entity);
    const match = this.byEntity
      .get(entity.id)
      ?.find((instance) =>
        typeof type === 'string'
          ? instance.scriptName === type || instance.behaviour.constructor.name === type
          : instance.behaviour instanceof type,
      );
    return match?.behaviour as T | undefined;
  }

  /** Brings the set of instances in line with the script bindings in the scene. */
  private syncInstances(): void {
    let removed = false;
    for (const instance of this.instances) {
      if (!instance.destroyed && !this.isStillBound(instance)) {
        this.destroyInstance(instance);
      }
      removed ||= instance.destroyed;
    }
    if (removed) {
      this.instances = this.instances.filter((instance) => !instance.destroyed);
    }

    // Constructing a script may run arbitrary code, so do not hold the live view open.
    for (const [id] of [...this.scene.registry.view(ScriptComponent)]) {
      if (this.scene.registry.isAlive(id)) {
        this.createEntityInstances(this.scene.getEntity(id));
      }
    }
  }

  private isStillBound(instance: ScriptInstance): boolean {
    const { entity, binding } = instance;
    if (!entity.isValid || binding.script !== instance.scriptId) {
      return false;
    }
    return entity.getComponent(ScriptComponent)?.scripts.includes(binding) ?? false;
  }

  private createEntityInstances(entity: Entity): void {
    const component = entity.isValid ? entity.getComponent(ScriptComponent) : undefined;
    if (!component) {
      return;
    }
    for (const binding of component.scripts) {
      if (binding.script !== null && !this.byBinding.has(binding)) {
        this.createInstance(entity, binding, binding.script);
      }
    }
  }

  private createInstance(entity: Entity, binding: ScriptBinding, scriptId: string): void {
    if (this.failedScripts.has(scriptId)) {
      return;
    }
    const scriptName = getNameWithoutExtension(this.assets.get(scriptId)?.name ?? scriptId);
    let behaviour: Behaviour;
    try {
      const scriptClass = this.loader.loadClass(scriptId);
      const properties = getScriptProperties(scriptClass);
      behaviour = new scriptClass();
      attachBehaviour(behaviour, entity, this.services, scriptName);
      for (const [name, definition] of Object.entries(properties)) {
        const value = toRuntimeValue(definition, binding.properties[name]);
        if (value !== undefined) {
          (behaviour as unknown as Record<string, unknown>)[name] = value;
        }
      }
      behaviour.enabled = binding.enabled;
    } catch (error) {
      this.failedScripts.add(scriptId);
      this.logger.error(formatScriptError(error), scriptName);
      return;
    }

    const instance: ScriptInstance = {
      behaviour,
      entity,
      binding,
      scriptId,
      scriptName,
      started: false,
      destroyed: false,
    };
    this.instances.push(instance);
    this.byBinding.set(binding, instance);
    const entityInstances = this.byEntity.get(entity.id);
    if (entityInstances) {
      entityInstances.push(instance);
    } else {
      this.byEntity.set(entity.id, [instance]);
    }
  }

  private destroyEntityInstances(id: EntityId): void {
    for (const instance of [...(this.byEntity.get(id) ?? [])]) {
      this.destroyInstance(instance);
    }
  }

  private destroyInstance(instance: ScriptInstance): void {
    if (instance.destroyed) {
      return;
    }
    instance.destroyed = true;
    this.byBinding.delete(instance.binding);
    const entityInstances = this.byEntity.get(instance.entity.id);
    if (entityInstances) {
      const remaining = entityInstances.filter((other) => other !== instance);
      if (remaining.length > 0) {
        this.byEntity.set(instance.entity.id, remaining);
      } else {
        this.byEntity.delete(instance.entity.id);
      }
    }
    // A script that never started has nothing to clean up.
    if (instance.started) {
      this.call(instance, 'onDestroy');
    }
  }

  /**
   * Calls a hook on every runnable script, starting scripts that have not started yet.
   * Passing `null` only starts scripts. Scripts created while the loop runs wait for the
   * next call.
   */
  private runHook(hook: 'onUpdate' | 'onFixedUpdate' | 'onLateUpdate' | null, delta = 0): void {
    const instances = this.instances;
    const count = instances.length;
    for (let index = 0; index < count; index++) {
      const instance = instances[index]!;
      if (this.prepare(instance) && hook) {
        this.call(instance, hook, delta);
      }
    }
  }

  /** Starts the script if needed and reports whether it should receive callbacks. */
  private prepare(instance: ScriptInstance): boolean {
    if (!isRunnable(instance)) {
      return false;
    }
    if (!instance.started) {
      instance.started = true;
      this.call(instance, 'onStart');
      return isRunnable(instance);
    }
    return true;
  }

  private call<K extends LifecycleHook>(
    instance: ScriptInstance,
    hook: K,
    ...args: Parameters<NonNullable<ScriptLifecycle[K]>>
  ): void {
    const method = (instance.behaviour as ScriptLifecycle)[hook] as
      ((...hookArgs: unknown[]) => void) | undefined;
    if (typeof method !== 'function') {
      return;
    }
    try {
      method.apply(instance.behaviour, args);
    } catch (error) {
      const entityName = instance.entity.isValid ? instance.entity.name : 'destroyed entity';
      this.logger.error(
        `${hook} failed on "${entityName}": ${formatScriptError(error)}`,
        instance.scriptName,
      );
    }
  }
}

function isRunnable(instance: ScriptInstance): boolean {
  return (
    !instance.destroyed &&
    instance.behaviour.enabled &&
    instance.entity.isValid &&
    instance.entity.activeInHierarchy
  );
}

function formatScriptError(error: unknown): string {
  if (error instanceof Error) {
    return error.name === 'Error' || error.name === 'RowanError'
      ? error.message
      : `${error.name}: ${error.message}`;
  }
  return String(error);
}
