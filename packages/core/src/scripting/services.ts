import type { AssetType } from '../assets/asset';
import type { AssetDatabase } from '../assets/assetDatabase';
import type { AudioApi } from '../audio/audioSystem';
import type { Logger } from '../core/logger';
import type { Input } from '../input/input';
import type { Vec2 } from '../math/vec2';
import type { Physics2D } from '../physics/physicsSystem';
import type { Entity } from '../scene/entity';
import type { Scene } from '../scene/scene';
import type { Behaviour, BehaviourClass, CancelTimer } from './behaviour';

/** Frame timing as seen by scripts (`this.time`). All durations are in seconds. */
export class Time {
  /** Time since the previous frame, scaled by {@link Time.timeScale}. */
  deltaTime = 0;
  /** Time since the previous frame, ignoring {@link Time.timeScale}. */
  unscaledDeltaTime = 0;
  /** The fixed interval between physics steps and `onFixedUpdate` calls. */
  fixedDeltaTime = 1 / 60;
  /** Scaled time since the scene started. */
  elapsed = 0;
  /** Number of frames since the scene started. */
  frameCount = 0;
  /** Speed of game time. 1 is normal, 0.5 is slow motion, 0 freezes the game. */
  timeScale = 1;
}

/** Where and how `Behaviour.instantiate` places the new entity. Every option can be left out. */
export interface SpawnOptions {
  /** World-space position of the new entity. */
  readonly position?: Readonly<Vec2>;
  /** World-space rotation in radians. */
  readonly rotation?: number;
  /**
   * The entity the new one becomes a child of. Without it the new entity is added at the top level
   * of the scene.
   */
  readonly parent?: Entity | null;
  /** A name for the new entity. Defaults to the name stored in the prefab. */
  readonly name?: string;
}

/** What the running game offers to {@link SceneApi}. */
export interface SceneHost {
  readonly scene: Scene;
  getMainCamera(): Entity | null;
  requestSceneLoad(scene: string): void;
}

/** The scene functions available to scripts as `this.scene`. */
export class SceneApi {
  constructor(private readonly host: SceneHost) {}

  /** The name of the scene that is running. */
  get name(): string {
    return this.host.scene.name;
  }

  /** The entity whose camera the game is currently drawn from. */
  get mainCamera(): Entity | null {
    return this.host.getMainCamera();
  }

  /** Every entity in the scene, parents before their children. */
  get entities(): Entity[] {
    return this.host.scene.entitiesInHierarchyOrder();
  }

  /**
   * Adds a new, empty entity to the scene, optionally as a child of `parent`. Give it components
   * with `addComponent`.
   */
  createEntity(name?: string, parent?: Entity | null): Entity {
    return this.host.scene.createEntity(name, { parent });
  }

  /** The first entity with this name, or `null`. */
  findByName(name: string): Entity | null {
    return this.host.scene.findByName(name);
  }

  /** Every entity with this tag, parents before their children. */
  findByTag(tag: string): Entity[] {
    return this.host.scene.findByTag(tag);
  }

  /** Switches to another scene, by name or asset id, once the current frame has finished. */
  load(scene: string): void {
    this.host.requestSceneLoad(scene);
  }
}

/** Asset lookups available to scripts as `this.assets`. */
export class AssetsApi {
  constructor(private readonly assets: AssetDatabase) {}

  /**
   * Finds an asset by name and returns its id, or `null`. The id can be assigned to
   * component fields such as `SpriteRenderer.texture` or passed to `instantiate`.
   */
  find(name: string, type?: AssetType): string | null {
    return this.assets.findByName(name, type)?.id ?? null;
  }

  /** True when the project has an asset with this name, and of this type when one is given. */
  exists(name: string, type?: AssetType): boolean {
    return this.assets.findByName(name, type) !== undefined;
  }

  /** The name of the asset with this id, or `null` when there is none. */
  getName(id: string): string | null {
    return this.assets.get(id)?.name ?? null;
  }
}

/** Everything a running script can reach. One set is shared by all scripts of a scene. */
export interface ScriptServices {
  readonly scene: SceneApi;
  readonly input: Input;
  readonly physics: Physics2D;
  readonly audio: AudioApi;
  readonly time: Time;
  readonly assets: AssetsApi;
  readonly logger: Logger;
  instantiate(prefab: string, options?: SpawnOptions): Entity;
  destroy(entity: Entity, delaySeconds: number): void;
  getScript<T extends Behaviour>(entity: Entity, type: BehaviourClass<T> | string): T | undefined;
  /** Starts a one-shot or repeating timer that belongs to a script. */
  startTimer(
    behaviour: Behaviour,
    seconds: number,
    repeat: boolean,
    callback: () => void,
  ): CancelTimer;
}
