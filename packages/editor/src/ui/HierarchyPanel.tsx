import { useState, type DragEvent, type KeyboardEvent, type ReactElement } from 'react';
import type { Entity } from '@rowan/core';
import { ENTITY_PRESETS } from '../core/entityPresets';
import { filterEntitiesByName } from '../core/hierarchyFilter';
import { DRAG_TYPES, useEditor } from './editorContext';
import { MOD } from './shortcuts';
import { Icon, useContextMenu, type MenuEntry } from './widgets';

/** Where a dragged entity would land relative to the row under the pointer. */
type DropZone = 'before' | 'inside' | 'after';

interface DropTarget {
  readonly uuid: string;
  readonly zone: DropZone;
}

function getDropZone(event: DragEvent<HTMLElement>): DropZone {
  const bounds = event.currentTarget.getBoundingClientRect();
  const fraction = (event.clientY - bounds.top) / bounds.height;
  if (fraction < 0.25) {
    return 'before';
  }
  return fraction > 0.75 ? 'after' : 'inside';
}

/** The tree of entities in the scene, like Unity's Hierarchy window. */
export function HierarchyPanel(): ReactElement {
  const { session } = useEditor();
  const scene = session.activeScene;
  const menu = useContextMenu();
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(new Set());
  const [renaming, setRenaming] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<DropTarget | null>(null);
  const [search, setSearch] = useState('');
  // While searching, the tree is replaced by a flat list of the entities that match.
  const matches = search.trim() === '' ? null : filterEntitiesByName(scene, search);

  const pasteItem: MenuEntry = {
    label: 'Paste',
    shortcut: `${MOD}V`,
    disabled: !session.canPaste,
    onSelect: () => session.pasteEntity(),
  };

  const createMenu = (parent: Entity | null): MenuEntry[] =>
    ENTITY_PRESETS.map((preset) => ({
      label: parent && preset.id === 'empty' ? 'Empty Child' : preset.label,
      onSelect: () => session.createEntity(preset.id, parent),
    }));

  const entityMenu = (entity: Entity): MenuEntry[] => [
    ...createMenu(entity),
    'separator',
    { label: 'Rename', shortcut: 'F2', onSelect: () => setRenaming(entity.uuid) },
    { label: 'Cut', shortcut: `${MOD}X`, onSelect: () => session.cutEntity(entity) },
    { label: 'Copy', shortcut: `${MOD}C`, onSelect: () => session.copyEntity(entity) },
    pasteItem,
    { label: 'Duplicate', shortcut: `${MOD}D`, onSelect: () => session.duplicateEntity(entity) },
    {
      label: 'Save as Prefab',
      onSelect: () => {
        const prefab = session.createPrefab(entity);
        session.logger.info(`Saved prefab ${prefab.name}`);
      },
    },
    'separator',
    {
      label: 'Delete',
      shortcut: 'Del',
      danger: true,
      onSelect: () => session.deleteEntity(entity),
    },
  ];

  const toggleCollapsed = (uuid: string): void => {
    const next = new Set(collapsed);
    if (!next.delete(uuid)) {
      next.add(uuid);
    }
    setCollapsed(next);
  };

  const handleDrop = (event: DragEvent<HTMLElement>, target: Entity | null): void => {
    event.preventDefault();
    event.stopPropagation();
    const zone = target ? getDropZone(event) : 'inside';
    setDropTarget(null);
    const dragged = scene.findByUuid(event.dataTransfer.getData(DRAG_TYPES.entity));
    if (!dragged || dragged === target) {
      return;
    }
    if (!target) {
      session.moveEntity(dragged, null);
    } else if (zone === 'inside') {
      session.moveEntity(dragged, target);
      setCollapsed((current) => new Set([...current].filter((uuid) => uuid !== target.uuid)));
    } else {
      const index = scene.getSiblingIndex(target) + (zone === 'after' ? 1 : 0);
      session.moveEntity(dragged, target.parent, index);
    }
  };

  /** The tree's rows as they appear on screen: children of collapsed entities are left out. */
  const listTreeRows = (): Entity[] => {
    const rows: Entity[] = [];
    const visit = (entity: Entity): void => {
      rows.push(entity);
      if (!collapsed.has(entity.uuid)) {
        entity.children.forEach(visit);
      }
    };
    scene.rootEntities.forEach(visit);
    return rows;
  };

  /** Arrow keys walk the tree the way they do in a file explorer; F2 renames. */
  const handleKeyDown = (event: KeyboardEvent<HTMLElement>): void => {
    const selected = session.selectedEntity;
    // In the search field only Up and Down leave the text; the other keys edit it.
    const inSearchField = event.target instanceof HTMLInputElement;
    const keys = inSearchField
      ? ['ArrowUp', 'ArrowDown']
      : ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'];
    if (event.key === 'F2' && selected && !inSearchField) {
      setRenaming(selected.uuid);
      return;
    }
    if (!keys.includes(event.key)) {
      return;
    }
    event.preventDefault();

    const visible = matches ?? listTreeRows();
    if (visible.length === 0) {
      return;
    }
    if (!selected) {
      session.selectEntity(visible[0]!);
      return;
    }

    const index = visible.indexOf(selected);
    if (event.key === 'ArrowDown') {
      session.selectEntity(visible[Math.min(index + 1, visible.length - 1)]!);
    } else if (event.key === 'ArrowUp') {
      session.selectEntity(visible[Math.max(index - 1, 0)]!);
    } else if (!matches) {
      // Left and right fold the tree; a flat list of search results has nothing to fold.
      const hasChildren = selected.children.length > 0;
      const isCollapsed = collapsed.has(selected.uuid);
      if (event.key === 'ArrowRight' && hasChildren && isCollapsed) {
        toggleCollapsed(selected.uuid);
      } else if (event.key === 'ArrowLeft' && hasChildren && !isCollapsed) {
        toggleCollapsed(selected.uuid);
      } else if (event.key === 'ArrowLeft' && selected.parent) {
        session.selectEntity(selected.parent);
      }
    }
  };

  const renderRow = (entity: Entity, depth: number): ReactElement => {
    // Search results are listed flat: no nesting, and no dragging into an order that is hidden.
    const children = matches ? [] : entity.children;
    const isCollapsed = collapsed.has(entity.uuid);
    const isSelected = session.selectedEntity === entity;
    const drop = dropTarget?.uuid === entity.uuid ? ` drop-${dropTarget.zone}` : '';
    return (
      <li key={entity.uuid} role="treeitem" aria-selected={isSelected} aria-expanded={!isCollapsed}>
        <div
          className={`tree-row${isSelected ? ' selected' : ''}${entity.activeInHierarchy ? '' : ' inactive'}${drop}`}
          style={{ paddingLeft: 6 + depth * 14 }}
          draggable={!matches && renaming !== entity.uuid}
          onClick={() => session.selectEntity(entity)}
          onDoubleClick={() => setRenaming(entity.uuid)}
          onContextMenu={(event) => {
            event.preventDefault();
            session.selectEntity(entity);
            menu.open(event, entityMenu(entity));
          }}
          onDragStart={(event) => {
            event.dataTransfer.setData(DRAG_TYPES.entity, entity.uuid);
            event.dataTransfer.effectAllowed = 'move';
          }}
          onDragOver={(event) => {
            if (event.dataTransfer.types.includes(DRAG_TYPES.entity)) {
              event.preventDefault();
              event.stopPropagation();
              const zone = getDropZone(event);
              if (dropTarget?.uuid !== entity.uuid || dropTarget.zone !== zone) {
                setDropTarget({ uuid: entity.uuid, zone });
              }
            }
          }}
          onDragLeave={() => setDropTarget(null)}
          onDrop={(event) => handleDrop(event, entity)}
        >
          <button
            type="button"
            className="tree-toggle"
            style={{ visibility: children.length > 0 ? 'visible' : 'hidden' }}
            aria-label={isCollapsed ? 'Expand' : 'Collapse'}
            onClick={(event) => {
              event.stopPropagation();
              toggleCollapsed(entity.uuid);
            }}
          >
            <Icon name={isCollapsed ? 'chevronRight' : 'chevronDown'} size={12} />
          </button>
          <Icon name="entity" size={14} />
          {renaming === entity.uuid ? (
            <input
              className="tree-rename"
              autoFocus
              defaultValue={entity.name}
              aria-label="Entity name"
              onFocus={(event) => event.currentTarget.select()}
              onClick={(event) => event.stopPropagation()}
              onBlur={(event) => {
                session.renameEntity(entity, event.currentTarget.value);
                setRenaming(null);
              }}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  event.currentTarget.blur();
                } else if (event.key === 'Escape') {
                  setRenaming(null);
                }
                event.stopPropagation();
              }}
            />
          ) : (
            <span className="tree-label">{entity.name}</span>
          )}
        </div>
        {children.length > 0 && !isCollapsed && (
          <ul role="group">{children.map((child) => renderRow(child, depth + 1))}</ul>
        )}
      </li>
    );
  };

  return (
    <section className="panel hierarchy" aria-label="Hierarchy" onKeyDown={handleKeyDown}>
      <header className="panel-header">
        <span className="panel-title">Hierarchy</span>
        <button
          type="button"
          className="icon-button"
          aria-label="Create entity"
          title="Create entity"
          onClick={(event) => {
            const bounds = event.currentTarget.getBoundingClientRect();
            menu.open({ clientX: bounds.left, clientY: bounds.bottom + 2 }, createMenu(null));
          }}
        >
          <Icon name="plus" size={14} />
        </button>
      </header>
      <div className="scene-name" title="The scene being edited">
        <Icon name="scene" size={14} />
        <span>{scene.name}</span>
        {session.play.isActive && <span className="badge">Playing</span>}
      </div>
      <div className="tree-search">
        <input
          type="search"
          className="text-field"
          placeholder="Search entities"
          aria-label="Search entities"
          value={search}
          spellCheck={false}
          onChange={(event) => setSearch(event.currentTarget.value)}
          onKeyDown={(event) => {
            if (event.key === 'Escape') {
              setSearch('');
            }
          }}
        />
      </div>
      <div
        className="panel-body tree"
        tabIndex={0}
        onClick={(event) => {
          if (event.target === event.currentTarget) {
            session.selectEntity(null);
          }
        }}
        onContextMenu={(event) => {
          if (event.target === event.currentTarget) {
            event.preventDefault();
            menu.open(event, [...createMenu(null), 'separator', pasteItem]);
          }
        }}
        onDragOver={(event) => {
          if (event.dataTransfer.types.includes(DRAG_TYPES.entity)) {
            event.preventDefault();
          }
        }}
        onDrop={(event) => handleDrop(event, null)}
      >
        <ul role="tree" aria-label="Entities">
          {(matches ?? scene.rootEntities).map((entity) => renderRow(entity, 0))}
        </ul>
        {matches?.length === 0 && <p className="empty-hint">No entity matches the search.</p>}
      </div>
      {menu.element}
    </section>
  );
}
