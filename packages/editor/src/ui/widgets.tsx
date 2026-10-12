import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactElement,
  type ReactNode,
} from 'react';

const ICON_PATHS = {
  hand: 'M8 13V5.5a1.5 1.5 0 0 1 3 0V11m0-6.5V4a1.5 1.5 0 0 1 3 0v7m0-5.5a1.5 1.5 0 0 1 3 0V12m0-3.5a1.5 1.5 0 0 1 3 0V15a6 6 0 0 1-6 6h-1.5a6 6 0 0 1-4.7-2.3L4 14.5a1.6 1.6 0 0 1 2.5-2L8 14',
  move: 'M12 3v18M3 12h18M12 3l-3 3m3-3 3 3M12 21l-3-3m3 3 3-3M3 12l3-3m-3 3 3 3M21 12l-3-3m3 3-3 3',
  rotate: 'M20 12a8 8 0 1 1-2.6-5.9M20 4v5h-5',
  scale: 'M4 20h7M4 20v-7M4 20 20 4m0 0h-7m7 0v7',
  magnet: 'M6 4v7a6 6 0 0 0 12 0V4h-4v7a2 2 0 0 1-4 0V4zM6 8h4M14 8h4',
  play: 'M7 4.5v15l12-7.5z',
  stop: 'M6 6h12v12H6z',
  pause: 'M8 5v14M16 5v14',
  step: 'M6 5v14l9-7zM18 5v14',
  plus: 'M12 5v14M5 12h14',
  trash: 'M5 7h14M10 7V4h4v3M7 7l1 13h8l1-13',
  close: 'M6 6l12 12M18 6 6 18',
  chevronRight: 'M9 6l6 6-6 6',
  chevronDown: 'M6 9l6 6 6-6',
  entity: 'M12 3 4 7.5v9L12 21l8-4.5v-9zM4 7.5l8 4.5 8-4.5M12 12v9',
  folder: 'M3 6h6l2 2h10v11H3z',
  image: 'M4 5h16v14H4zM4 16l4.5-4.5 3.5 3.5 3-3L20 17M9 9.5a1 1 0 1 0 0-.01',
  audio: 'M4 10v4h3l5 4V6L7 10zM16 9a4 4 0 0 1 0 6M18.5 6.5a8 8 0 0 1 0 11',
  script: 'M9 8l-4 4 4 4M15 8l4 4-4 4M13 5l-2 14',
  scene: 'M3 8l9-5 9 5-9 5zM3 12l9 5 9-5M3 16l9 5 9-5',
  prefab: 'M12 3 4 7.5v9L12 21l8-4.5v-9zM12 12l8-4.5M12 12 4 7.5M12 12v9',
  info: 'M12 8v.01M12 11v6M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18',
  warn: 'M12 4 2.5 20h19zM12 10v5M12 17.5v.01',
  error: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18M9 9l6 6M15 9l-6 6',
  save: 'M5 4h11l3 3v13H5zM8 4v5h7V4M8 20v-6h8v6',
} as const;

export type IconName = keyof typeof ICON_PATHS;

const FILLED_ICONS: readonly IconName[] = ['play', 'stop'];

