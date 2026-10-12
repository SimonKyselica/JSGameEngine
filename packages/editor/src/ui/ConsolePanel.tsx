import { useEffect, useRef, useState, type ReactElement } from 'react';
import type { LogLevel } from '@rowan/core';
import { useConsoleEntries, useEditor } from './editorContext';
import { Icon, type IconName } from './widgets';

const LEVEL_ICONS: Readonly<Record<LogLevel, IconName>> = {
  debug: 'info',
  info: 'info',
  warn: 'warn',
  error: 'error',
};

const FILTERS: readonly { level: LogLevel; label: string }[] = [
  { level: 'info', label: 'Messages' },
  { level: 'warn', label: 'Warnings' },
  { level: 'error', label: 'Errors' },
];

/** Messages from scripts and from the engine, like Unity's Console window. */
export function ConsolePanel(): ReactElement {
  const { session } = useEditor();
  const entries = useConsoleEntries(session);
  const [hidden, setHidden] = useState<ReadonlySet<LogLevel>>(new Set());
  const listRef = useRef<HTMLDivElement>(null);
  const followRef = useRef(true);

  // Keep the newest message in view unless the user has scrolled up to read older ones.
  useEffect(() => {
    const list = listRef.current;
    if (list && followRef.current) {
      list.scrollTop = list.scrollHeight;
    }
  }, [entries]);

  const toggle = (level: LogLevel): void => {
    const next = new Set(hidden);
    if (!next.delete(level)) {
      next.add(level);
    }
    setHidden(next);
  };
  // Debug messages are shown and hidden together with regular messages.
  const isHidden = (level: LogLevel): boolean => hidden.has(level === 'debug' ? 'info' : level);

  return (
    <section className="panel console" aria-label="Console">
      <div className="console-toolbar">
        <button type="button" className="button small" onClick={() => session.console.clear()}>
          Clear
        </button>
        <span className="spacer" />
        {FILTERS.map(({ level, label }) => {
          const count =
            session.console.count(level) + (level === 'info' ? session.console.count('debug') : 0);
          return (
            <button
              key={level}
              type="button"
              className={`console-filter ${level}${hidden.has(level) ? '' : ' active'}`}
              aria-pressed={!hidden.has(level)}
              title={`${hidden.has(level) ? 'Show' : 'Hide'} ${label.toLowerCase()}`}
              onClick={() => toggle(level)}
            >
              <Icon name={LEVEL_ICONS[level]} size={13} />
              {count}
            </button>
          );
        })}
      </div>
      <div
        ref={listRef}
        className="console-list"
        role="log"
        aria-label="Console messages"
        onScroll={(event) => {
          const list = event.currentTarget;
          followRef.current = list.scrollHeight - list.scrollTop - list.clientHeight < 24;
        }}
      >
        {entries
          .filter((entry) => !isHidden(entry.level))
          .map((entry) => (
            <div key={entry.id} className={`console-entry ${entry.level}`}>
              <Icon name={LEVEL_ICONS[entry.level]} size={14} />
              <span className="console-message">
                {entry.source && <span className="console-source">[{entry.source}] </span>}
                {entry.message}
              </span>
              {entry.count > 1 && <span className="console-count">{entry.count}</span>}
            </div>
          ))}
      </div>
    </section>
  );
}
