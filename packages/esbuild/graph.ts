// The module graph of an app's code: from one entry, every file its relative
// imports reach, in the order the files name them, and every package named
// on the way. Two readings of one walk: the runtime's, where a specifier names
// a file exactly (`modules`), and esbuild's, which also tries the extensions
// and index files a TypeScript import leaves off (`sources`).
//
// Specifiers are found by pattern, not parsed. Over-matching costs nothing: a
// word in a string that reads like an import names a file the app does not
// have, and a file that is not there is skipped, while esbuild, which does
// parse, is what compiles. Missing one would leave a module out, which is the
// bug a walk exists to prevent.

/** An app file's bytes, or null when the app has no file at that path. */
export type Read = (path: string) => Promise<Uint8Array<ArrayBuffer> | null>

/** What an entry reaches. `files` is every app file, entry first; a file that
 * is not a script is a leaf, since its imports are not ours to follow. */
export type Reached = {
  files: Map<string, Uint8Array<ArrayBuffer>>
  /** Every specifier that is not a path: `three`, `hono/cors`, `node:fs`. */
  named: string[]
}

// After `from` (`import x from './y'`, `export * from './y'`) and after
// `import` itself (a bare `import './y'`, and `import('./y')` with a literal).
let FROM = /\bfrom\s*(['"])([^'"\n]+)\1/g
let IMPORT = /\bimport\s*\(?\s*(['"])([^'"\n]+)\1/g

/** The specifiers a module's text names, in reading order.
 *
 * ```ts
 * import { assertEquals } from '@std/assert'
 * assertEquals(
 *   specifiers(`import a from './a.js'\nexport * from "three"\nimport('./b')`),
 *   ['./a.js', 'three', './b'],
 * )
 * ```
 */
export let specifiers = (source: string): string[] =>
  [...source.matchAll(FROM), ...source.matchAll(IMPORT)]
    .sort((a, b) => a.index - b.index)
    .map((m) => m[2])

/** Whether a specifier names a file of the app rather than a package. */
export let relative = (spec: string): boolean =>
  spec.startsWith('./') || spec.startsWith('../')

// A scheme (`node:`, `cloudflare:`, `https:`) is the runtime's or the web's,
// never an npm package.
let SCHEME = /^[a-z][a-z0-9+.-]*:/i

/** The npm package a specifier names, or null when it names none.
 *
 * ```ts
 * import { assertEquals } from '@std/assert'
 * assertEquals(packageOf('three/examples/jsm/Addons.js'), 'three')
 * assertEquals(packageOf('@hono/zod-validator'), '@hono/zod-validator')
 * assertEquals(packageOf('node:fs'), null)
 * assertEquals(packageOf('./a.js'), null)
 * ```
 */
export let packageOf = (spec: string): string | null => {
  if (relative(spec) || spec.startsWith('/') || SCHEME.test(spec)) return null
  let parts = spec.split('/')
  return spec.startsWith('@') ? parts.slice(0, 2).join('/') : parts[0]
}

/**
 * A specifier against the module that named it: module names are the app's
 * own paths, so `./lib.wasm` from `worker.js` is `lib.wasm` and `../lib.wasm`
 * from `a/b.js` is `lib.wasm`. `..` past the top pops nothing, so no
 * specifier names a file outside the app.
 *
 * ```ts
 * import { assertEquals } from '@std/assert'
 * assertEquals(resolved('a/b.js', '../lib.wasm'), 'lib.wasm')
 * assertEquals(resolved('worker.js', '../../x.js'), 'x.js')
 * ```
 */
export let resolved = (from: string, spec: string): string => {
  let at = from.split('/').slice(0, -1)
  for (let seg of spec.split('/')) {
    if (seg == '.' || seg == '') continue
    if (seg == '..') at.pop()
    else at.push(seg)
  }
  return at.join('/')
}

// What the runtime links as JavaScript, and what esbuild compiles first.
let SCRIPT = /\.(?:js|mjs|cjs|ts|tsx|jsx|mts|cts)$/
let TYPED = /\.(?:ts|tsx|jsx|mts|cts)$/

/** Whether a path is a module with imports of its own to follow. */
export let script = (path: string): boolean => SCRIPT.test(path)

/** Whether a path is TypeScript or JSX, which only a compiler runs. */
export let typed = (path: string): boolean => TYPED.test(path)

// esbuild's reading of a path with no file behind it, the one
// @cloudflare/worker-bundler resolves by: the extensions in its order, then
// an index file. And the TypeScript file a `.js` import names by convention
// (`./util.js` for util.ts), which worker-bundler does not resolve: finding
// it here is what lets the compile say so (./worker.ts `unlinked`).
let TRIES = ['.ts', '.tsx', '.js', '.jsx', '.mts', '.mjs']
let TWINS: Record<string, string[]> = {
  '.js': ['.ts', '.tsx'],
  '.jsx': ['.tsx'],
  '.mjs': ['.mts'],
}

/** The TypeScript files a JavaScript path names by TypeScript's convention.
 *
 * ```ts
 * import { assertEquals } from '@std/assert'
 * assertEquals(twins('lib/util.js'), ['lib/util.ts', 'lib/util.tsx'])
 * assertEquals(twins('util.ts'), [])
 * ```
 */
export let twins = (path: string): string[] => {
  let ext = path.match(/\.m?jsx?$/)?.[0] ?? ''
  let stem = path.slice(0, path.length - ext.length)
  return (TWINS[ext] ?? []).map((twin) => stem + twin)
}

let candidates = (path: string) => [
  path,
  ...TRIES.map((ext) => path + ext),
  ...TRIES.map((ext) => `${path}/index${ext}`),
  ...twins(path),
]

type Find = (
  read: Read,
  path: string,
) => Promise<[string, Uint8Array<ArrayBuffer>] | null>

/** A walk of the module graph from one entry. */
export type Walk = (read: Read, entry: string) => Promise<Reached>

let exact: Find = async (read, path) => {
  let bytes = await read(path)
  return bytes ? [path, bytes] : null
}

let loose: Find = async (read, path) => {
  for (let at of candidates(path)) {
    let bytes = await read(at)
    if (bytes) return [at, bytes]
  }
  return null
}

let walk = (find: Find): Walk => async (read, entry) => {
  let files = new Map<string, Uint8Array<ArrayBuffer>>()
  let named: string[] = []
  let seen = new Set<string>()
  let visit = async (path: string) => {
    if (seen.has(path)) return
    seen.add(path)
    let hit = await find(read, path)
    if (!hit || files.has(hit[0])) return
    let [at, bytes] = hit
    files.set(at, bytes)
    if (!script(at)) return
    for (let spec of specifiers(new TextDecoder().decode(bytes))) {
      if (relative(spec)) await visit(resolved(at, spec))
      else if (!named.includes(spec)) named.push(spec)
    }
  }
  await visit(entry)
  return { files, named }
}

/** What the runtime loads from `entry`: each specifier names a file exactly. */
export let modules: Walk = walk(exact)

/** What esbuild compiles from `entry`: an import may leave off the extension
 * or name a directory's index. */
export let sources: Walk = walk(loose)
