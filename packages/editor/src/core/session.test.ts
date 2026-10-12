import { describe, expect, it, vi } from 'vitest';
import {
  BoxCollider2D,
  Camera,
  CircleCollider2D,
  decodeImageHeadless,
  encodePng,
  HeadlessRenderer,
  Identity,
  NullAudioBackend,
  Project,
  Rect,
  Rigidbody2D,
  Scene,
  ScriptComponent,
  SpriteRenderer,
  Transform,
  Vec2,
  type InputState,
} from '@rowan/core';
import { EditorCamera } from './editorCamera';
import { EditorSession } from './editorSession';
import { createPresetEntity, ENTITY_PRESETS } from './entityPresets';
import { filterEntitiesByName } from './hierarchyFilter';
import { applyGizmoDrag, getGizmoAxes, GIZMO, hitTestGizmo, type GizmoDragStart } from './gizmos';
import { drawOverlay, getGizmoLayout } from './overlay';
import { getEntityBounds, getSpriteCorners, pickEntity } from './picking';
import type { PlayDependencies } from './playController';
import { MemoryProjectStore } from './projectStore';
import { createStarterProject } from './templates';

function createSession(): EditorSession {
  return new EditorSession(createStarterProject('Test'));
}

function createPlayDependencies(): PlayDependencies & {
  renderer: HeadlessRenderer;
  audioBackend: NullAudioBackend;
  inputs: InputState[];
  detached: number;
} {
  const dependencies = {
    renderer: new HeadlessRenderer(),
    audioBackend: new NullAudioBackend(),
    imageDecoder: decodeImageHeadless,
    inputs: [] as InputState[],
    detached: 0,
    attachInput(input: InputState) {
      dependencies.inputs.push(input);
      return () => {
        dependencies.detached++;
      };
    },
  };
  return dependencies;
}

const entityNames = (scene: Scene): string[] =>
  scene.entitiesInHierarchyOrder().map((entity) => entity.name);

describe('EditorSession startup', () => {
  it('opens the start scene of the project', () => {
    const session = createSession();
    expect(session.scene.name).toBe('Main');
    expect(session.sceneAssetId).toBe(session.project.settings.startScene);
    expect(session.activeScene).toBe(session.scene);
    expect(session.dirty).toBe(false);
    expect(session.tool).toBe('move');
  });

  it('creates a scene for a project that has none and repairs a stale start scene', () => {
    const empty = new Project();
    const session = new EditorSession(empty);
    expect(empty.assets.list('scene')).toHaveLength(1);
    expect(empty.settings.startScene).toBe(session.sceneAssetId);
    expect(session.scene.findByName('Main Camera')).not.toBeNull();

    const stale = createStarterProject('Stale');
    const sceneId = stale.settings.startScene;
    stale.settings.startScene = 'gone';
    expect(new EditorSession(stale).sceneAssetId).toBe(sceneId);
    expect(stale.settings.startScene).toBe(sceneId);
  });

  it('opens an empty scene and reports it when a scene asset is damaged', () => {
    const project = createStarterProject('Damaged');
    project.assets.setData(project.settings.startScene!, '{broken');
    const session = new EditorSession(project);
    expect(session.scene.name).toBe('Main');
    expect(session.scene.findByName('Main Camera')).not.toBeNull();
    expect(session.console.entries[0]!.message).toContain('Could not open "Scenes/Main.scene"');
  });
});

describe('EditorSession selection and tools', () => {
  it('selects entities and assets and notifies the UI', () => {
    const session = createSession();
    const changed = vi.fn();
    session.subscribe(changed);
    const player = session.scene.findByName('Player')!;

    session.selectEntity(player);
    expect(session.selectedEntity).toBe(player);
    expect(session.selectedAsset).toBeNull();

    const script = session.project.assets.list('script')[0]!;
    session.select({ kind: 'asset', id: script.id });
    expect(session.selectedAsset).toBe(script);
    expect(session.selectedEntity).toBeNull();

    session.selectEntity(null);
    session.setTool('rotate');
    expect(session.selection).toBeNull();
    expect(session.tool).toBe('rotate');
    expect(changed).toHaveBeenCalledTimes(4);
    expect(session.getVersion()).toBe(4);
  });
});

