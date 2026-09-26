# @yaks/esbuild

Compiles a web app's TypeScript and npm imports with esbuild, at deploy: the
server source (a Worker module) and each `<script type="module" src>` a page
loads. An app that needs neither plans nothing and deploys as it is written.

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

- `plan({paths, read, main, flags})` returns `{ask, notes}`, or `null` when
  nothing needs compiling. `main` is the server source, if the app has one;
  `flags` its compatibility flags. It throws `Unplanned` with a sentence the
  author can act on, such as a `package.json` that is not JSON.
- `modules(read, entry)` and `sources(read, entry)` walk the module graph from
  one file: `modules` as the runtime links (a specifier names a file exactly),
  `sources` as esbuild resolves (extensions, `index` files, the `.ts` twin of a
  `.js` import). Each returns the files reached and the packages named. Both
  parse: an import in a comment or a string names nothing, and `import type` is
  gone with the types.
- `loaded(page, html)` is the module scripts a page loads, and `mapped(html)`
  what its import maps name.
- `dependencies(text)` reads `package.json`'s `dependencies`.

## What is compiled

- The server source, when a file it reaches is TypeScript or JSX, or when it
  imports a package other than `cloudflare:` and `node:` ones.
- A page script, when a file it reaches is TypeScript or JSX, or when it imports
  a package `package.json` names. A package it does not name is left for the
  page's import map, and the plan says so when the import map of a page that
  loads the script does not name it.

A page script compiles to one minified file with `process.env.NODE_ENV` set to
`"production"`. The server source compiles to one module; files it reaches that
esbuild does not load (text, WebAssembly) are named in `carry` for the host to
upload beside it. An import esbuild could not resolve is an error naming the
package to add to `package.json`, never a module left missing.

## The lock

`package-lock.json`, npm's lockfile version 3, top level only. Every locked
version installs exactly; a declared range installs only where the lock holds no
version satisfying it. The answer's `lock` is the lock rewritten from what the
declared packages reach, so the next deploy installs the same code.
