import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactElement,
} from 'react';
import {
  decodeImageInBrowser,
  describeError,
  generateUuid,
  getBaseName,
  getSupportedExtensions,
  Project,
} from '@rowan/core';
import { EditorCamera } from '../core/editorCamera';
import { EditorSession } from '../core/editorSession';
import { exportGame, toFileName, type ExportFormat } from '../core/exportGame';
import { getEntityBounds } from '../core/picking';
import { packProject, PROJECT_FILE_EXTENSION, unpackProject } from '../core/projectFile';
import { IndexedDbProjectStore, MemoryProjectStore, type ProjectStore } from '../core/projectStore';
import { createStarterProject } from '../core/templates';
import { AssetUrlCache } from './assetUrls';
import { ConsolePanel } from './ConsolePanel';
import {
  AboutDialog,
  BuildDialog,
  ConfirmDialog,
  OpenProjectDialog,
  ProjectSettingsDialog,
  PromptDialog,
} from './dialogs';
import {
  EditorContext,
  useConsoleEntries,
  useEditor,
  type ConfirmOptions,
  type EditorApi,
  type EditorCommands,
  type PromptOptions,
  type ViewportState,
} from './editorContext';
import { downloadFile, pickFiles, readFiles } from './files';
import { HierarchyPanel } from './HierarchyPanel';
import { InspectorPanel } from './InspectorPanel';
import { MenuBar } from './MenuBar';
import { ProjectPanel } from './ProjectPanel';
import { Toolbar } from './Toolbar';
import { ViewportPanel } from './ViewportPanel';
import { Icon } from './widgets';

// The code editor is large and only needed once a script is opened.
const ScriptEditor = lazy(() =>
  import('./ScriptEditor').then((module) => ({ default: module.ScriptEditor })),
);

const LAST_PROJECT_KEY = 'rowan:lastProject';
const SNAPPING_KEY = 'rowan:snapping';

/** Reads a preference kept in the browser. Returns `null` when storage is unavailable. */
function readPreference(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

/** Stores a preference in the browser. Preferences are a convenience, so failures are ignored. */
function writePreference(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Storage can be disabled or full; the editor works the same without it.
  }
}

/** One open project together with the objects that live exactly as long as it is open. */
interface Workspace {
  readonly session: EditorSession;
  readonly assetUrls: AssetUrlCache;
  readonly viewport: ViewportState;
}

function createWorkspace(project: Project): Workspace {
  const session = new EditorSession(project);
  session.snapping = readPreference(SNAPPING_KEY) === 'on';
  return {
    session,
    assetUrls: new AssetUrlCache(project.assets),
    viewport: { camera: new EditorCamera(), aspect: 16 / 9 },
  };
}

function disposeWorkspace(workspace: Workspace): void {
  workspace.session.dispose();
  workspace.assetUrls.dispose();
}

function createStore(): ProjectStore {
  return typeof indexedDB === 'undefined' ? new MemoryProjectStore() : new IndexedDbProjectStore();
}

interface InitialProject {
  readonly project: Project;
  /** Set when stored projects could not be read and the editor fell back to a new one. */
  readonly problem: string | null;
}

/** Opens the project the user worked on last, or creates the starter project. */
async function loadInitialProject(store: ProjectStore): Promise<InitialProject> {
  try {
    const id = readPreference(LAST_PROJECT_KEY) ?? (await store.list())[0]?.id;
    const archive = id ? await store.load(id) : null;
    if (archive) {
      return { project: Project.fromArchive(archive), problem: null };
    }
    const starter = createStarterProject('My Game');
    await store.save(starter.toArchive());
    return { project: starter, problem: null };
  } catch (error) {
    // Work in memory rather than refusing to start when storage is broken or damaged.
    return {
      project: createStarterProject('My Game'),
      problem: `Stored projects could not be loaded, so a new project was started: ${describeError(error)}`,
    };
  }
}

