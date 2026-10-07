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
start-up effect (`start: true`, ./described.ts), owed each time a process starts
working the effects. It is the composed vocabulary, not the files: a package the
checkout holds and the config does not list is not described. The graph's
`_vocab` holds the hash of the rows as last described, so a graph already
describing it is checked by that hash and written nothing; otherwise only the
difference is written. The `_package` carries its name and the description its
deno.json gives it (@yaks/cli `compose` writes it on each document), and each
row points at the `_package` that declares it, so
`._prop.package._package.name=@yaks/id` lists every property @yaks/id declares,
on its own components and on the ones it extends. A row the served vocabulary
stops declaring is cleared like a gone export.

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

## Resolving runtime places

`@yaks/code/frames` exports `resolveFrames(catalog, repository, blobs, places)`:
a catalog with `get(eids)`, the repository eid, a path-to-blob map from the
failing commit, and `{path, function, line}` places. It returns
`{app, module,
symbol}` only for catalog records whose file identity and blob
agree. A symbol must name an exported definition of that same module, not an
inferred class member or anonymous function. Unknown or stale records leave
their eids absent.

`@yaks/code/source` supplies the box boundary:
`sourceFrames({cwd, url,
origins})` reads regular-file blobs from Git at the
reported commit and reads only requested records from the catalog's HTTP query
door. File URLs must be under that repository's known checkout roots; browser
module URLs must use an explicitly served origin. It reads no source path chosen
by a frame, follows no symlink blob, and never substitutes HEAD for an unknown
commit. Bundle URLs have no source module mapping without source maps and remain
unresolved. A resolver keeps what it read: the checkout once, each commit's
blobs per path, and the worktree roots until a file frame falls under none of
them (read again at most every five seconds), so a run starts no Git process
once its commit is known. Its catalog by default is `remembered(catalog)`, which
keeps each answer a minute and shares a request among callers asking at once.

Deno doc's zero-based locations become one-based `symbol.line` at ingestion.

A host that composes another runtime can reuse `described(graph, docs)` from
`@yaks/code/effects`: it returns the schema patches and final hash without
applying them. The host can commit them in bounded batches; writing the hash
last makes an interrupted description retryable.
