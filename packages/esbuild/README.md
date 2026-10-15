# @yaks/esbuild

Compiles a web app's TypeScript, npm and platform toolkit imports with esbuild,
at deploy: the server source (a Worker module) and each
`<script type="module" src>` a page loads. An app that needs neither plans
nothing and deploys as it is written.

Two halves, because compiling needs a process of its own (native esbuild) and
deciding does not:

- **`.`** decides, anywhere, a Worker included: which files an app's code
  reaches, and what must be compiled. It holds no compiler.
- **`./compile`** compiles, wherever a process can be started: it installs npm
  packages from the registry and builds each entry with native esbuild. It is
  handed every file it reads and holds no binding and no secret.

An **ask** (`Ask`) is what a compile is handed: the text of every file it reads,
and the entries to build. An **answer** (`Answer`) is what it returns: one
module per entry, the lock, and any errors, each a line an agent can act on.

## The verbs

- `plan({paths, read, main, flags})` returns `{ask, notes, inputs, reads}`, or
  `null` when nothing needs compiling. `main` is the server source, if the app
  has one; `flags` its compatibility flags. It throws `Unplanned` with a
  sentence the author can act on, such as a `package.json` that is not JSON. Its
  `inputs` name each compiled entry's source paths, so a host can reuse
  unchanged output across deploys. `reads` names every source examined to form
  the plan, including plain scripts and HTML. A host with an immutable file
  manifest can reuse the plan when its paths and the digests of these files are
  unchanged.
- `modules(read, entry)` and `sources(read, entry)` walk the module graph from
  one file: `modules` as the runtime links (a specifier names a file exactly),
  `sources` as esbuild resolves (extensions, `index` files, the `.ts` twin of a
  `.js` import). Each returns the files reached, the packages named, and each
  Web Worker a file starts (`new Worker(new URL('./grow.ts', import.meta.url))`)
  as that file and the specifier: an entry of its own, not walked. Both parse:
  an import in a comment or a string names nothing, and `import type` is gone
  with the types.
- `loaded(page, html)` is the module scripts a page loads, and `mapped(html)`
  what its import maps name.
- `dependencies(text)` reads `package.json`'s `dependencies`.
- `compile(ask, catalog, origin)`, from `./compile`, builds what an ask names
  and answers. It never throws for the app's own mistakes, which are the
  answer's `errors`.

## The compile

```ts
import { equal } from '@yaks/testing'
import { compile } from '@yaks/esbuild/compile'

let answer = await compile({
  files: {
    'main.ts': "import { twice } from './twice'\n" +
      'export let n: number = twice(21)',
    'twice.ts': 'export let twice = (n: number) => n * 2',
  },
  pages: ['main.ts'],
})
equal(answer.errors, [])
let page = await import(
  `data:text/javascript,${encodeURIComponent(answer.pages['main.ts'])}`
)
equal(page.n, 42)
```

esbuild runs as a process beside the compile's own, started by the first build
and kept for the next. Every build reads from the ask's files and the installed
packages, never the disk. The same ask, catalog, npm pins and shared-module
origin compile to the same bytes on any host.

The module's default export is a server's `fetch`, for `deno serve`. A host
posts it a **job** (`Job`): `{ask, catalog, origin?, shared?}`, the app's ask
and the host's toolkit catalog (below). The server responds with the answer as
JSON, or with 507 when esbuild's process ended under the build. That is the
compiler running out of memory, not a mistake in the app's code, so `compile`
throws `Stopped` instead of answering, and the next build starts esbuild again.
yaks.app runs this server in a container of its own, behind a Worker that adds
the catalog to each ask.

A host opts into shared browser modules with `shared: true` once it can store
and serve `Answer.shared`. Jobs omitting this flag return fully bundled pages
and app-local resources, so a compiler rollout keeps answering older hosts.
Direct `compile` calls enable sharing by default; the fourth argument
`{shared: false}` selects fully bundled pages, and its `get` replaces `fetch`
for reaching the npm registry.

## Platform toolkit sources

An app declares toolkit dependencies in `package.json` with the compiler-owned
version, not a registry version:

```json
{ "dependencies": { "@yaks/client": "platform", "preact": "^10" } }
```

`compile(ask, catalog = {}, origin = 'https://yaks.app')` accepts the catalog
and shared-module origin from its host wrapper. The app sends only its `Ask`; it
cannot supply a catalog. Existing npm-only callers need no second argument. A
toolkit dependency requires that its compiler has the package and rejects any
version other than `"platform"`, never fetching a stale `@yaks/*` registry
release.

`platform.ts` exports `Catalog`, a map from package name to
`{files, resources, dependencies, version}`. `files` are npm-shaped paths
relative to the package root, including `package.json` with its exports. The
host's generator normalizes source imports and includes runtime dependencies,
not test imports or unrelated server exports. `dependencies` maps toolkit
packages to `"platform"` and external npm packages to their ranges. `version` is
`sha256:<64 lowercase hex digits>` over the generated package's source bytes.

The pure `seed(files, catalog)` returns
`{files, assets, dependencies, platform}`: app files plus the declared toolkit
roots and their package-level dependency closure under `node_modules/`, npm
roots including every reached toolkit external, and toolkit names mapped to
exact source digests. Unused catalog entries stay out. External ranges from
multiple consumers must overlap because the installer is flat. Toolkit externals
are explicit npm roots because the installer keeps a preseeded package as it is,
without installing its dependencies or reporting it as installed.

