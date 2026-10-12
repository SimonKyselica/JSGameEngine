/**
 * Generates the scripting API reference shown in the editor's documentation.
 *
 * The reference is read from the engine's own source: every type that scripts can import
 * from `rowan`, with the signatures and doc comments of its public members. That makes
 * the doc comments in `packages/core` the single source of the reference.
 *
 * Run it with `npm run docs:generate` after changing the scripting API. A unit test
 * fails when the committed reference no longer matches the source.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import ts from 'typescript';
import type { ApiMember, ApiReference, ApiType } from '../packages/editor/src/docs/apiTypes.ts';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const API_ENTRY = resolve(ROOT, 'packages/core/src/scripting/api.ts');

/** Where the generated reference is stored. */
export const API_REFERENCE_PATH = resolve(
  ROOT,
  'packages/editor/src/docs/apiReference.generated.json',
);

/** Classes scripts create with `new`. The others are handed out by the engine. */
const CONSTRUCTIBLE = new Set(['Vec2', 'Color']);
/** Static members that are engine plumbing rather than scripting API. */
const HIDDEN_STATICS = new Set(['prototype', 'schema']);

/** Types are printed in full, with the quotes that scripts are written with. */
const TYPE_FORMAT =
  ts.TypeFormatFlags.NoTruncation | ts.TypeFormatFlags.UseSingleQuotesForStringLiteralType;

/** Builds the reference from the engine source as it is on disk. */
export function generateApiReference(): ApiReference {
  const program = ts.createProgram([API_ENTRY], {
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    lib: ['lib.es2023.d.ts', 'lib.dom.d.ts'],
    strict: true,
    skipLibCheck: true,
    noEmit: true,
    types: [],
  });
  const checker = program.getTypeChecker();
  const entry = program.getSourceFile(API_ENTRY);
  const moduleSymbol = entry && checker.getSymbolAtLocation(entry);
  if (!moduleSymbol) {
    throw new Error(`Could not read the scripting API from ${API_ENTRY}`);
  }

  const types = checker
    .getExportsOfModule(moduleSymbol)
    .map((exported) => describeExport(checker, exported))
    .sort((a, b) => a.name.localeCompare(b.name));
  const corePackage = JSON.parse(
    readFileSync(resolve(ROOT, 'packages/core/package.json'), 'utf8'),
  ) as { version: string };
  return { engineVersion: corePackage.version, types };
}

function describeExport(checker: ts.TypeChecker, exported: ts.Symbol): ApiType {
  const symbol =
    exported.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(exported) : exported;
  const declaration = symbol.valueDeclaration ?? symbol.declarations?.[0];
  if (!declaration) {
    throw new Error(`The export "${exported.name}" has no declaration`);
  }
  const base = {
    name: exported.name,
    summary: cleanDocumentation(symbol.getDocumentationComment(checker)),
    typeParameters: '',
    definition: '',
  };

  if (symbol.flags & ts.SymbolFlags.Class) {
    const staticSide = checker.getTypeOfSymbolAtLocation(symbol, declaration);
    const members = [
      ...(CONSTRUCTIBLE.has(exported.name)
        ? describeConstructors(checker, exported.name, staticSide, declaration)
        : []),
      ...describeMembers(checker, staticSide, true),
      ...describeMembers(checker, checker.getDeclaredTypeOfSymbol(symbol), false),
    ];
    return { ...base, kind: 'class', members };
  }
  if (symbol.flags & ts.SymbolFlags.Interface) {
    const members = describeMembers(checker, checker.getDeclaredTypeOfSymbol(symbol), false);
    return { ...base, kind: 'interface', members };
  }
  if (symbol.flags & ts.SymbolFlags.TypeAlias && ts.isTypeAliasDeclaration(declaration)) {
    // The alias is shown as it is written. One derived from a value, such as
    // `(typeof BODY_TYPES)[number]`, says nothing to a reader, so the compiler spells out what
    // it stands for; InTypeAlias keeps it from just repeating the alias's name.
    const written = declaration.type.getText().replace(/\s+/g, ' ');
    const definition = /\btypeof\b/.test(written)
      ? checker.typeToString(
          checker.getDeclaredTypeOfSymbol(symbol),
          declaration,
          TYPE_FORMAT | ts.TypeFormatFlags.InTypeAlias,
        )
      : written;
    const parameters = declaration.typeParameters?.map((parameter) => parameter.getText());
    const typeParameters = parameters ? `<${parameters.join(', ')}>` : '';
    return { ...base, kind: 'type', typeParameters, definition, members: [] };
  }
  if (symbol.flags & ts.SymbolFlags.Variable) {
    const type = checker.getTypeOfSymbolAtLocation(symbol, declaration);
    return { ...base, kind: 'object', members: describeMembers(checker, type, true) };
  }
  throw new Error(`Do not know how to document the export "${exported.name}"`);
}

