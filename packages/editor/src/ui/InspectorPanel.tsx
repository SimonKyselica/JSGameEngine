import { useState, type ReactElement } from 'react';
import {
  COMPONENT_TYPES,
  formatFieldLabel,
  getBaseName,
  getEmptyStoredValue,
  getPropertyAssetType,
  Identity,
  isValidStoredValue,
  MathUtils,
  ScriptComponent,
  type AssetRecord,
  type AssetType,
  type Color,
  type ComponentType,
  type Entity,
  type FieldSchema,
  type ScriptBinding,
  type ScriptPropertyDefinition,
  type ScriptPropertyValue,
  type Vec2,
} from '@rowan/core';
import { DRAG_TYPES, useEditor } from './editorContext';
import {
  ColorField,
  FieldRow,
  Icon,
  NumberField,
  SelectField,
  TextField,
  useContextMenu,
  type MenuEntry,
} from './widgets';

/** Shows and edits whatever is selected: an entity's components or an asset. */
export function InspectorPanel(): ReactElement {
  const { session } = useEditor();
  const entity = session.selectedEntity;
  const asset = session.selectedAsset;
  return (
    <section className="panel inspector" aria-label="Inspector">
      <header className="panel-header">
        <span className="panel-title">Inspector</span>
      </header>
      <div className="panel-body">
        {entity && <EntityInspector key={entity.uuid} entity={entity} />}
        {asset && <AssetInspector key={asset.id} asset={asset} />}
        {!entity && !asset && (
          <p className="empty-hint">Select an entity or an asset to see its properties.</p>
        )}
      </div>
    </section>
  );
}

// --- Entities ------------------------------------------------------------------------------------

function EntityInspector({ entity }: { entity: Entity }): ReactElement {
  const { session } = useEditor();
  const menu = useContextMenu();
  const editKey = (field: string): string => `${entity.uuid}:Identity:${field}`;

  const addable = COMPONENT_TYPES.filter(
    (type) => type.schema.removable && !entity.hasComponent(type),
  );
  const addMenu: MenuEntry[] = [];
  for (const [index, type] of addable.entries()) {
    if (index > 0 && addable[index - 1]!.schema.category !== type.schema.category) {
      addMenu.push('separator');
    }
    addMenu.push({
      label: type.schema.displayName,
      onSelect: () => session.addComponent(entity, type),
    });
  }

  return (
    <>
      <div className="entity-header">
        <input
          type="checkbox"
          aria-label="Active"
          title="Active"
          checked={entity.active}
          onChange={(event) => {
            const active = event.currentTarget.checked;
            session.edit(() => {
              entity.active = active;
            });
          }}
        />
        <TextField
          ariaLabel="Name"
          value={entity.name}
          onChange={(name) =>
            session.edit(() => {
              entity.name = name;
            }, editKey('name'))
          }
        />
      </div>
      <FieldRow label="Tag">
        <TextField
          value={entity.tag}
          placeholder="Untagged"
          onChange={(tag) =>
            session.edit(() => {
              entity.tag = tag;
            }, editKey('tag'))
          }
        />
      </FieldRow>

      {COMPONENT_TYPES.filter((type) => type !== Identity && entity.hasComponent(type)).map(
        (type) => (
          <ComponentSection key={type.schema.name} entity={entity} type={type} />
        ),
      )}

      <button
        type="button"
        className="button add-component"
        disabled={addable.length === 0}
        onClick={(event) => {
          const bounds = event.currentTarget.getBoundingClientRect();
          menu.open({ clientX: bounds.left, clientY: bounds.bottom + 2 }, addMenu);
        }}
      >
        Add Component
      </button>
      {menu.element}
    </>
  );
}

function ComponentSection({ entity, type }: { entity: Entity; type: ComponentType }): ReactElement {
  const { session } = useEditor();
  const [open, setOpen] = useState(true);
  const { schema } = type;
  return (
    <div className="component">
      <div className="component-header">
        <button
          type="button"
          className="component-toggle"
          aria-expanded={open}
          onClick={() => setOpen(!open)}
        >
          <Icon name={open ? 'chevronDown' : 'chevronRight'} size={12} />
          <span>{schema.displayName}</span>
        </button>
        {schema.removable && (
          <button
            type="button"
            className="icon-button"
            aria-label={`Remove ${schema.displayName}`}
            title="Remove component"
            onClick={() => session.removeComponent(entity, type)}
          >
            <Icon name="close" size={12} />
          </button>
        )}
      </div>
      {open && (
        <div className="component-body">
          {type === ScriptComponent ? (
            <ScriptsEditor entity={entity} />
          ) : (
            Object.entries(schema.fields)
              .filter(([, field]) => !field.hidden)
              .map(([name, field]) => (
                <ComponentField key={name} entity={entity} type={type} name={name} field={field} />
              ))
          )}
        </div>
      )}
    </div>
  );
}

