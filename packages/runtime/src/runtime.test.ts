// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  Camera,
  createDefaultSettings,
  createGameBundle,
  decodeImageHeadless,
  encodePng,
  HeadlessRenderer,
  HeadlessTextRasterizer,
  NullAudioBackend,
  Project,
  Scene,
  ScriptComponent,
  serializeScene,
  SpriteRenderer,
  TextRenderer,
  type ModuleFactory,
} from '@rowan/core';
import { buildScriptBundle, SCRIPT_BUNDLE_GLOBAL } from '@rowan/core/compiler';
import { bootGame, createPlayerHtml, type PlayerOptions } from './index';

const globals = globalThis as Record<string, unknown>;

/** A small game: a camera, a title, a textured sprite and a script that counts its updates. */
function createGame(): Project {
  const project = new Project(createDefaultSettings('Tiny Game'));
  const { assets } = project;
  const texture = assets.create({
    name: 'hero.png',
    type: 'texture',
    mimeType: 'image/png',
    data: encodePng(4, 4, new Uint8Array(64)),
    meta: { width: 4, height: 4 },
  });
  const script = assets.create({
    name: 'Ticker.ts',
    type: 'script',
    mimeType: 'text/typescript',
    data: `import { Behaviour } from 'rowan';
           export default class Ticker extends Behaviour {
             onUpdate() { globalThis.__ticks = (globalThis.__ticks ?? 0) + 1; }
           }`,
  });

  const scene = new Scene('Main');
  scene.createEntity('Camera').addComponent(Camera);
  scene.createEntity('Title').addComponent(TextRenderer, { text: 'Tiny Game' });
  const hero = scene.createEntity('Hero');
  hero.addComponent(SpriteRenderer, { texture: texture.id });
  hero.addComponent(ScriptComponent, {
    scripts: [{ script: script.id, enabled: true, properties: {} }],
  });
  project.settings.startScene = assets.create({
    name: 'Main.scene',
    type: 'scene',
    mimeType: 'application/json',
    data: JSON.stringify(serializeScene(scene)),
  }).id;
  return project;
}

/** Evaluates a project's script bundle the way an exported page does. */
function compileScripts(project: Project): Record<string, ModuleFactory> {
  delete globals[SCRIPT_BUNDLE_GLOBAL];
  // eslint-disable-next-line @typescript-eslint/no-implied-eval, @typescript-eslint/no-unsafe-call
  new Function(buildScriptBundle(project.assets))();
  return globals[SCRIPT_BUNDLE_GLOBAL] as Record<string, ModuleFactory>;
}

function createOptions(overrides: Partial<PlayerOptions> & { bundle: unknown }): PlayerOptions & {
  renderer: HeadlessRenderer;
  audio: NullAudioBackend;
  text: HeadlessTextRasterizer;
} {
  const container = document.createElement('div');
  document.body.append(container);
  const renderer = new HeadlessRenderer();
  const audio = new NullAudioBackend();
  const text = new HeadlessTextRasterizer();
  return {
    container,
    createRenderer: () => renderer,
    createAudioBackend: () => audio,
    imageDecoder: decodeImageHeadless,
    textRasterizer: text,
    renderer,
    audio,
    text,
    ...overrides,
  };
}

/** Lets pending animation frames run. */
const nextFrames = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 60));

afterEach(() => {
  document.body.innerHTML = '';
  delete globals[SCRIPT_BUNDLE_GLOBAL];
  delete globals.__ticks;
  vi.unstubAllGlobals();
});

