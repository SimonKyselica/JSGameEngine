import {
  describeError,
  Game,
  serializeScene,
  type AudioBackend,
  type ImageDecoder,
  type InputState,
  type Renderer2D,
  type StorageBackend,
  type TextRasterizer,
} from '@rowan/core';
import { SourceScriptProvider } from '@rowan/core/compiler';
import type { EditorSession } from './editorSession';

export type PlayState = 'stopped' | 'starting' | 'playing' | 'paused';

/** What play mode needs from the viewport it runs in. */
export interface PlayDependencies {
  readonly renderer: Renderer2D;
  readonly audioBackend: AudioBackend;
  readonly imageDecoder: ImageDecoder;
  readonly textRasterizer: TextRasterizer;
  /** Where the game's save data is kept between plays. */
  readonly storage: StorageBackend;
  /** Connects the game's input to the viewport and returns a function that disconnects it. */
  attachInput(input: InputState): () => void;
}

/**
 * Runs the scene that is being edited, the way the Play button in Unity does: the game
 * works on a copy of the scene, so everything it changes is gone again after Stop.
 */
export class PlayController {
  private currentState: PlayState = 'stopped';
  private currentGame: Game | null = null;
  private dependencies: PlayDependencies | null = null;
  private detachInput: (() => void) | null = null;

  constructor(private readonly session: EditorSession) {}

  get state(): PlayState {
    return this.currentState;
  }

  /** The running game, or `null` while stopped or still starting. */
  get game(): Game | null {
    return this.currentGame;
  }

  /** True while a game exists, whether it is running or paused. */
  get isActive(): boolean {
    return this.currentGame !== null;
  }

  /** Called by the viewport once it can render, and with `null` when it goes away. */
  setDependencies(dependencies: PlayDependencies | null): void {
    if (!dependencies) {
      this.stop();
    }
    this.dependencies = dependencies;
  }

  async start(): Promise<void> {
    const { session, dependencies } = this;
    if (this.currentState !== 'stopped') {
      return;
    }
    if (!dependencies) {
      session.logger.error('Cannot play: the viewport is not ready');
      return;
    }

    this.currentState = 'starting';
    session.console.clear();
    session.notify();

    const game = new Game({
      project: session.project,
      renderer: dependencies.renderer,
      audioBackend: dependencies.audioBackend,
      imageDecoder: dependencies.imageDecoder,
      textRasterizer: dependencies.textRasterizer,
      storage: dependencies.storage,
      scripts: new SourceScriptProvider(session.project.assets),
      logger: session.logger,
    });
    try {
      await game.start({ sceneData: serializeScene(session.scene) });
    } catch (error) {
      game.dispose();
      session.logger.error(`Could not start the game: ${describeError(error)}`);
      this.currentState = 'stopped';
      session.notify();
      return;
    }
    // Stop may have been pressed while the assets were loading.
    if (this.currentState !== 'starting') {
      game.dispose();
      return;
    }

    this.currentGame = game;
    this.detachInput = dependencies.attachInput(game.input);
    game.audio.setPaused(false);
    this.currentState = 'playing';
    session.notify();
  }

  stop(): void {
    if (this.currentState === 'stopped') {
      return;
    }
    this.detachInput?.();
    this.detachInput = null;
    this.currentGame?.dispose();
    this.currentGame = null;
    this.currentState = 'stopped';
    this.session.handlePlayStopped();
  }

  togglePause(): void {
    const game = this.currentGame;
    if (!game) {
      return;
    }
    this.currentState = this.currentState === 'paused' ? 'playing' : 'paused';
    game.audio.setPaused(this.currentState === 'paused');
    this.session.notify();
  }

  /** Advances a paused game by one fixed step. */
  step(): void {
    const game = this.currentGame;
    if (game && this.currentState === 'paused') {
      this.advance(game, game.time.fixedDeltaTime);
      this.session.notify();
    }
  }

  /** Advances a playing game. Called once per frame by the viewport. */
  update(deltaSeconds: number): void {
    if (this.currentGame && this.currentState === 'playing') {
      this.advance(this.currentGame, deltaSeconds);
    }
  }

  private advance(game: Game, deltaSeconds: number): void {
    try {
      game.update(deltaSeconds);
    } catch (error) {
      // Script errors are caught inside the game; reaching this means an engine failure.
      this.session.logger.error(`The game stopped because of an error: ${describeError(error)}`);
      this.stop();
    }
  }
}
