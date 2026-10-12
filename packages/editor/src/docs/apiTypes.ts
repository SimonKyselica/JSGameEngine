/**
 * The shape of the generated scripting API reference. It is produced from the engine's
 * source by `scripts/generateScriptDocs.ts` and read by the documentation pages.
 */

/** What a documented export is. An `object` is a constant such as `MathUtils`. */
export type ApiTypeKind = 'class' | 'interface' | 'object' | 'type';

/** What a member of a documented type is. */
export type ApiMemberKind = 'constructor' | 'method' | 'property';

/** One property, method or constructor of a documented type. */
export interface ApiMember {
  name: string;
  kind: ApiMemberKind;
  /** True for members of the class itself, such as `Vec2.zero()`. */
  static: boolean;
  /** True for properties that scripts can read but not assign. */
  readonly: boolean;
  /** How the member is written in code. Overloaded methods have one entry per overload. */
  signatures: string[];
  /** The member's doc comment, as plain text with Markdown-style code and lists. */
  summary: string;
}

/** One class, interface, object or type alias that scripts can import from `rowan`. */
export interface ApiType {
  name: string;
  kind: ApiTypeKind;
  summary: string;
  /** For a generic type alias, its parameters as written: `<T extends object = object>`. */
  typeParameters: string;
  /** For a type alias, the type it stands for. Empty for the other kinds. */
  definition: string;
  members: ApiMember[];
}

/** The whole generated reference. */
export interface ApiReference {
  /** The engine version the reference was generated from. */
  engineVersion: string;
  types: ApiType[];
}
