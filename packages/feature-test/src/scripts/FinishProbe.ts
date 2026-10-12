import { Behaviour, type ScriptLifecycle } from 'rowan';
import { getReport, UNLOAD_CHECK } from './TestHarness';

/** Runs in the second scene: confirms the scene change worked and closes the report. */
export default class FinishProbe extends Behaviour implements ScriptLifecycle {
  onStart(): void {
    const report = getReport();
    if (!report) {
      this.error('The feature test must start in the Main scene');
      return;
    }
    report.checks.push(
      {
        name: 'SceneApi.load switches to another scene',
        passed: this.scene.name === 'Finish',
        detail: `the current scene is "${this.scene.name}"`,
      },
      {
        name: 'entities of the previous scene are gone',
        passed: this.scene.findByName('Harness') === null,
        detail: '',
      },
      {
        name: 'time restarts with a new scene',
        passed: this.time.frameCount === 0 && this.time.elapsed === 0,
        detail: `frame ${this.time.frameCount}`,
      },
    );

    // The harness of the Main scene records this check in its onDestroy. If it is not
    // there, the scene was unloaded without its scripts being told.
    if (!report.checks.some((check) => check.name === UNLOAD_CHECK)) {
      report.checks.push({
        name: UNLOAD_CHECK,
        passed: false,
        detail: 'the scripts of the Main scene were not told',
      });
    }

    const failed = report.checks.filter((check) => !check.passed);
    for (const check of failed) {
      this.error(`FAILED: ${check.name}${check.detail ? ` (${check.detail})` : ''}`);
    }
    const passedCount = report.checks.length - failed.length;
    const summary = `Feature test finished: ${passedCount} of ${report.checks.length} checks passed`;
    if (failed.length > 0) {
      this.warn(summary);
    } else {
      this.log(summary);
    }
    report.done = true;
  }
}
