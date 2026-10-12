import { Behaviour, type ScriptLifecycle, type ScriptPropertyDefinitions } from 'rowan';

export interface FeatureCheck {
  name: string;
  passed: boolean;
  detail: string;
}

/** The outcome of a feature-test run. It lives on `globalThis` so the host can read it. */
export interface FeatureTestReport {
  /** True once both scenes have run and no more checks will arrive. */
  done: boolean;
  checks: FeatureCheck[];
  /** Checks that wait for something to happen, such as a collision or a key press. */
  pending: string[];
}

export const REPORT_GLOBAL = '__ROWAN_FEATURE_TEST__';

/** Recorded by the harness when its scene is unloaded; FinishProbe fails it when it is missing. */
export const UNLOAD_CHECK = 'onDestroy runs when a scene is unloaded';

export function getReport(): FeatureTestReport | undefined {
  return (globalThis as Record<string, unknown>)[REPORT_GLOBAL] as FeatureTestReport | undefined;
}

/**
 * Collects the results of every probe script in the feature-test scene. Once all checks
 * have reported, or the timeout passes, it loads the next scene, where `FinishProbe`
 * closes the report.
 */
export default class TestHarness extends Behaviour implements ScriptLifecycle {
  static properties: ScriptPropertyDefinitions = {
    timeout: { type: 'number', default: 15, min: 1, label: 'Timeout (seconds)' },
    nextScene: { type: 'string', default: 'Finish' },
  };

  timeout = 15;
  nextScene = 'Finish';

  private readonly report: FeatureTestReport = { done: false, checks: [], pending: [] };
  private finished = false;

  constructor() {
    super();
    // Published immediately: other scripts may report before this script's onStart runs.
    (globalThis as Record<string, unknown>)[REPORT_GLOBAL] = this.report;
  }

  /** Records a check. A check reported several times passes only if every report passed. */
  check(name: string, passed: boolean, detail = ''): void {
    const existing = this.report.checks.find((check) => check.name === name);
    if (existing) {
      if (!passed && existing.passed) {
        existing.passed = false;
        existing.detail = detail;
      }
    } else {
      this.report.checks.push({ name, passed, detail });
    }
    if (!passed) {
      this.error(`FAILED: ${name}${detail ? ` (${detail})` : ''}`);
    }
  }

  /** Records a check that compares two numbers with a tolerance. */
  near(name: string, actual: number, expected: number, tolerance = 1e-4): void {
    this.check(
      name,
      Math.abs(actual - expected) <= tolerance,
      `expected ${expected}, got ${actual}`,
    );
  }

  /** Announces a check that must be passed later with {@link TestHarness.pass}. */
  expectLater(name: string): void {
    const known = this.report.checks.some((check) => check.name === name);
    if (!known && !this.report.pending.includes(name)) {
      this.report.pending.push(name);
    }
  }

  /** Passes a check announced with {@link TestHarness.expectLater}. */
  pass(name: string): void {
    const index = this.report.pending.indexOf(name);
    if (index !== -1) {
      this.report.pending.splice(index, 1);
    }
    this.check(name, true);
  }

  onUpdate(): void {
    if (this.finished) {
      return;
    }
    const { pending } = this.report;
    if (pending.length > 0 && this.time.elapsed < this.timeout) {
      return;
    }
    for (const name of pending.splice(0)) {
      this.check(name, false, `did not happen within ${this.timeout} seconds`);
    }
    this.finished = true;
    this.log(`Main scene finished after ${this.time.elapsed.toFixed(2)} seconds`);
    this.scene.load(this.nextScene);
  }

  onDestroy(): void {
    if (this.finished) {
      this.check(UNLOAD_CHECK, true);
      return;
    }
    // Whoever runs the scene stopped it, for example with the Stop button of the editor.
    // Nothing went wrong in the engine; the test just did not get to its end.
    const { pending } = this.report;
    const waiting = pending.length > 0 ? ` It was still waiting for: ${pending.join(', ')}.` : '';
    this.log(`The feature test was stopped before it had finished.${waiting}`);
  }
}