describe('EditorSession editing', () => {
  it('records edits for undo and redo and marks the project dirty', () => {
    const session = createSession();
    const player = (): Vec2 => session.scene.findByName('Player')!.transform.position;

    session.edit(() => player().set(5, 5));
    expect(session.dirty).toBe(true);
    expect([session.canUndo, session.canRedo]).toEqual([true, false]);

    session.undo();
    expect(player().toArray()).toEqual([0, 0]);
    expect([session.canUndo, session.canRedo]).toEqual([false, true]);
    session.redo();
    expect(player().toArray()).toEqual([5, 5]);
    session.undo();
    session.undo();
    expect(player().toArray()).toEqual([0, 0]);
  });

  it('keeps the selection across undo when the entity still exists, and drops it otherwise', () => {
    const session = createSession();
    session.selectEntity(session.scene.findByName('Player'));
    session.edit(() => session.scene.findByName('Ground')!.destroy());
    session.undo();
    expect(session.selectedEntity?.name).toBe('Player');

    session.createEntity('sprite');
    expect(session.selectedEntity?.name).toBe('Sprite');
    session.undo();
    expect(session.selection).toBeNull();
  });

  it('rolls back and reports an edit that throws', () => {
    const session = createSession();
    session.edit(() => {
      session.scene.findByName('Player')!.name = 'Half done';
      throw new Error('boom');
    });
    expect(session.scene.findByName('Player')).not.toBeNull();
    expect(session.canUndo).toBe(false);
    expect(session.dirty).toBe(false);
    expect(session.console.entries.at(-1)!.message).toBe('The change could not be applied: boom');
  });

  it('turns a drag into a single undo step, and nothing when it changed nothing', () => {
    const session = createSession();
    const player = session.scene.findByName('Player')!;

    session.beginDrag();
    session.endDrag(false);
    expect(session.canUndo).toBe(false);

    session.beginDrag();
    player.transform.position.x = 1;
    player.transform.position.x = 2;
    session.endDrag(true);
    expect(session.dirty).toBe(true);
    session.undo();
    expect(session.scene.findByName('Player')!.transform.position.x).toBe(0);
    expect(session.canUndo).toBe(false);
  });

  it('creates preset entities, optionally under a parent or at a position', () => {
    const session = createSession();
    session.createEntity('sprite', null, new Vec2(3, 4));
    const sprite = session.selectedEntity!;
    expect(sprite.transform.position.toArray()).toEqual([3, 4]);

    session.createEntity('empty', sprite, new Vec2(9, 9));
    expect(session.selectedEntity!.parent).toBe(sprite);
    expect(session.selectedEntity!.transform.position.toArray()).toEqual([0, 0]);
  });

  it('deletes, duplicates and renames entities', () => {
    const session = createSession();
    const ground = session.scene.findByName('Ground')!;
    session.selectEntity(ground);
    session.duplicateEntity(ground);
    expect(session.selectedEntity!.name).toBe('Ground (1)');

    session.renameEntity(session.selectedEntity!, '  Floor  ');
    expect(session.selectedEntity!.name).toBe('Floor');
    const steps = session.getVersion();
    session.renameEntity(session.selectedEntity!, '   ');
    session.renameEntity(session.selectedEntity!, 'Floor');
    expect(session.getVersion()).toBe(steps);

    session.deleteEntity(session.selectedEntity!);
    expect(session.selection).toBeNull();
    expect(session.scene.findByName('Floor')).toBeNull();
    session.undo();
    expect(session.scene.findByName('Floor')).not.toBeNull();
  });

  it('merges the keystrokes of one rename into one undo step', () => {
    const session = createSession();
    const player = session.scene.findByName('Player')!;
    for (const name of ['H', 'He', 'Her', 'Hero']) {
      session.renameEntity(session.scene.findByUuid(player.uuid)!, name);
    }
    session.undo();
    expect(session.scene.findByUuid(player.uuid)!.name).toBe('Player');
  });

  it('moves entities in the hierarchy and ignores moves that would create a cycle', () => {
    const session = createSession();
    const { scene } = session;
    const ground = scene.findByName('Ground')!;
    const player = scene.findByName('Player')!;

    session.moveEntity(player, ground);
    expect(player.parent).toBe(ground);
    const version = session.getVersion();
    session.moveEntity(ground, player);
    expect(ground.parent).toBeNull();
    expect(session.getVersion()).toBe(version);

    session.moveEntity(player, null, 0);
    expect(entityNames(scene)[0]).toBe('Player');
  });

  it('reorders siblings to the position the user dropped at', () => {
    const session = new EditorSession(new Project());
    const { scene } = session;
    scene.clear();
    const [a, b, c] = ['A', 'B', 'C'].map((name) => scene.createEntity(name));

    // Dropping A "before index 2" means between B and C.
    session.moveEntity(a!, null, 2);
    expect(entityNames(scene)).toEqual(['B', 'A', 'C']);
    session.moveEntity(c!, null, 0);
    expect(entityNames(scene)).toEqual(['C', 'B', 'A']);
    session.moveEntity(b!, null, 3);
    expect(entityNames(scene)).toEqual(['C', 'A', 'B']);
  });

  it('adds and removes components, protecting the built-in ones', () => {
    const session = createSession();
    const player = session.scene.findByName('Player')!;
    session.addComponent(player, CircleCollider2D);
    expect(player.hasComponent(CircleCollider2D)).toBe(true);

    const version = session.getVersion();
    session.addComponent(player, CircleCollider2D);
    session.removeComponent(player, Transform);
    session.removeComponent(player, Identity);
    session.removeComponent(player, Camera);
    expect(session.getVersion()).toBe(version);

    session.removeComponent(player, CircleCollider2D);
    expect(player.hasComponent(CircleCollider2D)).toBe(false);
  });

  it('attaches scripts, creating the Script component on demand', () => {
    const session = createSession();
    const ground = session.scene.findByName('Ground')!;
    const scriptId = session.project.assets.list('script')[0]!.id;
    session.addScript(ground, scriptId);
    session.addScript(ground, scriptId);
    expect(ground.requireComponent(ScriptComponent).scripts).toEqual([
      { script: scriptId, enabled: true, properties: {} },
      { script: scriptId, enabled: true, properties: {} },
    ]);
  });
});

