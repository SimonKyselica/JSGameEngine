import { useState, type ReactElement } from 'react';
import { getBaseName, getDirectoryName, type AssetRecord, type AssetType } from '@rowan/core';
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

/** `null` shows every asset; a string shows the assets directly inside that folder. */
type FolderFilter = string | null;

/** Every folder that contains assets, including the parents of nested folders. */
function listFolders(assets: readonly AssetRecord[]): string[] {
  const folders = new Set<string>();
  for (const asset of assets) {
    let folder = getDirectoryName(asset.name);
    while (folder !== '') {
      folders.add(folder);
      folder = getDirectoryName(folder);
    }
  }
  return [...folders].sort((a, b) => a.localeCompare(b));
}

/** The project's assets, like Unity's Project window. */
export function ProjectPanel(): ReactElement {
  const { session, assetUrls, commands, openScript, confirm, prompt, imageDecoder } = useEditor();
  const menu = useContextMenu();
  const [folder, setFolder] = useState<FolderFilter>(null);
  const [dropping, setDropping] = useState(false);

  const { assets, settings } = session.project;
  const all = assets.list();
  const folders = listFolders(all);
  // A folder disappears when its last asset is moved or deleted.
  const activeFolder = folder !== null && folders.includes(folder) ? folder : null;
  const visible =
    activeFolder === null
      ? all
      : all.filter((asset) => getDirectoryName(asset.name) === activeFolder);
  const targetFolder = activeFolder ?? '';

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
      { label: 'Delete', danger: true, onSelect: () => void remove(asset) },
    );
    return items;
  };

  const createMenu: MenuEntry[] = [
    { label: 'Import Files…', onSelect: () => commands.importAssets(targetFolder) },
    'separator',
    { label: 'New Script…', onSelect: () => commands.createScript(activeFolder ?? 'Scripts') },
    { label: 'New Scene…', onSelect: () => commands.createScene() },
  ];

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
          className={activeFolder === null ? 'folder selected' : 'folder'}
          onClick={() => setFolder(null)}
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
            className={activeFolder === path ? 'folder selected' : 'folder'}
            style={{ paddingLeft: 8 + (path.split('/').length - 1) * 12 }}
            onClick={() => setFolder(path)}
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
              menu.open({ clientX: bounds.left, clientY: bounds.bottom + 2 }, createMenu);
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
              menu.open(event, createMenu);
            }
          }}
        >
          {visible.length === 0 && (
            <p className="empty-hint">Drop image, audio or script files here to import them.</p>
          )}
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
                  event.dataTransfer.effectAllowed = 'copy';
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
