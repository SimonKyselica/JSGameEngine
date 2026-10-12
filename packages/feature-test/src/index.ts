/**
 * The Rowan feature-test project: one project that uses every component and exercises
 * the whole scripting API, and that reports whether everything behaved as documented.
 *
 * It is run headless by the unit tests, in a real browser by the end-to-end tests, and
 * can be opened in the editor from the Help menu.
 */
import type { InputState } from '@rowan/core';
import type { FeatureTestReport } from './scripts/TestHarness';

export { createFeatureTestProject } from './project';
export { FEATURE_TEST_SCRIPTS } from './scripts';
export type { FeatureCheck, FeatureTestReport } from './scripts/TestHarness';

/** The `globalThis` property the running feature test writes its report to. */
export const FEATURE_TEST_GLOBAL = '__ROWAN_FEATURE_TEST__';

/** The report of the feature test that is running or has run in this JavaScript realm. */
export function getFeatureTestReport(): FeatureTestReport | undefined {
  return (globalThis as Record<string, unknown>)[FEATURE_TEST_GLOBAL] as
    FeatureTestReport | undefined;
}

/** Removes the report of a previous run. */
export function clearFeatureTestReport(): void {
  delete (globalThis as Record<string, unknown>)[FEATURE_TEST_GLOBAL];
}

/** The last frame in which {@link driveFeatureTestInput} does anything. */
export const FEATURE_TEST_INPUT_FRAMES = 18;

/**
 * Plays the input the feature test's InputProbe and UiProbe wait for. Call it once per
 * frame, before updating the game, with the number of the frame that is about to run.
 */
export function driveFeatureTestInput(input: InputState, frame: number): void {
  switch (frame) {
    case 4:
      input.handleKeyDown('Space');
      input.handleKeyDown('KeyD');
      input.handleKeyDown('KeyW');
      break;
    case 7:
      input.handleKeyUp('Space');
      input.handleKeyUp('KeyD');
      input.handleKeyUp('KeyW');
      break;
    case 9:
      input.handlePointerMove(320, 180, 1280, 720);
      input.handlePointerDown(0);
      break;
    case 12:
      input.handlePointerUp(0);
      input.handlePointerDown(1);
      input.handlePointerDown(2);
      break;
    case 14:
      input.handlePointerUp(1);
      input.handlePointerUp(2);
      break;
    case 16:
      input.handleWheel(120);
      break;
    case FEATURE_TEST_INPUT_FRAMES:
      // Off the button that UiProbe sits on, which until now had the pointer.
      input.handlePointerMove(1000, 600, 1280, 720);
      break;
  }
}
