import { useRef, useState, type DragEvent, type ReactElement } from 'react';
import {
  getBaseName,
  getDirectoryName,
  isInFolder,
  type AssetRecord,
  type AssetType,
} from '@rowan/core';
import { DRAG_TYPES, useEditor } from './editorContext';
import { readFiles } from './files';
import { Icon, useContextMenu, type IconName, type MenuEntry } from './widgets';

const TYPE_ICONS: Readonly<Record<AssetType, IconName>> = {
  texture: 'image',
  audio: 'audio',
  script: 'script',
  scene: 'scene',
  prefab: 'prefab',
};

/** `null` shows every asset of the project; a string shows what is directly in that folder. */
type FolderFilter = string | null;

/** What the top level of the project is called where a folder is to be chosen. */
const TOP_LEVEL_LABEL = 'Top level';

/** The project's assets and the folders they are organized in, like Unity's Project window. */
export function ProjectPanel(): ReactElement {
  const { session, assetUrls, commands, openScript, confirm, prompt, imageDecoder } = useEditor();
  const menu = useContextMenu();
  const [folder, setFolder] = useState<FolderFilter>(null);
  const [dropping, setDropping] = useState(false);
  /** The folder that would take what is being dragged over it; '' is the top level. */
  const [dropTarget, setDropTarget] = useState<string | null>(null);
  /**
   * The folder that is being dragged. A page cannot read what is dragged until it is
   * dropped, and whether a folder may go somewhere depends on which folder it is.
   */
  const draggedFolder = useRef<string | null>(null);

  const { assets, settings } = session.project;
  const all = assets.list();
  const folders = assets.listFolders();
  // The folder that was shown may be gone: deleted, or renamed by renaming one above it.
  const activeFolder = folder !== null && assets.hasFolder(folder) ? folder : null;
  const subfolders =
    activeFolder === null ? [] : folders.filter((path) => getDirectoryName(path) === activeFolder);
  const visible =
    activeFolder === null
      ? all
      : all.filter((asset) => getDirectoryName(asset.name) === activeFolder);
  const targetFolder = activeFolder ?? '';

  /** Keeps showing a folder after it, or a folder above it, got a new path. */
  const follow = (from: string, to: string | null): void => {
    if (to !== null) {
      setFolder((shown) =>
        shown !== null && (shown === from || isInFolder(shown, from))
          ? to + shown.slice(from.length)
          : shown,
      );
    }
  };

  const open = (asset: AssetRecord): void => {
    switch (asset.type) {
      case 'scene':
        session.openScene(asset.id);
        break;
      case 'script':
        openScript(asset.id);
        break;
      case 'prefab':
        session.instantiatePrefab(asset.id);
        break;
      case 'texture':
        session.createSprite(asset.id);
        break;
      case 'audio':
        break;
    }
  };

  const rename = async (asset: AssetRecord): Promise<void> => {
    const name = await prompt({
      title: 'Rename Asset',
      label: 'Name, including its folder',
      initialValue: asset.name,
      confirmLabel: 'Rename',
    });
    if (name) {
      session.renameAsset(asset.id, name);
    }
  };

  const remove = async (asset: AssetRecord): Promise<void> => {
    const confirmed = await confirm({
      title: 'Delete Asset',
      message: `Delete "${asset.name}"? Anything that uses it will lose the reference. This cannot be undone.`,
      confirmLabel: 'Delete',
      danger: true,
    });
    if (confirmed) {
      session.deleteAsset(asset.id);
    }
  };

  /** Asks which folder something should go to. `exclude` leaves out a folder and what is in it. */
  const chooseFolder = (name: string, current: string, exclude?: string): Promise<string | null> =>
    prompt({
      title: `Move "${name}"`,
      label: 'To the folder',
      initialValue: current,
      confirmLabel: 'Move',
      choices: [
        { value: '', label: TOP_LEVEL_LABEL },
        ...folders
          .filter(
            (path) => path !== exclude && (exclude === undefined || !isInFolder(path, exclude)),
          )
          .map((path) => ({ value: path, label: path })),
      ],
    });

  const moveAsset = async (asset: AssetRecord): Promise<void> => {
    const target = await chooseFolder(getBaseName(asset.name), getDirectoryName(asset.name));
    if (target !== null) {
      session.moveAsset(asset.id, target);
    }
  };

  const moveFolder = async (path: string): Promise<void> => {
    const parent = getDirectoryName(path);
    const target = await chooseFolder(getBaseName(path), parent, path);
    if (target !== null && target !== parent) {
      follow(path, session.moveFolder(path, target));
    }
  };

  const renameFolder = async (path: string): Promise<void> => {
    const name = await prompt({
      title: 'Rename Folder',
      label: 'Folder name',
      initialValue: getBaseName(path),
      confirmLabel: 'Rename',
    });
    if (name) {
      follow(path, session.renameFolder(path, name));
    }
  };

  const removeFolder = async (path: string): Promise<void> => {
    const files = all.filter((asset) => isInFolder(asset.name, path)).length;
    // Nothing is lost with a folder that has no files in it, so there is nothing to ask.
    const confirmed =
      files === 0 ||
      (await confirm({
        title: 'Delete Folder',
        message:
          `Delete the folder "${path}" with the ${files === 1 ? 'file' : `${files} files`} in it? ` +
          'Anything that uses them will lose the reference. This cannot be undone.',
        confirmLabel: 'Delete',
        danger: true,
      }));
    if (confirmed) {
      session.deleteFolder(path);
    }
  };

  /** What can be made in a folder; '' is the top level, where new files go to their usual folders. */
  const createMenu = (parent: string): MenuEntry[] => [
    { label: 'Import Files…', onSelect: () => commands.importAssets(parent) },
    'separator',
    { label: 'New Folder…', onSelect: () => commands.createFolder(parent) },
    { label: 'New Script…', onSelect: () => commands.createScript(parent || 'Scripts') },
    { label: 'New Scene…', onSelect: () => commands.createScene(parent || undefined) },
  ];

  const folderMenu = (path: string): MenuEntry[] => [
    ...createMenu(path),
    'separator',
    { label: 'Rename…', onSelect: () => void renameFolder(path) },
    { label: 'Move to…', onSelect: () => void moveFolder(path) },
    { label: 'Delete', danger: true, onSelect: () => void removeFolder(path) },
  ];

  const assetMenu = (asset: AssetRecord): MenuEntry[] => {
    const items: MenuEntry[] = [];
    if (asset.type === 'scene') {
      items.push(
        { label: 'Open Scene', onSelect: () => open(asset) },
        {
          label: 'Set as Start Scene',
          disabled: settings.startScene === asset.id,
          onSelect: () =>
            session.updateSettings((draft) => {
              draft.startScene = asset.id;
            }),
        },
      );
    } else if (asset.type === 'script') {
      items.push({ label: 'Edit Script', onSelect: () => open(asset) });
    } else if (asset.type === 'prefab') {
      items.push({ label: 'Add to Scene', onSelect: () => open(asset) });
    } else if (asset.type === 'texture') {
      items.push({ label: 'Create Sprite', onSelect: () => open(asset) });
    }
    if (items.length > 0) {
      items.push('separator');
    }
    items.push(
      { label: 'Rename…', onSelect: () => void rename(asset) },
      { label: 'Move to…', onSelect: () => void moveAsset(asset) },
      { label: 'Delete', danger: true, onSelect: () => void remove(asset) },
    );
    return items;
  };

  // Every folder on the panel, in the list on the left and in the grid, carries its path in
  // `data-folder` and shares the handlers below. '' is the top level.
  const folderOf = (event: DragEvent<HTMLElement>): string =>
    event.currentTarget.dataset.folder ?? '';

  /** Lets a folder be picked up, to be dropped on the folder it should go into. */
  const handleFolderDragStart = (event: DragEvent<HTMLElement>): void => {
    const path = folderOf(event);
    event.dataTransfer.setData(DRAG_TYPES.folder, path);
    event.dataTransfer.effectAllowed = 'move';
    draggedFolder.current = path;
  };

  const handleFolderDragEnd = (): void => {
    draggedFolder.current = null;
    setDropTarget(null);
  };

  /**
   * A folder takes an asset or a folder of the project, which is moved into it, and files
   * from the computer, which are imported into it.
   */
  const handleFolderDragOver = (event: DragEvent<HTMLElement>): void => {
    const target = folderOf(event);
    const { types } = event.dataTransfer;
    const files = types.includes('Files');
    const accepted =
      files ||
      types.includes(DRAG_TYPES.asset) ||
      (draggedFolder.current !== null && session.canMoveFolder(draggedFolder.current, target));
    if (!accepted) {
      return;
    }
    event.preventDefault();
    // The panel around the folder takes files as well; this folder is the nearer target.
    event.stopPropagation();
    event.dataTransfer.dropEffect = files ? 'copy' : 'move';
    setDropping(false);
    setDropTarget(target);
  };

  const handleFolderDragLeave = (event: DragEvent<HTMLElement>): void => {
    const target = folderOf(event);
    setDropTarget((current) => (current === target ? null : current));
  };

  const handleFolderDrop = (event: DragEvent<HTMLElement>): void => {
    const target = folderOf(event);
    const { dataTransfer } = event;
    const assetId = dataTransfer.getData(DRAG_TYPES.asset);
    const folderPath = dataTransfer.getData(DRAG_TYPES.folder);
    setDropTarget(null);
    if (assetId !== '') {
      session.moveAsset(assetId, target);
    } else if (folderPath !== '') {
      if (session.canMoveFolder(folderPath, target)) {
        follow(folderPath, session.moveFolder(folderPath, target));
      }
    } else if (dataTransfer.files.length > 0) {
      void readFiles([...dataTransfer.files]).then((files) =>
        session.importFiles(files, target, imageDecoder),
      );
    } else {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
  };

  const folderClass = (base: string, path: string, selected: boolean): string =>
    `${base}${selected ? ' selected' : ''}${dropTarget === path ? ' drop-target' : ''}`;

  return (
    <section
      className={`panel project${dropping ? ' dropping' : ''}`}
      aria-label="Project"
      onDragOver={(event) => {
        if (event.dataTransfer.types.includes('Files')) {
          event.preventDefault();
          setDropping(true);
        }
      }}
      onDragLeave={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
          setDropping(false);
        }
      }}
      onDrop={(event) => {
        setDropping(false);
        if (event.dataTransfer.files.length === 0) {
          return;
        }
        event.preventDefault();
        void readFiles([...event.dataTransfer.files]).then((files) =>
          session.importFiles(files, targetFolder, imageDecoder),
        );
      }}
    >
      <div className="project-folders" role="listbox" aria-label="Folders">
        <button
          type="button"
          role="option"
          aria-selected={activeFolder === null}
          className={folderClass('folder', '', activeFolder === null)}
          onClick={() => setFolder(null)}
          onContextMenu={(event) => {
            event.preventDefault();
            menu.open(event, createMenu(''));
          }}
          data-folder=""
          onDragOver={handleFolderDragOver}
          onDragLeave={handleFolderDragLeave}
          onDrop={handleFolderDrop}
        >
          <Icon name="folder" size={14} />
          <span>All Assets</span>
        </button>
        {folders.map((path) => (
          <button
            key={path}
            type="button"
            role="option"
            aria-selected={activeFolder === path}
            className={folderClass('folder', path, activeFolder === path)}
            style={{ paddingLeft: 8 + (path.split('/').length - 1) * 12 }}
            title={path}
            onClick={() => setFolder(path)}
            onContextMenu={(event) => {
              event.preventDefault();
              menu.open(event, folderMenu(path));
            }}
            data-folder={path}
            draggable
            onDragStart={handleFolderDragStart}
            onDragEnd={handleFolderDragEnd}
            onDragOver={handleFolderDragOver}
            onDragLeave={handleFolderDragLeave}
            onDrop={handleFolderDrop}
          >
            <Icon name="folder" size={14} />
            <span>{getBaseName(path)}</span>
          </button>
        ))}
      </div>

      <div className="project-main">
        <div className="project-toolbar">
          <span className="project-path">{activeFolder ?? 'All Assets'}</span>
          <button
            type="button"
            className="button small"
            onClick={(event) => {
              const bounds = event.currentTarget.getBoundingClientRect();
              menu.open(
                { clientX: bounds.left, clientY: bounds.bottom + 2 },
                createMenu(targetFolder),
              );
            }}
          >
            <Icon name="plus" size={12} /> Add
          </button>
        </div>
        <div
          className="asset-grid"
          onClick={(event) => {
            if (event.target === event.currentTarget) {
              session.select(null);
            }
          }}
          onContextMenu={(event) => {
            if (event.target === event.currentTarget) {
              event.preventDefault();
              menu.open(event, createMenu(targetFolder));
            }
          }}
        >
          {visible.length === 0 && subfolders.length === 0 && (
            <p className="empty-hint">
              {activeFolder === null
                ? 'Drop image, audio or script files here to import them.'
                : 'This folder is empty. Drag assets onto it, or drop files here to import them.'}
            </p>
          )}
          {subfolders.map((path) => (
            <button
              key={`folder:${path}`}
              type="button"
              className={folderClass('asset', path, false)}
              title={path}
              onDoubleClick={() => setFolder(path)}
              onKeyDown={(event) => {
                // A double click has no key of its own; Enter opens the folder instead.
                if (event.key === 'Enter') {
                  event.preventDefault();
                  setFolder(path);
                }
              }}
              onContextMenu={(event) => {
                event.preventDefault();
                menu.open(event, folderMenu(path));
              }}
              data-folder={path}
              draggable
              onDragStart={handleFolderDragStart}
              onDragEnd={handleFolderDragEnd}
              onDragOver={handleFolderDragOver}
              onDragLeave={handleFolderDragLeave}
              onDrop={handleFolderDrop}
            >
              <span className="asset-thumbnail">
                <Icon name="folder" size={30} />
              </span>
              <span className="asset-name">{getBaseName(path)}</span>
            </button>
          ))}
          {visible.map((asset) => {
            const selected = session.selectedAsset === asset;
            const thumbnail = asset.type === 'texture' ? assetUrls.get(asset) : null;
            return (
              <button
                key={asset.id}
                type="button"
                className={selected ? 'asset selected' : 'asset'}
                title={asset.name}
                draggable
                onClick={() => session.select({ kind: 'asset', id: asset.id })}
                onDoubleClick={() => open(asset)}
                onContextMenu={(event) => {
                  event.preventDefault();
                  session.select({ kind: 'asset', id: asset.id });
                  menu.open(event, assetMenu(asset));
                }}
                onDragStart={(event) => {
                  event.dataTransfer.setData(DRAG_TYPES.asset, asset.id);
                  // Copied into the scene or a field of the inspector, moved into a folder.
                  event.dataTransfer.effectAllowed = 'copyMove';
                }}
              >
                <span className="asset-thumbnail">
                  {thumbnail ? (
                    <img src={thumbnail} alt="" draggable={false} />
                  ) : (
                    <Icon name={TYPE_ICONS[asset.type]} size={30} />
                  )}
                </span>
                <span className="asset-name">{getBaseName(asset.name)}</span>
                {settings.startScene === asset.id && <span className="badge">Start</span>}
              </button>
            );
          })}
        </div>
      </div>
      {menu.element}
    </section>
  );
}
