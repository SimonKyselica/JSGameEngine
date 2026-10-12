import { describe, expect, it } from 'vitest';
import {
  AssetDatabase,
  Behaviour,
  getScriptProperties,
  ScriptApi,
  ScriptModuleLoader,
} from '@rowan/core';
import { compileScript, SourceScriptProvider } from '@rowan/core/compiler';
import { generateApiReference } from '../../../../scripts/generateScriptDocs.ts';
import {
  API_REFERENCE,
  DOC_PAGES,
  DOC_SECTIONS,
  findPage,
  firstSentence,
  formatRoute,
  getAdjacentPages,
  getPageOutline,
  getUsage,
  groupMembers,
  linkSignature,
  parseDocText,
  parseInline,
  parseRoute,
  REFERENCE_GROUPS,
  resolveApiLink,
  searchDocs,
} from './docsModel';
import { slugify, type DocBlock } from './docTypes';
import { GUIDES } from './guides';
import { highlightTypeScript } from './highlight';

const typeNamed = (name: string) => API_REFERENCE.types.find((type) => type.name === name)!;

/** The text of every block on a page, for checks that look at all written content. */
function textsOf(blocks: readonly DocBlock[]): string[] {
  return blocks.flatMap((block) => {
    switch (block.kind) {
      case 'paragraph':
      case 'note':
      case 'heading':
        return [block.text];
      case 'list':
        return [...block.items];
      case 'table':
        return [...block.head, ...block.rows.flat()];
      case 'code':
        return [];
    }
  });
}

describe('API reference', () => {
  it('is up to date with the engine source', () => {
    expect(
      generateApiReference(),
      'The scripting API changed. Run "npm run docs:generate" and commit the result.',
    ).toEqual(API_REFERENCE);
  });

  it('describes every type and every member', () => {
    const undocumented = API_REFERENCE.types.flatMap((type) => [
      ...(type.summary === '' ? [type.name] : []),
      ...type.members
        .filter((member) => member.summary === '' || member.signatures.length === 0)
        .map((member) => `${type.name}.${member.name}`),
    ]);
    // Fix these by writing a doc comment on the member in packages/core.
    expect(undocumented).toEqual([]);
  });

  it('covers everything a script can import at run time', () => {
    const documented = new Set(API_REFERENCE.types.map((type) => type.name));
    expect(Object.keys(ScriptApi).filter((name) => !documented.has(name))).toEqual([]);
    for (const name of Object.keys(ScriptApi)) {
      expect(['class', 'object'], name).toContain(typeNamed(name).kind);
    }
  });

  it('leaves out private members and engine plumbing', () => {
    const entityMembers = typeNamed('Entity').members.map((member) => member.name);
    expect(entityMembers).toContain('findChild');
    expect(entityMembers).not.toContain('identity');
    expect(typeNamed('SpriteRenderer').members.map((member) => member.name)).not.toContain(
      'schema',
    );
  });

  it('records signatures the way they are written in a script', () => {
    const member = (type: string, name: string) =>
      typeNamed(type).members.find((candidate) => candidate.name === name)!;
    expect(member('Vec2', 'constructor').signatures).toEqual(['new Vec2(x?: number, y?: number)']);
    expect(member('Vec2', 'zero')).toMatchObject({ static: true, signatures: ['zero(): Vec2'] });
    expect(member('Behaviour', 'after').signatures).toEqual([
      'after(seconds: number, callback: () => void): CancelTimer',
    ]);
    expect(member('Behaviour', 'entity')).toMatchObject({
      kind: 'property',
      readonly: true,
      signatures: ['entity: Entity'],
    });
    expect(member('Entity', 'name').readonly).toBe(false);
    expect(member('ScriptLifecycle', 'onUpdate').signatures).toEqual([
      'onUpdate?(deltaTime: number): void',
    ]);
    expect(member('MouseButton', 'Left').signatures).toEqual(['Left: 0']);
    expect(member('MathUtils', 'clamp').kind).toBe('method');
    // An alias is shown as it is written, unless it is derived from a value scripts cannot see.
    expect(typeNamed('ScriptPropertyDefinitions').definition).toBe(
      'Record<string, ScriptPropertyDefinition>',
    );
    expect(typeNamed('ScriptPropertyValue').definition).toBe(
      'number | boolean | string | number[] | null',
    );
    // String literal types are printed with the quotes scripts are written with.
    expect(typeNamed('BodyType').definition).toBe("'static' | 'kinematic' | 'dynamic'");
  });

  it('keeps the type parameters of a generic type', () => {
    expect(typeNamed('ComponentClass')).toMatchObject({
      typeParameters: '<T extends object = object>',
      definition: 'new () => T',
    });
    expect(typeNamed('BodyType').typeParameters).toBe('');
  });

  it('names only types that a reader can look up', () => {
    // Names that need no page: TypeScript's own helpers, type parameters, and the engine's
    // Scene object, which `Entity.scene` exposes but scripts replace with `this.scene`.
    const known = new Set([
      ...API_REFERENCE.types.map((type) => type.name),
      ...['Readonly', 'Partial', 'Record', 'T', 'Scene'],
    ]);
    const unknown = API_REFERENCE.types.flatMap((type) =>
      [type.definition, ...type.members.flatMap((member) => member.signatures)].flatMap((text) =>
        // A capitalized name followed by a colon is a member such as `MouseButton.Left`.
        (text.match(/\b[A-Z]\w*\b(?!\??:)/g) ?? [])
          .filter((name) => !known.has(name))
          .map((name) => `${type.name}: ${name} in "${text}"`),
      ),
    );
    // Fix these by exporting the type from scripting/api.ts with a doc comment.
    expect(unknown).toEqual([]);
  });

  it('turns {@link} references in doc comments into inline code', () => {
    const summaries = API_REFERENCE.types.flatMap((type) => [
      type.summary,
      ...type.members.map((member) => member.summary),
    ]);
    expect(summaries.filter((summary) => summary.includes('{@link'))).toEqual([]);
    expect(typeNamed('Vec2').summary).toContain('`Vec2.clone`');
  });

  it('puts every documented type in exactly one navigation group', () => {
    const grouped = REFERENCE_GROUPS.flatMap((group) => group.types);
    expect(new Set(grouped).size).toBe(grouped.length);
    expect([...grouped].sort()).toEqual(API_REFERENCE.types.map((type) => type.name).sort());
  });
});

