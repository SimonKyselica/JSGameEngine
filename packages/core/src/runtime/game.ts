import type { AssetDatabase } from '../assets/assetDatabase';
import type { Project } from '../assets/project';
import type { AudioBackend } from '../audio/audioBackend';
import { AudioSystem } from '../audio/audioSystem';
import { assert, RowanError } from '../core/assert';
import { Logger } from '../core/logger';
import { Signal } from '../core/signal';
import { InputState } from '../input/input';
import { Vec2 } from '../math/vec2';
import type { CameraView } from '../renderer/cameraView';
import type { Renderer2D } from '../renderer/renderer2d';
import { createCameraView, findPrimaryCamera, SceneRenderer } from '../renderer/sceneRenderer';
import type { TextRasterizer } from '../renderer/textLayout';
import { TextureCache, type ImageDecoder } from '../renderer/textureCache';
import type { Scene } from '../scene/scene';
import { deserializeScene } from '../scene/serializer';
import * as scriptApi from '../scripting/api';
import { ScriptModuleLoader, type ScriptFactoryProvider } from '../scripting/scriptModuleLoader';
import { Time } from '../scripting/services';
import { SceneRuntime } from './sceneRuntime';

/** Frames longer than this are shortened, so a stalled tab does not cause a huge time jump. */
const MAX_FRAME_DELTA = 0.25;
/** Upper bound on physics steps per frame; any backlog beyond it is dropped. */
const MAX_FIXED_STEPS_PER_FRAME = 8;
/** Absorbs rounding errors when a frame is exactly one fixed step long. */
const STEP_EPSILON = 1e-9;

export interface GameOptions {
  readonly project: Project;
  readonly renderer: Renderer2D;
  readonly audioBackend: AudioBackend;
  readonly imageDecoder: ImageDecoder;
  /** Measures and draws text. `CanvasTextRasterizer` in a browser. */
  readonly textRasterizer: TextRasterizer;
  readonly scripts: ScriptFactoryProvider;
  readonly logger?: Logger;
}

export interface StartOptions {
  /** Scene asset name or id to start in. Defaults to the project's start scene. */
  readonly scene?: string;
  /** Serialized scene to start in instead of a scene asset, as the editor's play mode does. */
  readonly sceneData?: unknown;
}

/**
 * A running game: loads a project's assets, runs its scenes and draws them.
 *
 * The host drives it by calling {@link Game.update} and {@link Game.render} once per
 * frame, which keeps the game independent of how frames are scheduled.
 */
export class Game {
  readonly project: Project;
  readonly assets: AssetDatabase;
  readonly logger: Logger;
  readonly input = new InputState();
  readonly time = new Time();
  readonly textures: TextureCache;
  readonly audio: AudioSystem;
  readonly sceneRenderer: SceneRenderer;
  /** Emitted after a scene has been loaded and started. */
  readonly onSceneLoaded = new Signal<Scene>();

  private readonly renderer: Renderer2D;
  private readonly scriptLoader: ScriptModuleLoader;
  private runtime: SceneRuntime | null = null;
  private pendingScene: string | null = null;
  private accumulator = 0;

  constructor(options: GameOptions) {
    this.project = options.project;
    this.assets = options.project.assets;
    this.logger = options.logger ?? new Logger();
    this.renderer = options.renderer;

    const { rendering, physics } = this.project.settings;
    this.textures = new TextureCache(
      options.renderer,
      this.assets,
      options.imageDecoder,
      rendering.pixelArt ? 'nearest' : 'linear',
      this.logger,
    );
    this.audio = new AudioSystem(options.audioBackend, this.assets, this.logger);
    this.sceneRenderer = new SceneRenderer(
      options.renderer,
      this.textures,
      this.assets,
      options.textRasterizer,
      this.logger,
    );
    this.scriptLoader = new ScriptModuleLoader(this.assets, options.scripts, { ...scriptApi });
    this.time.fixedDeltaTime = physics.fixedTimeStep;
  }

  get isRunning(): boolean {
    return this.runtime !== null;
  }

  /** The scene that is currently running. */
  get scene(): Scene {
    return this.requireRuntime().scene;
  }

  /** The systems of the scene that is currently running. */
  get sceneRuntime(): SceneRuntime {
    return this.requireRuntime();
  }

  /** Decodes all textures and sounds, then loads and starts the first scene. */
  async start(options: StartOptions = {}): Promise<void> {
    assert(!this.runtime, 'The game has already been started');
    await Promise.all([this.textures.preloadAll(), this.audio.preloadAll()]);
    this.startScene(
      options.sceneData !== undefined
        ? this.parseScene(options.sceneData, 'the provided scene data')
        : this.loadSceneAsset(options.scene ?? this.findStartScene()),
    );
  }

