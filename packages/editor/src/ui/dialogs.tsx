import { useEffect, useState, type ReactElement } from 'react';
import {
  addCollisionLayer,
  DEFAULT_LAYER,
  describeError,
  ENGINE_VERSION,
  layersCollide,
  MAX_COLLISION_LAYERS,
  removeCollisionLayer,
  setLayersCollide,
} from '@rowan/core';
import type { EditorSession } from '../core/editorSession';
import type { ExportFormat } from '../core/exportGame';
import type { ProjectStore, ProjectSummary } from '../core/projectStore';
import type { ConfirmOptions, PromptOptions } from './editorContext';
import { FieldRow, Icon, Modal, NumberField, SelectField, TextField } from './widgets';

export function PromptDialog(props: {
  options: PromptOptions;
  onResolve: (value: string | null) => void;
}): ReactElement {
  const { options, onResolve } = props;
  const { choices } = options;
  const [value, setValue] = useState(options.initialValue ?? choices?.[0]?.value ?? '');
  // A choice is taken as it is. What was typed is tidied up, and must be something.
  const answer = choices ? value : value.trim();
  const valid = choices ? choices.some((choice) => choice.value === value) : answer !== '';
  return (
    <Modal
      title={options.title}
      onClose={() => onResolve(null)}
      footer={
        <>
          <button type="button" className="button" onClick={() => onResolve(null)}>
            Cancel
          </button>
          <button
            type="button"
            className="button primary"
            disabled={!valid}
            onClick={() => onResolve(answer)}
          >
            {options.confirmLabel ?? 'OK'}
          </button>
        </>
      }
    >
      <form
        onSubmit={(event) => {
          event.preventDefault();
          if (valid) {
            onResolve(answer);
          }
        }}
      >
        <label className="stacked-field">
          <span>{options.label}</span>
          {choices ? (
            <select
              className="select-field"
              autoFocus
              value={value}
              onChange={(event) => setValue(event.currentTarget.value)}
            >
              {choices.map((choice) => (
                <option key={choice.value} value={choice.value}>
                  {choice.label}
                </option>
              ))}
            </select>
          ) : (
            <input
              className="text-field"
              autoFocus
              value={value}
              spellCheck={false}
              onFocus={(event) => event.currentTarget.select()}
              onChange={(event) => setValue(event.currentTarget.value)}
            />
          )}
        </label>
      </form>
    </Modal>
  );
}

export function ConfirmDialog(props: {
  options: ConfirmOptions;
  onResolve: (confirmed: boolean) => void;
}): ReactElement {
  const { options, onResolve } = props;
  return (
    <Modal
      title={options.title}
      onClose={() => onResolve(false)}
      footer={
        <>
          <button type="button" className="button" onClick={() => onResolve(false)}>
            Cancel
          </button>
          <button
            type="button"
            autoFocus
            className={options.danger ? 'button danger' : 'button primary'}
            onClick={() => onResolve(true)}
          >
            {options.confirmLabel ?? 'OK'}
          </button>
        </>
      }
    >
      <p className="dialog-message">{options.message}</p>
    </Modal>
  );
}

