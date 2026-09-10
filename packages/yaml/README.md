# @yaks/yaml

Parse YAML or JSON values and split Markdown frontmatter from document text.
This package accepts strings; callers read files and decide how to validate or
apply the returned data. It has no platform API dependency.

```ts
import { front, read } from '@yaks/yaml'

let config = read('port: 8080', 'config.yml')
let page = front('---\ndoc:\n  title: Hello\n---\nBody', 'page.md')
// page.meta = { doc: { title: 'Hello' } }; page.body = 'Body'
```

## Parsing and validation

`read(text, file?)` uses the YAML parser, including for JSON input. The optional
file label appears in parse errors; it does not cause a filesystem read.

`front(text, file?)` recognizes a `---` block only at the start of the string.
Without a complete block it returns empty metadata and the original text.
Empty/null frontmatter becomes `{}`; arrays and scalar metadata are rejected.
The body after the closing delimiter is preserved, including blank lines.

Metadata is typed as a partial graph bundle, for example
`{entity: {eid: '$page'}, doc: {title: 'Hello'}}`. The parser checks that it is
an object, not that components or columns match a vocabulary. The caller owns
schema validation, entity identity and alias resolution. References are not
resolved as file paths, and parsing does not write to a graph.

Run `deno test packages/yaml/` from the repository root to check parsing and
frontmatter boundaries.
