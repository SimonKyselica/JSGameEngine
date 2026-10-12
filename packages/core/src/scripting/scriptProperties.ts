import type { AssetType } from '../assets/asset';
import { RowanError } from '../core/assert';
import { Color } from '../math/color';
import { Vec2 } from '../math/vec2';
import type { ScriptPropertyValue } from '../scene/components';

export const SCRIPT_PROPERTY_TYPES = [
  'number',
  'boolean',
  'string',
  'vec2',
  'color',
  'texture',
  'audio',
  'prefab',
] as const;

/** The kinds of property a script can declare in its `static properties`. */
export type ScriptPropertyType = (typeof SCRIPT_PROPERTY_TYPES)[number];

/**
 * Describes one script property that can be edited in the inspector. Scripts declare
 * them in a static `properties` object keyed by field name.
 */
export interface ScriptPropertyDefinition {
  /** What kind of value the property holds, which decides the control the inspector shows. */
  readonly type: ScriptPropertyType;
  /** Value used when the inspector has not set one. Vectors and colors are arrays. */
  readonly default?: ScriptPropertyValue;
  /** The name shown in the inspector. Defaults to the property name in title case. */
  readonly label?: string;
  /** The smallest value the inspector accepts, for `number` properties. */
  readonly min?: number;
  /** The largest value the inspector accepts, for `number` properties. */
  readonly max?: number;
  /** The amount the inspector's arrows change a `number` or `vec2` property by. */
  readonly step?: number;
}

/** The shape of a script's `static properties`: one definition for each property name. */
export type ScriptPropertyDefinitions = Record<string, ScriptPropertyDefinition>;

const ASSET_PROPERTY_TYPES: Partial<Record<ScriptPropertyType, AssetType>> = {
  texture: 'texture',
  audio: 'audio',
  prefab: 'prefab',
};

/** The asset type a property refers to, or `undefined` for plain value properties. */
export function getPropertyAssetType(type: ScriptPropertyType): AssetType | undefined {
  return ASSET_PROPERTY_TYPES[type];
}

/**
 * Reads and validates the static `properties` declaration of a script class.
 * Throws a {@link RowanError} that names the offending property when it is malformed.
 */
export function getScriptProperties(scriptClass: object): ScriptPropertyDefinitions {
  const declared = (scriptClass as { properties?: unknown }).properties;
  if (declared === undefined || declared === null) {
    return {};
  }
  if (typeof declared !== 'object' || Array.isArray(declared)) {
    throw new RowanError('static properties must be an object keyed by property name');
  }

  const result: ScriptPropertyDefinitions = {};
  for (const [name, value] of Object.entries(declared)) {
    if (typeof value !== 'object' || value === null) {
      throw new RowanError(`Property "${name}" must be an object such as { type: 'number' }`);
    }
    const definition = value as Partial<ScriptPropertyDefinition>;
    const type = SCRIPT_PROPERTY_TYPES.find((candidate) => candidate === definition.type);
    if (!type) {
      throw new RowanError(
        `Property "${name}" has unknown type "${String(definition.type)}". ` +
          `Use one of: ${SCRIPT_PROPERTY_TYPES.join(', ')}`,
      );
    }
    if (definition.default !== undefined && !isValidStoredValue(type, definition.default)) {
      throw new RowanError(`Property "${name}" has a default that does not match type "${type}"`);
    }
    result[name] = { ...definition, type };
  }
  return result;
}

/** True when `value` is a valid serialized value for a property of the given type. */
export function isValidStoredValue(type: ScriptPropertyType, value: unknown): boolean {
  switch (type) {
    case 'number':
      return typeof value === 'number' && Number.isFinite(value);
    case 'boolean':
      return typeof value === 'boolean';
    case 'string':
      return typeof value === 'string';
    case 'vec2':
      return isNumberArray(value, 2, 2);
    case 'color':
      return isNumberArray(value, 3, 4);
    case 'texture':
    case 'audio':
    case 'prefab':
      return value === null || typeof value === 'string';
  }
}

/** The value the inspector shows for a property that has neither a value nor a default. */
export function getEmptyStoredValue(type: ScriptPropertyType): ScriptPropertyValue {
  switch (type) {
    case 'number':
      return 0;
    case 'boolean':
      return false;
    case 'string':
      return '';
    case 'vec2':
      return [0, 0];
    case 'color':
      return [1, 1, 1, 1];
    case 'texture':
    case 'audio':
    case 'prefab':
      return null;
  }
}

/**
 * Converts a serialized property value into what the script receives: a `Vec2`, a
 * `Color`, or the value itself. Falls back to the definition's default when the stored
 * value is missing or has the wrong type, and returns `undefined` when there is neither.
 */
export function toRuntimeValue(
  definition: ScriptPropertyDefinition,
  stored: ScriptPropertyValue | undefined,
): unknown {
  const value = isValidStoredValue(definition.type, stored) ? stored : definition.default;
  if (value === undefined) {
    return undefined;
  }
  switch (definition.type) {
    case 'vec2':
      return Vec2.fromArray(value as number[]);
    case 'color':
      return Color.fromArray(value as number[]);
    default:
      return value;
  }
}

function isNumberArray(value: unknown, min: number, max: number): boolean {
  return (
    Array.isArray(value) &&
    value.length >= min &&
    value.length <= max &&
    value.every((item) => typeof item === 'number' && Number.isFinite(item))
  );
}
