import { describe, expect, it } from 'vitest';
import { AssetDatabase } from '../assets/assetDatabase';
import {
  buildScriptBundle,
  compileScript,
  SCRIPT_BUNDLE_GLOBAL,
  SourceScriptProvider,
} from '../compiler';
import { RowanError } from '../core/assert';
import { Color } from '../math/color';
import { Vec2 } from '../math/vec2';
import { addScript } from '../testing/fixtures';
import * as scriptApi from './api';
import { Behaviour } from './behaviour';
import {
  PrecompiledScriptProvider,
  resolveScriptImport,
  ScriptModuleLoader,
  type ModuleFactory,
} from './scriptModuleLoader';
import {
  getEmptyStoredValue,
  getPropertyAssetType,
  getScriptProperties,
  isValidStoredValue,
  SCRIPT_PROPERTY_TYPES,
  toRuntimeValue,
} from './scriptProperties';

const MINIMAL = `import { Behaviour } from 'rowan';\nexport default class Minimal extends Behaviour {}`;

function createLoader(assets: AssetDatabase): ScriptModuleLoader {
  return new ScriptModuleLoader(assets, new SourceScriptProvider(assets), { ...scriptApi });
}

describe('compileScript', () => {
  it('strips types and turns imports into require calls', () => {
    const code = compileScript(
      `import { Behaviour, Vec2 } from 'rowan';
       interface Stats { hp: number }
       export default class Typed extends Behaviour {
         private stats: Stats = { hp: 3 };
         move(by: Vec2): number { return by.x + this.stats.hp; }
       }`,
      'Typed.ts',
    );
    expect(code).toContain(`require('rowan')`);
    expect(code).not.toContain('interface');
    expect(code).not.toContain(': number');
    expect(code).toContain('exports.default');
  });

  it('reports syntax errors with the script name and position', () => {
    expect(() => compileScript('export default class {', 'Broken.ts')).toThrow(
      /Script "Broken\.ts" has a syntax error: .*\(1:\d+\)/,
    );
    expect(() => compileScript('let = ;', 'Broken.ts')).toThrow(RowanError);
  });
});