export function App(): ReactElement {
  const [store] = useState(createStore);
  const [workspace, setWorkspace] = useState<Workspace | null>(null);
  // Disposing is a side effect, so the current workspace is tracked outside React state.
  const workspaceRef = useRef<Workspace | null>(null);

  const replaceProject = useCallback((project: Project, stored = true) => {
    if (workspaceRef.current) {
      disposeWorkspace(workspaceRef.current);
    }
    const next = createWorkspace(project);
    if (stored) {
      writePreference(LAST_PROJECT_KEY, project.id);
    } else {
      // A project that exists only in memory has, by definition, unsaved changes.
      next.session.dirty = true;
    }
    workspaceRef.current = next;
    setWorkspace(next);
  }, []);

  useEffect(() => {
    let cancelled = false;
    void loadInitialProject(store).then(({ project, problem }) => {
      if (cancelled) {
        return;
      }
      replaceProject(project);
      if (problem) {
        workspaceRef.current?.session.logger.error(problem);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [store, replaceProject]);

  if (!workspace) {
    return (
      <div className="splash" role="status">
        Loading Rowan…
      </div>
    );
  }
  return (
    <Editor
      key={workspace.session.project.id}
      workspace={workspace}
      store={store}
      onReplaceProject={replaceProject}
    />
  );
}

type DialogState =
  | { kind: 'prompt'; options: PromptOptions; resolve: (value: string | null) => void }
  | { kind: 'confirm'; options: ConfirmOptions; resolve: (confirmed: boolean) => void }
  | { kind: 'settings' | 'build' | 'open' | 'about' }
  | null;

interface EditorProps {
  readonly workspace: Workspace;
  readonly store: ProjectStore;
  /** Opens another project. `stored` is false for one that is not in the project store. */
  readonly onReplaceProject: (project: Project, stored?: boolean) => void;
}

function Editor({ workspace, store, onReplaceProject }: EditorProps): ReactElement {
  const { session, assetUrls, viewport } = workspace;
  const [dialog, setDialog] = useState<DialogState>(null);
  const [centerTab, setCenterTab] = useState('scene');
  const [scriptTabs, setScriptTabs] = useState<readonly string[]>([]);
  const [bottomTab, setBottomTab] = useState<'project' | 'console'>('project');
  const [sizes, setSizes] = useState({ left: 250, right: 330, bottom: 250 });

  const prompt = useCallback(
    (options: PromptOptions) =>
      new Promise<string | null>((resolve) => {
        setDialog({
          kind: 'prompt',
          options,
          resolve: (value) => {
            setDialog(null);
            resolve(value);
          },
        });
      }),
    [],
  );

  const confirm = useCallback(
    (options: ConfirmOptions) =>
      new Promise<boolean>((resolve) => {
        setDialog({
          kind: 'confirm',
          options,
          resolve: (confirmed) => {
            setDialog(null);
            resolve(confirmed);
          },
        });
      }),
    [],
  );

  const openScript = useCallback((assetId: string) => {
    setScriptTabs((tabs) => (tabs.includes(assetId) ? tabs : [...tabs, assetId]));
    setCenterTab(assetId);
  }, []);

  const api = useMemo<EditorApi>(() => {
    const report = (action: string, error: unknown): void =>
      session.logger.error(`Could not ${action}: ${describeError(error)}`);

    /** Asks before throwing away unsaved changes. Resolves to `true` when it is fine to go on. */
    const confirmDiscard = async (): Promise<boolean> =>
      !session.dirty ||
      confirm({
        title: 'Unsaved Changes',
        message: `"${session.project.settings.name}" has unsaved changes. Continue without saving?`,
        confirmLabel: 'Discard Changes',
        danger: true,
      });

    const commands: EditorCommands = {
      save: () => {
        session.save(store).then(
          () => session.logger.info('Project saved'),
          (error: unknown) => report('save the project', error),
        );
      },
      newProject: () => {
        void (async () => {
          if (!(await confirmDiscard())) {
            return;
          }
          const name = await prompt({
            title: 'New Project',
            label: 'Project name',
            initialValue: 'My Game',
            confirmLabel: 'Create',
          });
          if (!name) {
            return;
          }
          const project = createStarterProject(name);
          try {
            await store.save(project.toArchive());
          } catch (error) {
            report('store the new project', error);
          }
          onReplaceProject(project);
        })();
      },
      openProject: () => setDialog({ kind: 'open' }),
      importProjectFile: () => {
        void (async () => {
          const [file] = await pickFiles(`.${PROJECT_FILE_EXTENSION},.zip`, false);
          if (!file || !(await confirmDiscard())) {
            return;
          }
          try {
            const archive = unpackProject(new Uint8Array(await file.arrayBuffer()));
            // Importing must never overwrite a different project that is already stored.
            if ((await store.load(archive.manifest.id)) !== null) {
              archive.manifest.id = generateUuid();
            }
            const project = Project.fromArchive(archive);
            await store.save(project.toArchive());
            onReplaceProject(project);
          } catch (error) {
            report(`import "${file.name}"`, error);
          }
        })();
      },
      exportProjectFile: () => {
        try {
          session.commitScene();
          downloadFile(
            `${toFileName(session.project.settings.name)}.${PROJECT_FILE_EXTENSION}`,
            'application/zip',
            packProject(session.project.toArchive()),
          );
        } catch (error) {
          report('export the project', error);
        }
      },
      openSettings: () => setDialog({ kind: 'settings' }),
      openBuild: () => setDialog({ kind: 'build' }),
      openFeatureTest: () => {
        void (async () => {
          if (await confirmDiscard()) {
            const { createFeatureTestProject } = await import('@rowan/feature-test');
            onReplaceProject(createFeatureTestProject(), false);
          }
        })();
      },
      importAssets: (folder) => {
        void (async () => {
          const accept = getSupportedExtensions()
            .map((extension) => `.${extension}`)
            .join(',');
          const files = await readFiles(await pickFiles(accept, true));
          await session.importFiles(files, folder, decodeImageInBrowser);
        })();
      },
      createScript: (folder) => {
        void prompt({
          title: 'New Script',
          label: 'Script name',
          initialValue: 'NewScript',
          confirmLabel: 'Create',
        }).then((name) => {
          if (name) {
            openScript(session.createScript(name, folder).id);
          }
        });
      },
      createScene: () => {
        void prompt({
          title: 'New Scene',
          label: 'Scene name',
          initialValue: 'New Scene',
          confirmLabel: 'Create',
        }).then((name) => {
          if (name) {
            session.createScene(name);
          }
        });
      },
      focusSelection: () => {
        const entity = session.selectedEntity;
        if (entity) {
          viewport.camera.focus(getEntityBounds(entity, session.project.assets), viewport.aspect);
        }
      },
      toggleSnapping: () => {
        session.setSnapping(!session.snapping);
        writePreference(SNAPPING_KEY, session.snapping ? 'on' : 'off');
      },
      showAbout: () => setDialog({ kind: 'about' }),
    };

    return {
      session,
      imageDecoder: decodeImageInBrowser,
      assetUrls,
      viewport,
      commands,
      openScript,
      prompt,
      confirm,
    };
  }, [session, assetUrls, viewport, store, onReplaceProject, prompt, confirm, openScript]);

  const togglePlay = useCallback(() => {
    if (session.play.state === 'stopped') {
      setCenterTab('game');
      void session.play.start();
    } else {
      session.play.stop();
      setCenterTab('scene');
    }
  }, [session]);

  const build = useCallback(
    async (format: ExportFormat) => {
      session.commitScene();
      // The player script is only needed for builds, so it is loaded on demand.
      const { default: playerSource } = await import('@rowan/runtime/player?raw');
      const exported = exportGame(session.project, playerSource, format);
      downloadFile(exported.fileName, exported.mimeType, exported.data);
      session.logger.info(`Built ${exported.fileName}`);
    },
    [session],
  );

  // The handler reads the latest tab without being re-attached on every tab change.
  const centerTabRef = useRef(centerTab);
  useEffect(() => {
    centerTabRef.current = centerTab;
  }, [centerTab]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent): void => {
      const target = event.target as HTMLElement | null;
      const modifier = event.ctrlKey || event.metaKey;
      const key = event.key.toLowerCase();

      if (modifier && key === 's') {
        event.preventDefault();
        api.commands.save();
        return;
      }
      if (modifier && key === 'p') {
        event.preventDefault();
        togglePlay();
        return;
      }
      if (modifier && key === 'b') {
        event.preventDefault();
        api.commands.openBuild();
        return;
      }

      const typing =
        target !== null &&
        (target.isContentEditable ||
          ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName) ||
          target.closest('.cm-editor, .modal') !== null);
      // While the game has the keyboard, plain keys belong to the game.
      const gameHasKeyboard = session.play.state === 'playing' && centerTabRef.current === 'game';
      if (typing || gameHasKeyboard) {
        return;
      }

      const entity = session.selectedEntity;
      if (modifier && key === 'z') {
        event.preventDefault();
        if (event.shiftKey) {
          session.redo();
        } else {
          session.undo();
        }
      } else if (modifier && key === 'y') {
        event.preventDefault();
        session.redo();
      } else if (modifier && key === 'd') {
        event.preventDefault();
        if (entity) {
          session.duplicateEntity(entity);
        }
      } else if (modifier && (key === 'c' || key === 'x')) {
        // Text the user has selected, in the console for example, keeps its normal copy.
        const hasTextSelection = (window.getSelection()?.toString() ?? '') !== '';
        if (entity && !hasTextSelection) {
          event.preventDefault();
          if (key === 'c') {
            session.copyEntity(entity);
          } else {
            session.cutEntity(entity);
          }
        }
      } else if (modifier && key === 'v') {
        if (session.canPaste) {
          event.preventDefault();
          session.pasteEntity();
        }
      } else if ((key === 'delete' || key === 'backspace') && entity) {
        event.preventDefault();
        session.deleteEntity(entity);
      } else if (!modifier && !event.altKey) {
        const tools = { q: 'hand', w: 'move', e: 'rotate', r: 'scale' } as const;
        if (key in tools) {
          session.setTool(tools[key as keyof typeof tools]);
        } else if (key === 'f') {
          api.commands.focusSelection();
        }
      }
    };

    const handleBeforeUnload = (event: BeforeUnloadEvent): void => {
      if (session.dirty) {
        event.preventDefault();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('beforeunload', handleBeforeUnload);
    };
  }, [api, session, togglePlay]);

  const openStored = async (id: string): Promise<void> => {
    setDialog(null);
    try {
      const archive = await store.load(id);
      if (archive) {
        onReplaceProject(Project.fromArchive(archive));
      }
    } catch (error) {
      session.logger.error(`Could not open the project: ${describeError(error)}`);
    }
  };

  return (
    <EditorContext.Provider value={api}>
      <EditorLayout
        centerTab={centerTab}
        onCenterTab={setCenterTab}
        scriptTabs={scriptTabs}
        onCloseScript={(id) => {
          setScriptTabs((tabs) => tabs.filter((tab) => tab !== id));
          setCenterTab((tab) => (tab === id ? 'scene' : tab));
        }}
        bottomTab={bottomTab}
        onBottomTab={setBottomTab}
        sizes={sizes}
        onResize={setSizes}
        onPlayToggle={togglePlay}
      />
      {dialog?.kind === 'prompt' && (
        <PromptDialog options={dialog.options} onResolve={dialog.resolve} />
      )}
      {dialog?.kind === 'confirm' && (
        <ConfirmDialog options={dialog.options} onResolve={dialog.resolve} />
      )}
      {dialog?.kind === 'settings' && <SettingsDialogHost onClose={() => setDialog(null)} />}
      {dialog?.kind === 'build' && (
        <BuildDialog session={session} onBuild={build} onClose={() => setDialog(null)} />
      )}
      {dialog?.kind === 'open' && (
        <OpenProjectDialog
          store={store}
          currentId={session.project.id}
          onOpen={(id) => void openStored(id)}
          onClose={() => setDialog(null)}
        />
      )}
      {dialog?.kind === 'about' && <AboutDialog onClose={() => setDialog(null)} />}
    </EditorContext.Provider>
  );
}

/** Re-renders the settings dialog as the settings it edits change. */
function SettingsDialogHost({ onClose }: { onClose: () => void }): ReactElement {
  const { session } = useEditor();
  return <ProjectSettingsDialog session={session} onClose={onClose} />;
}

interface PanelSizes {
  readonly left: number;
  readonly right: number;
  readonly bottom: number;
}

interface EditorLayoutProps {
  readonly centerTab: string;
  readonly onCenterTab: (tab: string) => void;
  readonly scriptTabs: readonly string[];
  readonly onCloseScript: (assetId: string) => void;
  readonly bottomTab: 'project' | 'console';
  readonly onBottomTab: (tab: 'project' | 'console') => void;
  readonly sizes: PanelSizes;
  readonly onResize: (sizes: PanelSizes) => void;
  readonly onPlayToggle: () => void;
}

const clampSize = (value: number, min: number, max: number): number =>
  Math.round(Math.min(max, Math.max(min, value)));

function EditorLayout(props: EditorLayoutProps): ReactElement {
  const { centerTab, onCenterTab, bottomTab, onBottomTab, sizes, onResize } = props;
  const { session } = useEditor();

  // Tabs of scripts that were deleted disappear by themselves.
  const scriptTabs = props.scriptTabs.filter((id) => session.project.assets.has(id));
  const activeTab =
    centerTab === 'scene' || centerTab === 'game' || scriptTabs.includes(centerTab)
      ? centerTab
      : 'scene';
  const showingViewport = activeTab === 'scene' || activeTab === 'game';

  return (
    <div className="app">
      <MenuBar />
      <Toolbar onPlayToggle={props.onPlayToggle} />
      <div className="workspace">
        <div className="side" style={{ width: sizes.left }}>
          <HierarchyPanel />
        </div>
        <Splitter
          orientation="vertical"
          label="Resize hierarchy"
          onDrag={(delta) => onResize({ ...sizes, left: clampSize(sizes.left + delta, 160, 520) })}
        />
        <div className="center">
          <div className="center-top">
            <div className="tab-bar" role="tablist" aria-label="Views">
              {(['scene', 'game'] as const).map((tab) => (
                <button
                  key={tab}
                  type="button"
                  role="tab"
                  aria-selected={activeTab === tab}
                  className={activeTab === tab ? 'tab active' : 'tab'}
                  onClick={() => onCenterTab(tab)}
                >
                  {tab === 'scene' ? 'Scene' : 'Game'}
                </button>
              ))}
              {scriptTabs.map((id) => (
                <span key={id} className={activeTab === id ? 'tab active' : 'tab'}>
                  <button
                    type="button"
                    role="tab"
                    aria-selected={activeTab === id}
                    className="tab-label"
                    onClick={() => onCenterTab(id)}
                  >
                    <Icon name="script" size={12} />
                    {getBaseName(session.project.assets.get(id)?.name ?? '')}
                  </button>
                  <button
                    type="button"
                    className="tab-close"
                    aria-label="Close script"
                    onClick={() => props.onCloseScript(id)}
                  >
                    <Icon name="close" size={10} />
                  </button>
                </span>
              ))}
            </div>
            <div className="center-content">
              <ViewportPanel
                mode={activeTab === 'game' ? 'game' : 'scene'}
                hidden={!showingViewport}
              />
              <Suspense fallback={<div className="splash">Loading the code editor…</div>}>
                {scriptTabs.map((id) => (
                  <ScriptEditor key={id} assetId={id} hidden={activeTab !== id} />
                ))}
              </Suspense>
            </div>
          </div>
          <Splitter
            orientation="horizontal"
            label="Resize bottom panel"
            onDrag={(delta) =>
              onResize({ ...sizes, bottom: clampSize(sizes.bottom - delta, 110, 600) })
            }
          />
          <div className="bottom" style={{ height: sizes.bottom }}>
            <div className="tab-bar" role="tablist" aria-label="Project and console">
              <button
                type="button"
                role="tab"
                aria-selected={bottomTab === 'project'}
                className={bottomTab === 'project' ? 'tab active' : 'tab'}
                onClick={() => onBottomTab('project')}
              >
                Project
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={bottomTab === 'console'}
                className={bottomTab === 'console' ? 'tab active' : 'tab'}
                onClick={() => onBottomTab('console')}
              >
                Console
                <ConsoleErrorBadge />
              </button>
            </div>
            {bottomTab === 'project' ? <ProjectPanel /> : <ConsolePanel />}
          </div>
        </div>
        <Splitter
          orientation="vertical"
          label="Resize inspector"
          onDrag={(delta) =>
            onResize({ ...sizes, right: clampSize(sizes.right - delta, 220, 640) })
          }
        />
        <div className="side" style={{ width: sizes.right }}>
          <InspectorPanel />
        </div>
      </div>
    </div>
  );
}

/** Most errors the Console tab counts before it just says "99+". */
const MAX_BADGE_COUNT = 99;

/**
 * The number of errors in the console, shown on its tab. It subscribes to the console
 * on its own, so a script that logs every frame re-renders this badge and nothing else.
 */
function ConsoleErrorBadge(): ReactElement | null {
  const { session } = useEditor();
  const entries = useConsoleEntries(session);
  const errorCount = entries.reduce(
    (total, entry) => (entry.level === 'error' ? total + entry.count : total),
    0,
  );
  if (errorCount === 0) {
    return null;
  }
  return (
    <span className="badge error" aria-label={`${errorCount} errors`}>
      {errorCount > MAX_BADGE_COUNT ? `${MAX_BADGE_COUNT}+` : errorCount}
    </span>
  );
}

interface SplitterProps {
  readonly orientation: 'vertical' | 'horizontal';
  readonly label: string;
  /** Called with the pointer movement since the previous call, in pixels. */
  readonly onDrag: (delta: number) => void;
}

function Splitter({ orientation, label, onDrag }: SplitterProps): ReactElement {
  const lastRef = useRef<number | null>(null);
  const position = (event: React.PointerEvent): number =>
    orientation === 'vertical' ? event.clientX : event.clientY;
  return (
    <div
      className={`splitter ${orientation}`}
      role="separator"
      aria-label={label}
      aria-orientation={orientation}
      onPointerDown={(event) => {
        event.currentTarget.setPointerCapture(event.pointerId);
        lastRef.current = position(event);
      }}
      onPointerMove={(event) => {
        if (lastRef.current !== null) {
          const current = position(event);
          onDrag(current - lastRef.current);
          lastRef.current = current;
        }
      }}
      onPointerUp={() => {
        lastRef.current = null;
      }}
      onPointerCancel={() => {
        lastRef.current = null;
      }}
    />
  );
}