describe('EditorSession clipboard', () => {
  it('pastes a copy right after the selected entity, with a unique name and new ids', () => {
    const session = createSession();
    const ground = session.scene.findByName('Ground')!;
    session.selectEntity(ground);
    expect(session.canPaste).toBe(false);

    session.copyEntity(ground);
    expect(session.canPaste).toBe(true);
    session.pasteEntity();

    const pasted = session.selectedEntity!;
    expect(pasted.name).toBe('Ground (1)');
    expect(pasted.uuid).not.toBe(ground.uuid);
    expect(pasted.transform.position.toArray()).toEqual(ground.transform.position.toArray());
    expect(pasted.hasComponent(BoxCollider2D)).toBe(true);
    expect(entityNames(session.scene).slice(0, 4)).toEqual([
      'Main Camera',
      'Ground',
      'Ground (1)',
      'Player',
    ]);
    expect(session.dirty).toBe(true);

    session.undo();
    expect(session.scene.findByName('Ground (1)')).toBeNull();
  });

  it('pastes several independent copies, children included', () => {
    const session = createSession();
    const player = session.scene.findByName('Player')!;
    session.edit(() => session.scene.createEntity('Hat', { parent: player }));
    session.copyEntity(player);
    // Changes made after copying must not leak into what is pasted.
    session.edit(() => {
      player.transform.position.set(9, 9);
    });

    session.selectEntity(player);
    session.pasteEntity();
    const first = session.selectedEntity!;
    session.pasteEntity();
    const second = session.selectedEntity!;

    expect([first.name, second.name]).toEqual(['Player (1)', 'Player (2)']);
    expect(first.transform.position.toArray()).toEqual([0, 0]);
    expect(first.children.map((child) => child.name)).toEqual(['Hat']);
    expect(first.children[0]!.uuid).not.toBe(second.children[0]!.uuid);
    first.transform.position.set(5, 5);
    expect(second.transform.position.toArray()).toEqual([0, 0]);
  });

  it('pastes at the end of the root without a selection, and beside a selected child', () => {
    const session = createSession();
    const { scene } = session;
    const ground = scene.findByName('Ground')!;
    const player = scene.findByName('Player')!;
    session.moveEntity(player, ground);
    session.copyEntity(scene.findByName('Main Camera')!);

    session.selectEntity(null);
    session.pasteEntity();
    expect(scene.rootEntities.at(-1)!.name).toBe('Main Camera (1)');

    session.selectEntity(player);
    session.pasteEntity();
    expect(session.selectedEntity!.parent).toBe(ground);
    expect(ground.children.map((child) => child.name)).toEqual(['Player', 'Main Camera']);
  });

  it('cuts an entity, which paste brings back and undo restores', () => {
    const session = createSession();
    const player = session.scene.findByName('Player')!;
    const originalUuid = player.uuid;
    session.selectEntity(player);
    session.cutEntity(player);
    expect(session.scene.findByName('Player')).toBeNull();
    expect(session.selection).toBeNull();

    session.pasteEntity();
    expect(session.selectedEntity!.name).toBe('Player');
    expect(session.selectedEntity!.hasComponent(ScriptComponent)).toBe(true);

    session.undo();
    session.undo();
    expect(session.scene.findByName('Player')!.uuid).toBe(originalUuid);
    expect(session.canPaste).toBe(true);
  });

  it('pastes into another scene of the project', () => {
    const session = createSession();
    session.copyEntity(session.scene.findByName('Player')!);
    session.createScene('Level 2');
    session.pasteEntity();
    expect(entityNames(session.scene)).toEqual(['Main Camera', 'Player']);
    expect(session.selectedEntity!.hasComponent(Rigidbody2D)).toBe(true);
  });

  it('does nothing when nothing was copied, and announces a copy so menus can update', () => {
    const session = createSession();
    const version = session.getVersion();
    session.pasteEntity();
    expect(session.getVersion()).toBe(version);
    expect(session.canUndo).toBe(false);

    session.copyEntity(session.scene.findByName('Ground')!);
    expect(session.getVersion()).toBe(version + 1);
    expect(session.dirty).toBe(false);
  });
});

describe('filterEntitiesByName', () => {
  it('matches part of a name, ignoring case and surrounding spaces, in hierarchy order', () => {
    const { scene } = createSession();
    const player = scene.findByName('Player')!;
    scene.createEntity('Crate Lid', { parent: player });
    const found = filterEntitiesByName(scene, '  cRaTe ').map((entity) => entity.name);
    // The lid is a child of the player, which is listed before the three crates.
    expect(found).toEqual(['Crate Lid', 'Crate', 'Crate', 'Crate']);
    expect(filterEntitiesByName(scene, 'a').map((entity) => entity.name)).toContain('Main Camera');
  });

  it('matches everything for a blank search and nothing for an unknown name', () => {
    const { scene } = createSession();
    expect(filterEntitiesByName(scene, '   ')).toHaveLength(scene.entityCount);
    expect(filterEntitiesByName(scene, 'zzz')).toEqual([]);
  });
});