function describeConstructors(
  checker: ts.TypeChecker,
  className: string,
  staticSide: ts.Type,
  declaration: ts.Declaration,
): ApiMember[] {
  const signatures = staticSide.getConstructSignatures();
  if (signatures.length === 0) {
    return [];
  }
  return [
    {
      name: 'constructor',
      kind: 'constructor',
      static: false,
      readonly: false,
      signatures: signatures.map((signature) => {
        const parameters = signature.parameters
          .map((parameter) => describeParameter(checker, parameter, declaration))
          .join(', ');
        return `new ${className}(${parameters})`;
      }),
      summary: cleanDocumentation(signatures[0]?.getDocumentationComment(checker) ?? []),
    },
  ];
}

function describeParameter(
  checker: ts.TypeChecker,
  parameter: ts.Symbol,
  location: ts.Node,
): string {
  const declaration = parameter.valueDeclaration;
  const optional =
    declaration !== undefined &&
    ts.isParameter(declaration) &&
    (declaration.questionToken !== undefined || declaration.initializer !== undefined);
  const type = checker.typeToString(
    checker.getTypeOfSymbolAtLocation(parameter, location),
    location,
    TYPE_FORMAT,
  );
  return `${parameter.name}${optional ? '?' : ''}: ${type}`;
}

/** The public members of a type, in the order they are declared. */
function describeMembers(checker: ts.TypeChecker, type: ts.Type, isStatic: boolean): ApiMember[] {
  const members: ApiMember[] = [];
  for (const property of type.getProperties()) {
    const declarations = property.declarations ?? [];
    const declaration = property.valueDeclaration ?? declarations[0];
    if (!declaration || isHidden(property, declaration, isStatic)) {
      continue;
    }
    members.push(describeMember(checker, property, declaration, declarations, isStatic));
  }
  return members;
}

function isHidden(property: ts.Symbol, declaration: ts.Declaration, isStatic: boolean): boolean {
  if (property.name.startsWith('_') || property.name.startsWith('#')) {
    return true;
  }
  if (isStatic && HIDDEN_STATICS.has(property.name)) {
    return true;
  }
  const modifiers = ts.getCombinedModifierFlags(declaration);
  return (modifiers & (ts.ModifierFlags.Private | ts.ModifierFlags.Protected)) !== 0;
}

