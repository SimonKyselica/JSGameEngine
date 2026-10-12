import type { Behaviour } from 'rowan';
import TestHarness from './TestHarness';

/** Finds the scene's test harness. Every probe script reports its checks through it. */
export function harnessOf(script: Behaviour): TestHarness {
  const entity = script.scene.findByName('Harness');
  const harness = entity ? script.getScript(TestHarness, entity) : undefined;
  if (!harness) {
    throw new Error('The scene needs a "Harness" entity with the TestHarness script');
  }
  return harness;
}