interface ComponentFieldProps {
  readonly entity: Entity;
  readonly type: ComponentType;
  readonly name: string;
  readonly field: FieldSchema;
}

/** One field of a component, with the control its schema type calls for. */
function ComponentField({ entity, type, name, field }: ComponentFieldProps): ReactElement {
  const { session } = useEditor();
  const component = entity.requireComponent(type) as Record<string, unknown>;
  const label = field.label ?? formatFieldLabel(name);
  const editKey = `${entity.uuid}:${type.schema.name}:${name}`;
  const edit = (mutate: () => void): void => session.edit(mutate, editKey);
  const assign = (value: unknown): void =>
    edit(() => {
      component[name] = value;
    });

  switch (field.type) {
    case 'number':
      return (
        <FieldRow label={label}>
          <NumberField
            value={component[name] as number}
            min={field.min}
            max={field.max}
            step={field.step}
            onChange={assign}
          />
        </FieldRow>
      );
    case 'angle':
      return (
        <FieldRow label={label}>
          <NumberField
            value={MathUtils.radToDeg(component[name] as number)}
            step={1}
            onChange={(degrees) => assign(MathUtils.degToRad(degrees))}
          />
        </FieldRow>
      );
    case 'boolean':
      return (
        <FieldRow label={label}>
          <input
            type="checkbox"
            checked={component[name] as boolean}
            onChange={(event) => assign(event.currentTarget.checked)}
          />
        </FieldRow>
      );
    case 'string':
      return (
        <FieldRow label={label}>
          <TextField value={component[name] as string} onChange={assign} />
        </FieldRow>
      );
    case 'vec2': {
      const vector = component[name] as Vec2;
      return (
        <FieldRow label={label}>
          <span className="vector-field">
            {(['x', 'y'] as const).map((axis) => (
              <NumberField
                key={axis}
                prefix={axis.toUpperCase()}
                ariaLabel={`${label} ${axis.toUpperCase()}`}
                value={vector[axis]}
                step={field.step}
                onChange={(value) =>
                  edit(() => {
                    vector[axis] = value;
                  })
                }
              />
            ))}
          </span>
        </FieldRow>
      );
    }
    case 'color': {
      const color = component[name] as Color;
      return (
        <FieldRow label={label}>
          <ColorField
            value={color.toArray()}
            onChange={([red, green, blue, alpha]) => edit(() => color.set(red, green, blue, alpha))}
          />
        </FieldRow>
      );
    }
    case 'enum':
      return (
        <FieldRow label={label}>
          <SelectField
            value={component[name] as string}
            options={(field.options ?? []).map((option) => ({
              value: option,
              label: formatFieldLabel(option),
            }))}
            onChange={assign}
          />
        </FieldRow>
      );
    case 'asset':
      return (
        <FieldRow label={label}>
          <AssetField
            value={component[name] as string | null}
            assetType={field.assetType ?? 'texture'}
            onChange={assign}
          />
        </FieldRow>
      );
    case 'json':
      return <></>;
  }
}

interface AssetFieldProps {
  readonly value: string | null;
  readonly assetType: AssetType;
  readonly onChange: (assetId: string | null) => void;
}

/** Chooses an asset of one type, from a list or by dropping it from the Project panel. */
function AssetField({ value, assetType, onChange }: AssetFieldProps): ReactElement {
  const { session } = useEditor();
  const { assets } = session.project;
  const options = [
    { value: '', label: 'None' },
    ...assets.list(assetType).map((record) => ({ value: record.id, label: record.name })),
  ];
  // Keep a reference to a deleted asset visible instead of silently showing "None".
  if (value !== null && !assets.has(value)) {
    options.push({ value, label: 'Missing asset' });
  }
  return (
    <span
      className="asset-field"
      onDragOver={(event) => {
        if (event.dataTransfer.types.includes(DRAG_TYPES.asset)) {
          event.preventDefault();
        }
      }}
      onDrop={(event) => {
        const dropped = assets.get(event.dataTransfer.getData(DRAG_TYPES.asset));
        if (dropped?.type === assetType) {
          event.preventDefault();
          onChange(dropped.id);
        }
      }}
    >
      <SelectField
        value={value ?? ''}
        options={options}
        onChange={(id) => onChange(id === '' ? null : id)}
      />
    </span>
  );
}

