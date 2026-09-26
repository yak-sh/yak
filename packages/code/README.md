# @yaks/code

Read a codebase into a graph, so its packages, files and exports can be
searched, linked and cited like anything else.

```sh
yak --config yak.json code sync          # read what moved since the last sync
yak --config yak.json code sync --full   # read every file again
```

A config that lists `@yaks/code` needs `@yaks/git` (the `file` a module wears),
`@yaks/edge` (the `imports` relation) and `@yaks/doc` (the searchable text)
beside it.

## What it writes

```
package{name, version, manifest}   one per deno.json with a name; id from name
module{blob, package}              one per file, wearing @yaks/git's
                                   file{path, repository}; id from the file
symbol{module, name, kind, line}   one per export; id from module + name
imports                            @yaks/edge relation: module → module
```

Each one's text is in `doc`: a package's description, a module's opening comment
(the `/** */` block or the run of `//` lines it starts with), the whole of a
markdown file, and an export's doc comment. `doc` is what full-text search and
embeddings read, so `yak search declares an identity` finds @yaks/graph's
`identities` by its doc comment.

Every id is derived from a declared identity (`identity` in the vocabulary), so
reading the same tree twice writes one set of entities. Exports are read with
`deno doc --json`; a module `deno doc` cannot resolve is still read, without its
exports, and named in the report. Imports are read from the module's own
`import … from` and `export … from` lines, resolved relative to the file or
through a workspace package's `exports`.

## Staying current

`code sync` is a read-only [@yaks/mirror](../mirror) binding over the files Git
tracks in the checkout the command runs in. Each module records the Git blob id
of the text it was read from, and a sync reads a file again only when that blob
moved. Nothing is deleted: a file or export that is gone has its components
cleared, and a later sync fills them in when the path or name comes back.
`task land` runs an incremental sync of the checkout it landed into, when the
yak config lists `@yaks/code`.

A citation of code (`cites`, [@yaks/git](../git)) points at a `symbol`, and
`cites check` asks Git which commits touched that definition since the citation
was verified.