export function ProjectSettingsDialog(props: {
  session: EditorSession;
  onClose: () => void;
}): ReactElement {
  const { session, onClose } = props;
  const { settings, assets } = session.project;
  const scenes = assets.list('scene');
  return (
    <Modal
      title="Project Settings"
      onClose={onClose}
      footer={
        <button type="button" className="button primary" onClick={onClose}>
          Done
        </button>
      }
    >
      <div className="settings-group">General</div>
      <FieldRow label="Name">
        <TextField
          value={settings.name}
          onChange={(name) =>
            session.updateSettings((draft) => {
              draft.name = name;
            })
          }
        />
      </FieldRow>
      <FieldRow label="Start Scene">
        <SelectField
          value={settings.startScene ?? ''}
          options={scenes.map((scene) => ({ value: scene.id, label: scene.name }))}
          onChange={(id) =>
            session.updateSettings((draft) => {
              draft.startScene = id;
            })
          }
        />
      </FieldRow>

      <div className="settings-group">Rendering</div>
      <FieldRow label="Resolution">
        <span className="vector-field">
          <NumberField
            prefix="W"
            value={settings.rendering.width}
            min={16}
            max={8192}
            step={1}
            onChange={(width) =>
              session.updateSettings((draft) => {
                draft.rendering.width = Math.round(width);
              })
            }
          />
          <NumberField
            prefix="H"
            value={settings.rendering.height}
            min={16}
            max={8192}
            step={1}
            onChange={(height) =>
              session.updateSettings((draft) => {
                draft.rendering.height = Math.round(height);
              })
            }
          />
        </span>
      </FieldRow>
      <FieldRow label="Pixel Art">
        <input
          type="checkbox"
          checked={settings.rendering.pixelArt}
          onChange={(event) => {
            const pixelArt = event.currentTarget.checked;
            session.updateSettings((draft) => {
              draft.rendering.pixelArt = pixelArt;
            });
          }}
        />
      </FieldRow>

      <div className="settings-group">Physics</div>
      <FieldRow label="Gravity">
        <span className="vector-field">
          {(['X', 'Y'] as const).map((axis, index) => (
            <NumberField
              key={axis}
              prefix={axis}
              value={settings.physics.gravity[index]!}
              onChange={(value) =>
                session.updateSettings((draft) => {
                  draft.physics.gravity[index] = value;
                })
              }
            />
          ))}
        </span>
      </FieldRow>
      <FieldRow label="Steps per Second">
        <NumberField
          value={Math.round(1 / settings.physics.fixedTimeStep)}
          min={10}
          max={240}
          step={1}
          onChange={(rate) =>
            session.updateSettings((draft) => {
              draft.physics.fixedTimeStep = 1 / rate;
            })
          }
        />
      </FieldRow>

      <div className="settings-group">Collision Layers</div>
      <CollisionLayersEditor session={session} />
    </Modal>
  );
}

/**
 * The collision layers of the project and a table of which of them collide. An entity is
 * put on a layer in the inspector.
 */