export function Icon({ name, size = 16 }: { name: IconName; size?: number }): ReactElement {
  const filled = FILLED_ICONS.includes(name);
  return (
    <svg
      className="icon"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill={filled ? 'currentColor' : 'none'}
      stroke="currentColor"
      strokeWidth={filled ? 0 : 1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d={ICON_PATHS[name]} />
    </svg>
  );
}

// --- Menus ---------------------------------------------------------------------------------

export type MenuEntry =
  | 'separator'
  | {
      readonly label: string;
      readonly shortcut?: string;
      readonly disabled?: boolean;
      readonly danger?: boolean;
      readonly onSelect: () => void;
    };

interface PopupMenuProps {
  readonly items: readonly MenuEntry[];
  /** Top-left corner in viewport pixels. The menu moves to stay on screen. */
  readonly x: number;
  readonly y: number;
  readonly onClose: () => void;
}

/** A floating menu that closes when an item is chosen or the user clicks elsewhere. */
export function PopupMenu({ items, x, y, onClose }: PopupMenuProps): ReactElement {
  const ref = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState({ left: x, top: y });

  useLayoutEffect(() => {
    const bounds = ref.current?.getBoundingClientRect();
    if (bounds) {
      setPosition({
        left: Math.max(4, Math.min(x, window.innerWidth - bounds.width - 4)),
        top: Math.max(4, Math.min(y, window.innerHeight - bounds.height - 4)),
      });
    }
  }, [x, y]);

  useEffect(() => {
    const handlePointerDown = (event: PointerEvent): void => {
      const target = event.target as Element;
      // The button that opened this menu closes it itself when it is clicked again.
      const onOwnButton = target.closest('[aria-haspopup="menu"][aria-expanded="true"]') !== null;
      if (!ref.current?.contains(target) && !onOwnButton) {
        onClose();
      }
    };
    const handleKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        onClose();
      }
    };
    window.addEventListener('pointerdown', handlePointerDown, true);
    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('blur', onClose);
    return () => {
      window.removeEventListener('pointerdown', handlePointerDown, true);
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('blur', onClose);
    };
  }, [onClose]);

  return (
    <div ref={ref} className="popup-menu" role="menu" style={position}>
      {items.map((item, index) =>
        item === 'separator' ? (
          <div key={index} className="popup-menu-separator" role="separator" />
        ) : (
          <button
            key={index}
            type="button"
            role="menuitem"
            className={item.danger ? 'popup-menu-item danger' : 'popup-menu-item'}
            disabled={item.disabled}
            aria-keyshortcuts={item.shortcut}
            onClick={() => {
              onClose();
              item.onSelect();
            }}
          >
            <span>{item.label}</span>
            {item.shortcut && (
              <span className="popup-menu-shortcut" aria-hidden="true">
                {item.shortcut}
              </span>
            )}
          </button>
        ),
      )}
    </div>
  );
}

/** Shows a {@link PopupMenu} at a position, typically where the user right-clicked. */
export function useContextMenu(): {
  open(position: { clientX: number; clientY: number }, items: readonly MenuEntry[]): void;
  element: ReactElement | null;
} {
  const [state, setState] = useState<{ x: number; y: number; items: readonly MenuEntry[] } | null>(
    null,
  );
  const close = useCallback(() => setState(null), []);
  const open = useCallback(
    (position: { clientX: number; clientY: number }, items: readonly MenuEntry[]) =>
      setState({ x: position.clientX, y: position.clientY, items }),
    [],
  );
  return {
    open,
    element: state ? (
      <PopupMenu items={state.items} x={state.x} y={state.y} onClose={close} />
    ) : null,
  };
}

// --- Dialog shell ------------------------------------------------------------------------------

interface ModalProps {
  readonly title: string;
  readonly onClose: () => void;
  readonly children: ReactNode;
  /** Buttons shown at the bottom right. */
  readonly footer?: ReactNode;
  readonly width?: number;
}

/**
 * A modal dialog. It uses the browser's own `<dialog>`, which keeps keyboard focus inside
 * the dialog, makes the rest of the page inert and closes on Escape.
 */
export function Modal({ title, onClose, children, footer, width = 420 }: ModalProps): ReactElement {
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = ref.current;
    if (dialog && !dialog.open) {
      dialog.showModal();
    }
    return () => dialog?.close();
  }, []);

  return (
    <dialog
      ref={ref}
      className="modal"
      aria-label={title}
      style={{ width }}
      onCancel={(event) => {
        // Escape: let the owner close the dialog, so its state stays in charge.
        event.preventDefault();
        onClose();
      }}
      onPointerDown={(event) => {
        // A press on the backdrop is reported with the dialog itself as its target.
        if (event.target === event.currentTarget) {
          onClose();
        }
      }}
    >
      <div className="modal-content">
        <header className="modal-header">
          <span>{title}</span>
          <button type="button" className="icon-button" onClick={onClose} aria-label="Close">
            <Icon name="close" size={14} />
          </button>
        </header>
        <div className="modal-body">{children}</div>
        {footer && <footer className="modal-footer">{footer}</footer>}
      </div>
    </dialog>
  );
}

// --- Inspector fields ----------------------------------------------------------------------------

export function FieldRow({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}): ReactElement {
  return (
    <label className="field-row">
      <span className="field-label" title={label}>
        {label}
      </span>
      <span className="field-control">{children}</span>
    </label>
  );
}