function describeMember(
  checker: ts.TypeChecker,
  property: ts.Symbol,
  declaration: ts.Declaration,
  declarations: readonly ts.Declaration[],
  isStatic: boolean,
): ApiMember {
  const type = checker.getTypeOfSymbolAtLocation(property, declaration);
  const optional = (property.flags & ts.SymbolFlags.Optional) !== 0 ? '?' : '';
  const name = property.name;
  const summary = cleanDocumentation(getDocumentation(checker, property, declaration));

  // An optional method has the type `(() => void) | undefined`.
  const callSignatures = checker.getNonNullableType(type).getCallSignatures();
  const isMethod =
    callSignatures.length > 0 &&
    (ts.isMethodDeclaration(declaration) ||
      ts.isMethodSignature(declaration) ||
      ts.isShorthandPropertyAssignment(declaration) ||
      ts.isPropertyAssignment(declaration));
  if (isMethod) {
    return {
      name,
      kind: 'method',
      static: isStatic,
      readonly: false,
      signatures: callSignatures.map(
        (signature) =>
          `${name}${optional}${checker.signatureToString(signature, declaration, TYPE_FORMAT)}`,
      ),
      summary,
    };
  }

  const hasSetter = declarations.some((candidate) => ts.isSetAccessorDeclaration(candidate));
  const isGetterOnly = ts.isGetAccessorDeclaration(declaration) && !hasSetter;
  const modifiers = ts.getCombinedModifierFlags(declaration);
  return {
    name,
    kind: 'property',
    static: isStatic,
    readonly: isGetterOnly || (modifiers & ts.ModifierFlags.Readonly) !== 0,
    signatures: [`${name}${optional}: ${getTypeText(checker, type, declaration)}`],
    summary,
  };
}

/** The type as the source spells it when it has an annotation, else as the compiler infers it. */
function getTypeText(checker: ts.TypeChecker, type: ts.Type, declaration: ts.Declaration): string {
  const annotated =
    ts.isPropertyDeclaration(declaration) ||
    ts.isPropertySignature(declaration) ||
    ts.isGetAccessorDeclaration(declaration) ||
    ts.isParameter(declaration)
      ? declaration.type
      : undefined;
  if (annotated) {
    return annotated.getText();
  }
  // For a constant such as `MouseButton.Left` the value itself is the information. A class
  // field initialized with a literal, on the other hand, can hold any value of that type.
  const isConstant = ts.isPropertyAssignment(declaration);
  const shown = isConstant ? type : checker.getBaseTypeOfLiteralType(type);
  return checker.typeToString(shown, declaration, TYPE_FORMAT);
}

function getDocumentation(
  checker: ts.TypeChecker,
  property: ts.Symbol,
  declaration: ts.Declaration,
): ts.SymbolDisplayPart[] {
  // `{ clamp, lerp }` documents its members where the functions are defined.
  if (ts.isShorthandPropertyAssignment(declaration)) {
    const value = checker.getShorthandAssignmentValueSymbol(declaration);
    if (value) {
      return value.getDocumentationComment(checker);
    }
  }
  return property.getDocumentationComment(checker);
}

/**
 * Turns a doc comment into the plain text the documentation shows: `{@link Name}` becomes
 * inline code, and the line breaks that only wrap the comment in the source are removed.
 * Blank lines, lists and fenced code keep their structure.
 */
function cleanDocumentation(parts: readonly { text: string; kind: string }[]): string {
  const text = parts
    .map((part) => part.text)
    .join('')
    .replace(/\{@link\s+([^}\s]+)[^}]*\}/g, '`$1`');

  const lines: string[] = [];
  let inCode = false;
  for (const rawLine of text.split('\n')) {
    const line = rawLine.trimEnd();
    const startsBlock = line.trim() === '' || line.startsWith('- ') || line.startsWith('```');
    if (line.startsWith('```')) {
      inCode = !inCode;
      lines.push(line);
    } else if (inCode || startsBlock || lines.length === 0) {
      lines.push(line);
    } else {
      const previous = lines[lines.length - 1] ?? '';
      const previousEndsBlock = previous.trim() === '' || previous.startsWith('```');
      if (previousEndsBlock) {
        lines.push(line);
      } else {
        lines[lines.length - 1] = `${previous} ${line.trim()}`;
      }
    }
  }
  return lines.join('\n').trim();
}

/** Writes the reference to disk when this file is run directly. */
function main(): void {
  const reference = generateApiReference();
  writeFileSync(API_REFERENCE_PATH, `${JSON.stringify(reference, null, 2)}\n`);
  const memberCount = reference.types.reduce((total, type) => total + type.members.length, 0);
  process.stdout.write(
    `Wrote ${reference.types.length} types and ${memberCount} members to ${API_REFERENCE_PATH}\n`,
  );
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
