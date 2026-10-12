import {
  attachDomInput,
  computeFitRect,
  consoleSink,
  decodeImageInBrowser,
  describeError,
  Game,
  GameLoop,
  loadGameBundle,
  Logger,
  NullAudioBackend,
  PrecompiledScriptProvider,
  RowanError,
  WebAudioBackend,
  WebGL2Renderer,
  type AudioBackend,
  type ImageDecoder,
  type ModuleFactory,
  type Renderer2D,
} from '@rowan/core';

/** Where exported games register their compiled scripts. Must match the script compiler. */
const SCRIPT_BUNDLE_GLOBAL = '__ROWAN_SCRIPTS__';
/** Rendering above this pixel ratio costs a lot of fill rate for little visible gain. */
const MAX_PIXEL_RATIO = 2;

export interface PlayerOptions {
  /** The element the game fills. The game keeps its aspect ratio inside it. */
  readonly container: HTMLElement;
  /** The game bundle manifest, or the URL of its JSON file. */
  readonly bundle: unknown;
  /** Compiled scripts by asset id. Defaults to the ones registered by the script bundle. */
  readonly scripts?: Readonly<Record<string, ModuleFactory>>;
  /** Replaces the WebGL2 renderer, for embedding the player in tests or other hosts. */
  readonly createRenderer?: (canvas: HTMLCanvasElement) => Renderer2D;
  /** Replaces the Web Audio backend. */
  readonly createAudioBackend?: () => AudioBackend;
  /** Replaces the browser image decoder. */
  readonly imageDecoder?: ImageDecoder;
}

export interface Player {
  readonly game: Game;
  readonly canvas: HTMLCanvasElement;
  /** Stops the game and removes everything the player added to the page. */
  dispose(): void;
}

/**
 * Loads a game bundle and runs it inside `container`. Rejects when the game cannot
 * start; the reason is also shown in the container so players are not left with a
 * blank page.
 */
export async function bootGame(options: PlayerOptions): Promise<Player> {
  const { container } = options;
  const status = document.createElement('div');
  Object.assign(status.style, {
    position: 'absolute',
    inset: '0',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: '24px',
    boxSizing: 'border-box',
    textAlign: 'center',
    color: '#d0d4dc',
    font: '16px system-ui, sans-serif',
  });
  status.setAttribute('role', 'status');
  status.textContent = 'Loading…';
  if (getComputedStyle(container).position === 'static') {
    container.style.position = 'relative';
  }
  container.append(status);

  try {
    const player = await startPlayer(options);
    status.remove();
    return player;
  } catch (error) {
    status.textContent = `This game could not start: ${describeError(error)}`;
    throw error;
  }
}

async function startPlayer(options: PlayerOptions): Promise<Player> {
  const { container } = options;
  const logger = new Logger();
  logger.addSink(consoleSink);

  const { manifest, baseUrl } = await resolveBundle(options.bundle);
  const project = await loadGameBundle(manifest, async (path) => {
    const response = await fetch(new URL(path, baseUrl));
    if (!response.ok) {
      throw new RowanError(`Could not load "${path}" (HTTP ${response.status})`);
    }
    return new Uint8Array(await response.arrayBuffer());
  });
  document.title = project.settings.name;

  const canvas = document.createElement('canvas');
  Object.assign(canvas.style, { position: 'absolute', display: 'block', touchAction: 'none' });
  canvas.tabIndex = 0;
  canvas.setAttribute('aria-label', project.settings.name);

  const cleanups: (() => void)[] = [];
  const dispose = (): void => {
    for (const cleanup of cleanups.splice(0).reverse()) {
      cleanup();
    }
  };

  try {
    const renderer = options.createRenderer?.(canvas) ?? new WebGL2Renderer(canvas);
    cleanups.push(() => renderer.dispose());
    const audioBackend = (options.createAudioBackend ?? createAudioBackend)();
    cleanups.push(() => audioBackend.dispose());

    const game = new Game({
      project,
      renderer,
      audioBackend,
      imageDecoder: options.imageDecoder ?? decodeImageInBrowser,
      scripts: new PrecompiledScriptProvider(options.scripts ?? getRegisteredScripts()),
      logger,
    });
    cleanups.push(() => game.dispose());

    const { width, height } = project.settings.rendering;
    const layout = (): void => {
      const rect = computeFitRect(container.clientWidth, container.clientHeight, width / height);
      Object.assign(canvas.style, {
        left: `${rect.x}px`,
        top: `${rect.y}px`,
        width: `${rect.width}px`,
        height: `${rect.height}px`,
      });
      const pixelRatio = Math.min(window.devicePixelRatio || 1, MAX_PIXEL_RATIO);
      renderer.resize(rect.width * pixelRatio, rect.height * pixelRatio);
    };
    container.append(canvas);
    cleanups.push(() => canvas.remove());
    layout();
    cleanups.push(observeResize(container, layout));

    await game.start();
    cleanups.push(attachDomInput(game.input, canvas));

    const loop = new GameLoop((deltaSeconds) => {
      game.update(deltaSeconds);
      game.render();
    });
    loop.start();
    cleanups.push(() => loop.stop());

    // A hidden tab gets no animation frames; pausing the audio keeps it in step.
    const handleVisibility = (): void => {
      const hidden = document.visibilityState === 'hidden';
      game.audio.setPaused(hidden);
      if (hidden) {
        loop.stop();
        game.input.releaseAll();
      } else {
        loop.start();
      }
    };
    document.addEventListener('visibilitychange', handleVisibility);
    cleanups.push(() => document.removeEventListener('visibilitychange', handleVisibility));

    return { game, canvas, dispose };
  } catch (error) {
    dispose();
    throw error;
  }
}

async function resolveBundle(bundle: unknown): Promise<{ manifest: unknown; baseUrl: string }> {
  if (typeof bundle !== 'string') {
    return { manifest: bundle, baseUrl: document.baseURI };
  }
  const url = new URL(bundle, document.baseURI);
  const response = await fetch(url);
  if (!response.ok) {
    throw new RowanError(`Could not load the game data (HTTP ${response.status})`);
  }
  return { manifest: (await response.json()) as unknown, baseUrl: url.href };
}

function createAudioBackend(): AudioBackend {
  try {
    return new WebAudioBackend();
  } catch {
    // A game without sound is better than no game.
    return new NullAudioBackend();
  }
}

function getRegisteredScripts(): Record<string, ModuleFactory> {
  const registered = (globalThis as Record<string, unknown>)[SCRIPT_BUNDLE_GLOBAL];
  return (registered as Record<string, ModuleFactory> | undefined) ?? {};
}

function observeResize(element: HTMLElement, onResize: () => void): () => void {
  if (typeof ResizeObserver === 'undefined') {
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }
  const observer = new ResizeObserver(onResize);
  observer.observe(element);
  return () => observer.disconnect();
}