describe('EditorSession scenes', () => {
  it('writes the edited scene into its asset only when it changed', () => {
    const session = createSession();
    const { assets } = session.project;
    const before = assets.getText(session.sceneAssetId);
    session.commitScene();
    expect(session.dirty).toBe(false);

    session.edit(() => session.scene.createEntity('Extra'));
    session.commitScene();
    expect(assets.getText(session.sceneAssetId)).not.toBe(before);
    expect(assets.getText(session.sceneAssetId)).toContain('"Extra"');
  });

  it('creates and switches scenes, keeping the changes of the one it leaves', () => {
    const session = createSession();
    const mainId = session.sceneAssetId;
    session.edit(() => session.scene.createEntity('Only In Main'));
    session.selectEntity(session.scene.findByName('Player'));

    const created = session.createScene('Level 2');
    expect(created.name).toBe('Scenes/Level 2.scene');
    expect(session.sceneAssetId).toBe(created.id);
    expect(entityNames(session.scene)).toEqual(['Main Camera']);
    expect(session.selection).toBeNull();
    expect(session.canUndo).toBe(false);

    session.openScene(mainId);
    expect(session.scene.findByName('Only In Main')).not.toBeNull();
    const scene = session.scene;
    session.openScene(mainId);
    session.openScene('not-a-scene');
    expect(session.scene).toBe(scene);
    expect(session.createScene('  ').name).toBe('Scenes/New Scene.scene');
  });
});

describe('EditorSession assets', () => {
  it('imports files, reporting the ones that fail', async () => {
    const session = createSession();
    const imported = await session.importFiles(
      [
        { name: 'hero.png', bytes: encodePng(2, 2, new Uint8Array(16)) },
        { name: 'notes.txt', bytes: new Uint8Array() },
      ],
      'Art',
      decodeImageHeadless,
    );
    expect(imported.map((record) => record.name)).toEqual(['Art/hero.png']);
    expect(session.dirty).toBe(true);
    expect(session.console.entries.map((entry) => [entry.level, entry.source])).toEqual([
      ['error', 'Import'],
      ['info', 'Import'],
    ]);
  });

  it('creates scripts from the template with a matching class name', () => {
    const session = createSession();
    const record = session.createScript('enemy ai.ts');
    expect(record.name).toBe('Scripts/enemy ai.ts');
    expect(session.project.assets.getText(record.id)).toContain('class EnemyAi extends Behaviour');
    expect(session.createScript('  ', '').name).toBe('NewScript.ts');
  });

  it('saves an entity as a prefab and instantiates it again', () => {
    const session = createSession();
    const player = session.scene.findByName('Player')!;
    const prefab = session.createPrefab(player);
    expect(prefab.name).toBe('Prefabs/Player.prefab');

    session.instantiatePrefab(prefab.id, new Vec2(4, 2));
    const copy = session.selectedEntity!;
    expect(copy).not.toBe(player);
    expect(copy.uuid).not.toBe(player.uuid);
    expect(copy.transform.position.toArray()).toEqual([4, 2]);
    expect(copy.hasComponent(Rigidbody2D)).toBe(true);

    session.undo();
    expect(session.scene.registry.count(Rigidbody2D)).toBe(4);
    session.instantiatePrefab('missing');
    session.instantiatePrefab(session.project.assets.list('script')[0]!.id);
    expect(session.canRedo).toBe(true);
  });

  it('creates a sprite entity from a texture', () => {
    const session = createSession();
    const texture = session.project.assets.create({
      name: 'Art/space ship.png',
      type: 'texture',
      mimeType: 'image/png',
      data: new Uint8Array(4),
    });
    session.createSprite(texture.id, new Vec2(1, 2));
    const sprite = session.selectedEntity!;
    expect(sprite.name).toBe('space ship');
    expect(sprite.requireComponent(SpriteRenderer).texture).toBe(texture.id);
    expect(sprite.transform.position.toArray()).toEqual([1, 2]);

    const count = session.scene.entityCount;
    session.createSprite('missing');
    expect(session.scene.entityCount).toBe(count);
  });

  it('renames and deletes assets, clearing a selection that pointed at them', () => {
    const session = createSession();
    const script = session.project.assets.list('script')[0]!;
    session.renameAsset(script.id, 'Scripts/Hero.ts');
    session.renameAsset(script.id, '   ');
    expect(script.name).toBe('Scripts/Hero.ts');

    session.select({ kind: 'asset', id: script.id });
    session.deleteAsset(script.id);
    expect(session.selection).toBeNull();
    expect(session.project.assets.has(script.id)).toBe(false);
  });

  it('never deletes the last scene, and moves on when the open scene is deleted', () => {
    const session = createSession();
    const mainId = session.sceneAssetId;
    session.deleteAsset(mainId);
    expect(session.project.assets.has(mainId)).toBe(true);
    expect(session.console.entries.at(-1)!.message).toBe(
      'The only scene of a project cannot be deleted',
    );

    const second = session.createScene('Second');
    session.openScene(mainId);
    session.deleteAsset(mainId);
    expect(session.project.assets.has(mainId)).toBe(false);
    expect(session.sceneAssetId).toBe(second.id);
    expect(session.project.settings.startScene).toBe(second.id);
    expect(session.scene.name).toBe('Second');
  });

  it('describes script properties and explains scripts that do not load', () => {
    const session = createSession();
    const { assets } = session.project;
    const script = assets.list('script')[0]!;
    const info = session.getScriptInfo(script.id);
    expect(info.error).toBeNull();
    expect(Object.keys(info.properties)).toEqual(['speed', 'jumpSpeed']);
    expect(session.getScriptInfo(script.id)).toBe(info);

    assets.setData(script.id, 'export default class {');
    const broken = session.getScriptInfo(script.id);
    expect(broken.properties).toEqual({});
    expect(broken.error).toContain('has a syntax error');
    expect(session.getScriptInfo('missing').error).toContain('does not exist');
  });
});