// --- Scripts -------------------------------------------------------------------------------------

function ScriptsEditor({ entity }: { entity: Entity }): ReactElement {
  const { session, commands, openScript } = useEditor();
  const menu = useContextMenu();
  const component = entity.requireComponent(ScriptComponent);
  const scripts = session.project.assets.list('script');

  const addMenu: MenuEntry[] = [
    ...scripts.map((script) => ({
      label: getBaseName(script.name),
      onSelect: () => session.addScript(entity, script.id),
    })),
    ...(scripts.length > 0 ? (['separator'] as const) : []),
    { label: 'New Script…', onSelect: () => commands.createScript('Scripts') },
  ];

  return (
    <>
      {component.scripts.map((binding, index) => (
        <div className="script-binding" key={index}>
          <div className="script-binding-header">
            <input
              type="checkbox"
              aria-label="Enabled"
              title="Enabled"
              checked={binding.enabled}
              onChange={(event) => {
                const enabled = event.currentTarget.checked;
                session.edit(() => {
                  binding.enabled = enabled;
                });
              }}
            />
            <AssetField
              value={binding.script}
              assetType="script"
              onChange={(script) =>
                session.edit(() => {
                  binding.script = script;
                })
              }
            />
            <button
              type="button"
              className="icon-button"
              aria-label="Edit script"
              title="Edit script"
              disabled={binding.script === null || !session.project.assets.has(binding.script)}
              onClick={() => binding.script && openScript(binding.script)}
            >
              <Icon name="script" size={14} />
            </button>
            <button
              type="button"
              className="icon-button"
              aria-label="Remove script"
              title="Remove script"
              onClick={() => session.edit(() => component.scripts.splice(index, 1))}
            >
              <Icon name="close" size={12} />
            </button>
          </div>
          {binding.script !== null && session.project.assets.has(binding.script) && (
            <ScriptProperties entity={entity} binding={binding} index={index} />
          )}
        </div>
      ))}
      <button
        type="button"
        className="button add-script"
        onClick={(event) => {
          const bounds = event.currentTarget.getBoundingClientRect();
          menu.open({ clientX: bounds.left, clientY: bounds.bottom + 2 }, addMenu);
        }}
      >
        Add Script
      </button>
      {menu.element}
    </>
  );
}

interface ScriptPropertiesProps {
  readonly entity: Entity;
  readonly binding: ScriptBinding;
  readonly index: number;
}

/** The inspector properties a script declares in its static `properties`. */
function ScriptProperties({ entity, binding, index }: ScriptPropertiesProps): ReactElement {
  const { session } = useEditor();
  const info = session.getScriptInfo(binding.script!);
  if (info.error) {
    return (
      <p className="script-error" role="alert">
        {info.error}
      </p>
    );
  }
  return (
    <>
      {Object.entries(info.properties).map(([name, definition]) => (
        <ScriptPropertyField
          key={name}
          name={name}
          definition={definition}
          value={binding.properties[name]}
          onChange={(value) =>
            session.edit(() => {
              binding.properties[name] = value;
            }, `${entity.uuid}:Script:${index}:${name}`)
          }
        />
      ))}
    </>
  );
}

interface ScriptPropertyFieldProps {
  readonly name: string;
  readonly definition: ScriptPropertyDefinition;
  readonly value: ScriptPropertyValue | undefined;
  readonly onChange: (value: ScriptPropertyValue) => void;
}

