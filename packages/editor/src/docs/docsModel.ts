import reference from './apiReference.generated.json';
import type { ApiMember, ApiReference, ApiType } from './apiTypes';
import type { DocBlock } from './docTypes';
import { GUIDES } from './guides';

/** The scripting API reference, generated from the engine source. */
export const API_REFERENCE = reference as ApiReference;

/**
 * How the reference pages are grouped in the navigation. Every documented type has to be
 * listed in exactly one group; a unit test checks this, so a new type cannot be forgotten.
 */
export const REFERENCE_GROUPS: readonly { title: string; types: readonly string[] }[] = [
  {
    title: 'Scripts',
    types: [
      'Behaviour',
      'ScriptLifecycle',
      'ScriptPropertyDefinition',
      'ScriptPropertyDefinitions',
      'ScriptPropertyType',
      'ScriptPropertyValue',
      'BehaviourClass',
      'CancelTimer',
    ],
  },
  {
    title: 'Scene',
    types: [
      'Entity',
      'EntityId',
      'SceneApi',
      'SpawnOptions',
      'AssetsApi',
      'AssetType',
      'StorageApi',
      'SaveValue',
      'Time',
    ],
  },
  {
    title: 'Components',
    types: [
      'Transform',
      'SpriteRenderer',
      'SpriteAnimator',
      'AnimationClip',
      'Tilemap',
      'TextRenderer',
      'TextFont',
      'TextAlign',
      'TextVerticalAlign',
      'Camera',
      'Rigidbody2D',
      'BodyType',
      'BoxCollider2D',
      'CircleCollider2D',
      'AudioSource',
      'ScriptComponent',
      'ScriptBinding',
      'Identity',
      'ComponentClass',
    ],
  },
  { title: 'UI', types: ['ScreenAnchor', 'HorizontalAnchor', 'VerticalAnchor', 'Button'] },
  { title: 'Input', types: ['Input', 'MouseButton', 'AxisName', 'TouchPoint'] },
  { title: 'Physics', types: ['Physics2D', 'RaycastHit', 'Collision'] },
  { title: 'Audio', types: ['AudioApi'] },
  { title: 'Math', types: ['Vec2', 'Vec2Tuple', 'Color', 'ColorTuple', 'MathUtils'] },
];

/** How a script gets hold of the types it does not create or import itself. */
export const ACCESS_HINTS: Readonly<Record<string, string>> = {
  Entity: 'this.entity',
  Transform: 'this.transform',
  SceneApi: 'this.scene',
  Input: 'this.input',
  Physics2D: 'this.physics',
  AudioApi: 'this.audio',
  AssetsApi: 'this.assets',
  StorageApi: 'this.storage',
  Time: 'this.time',
};

/** One page of the documentation: a guide or the reference of one type. */
export interface DocPage {
  /** The page's address after `#/`, for example `guide/physics` or `api/Vec2`. */
  readonly id: string;
  readonly title: string;
  readonly summary: string;
  /** Guide pages have blocks; reference pages are rendered from `apiType`. */
  readonly blocks: readonly DocBlock[];
  readonly apiType: ApiType | null;
}

/** A titled group of pages, as shown in the navigation. */
export interface DocSection {
  readonly title: string;
  readonly pages: readonly DocPage[];
}

const typesByName = new Map(API_REFERENCE.types.map((type) => [type.name, type]));

function createReferencePage(typeName: string): DocPage {
  const apiType = typesByName.get(typeName);
  if (!apiType) {
    throw new Error(`The API reference has no type called "${typeName}"`);
  }
  return {
    id: `api/${apiType.name}`,
    title: apiType.name,
    summary: firstSentence(apiType.summary),
    blocks: [],
    apiType,
  };
}

/** Every section of the documentation in navigation order: the guide, then the reference. */
export const DOC_SECTIONS: readonly DocSection[] = [
  {
    title: 'Guide',
    pages: GUIDES.map((guide) => ({
      id: `guide/${guide.id}`,
      title: guide.title,
      summary: guide.summary,
      blocks: guide.blocks,
      apiType: null,
    })),
  },
  ...REFERENCE_GROUPS.map((group) => ({
    title: group.title,
    pages: group.types.map(createReferencePage),
  })),
];