describe('EditorSession project', () => {
  it('saves the project with the scene being edited and clears the dirty flag', async () => {
    const session = createSession();
    const store = new MemoryProjectStore();
    session.edit(() => session.scene.createEntity('Unsaved Entity'));
    session.updateSettings((settings) => {
      settings.name = 'Renamed';
    });
    expect(session.dirty).toBe(true);

    await session.save(store);
    expect(session.dirty).toBe(false);
    const stored = Project.fromArchive((await store.load(session.project.id))!);
    expect(stored.settings.name).toBe('Renamed');
    expect(new EditorSession(stored).scene.findByName('Unsaved Entity')).not.toBeNull();
  });

  it('stops listening to the project when disposed', () => {
    const session = createSession();
    session.dispose();
    const version = session.getVersion();
    session.project.assets.create({ name: 'a.ts', type: 'script', mimeType: 'x', data: '' });
    expect(session.getVersion()).toBe(version);
  });
});

describe('play mode', () => {
  it('runs a copy of the scene and leaves the edited scene untouched', async () => {
    const session = createSession();
    const dependencies = createPlayDependencies();
    session.play.setDependencies(dependencies);
    session.console.add({ level: 'info', message: 'old', timestamp: 0 });

    await session.play.start();
    expect(session.play.state).toBe('playing');
    expect(session.play.isActive).toBe(true);
    expect(session.console.entries).toEqual([]);
    expect(session.activeScene).not.toBe(session.scene);
    expect(dependencies.inputs).toEqual([session.play.game!.input]);

    for (let frame = 0; frame < 30; frame++) {
      session.play.update(1 / 60);
    }
    const livePlayer = session.activeScene.findByName('Player')!;
    expect(livePlayer.transform.position.y).toBeLessThan(0);
    expect(session.scene.findByName('Player')!.transform.position.y).toBe(0);

    session.play.stop();
    expect(session.play.state).toBe('stopped');
    expect(session.activeScene).toBe(session.scene);
    expect(dependencies.detached).toBe(1);
    expect(dependencies.renderer.textureCount).toBe(0);
  });

  it('applies edits to the running game without recording them', async () => {
    const session = createSession();
    session.play.setDependencies(createPlayDependencies());
    await session.play.start();

    session.createEntity('sprite');
    expect(session.selectedEntity?.scene).toBe(session.activeScene);
    session.edit(() => session.activeScene.findByName('Ground')!.destroy());
    expect([session.canUndo, session.dirty]).toEqual([false, false]);
    session.undo();
    session.beginDrag();
    session.endDrag(true);
    expect(session.dirty).toBe(false);

    session.play.stop();
    expect(session.selection).toBeNull();
    expect(session.scene.findByName('Ground')).not.toBeNull();
    expect(session.scene.findByName('Sprite')).toBeNull();
  });

  it('pauses, steps one fixed step at a time and resumes', async () => {
    const session = createSession();
    const dependencies = createPlayDependencies();
    session.play.setDependencies(dependencies);
    await session.play.start();
    const time = session.play.game!.time;

    session.play.togglePause();
    expect(session.play.state).toBe('paused');
    expect(dependencies.audioBackend.suspended).toBe(true);
    session.play.update(1 / 60);
    expect(time.frameCount).toBe(0);

    session.play.step();
    session.play.step();
    expect(time.frameCount).toBe(2);

    session.play.togglePause();
    expect(dependencies.audioBackend.suspended).toBe(false);
    session.play.update(1 / 60);
    expect(time.frameCount).toBe(3);
    session.play.step();
    expect(time.frameCount).toBe(3);
  });

  it('reports why it cannot start and stays stopped', async () => {
    const session = createSession();
    await session.play.start();
    expect(session.console.entries.at(-1)!.message).toBe('Cannot play: the viewport is not ready');

    session.play.setDependencies({
      ...createPlayDependencies(),
      imageDecoder: decodeImageHeadless,
      audioBackend: Object.assign(new NullAudioBackend(), {
        decode: () => Promise.reject(new Error('unused')),
      }),
    });
    session.edit(() => {
      session.scene.findByName('Player')!.requireComponent(ScriptComponent).scripts[0]!.script =
        'missing';
    });
    await session.play.start();
    // A missing script is not fatal: the game runs without it.
    expect(session.play.state).toBe('playing');
    session.play.stop();
  });

  it('can be stopped while it is still starting', async () => {
    const session = createSession();
    const dependencies = createPlayDependencies();
    session.play.setDependencies(dependencies);
    const starting = session.play.start();
    expect(session.play.state).toBe('starting');
    session.play.stop();
    await starting;
    expect(session.play.state).toBe('stopped');
    expect(session.play.game).toBeNull();
    expect(dependencies.inputs).toEqual([]);
  });

  it('ignores a second start, stray pause and step calls, and stops when the viewport goes', async () => {
    const session = createSession();
    session.play.togglePause();
    session.play.step();
    session.play.stop();
    expect(session.play.state).toBe('stopped');

    session.play.setDependencies(createPlayDependencies());
    await session.play.start();
    const game = session.play.game;
    await session.play.start();
    expect(session.play.game).toBe(game);

    session.play.setDependencies(null);
    expect(session.play.state).toBe('stopped');
  });

  it('stops and reports when the engine itself fails', async () => {
    const session = createSession();
    session.play.setDependencies(createPlayDependencies());
    await session.play.start();
    vi.spyOn(session.play.game!, 'update').mockImplementation(() => {
      throw new Error('engine fault');
    });
    session.play.update(1 / 60);
    expect(session.play.state).toBe('stopped');
    expect(session.console.entries.at(-1)!.message).toBe(
      'The game stopped because of an error: engine fault',
    );
  });

  it('stops the game before opening another scene', async () => {
    const session = createSession();
    session.play.setDependencies(createPlayDependencies());
    const other = session.createScene('Other');
    session.openScene(session.project.settings.startScene!);
    await session.play.start();
    session.openScene(other.id);
    expect(session.play.state).toBe('stopped');
    expect(session.scene.name).toBe('Other');
  });
});

