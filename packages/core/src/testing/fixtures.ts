/**
 * Helpers shared by the core unit tests. Not part of the published library.
 */
import type { AssetDatabase } from '../assets/assetDatabase';
import { createDefaultSettings, Project } from '../assets/project';
import { SourceScriptProvider } from '../compiler';
import { ScriptComponent, type ScriptBinding, type ScriptPropertyValue } from '../scene/components';
import type { Entity } from '../scene/entity';
import { Scene } from '../scene/scene';
import { createPrefab, serializeScene } from '../scene/serializer';
import { createHeadlessGame, type HeadlessGame } from '../runtime/headless';

export const FRAME = 1 / 60;

export function addScript(assets: AssetDatabase, name: string, source: string): string {
  return assets.create({ name, type: 'script', mimeType: 'text/typescript', data: source }).id;
}

/** Attaches a script to an entity, creating the Script component when needed. */
export function attachScript(
  entity: Entity,
  scriptId: string,
  properties: Record<string, ScriptPropertyValue> = {},
  enabled = true,
): ScriptBinding {
  const component = entity.getComponent(ScriptComponent) ?? entity.addComponent(ScriptComponent);
  const binding: ScriptBinding = { script: scriptId, enabled, properties };
  component.scripts.push(binding);
  return binding;
}

export function addScene(project: Project, scene: Scene): string {
  return project.assets.create({
    name: `${scene.name}.scene`,
    type: 'scene',
    mimeType: 'application/json',
    data: JSON.stringify(serializeScene(scene)),
  }).id;
}

export function addPrefab(project: Project, root: Entity, name = root.name): string {
  return project.assets.create({
    name: `${name}.prefab`,
    type: 'prefab',
    mimeType: 'application/json',
    data: JSON.stringify(createPrefab(root, name)),
  }).id;
}

/**
 * Builds a project with one scene called "Main". The callback fills the scene and may
 * add more assets; the scene is saved into the project afterwards.
 */
export function createTestProject(build?: (scene: Scene, project: Project) => void): Project {
  const project = new Project(createDefaultSettings('Test'));
  const scene = new Scene('Main');
  build?.(scene, project);
  project.settings.startScene = addScene(project, scene);
  return project;
}

export interface RunningGame extends HeadlessGame {
  /** Advances the game by a number of frames of one fixed step each. */
  step(frames?: number): void;
  /** The text of everything logged so far, prefixed with the level for warnings and errors. */
  messages(): string[];
}

/** Starts a headless game for a project, compiling its scripts from source. */
export async function startTestGame(project: Project): Promise<RunningGame> {
  const headless = createHeadlessGame(project, new SourceScriptProvider(project.assets));
  await headless.game.start();
  return {
    ...headless,
    step(frames = 1) {
      for (let frame = 0; frame < frames; frame++) {
        headless.game.update(FRAME);
      }
    },
    messages() {
      return headless.logs.map((entry) =>
        entry.level === 'info' ? entry.message : `${entry.level}: ${entry.message}`,
      );
    },
  };
}
