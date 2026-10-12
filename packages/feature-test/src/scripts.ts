import AudioProbe from './scripts/AudioProbe.ts?raw';
import Bullet from './scripts/Bullet.ts?raw';
import Counter from './scripts/Counter.ts?raw';
import DestroyReporter from './scripts/DestroyReporter.ts?raw';
import EntityProbe from './scripts/EntityProbe.ts?raw';
import FinishProbe from './scripts/FinishProbe.ts?raw';
import InputProbe from './scripts/InputProbe.ts?raw';
import LifecycleProbe from './scripts/LifecycleProbe.ts?raw';
import MathProbe from './scripts/MathProbe.ts?raw';
import PhysicsProbe from './scripts/PhysicsProbe.ts?raw';
import RenderProbe from './scripts/RenderProbe.ts?raw';
import Spawner from './scripts/Spawner.ts?raw';
import support from './scripts/support.ts?raw';
import TestHarness from './scripts/TestHarness.ts?raw';
import TextProbe from './scripts/TextProbe.ts?raw';
import TriggerProbe from './scripts/TriggerProbe.ts?raw';

/**
 * The source of every feature-test script, keyed by file name without extension.
 *
 * The scripts live in `./scripts` as ordinary TypeScript files so they are type-checked
 * against the real scripting API, and are loaded here as text because the engine
 * compiles scripts itself.
 */
export const FEATURE_TEST_SCRIPTS: Readonly<Record<string, string>> = {
  AudioProbe,
  Bullet,
  Counter,
  DestroyReporter,
  EntityProbe,
  FinishProbe,
  InputProbe,
  LifecycleProbe,
  MathProbe,
  PhysicsProbe,
  RenderProbe,
  Spawner,
  support,
  TestHarness,
  TextProbe,
  TriggerProbe,
};
