import {
  createPrefab,
  describeError,
  deserializeScene,
  duplicateEntity,
  getNameWithoutExtension,
  getScriptProperties,
  instantiatePrefab,
  makeUniqueName,
  Logger,
  ScriptApi,
  ScriptComponent,
  ScriptModuleLoader,
  serializeScene,
  Signal,
  SpriteRenderer,
  type AssetRecord,
  type ComponentType,
  type Entity,
  type ImageDecoder,
  type PrefabData,
  type Project,
  type ProjectSettings,
  type Scene,
  type ScriptPropertyDefinitions,
  type Unsubscribe,
  Tilemap,
  type Vec2,
} from '@rowan/core';
import { SourceScriptProvider } from '@rowan/core/compiler';
import { importAsset, type ImportFile } from './assetImport';
import { ConsoleStore } from './consoleStore';
import { createPresetEntity, type EntityPresetId } from './entityPresets';
import type { TransformTool } from './gizmos';
import { getTilemapCell } from './picking';
import { History } from './history';
import { PlayController } from './playController';
import type { ProjectStore } from './projectStore';
import { addSceneAsset, createEmptyScene, createScriptSource } from './templates';

export type Selection =
  | { readonly kind: 'entity'; readonly uuid: string }
  | { readonly kind: 'asset'; readonly id: string }
  | null;

export type Tool = 'hand' | TransformTool | 'paint';

/** What the inspector needs to know about a script: its properties, or why it is broken. */
export interface ScriptInfo {
  readonly properties: ScriptPropertyDefinitions;
  readonly error: string | null;
}

/**
 * The state of one open project in the editor: the scene being edited, the selection,
 * undo history and play mode. All editing goes through this class so that undo, the
 * unsaved-changes flag and the UI stay in step.
 *
 * It has no dependency on the DOM or on React, which keeps it unit-testable.
 */
export class EditorSession {
  /** Emitted after anything the UI shows may have changed. */
  readonly onChange = new Signal();
  readonly console = new ConsoleStore();
  readonly logger = new Logger();
  readonly history = new History<string>();
  readonly play: PlayController;

  /** The scene being edited. Replaced, not mutated, by undo, redo and opening a scene. */
  scene: Scene;
  /** The scene asset `scene` was loaded from and is saved back to. */
  sceneAssetId: string;
  selection: Selection = null;
  tool: Tool = 'move';
  /** The tile the paint tool puts into the cells of a tilemap. -1 is the eraser. */
  tileBrush = 0;
  /** Snap mode: gizmo drags snap to fixed increments unless the modifier key is held. */
  snapping = false;
  /** True when the project has changes that are not in the project store yet. */
  dirty = false;

  private version = 0;
  private dragSnapshot: string | null = null;
  /** The entity that was copied or cut. Kept as a prefab, so it outlives its scene. */
  private clipboard: PrefabData | null = null;
  private readonly scriptLoader: ScriptModuleLoader;
  private readonly scriptInfo = new Map<string, ScriptInfo>();
  private readonly subscriptions: Unsubscribe[];

  constructor(readonly project: Project) {
    this.logger.addSink((entry) => this.console.add(entry));
    this.play = new PlayController(this);

    const { assets, settings } = project;
    this.scriptLoader = new ScriptModuleLoader(assets, new SourceScriptProvider(assets), {
      ...ScriptApi,
    });

    const startScene = settings.startScene ? assets.get(settings.startScene) : undefined;
    const sceneRecord =
      (startScene?.type === 'scene' ? startScene : undefined) ??
      assets.list('scene')[0] ??
      addSceneAsset(assets, createEmptyScene('Main'));
    if (startScene?.type !== 'scene') {
      settings.startScene = sceneRecord.id;
    }
    this.sceneAssetId = sceneRecord.id;
    this.scene = this.loadScene(sceneRecord);

    const handleAssetChange = (record: AssetRecord): void => {
      if (record.type === 'script') {
        this.scriptLoader.invalidate();
        this.scriptInfo.clear();
      }
      this.dirty = true;
      this.notify();
    };
    this.subscriptions = [
      assets.onAdded.connect(handleAssetChange),
      assets.onRemoved.connect(handleAssetChange),
      assets.onChanged.connect(handleAssetChange),
      assets.onRenamed.connect(handleAssetChange),
    ];
  }

