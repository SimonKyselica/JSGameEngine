/**
 * The Rowan feature-test project: one project that uses every component and exercises
 * the whole scripting API, and that reports whether everything behaved as documented.
 *
 * It is run headless by the unit tests, in a real browser by the end-to-end tests, and
 * can be opened in the editor from the Help menu.
 */
import type { InputState } from '@rowan/core';
import type { FeatureTestReport } from './scripts/TestHarness';
import { FEATURE_TEST_TOUCHES } from './touches';

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
export const FEATURE_TEST_INPUT_FRAMES = 30;

/**
 * Plays the input that the feature test's InputProbe, UiProbe and TouchProbe wait for. Call
 * it once per frame, before updating the game, with the number of the frame that is about
 * to run.
 *
 * The wheel is turned last, and a host that plays the input in its own way must keep to
 * that. The checks that need fingers are only announced when the first finger arrives, so
 * until then it is the check of the wheel that keeps the scene from finishing.
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
    case 18:
      // Off the button that UiProbe sits on, which until now had the pointer.
      input.handlePointerMove(1000, 600, 1280, 720);
      break;
    case 22: {
      const { id, x, y } = FEATURE_TEST_TOUCHES.first;
      input.handleTouchStart(id, x, y, 1280, 720);
      break;
    }
    case 24: {
      const { id, x, y } = FEATURE_TEST_TOUCHES.second;
      input.handleTouchStart(id, x, y, 1280, 720);
      break;
    }
    case 27:
      input.handleTouchEnd(FEATURE_TEST_TOUCHES.second.id);
      break;
    case 29:
      input.handleTouchEnd(FEATURE_TEST_TOUCHES.first.id);
      break;
    case FEATURE_TEST_INPUT_FRAMES:
      input.handleWheel(120);
      break;
  }
}

export { FEATURE_TEST_TOUCHES };
