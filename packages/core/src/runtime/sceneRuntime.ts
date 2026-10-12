import type { AssetDatabase } from '../assets/assetDatabase';
import { AudioApi, type AudioSystem } from '../audio/audioSystem';
import { RowanError } from '../core/assert';
import type { Logger } from '../core/logger';
import { Input, type InputState } from '../input/input';
import { type Vec2 } from '../math/vec2';
import { Physics2D, PhysicsSystem } from '../physics/physicsSystem';
import type { CameraView } from '../renderer/cameraView';
import { findPrimaryCamera } from '../renderer/sceneRenderer';
import type { Entity } from '../scene/entity';
import type { Scene } from '../scene/scene';
import { instantiatePrefab } from '../scene/serializer';
import type { ScriptModuleLoader } from '../scripting/scriptModuleLoader';
import { ScriptSystem } from '../scripting/scriptSystem';
import {
  AssetsApi,
  SceneApi,
  type SceneHost,
  type SpawnOptions,
  type Time,
} from '../scripting/services';

/** The game-wide services a scene needs while it runs. */
export interface SceneRuntimeContext {
  readonly assets: AssetDatabase;
  readonly audio: AudioSystem;
  readonly input: InputState;
  readonly time: Time;
  readonly logger: Logger;
  readonly scriptLoader: ScriptModuleLoader;
  readonly gravity: Readonly<Vec2>;
  /** The view of the primary camera, used to map the pointer into world space. */
  getCameraView(): CameraView | null;
  requestSceneLoad(scene: string): void;
}

interface PendingDestroy {
  readonly entity: Entity;
  remaining: number;
}

/** Runs one scene: owns its physics and scripts and steps them in the right order. */
export class SceneRuntime implements SceneHost {
  readonly physics: PhysicsSystem;
  readonly scripts: ScriptSystem;

  private destroyQueue: PendingDestroy[] = [];
  private readonly prefabCache = new Map<string, unknown>();
  private running = false;

  constructor(
    readonly scene: Scene,
    private readonly context: SceneRuntimeContext,
  ) {
    this.physics = new PhysicsSystem(scene, context.gravity);
    this.scripts = new ScriptSystem(
      scene,
      context.assets,
      context.scriptLoader,
      {
        scene: new SceneApi(this),
        input: new Input(context.input, () => context.getCameraView()),
        physics: new Physics2D(this.physics),
        audio: new AudioApi(context.audio),
        time: context.time,
        assets: new AssetsApi(context.assets),
        logger: context.logger,
        instantiate: (prefab, options) => this.instantiate(prefab, options),
        destroy: (entity, delaySeconds) => this.queueDestroy(entity, delaySeconds),
      },
      context.logger,
    );
  }

  get isRunning(): boolean {
    return this.running;
  }

  start(): void {
    this.running = true;
    this.physics.start();
    this.context.audio.startScene(this.scene);
    this.scripts.start();
  }

  /** One fixed step: scripts first, then physics, then the contacts physics reported. */
  fixedUpdate(fixedDeltaTime: number): void {
    this.scripts.fixedUpdate(fixedDeltaTime);
    const contacts = this.physics.step(fixedDeltaTime);
    this.scripts.dispatchContacts(contacts);
  }

  /** One rendered frame: updates, late updates, then deferred destruction. */
  update(deltaTime: number): void {
    this.scripts.update(deltaTime);
    this.scripts.lateUpdate(deltaTime);
    this.flushDestroyQueue(deltaTime);
    this.context.audio.update();
  }

  stop(): void {
    if (!this.running) {
      return;
    }
    this.running = false;
    this.scripts.stop();
    this.context.audio.stopScene();
    this.physics.stop();
    this.destroyQueue = [];
  }

  /** Adds a copy of a prefab asset, given by name or id, to the scene. */
  instantiate(prefab: string, options: SpawnOptions = {}): Entity {
    const record = this.context.assets.resolve(prefab, 'prefab');
    if (!record) {
      throw new RowanError(`Prefab "${prefab}" does not exist`);
    }
    let data = this.prefabCache.get(record.id);
    if (data === undefined) {
      try {
        data = JSON.parse(this.context.assets.getText(record.id)) as unknown;
      } catch (error) {
        throw new RowanError(`Prefab "${record.name}" is not valid JSON`, { cause: error });
      }
      this.prefabCache.set(record.id, data);
    }
    return instantiatePrefab(this.scene, data, {
      ...options,
      onWarning: (message) => this.context.logger.warn(message, record.name),
    });
  }

  /** Schedules an entity for destruction at the end of a frame. */
  queueDestroy(entity: Entity, delaySeconds = 0): void {
    this.destroyQueue.push({ entity, remaining: Math.max(0, delaySeconds) });
  }

  getMainCamera(): Entity | null {
    return findPrimaryCamera(this.scene);
  }

  requestSceneLoad(scene: string): void {
    this.context.requestSceneLoad(scene);
  }

  private flushDestroyQueue(deltaTime: number): void {
    if (this.destroyQueue.length === 0) {
      return;
    }
    // Destroying an entity runs onDestroy callbacks, which may queue further entities.
    const queue = this.destroyQueue;
    this.destroyQueue = [];
    for (const item of queue) {
      item.remaining -= deltaTime;
      if (item.remaining > 0) {
        this.destroyQueue.push(item);
      } else {
        this.scene.destroyEntity(item.entity);
      }
    }
  }
}