  // --- Subscriptions -------------------------------------------------------------------

  /** For React's `useSyncExternalStore`. */
  readonly subscribe = (listener: () => void): Unsubscribe => this.onChange.connect(listener);
  readonly getVersion = (): number => this.version;

  /** Tells the UI that something changed. */
  notify(): void {
    this.version++;
    this.onChange.emit();
  }

  dispose(): void {
    this.play.setDependencies(null);
    for (const unsubscribe of this.subscriptions.splice(0)) {
      unsubscribe();
    }
  }

  // --- Scene and selection ---------------------------------------------------------------

  /** The scene the panels show: the running game's scene during play, else the edited one. */
  get activeScene(): Scene {
    return this.play.game?.scene ?? this.scene;
  }

  get selectedEntity(): Entity | null {
    return this.selection?.kind === 'entity'
      ? this.activeScene.findByUuid(this.selection.uuid)
      : null;
  }

  get selectedAsset(): AssetRecord | null {
    return this.selection?.kind === 'asset'
      ? (this.project.assets.get(this.selection.id) ?? null)
      : null;
  }

  select(selection: Selection): void {
    this.selection = selection;
    this.notify();
  }

  selectEntity(entity: Entity | null): void {
    this.select(entity ? { kind: 'entity', uuid: entity.uuid } : null);
  }

  setTool(tool: Tool): void {
    this.tool = tool;
    this.notify();
  }

  /** Chooses the tile the paint tool paints with; -1 erases. */
  setTileBrush(tile: number): void {
    this.tileBrush = tile;
    this.notify();
  }

  /**
   * Paints the brush into the cell of the selected entity's tilemap that a world-space
   * point is in. Returns `true` when that changed a cell. Call it between
   * {@link EditorSession.beginDrag} and {@link EditorSession.endDrag}, so that a whole
   * stroke is one step to undo.
   */
  paintTile(point: Readonly<Vec2>): boolean {
    const entity = this.selectedEntity;
    const map = entity?.getComponent(Tilemap);
    const cell = entity && map ? getTilemapCell(entity, point) : null;
    if (!map || !cell || map.getTile(cell.column, cell.row) === this.tileBrush) {
      return false;
    }
    map.setTile(cell.column, cell.row, this.tileBrush);
    return true;
  }

  /** Turns snap mode on or off. It is an editor preference, not part of the project. */
  setSnapping(enabled: boolean): void {
    if (this.snapping !== enabled) {
      this.snapping = enabled;
      this.notify();
    }
  }

  // --- Editing with undo -----------------------------------------------------------------

  /**
   * Applies a change to the scene as one undoable step. During play the change goes to
   * the running game instead and is not recorded, because it is discarded on Stop.
   *
   * @param coalesceKey Merges quick successive edits, such as typing in one field.
   */
  edit(mutate: () => void, coalesceKey?: string): void {
    if (this.play.isActive) {
      mutate();
      this.notify();
      return;
    }
    const before = this.snapshot();
    try {
      mutate();
    } catch (error) {
      this.restore(before);
      this.logger.error(`The change could not be applied: ${describeError(error)}`);
      this.notify();
      return;
    }
    this.history.record(before, coalesceKey);
    this.dirty = true;
    this.notify();
  }

  /**
   * Starts a continuous edit such as a gizmo drag. The caller then changes the scene
   * directly, calling {@link EditorSession.notify} as it goes, and finishes with
   * {@link EditorSession.endDrag}; the whole drag becomes one undo step.
   */
  beginDrag(): void {
    this.dragSnapshot = this.play.isActive ? null : this.snapshot();
  }