function ScriptPropertyField(props: ScriptPropertyFieldProps): ReactElement {
  const { name, definition, onChange } = props;
  const label = definition.label ?? formatFieldLabel(name);
  // Show what the script will actually get: the stored value, else its default.
  const value = isValidStoredValue(definition.type, props.value)
    ? props.value
    : (definition.default ?? getEmptyStoredValue(definition.type));

  switch (definition.type) {
    case 'number':
      return (
        <FieldRow label={label}>
          <NumberField
            value={value as number}
            min={definition.min}
            max={definition.max}
            step={definition.step}
            onChange={onChange}
          />
        </FieldRow>
      );
    case 'boolean':
      return (
        <FieldRow label={label}>
          <input
            type="checkbox"
            checked={value as boolean}
            onChange={(event) => onChange(event.currentTarget.checked)}
          />
        </FieldRow>
      );
    case 'string':
      return (
        <FieldRow label={label}>
          <TextField value={value as string} onChange={onChange} />
        </FieldRow>
      );
    case 'vec2': {
      const vector = value as number[];
      return (
        <FieldRow label={label}>
          <span className="vector-field">
            {(['X', 'Y'] as const).map((axis, axisIndex) => (
              <NumberField
                key={axis}
                prefix={axis}
                ariaLabel={`${label} ${axis}`}
                value={vector[axisIndex] ?? 0}
                step={definition.step}
                onChange={(next) => {
                  const copy = [vector[0] ?? 0, vector[1] ?? 0];
                  copy[axisIndex] = next;
                  onChange(copy);
                }}
              />
            ))}
          </span>
        </FieldRow>
      );
    }
    case 'color': {
      const color = value as number[];
      return (
        <FieldRow label={label}>
          <ColorField
            value={[color[0] ?? 1, color[1] ?? 1, color[2] ?? 1, color[3] ?? 1]}
            onChange={onChange}
          />
        </FieldRow>
      );
    }
    case 'texture':
    case 'audio':
    case 'prefab':
      return (
        <FieldRow label={label}>
          <AssetField
            value={value as string | null}
            assetType={getPropertyAssetType(definition.type)!}
            onChange={onChange}
          />
        </FieldRow>
      );
  }
}

// --- Assets --------------------------------------------------------------------------------------

function AssetInspector({ asset }: { asset: AssetRecord }): ReactElement {
  const { session, assetUrls, openScript, confirm } = useEditor();
  const [name, setName] = useState(asset.name);
  const { settings, assets } = session.project;
  const url = assetUrls.get(asset);
  const isStartScene = settings.startScene === asset.id;

  const deleteAsset = async (): Promise<void> => {
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

  return (
    <>
      <FieldRow label="Name">
        <input
          className="text-field"
          value={name}
          spellCheck={false}
          onChange={(event) => setName(event.currentTarget.value)}
          onBlur={() => {
            session.renameAsset(asset.id, name);
            setName(asset.name);
          }}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.currentTarget.blur();
            }
          }}
        />
      </FieldRow>
      <FieldRow label="Type">
        <span className="field-text">{formatFieldLabel(asset.type)}</span>
      </FieldRow>

      {asset.type === 'texture' && url && (
        <>
          <FieldRow label="Size">
            <span className="field-text">
              {asset.meta.width ?? '?'} × {asset.meta.height ?? '?'} pixels
            </span>
          </FieldRow>
          <div className="asset-preview">
            <img src={url} alt={asset.name} />
          </div>
        </>
      )}
      {asset.type === 'audio' && url && (
        <div className="asset-preview">
          <audio controls src={url} />
        </div>
      )}

      <div className="asset-actions">
        {asset.type === 'script' && (
          <button type="button" className="button primary" onClick={() => openScript(asset.id)}>
            Edit Script
          </button>
        )}
        {asset.type === 'scene' && (
          <>
            <button
              type="button"
              className="button primary"
              disabled={session.sceneAssetId === asset.id}
              onClick={() => session.openScene(asset.id)}
            >
              {session.sceneAssetId === asset.id ? 'Scene Is Open' : 'Open Scene'}
            </button>
            <button
              type="button"
              className="button"
              disabled={isStartScene}
              onClick={() =>
                session.updateSettings((draft) => {
                  draft.startScene = asset.id;
                })
              }
            >
              {isStartScene ? 'Start Scene' : 'Set as Start Scene'}
            </button>
          </>
        )}
        {asset.type === 'prefab' && (
          <button
            type="button"
            className="button primary"
            onClick={() => session.instantiatePrefab(asset.id)}
          >
            Add to Scene
          </button>
        )}
        {asset.type === 'texture' && (
          <button
            type="button"
            className="button primary"
            onClick={() => session.createSprite(asset.id)}
          >
            Create Sprite
          </button>
        )}
        <button
          type="button"
          className="button danger"
          disabled={asset.type === 'scene' && assets.list('scene').length === 1}
          onClick={() => void deleteAsset()}
        >
          Delete
        </button>
      </div>
    </>
  );
}
