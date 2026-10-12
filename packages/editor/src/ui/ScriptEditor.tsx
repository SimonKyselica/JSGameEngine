import { javascript } from '@codemirror/lang-javascript';
import { EditorState } from '@codemirror/state';
import { oneDark } from '@codemirror/theme-one-dark';
import { EditorView } from '@codemirror/view';
import { basicSetup } from 'codemirror';
import { useEffect, useRef, useState, type ReactElement } from 'react';
import { describeError } from '@rowan/core';
import { compileScript } from '@rowan/core/compiler';
import { useEditor } from './editorContext';

/** How long after the last keystroke the script is written back to the project. */
const APPLY_DELAY_MS = 300;

/**
 * A code editor for one script asset. Edits are applied to the project as the user
 * types, so there is no separate "save file" step: saving the project saves the script.
 */
export function ScriptEditor({
  assetId,
  hidden,
}: {
  assetId: string;
  hidden: boolean;
}): ReactElement {
  const { session } = useEditor();
  const hostRef = useRef<HTMLDivElement>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const record = session.project.assets.get(assetId);
  const name = record?.name ?? '';

  useEffect(() => {
    const host = hostRef.current;
    const { assets } = session.project;
    if (!host || !assets.has(assetId)) {
      return;
    }

    const check = (source: string): void => {
      try {
        compileScript(source, name);
        setProblem(null);
      } catch (error) {
        setProblem(describeError(error));
      }
    };

    let pending: number | undefined;
    const apply = (): void => {
      pending = undefined;
      const source = view.state.doc.toString();
      if (assets.has(assetId) && assets.getText(assetId) !== source) {
        assets.setData(assetId, source);
      }
      check(source);
    };

    const view = new EditorView({
      parent: host,
      state: EditorState.create({
        doc: assets.getText(assetId),
        extensions: [
          basicSetup,
          javascript({ typescript: true }),
          oneDark,
          EditorView.updateListener.of((update) => {
            if (update.docChanged) {
              window.clearTimeout(pending);
              pending = window.setTimeout(apply, APPLY_DELAY_MS);
            }
          }),
        ],
      }),
    });
    check(view.state.doc.toString());

    return () => {
      // Do not lose the last keystrokes when the tab closes within the delay.
      if (pending !== undefined) {
        window.clearTimeout(pending);
        apply();
      }
      view.destroy();
    };
    // The editor owns the text while it is open, so it is created once per script.
  }, [session, assetId, name]);

  return (
    <div className="script-editor" style={{ display: hidden ? 'none' : undefined }}>
      <div ref={hostRef} className="script-editor-code" />
      <div className={`script-editor-status${problem ? ' error' : ''}`} role="status">
        {problem ?? 'No syntax errors. Changes apply the next time you press Play.'}
      </div>
    </div>
  );
}