  /**
   * Advances the game by one frame.
   *
   * @param deltaSeconds Real time since the previous frame.
   */
  update(deltaSeconds: number): void {
    const runtime = this.requireRuntime();
    const time = this.time;
    const unscaled = Math.min(Math.max(deltaSeconds, 0), MAX_FRAME_DELTA);
    const scaled = unscaled * Math.max(time.timeScale, 0);
    time.unscaledDeltaTime = unscaled;
    time.deltaTime = scaled;
    time.elapsed += scaled;
    time.frameCount++;

    const fixedDeltaTime = time.fixedDeltaTime;
    this.accumulator += scaled;
    let steps = 0;
    while (this.accumulator + STEP_EPSILON >= fixedDeltaTime && steps < MAX_FIXED_STEPS_PER_FRAME) {
      runtime.fixedUpdate(fixedDeltaTime);
      this.accumulator -= fixedDeltaTime;
      steps++;
    }
    if (steps === MAX_FIXED_STEPS_PER_FRAME) {
      // The simulation cannot keep up; drop the backlog instead of falling further behind.
      this.accumulator = 0;
    }
    this.accumulator = Math.max(this.accumulator, 0);

    runtime.update(scaled);
    this.input.endFrame();

    if (this.pendingScene !== null) {
      const scene = this.pendingScene;
      this.pendingScene = null;
      this.switchScene(scene);
    }
  }

  /** Draws the current scene through its primary camera. */
  render(): void {
    this.sceneRenderer.renderPrimaryCamera(this.requireRuntime().scene);
  }

  /** Asks for a scene change, by asset name or id, at the end of the current frame. */
  requestSceneLoad(scene: string): void {
    this.pendingScene = scene;
  }

  /** The view of the current scene's primary camera, or `null` without a camera. */
  getCameraView(): CameraView | null {
    const camera = this.runtime ? findPrimaryCamera(this.runtime.scene) : null;
    return camera ? createCameraView(camera, this.sceneRenderer.aspect) : null;
  }

  /** Stops the running scene. The game can be started again afterwards. */
  stop(): void {
    this.runtime?.stop();
    this.runtime = null;
    this.pendingScene = null;
    this.accumulator = 0;
    this.input.reset();
  }

  /** Stops the game and releases its GPU textures. */
  dispose(): void {
    this.stop();
    this.sceneRenderer.dispose();
    this.textures.dispose();
  }

  private requireRuntime(): SceneRuntime {
    if (!this.runtime) {
      throw new RowanError('The game is not running. Call start() first.');
    }
    return this.runtime;
  }

  private findStartScene(): string {
    const { startScene } = this.project.settings;
    if (startScene !== null && this.assets.get(startScene)?.type === 'scene') {
      return startScene;
    }
    const first = this.assets.list('scene')[0];
    if (!first) {
      throw new RowanError('The project has no scenes to run');
    }
    return first.id;
  }

  private loadSceneAsset(reference: string): Scene {
    const record = this.assets.resolve(reference, 'scene');
    if (!record) {
      throw new RowanError(`Scene "${reference}" does not exist`);
    }
    let data: unknown;
    try {
      data = JSON.parse(this.assets.getText(record.id));
    } catch (error) {
      throw new RowanError(`Scene "${record.name}" is not valid JSON`, { cause: error });
    }
    return this.parseScene(data, `scene "${record.name}"`);
  }

  private parseScene(data: unknown, label: string): Scene {
    return deserializeScene(data, {
      onWarning: (message) => this.logger.warn(`While loading ${label}: ${message}`),
    });
  }

  private switchScene(reference: string): void {
    let scene: Scene;
    try {
      scene = this.loadSceneAsset(reference);
    } catch (error) {
      // A bad scene name must not take the running scene down with it.
      this.logger.error(error instanceof Error ? error.message : String(error));
      return;
    }
    this.runtime?.stop();
    this.runtime = null;
    this.startScene(scene);
  }

  private startScene(scene: Scene): void {
    const { rendering, physics } = this.project.settings;
    const { gravity } = physics;
    // What is anchored to the screen is placed in pixels of the project's resolution.
    scene.screenSize.set(rendering.width, rendering.height);
    this.time.elapsed = 0;
    this.time.frameCount = 0;
    this.time.deltaTime = 0;
    this.time.unscaledDeltaTime = 0;
    this.accumulator = 0;

    this.runtime = new SceneRuntime(scene, {
      assets: this.assets,
      audio: this.audio,
      input: this.input,
      time: this.time,
      logger: this.logger,
      scriptLoader: this.scriptLoader,
      gravity: new Vec2(gravity[0], gravity[1]),
      getCameraView: () => this.getCameraView(),
      requestSceneLoad: (next) => this.requestSceneLoad(next),
    });
    this.runtime.start();
    this.onSceneLoaded.emit(scene);
  }

  /** The renderer the game draws with. */
  get renderTarget(): Renderer2D {
    return this.renderer;
  }
}