  endDrag(changed: boolean): void {
    if (this.dragSnapshot !== null && changed) {
      this.history.record(this.dragSnapshot);
      this.dirty = true;
    }
    this.dragSnapshot = null;
    this.notify();
  }

  undo(): void {
    if (this.canUndo) {
      this.travel(this.history.undo(this.snapshot()));
    }
  }

  redo(): void {
    if (this.canRedo) {
      this.travel(this.history.redo(this.snapshot()));
    }
  }

  get canUndo(): boolean {
    return !this.play.isActive && this.history.canUndo;
  }

  get canRedo(): boolean {
    return !this.play.isActive && this.history.canRedo;
  }

  // --- Entities --------------------------------------------------------------------------

  createEntity(preset: EntityPresetId, parent: Entity | null = null, position?: Vec2): void {
    let created: Entity | null = null;
    this.edit(() => {
      created = createPresetEntity(this.activeScene, this.project.assets, preset, parent);
      if (position && !parent) {
        created.transform.position.copy(position);
      }
    });
    this.selectEntity(created);
  }

  deleteEntity(entity: Entity): void {
    this.edit(() => entity.destroy());
    if (!this.selectedEntity && this.selection?.kind === 'entity') {
      this.select(null);
    }
  }

  duplicateEntity(entity: Entity): void {
    let copy: Entity | null = null;
    this.edit(() => {
      copy = duplicateEntity(entity);
    });
    this.selectEntity(copy);
  }

  /** True when an entity has been copied or cut and can be pasted. */
  get canPaste(): boolean {
    return this.clipboard !== null;
  }

  /** Remembers an entity and its children, so copies can be pasted, also into other scenes. */
  copyEntity(entity: Entity): void {
    this.clipboard = createPrefab(entity);
    this.notify();
  }

  /** Copies an entity and removes it from the scene. */
  cutEntity(entity: Entity): void {
    this.copyEntity(entity);
    this.deleteEntity(entity);
  }

  /**
   * Adds a copy of the copied entity right after the selected entity, as its sibling, or
   * at the end of the scene root when nothing is selected. The copy keeps its local
   * transform, gets a name that is unique among its new siblings, and becomes the selection.
   */
  pasteEntity(): void {
    const clipboard = this.clipboard;
    if (!clipboard) {
      return;
    }
    const target = this.selectedEntity;
    const parent = target?.parent ?? null;
    let pasted: Entity | null = null;
    this.edit(() => {
      const scene = this.activeScene;
      const siblings = parent ? parent.children : scene.rootEntities;
      pasted = instantiatePrefab(scene, clipboard, {
        parent,
        name: makeUniqueName(
          clipboard.name,
          siblings.map((sibling) => sibling.name),
        ),
      });
      if (target) {
        scene.setParent(pasted, parent, {
          keepWorldTransform: false,
          index: scene.getSiblingIndex(target) + 1,
        });
      }
    });
    this.selectEntity(pasted);
  }

  renameEntity(entity: Entity, name: string): void {
    const trimmed = name.trim();
    if (trimmed !== '' && trimmed !== entity.name) {
      this.edit(() => {
        entity.name = trimmed;
      }, `rename:${entity.uuid}`);
    }
  }

  /** Moves an entity in the hierarchy. Moves that would create a cycle are ignored. */
  moveEntity(entity: Entity, parent: Entity | null, index?: number): void {
    const scene = entity.scene;
    if (parent && scene.isSameOrDescendant(parent, entity)) {
      return;
    }
    this.edit(() => {
      let targetIndex = index;
      // Taking the entity out of its current place shifts the siblings after it.
      if (
        targetIndex !== undefined &&
        entity.parent === parent &&
        scene.getSiblingIndex(entity) < targetIndex
      ) {
        targetIndex--;
      }
      scene.setParent(entity, parent, { index: targetIndex });
    });
  }

