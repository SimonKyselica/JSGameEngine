/**
 * The building blocks of a documentation page.
 *
 * Text in blocks may contain three kinds of inline markup: `` `code` ``, `**bold**` and
 * `[label](target)`, where the target is a page such as `guide/physics` or `api/Vec2`,
 * optionally followed by `/member`.
 */
export type DocBlock =
  | { readonly kind: 'paragraph'; readonly text: string }
  | { readonly kind: 'heading'; readonly text: string; readonly id: string }
  | { readonly kind: 'code'; readonly code: string }
  | { readonly kind: 'list'; readonly ordered: boolean; readonly items: readonly string[] }
  | { readonly kind: 'note'; readonly text: string }
  | {
      readonly kind: 'table';
      readonly head: readonly string[];
      readonly rows: readonly (readonly string[])[];
    };

/** A hand-written page of the guide. */
export interface GuidePage {
  /** The last part of the page's address: `physics` for `#/guide/physics`. */
  readonly id: string;
  readonly title: string;
  /** One or two sentences shown under the title and in search results. */
  readonly summary: string;
  readonly blocks: readonly DocBlock[];
}

/** Turns a heading into the id used to link to it: "Order within a frame" → "order-within-a-frame". */
export function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}