describe('bootGame', () => {
  it('runs a game from an embedded bundle', async () => {
    const project = createGame();
    compileScripts(project);
    const { bundle } = createGameBundle(project, { inlineBinaryAssets: true });
    const options = createOptions({ bundle: JSON.parse(JSON.stringify(bundle)) });

    const player = await bootGame(options);
    expect(player.game.isRunning).toBe(true);
    expect(player.game.scene.name).toBe('Main');
    expect(options.container.contains(player.canvas)).toBe(true);
    expect(options.container.querySelector('[role="status"]')).toBeNull();
    expect(document.title).toBe('Tiny Game');
    expect(options.renderer.textureCount).toBe(1);

    await nextFrames();
    expect(globals.__ticks as number).toBeGreaterThan(0);
    // The sprite and the title, whose text became a texture of its own.
    expect(options.renderer.quads).toHaveLength(2);
    expect(options.text.rasterized.map((entry) => entry.text)).toEqual(['Tiny Game']);
    expect(options.renderer.textureCount).toBe(2);

    player.dispose();
    expect(player.game.isRunning).toBe(false);
    expect(options.container.contains(player.canvas)).toBe(false);
    expect(options.renderer.textureCount).toBe(0);
    const ticks = globals.__ticks;
    await nextFrames();
    expect(globals.__ticks).toBe(ticks);
  });

  it('draws text with a canvas by default, and keeps running where there is none', async () => {
    // happy-dom has canvases but no 2D context, like a browser in which canvas drawing is blocked.
    const errors = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const project = createGame();
    compileScripts(project);
    const { bundle } = createGameBundle(project, { inlineBinaryAssets: true });
    const options = createOptions({ bundle: JSON.parse(JSON.stringify(bundle)) });

    const player = await bootGame({ ...options, textRasterizer: undefined });
    await nextFrames();
    expect(player.game.isRunning).toBe(true);
    expect(options.text.rasterized).toEqual([]);
    expect(options.renderer.quads).toHaveLength(1);
    expect(errors.mock.calls).toEqual([
      [expect.stringMatching(/^Text could not be drawn: .*2D canvas/)],
    ]);
    player.dispose();
    errors.mockRestore();
  });

  it('fetches the manifest and its asset files relative to the manifest URL', async () => {
    const project = createGame();
    const scripts = compileScripts(project);
    const { bundle, files } = createGameBundle(project, { inlineBinaryAssets: false });
    const requested: string[] = [];
    vi.stubGlobal('fetch', (input: URL | string) => {
      const url = new URL(input, document.baseURI);
      requested.push(url.pathname);
      if (url.pathname === '/play/game/game.json') {
        return Promise.resolve(new Response(JSON.stringify(bundle)));
      }
      const file = files.get(url.pathname.replace('/play/game/', ''));
      return Promise.resolve(
        file ? new Response(file as Uint8Array<ArrayBuffer>) : new Response(null, { status: 404 }),
      );
    });

    const player = await bootGame(createOptions({ bundle: '/play/game/game.json', scripts }));
    expect(requested[0]).toBe('/play/game/game.json');
    expect(requested[1]).toMatch(/^\/play\/game\/assets\/.+\.png$/);
    expect(player.game.isRunning).toBe(true);
    player.dispose();
  });

  it('feeds keyboard input to the game and pauses audio while the page is hidden', async () => {
    const project = createGame();
    const scripts = compileScripts(project);
    const { bundle } = createGameBundle(project, { inlineBinaryAssets: true });
    const options = createOptions({ bundle, scripts });
    const player = await bootGame(options);

    window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyW' }));
    expect(player.game.input.keysDown.has('KeyW')).toBe(true);

    const visibility = vi.spyOn(document, 'visibilityState', 'get');
    visibility.mockReturnValue('hidden');
    document.dispatchEvent(new Event('visibilitychange'));
    expect(options.audio.suspended).toBe(true);
    expect(player.game.input.keysDown.size).toBe(0);

    visibility.mockReturnValue('visible');
    document.dispatchEvent(new Event('visibilitychange'));
    expect(options.audio.suspended).toBe(false);
    player.dispose();
  });

  it.each([
    [{ format: 'nonsense' }, 'expected format "rowan.game"'],
    ['/missing/game.json', 'Could not load the game data (HTTP 404)'],
  ])('shows why the game could not start for %j', async (bundle, message) => {
    vi.stubGlobal('fetch', () => Promise.resolve(new Response(null, { status: 404 })));
    const options = createOptions({ bundle });
    await expect(bootGame(options)).rejects.toThrow(message);
    expect(options.container.textContent).toContain('This game could not start:');
    expect(options.container.textContent).toContain(message);
    expect(options.container.querySelector('canvas')).toBeNull();
  });

  it('cleans up when the game fails after the canvas was created', async () => {
    const project = createGame();
    const { bundle } = createGameBundle(project, { inlineBinaryAssets: true });
    const options = createOptions({
      bundle,
      createRenderer: () => {
        throw new Error('WebGL2 is not available in this browser');
      },
    });
    await expect(bootGame(options)).rejects.toThrow('WebGL2 is not available');
    expect(options.container.querySelector('canvas')).toBeNull();
    expect(options.container.textContent).toContain('WebGL2 is not available');
  });

  it('reports a missing asset file', async () => {
    const project = createGame();
    const scripts = compileScripts(project);
    const { bundle } = createGameBundle(project, { inlineBinaryAssets: false });
    vi.stubGlobal('fetch', () => Promise.resolve(new Response(null, { status: 404 })));
    await expect(bootGame(createOptions({ bundle, scripts }))).rejects.toThrow(/HTTP 404/);
  });
});

