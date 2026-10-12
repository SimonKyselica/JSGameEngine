export interface PlayerHtmlOptions {
  readonly title: string;
  /** Background shown around the game when the window has a different aspect ratio. */
  readonly backgroundColor?: string;
  /**
   * When set, the player, the compiled scripts and the game data are embedded in the
   * page, which then works without a web server. Otherwise the page loads
   * `rowan-player.js`, `game/scripts.js` and `game/game.json` from next to it.
   */
  readonly inline?: {
    readonly playerSource: string;
    readonly scriptBundle: string;
    readonly bundle: unknown;
  };
}

/** Builds the HTML page of an exported game. */
export function createPlayerHtml(options: PlayerHtmlOptions): string {
  const background = sanitizeColor(options.backgroundColor ?? '#000000');
  const inline = options.inline;
  const scripts = inline
    ? [
        `<script>${escapeInlineScript(inline.scriptBundle)}</script>`,
        `<script>${escapeInlineScript(inline.playerSource)}</script>`,
        `<script>${createBootScript(serializeForScript(inline.bundle))}</script>`,
      ]
    : [
        '<script src="game/scripts.js"></script>',
        '<script src="rowan-player.js"></script>',
        `<script>${createBootScript('"game/game.json"')}</script>`,
      ];

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${escapeHtml(options.title)}</title>
    <style>
      html, body { margin: 0; height: 100%; overflow: hidden; background: ${background}; }
      #rowan-game { position: fixed; inset: 0; }
      canvas:focus { outline: none; }
    </style>
  </head>
  <body>
    <div id="rowan-game"></div>
    ${scripts.join('\n    ')}
  </body>
</html>
`;
}

function createBootScript(bundleExpression: string): string {
  return (
    `RowanPlayer.boot({ container: document.getElementById("rowan-game"), ` +
    `bundle: ${bundleExpression} }).catch(function (error) { console.error(error); });`
  );
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * Serializes data as a JavaScript expression that is safe inside a `<script>` element:
 * no sequence in it can end the element or start an HTML comment.
 */
function serializeForScript(data: unknown): string {
  return JSON.stringify(data)
    .replace(/</g, '\\u003c')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');
}

/** Keeps JavaScript source from closing the `<script>` element it is embedded in. */
function escapeInlineScript(source: string): string {
  return source.replace(/<\/(script)/gi, '<\\/$1').replace(/<!--/g, '<\\!--');
}

/** Only plain hex colors are allowed into the page's style sheet. */
function sanitizeColor(color: string): string {
  return /^#[0-9a-f]{3,8}$/i.test(color) ? color : '#000000';
}