describe('entity presets', () => {
  it('creates every preset with the components its name promises', () => {
    const session = new EditorSession(new Project());
    const { scene, project } = session;
    const expected: Record<string, unknown[]> = {
      empty: [],
      sprite: [SpriteRenderer],
      camera: [Camera],
      'physics-box': [SpriteRenderer, Rigidbody2D, BoxCollider2D],
      'physics-circle': [SpriteRenderer, Rigidbody2D, CircleCollider2D],
      'static-box': [SpriteRenderer, BoxCollider2D],
      trigger: [BoxCollider2D],
      audio: [],
    };
    for (const preset of ENTITY_PRESETS) {
      const entity = createPresetEntity(scene, project.assets, preset.id, null);
      for (const type of expected[preset.id]!) {
        expect(entity.hasComponent(type as never), preset.id).toBe(true);
      }
      expect(entity.name).toBe(preset.id === 'empty' ? 'Entity' : preset.label);
    }
    expect(scene.findByName('Trigger Zone')!.requireComponent(BoxCollider2D).isTrigger).toBe(true);
  });

  it('marks only the first camera of a scene as primary', () => {
    const scene = new Scene();
    const { assets } = new Project();
    expect(createPresetEntity(scene, assets, 'camera', null).requireComponent(Camera).primary).toBe(
      true,
    );
    expect(createPresetEntity(scene, assets, 'camera', null).requireComponent(Camera).primary).toBe(
      false,
    );
  });

  it('adds the circle sprite to the project once and sizes it to one unit', () => {
    const scene = new Scene();
    const { assets } = new Project();
    const first = createPresetEntity(scene, assets, 'physics-circle', null);
    const second = createPresetEntity(scene, assets, 'physics-circle', first);
    expect(assets.list('texture').map((record) => record.name)).toEqual(['Sprites/circle.png']);
    const sprite = first.requireComponent(SpriteRenderer);
    expect(sprite.texture).toBe(second.requireComponent(SpriteRenderer).texture);
    expect(assets.get(sprite.texture!)!.meta.width).toBe(sprite.pixelsPerUnit);
    expect(second.parent).toBe(first);
  });
});

describe('EditorCamera', () => {
  it('pans so the world follows the pointer', () => {
    const camera = new EditorCamera();
    camera.halfHeight = 5;
    // 100 pixels of a 500 pixel tall view that shows 10 units is 2 units.
    camera.pan(100, 50, 500);
    expect(camera.position.toArray()).toEqual([-2, 1]);
  });

  it('zooms around the pointer', () => {
    const camera = new EditorCamera();
    camera.halfHeight = 5;
    const before = camera.toView(2).viewportToWorld(800, 100, 1000, 500);
    camera.zoomAt(0.5, 800, 100, 1000, 500);
    expect(camera.halfHeight).toBe(2.5);
    expect(camera.toView(2).viewportToWorld(800, 100, 1000, 500).equals(before)).toBe(true);
  });

  it('limits how far it zooms', () => {
    const camera = new EditorCamera();
    camera.zoomAt(1e-9, 0, 0, 100, 100);
    expect(camera.halfHeight).toBe(0.05);
    camera.zoomAt(1e12, 0, 0, 100, 100);
    expect(camera.halfHeight).toBe(5000);
  });

  it('frames a rectangle with some padding, and a point without zooming in too far', () => {
    const camera = new EditorCamera();
    camera.focus(new Rect(10, 10, 4, 20), 2);
    expect(camera.position.toArray()).toEqual([12, 20]);
    expect(camera.halfHeight).toBeCloseTo(14);

    camera.focus(new Rect(0, 0, 40, 2), 2);
    expect(camera.halfHeight).toBeCloseTo(14);

    camera.focus(new Rect(3, 3, 0, 0), 2);
    expect(camera.position.toArray()).toEqual([3, 3]);
    expect(camera.halfHeight).toBe(1.5);
  });
});

