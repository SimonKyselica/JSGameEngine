import {
  Fragment,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactElement,
} from 'react';
import type { ApiMember, ApiType } from './apiTypes';
import {
  API_REFERENCE,
  DOC_PAGES,
  DOC_SECTIONS,
  formatRoute,
  getAdjacentPages,
  getPageOutline,
  getUsage,
  groupMembers,
  linkSignature,
  parseDocText,
  parseInline,
  parseRoute,
  searchDocs,
  type DocPage,
} from './docsModel';
import type { DocBlock } from './docTypes';
import { highlightTypeScript } from './highlight';

function subscribeToHash(listener: () => void): () => void {
  window.addEventListener('hashchange', listener);
  return () => window.removeEventListener('hashchange', listener);
}

/** The scripting documentation: navigation on the left, a page in the middle, its outline on the right. */
export function DocsApp(): ReactElement {
  const hash = useSyncExternalStore(subscribeToHash, () => window.location.hash);
  const { page, anchor } = useMemo(() => parseRoute(hash), [hash]);
  const contentRef = useRef<HTMLElement>(null);

  useEffect(() => {
    document.title = `${page.title} · Rowan Scripting`;
    // Looked up inside the page content only: an anchor is a heading or a member name, and a
    // member may be called the same as an element elsewhere on the page.
    const target = anchor
      ? contentRef.current?.querySelector(`[id="${CSS.escape(anchor)}"]`)
      : null;
    if (target) {
      target.scrollIntoView({ block: 'start' });
    } else {
      window.scrollTo(0, 0);
    }
  }, [page, anchor]);

  return (
    <div className="docs">
      <header className="docs-header">
        <a className="docs-logo" href={formatRoute(DOC_PAGES[0]!.id)}>
          Rowan <span>Scripting</span>
        </a>
        <span className="docs-version">v{API_REFERENCE.engineVersion}</span>
        <Search />
      </header>
      <div className="docs-body">
        <Sidebar current={page} />
        <main ref={contentRef} className="docs-content">
          <article>
            {page.apiType ? (
              <ReferencePage page={page} type={page.apiType} />
            ) : (
              <GuidePage page={page} />
            )}
          </article>
          <Pager page={page} />
        </main>
        <Outline page={page} anchor={anchor} />
      </div>
    </div>
  );
}

// --- Navigation ----------------------------------------------------------------------------------

function Sidebar({ current }: { current: DocPage }): ReactElement {
  const navRef = useRef<HTMLElement>(null);

  // The list is longer than the window, so a page reached by a link or a search may be out of sight.
  useEffect(() => {
    navRef.current?.querySelector('[aria-current="page"]')?.scrollIntoView({ block: 'nearest' });
  }, [current]);

  return (
    <nav ref={navRef} className="docs-sidebar" aria-label="Documentation">
      {DOC_SECTIONS.map((section, index) => (
        <Fragment key={section.title}>
          {index === 1 && <div className="docs-sidebar-divider">API reference</div>}
          <section>
            <h2>{section.title}</h2>
            <ul>
              {section.pages.map((page) => (
                <li key={page.id}>
                  <a
                    href={formatRoute(page.id)}
                    className={page.apiType ? 'docs-nav-api' : undefined}
                    aria-current={page === current ? 'page' : undefined}
                  >
                    {page.title}
                  </a>
                </li>
              ))}
            </ul>
          </section>
        </Fragment>
      ))}
    </nav>
  );
}

function Outline({ page, anchor }: { page: DocPage; anchor: string | null }): ReactElement | null {
  const outline = getPageOutline(page);
  if (outline.length === 0) {
    return null;
  }
  return (
    <nav className="docs-outline" aria-label="On this page">
      <h2>On this page</h2>
      <ul>
        {outline.map((entry) => (
          <li
            key={`${entry.level}:${entry.id}`}
            className={entry.level === 2 ? 'nested' : undefined}
          >
            <a
              href={formatRoute(page.id, entry.id)}
              aria-current={entry.id === anchor ? 'location' : undefined}
            >
              {entry.title}
            </a>
          </li>
        ))}
      </ul>
    </nav>
  );
}

function Pager({ page }: { page: DocPage }): ReactElement {
  const { previous, next } = getAdjacentPages(page.id);
  return (
    <nav className="docs-pager" aria-label="Previous and next page">
      {previous ? (
        <a href={formatRoute(previous.id)} rel="prev">
          <small>Previous</small>
          {previous.title}
        </a>
      ) : (
        <span />
      )}
      {next && (
        <a href={formatRoute(next.id)} rel="next" className="next">
          <small>Next</small>
          {next.title}
        </a>
      )}
    </nav>
  );
}