/** Every page in reading order. */
export const DOC_PAGES: readonly DocPage[] = DOC_SECTIONS.flatMap((section) => section.pages);

const pagesById = new Map(DOC_PAGES.map((page) => [page.id, page]));

/** The page with this id, such as `guide/timers` or `api/Vec2`. */
export function findPage(id: string): DocPage | undefined {
  return pagesById.get(id);
}

/** The pages before and after a page in reading order, for the links at the page's end. */
export function getAdjacentPages(id: string): { previous: DocPage | null; next: DocPage | null } {
  const index = DOC_PAGES.findIndex((page) => page.id === id);
  return {
    previous: index > 0 ? (DOC_PAGES[index - 1] ?? null) : null,
    next: index !== -1 ? (DOC_PAGES[index + 1] ?? null) : null,
  };
}

// --- Addresses -------------------------------------------------------------------------------

/** Where an address leads: a page, and optionally a place on it. */
export interface DocRoute {
  readonly page: DocPage;
  /** The id of the element to scroll to, such as a member name, or `null` for the top. */
  readonly anchor: string | null;
}

/**
 * Reads a location hash such as `#/api/Vec2/add`. Unknown addresses lead to the first
 * page, so an outdated link still shows something useful.
 */
export function parseRoute(hash: string): DocRoute {
  const segments = hash.replace(/^#\/?/, '').split('/').filter(Boolean).map(decodeSegment);
  const page = findPage(segments.slice(0, 2).join('/'));
  if (!page) {
    return { page: DOC_PAGES[0]!, anchor: null };
  }
  return { page, anchor: segments[2] ?? null };
}

/** Decodes one part of an address. A mistyped escape such as `%zz` is kept as it is written. */
function decodeSegment(segment: string): string {
  try {
    return decodeURIComponent(segment);
  } catch (error) {
    // Only malformed escapes end up here; anything else is a bug that must not be hidden.
    if (error instanceof URIError) {
      return segment;
    }
    throw error;
  }
}

/** The hash that leads to a page, and optionally to an anchor on it. */
export function formatRoute(pageId: string, anchor?: string | null): string {
  return `#/${pageId}${anchor ? `/${encodeURIComponent(anchor)}` : ''}`;
}

/**
 * The address a piece of inline code refers to, when it names part of the API: `Vec2`
 * leads to that type's page and `Entity.findChild` to the member. Returns `null` for code
 * that is not an API name.
 */
export function resolveApiLink(code: string): string | null {
  const [typeName, memberName, ...rest] = code.replace(/\(\)$/, '').split('.');
  const type = typeName ? typesByName.get(typeName) : undefined;
  if (!type || rest.length > 0) {
    return null;
  }
  if (memberName === undefined) {
    return formatRoute(`api/${type.name}`);
  }
  return type.members.some((member) => member.name === memberName)
    ? formatRoute(`api/${type.name}`, memberName)
    : null;
}

/** A stretch of a signature: plain text, or the name of a type with the address of its page. */
export interface SignaturePart {
  readonly text: string;
  readonly href: string | null;
}

/**
 * Splits a signature such as `getVelocity(entity: Entity): Vec2` so that the documented types
 * it names can be shown as links. The type whose page the signature is on is left as text.
 */
export function linkSignature(signature: string, currentType: string): SignaturePart[] {
  const parts: SignaturePart[] = [];
  let position = 0;
  for (const match of signature.matchAll(/[A-Za-z_$][\w$]*/g)) {
    const name = match[0];
    if (name === currentType || !typesByName.has(name)) {
      continue;
    }
    // `Type.member` and `name:` are a member and a parameter that merely share a type's name.
    const isMember = signature[match.index - 1] === '.';
    const isLabel = /^\??:/.test(signature.slice(match.index + name.length));
    if (isMember || isLabel) {
      continue;
    }
    if (match.index > position) {
      parts.push({ text: signature.slice(position, match.index), href: null });
    }
    parts.push({ text: name, href: formatRoute(`api/${name}`) });
    position = match.index + name.length;
  }
  if (position < signature.length) {
    parts.push({ text: signature.slice(position), href: null });
  }
  return parts;
}

// --- Text ------------------------------------------------------------------------------------

/** A piece of a line of documentation text, as split up by `parseInline`. */
export type InlineNode =
  | { readonly kind: 'text'; readonly text: string }
  | { readonly kind: 'bold'; readonly text: string }
  | { readonly kind: 'code'; readonly text: string; readonly href: string | null }
  | { readonly kind: 'link'; readonly text: string; readonly href: string };

const INLINE_PATTERN = /`([^`]+)`|\*\*([^*]+)\*\*|\[([^\]]+)\]\(([^)\s]+)\)/g;

/**
 * Splits text into plain text, `` `code` ``, `**bold**` and `[label](page)` links. Code
 * that names part of the API becomes a link to it.
 */
export function parseInline(text: string): InlineNode[] {
  const nodes: InlineNode[] = [];
  let position = 0;
  for (const match of text.matchAll(INLINE_PATTERN)) {
    if (match.index > position) {
      nodes.push({ kind: 'text', text: text.slice(position, match.index) });
    }
    const [whole, code, bold, label, target] = match;
    if (code !== undefined) {
      nodes.push({ kind: 'code', text: code, href: resolveApiLink(code) });
    } else if (bold !== undefined) {
      nodes.push({ kind: 'bold', text: bold });
    } else if (label !== undefined && target !== undefined) {
      const [section, page, anchor] = target.split('/');
      nodes.push({ kind: 'link', text: label, href: formatRoute(`${section}/${page}`, anchor) });
    }
    position = match.index + whole.length;
  }
  if (position < text.length) {
    nodes.push({ kind: 'text', text: text.slice(position) });
  }
  return nodes;
}

/**
 * Turns the text of a doc comment into blocks: paragraphs separated by blank lines, lists
 * of lines starting with `- `, and code between ``` fences.
 */