/** Shows at most four decimals without trailing zeros: 0.30000000000000004 becomes 0.3. */
function formatNumber(value: number): string {
  return Number.isFinite(value) ? String(Number(value.toFixed(4))) : '0';
}

interface NumberFieldProps {
  readonly value: number;
  readonly onChange: (value: number) => void;
  readonly min?: number;
  readonly max?: number;
  readonly step?: number;
  /** Short text shown inside the field, such as an axis name. */
  readonly prefix?: string;
  readonly ariaLabel?: string;
}

/**
 * A number input that keeps what the user is typing, including incomplete text such as
 * "-" or "1.", and reports every valid number immediately.
 */
export function NumberField(props: NumberFieldProps): ReactElement {
  const { value, onChange, min, max, step, prefix, ariaLabel } = props;
  const [draft, setDraft] = useState<string | null>(null);

  const commit = (text: string): void => {
    const parsed = Number(text);
    if (text.trim() === '' || !Number.isFinite(parsed)) {
      return;
    }
    const clamped = Math.min(max ?? Infinity, Math.max(min ?? -Infinity, parsed));
    if (clamped !== value) {
      onChange(clamped);
    }
  };

  return (
    <span className="number-field">
      {prefix && <span className="number-field-prefix">{prefix}</span>}
      <input
        type="number"
        aria-label={ariaLabel ?? prefix}
        value={draft ?? formatNumber(value)}
        min={min}
        max={max}
        step={step ?? 'any'}
        onFocus={(event) => event.currentTarget.select()}
        onChange={(event) => {
          setDraft(event.currentTarget.value);
          commit(event.currentTarget.value);
        }}
        onBlur={() => setDraft(null)}
        onKeyDown={(event) => {
          if (event.key === 'Enter') {
            event.currentTarget.blur();
          }
        }}
      />
    </span>
  );
}

interface TextFieldProps {
  readonly value: string;
  readonly onChange: (value: string) => void;
  readonly placeholder?: string;
  readonly ariaLabel?: string;
}

export function TextField({
  value,
  onChange,
  placeholder,
  ariaLabel,
}: TextFieldProps): ReactElement {
  return (
    <input
      type="text"
      className="text-field"
      aria-label={ariaLabel}
      value={value}
      placeholder={placeholder}
      spellCheck={false}
      onChange={(event) => onChange(event.currentTarget.value)}
      onKeyDown={(event) => {
        if (event.key === 'Enter') {
          event.currentTarget.blur();
        }
      }}
    />
  );
}

interface SelectFieldProps {
  readonly value: string;
  readonly options: readonly { readonly value: string; readonly label: string }[];
  readonly onChange: (value: string) => void;
  readonly ariaLabel?: string;
}

export function SelectField({
  value,
  options,
  onChange,
  ariaLabel,
}: SelectFieldProps): ReactElement {
  return (
    <select
      className="select-field"
      aria-label={ariaLabel}
      value={value}
      onChange={(event) => onChange(event.currentTarget.value)}
    >
      {options.map((option) => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </select>
  );
}

interface ColorFieldProps {
  /** Red, green, blue and alpha from 0 to 1. */
  readonly value: readonly [number, number, number, number];
  readonly onChange: (value: [number, number, number, number]) => void;
}

const toHexChannel = (channel: number): string =>
  Math.round(Math.min(1, Math.max(0, channel)) * 255)
    .toString(16)
    .padStart(2, '0');

export function ColorField({ value, onChange }: ColorFieldProps): ReactElement {
  const [red, green, blue, alpha] = value;
  return (
    <span className="color-field">
      <input
        type="color"
        aria-label="Color"
        value={`#${toHexChannel(red)}${toHexChannel(green)}${toHexChannel(blue)}`}
        onChange={(event) => {
          const hex = event.currentTarget.value;
          const channel = (offset: number): number =>
            Number.parseInt(hex.slice(offset, offset + 2), 16) / 255;
          onChange([channel(1), channel(3), channel(5), alpha]);
        }}
      />
      <NumberField
        prefix="A"
        ariaLabel="Alpha"
        value={alpha}
        min={0}
        max={1}
        step={0.05}
        onChange={(next) => onChange([red, green, blue, next])}
      />
    </span>
  );
}