`resources` holds runtime text files by package-relative path. The generator
reads a browser package's `browser.json` resource globs (for example,
`"resources": ["**/*.css"]`); their bytes contribute to the catalog digest.
`seed` and `Answer.assets` place them under `__packages/<package>/<path>` for
server builds. The compiler rewrites parsed server package `import.meta.url`
references to the original package module's absolute logical location, such as
`file:///__packages/@yaks/ui/Button.tsx`. Hosts retain these assets beside
compiled output. Comments, strings and the app's own module URLs are unchanged.

A page imports toolkit packages, Preact and Preact Signals as **shared
modules**: browser modules compiled separately from the app's entry. An npm
package is a shared module too when more than one of a page's **consumers**
imports it, directly or through npm packages bundled into it: the page scripts
are one consumer, and each toolkit package and each shared npm package is
another. A page and a toolkit package that both import `three` load one `three`.
A package only one consumer imports stays bundled into it, where esbuild keeps
only what it uses. So does one an ES module URL cannot stand in for: something
`require`s it, or an import of it names a CommonJS or non-script file. A toolkit
package's or Preact's concrete browser exports are the entries of its splitting
build, each keeping all it exports, so every app loads the same module. A shared
npm package's entries are the specifiers of it that anything imports, each
carrying only the exports of it the page's consumers use, so the one instance
costs what one bundled copy of their union would, and each package's subpaths
share it. esbuild decides what is used, as it does for a bundled copy: a
namespace read by property names uses those exports, and one passed along or
read by computed keys uses every export. Packages with cyclic dependencies share
one build. Dependency groups import one another through absolute URLs on
`origin`. A group's URL names its emitted bytes, so two apps with the same
sources, npm pins, imported specifiers and used exports reuse the same modules,
and another pinned version is another module. Preact's main, hooks, compat and
JSX exports share one instance; Signals and its core import that same Preact
instance. Preact server-rendering adapters need an optional renderer peer and
are refused as shared browser imports.

`Answer.shared` maps `__packages/<sha256>/<path>` to emitted modules and runtime
resources. Each group's `modules.json` records its exported specifiers, keeping
distinct packages' module state distinct even when their JavaScript is
identical. The SHA256 names the complete group's emitted bytes and resource
bytes, including its dependency URLs. Hosts store these files once, serve them
with `Cache-Control: public, max-age=31536000, immutable`, and keep them
available for retained versions and published releases. A package source's
`import.meta.url` resolves inside its group's
`resources/<package>/<original-path>` namespace, so
`new URL('./Button.css', import.meta.url)` keeps loading beside that source.

The compiler retains completed shared groups under a 16 MiB cache budget across
jobs. A cache key includes the actual catalog sources and resources, dependency
URLs and npm pins, and cache hits validate every source file the group read; a
claimed digest or unchanged npm manifest cannot conceal changed source bytes.
The catalog travels with every job. Hosts need no compiler redeploy when toolkit
packages change, and include their catalog identity in compile reuse
fingerprints. An absent toolkit package or browser export refuses compilation
with the missing specifier in its error. App files cannot use the reserved
`node_modules/` namespace, and shared builds read only compiler-owned package
files, so an app's private source cannot enter public shared output.

## What is compiled

- The server source, when a file it reaches is TypeScript or JSX, or when it
  imports a package other than `cloudflare:` and `node:` ones.
- A page script, when a file it reaches is TypeScript or JSX, or when it imports
  a package `package.json` names. A package it does not name is left for the
  page's import map, and the plan says so when the import map of a page that
  loads the script does not name it.
- A module worker a page script starts, by the same rule as a page script,
  except that no import map reaches a worker: every package it imports by name
  must be one `package.json` names. The host serves it compiled at its source's
  address. esbuild leaves `import.meta.url` as written, so in a compiled script
  the worker's path resolves against the entry, not the file that names it.

A page script compiles to one minified file importing its shared modules with
`process.env.NODE_ENV` set to `"production"`. The server source compiles to one
module; files it reaches that esbuild does not load (text, WebAssembly) are
named in `carry` for the host to upload beside it. An import esbuild could not
resolve is an error naming the package to add to `package.json`, never a module
left missing.

## The installer

The compile installs what `package.json` names and what each package depends on,
one version of each name, flat under `node_modules/`. A package stays in its
gzipped tarball, and a file comes out of it the first time a build reads it, so
a compile holds the files its builds read rather than every file every package
ships: a page importing `three` reads 2 MB of the 20 MB of sources `three`
ships. Of a package's files, a build can read its text (scripts, JSON, CSS and
the like), never an image or a binary.

## A package's files

A page that bundles an npm package gets the package's files, whole and as bytes:
a `.wasm`, a font, an image, a worker script. The `import.meta.url` of a package
module names that module's place among them, so
`new URL('./draco_decoder.wasm', import.meta.url)` resolves to the file as
shipped, and a folder named from it holds its siblings. A page script's packages
are `Answer.assets` under `__packages/<name>/<path>`. A shared npm package's
files travel in its group, under `resources/<name>/<path>`, beside the emitted
module. A build emits the files of each package it read a module of, apart from
what only tools read (`.d.ts`, `.map`, `.md`) and a path no host serves (`%`,
`?`, `#`, `\`). Toolkit packages are not among them: their resources come from
the catalog.

A file's body (`Body`) is its text, or `{base64}` for bytes, since an answer is
JSON; `bytesOf` and `bodyOf` convert. Bytes are never decoded as text.

## The lock

`package-lock.json`, npm's lockfile version 3, top level only. Every locked
version installs exactly; a declared range installs only where the lock holds no
version satisfying it. The answer's `lock` is the lock rewritten from what the
declared packages reach, so the next deploy installs the same external code.
Toolkit entries instead hold the compiler's current exact source digest in
`version`, with `resolved: "platform"`. Old toolkit pins (including old registry
versions) are never passed to the npm installer. The current catalog replaces
that provenance on every compile, while external versions remain pinned.
