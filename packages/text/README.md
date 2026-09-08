# @yaks/text

Markdown and plain text from the same renderer trees used by `@yaks/preact`. The
host imports no DOM or framework. `h` records elements; `markdown` and `plain`
serialize them:

```ts
import { h, markdown, plain } from '@yaks/text'

let node = h(
  'p',
  null,
  'Open ',
  h('a', { href: 'https://yaks.app' }, 'yaks.app'),
)
markdown(node) // 'Open [yaks\\.app](https://yaks.app)'
plain(node) // 'Open yaks.app (https://yaks.app)'
```

Or use `render(registry, bundle, view, vocab, ctx?, mode?)` with a registry from
`@yaks/render`. The first five arguments match the Preact host. Mode defaults to
`'markdown'`; pass `'plain'` for undecorated text. Context includes
`{comp, col}` for column selection and `ctx.render(view, overrides?)` for
composing nested views through the same registry. The host always supplies
`readOnly: true`, including for nested views, so portable editors display their
values. An unmatched view produces an empty string.

| Elements                                                              | Markdown                                 | Plain text            |
| --------------------------------------------------------------------- | ---------------------------------------- | --------------------- |
| `h1`–`h6`                                                             | Heading markers                          | Heading words         |
| `p`, `div`, `section`, `article`, `main`, `header`, `footer`, `aside` | Block spacing                            | Block spacing         |
| `ul`, `ol`, `li`                                                      | Bullets/numbering and nested indentation | Same list structure   |
| `dl`, `dt`, `dd`                                                      | One `term: value` line per property      | Same property lines   |
| `a`                                                                   | Link syntax                              | Label and destination |
| `code`                                                                | Backtick span                            | Literal code          |
| `pre`                                                                 | Fenced code                              | Literal code          |
| `strong`, `b`, `em`, `i`                                              | Emphasis markers                         | Words                 |
| `br`                                                                  | Hard line break                          | Line break            |
| `span` and unknown tags                                               | Children                                 | Children              |

Arrays flatten, numbers become words, and null/undefined/booleans are empty.
Inline siblings preserve the spaces their renderer supplies. Output has no added
trailing newline. Literal Markdown punctuation is escaped; code chooses a
delimiter longer than any backtick run in its content. Ordered lists honor an
integer `start` value. Plain links omit a duplicate destination when the label
already equals the URL. Event handlers and other host props are ignored.

Markdown uses empty HTML comments between adjacent emphasis/code elements or
independent lists so their delimiters do not merge. Nested emphasis uses inline
HTML to retain its precise nesting. Both are standard Markdown syntax; consumers
that remove HTML may lose those distinctions.

## Content boundary

Every text node and href loses the entire C0/DEL/C1 class before formatting.
This lifts the control class from `src/terminal.ts` but deliberately retains
none of its text exceptions: FTS markers, tabs and literal newlines disappear.
Use `br` or block/list elements to express line breaks, including inside `pre`.
Only the host emits formatting newlines. Code and unknown wrappers cross the
same boundary. Links also encode characters that would break Markdown's
destination syntax; this package does not impose a URL scheme policy.

## Compatibility

Deno, Node, browsers and workers. Runtime dependencies are `@yaks/render` and
its portable matcher/vocabulary dependencies. Preact, LinkeDOM and the Markdown
parser are used only in tests.

## Verification

`deno test --doc packages/text/mod.ts packages/text/tree.ts` runs an example for
every element kind. `deno test packages/text/` covers the control ranges and
formatting edges, plus one fixture renderer mounted through Preact and emitted
as Markdown, comparing the resulting document structure and words.
