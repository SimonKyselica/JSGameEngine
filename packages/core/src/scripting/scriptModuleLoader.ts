import { getDirectoryName, type AssetRecord } from '../assets/asset';
import type { AssetDatabase } from '../assets/assetDatabase';
import { describeError, RowanError } from '../core/assert';
import { Behaviour, type BehaviourClass } from './behaviour';

/** The module name scripts import the engine API from. */
export const API_MODULE_NAME = 'rowan';

const SCRIPT_EXTENSIONS = ['', '.ts', '.js'] as const;

interface ScriptModule {
  exports: Record<string, unknown>;
}

/** A compiled script in CommonJS form. */
export type ModuleFactory = (
  exports: Record<string, unknown>,
  require: (specifier: string) => unknown,
  module: ScriptModule,
) => void;

/** Supplies the compiled code of script assets. */
export interface ScriptFactoryProvider {
  /** Returns the module factory of a script. Throws when the script cannot be compiled. */
  getFactory(record: AssetRecord): ModuleFactory;
}

/** Serves scripts that were compiled ahead of time, as exported games do. */
export class PrecompiledScriptProvider implements ScriptFactoryProvider {
  constructor(private readonly factories: Readonly<Record<string, ModuleFactory>>) {}

  getFactory(record: AssetRecord): ModuleFactory {
    const factory = this.factories[record.id];
    if (!factory) {
      throw new RowanError(`Script "${record.name}" is missing from the compiled script bundle`);
    }
    return factory;
  }
}

/**
 * Evaluates script modules and resolves the imports between them. Scripts can import
 * the engine API from `rowan` and other script assets by relative path.
 */
export class ScriptModuleLoader {
  private readonly modules = new Map<string, ScriptModule>();

  constructor(
    private readonly assets: AssetDatabase,
    private readonly provider: ScriptFactoryProvider,
    private readonly apiModule: Readonly<Record<string, unknown>>,
  ) {}

  /**
   * Loads a script asset and returns the Behaviour class it default-exports.
   * Throws a {@link RowanError} that names the script when anything goes wrong.
   */
  loadClass(assetId: string): BehaviourClass {
    const record = this.assets.get(assetId);
    if (record?.type !== 'script') {
      throw new RowanError(`Script asset ${assetId} does not exist`);
    }
    const exported = this.loadModule(record).exports.default;
    if (
      typeof exported !== 'function' ||
      !Object.prototype.isPrototypeOf.call(Behaviour.prototype, exported.prototype as object)
    ) {
      throw new RowanError(
        `Script "${record.name}" must default-export a class that extends Behaviour`,
      );
    }
    return exported as BehaviourClass;
  }

  /** Forgets every evaluated module, so changed scripts are evaluated again. */
  invalidate(): void {
    this.modules.clear();
  }

  private loadModule(record: AssetRecord): ScriptModule {
    const cached = this.modules.get(record.id);
    if (cached) {
      return cached;
    }

    // Registering the module before running it lets circular imports resolve, as in Node.
    const module: ScriptModule = { exports: {} };
    this.modules.set(record.id, module);
    try {
      const factory = this.provider.getFactory(record);
      factory(module.exports, (specifier) => this.require(record, specifier), module);
    } catch (error) {
      this.modules.delete(record.id);
      if (error instanceof RowanError && error.message.startsWith('Script "')) {
        throw error;
      }
      throw new RowanError(`Script "${record.name}" failed to load: ${describeError(error)}`, {
        cause: error,
      });
    }
    return module;
  }

  private require(from: AssetRecord, specifier: string): unknown {
    if (specifier === API_MODULE_NAME) {
      return this.apiModule;
    }
    if (!specifier.startsWith('./') && !specifier.startsWith('../')) {
      throw new RowanError(
        `Cannot import "${specifier}". Scripts can import "${API_MODULE_NAME}" ` +
          'and other scripts by relative path, such as "./helpers".',
      );
    }
    const target = resolveScriptImport(this.assets, from.name, specifier);
    if (!target) {
      throw new RowanError(`Cannot find script "${specifier}" imported from "${from.name}"`);
    }
    return this.loadModule(target).exports;
  }
}

/** Finds the script asset a relative import refers to. */
export function resolveScriptImport(
  assets: AssetDatabase,
  fromName: string,
  specifier: string,
): AssetRecord | undefined {
  const segments = getDirectoryName(fromName).split('/').filter(Boolean);
  for (const segment of specifier.split('/')) {
    if (segment === '..') {
      if (segments.length === 0) {
        return undefined;
      }
      segments.pop();
    } else if (segment !== '.' && segment !== '') {
      segments.push(segment);
    }
  }
  const path = segments.join('/');
  const scripts = assets.list('script');
  for (const extension of SCRIPT_EXTENSIONS) {
    const match = scripts.find((record) => record.name === path + extension);
    if (match) {
      return match;
    }
  }
  return undefined;
}