describe('picking', () => {
  function createScene(): { scene: Scene; project: Project } {
    return { scene: new Scene(), project: new Project() };
  }

  it('picks the sprite under the point, honouring rotation and scale', () => {
    const { scene, project } = createScene();
    const sprite = scene.createEntity('Wide');
    sprite.transform.position.set(10, 0);
    sprite.transform.scale.set(4, 1);
    sprite.transform.rotation = Math.PI / 2;
    sprite.addComponent(SpriteRenderer);

    // Rotated by 90 degrees, the 4x1 sprite is tall instead of wide.
    expect(pickEntity(scene, project.assets, new Vec2(10, 1.9), 0)).toBe(sprite);
    expect(pickEntity(scene, project.assets, new Vec2(11.9, 0), 0)).toBeNull();
  });

  it('prefers the sprite drawn on top', () => {
    const { scene, project } = createScene();
    const back = scene.createEntity('Back');
    back.addComponent(SpriteRenderer, { sortingOrder: 5 });
    const front = scene.createEntity('Front');
    front.addComponent(SpriteRenderer, { sortingOrder: 5 });
    const below = scene.createEntity('Below');
    below.addComponent(SpriteRenderer, { sortingOrder: 1 });
    expect(pickEntity(scene, project.assets, new Vec2(), 0)).toBe(front);
    front.requireComponent(SpriteRenderer).sortingOrder = 0;
    expect(pickEntity(scene, project.assets, new Vec2(), 0)).toBe(back);
  });

  it('skips hidden, inactive and zero-sized sprites', () => {
    const { scene, project } = createScene();
    scene.createEntity('Hidden').addComponent(SpriteRenderer, { visible: false });
    const inactive = scene.createEntity('Inactive');
    inactive.addComponent(SpriteRenderer);
    inactive.active = false;
    const flat = scene.createEntity('Flat');
    flat.addComponent(SpriteRenderer);
    flat.transform.scale.set(0, 1);
    expect(pickEntity(scene, project.assets, new Vec2(), 0)).toBeNull();
  });

  it('picks the nearest entity without a sprite within the icon radius', () => {
    const { scene, project } = createScene();
    const camera = scene.createEntity('Camera');
    camera.transform.position.set(5, 5);
    const audio = scene.createEntity('Audio');
    audio.transform.position.set(5.3, 5);
    expect(pickEntity(scene, project.assets, new Vec2(5.25, 5), 0.5)).toBe(audio);
    expect(pickEntity(scene, project.assets, new Vec2(5.1, 5), 0.5)).toBe(camera);
    expect(pickEntity(scene, project.assets, new Vec2(8, 8), 0.5)).toBeNull();
  });

  it('uses the texture size for the pickable area', () => {
    const { scene, project } = createScene();
    const texture = project.assets.create({
      name: 'big.png',
      type: 'texture',
      mimeType: 'image/png',
      data: new Uint8Array(1),
      meta: { width: 400, height: 100 },
    });
    const sprite = scene.createEntity('Big');
    sprite.addComponent(SpriteRenderer, { texture: texture.id });
    expect(pickEntity(scene, project.assets, new Vec2(1.9, 0.4), 0)).toBe(sprite);
    expect(pickEntity(scene, project.assets, new Vec2(1.9, 0.6), 0)).toBeNull();
    expect(getSpriteCorners(sprite, project.assets)!.map((corner) => corner.toArray())).toEqual([
      [-2, -0.5],
      [2, -0.5],
      [2, 0.5],
      [-2, 0.5],
    ]);
  });

  it('computes bounds that include the children', () => {
    const { scene, project } = createScene();
    const parent = scene.createEntity('Parent');
    parent.addComponent(SpriteRenderer);
    const child = scene.createEntity('Child', { parent });
    child.transform.position.set(5, 3);
    const bounds = getEntityBounds(parent, project.assets);
    expect([bounds.minX, bounds.minY, bounds.maxX, bounds.maxY]).toEqual([-0.5, -0.5, 5, 3]);
    expect(getSpriteCorners(child, project.assets)).toBeNull();
  });
});

