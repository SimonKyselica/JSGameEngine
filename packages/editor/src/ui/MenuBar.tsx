import { useState, type ReactElement } from 'react';
import { ENTITY_PRESETS } from '../core/entityPresets';
import { useEditor } from './editorContext';
import { IS_MAC, MOD } from './shortcuts';
import { PopupMenu, type MenuEntry } from './widgets';

/** The application menu at the top of the editor. */
export function MenuBar(): ReactElement {
  const { session, commands } = useEditor();
  const [open, setOpen] = useState<{ name: string; x: number; y: number } | null>(null);
  const entity = session.selectedEntity;

  const menus: Record<string, MenuEntry[]> = {
    File: [
      { label: 'New Project…', onSelect: commands.newProject },
      { label: 'Open Project…', onSelect: commands.openProject },
      { label: 'Save', shortcut: `${MOD}S`, onSelect: commands.save },
      'separator',
      { label: 'Import Project File…', onSelect: commands.importProjectFile },
      { label: 'Export Project File', onSelect: commands.exportProjectFile },
      'separator',
      { label: 'Project Settings…', onSelect: commands.openSettings },
      { label: 'Build Game…', shortcut: `${MOD}B`, onSelect: commands.openBuild },
    ],
    Edit: [
      {
        label: 'Undo',
        shortcut: `${MOD}Z`,
        disabled: !session.canUndo,
        onSelect: () => session.undo(),
      },
      {
        label: 'Redo',
        shortcut: IS_MAC ? '⇧⌘Z' : 'Ctrl+Y',
        disabled: !session.canRedo,
        onSelect: () => session.redo(),
      },
      'separator',
      {
        label: 'Cut',
        shortcut: `${MOD}X`,
        disabled: !entity,
        onSelect: () => entity && session.cutEntity(entity),
      },
      {
        label: 'Copy',
        shortcut: `${MOD}C`,
        disabled: !entity,
        onSelect: () => entity && session.copyEntity(entity),
      },
      {
        label: 'Paste',
        shortcut: `${MOD}V`,
        disabled: !session.canPaste,
        onSelect: () => session.pasteEntity(),
      },
      {
        label: 'Duplicate',
        shortcut: `${MOD}D`,
        disabled: !entity,
        onSelect: () => entity && session.duplicateEntity(entity),
      },
      {
        label: 'Delete',
        shortcut: 'Del',
        disabled: !entity,
        onSelect: () => entity && session.deleteEntity(entity),
      },
      'separator',
      {
        label: 'Frame Selection',
        shortcut: 'F',
        disabled: !entity,
        onSelect: commands.focusSelection,
      },
    ],
    Entity: [
      ...ENTITY_PRESETS.map((preset) => ({
        label: preset.label,
        onSelect: () => session.createEntity(preset.id),
      })),
      'separator',
      {
        label: 'Save Selection as Prefab',
        disabled: !entity,
        onSelect: () => {
          if (entity) {
            session.logger.info(`Saved prefab ${session.createPrefab(entity).name}`);
          }
        },
      },
    ],
    Assets: [
      { label: 'Import Files…', onSelect: () => commands.importAssets('') },
      'separator',
      { label: 'New Script…', onSelect: () => commands.createScript('Scripts') },
      { label: 'New Scene…', onSelect: commands.createScene },
    ],
    Help: [
      { label: 'Open Feature Test Project', onSelect: commands.openFeatureTest },
      'separator',
      { label: 'About Rowan', onSelect: commands.showAbout },
    ],
  };

  const show = (name: string, button: HTMLElement): void => {
    const bounds = button.getBoundingClientRect();
    setOpen({ name, x: bounds.left, y: bounds.bottom });
  };

  return (
    <nav className="menu-bar" aria-label="Main menu">
      <span className="menu-logo">Rowan</span>
      {Object.keys(menus).map((name) => (
        <button
          key={name}
          type="button"
          className={open?.name === name ? 'menu-button open' : 'menu-button'}
          aria-haspopup="menu"
          aria-expanded={open?.name === name}
          onClick={(event) => {
            if (open?.name === name) {
              setOpen(null);
            } else {
              show(name, event.currentTarget);
            }
          }}
          onPointerEnter={(event) => {
            // Once a menu is open, moving along the bar switches menus, as in native apps.
            if (open && open.name !== name) {
              show(name, event.currentTarget);
            }
          }}
        >
          {name}
        </button>
      ))}
      {open && (
        <PopupMenu items={menus[open.name]!} x={open.x} y={open.y} onClose={() => setOpen(null)} />
      )}
    </nav>
  );
}
