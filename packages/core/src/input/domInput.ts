import type { Unsubscribe } from '../core/signal';
import type { InputState } from './input';

/** Keys whose default browser action (scrolling the page) would disrupt a game. */
const KEYS_WITH_PAGE_ACTIONS = new Set([
  'Space',
  'ArrowUp',
  'ArrowDown',
  'ArrowLeft',
  'ArrowRight',
  'PageUp',
  'PageDown',
  'Home',
  'End',
]);

/**
 * Feeds an {@link InputState} with keyboard and pointer events from the page.
 *
 * @param viewport The element the game is drawn in. Pointer positions are relative to it.
 * @param keyboardTarget Where to listen for keys. Defaults to the window.
 * @returns A function that removes every listener again.
 */
export function attachDomInput(
  state: InputState,
  viewport: HTMLElement,
  keyboardTarget: Window | HTMLElement = window,
): Unsubscribe {
  const controller = new AbortController();
  const options = { signal: controller.signal };

  const isTyping = (event: Event): boolean => {
    const target = event.target;
    return (
      target instanceof HTMLElement &&
      (target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName))
    );
  };

  const updatePointer = (event: PointerEvent): void => {
    const bounds = viewport.getBoundingClientRect();
    state.handlePointerMove(
      event.clientX - bounds.left,
      event.clientY - bounds.top,
      bounds.width,
      bounds.height,
    );
  };

  keyboardTarget.addEventListener(
    'keydown',
    (event) => {
      const keyEvent = event as KeyboardEvent;
      if (isTyping(keyEvent)) {
        return;
      }
      if (KEYS_WITH_PAGE_ACTIONS.has(keyEvent.code)) {
        keyEvent.preventDefault();
      }
      state.handleKeyDown(keyEvent.code);
    },
    options,
  );
  keyboardTarget.addEventListener(
    'keyup',
    (event) => state.handleKeyUp((event as KeyboardEvent).code),
    options,
  );

  viewport.addEventListener('pointermove', updatePointer, options);
  // Also fires when a finger is lifted, which is what ends a hover on a touch screen.
  viewport.addEventListener('pointerleave', () => state.handlePointerLeave(), options);
  viewport.addEventListener(
    'pointerdown',
    (event) => {
      updatePointer(event);
      state.handlePointerDown(event.button);
    },
    options,
  );
  // Listening on the window catches releases that happen outside the viewport.
  window.addEventListener('pointerup', (event) => state.handlePointerUp(event.button), options);
  viewport.addEventListener(
    'wheel',
    (event) => {
      event.preventDefault();
      state.handleWheel(event.deltaY);
    },
    { ...options, passive: false },
  );
  viewport.addEventListener('contextmenu', (event) => event.preventDefault(), options);
  window.addEventListener('blur', () => state.releaseAll(), options);

  return () => controller.abort();
}