  addComponent(entity: Entity, type: ComponentType): void {
    if (!entity.hasComponent(type)) {
      this.edit(() => entity.addComponent(type));
    }
  }

  removeComponent(entity: Entity, type: ComponentType): void {
    if (type.schema.removable && entity.hasComponent(type)) {
      this.edit(() => entity.removeComponent(type));
    }
  }

  /** Attaches a script to an entity, adding the Script component when needed. */
  addScript(entity: Entity, scriptId: string): void {
    this.edit(() => {
      const component =
        entity.getComponent(ScriptComponent) ?? entity.addComponent(ScriptComponent);
      component.scripts.push({ script: scriptId, enabled: true, properties: {} });
    });
  }

  // --- Scenes ----------------------------------------------------------------------------

  /** Writes the edited scene into its scene asset if it differs from what is stored. */
  commitScene(): void {
    const text = JSON.stringify(serializeScene(this.scene), null, 2);
    const { assets } = this.project;
    if (assets.has(this.sceneAssetId) && assets.getText(this.sceneAssetId) !== text) {
      assets.setData(this.sceneAssetId, text);
    }
  }

  openScene(assetId: string): void {
    const record = this.project.assets.get(assetId);
    if (record?.type !== 'scene' || assetId === this.sceneAssetId) {
      return;
    }
    this.play.stop();
    this.commitScene();
    this.sceneAssetId = assetId;
    this.scene = this.loadScene(record);
    this.history.clear();
    this.selection = null;
    this.notify();
  }

  createScene(name: string): AssetRecord {
    const sceneName = name.trim() || 'New Scene';
    const record = addSceneAsset(this.project.assets, createEmptyScene(sceneName));
    this.openScene(record.id);
    return record;
  }

  // --- Assets ----------------------------------------------------------------------------

  /** Imports files into a project folder. Files that cannot be imported are reported. */
  async importFiles(
    files: readonly ImportFile[],
    folder: string,
    decodeImage: ImageDecoder,
  ): Promise<AssetRecord[]> {
    const imported: AssetRecord[] = [];
    for (const file of files) {
      try {
        imported.push(await importAsset(this.project.assets, file, folder, decodeImage));
      } catch (error) {
        this.logger.error(describeError(error), 'Import');
      }
    }
    if (imported.length > 0) {
      this.logger.info(`Imported ${imported.map((record) => record.name).join(', ')}`, 'Import');
    }
    return imported;
  }

  createScript(name: string, folder = 'Scripts'): AssetRecord {
    const baseName = name.trim().replace(/\.(ts|js)$/i, '') || 'NewScript';
    const fileName = `${baseName}.ts`;
    return this.project.assets.create({
      name: folder ? `${folder}/${fileName}` : fileName,
      type: 'script',
      mimeType: 'text/typescript',
      data: createScriptSource(fileName),
    });
  }

  /** Saves an entity and its children as a prefab asset. */
  createPrefab(entity: Entity, folder = 'Prefabs'): AssetRecord {
    const fileName = `${entity.name}.prefab`;
    return this.project.assets.create({
      name: folder ? `${folder}/${fileName}` : fileName,
      type: 'prefab',
      mimeType: 'application/json',
      data: JSON.stringify(createPrefab(entity), null, 2),
    });
  }

  /** Adds a copy of a prefab asset to the scene and selects it. */
  instantiatePrefab(assetId: string, position?: Vec2): void {
    const record = this.project.assets.get(assetId);
    if (record?.type !== 'prefab') {
      return;
    }
    let created: Entity | null = null;
    this.edit(() => {
      const data: unknown = JSON.parse(this.project.assets.getText(assetId));
      created = instantiatePrefab(this.activeScene, data, {
        position,
        onWarning: (message) => this.logger.warn(message, record.name),
      });
    });
    this.selectEntity(created);
  }

