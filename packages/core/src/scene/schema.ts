import type { AssetType } from '../assets/asset';
import { RowanError } from '../core/assert';
import { Color } from '../math/color';
import { Vec2 } from '../math/vec2';

/**
 * How a component field is stored, serialized and edited:
 *
 * - `number`, `boolean`, `string`: primitives.
 * - `angle`: a number in radians that editors show in degrees.
 * - `vec2`: a {@link Vec2}, serialized as `[x, y]`.
 * - `color`: a {@link Color}, serialized as `[r, g, b, a]`.
 * - `enum`: one of the strings in `options`.
 * - `asset`: an asset id or `null`.
 * - `json`: any JSON-compatible value, deep-copied on read and write.
 */
export type FieldType =
  'number' | 'angle' | 'boolean' | 'string' | 'vec2' | 'color' | 'enum' | 'asset' | 'json';

export interface FieldSchema {
  readonly type: FieldType;
  /** Inspector label. Defaults to a title-cased version of the field name. */
  readonly label?: string;
  readonly min?: number;
  readonly max?: number;
  readonly step?: number;
  /** Allowed values of an `enum` field. */
  readonly options?: readonly string[];
  /** The asset type an `asset` field accepts. */
  readonly assetType?: AssetType;
  /** Hidden fields are serialized but have no generic inspector control. */
  readonly hidden?: boolean;
  /** Validates and normalizes a `json` field while loading. Must throw on invalid data. */
  readonly parse?: (value: unknown, path: string) => unknown;
}

export interface ComponentSchema {
  /** Stable name used in serialized scenes. Never rename this without a migration. */
  readonly name: string;
  readonly displayName: string;
  /** Group shown in the editor's Add Component menu. */
  readonly category: string;
  /** Built-in components every entity owns cannot be added or removed by users. */
  readonly removable: boolean;
  readonly fields: Readonly<Record<string, FieldSchema>>;
}

/** A component class together with the schema that describes its fields. */
export interface ComponentType<T extends object = object> {
  new (): T;
  readonly schema: ComponentSchema;
}

export type SerializedComponent = Record<string, unknown>;

type FieldBag = Record<string, unknown>;

/** Converts a component into plain JSON using its schema. */
export function serializeComponent(
  component: object,
  schema: ComponentSchema,
): SerializedComponent {
  const source = component as FieldBag;
  const result: SerializedComponent = {};
  for (const [name, field] of Object.entries(schema.fields)) {
    result[name] = serializeField(source[name], field);
  }
  return result;
}

/**
 * Applies serialized data to a component. Fields missing from `data` keep their current
 * value, so scenes saved by older versions pick up defaults for newly added fields.
 */
export function deserializeComponent(
  component: object,
  schema: ComponentSchema,
  data: unknown,
  path: string,
): void {
  if (typeof data !== 'object' || data === null || Array.isArray(data)) {
    throw new RowanError(`${path}: expected an object`);
  }
  const target = component as FieldBag;
  const source = data as FieldBag;
  for (const [name, field] of Object.entries(schema.fields)) {
    if (source[name] === undefined) {
      continue;
    }
    target[name] = deserializeField(source[name], field, `${path}.${name}`);
  }
}

/** Copies every schema field from `source` to `target`, deep-copying reference values. */
export function copyComponent(source: object, target: object, schema: ComponentSchema): void {
  deserializeComponent(target, schema, serializeComponent(source, schema), schema.name);
}

function serializeField(value: unknown, field: FieldSchema): unknown {
  switch (field.type) {
    case 'vec2':
      return (value as Vec2).toArray();
    case 'color':
      return (value as Color).toArray();
    case 'json':
      return cloneJson(value);
    default:
      return value;
  }
}

function deserializeField(value: unknown, field: FieldSchema, path: string): unknown {
  switch (field.type) {
    case 'number':
    case 'angle':
      return expectNumber(value, path);
    case 'boolean':
      if (typeof value !== 'boolean') {
        throw new RowanError(`${path}: expected a boolean`);
      }
      return value;
    case 'string':
      if (typeof value !== 'string') {
        throw new RowanError(`${path}: expected a string`);
      }
      return value;
    case 'vec2': {
      const numbers = expectNumberArray(value, 2, 2, path);
      return new Vec2(numbers[0], numbers[1]);
    }
    case 'color': {
      const numbers = expectNumberArray(value, 3, 4, path);
      return new Color(numbers[0], numbers[1], numbers[2], numbers[3] ?? 1);
    }
    case 'enum':
      if (typeof value !== 'string' || !field.options?.includes(value)) {
        throw new RowanError(
          `${path}: expected one of ${field.options?.map((option) => `"${option}"`).join(', ')}`,
        );
      }
      return value;
    case 'asset':
      if (value !== null && typeof value !== 'string') {
        throw new RowanError(`${path}: expected an asset id or null`);
      }
      return value;
    case 'json': {
      const copy = cloneJson(value);
      return field.parse ? field.parse(copy, path) : copy;
    }
  }
}

function expectNumber(value: unknown, path: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new RowanError(`${path}: expected a finite number`);
  }
  return value;
}

function expectNumberArray(value: unknown, min: number, max: number, path: string): number[] {
  if (!Array.isArray(value) || value.length < min || value.length > max) {
    const size = min === max ? `${min}` : `${min} to ${max}`;
    throw new RowanError(`${path}: expected an array of ${size} numbers`);
  }
  return value.map((item, index) => expectNumber(item, `${path}[${index}]`));
}

/** Deep-copies a JSON-compatible value. */
export function cloneJson<T>(value: T): T {
  return value === undefined ? value : (JSON.parse(JSON.stringify(value)) as T);
}

/** Turns a camelCase field name into a readable label: `gravityScale` becomes `Gravity Scale`. */
export function formatFieldLabel(name: string): string {
  const spaced = name.replace(/([a-z0-9])([A-Z])/g, '$1 $2');
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}
