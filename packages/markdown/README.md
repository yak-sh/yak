# @yaks/markdown

GFM Markdown as structural nodes, shared by Preact in a browser and the
terminal. Uses Marked 18.0.6 for parsing and never generates HTML strings.

```ts
import { h } from 'preact'
import { Bold, Heading, Markdown } from '@yaks/markdown'

h(Markdown, { source: '# Hello\n\n**Shared** rendering.' })
h(Heading, { level: 2 }, h(Bold, null, 'Hello'))
```

`parse(source)` returns the Markdown tokens. `render(tokens, h)` targets the
portable `@yaks/render` element vocabulary; `Markdown` supplies Preact's `h`.
`Bold`, `Italic`, `Heading`, `Code`, `CodeBlock`, and `Link` are ordinary
semantic Preact components. ANSI is exclusively the terminal painter's
responsibility.

Includes headings, emphasis, strike, inline/fenced code, links, lists/task
lists, quotes, rules, tables, and explicit/soft line breaks. HTML is literal
text; unsafe URL schemes are omitted; images become alt-text links rather than
remote loads. The harness applies Markdown to message prose through
query-matched transcript renderers. Tool calls/results stay literal (results
stay dim).

The terminal lays out tables with aligned columns, wrapping, and subtle borders.
Narrow tables switch to stacked header/value records. Markdown column alignment
is preserved in the shared semantic cells. Code is styled but not syntax
highlighted. Graph-entity linkification and repository-specific commit links are
not provided. Applications can add those behaviors separately. Rendering does
not fetch images or other remote content.

Run `deno test packages/markdown/` from the repository root for parser,
structural rendering and URL-safety tests.
