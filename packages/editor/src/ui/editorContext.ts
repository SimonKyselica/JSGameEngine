import { createContext, useContext, useSyncExternalStore } from 'react';
import type { ImageDecoder } from '@rowan/core';
import type { ConsoleEntry } from '../core/consoleStore';
import type { EditorCamera } from '../core/editorCamera';
import type { EditorSession } from '../core/editorSession';
import type { AssetUrlCache } from './assetUrls';

export interface PromptOptions {
  readonly title: string;
  readonly label: string;
  readonly initialValue?: string;
  readonly confirmLabel?: string;
}

export interface ConfirmOptions {
  readonly title: string;
  readonly message: string;
  readonly confirmLabel?: string;
  /** Styles the confirm button as destructive. */
  readonly danger?: boolean;
}

/** The scene view's camera, shared so commands outside the viewport can move it. */
export interface ViewportState {
  readonly camera: EditorCamera;
  /** Width divided by height of the scene view, updated by the viewport every frame. */
  aspect: number;
}

/**
 * App-level commands that menus, shortcuts and panels share. They are plain functions,
 * not methods, so they can be passed around as event handlers.
 */
export interface EditorCommands {
  readonly save: () => void;
  readonly newProject: () => void;
  readonly openProject: () => void;
  readonly importProjectFile: () => void;
  readonly exportProjectFile: () => void;
  readonly openSettings: () => void;
  readonly openBuild: () => void;
  readonly openFeatureTest: () => void;
  /** Asks for files and imports them into a project folder. */
  readonly importAssets: (folder: string) => void;
  readonly createScript: (folder: string) => void;
  readonly createScene: () => void;
  readonly focusSelection: () => void;
  readonly showAbout: () => void;
}

/** Everything a panel needs: the open project's session and the app's shared services. */
export interface EditorApi {
  readonly session: EditorSession;
  readonly imageDecoder: ImageDecoder;
  readonly assetUrls: AssetUrlCache;
  readonly viewport: ViewportState;
  readonly commands: EditorCommands;
  readonly openScript: (assetId: string) => void;
  readonly prompt: (options: PromptOptions) => Promise<string | null>;
  readonly confirm: (options: ConfirmOptions) => Promise<boolean>;
}

export const EditorContext = createContext<EditorApi | null>(null);

/** The editor API. Also re-renders the component whenever the session changes. */
export function useEditor(): EditorApi {
  const api = useContext(EditorContext);
  if (!api) {
    throw new Error('useEditor must be used inside the editor');
  }
  useSyncExternalStore(api.session.subscribe, api.session.getVersion);
  return api;
}

/** The console entries, re-rendering when messages arrive. */
export function useConsoleEntries(session: EditorSession): readonly ConsoleEntry[] {
  return useSyncExternalStore(
    (listener) => session.console.onChange.connect(listener),
    () => session.console.entries,
  );
}

/** MIME types used to drag things between panels. */
export const DRAG_TYPES = {
  entity: 'application/x-rowan-entity',
  asset: 'application/x-rowan-asset',
} as const;