function CollisionLayersEditor({ session }: { session: EditorSession }): ReactElement {
  const { physics } = session.project.settings;
  const { layers } = physics;
  const [name, setName] = useState('');
  const full = layers.length >= MAX_COLLISION_LAYERS;
  const canAdd = name.trim() !== '' && !layers.includes(name.trim()) && !full;

  const add = (): void => {
    session.updateSettings((draft) => {
      addCollisionLayer(draft.physics, name);
    });
    setName('');
  };

  return (
    <>
      <div className="layer-add">
        <TextField
          ariaLabel="New layer name"
          placeholder={full ? `All ${MAX_COLLISION_LAYERS} layers are in use` : 'New layer name'}
          value={name}
          onChange={setName}
        />
        <button type="button" className="button" disabled={!canAdd} onClick={add}>
          Add Layer
        </button>
      </div>
      <table className="layer-matrix" aria-label="Which layers collide">
        <thead>
          <tr>
            <td />
            {layers.map((column) => (
              <th key={column} scope="col" title={column}>
                {column}
              </th>
            ))}
            <td />
          </tr>
        </thead>
        <tbody>
          {layers.map((row, rowIndex) => (
            <tr key={row}>
              <th scope="row" title={row}>
                {row}
              </th>
              {layers.map((column, columnIndex) => (
                <td key={column}>
                  {/* Each pair is shown once: the table is the same on both sides of its diagonal. */}
                  {columnIndex >= rowIndex && (
                    <input
                      type="checkbox"
                      aria-label={`${row} collides with ${column}`}
                      title={`${row} collides with ${column}`}
                      checked={layersCollide(physics, row, column)}
                      onChange={(event) => {
                        const collide = event.currentTarget.checked;
                        session.updateSettings((draft) => {
                          setLayersCollide(draft.physics, row, column, collide);
                        });
                      }}
                    />
                  )}
                </td>
              ))}
              <td>
                {row !== DEFAULT_LAYER && (
                  <button
                    type="button"
                    className="icon-button"
                    aria-label={`Remove layer ${row}`}
                    title="Remove layer"
                    onClick={() =>
                      session.updateSettings((draft) => {
                        removeCollisionLayer(draft.physics, row);
                      })
                    }
                  >
                    <Icon name="close" size={12} />
                  </button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}

export function BuildDialog(props: {
  session: EditorSession;
  onBuild: (format: ExportFormat) => Promise<void>;
  onClose: () => void;
}): ReactElement {
  const { session, onBuild, onClose } = props;
  const [format, setFormat] = useState<ExportFormat>('folder');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const build = async (): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      await onBuild(format);
      onClose();
    } catch (buildError) {
      setError(describeError(buildError));
      setBusy(false);
    }
  };

  return (
    <Modal
      title="Build Game"
      onClose={onClose}
      width={460}
      footer={
        <>
          <button type="button" className="button" onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className="button primary"
            disabled={busy}
            onClick={() => void build()}
          >
            {busy ? 'Building…' : 'Build'}
          </button>
        </>
      }
    >
      <p className="dialog-message">
        Builds a playable copy of <strong>{session.project.settings.name}</strong> without the
        editor. Scripts are compiled and the game starts in its start scene.
      </p>
      <label className="radio-option">
        <input
          type="radio"
          name="format"
          checked={format === 'folder'}
          onChange={() => setFormat('folder')}
        />
        <span>
          <strong>Web folder (.zip)</strong>
          <small>Unzip and upload to any web host. Best for larger games.</small>
        </span>
      </label>
      <label className="radio-option">
        <input
          type="radio"
          name="format"
          checked={format === 'single-file'}
          onChange={() => setFormat('single-file')}
        />
        <span>
          <strong>Single HTML file</strong>
          <small>One file with everything inside. Opens straight from disk.</small>
        </span>
      </label>
      {error && (
        <p className="dialog-error" role="alert">
          {error}
        </p>
      )}
    </Modal>
  );
}

export function OpenProjectDialog(props: {
  store: ProjectStore;
  currentId: string;
  onOpen: (id: string) => void;
  onClose: () => void;
}): ReactElement {
  const { store, currentId, onOpen, onClose } = props;
  const [projects, setProjects] = useState<ProjectSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  /** The project whose row is asking "really delete?". */
  const [confirming, setConfirming] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    store.list().then(
      (list) => {
        if (!cancelled) {
          setProjects(list);
        }
      },
      (listError: unknown) => {
        if (!cancelled) {
          setError(describeError(listError));
        }
      },
    );
    return () => {
      cancelled = true;
    };
  }, [store]);

  const remove = (id: string): void => {
    setConfirming(null);
    store.delete(id).then(
      () => setProjects((list) => list?.filter((project) => project.id !== id) ?? null),
      (deleteError: unknown) => setError(describeError(deleteError)),
    );
  };

  return (
    <Modal title="Open Project" onClose={onClose} width={480}>
      {error && (
        <p className="dialog-error" role="alert">
          {error}
        </p>
      )}
      {projects?.length === 0 && <p className="dialog-message">No saved projects yet.</p>}
      <ul className="project-list">
        {projects?.map((project) =>
          confirming === project.id ? (
            <li key={project.id} className="project-list-confirm">
              <span>
                Delete <strong>{project.name}</strong>? This cannot be undone.
              </span>
              <button type="button" className="button small" onClick={() => setConfirming(null)}>
                Cancel
              </button>
              <button
                type="button"
                className="button small danger"
                onClick={() => remove(project.id)}
              >
                Delete
              </button>
            </li>
          ) : (
            <li key={project.id}>
              <button
                type="button"
                className="project-list-open"
                disabled={project.id === currentId}
                onClick={() => onOpen(project.id)}
              >
                <strong>{project.name}</strong>
                <small>
                  {project.id === currentId
                    ? 'Currently open'
                    : `Saved ${new Date(project.updatedAt).toLocaleString()}`}
                </small>
              </button>
              <button
                type="button"
                className="icon-button"
                aria-label={`Delete ${project.name}`}
                disabled={project.id === currentId}
                onClick={() => setConfirming(project.id)}
              >
                <Icon name="trash" size={14} />
              </button>
            </li>
          ),
        )}
      </ul>
    </Modal>
  );
}

export function AboutDialog({ onClose }: { onClose: () => void }): ReactElement {
  return (
    <Modal
      title="About Rowan"
      onClose={onClose}
      footer={
        <button type="button" className="button primary" onClick={onClose}>
          Close
        </button>
      }
    >
      <p className="dialog-message">
        <strong>Rowan {ENGINE_VERSION}</strong>
        <br />A 2D game engine and editor that runs in the browser.
      </p>
      <p className="dialog-message">
        Scripts are TypeScript classes that extend <code>Behaviour</code>. Projects are stored in
        this browser; use File → Export Project File to back them up or move them.
      </p>
      <p className="dialog-message">
        Scene view: drag with the middle or right mouse button to pan, scroll to zoom, press F to
        frame the selection. Q, W, E and R switch tools. Turn on Snap in the toolbar to move, rotate
        and scale in fixed steps; holding Ctrl while dragging does the opposite.
      </p>
    </Modal>
  );
}
