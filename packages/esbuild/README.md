# @yaks/esbuild

Compiles a web app's TypeScript, npm and platform toolkit imports with esbuild,
at deploy: the server source (a Worker module) and each
`<script type="module" src>` a page loads. An app that needs neither plans
nothing and deploys as it is written.

Two halves, because the compiler runs only inside workerd:

- **`.`** decides, anywhere: which files an app's code reaches, and what must be
  compiled. It holds no compiler.
- **`./workerd`** compiles: a Worker's `fetch` that takes an `Ask` and answers
  an `Answer`, over
  [@cloudflare/worker-bundler](https://www.npmjs.com/package/@cloudflare/worker-bundler)
  (esbuild as WebAssembly, npm installs from the registry). It is handed every
  file it reads and holds no binding and no secret. A host deploys it as a
  Worker of its own and posts to it.

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

## Platform toolkit sources

An app declares toolkit dependencies in `package.json` with the compiler-owned
version, not a registry version:

```json
{ "dependencies": { "@yaks/client": "platform", "preact": "^10" } }
```

`compile(ask, catalog = {})` accepts the catalog from its host wrapper. The app
sends only its `Ask`; it cannot supply a catalog. Existing npm-only callers need
no second argument. A toolkit dependency requires that its compiler has the
package and rejects any version other than `"platform"`, never fetching a stale
`@yaks/*` registry release.

`platform.ts` exports `Catalog`, a map from package name to
`{files, dependencies, version}`. `files` are npm-shaped paths relative to the
package root, including `package.json` with its exports. The host's generator
normalizes source imports and includes runtime dependencies, not test imports or
unrelated server exports. `dependencies` maps toolkit packages to `"platform"`
and external npm packages to their ranges. `version` is
`sha256:<64 lowercase hex digits>` over the generated package's source bytes.

The pure `seed(files, catalog)` returns `{files, dependencies, platform}`: app
files plus the declared toolkit roots and their package-level dependency closure
under `node_modules/`, npm roots including every reached toolkit external, and
toolkit names mapped to exact source digests. Unused catalog entries stay out.
External ranges from multiple consumers must overlap because this installer is
flat. Toolkit externals are explicit npm roots because worker-bundler skips
preseeded packages without installing their dependencies or reporting them as
installed.

The wrapper's catalog is part of the compiler deployment. A host reusing build
output includes its compiler deployment version in the reuse fingerprint; an
app's old lock never selects an old toolkit source.

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

A page script compiles to one minified file with `process.env.NODE_ENV` set to
`"production"`. The server source compiles to one module; files it reaches that
esbuild does not load (text, WebAssembly) are named in `carry` for the host to
upload beside it. An import esbuild could not resolve is an error naming the
package to add to `package.json`, never a module left missing.

## The lock

`package-lock.json`, npm's lockfile version 3, top level only. Every locked
version installs exactly; a declared range installs only where the lock holds no
version satisfying it. The answer's `lock` is the lock rewritten from what the
declared packages reach, so the next deploy installs the same external code.
Toolkit entries instead hold the compiler's current exact source digest in
`version`, with `resolved: "platform"`. Old toolkit pins (including old registry
versions) are never passed to the npm installer. The current catalog replaces
that provenance on every compile, while external versions remain pinned.
