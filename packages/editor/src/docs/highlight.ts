import { typescriptLanguage } from '@codemirror/lang-javascript';
import { classHighlighter, highlightTree } from '@lezer/highlight';

/** A run of code with the CSS classes that color it, or `null` for plain text. */
export interface CodeToken {
  readonly text: string;
  readonly className: string | null;
}

/**
 * Splits TypeScript source into colored tokens, using the same parser as the script
 * editor. The classes are the `tok-*` names of `@lezer/highlight`, for example
 * `tok-keyword` and `tok-string`. Joining the token texts gives back the source exactly.
 */
export function highlightTypeScript(code: string): CodeToken[] {
  const tokens: CodeToken[] = [];
  let position = 0;
  highlightTree(typescriptLanguage.parser.parse(code), classHighlighter, (from, to, classes) => {
    if (from > position) {
      tokens.push({ text: code.slice(position, from), className: null });
    }
    tokens.push({ text: code.slice(from, to), className: classes });
    position = to;
  });
  if (position < code.length) {
    tokens.push({ text: code.slice(position), className: null });
  }
  return tokens;
}
