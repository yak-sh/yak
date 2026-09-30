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

Where the config also lists `@yaks/vocab`, the vocabulary the graph is served
with is described in it as
[@yaks/vocab](../vocab/README.md#a-vocabulary-as-entities)'s `_package`,
`_comp`, `_extends`, `_prop` and `_before` entities, by the `vocab_describe`
effect every process starting owes (`created: ["process"]`, ./described.ts). It
is the composed vocabulary, not the files: a package the checkout holds and the
config does not list is not described. The graph's `_vocab` holds the hash of
the rows as last described, so a graph already describing it is checked by that
hash and written nothing; otherwise only the difference is written. The
`_package` carries its name and its manifest's description (from `package`, as
the codebase was last read), and each row points at the `_package` that declares
it, so `._prop.package._package.name=@yaks/id` lists every property @yaks/id
declares, on its own components and on the ones it extends. A row the served
vocabulary stops declaring is cleared like a gone export.

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
Nothing runs a sync on its own: `yak code sync` reads what moved since the last
one.

A citation of code (`cites`, [@yaks/git](../git)) points at a `symbol`, and
`cites check` asks Git which commits touched that definition since the citation
was verified.
