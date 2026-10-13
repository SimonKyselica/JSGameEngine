/**
 * Where the fingers go that TouchProbe waits for, in pixels of the 1280x720 screen: the
 * first somewhere empty, the second on the button that the probe sits on.
 *
 * This is a module of its own, without imports, so that the browser tests can load it in
 * Node, where the scripts of the project, which are imported as text, cannot be loaded.
 */
export const FEATURE_TEST_TOUCHES = {
  first: { id: 1, x: 640, y: 660 },
  second: { id: 2, x: 1120, y: 620 },
} as const;
