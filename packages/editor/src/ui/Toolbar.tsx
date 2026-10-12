import type { ReactElement } from 'react';
import type { Tool } from '../core/editorSession';
import { useEditor } from './editorContext';
import { Icon, type IconName } from './widgets';

const TOOLS: readonly { tool: Tool; icon: IconName; label: string; key: string }[] = [
  { tool: 'hand', icon: 'hand', label: 'Hand', key: 'Q' },
  { tool: 'move', icon: 'move', label: 'Move', key: 'W' },
  { tool: 'rotate', icon: 'rotate', label: 'Rotate', key: 'E' },
  { tool: 'scale', icon: 'scale', label: 'Scale', key: 'R' },
];

/** Transform tools on the left, play controls in the middle, project state on the right. */
export function Toolbar({ onPlayToggle }: { onPlayToggle: () => void }): ReactElement {
  const { session, commands } = useEditor();
  const { play } = session;
  const running = play.state !== 'stopped';

  return (
    <div className="toolbar" role="toolbar" aria-label="Tools">
      <div className="toolbar-group">
        {TOOLS.map(({ tool, icon, label, key }) => (
          <button
            key={tool}
            type="button"
            className={session.tool === tool ? 'tool-button active' : 'tool-button'}
            aria-label={`${label} tool`}
            aria-pressed={session.tool === tool}
            title={`${label} (${key})`}
            onClick={() => session.setTool(tool)}
          >
            <Icon name={icon} />
          </button>
        ))}
      </div>

      <div className="toolbar-group play-controls">
        <button
          type="button"
          className={running ? 'tool-button active play' : 'tool-button play'}
          aria-label={running ? 'Stop' : 'Play'}
          aria-pressed={running}
          title={running ? 'Stop (Ctrl+P)' : 'Play (Ctrl+P)'}
          disabled={play.state === 'starting'}
          onClick={onPlayToggle}
        >
          <Icon name={running ? 'stop' : 'play'} />
        </button>
        <button
          type="button"
          className={play.state === 'paused' ? 'tool-button active' : 'tool-button'}
          aria-label="Pause"
          aria-pressed={play.state === 'paused'}
          title="Pause"
          disabled={!play.isActive}
          onClick={() => play.togglePause()}
        >
          <Icon name="pause" />
        </button>
        <button
          type="button"
          className="tool-button"
          aria-label="Step one frame"
          title="Step one frame (while paused)"
          disabled={play.state !== 'paused'}
          onClick={() => play.step()}
        >
          <Icon name="step" />
        </button>
      </div>

      <div className="toolbar-group toolbar-project">
        <span className="project-name" title="Project name">
          {session.project.settings.name}
        </span>
        <button
          type="button"
          className={session.dirty ? 'button small primary' : 'button small'}
          title="Save the project in this browser"
          onClick={commands.save}
        >
          <Icon name="save" size={13} /> {session.dirty ? 'Save*' : 'Saved'}
        </button>
      </div>
    </div>
  );
}