describe('ScriptModuleLoader', () => {
  it('loads the Behaviour class a script default-exports', () => {
    const assets = new AssetDatabase();
    const id = addScript(assets, 'Minimal.ts', MINIMAL);
    const scriptClass = createLoader(assets).loadClass(id);
    expect(scriptClass.name).toBe('Minimal');
    expect(new scriptClass()).toBeInstanceOf(Behaviour);
  });

  it('evaluates a module once and again after invalidation', () => {
    const assets = new AssetDatabase();
    const id = addScript(assets, 'Minimal.ts', MINIMAL);
    const loader = createLoader(assets);
    const first = loader.loadClass(id);
    expect(loader.loadClass(id)).toBe(first);
    loader.invalidate();
    expect(loader.loadClass(id)).not.toBe(first);
  });

  it('supports named, namespace and default imports of the API', () => {
    const assets = new AssetDatabase();
    const id = addScript(
      assets,
      'Imports.ts',
      `import Rowan from 'rowan';
       import * as Api from 'rowan';
       import { Behaviour, Vec2 } from 'rowan';
       export default class Imports extends Behaviour {
         static same = Rowan.Vec2 === Vec2 && Api.Vec2 === Vec2 && Api.Behaviour === Behaviour;
       }`,
    );
    const scriptClass = createLoader(assets).loadClass(id) as unknown as { same: boolean };
    expect(scriptClass.same).toBe(true);
  });

  it('resolves relative imports between scripts', () => {
    const assets = new AssetDatabase();
    addScript(assets, 'Shared/math.ts', `export const double = (value: number) => value * 2;`);
    addScript(assets, 'Game/config.js', `export const SPEED = 4;`);
    const id = addScript(
      assets,
      'Game/Player.ts',
      `import { Behaviour } from 'rowan';
       import { double } from '../Shared/math';
       import { SPEED } from './config.js';
       export default class Player extends Behaviour { static speed = double(SPEED); }`,
    );
    const scriptClass = createLoader(assets).loadClass(id) as unknown as { speed: number };
    expect(scriptClass.speed).toBe(8);
  });

  it('resolves circular imports like Node does', () => {
    const assets = new AssetDatabase();
    addScript(
      assets,
      'a.ts',
      `import { fromB } from './b';
       export const fromA = () => 'a';
       export const viaB = () => fromB();`,
    );
    addScript(
      assets,
      'b.ts',
      `import { fromA } from './a';
       export const fromB = () => 'b+' + fromA();`,
    );
    const id = addScript(
      assets,
      'Main.ts',
      `import { Behaviour } from 'rowan';
       import { viaB } from './a';
       export default class Main extends Behaviour { static value = viaB(); }`,
    );
    const scriptClass = createLoader(assets).loadClass(id) as unknown as { value: string };
    expect(scriptClass.value).toBe('b+a');
  });

  it.each([
    ['export const nothing = 1;', 'must default-export a class that extends Behaviour'],
    ['export default class Plain {}', 'must default-export a class that extends Behaviour'],
    ['export default 42;', 'must default-export a class that extends Behaviour'],
    ['export default class {', 'Script "Bad.ts" has a syntax error'],
    ['throw new Error("boom at load");', 'Script "Bad.ts" failed to load: boom at load'],
    // The imports must be used: like TypeScript, the compiler drops unused imports.
    [
      `import fs from 'fs'; fs.readFileSync('x');`,
      'Cannot import "fs". Scripts can import "rowan"',
    ],
    [`import x from './missing'; x();`, 'Cannot find script "./missing" imported from "Bad.ts"'],
  ])('explains what is wrong with %j', (source, message) => {
    const assets = new AssetDatabase();
    const id = addScript(assets, 'Bad.ts', source);
    expect(() => createLoader(assets).loadClass(id)).toThrow(message);
  });

  it('names the script that actually failed when an import is broken', () => {
    const assets = new AssetDatabase();
    addScript(assets, 'helper.ts', 'export const value = ;');
    const id = addScript(
      assets,
      'Main.ts',
      `import { value } from './helper';\nexport const copy = value;\n${MINIMAL}`,
    );
    expect(() => createLoader(assets).loadClass(id)).toThrow(
      'Script "helper.ts" has a syntax error',
    );
  });

  it('retries a script that failed once its source is fixed', () => {
    const assets = new AssetDatabase();
    const id = addScript(assets, 'Fix.ts', 'export default 1;');
    const loader = createLoader(assets);
    expect(() => loader.loadClass(id)).toThrow(RowanError);
    assets.setData(id, MINIMAL);
    loader.invalidate();
    expect(loader.loadClass(id).name).toBe('Minimal');
  });

  it('rejects ids that are missing or not scripts', () => {
    const assets = new AssetDatabase();
    const scene = assets.create({ name: 'a.scene', type: 'scene', mimeType: 'x', data: '{}' });
    const loader = createLoader(assets);
    expect(() => loader.loadClass('missing')).toThrow('does not exist');
    expect(() => loader.loadClass(scene.id)).toThrow('does not exist');
  });

  it('finds import targets by path, with or without an extension', () => {
    const assets = new AssetDatabase();
    const util = assets.get(addScript(assets, 'lib/util.ts', ''));
    const index = assets.get(addScript(assets, 'index.js', ''));
    expect(resolveScriptImport(assets, 'lib/main.ts', './util')).toBe(util);
    expect(resolveScriptImport(assets, 'lib/main.ts', './util.ts')).toBe(util);
    expect(resolveScriptImport(assets, 'lib/deep/main.ts', '../util')).toBe(util);
    expect(resolveScriptImport(assets, 'lib/main.ts', '../index')).toBe(index);
    expect(resolveScriptImport(assets, 'main.ts', '../index')).toBeUndefined();
    expect(resolveScriptImport(assets, 'main.ts', './nope')).toBeUndefined();
  });
});

describe('precompiled scripts', () => {
  it('bundles every script into code that registers module factories', () => {
    const assets = new AssetDatabase();
    addScript(assets, 'helper.ts', 'export const answer: number = 42;');
    const id = addScript(
      assets,
      'Main.ts',
      `import { Behaviour } from 'rowan';
       import { answer } from './helper';
       export default class Main extends Behaviour { static answer = answer; }`,
    );
    const bundle = buildScriptBundle(assets);
    expect(bundle).toContain('// Main.ts');

    const globals = globalThis as Record<string, unknown>;
    try {
      // eslint-disable-next-line @typescript-eslint/no-implied-eval, @typescript-eslint/no-unsafe-call
      new Function(bundle)();
      const factories = globals[SCRIPT_BUNDLE_GLOBAL] as Record<string, ModuleFactory>;
      expect(Object.keys(factories)).toHaveLength(2);

      const loader = new ScriptModuleLoader(assets, new PrecompiledScriptProvider(factories), {
        ...scriptApi,
      });
      expect((loader.loadClass(id) as unknown as { answer: number }).answer).toBe(42);
    } finally {
      delete globals[SCRIPT_BUNDLE_GLOBAL];
    }
  });

  it('fails the export when a script does not compile', () => {
    const assets = new AssetDatabase();
    addScript(assets, 'Broken.ts', 'class {');
    expect(() => buildScriptBundle(assets)).toThrow('Script "Broken.ts" has a syntax error');
  });

  it('reports scripts missing from a precompiled bundle', () => {
    const assets = new AssetDatabase();
    const id = addScript(assets, 'Main.ts', '');
    const loader = new ScriptModuleLoader(assets, new PrecompiledScriptProvider({}), {});
    expect(() => loader.loadClass(id)).toThrow(
      'Script "Main.ts" is missing from the compiled script bundle',
    );
  });
});

