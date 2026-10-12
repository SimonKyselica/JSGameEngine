import { strToU8, zipSync, type Zippable } from 'fflate';
import { createGameBundle, RowanError, type Project } from '@rowan/core';
import { buildScriptBundle } from '@rowan/core/compiler';
import { createPlayerHtml } from '@rowan/runtime';

/**
 * - `folder`: a zip with `index.html`, the player and the game's files, to upload to any
 *   static web host.
 * - `single-file`: one HTML page with everything embedded, which also runs when opened
 *   straight from disk.
 */
export type ExportFormat = 'folder' | 'single-file';

export interface ExportedGame {
  readonly fileName: string;
  readonly mimeType: string;
  readonly data: Uint8Array;
}

/**
 * Builds the distributable version of a game: the stripped player plus the project's
 * assets and precompiled scripts. Nothing of the editor is included.
 *
 * @param playerSource The contents of the built `rowan-player.js`.
 */
export function exportGame(
  project: Project,
  playerSource: string,
  format: ExportFormat,
): ExportedGame {
  const { settings, assets } = project;
  if (assets.list('scene').length === 0) {
    throw new RowanError('The project has no scene to start in. Create a scene first.');
  }
  // Compiling first means a script error stops the export before anything is produced.
  const scriptBundle = buildScriptBundle(assets);
  const baseName = toFileName(settings.name);

  if (format === 'single-file') {
    const { bundle } = createGameBundle(project, { inlineBinaryAssets: true });
    const html = createPlayerHtml({
      title: settings.name,
      inline: { playerSource, scriptBundle, bundle },
    });
    return { fileName: `${baseName}.html`, mimeType: 'text/html', data: strToU8(html) };
  }

  const { bundle, files } = createGameBundle(project, { inlineBinaryAssets: false });
  const entries: Zippable = {
    'index.html': strToU8(createPlayerHtml({ title: settings.name })),
    'rowan-player.js': strToU8(playerSource),
    'game/game.json': strToU8(JSON.stringify(bundle)),
    'game/scripts.js': strToU8(scriptBundle),
  };
  for (const [path, data] of files) {
    // Images and audio are already compressed, so they are stored as they are.
    entries[`game/${path}`] = [data, { level: 0 }];
  }
  return {
    fileName: `${baseName}.zip`,
    mimeType: 'application/zip',
    data: zipSync(entries, { level: 6 }),
  };
}

/** Turns a project name into a safe, readable file name without an extension. */
export function toFileName(name: string): string {
  const slug = name
    .normalize('NFKD')
    .replace(/[^\w\s-]/g, '')
    .trim()
    .replace(/[\s_]+/g, '-')
    .toLowerCase();
  return slug === '' ? 'game' : slug;
}
