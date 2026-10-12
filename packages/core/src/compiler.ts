/**
 * The script compiler entry point (`@rowan/core/compiler`).
 *
 * It is separate from the main entry so that exported games, whose scripts are compiled
 * at export time, do not have to ship the compiler.
 */
import { transform } from 'sucrase';
import type { AssetRecord } from './assets/asset';
import type { AssetDatabase } from './assets/assetDatabase';
import { describeError, RowanError } from './core/assert';
import type { ModuleFactory, ScriptFactoryProvider } from './scripting/scriptModuleLoader';

/** The global object exported games read their compiled scripts from. */
export const SCRIPT_BUNDLE_GLOBAL = '__ROWAN_SCRIPTS__';

/**
 * Compiles a TypeScript or JavaScript script into a CommonJS module body.
 * Type annotations are removed without type checking.
 */
export function compileScript(source: string, fileName: string): string {
  try {
    return transform(source, {
      transforms: ['typescript', 'imports'],
      filePath: fileName,
      production: true,
    }).code;
  } catch (error) {
    throw new RowanError(`Script "${fileName}" has a syntax error: ${describeError(error)}`, {
      cause: error,
    });
  }
}

/** Compiles scripts from their source on demand, as the editor does. */
export class SourceScriptProvider implements ScriptFactoryProvider {
  constructor(private readonly assets: AssetDatabase) {}

  getFactory(record: AssetRecord): ModuleFactory {
    const code = compileScript(this.assets.getText(record.id), record.name);
    // The sourceURL comment gives the script a readable name in stack traces and devtools.
    const body = `${code}\n//# sourceURL=rowan-script:///${encodeURI(record.name)}`;
    // Running the user's script is the whole point here. Exported games never reach this
    // code: their scripts are compiled into a plain script file at export time.
    // eslint-disable-next-line @typescript-eslint/no-implied-eval
    return new Function('exports', 'require', 'module', body) as ModuleFactory;
  }
}

/**
 * Compiles every script of a project into one JavaScript file for an exported game.
 * Loading the file registers each script's module factory under its asset id, where a
 * `PrecompiledScriptProvider` picks them up. No `eval` is needed at runtime.
 */
export function buildScriptBundle(assets: AssetDatabase): string {
  const parts = [`(function (scripts) {`, `"use strict";`];
  for (const record of assets.list('script')) {
    const code = compileScript(assets.getText(record.id), record.name);
    parts.push(
      `// ${record.name.replace(/[\r\n]/g, ' ')}`,
      `scripts[${JSON.stringify(record.id)}] = function (exports, require, module) {`,
      code,
      `};`,
    );
  }
  parts.push(
    `})(globalThis.${SCRIPT_BUNDLE_GLOBAL} || (globalThis.${SCRIPT_BUNDLE_GLOBAL} = {}));`,
  );
  return parts.join('\n') + '\n';
}
