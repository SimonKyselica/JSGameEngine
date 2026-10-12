/** True on Apple platforms, where shortcuts use the Command key instead of Control. */
export const IS_MAC =
  typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform);

/** How the platform's main modifier key is written in menus: `⌘S` or `Ctrl+S`. */
export const MOD = IS_MAC ? '⌘' : 'Ctrl+';
