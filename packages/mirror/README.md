# @yaks/mirror

Sync files and a graph. A mirror is a list of bindings; each binding names the
files it covers and carries either direction or both:

- `read(paths, gone)`: files → graph, for the paths whose file moved.
- `values()`: graph → files, the text the graph says each path should hold.

Code is read-only (the files own it, see [@yaks/code](../code)), a generated
persona file is write-only (the graph owns it), and a markdown document may go
both ways.

```ts
import { type Binding, blobOf, memo, sync } from '@yaks/mirror'

let personas: Binding = {
  name: 'personas',
  files: async () => new Map([['AGENTS.md', await blobOf('old\n')]]),
  values: () => Promise.resolve(new Map([['AGENTS.md', 'new\n']])),
  ...memo('/tmp/mirror.json'),
}
let report = await sync(personas)
// report.wrote = ['AGENTS.md']
```

## Agreement and conflicts

Each path remembers the pair it last agreed on: the file's Git blob id and the
hash of the graph's value (for a written file, the blob id of the text it
rendered). `decide()` compares both sides with that memory:

| file moved | graph moved | read-only | write-only | both ways |
| ---------- | ----------- | --------- | ---------- | --------- |
| no         | no          | same      | same       | same      |
| yes        | no          | read      | write back | read      |
| no         | yes         | —         | write      | write     |
| yes        | yes         | read      | conflict   | conflict  |

A conflict is reported and neither side is touched. Where the graph owns the
file, deleting the file resolves it: a missing file is always written. A
read-only binding's memory is whatever the graph recorded when it read the file
(@yaks/code keeps the blob on each module); `memo(path)` keeps it in a JSON file
for a binding whose graph side cannot hold it.

`plan(binding)` returns every decision without acting, which is what a `--check`
reports. Writes go through a temporary file and a rename, so a reader never sees
a half-written file, and a file whose contents already match is not rewritten.
