// The module graph of an app's code: from one entry, every file its relative
// imports reach, in the order the files name them, and every package named
// on the way. Two readings of one walk: the runtime's, where a specifier names
// a file exactly (`modules`), and esbuild's, which also tries the extensions
// and index files a TypeScript import leaves off (`sources`).
//
// Specifiers are parsed: an import in a comment or a string names nothing.
// sucrase strips TypeScript and JSX down to JavaScript, keeping every import
// esbuild might keep (only `import type` and its kin go, since missing an
// import would leave a module out, the bug a walk exists to prevent), and
// es-module-lexer reads the imports of what is left. A file that does not
// parse is a leaf: whatever loads it (esbuild, the runtime, the browser) says
// why, in a better sentence than a walk could.
import { parse } from 'es-module-lexer/js'
import type { Transform } from 'sucrase'

/** An app file's bytes, or null when the app has no file at that path. */
export type Read = (path: string) => Promise<Uint8Array<ArrayBuffer> | null>

/** What an entry reaches. `files` is every app file, entry first; a file that
 * is not a script is a leaf, since its imports are not ours to follow. */
export type Reached = {
  files: Map<string, Uint8Array<ArrayBuffer>>
  /** Every specifier that is not a path: `three`, `hono/cors`, `node:fs`. */
  named: string[]
}

// What sucrase strips from each kind of file before it is lexed. JavaScript
// is lexed as it is written.
let STRIP: Record<string, Transform[]> = {
  ts: ['typescript'],
  mts: ['typescript'],
  cts: ['typescript'],
  tsx: ['typescript', 'jsx'],
  jsx: ['jsx'],
}

// sucrase loads with the first TypeScript or JSX file a walk reads, not with
// every isolate that imports this module: in the kernel that is every request.
let javascript = async (path: string, source: string) => {
  let transforms = STRIP[path.slice(path.lastIndexOf('.') + 1)]
  if (!transforms) return source
  let { transform } = await import('sucrase')
  return transform(source, {
    transforms,
    keepUnusedImports: true,
    disableESTransforms: true,
    production: true,
  }).code
}

// sucrase refuses a file with a SyntaxError, es-module-lexer with an Error
// carrying the offset (`idx`).
let unparsed = (e: unknown) =>
  e instanceof SyntaxError || e instanceof Error && 'idx' in e

/** The specifiers a module imports, in reading order, or none when it does
 * not parse. Its path says how to read it: TypeScript, JSX or JavaScript.
 *
 * ```ts
 * import { assertEquals } from '@std/assert'
 * assertEquals(
 *   await specifiers(
 *     'a.tsx',
 *     `// import x from 'said'\nimport type { T } from 'types'\n` +
 *       `import a from './a.js'\nexport * from "three"\n` +
 *       `let b = <b>it's</b>\nimport('./b')`,
 *   ),
 *   ['./a.js', 'three', './b'],
 * )
 * assertEquals(await specifiers('a.ts', 'let n: = 1'), [])
 * ```
 */
export let specifiers = async (
  path: string,
  source: string,
): Promise<string[]> => {
  try {
    return parse(await javascript(path, source))[0].map((i) => i.n)
      .filter((n): n is string => n != null)
  } catch (e) {
    if (unparsed(e)) return []
    throw e
  }
}

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
    for (let spec of await specifiers(at, new TextDecoder().decode(bytes))) {
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