  /** Creates a sprite entity that shows a texture asset and selects it. */
  createSprite(textureId: string, position?: Vec2): void {
    const record = this.project.assets.get(textureId);
    if (record?.type !== 'texture') {
      return;
    }
    let created: Entity | null = null;
    this.edit(() => {
      created = this.activeScene.createEntity(getNameWithoutExtension(record.name));
      created.addComponent(SpriteRenderer, { texture: textureId });
      if (position) {
        created.transform.position.copy(position);
      }
    });
    this.selectEntity(created);
  }

  renameAsset(id: string, name: string): void {
    if (name.trim() !== '') {
      this.project.assets.rename(id, name);
    }
  }

  /** Deletes an asset. The scene that is open can only go when another scene exists. */
  deleteAsset(id: string): void {
    const { assets, settings } = this.project;
    if (id === this.sceneAssetId) {
      const other = assets.list('scene').find((record) => record.id !== id);
      if (!other) {
        this.logger.error('The only scene of a project cannot be deleted');
        return;
      }
      // The scene is going away, so its unsaved changes do not need to be written first.
      this.sceneAssetId = other.id;
      this.scene = this.loadScene(other);
      this.history.clear();
    }
    if (settings.startScene === id) {
      settings.startScene = this.sceneAssetId;
    }
    if (this.selection?.kind === 'asset' && this.selection.id === id) {
      this.selection = null;
    }
    assets.remove(id);
  }

  /** The inspector properties of a script, or the reason the script does not load. */
  getScriptInfo(scriptId: string): ScriptInfo {
    let info = this.scriptInfo.get(scriptId);
    if (!info) {
      try {
        info = {
          properties: getScriptProperties(this.scriptLoader.loadClass(scriptId)),
          error: null,
        };
      } catch (error) {
        info = { properties: {}, error: describeError(error) };
      }
      this.scriptInfo.set(scriptId, info);
    }
    return info;
  }

  // --- Project ---------------------------------------------------------------------------

  updateSettings(mutate: (settings: ProjectSettings) => void): void {
    mutate(this.project.settings);
    // The resolution may have changed, and with it where things on the screen are.
    this.fitToProject(this.scene);
    this.dirty = true;
    this.notify();
  }

  /** Saves the whole project, including the scene being edited, to a project store. */
  async save(store: ProjectStore): Promise<void> {
    this.commitScene();
    await store.save(this.project.toArchive());
    this.dirty = false;
    this.notify();
  }

  /** Called by the play controller after the game has stopped. */
  handlePlayStopped(): void {
    // Entities created by the game do not exist in the edited scene.
    if (this.selection?.kind === 'entity' && !this.scene.findByUuid(this.selection.uuid)) {
      this.selection = null;
    }
    this.notify();
  }

  private travel(snapshot: string | undefined): void {
    if (snapshot === undefined) {
      return;
    }
    this.restore(snapshot);
    this.dirty = true;
    if (this.selection?.kind === 'entity' && !this.scene.findByUuid(this.selection.uuid)) {
      this.selection = null;
    }
    this.notify();
  }

  private snapshot(): string {
    return JSON.stringify(serializeScene(this.scene));
  }

  private restore(snapshot: string): void {
    this.scene = this.fitToProject(deserializeScene(JSON.parse(snapshot)));
  }

  /** Gives a scene the screen of this project, which is what screen anchors are measured on. */
  private fitToProject(scene: Scene): Scene {
    const { width, height } = this.project.settings.rendering;
    scene.screenSize.set(width, height);
    return scene;
  }

  /** Loads a scene asset. A scene that cannot be read is reported and opened empty. */
  private loadScene(record: AssetRecord): Scene {
    try {
      const data: unknown = JSON.parse(this.project.assets.getText(record.id));
      return this.fitToProject(
        deserializeScene(data, {
          onWarning: (message) => this.logger.warn(message, record.name),
        }),
      );
    } catch (error) {
      this.logger.error(`Could not open "${record.name}": ${describeError(error)}`);
      return this.fitToProject(createEmptyScene(getNameWithoutExtension(record.name)));
    }
  }
}
