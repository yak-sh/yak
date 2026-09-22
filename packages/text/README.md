# @yaks/text

Serializes element trees as Markdown or plain text. It implements the same
rendering interface as `@yaks/preact`, but imports no DOM or UI framework and
stores no data. The exported `h` function creates element objects; `markdown`
and `plain` serialize them:

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

To render a graph record, call
`render(registry, bundle, view, vocab, ctx?, mode?)`. A bundle is one entity's
components as a JSON object; the vocabulary describes those components. Use a
registry (named view functions with matching predicates) from `@yaks/render`.
The first five arguments are the same as the Preact renderer's. Mode defaults to
`'markdown'`; pass `'plain'` for undecorated text. Context includes
`{comp, col}` for column selection and `ctx.render(view, overrides?)` for
composing nested views through the same registry. This renderer always passes
`readOnly: true`, including to nested views, so that portable editors display
their values. An unmatched view produces an empty string.

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
already equals the URL. Event handlers and other props meant for a live DOM are
ignored.

Markdown uses empty HTML comments between adjacent emphasis/code elements or
independent lists so their delimiters do not merge. Nested emphasis uses inline
HTML to retain its precise nesting. Both are standard Markdown syntax; consumers
that remove HTML may lose those distinctions.

The root also exports `Node` and `Mode` types, plus `safe` and `safeHref` for
the same control-character removal and destination escaping used internally.

## Content boundary

Every text node and href loses the entire C0/DEL/C1 class before formatting.
Tabs, literal newlines and control-based search-highlight markers are removed.
Use `br` or block/list elements to express line breaks, including inside `pre`.
Only this renderer emits formatting newlines. Code and unknown wrapper elements
cross the same boundary. Links also encode characters that would break
Markdown's destination syntax; this package does not impose a URL scheme policy.

## Compatibility

Deno, Node, browsers and workers. Runtime dependencies are `@yaks/render` and
its portable matcher/vocabulary dependencies. Preact, LinkeDOM and the Markdown
parser are used only in tests.

## Verification

`deno test --doc packages/text/mod.ts packages/text/tree.ts` runs an example for
every element kind. `deno test packages/text/` covers the control ranges and
formatting edges, plus one fixture renderer mounted through Preact and emitted
as Markdown, comparing the resulting document structure and words.