describe('gizmos', () => {
  const layout = { origin: new Vec2(200, 200), rotation: 0 };

  it('points the axes right and up on screen, and rotates them with the entity', () => {
    const upright = getGizmoAxes(0);
    expect(upright.x.equals(new Vec2(1, 0))).toBe(true);
    expect(upright.y.equals(new Vec2(0, -1))).toBe(true);
    const turned = getGizmoAxes(Math.PI / 2);
    expect(turned.x.equals(new Vec2(0, -1))).toBe(true);
    expect(turned.y.equals(new Vec2(-1, 0))).toBe(true);
  });

  it('finds the move handles under the pointer', () => {
    expect(hitTestGizmo('move', layout, new Vec2(250, 203))).toBe('move-x');
    expect(hitTestGizmo('move', layout, new Vec2(198, 140))).toBe('move-y');
    expect(hitTestGizmo('move', layout, new Vec2(204, 196))).toBe('move-xy');
    expect(hitTestGizmo('move', layout, new Vec2(250, 250))).toBeNull();
    expect(hitTestGizmo('move', layout, new Vec2(200 + GIZMO.axisLength + 20, 200))).toBeNull();
  });

  it('finds the scale handles along the entity axes', () => {
    const rotated = { origin: new Vec2(200, 200), rotation: Math.PI / 2 };
    expect(hitTestGizmo('scale', rotated, new Vec2(200, 150))).toBe('scale-x');
    expect(hitTestGizmo('scale', rotated, new Vec2(150, 200))).toBe('scale-y');
    expect(hitTestGizmo('scale', rotated, new Vec2(200, 200))).toBe('scale-xy');
    expect(hitTestGizmo('scale', rotated, new Vec2(250, 200))).toBeNull();
  });

  it('finds the rotate ring but not its inside', () => {
    expect(hitTestGizmo('rotate', layout, new Vec2(200 + GIZMO.rotateRadius, 200))).toBe('rotate');
    expect(hitTestGizmo('rotate', layout, new Vec2(200, 200 - GIZMO.rotateRadius + 3))).toBe(
      'rotate',
    );
    expect(hitTestGizmo('rotate', layout, new Vec2(200, 200))).toBeNull();
  });

  const start = (handle: GizmoDragStart['handle'], rotation = 0): GizmoDragStart => ({
    handle,
    position: new Vec2(1, 2),
    rotation: 0.5,
    scale: new Vec2(2, 3),
    pointer: new Vec2(300, 200),
    pointerWorld: new Vec2(10, 10),
    layout: { origin: new Vec2(200, 200), rotation },
  });

  it('moves along one axis or freely', () => {
    const world = new Vec2(13, 14.5);
    const pointer = new Vec2();
    expect(applyGizmoDrag(start('move-x'), pointer, world, false).position!.toArray()).toEqual([
      4, 2,
    ]);
    expect(applyGizmoDrag(start('move-y'), pointer, world, false).position!.toArray()).toEqual([
      1, 6.5,
    ]);
    expect(applyGizmoDrag(start('move-xy'), pointer, world, false).position!.toArray()).toEqual([
      4, 6.5,
    ]);
  });

  it('snaps movement to a quarter unit', () => {
    const result = applyGizmoDrag(start('move-xy'), new Vec2(), new Vec2(10.3, 10.9), true);
    expect(result.position!.toArray()).toEqual([1.25, 3]);
  });

  it('rotates by the angle the pointer sweeps around the entity', () => {
    // From "right of the origin" to "above the origin" is a quarter turn counter-clockwise.
    const quarter = applyGizmoDrag(start('rotate'), new Vec2(200, 100), new Vec2(), false);
    expect(quarter.rotation).toBeCloseTo(0.5 + Math.PI / 2);
    const snapped = applyGizmoDrag(start('rotate'), new Vec2(200, 100), new Vec2(), true);
    expect(snapped.rotation).toBeCloseTo((Math.PI / 12) * 8);
  });

  it('scales by how far the handle is dragged along its axis', () => {
    const oneAxisLength = new Vec2(300 + GIZMO.axisLength, 200);
    expect(
      applyGizmoDrag(start('scale-x'), oneAxisLength, new Vec2(), false).scale!.toArray(),
    ).toEqual([4, 3]);
    const up = new Vec2(300, 200 - GIZMO.axisLength / 2);
    expect(applyGizmoDrag(start('scale-y'), up, new Vec2(), false).scale!.toArray()).toEqual([
      2, 4.5,
    ]);
    const diagonal = new Vec2(300 + GIZMO.axisLength / 2, 200 - GIZMO.axisLength / 2);
    expect(applyGizmoDrag(start('scale-xy'), diagonal, new Vec2(), false).scale!.toArray()).toEqual(
      [4, 6],
    );
  });

  it('scales along the rotated axis of a rotated entity and snaps', () => {
    // With the entity turned 90 degrees its X axis points up on screen.
    const up = new Vec2(300, 200 - GIZMO.axisLength);
    const rotated = applyGizmoDrag(start('scale-x', Math.PI / 2), up, new Vec2(), false);
    expect(rotated.scale!.x).toBeCloseTo(4);
    const snapped = applyGizmoDrag(start('scale-x'), new Vec2(310, 200), new Vec2(), true);
    expect(snapped.scale!.x).toBeCloseTo(2.3);
  });
});

describe('overlay', () => {
  it('places the gizmo on the entity, rotated only for the scale tool', () => {
    const scene = new Scene();
    const entity = scene.createEntity('E');
    entity.transform.position.set(5, 0);
    entity.transform.rotation = 1;
    const view = new EditorCamera().toView(2);

    const move = getGizmoLayout(entity, 'move', view, 1200, 600);
    expect(move.origin.equals(new Vec2(850, 300), 1e-9)).toBe(true);
    expect(move.rotation).toBe(0);
    expect(getGizmoLayout(entity, 'scale', view, 1200, 600).rotation).toBe(1);
  });

  it('draws the grid, cameras, colliders, selection and gizmo without errors', () => {
    const calls: string[] = [];
    const context = new Proxy(
      {},
      {
        get: (_target, property: string) => {
          return (...args: unknown[]) => {
            calls.push(property);
            return args;
          };
        },
        set: () => true,
      },
    ) as unknown as CanvasRenderingContext2D;

    const session = createSession();
    const player = session.scene.findByName('Player')!;
    player.addComponent(CircleCollider2D);
    for (const tool of ['move', 'rotate', 'scale', null] as const) {
      drawOverlay(context, {
        scene: session.scene,
        assets: session.project.assets,
        view: new EditorCamera().toView(2),
        width: 800,
        height: 400,
        selected: player,
        tool,
        activeHandle: tool ? (tool === 'rotate' ? 'rotate' : `${tool}-x`) : null,
        gameAspect: 16 / 9,
      });
    }
    expect(calls).toContain('clearRect');
    expect(calls).toContain('arc');
    expect(calls.filter((call) => call === 'stroke').length).toBeGreaterThan(10);
  });
});