function searchOptionId(index: number): string {
  return `docs-search-result-${index}`;
}

function Search(): ReactElement {
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const [focused, setFocused] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const results = useMemo(() => searchDocs(query), [query]);
  const open = focused && query.trim() !== '';

  // Like most documentation sites, "/" jumps to the search field.
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent): void => {
      const typing = event.target instanceof HTMLInputElement;
      if (event.key === '/' && !typing && !event.ctrlKey && !event.metaKey) {
        event.preventDefault();
        inputRef.current?.focus();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  // The list scrolls, so the arrow keys can move the active result past its edge.
  useEffect(() => {
    listRef.current?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest' });
  }, [active]);

  const go = (href: string): void => {
    window.location.hash = href;
    setQuery('');
    inputRef.current?.blur();
  };

  return (
    <div className="docs-search">
      <input
        ref={inputRef}
        type="search"
        role="combobox"
        aria-label="Search the documentation"
        aria-expanded={open}
        aria-controls="docs-search-results"
        aria-activedescendant={open && results[active] ? searchOptionId(active) : undefined}
        aria-autocomplete="list"
        placeholder="Search…  ( / )"
        value={query}
        spellCheck={false}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        onChange={(event) => {
          setQuery(event.currentTarget.value);
          setActive(0);
        }}
        onKeyDown={(event) => {
          if (event.key === 'ArrowDown') {
            event.preventDefault();
            setActive((index) => Math.min(index + 1, results.length - 1));
          } else if (event.key === 'ArrowUp') {
            event.preventDefault();
            setActive((index) => Math.max(index - 1, 0));
          } else if (event.key === 'Enter' && results[active]) {
            go(results[active].href);
          } else if (event.key === 'Escape') {
            setQuery('');
          }
        }}
      />
      {open && (
        <ul
          ref={listRef}
          id="docs-search-results"
          className="docs-search-results"
          role="listbox"
          aria-label="Search results"
        >
          {results.length === 0 && <li className="empty">Nothing matches “{query.trim()}”.</li>}
          {results.map((result, index) => (
            <li
              key={result.href}
              id={searchOptionId(index)}
              role="option"
              aria-selected={index === active}
              className={index === active ? 'active' : undefined}
              // Pressing, not clicking: the field must not lose focus and close the list first.
              onPointerDown={(event) => {
                event.preventDefault();
                go(result.href);
              }}
              onPointerEnter={() => setActive(index)}
            >
              <strong>{result.title}</strong>
              <span>{result.description}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// --- Pages -----------------------------------------------------------------------------------------

function GuidePage({ page }: { page: DocPage }): ReactElement {
  return (
    <>
      <h1>{page.title}</h1>
      <p className="docs-lead">
        <Inline text={page.summary} />
      </p>
      <Blocks blocks={page.blocks} pageId={page.id} />
    </>
  );
}

function ReferencePage({ page, type }: { page: DocPage; type: ApiType }): ReactElement {
  const usage = getUsage(type);
  // The opening paragraph introduces the type; anything after it is ordinary page content.
  const [lead, ...details] = parseDocText(type.summary);
  return (
    <>
      <h1>
        {type.name} <span className="docs-kind">{type.kind}</span>
      </h1>
      {lead && (
        <div className="docs-lead">
          <Blocks blocks={[lead]} pageId={page.id} />
        </div>
      )}
      <Blocks blocks={details} pageId={page.id} />
      {type.kind === 'type' && (
        <Signature
          text={`type ${type.name}${type.typeParameters} = ${type.definition}`}
          typeName={type.name}
        />
      )}
      <dl className="docs-usage">
        {usage.access && (
          <>
            <dt>In a script</dt>
            <dd>
              <code>{usage.access}</code>
            </dd>
          </>
        )}
        {usage.importStatement && (
          <>
            <dt>Import</dt>
            <dd>
              <code>{usage.importStatement}</code>
            </dd>
          </>
        )}
      </dl>

      {groupMembers(type).map((group) => (
        <section key={group.title}>
          <Heading id={group.id} pageId={page.id} text={group.title} />
          {group.members.map((member) => (
            <Member key={member.name} member={member} pageId={page.id} typeName={type.name} />
          ))}
        </section>
      ))}
    </>
  );
}

interface MemberProps {
  readonly member: ApiMember;
  readonly pageId: string;
  readonly typeName: string;
}

function Member({ member, pageId, typeName }: MemberProps): ReactElement {
  // A static member is written `Vec2.zero()`; an instance member just by its name.
  const prefix = member.static ? `${typeName}.` : '';
  return (
    <section className="docs-member" id={member.name}>
      <h3>
        <a href={formatRoute(pageId, member.name)}>{member.name}</a>
        {member.static && <span className="docs-badge">static</span>}
        {member.readonly && <span className="docs-badge">read-only</span>}
      </h3>
      {member.signatures.map((signature) => (
        <Signature
          key={signature}
          text={member.kind === 'constructor' ? signature : prefix + signature}
          typeName={typeName}
        />
      ))}
      <Blocks blocks={parseDocText(member.summary)} pageId={pageId} />
    </section>
  );
}

// --- Content blocks ----------------------------------------------------------------------------------

function Blocks({ blocks, pageId }: { blocks: readonly DocBlock[]; pageId: string }): ReactElement {
  return (
    <>
      {blocks.map((block, index) => {
        switch (block.kind) {
          case 'paragraph':
            return (
              <p key={index}>
                <Inline text={block.text} />
              </p>
            );
          case 'heading':
            return <Heading key={index} id={block.id} pageId={pageId} text={block.text} />;
          case 'code':
            return <CodeBlock key={index} code={block.code} />;
          case 'list': {
            const items = block.items.map((item, itemIndex) => (
              <li key={itemIndex}>
                <Inline text={item} />
              </li>
            ));
            return block.ordered ? <ol key={index}>{items}</ol> : <ul key={index}>{items}</ul>;
          }
          case 'note':
            return (
              <aside key={index} className="docs-note" role="note">
                <Inline text={block.text} />
              </aside>
            );
          case 'table':
            return (
              <div key={index} className="docs-table">
                <table>
                  <thead>
                    <tr>
                      {block.head.map((cell) => (
                        <th key={cell}>{cell}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {block.rows.map((row, rowIndex) => (
                      <tr key={rowIndex}>
                        {row.map((cell, cellIndex) => (
                          <td key={cellIndex}>
                            <Inline text={cell} />
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            );
        }
      })}
    </>
  );
}

function Heading({ id, pageId, text }: { id: string; pageId: string; text: string }): ReactElement {
  return (
    <h2 id={id}>
      <a href={formatRoute(pageId, id)}>{text}</a>
    </h2>
  );
}

function Inline({ text }: { text: string }): ReactElement {
  return (
    <>
      {parseInline(text).map((node, index) => {
        switch (node.kind) {
          case 'text':
            return <Fragment key={index}>{node.text}</Fragment>;
          case 'bold':
            return <strong key={index}>{node.text}</strong>;
          case 'code':
            return node.href ? (
              <a key={index} href={node.href} className="docs-code-link">
                <code>{node.text}</code>
              </a>
            ) : (
              <code key={index}>{node.text}</code>
            );
          case 'link':
            return (
              <a key={index} href={node.href}>
                {node.text}
              </a>
            );
        }
      })}
    </>
  );
}

function Signature({ text, typeName }: { text: string; typeName: string }): ReactElement {
  return (
    <pre className="docs-signature">
      <code>
        {linkSignature(text, typeName).map((part, index) =>
          part.href ? (
            <a key={index} href={part.href}>
              {part.text}
            </a>
          ) : (
            <Fragment key={index}>{part.text}</Fragment>
          ),
        )}
      </code>
    </pre>
  );
}

/** How long the Copy button says "Copied" before it offers to copy again. */
const COPIED_NOTICE_MS = 1500;

function CodeBlock({ code }: { code: string }): ReactElement {
  const [copied, setCopied] = useState(false);
  const tokens = useMemo(() => highlightTypeScript(code), [code]);

  useEffect(() => {
    if (!copied) {
      return;
    }
    const timer = window.setTimeout(() => setCopied(false), COPIED_NOTICE_MS);
    return () => window.clearTimeout(timer);
  }, [copied]);

  return (
    <div className="docs-code">
      <button
        type="button"
        className="docs-copy"
        onClick={() => {
          // Copying needs a secure page and permission; without them the button does nothing.
          void navigator.clipboard?.writeText(code).then(
            () => setCopied(true),
            () => setCopied(false),
          );
        }}
      >
        {copied ? 'Copied' : 'Copy'}
      </button>
      <pre>
        <code>
          {tokens.map((token, index) =>
            token.className ? (
              <span key={index} className={token.className}>
                {token.text}
              </span>
            ) : (
              <Fragment key={index}>{token.text}</Fragment>
            ),
          )}
        </code>
      </pre>
    </div>
  );
}