describe('script properties', () => {
  it('reads valid declarations and treats a missing declaration as empty', () => {
    class WithProperties {
      static properties = {
        speed: { type: 'number', default: 2, min: 0, max: 10, step: 0.5, label: 'Speed' },
        target: { type: 'prefab' },
      };
    }
    expect(getScriptProperties(WithProperties)).toEqual(WithProperties.properties);
    expect(getScriptProperties(class {})).toEqual({});
    expect(getScriptProperties({ properties: null })).toEqual({});
  });

  it.each([
    [{ properties: [] }, 'static properties must be an object'],
    [{ properties: 'speed' }, 'static properties must be an object'],
    [{ properties: { speed: 5 } }, `Property "speed" must be an object`],
    [{ properties: { speed: { type: 'float' } } }, 'Property "speed" has unknown type "float"'],
    [{ properties: { speed: {} } }, 'unknown type "undefined"'],
    [
      { properties: { speed: { type: 'number', default: 'fast' } } },
      'Property "speed" has a default that does not match type "number"',
    ],
  ])('rejects the malformed declaration %j', (scriptClass, message) => {
    expect(() => getScriptProperties(scriptClass)).toThrow(message);
  });

  it('validates stored values for every property type', () => {
    const valid: Record<string, unknown> = {
      number: 1.5,
      boolean: false,
      string: '',
      vec2: [1, 2],
      color: [1, 0, 0],
      texture: null,
      audio: 'id',
      prefab: 'id',
    };
    for (const type of SCRIPT_PROPERTY_TYPES) {
      expect(isValidStoredValue(type, valid[type]), type).toBe(true);
      expect(isValidStoredValue(type, undefined), type).toBe(false);
      expect(isValidStoredValue(type, getEmptyStoredValue(type)), type).toBe(true);
    }
    expect(isValidStoredValue('number', Number.NaN)).toBe(false);
    expect(isValidStoredValue('vec2', [1])).toBe(false);
    expect(isValidStoredValue('vec2', [1, 'a'])).toBe(false);
    expect(isValidStoredValue('color', [1, 2, 3, 4, 5])).toBe(false);
    expect(isValidStoredValue('prefab', 5)).toBe(false);
  });

  it('converts stored values into what scripts receive', () => {
    expect(toRuntimeValue({ type: 'number' }, 3)).toBe(3);
    expect(toRuntimeValue({ type: 'vec2' }, [1, 2])).toEqual(new Vec2(1, 2));
    expect(toRuntimeValue({ type: 'color' }, [1, 0, 0])).toEqual(new Color(1, 0, 0, 1));
    expect(toRuntimeValue({ type: 'prefab' }, 'asset-id')).toBe('asset-id');
    expect(toRuntimeValue({ type: 'texture' }, null)).toBeNull();
  });

  it('falls back to the default for missing or mistyped values', () => {
    expect(toRuntimeValue({ type: 'number', default: 7 }, undefined)).toBe(7);
    expect(toRuntimeValue({ type: 'number', default: 7 }, 'oops')).toBe(7);
    expect(toRuntimeValue({ type: 'vec2', default: [3, 4] }, [1])).toEqual(new Vec2(3, 4));
    expect(toRuntimeValue({ type: 'string' }, undefined)).toBeUndefined();
  });

  it('maps asset property types to asset types', () => {
    expect(getPropertyAssetType('texture')).toBe('texture');
    expect(getPropertyAssetType('audio')).toBe('audio');
    expect(getPropertyAssetType('prefab')).toBe('prefab');
    expect(getPropertyAssetType('number')).toBeUndefined();
  });
});
