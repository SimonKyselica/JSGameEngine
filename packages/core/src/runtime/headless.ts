import type { Project } from '../assets/project';
import { NullAudioBackend } from '../audio/audioBackend';
import { Logger, type LogEntry } from '../core/logger';
import { decodeImageHeadless } from '../renderer/imageDecoder';
import { HeadlessRenderer } from '../renderer/renderer2d';
import type { ScriptFactoryProvider } from '../scripting/scriptModuleLoader';
import { Game } from './game';

export interface HeadlessGame {
  readonly game: Game;
  readonly renderer: HeadlessRenderer;
  readonly audio: NullAudioBackend;
  /** Everything the game has logged so far. */
  readonly logs: LogEntry[];
}

/**
 * Creates a game that runs without a display or audio device. The renderer and audio
 * backend record what the game does, which is what automated tests assert on.
 */
export function createHeadlessGame(project: Project, scripts: ScriptFactoryProvider): HeadlessGame {
  const { width, height } = project.settings.rendering;
  const renderer = new HeadlessRenderer(width, height);
  const audio = new NullAudioBackend();
  const logs: LogEntry[] = [];
  const logger = new Logger();
  logger.addSink((entry) => logs.push(entry));

  const game = new Game({
    project,
    renderer,
    audioBackend: audio,
    imageDecoder: decodeImageHeadless,
    scripts,
    logger,
  });
  return { game, renderer, audio, logs };
}