describe('documentation pages', () => {
  it('starts with the guide and gives every page a unique address', () => {
    expect(DOC_PAGES[0]!.id).toBe('guide/getting-started');
    expect(DOC_SECTIONS[0]!.title).toBe('Guide');
    const ids = DOC_PAGES.map((page) => page.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(DOC_PAGES).toHaveLength(GUIDES.length + API_REFERENCE.types.length);
  });

  it('finds pages and their neighbours in reading order', () => {
    expect(findPage('api/Vec2')?.title).toBe('Vec2');
    expect(findPage('api/Nothing')).toBeUndefined();
    const first = getAdjacentPages(DOC_PAGES[0]!.id);
    expect(first.previous).toBeNull();
    expect(first.next).toBe(DOC_PAGES[1]);
    expect(getAdjacentPages(DOC_PAGES.at(-1)!.id).next).toBeNull();
    expect(getAdjacentPages('nowhere')).toEqual({ previous: null, next: null });
  });

  it('reads and writes addresses', () => {
    expect(parseRoute('#/api/Vec2')).toEqual({ page: findPage('api/Vec2'), anchor: null });
    expect(parseRoute('#/api/Vec2/add').anchor).toBe('add');
    expect(parseRoute('#/guide/physics/moving-a-body').anchor).toBe('moving-a-body');
    expect(formatRoute('api/Vec2', 'add')).toBe('#/api/Vec2/add');
    expect(formatRoute('guide/timers')).toBe('#/guide/timers');
    expect(formatRoute('api/Vec2', null)).toBe('#/api/Vec2');
  });

  it('copes with an address that is not valid percent-encoding', () => {
    expect(parseRoute('#/api/Vec2/%zz')).toEqual({ page: findPage('api/Vec2'), anchor: '%zz' });
    expect(parseRoute('#/api/%E0%A4%A')).toEqual({ page: DOC_PAGES[0], anchor: null });
  });

  it('shows the first page for an empty or unknown address', () => {
    for (const hash of ['', '#', '#/', '#/api/Gone', '#/somewhere/else/entirely']) {
      expect(parseRoute(hash), hash).toEqual({ page: DOC_PAGES[0], anchor: null });
    }
  });

  it('links only to pages, headings and members that exist', () => {
    const broken: string[] = [];
    const check = (pageId: string, text: string): void => {
      for (const node of parseInline(text)) {
        if (node.kind !== 'link' && node.kind !== 'code') {
          continue;
        }
        if (node.href === null) {
          continue;
        }
        const [, section, name, anchor] = node.href.split('/');
        const target = findPage(`${section}/${name}`);
        const anchors = target ? getPageOutline(target).map((entry) => entry.id) : [];
        if (!target || (anchor !== undefined && !anchors.includes(decodeURIComponent(anchor)))) {
          broken.push(`${pageId}: ${node.text} -> ${node.href}`);
        }
      }
    };
    for (const page of DOC_PAGES) {
      check(page.id, page.summary);
      textsOf(page.blocks).forEach((text) => check(page.id, text));
      for (const member of page.apiType?.members ?? []) {
        textsOf(parseDocText(member.summary)).forEach((text) => check(page.id, text));
      }
    }
    expect(broken).toEqual([]);
  });

  it('outlines a guide by its headings and a type by its members', () => {
    const guide = findPage('guide/lifecycle')!;
    expect(getPageOutline(guide).map((entry) => entry.title)).toEqual([
      'Order within a frame',
      'Enabled and active',
      'Seeing it happen',
    ]);
    const outline = getPageOutline(findPage('api/Vec2')!);
    expect(outline.slice(0, 3)).toEqual([
      { id: 'section-constructor', title: 'Constructor', level: 1 },
      { id: 'constructor', title: 'constructor', level: 2 },
      { id: 'section-static', title: 'Static members', level: 1 },
    ]);
    expect(getPageOutline(findPage('api/BodyType')!)).toEqual([]);
  });
});

describe('reference page structure', () => {
  it('groups the members of a class', () => {
    const groups = groupMembers(typeNamed('Vec2'));
    expect(groups.map((group) => group.title)).toEqual([
      'Constructor',
      'Static members',
      'Properties',
      'Methods',
    ]);
    expect(groups[1]!.members.map((member) => member.name)).toContain('fromAngle');
    expect(groups[2]!.members.map((member) => member.name)).toEqual(['x', 'y']);
    expect(groups[3]!.members.every((member) => !member.static)).toBe(true);
  });

  it('lists the members of a constant object without calling them static', () => {
    const groups = groupMembers(typeNamed('MathUtils'));
    expect(groups.map((group) => group.title)).toEqual(['Properties', 'Methods']);
    expect(groups[0]!.members.map((member) => member.name)).toEqual(['EPSILON']);
  });

  it('omits empty groups', () => {
    expect(groupMembers(typeNamed('Time')).map((group) => group.title)).toEqual(['Properties']);
    expect(groupMembers(typeNamed('CancelTimer'))).toEqual([]);
  });

  it('links the documented types a signature names', () => {
    expect(linkSignature('getVelocity(entity: Entity): Vec2', 'Physics2D')).toEqual([
      { text: 'getVelocity(entity: ', href: null },
      { text: 'Entity', href: '#/api/Entity' },
      { text: '): ', href: null },
      { text: 'Vec2', href: '#/api/Vec2' },
    ]);
    expect(linkSignature('scale: number', 'Transform')).toEqual([
      { text: 'scale: number', href: null },
    ]);
  });

  it('does not link a type to its own page, nor names that only look like a type', () => {
    expect(linkSignature('Vec2.zero(): Vec2', 'Vec2')).toEqual([
      { text: 'Vec2.zero(): Vec2', href: null },
    ]);
    // A member and a parameter that are called like a type are not that type.
    const types = API_REFERENCE.types.map((type) => type.name);
    expect(types).toContain('Time');
    expect(linkSignature('Clock.Time: number', 'Clock')).toEqual([
      { text: 'Clock.Time: number', href: null },
    ]);
    expect(linkSignature('wait(Time?: number): Time', 'Clock')).toEqual([
      { text: 'wait(Time?: number): ', href: null },
      { text: 'Time', href: '#/api/Time' },
    ]);
  });

  it('gives back the signature unchanged when its parts are joined', () => {
    for (const type of API_REFERENCE.types) {
      for (const signature of type.members.flatMap((member) => member.signatures)) {
        const joined = linkSignature(signature, type.name)
          .map((part) => part.text)
          .join('');
        expect(joined).toBe(signature);
      }
    }
  });

  it('tells how a script gets hold of each kind of type', () => {
    expect(getUsage(typeNamed('Vec2'))).toEqual({
      importStatement: "import { Vec2 } from 'rowan';",
      access: null,
    });
    expect(getUsage(typeNamed('Collision')).importStatement).toBe(
      "import type { Collision } from 'rowan';",
    );
    expect(getUsage(typeNamed('Input'))).toEqual({ importStatement: null, access: 'this.input' });
    expect(getUsage(typeNamed('Entity'))).toEqual({
      importStatement: "import { Entity } from 'rowan';",
      access: 'this.entity',
    });
  });
});

describe('documentation text', () => {
  it('splits inline code, bold text and links from plain text', () => {
    expect(parseInline('Press **Play**, call `this.log`, read [Timers](guide/timers).')).toEqual([
      { kind: 'text', text: 'Press ' },
      { kind: 'bold', text: 'Play' },
      { kind: 'text', text: ', call ' },
      { kind: 'code', text: 'this.log', href: null },
      { kind: 'text', text: ', read ' },
      { kind: 'link', text: 'Timers', href: '#/guide/timers' },
      { kind: 'text', text: '.' },
    ]);
    expect(parseInline('plain')).toEqual([{ kind: 'text', text: 'plain' }]);
    expect(parseInline('')).toEqual([]);
    expect(parseInline('[add](api/Vec2/add)')).toEqual([
      { kind: 'link', text: 'add', href: '#/api/Vec2/add' },
    ]);
  });

  it('links inline code that names part of the API', () => {
    expect(resolveApiLink('Vec2')).toBe('#/api/Vec2');
    expect(resolveApiLink('Entity.findChild')).toBe('#/api/Entity/findChild');
    expect(resolveApiLink('Time.timeScale')).toBe('#/api/Time/timeScale');
    expect(resolveApiLink('Vec2.clone()')).toBe('#/api/Vec2/clone');
    expect(resolveApiLink('Vec2.nothing')).toBeNull();
    expect(resolveApiLink('this.entity')).toBeNull();
    expect(resolveApiLink('a.b.c')).toBeNull();
    expect(parseInline('See `Vec2`.')[1]).toEqual({
      kind: 'code',
      text: 'Vec2',
      href: '#/api/Vec2',
    });
  });

  it('turns a doc comment into paragraphs, lists and code', () => {
    expect(
      parseDocText(
        [
          'First paragraph.',
          '',
          'Second one:',
          '- an item',
          '  that continues',
          '- another item',
          '',
          '```ts',
          'const a = 1;',
          '',
          'const b = 2;',
          '```',
          'Closing words.',
        ].join('\n'),
      ),
    ).toEqual([
      { kind: 'paragraph', text: 'First paragraph.' },
      { kind: 'paragraph', text: 'Second one:' },
      { kind: 'list', ordered: false, items: ['an item that continues', 'another item'] },
      { kind: 'code', code: 'const a = 1;\n\nconst b = 2;' },
      { kind: 'paragraph', text: 'Closing words.' },
    ]);
    expect(parseDocText('')).toEqual([]);
  });

  it('takes the first sentence as a short description', () => {
    expect(firstSentence('Sets both components. And more.')).toBe('Sets both components.');
    expect(firstSentence('A value of 0.5 is half. Next.')).toBe('A value of 0.5 is half.');
    expect(firstSentence('See `Vec2.clone` now')).toBe('See Vec2.clone now');
    expect(firstSentence('Line one\nLine two.')).toBe('Line one');
  });

  it('makes heading ids from their text', () => {
    expect(slugify('Order within a frame')).toBe('order-within-a-frame');
    expect(slugify("  What's new?  ")).toBe('what-s-new');
  });
});

describe('searchDocs', () => {
  const titles = (query: string, limit?: number): string[] =>
    searchDocs(query, limit).map((result) => result.title);

  it('puts an exact name first, then names that start with the search', () => {
    expect(titles('after')[0]).toBe('Behaviour.after');
    expect(titles('raycast').slice(0, 2)).toEqual(['Physics2D.raycast', 'Physics2D.raycastAll']);
    expect(titles('vec2')[0]).toBe('Vec2');
  });

  it('finds members by their qualified name and pages by their title', () => {
    expect(titles('Entity.findChild')).toEqual(['Entity.findChild']);
    expect(titles('timers')).toContain('Timers');
    expect(titles('order within')).toEqual(['Order within a frame']);
  });

  it('falls back to descriptions', () => {
    expect(titles('counter-clockwise')).toContain('Vec2.rotate');
  });

  it('links each result to its place in the documentation', () => {
    expect(searchDocs('raycastAll')[0]).toEqual({
      title: 'Physics2D.raycastAll',
      description: 'Finds every solid collider along a ray, nearest first.',
      href: '#/api/Physics2D/raycastAll',
    });
  });

  it('returns nothing for a blank search and respects the limit', () => {
    expect(searchDocs('   ')).toEqual([]);
    expect(searchDocs('zzzz')).toEqual([]);
    expect(searchDocs('e', 5)).toHaveLength(5);
  });
});

describe('guide content', () => {
  const examples = import.meta.glob<string>('./examples/*.ts', {
    query: '?raw',
    import: 'default',
    eager: true,
  });
  const codeBlocks = DOC_PAGES.flatMap((page) => [
    ...page.blocks,
    ...(page.apiType
      ? [page.apiType.summary, ...page.apiType.members.map((member) => member.summary)].flatMap(
          parseDocText,
        )
      : []),
  ]).flatMap((block) => (block.kind === 'code' ? [block.code] : []));

  it('gives every guide a unique id, a title and a summary', () => {
    expect(new Set(GUIDES.map((guide) => guide.id)).size).toBe(GUIDES.length);
    for (const guide of GUIDES) {
      expect(guide.title, guide.id).not.toBe('');
      expect(guide.summary.length, guide.id).toBeGreaterThan(20);
      expect(guide.blocks.length, guide.id).toBeGreaterThan(0);
    }
  });

  it('gives every heading and member of a page its own anchor', () => {
    for (const page of DOC_PAGES) {
      const ids = getPageOutline(page).map((entry) => entry.id);
      expect(new Set(ids).size, page.id).toBe(ids.length);
    }
    // A member called like a heading is the case that used to clash.
    const binding = getPageOutline(findPage('api/ScriptBinding')!);
    expect(binding.map((entry) => entry.id)).toEqual([
      'section-properties',
      'script',
      'enabled',
      'properties',
    ]);
  });

  it('contains only code that compiles', () => {
    // Guards against the collection above silently coming back empty.
    expect(codeBlocks.length).toBeGreaterThanOrEqual(Object.keys(examples).length);
    for (const [index, source] of codeBlocks.entries()) {
      expect(() => compileScript(source, `code block ${index}`), source).not.toThrow();
    }
  });

  it('shows every example script, and each one loads as a working script', () => {
    const assets = new AssetDatabase();
    const loader = new ScriptModuleLoader(assets, new SourceScriptProvider(assets), {
      ...ScriptApi,
    });
    expect(Object.keys(examples).length).toBeGreaterThanOrEqual(10);

    for (const [path, source] of Object.entries(examples)) {
      expect(codeBlocks, `${path} is not shown in any guide`).toContain(source.trim());
      const record = assets.create({
        name: path.replace('./examples/', ''),
        type: 'script',
        mimeType: 'text/typescript',
        data: source,
      });
      const scriptClass = loader.loadClass(record.id);
      expect(new scriptClass(), path).toBeInstanceOf(Behaviour);
      // Throws when a property declaration is malformed.
      getScriptProperties(scriptClass);
    }
  });
});

describe('highlightTypeScript', () => {
  it('colors keywords, strings, numbers and comments', () => {
    const tokens = highlightTypeScript(`const name = 'Rowan'; // greeting\nreturn 42;`);
    const classOf = (text: string): string | null | undefined =>
      tokens.find((token) => token.text === text)?.className;
    expect(classOf('const')).toContain('tok-keyword');
    expect(classOf("'Rowan'")).toContain('tok-string');
    expect(classOf('// greeting')).toContain('tok-comment');
    expect(classOf('42')).toContain('tok-number');
  });

  it('returns the source unchanged when the tokens are joined', () => {
    for (const source of [GUIDES[0]!.summary, 'class A extends B {\n  x = 1;\n}\n', '', '   ']) {
      expect(
        highlightTypeScript(source)
          .map((token) => token.text)
          .join(''),
      ).toBe(source);
    }
  });
});