describe('createPlayerHtml', () => {
  it('links the player, the scripts and the game data for a folder export', () => {
    const html = createPlayerHtml({ title: 'My Game' });
    expect(html).toContain('<title>My Game</title>');
    expect(html).toContain('<script src="game/scripts.js"></script>');
    expect(html).toContain('<script src="rowan-player.js"></script>');
    expect(html).toContain('bundle: "game/game.json"');
    expect(html.indexOf('game/scripts.js')).toBeLessThan(html.indexOf('rowan-player.js'));
    expect(html.startsWith('<!doctype html>')).toBe(true);
  });

  it('escapes the title and only accepts hex background colors', () => {
    const html = createPlayerHtml({
      title: '<script>alert("x")</script> & co',
      backgroundColor: 'red; } body { display: none',
    });
    expect(html).toContain('&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt; &amp; co');
    expect(html).toContain('background: #000000;');
    expect(createPlayerHtml({ title: 'T', backgroundColor: '#1a2B3c' })).toContain(
      'background: #1a2B3c;',
    );
  });

  it('embeds everything for a single-file export without letting content end the script', () => {
    const html = createPlayerHtml({
      title: 'Solo',
      inline: {
        playerSource: 'var RowanPlayer = { tag: "</script><!-- x" };',
        scriptBundle: 'var s = "</SCRIPT>";',
        bundle: { name: '</script><script>alert(1)</script>', line: 'a\u2028b' },
      },
    });
    expect(html).not.toContain('src=');
    // Three inline scripts: compiled game scripts, the player, and the boot call.
    expect(html.match(/<script>/g)).toHaveLength(3);
    expect(html.match(/<\/script>/g)).toHaveLength(3);
    expect(html).toContain('var s = "<\\/SCRIPT>";');
    expect(html).toContain('"<\\/script><\\!-- x"');
    expect(html).toContain('\\u003c/script>\\u003cscript>alert(1)');
    expect(html).toContain('a\\u2028b');
  });

  it('embeds a bundle that survives the round trip through the page', () => {
    const bundle = { text: 'if (a < b) { "</script>" }', nested: [1, { ok: true }] };
    const html = createPlayerHtml({
      title: 'Solo',
      inline: { playerSource: '', scriptBundle: '', bundle },
    });
    const expression = /bundle: (.*) \}\)\.catch/.exec(html)![1]!;
    // eslint-disable-next-line @typescript-eslint/no-implied-eval, @typescript-eslint/no-unsafe-call
    expect(new Function(`return ${expression};`)()).toEqual(bundle);
  });
});