export function parseDocText(text: string): DocBlock[] {
  const blocks: DocBlock[] = [];
  let paragraph: string[] = [];
  let items: string[] = [];
  let code: string[] | null = null;

  const flush = (): void => {
    if (paragraph.length > 0) {
      blocks.push({ kind: 'paragraph', text: paragraph.join(' ') });
      paragraph = [];
    }
    if (items.length > 0) {
      blocks.push({ kind: 'list', ordered: false, items });
      items = [];
    }
  };

  for (const line of text.split('\n')) {
    if (line.startsWith('```')) {
      if (code === null) {
        flush();
        code = [];
      } else {
        blocks.push({ kind: 'code', code: code.join('\n') });
        code = null;
      }
    } else if (code !== null) {
      code.push(line);
    } else if (line.trim() === '') {
      flush();
    } else if (line.startsWith('- ')) {
      if (paragraph.length > 0) {
        flush();
      }
      items.push(line.slice(2));
    } else if (items.length > 0) {
      // A line that continues the previous list item.
      items[items.length - 1] += ` ${line.trim()}`;
    } else {
      paragraph.push(line.trim());
    }
  }
  flush();
  return blocks;
}

/** The first sentence of a text, without inline markup, for use as a short description. */
export function firstSentence(text: string): string {
  const plain = text.split('\n')[0]!.replace(/`/g, '');
  const end = plain.search(/\.(\s|$)/);
  return end === -1 ? plain : plain.slice(0, end + 1);
}

// --- Reference pages -----------------------------------------------------------------------------

/** The members of a type that a reference page lists under one heading. */
export interface MemberGroup {
  /**
   * The heading's anchor. It contains a hyphen, which no member name can, so the anchor of a
   * heading never clashes with that of a member such as `properties` or `constructor`.
   */
  readonly id: string;
  readonly title: string;
  readonly members: readonly ApiMember[];
}

/** A type's members under the headings a reference page shows them in. */
export function groupMembers(type: ApiType): MemberGroup[] {
  const isObject = type.kind === 'object';
  const groups: MemberGroup[] = [
    {
      id: 'section-constructor',
      title: 'Constructor',
      members: type.members.filter((member) => member.kind === 'constructor'),
    },
    {
      id: 'section-static',
      title: 'Static members',
      members: isObject ? [] : type.members.filter((member) => member.static),
    },
    {
      id: 'section-properties',
      title: 'Properties',
      members: type.members.filter(
        (member) => member.kind === 'property' && (isObject || !member.static),
      ),
    },
    {
      id: 'section-methods',
      title: 'Methods',
      members: type.members.filter(
        (member) => member.kind === 'method' && (isObject || !member.static),
      ),
    },
  ];
  return groups.filter((group) => group.members.length > 0);
}

/** Types a script never imports: the engine hands them out through `this`. */
const SERVICE_TYPES = new Set([
  'SceneApi',
  'Input',
  'Physics2D',
  'AudioApi',
  'AssetsApi',
  'StorageApi',
  'Time',
]);

/**
 * How a script gets hold of a type: the import statement, when the type is one that
 * scripts import, and the expression that reaches it from inside a script, when there is one.
 */
export function getUsage(type: ApiType): { importStatement: string | null; access: string | null } {
  const isValue = type.kind === 'class' || type.kind === 'object';
  return {
    importStatement: SERVICE_TYPES.has(type.name)
      ? null
      : `import ${isValue ? '' : 'type '}{ ${type.name} } from 'rowan';`,
    access: ACCESS_HINTS[type.name] ?? null,
  };
}

/** The entries of a page's "On this page" list. */
export function getPageOutline(page: DocPage): { id: string; title: string; level: number }[] {
  if (page.apiType) {
    return groupMembers(page.apiType).flatMap((group) => [
      { id: group.id, title: group.title, level: 1 },
      ...group.members.map((member) => ({ id: member.name, title: member.name, level: 2 })),
    ]);
  }
  return page.blocks.flatMap((block) =>
    block.kind === 'heading' ? [{ id: block.id, title: block.text, level: 1 }] : [],
  );
}

// --- Search --------------------------------------------------------------------------------------

/** One hit of a search through the documentation. */
export interface SearchResult {
  /** What was found: a page title or `Type.member`. */
  readonly title: string;
  /** Where it is and what it is about. */
  readonly description: string;
  readonly href: string;
}

interface SearchEntry extends SearchResult {
  /** The lower-case name that a search is matched against first. */
  readonly name: string;
  readonly text: string;
}

const searchEntries: readonly SearchEntry[] = DOC_PAGES.flatMap((page): SearchEntry[] => {
  const pageEntry: SearchEntry = {
    title: page.title,
    description: page.summary,
    href: formatRoute(page.id),
    name: page.title.toLowerCase(),
    text: page.summary.toLowerCase(),
  };
  if (page.apiType) {
    const type = page.apiType;
    return [
      pageEntry,
      ...type.members
        .filter((member) => member.kind !== 'constructor')
        .map((member) => ({
          title: `${type.name}.${member.name}`,
          description: firstSentence(member.summary),
          href: formatRoute(page.id, member.name),
          name: member.name.toLowerCase(),
          text: member.summary.toLowerCase(),
        })),
    ];
  }
  return [
    pageEntry,
    ...page.blocks.flatMap((block): SearchEntry[] =>
      block.kind === 'heading'
        ? [
            {
              title: block.text,
              description: page.title,
              href: formatRoute(page.id, block.id),
              name: block.text.toLowerCase(),
              text: '',
            },
          ]
        : [],
    ),
  ];
});

/**
 * Finds pages, headings and API members. Names that equal the search come first, then
 * names that start with it, names that contain it, and finally descriptions that mention it.
 */
export function searchDocs(query: string, limit = 12): SearchResult[] {
  const needle = query.trim().toLowerCase();
  if (needle === '') {
    return [];
  }
  const ranked: { entry: SearchEntry; rank: number }[] = [];
  for (const entry of searchEntries) {
    const qualified = entry.title.toLowerCase();
    let rank: number;
    if (entry.name === needle || qualified === needle) {
      rank = 0;
    } else if (entry.name.startsWith(needle) || qualified.startsWith(needle)) {
      rank = 1;
    } else if (qualified.includes(needle)) {
      rank = 2;
    } else if (entry.text.includes(needle)) {
      rank = 3;
    } else {
      continue;
    }
    ranked.push({ entry, rank });
  }
  // Array.prototype.sort is stable, so entries of equal rank stay in reading order.
  return ranked
    .sort((a, b) => a.rank - b.rank)
    .slice(0, limit)
    .map(({ entry }) => ({ title: entry.title, description: entry.description, href: entry.href }));
}
