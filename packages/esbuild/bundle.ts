// One esbuild build over a compile's files (./npm.ts `Files`), the way
// @cloudflare/worker-bundler 0.2.4 ran it, so an app compiles to the bytes it
// compiled to when yak-esbuild ran worker-bundler in workerd: the same esbuild
// release (0.28.1), options, namespace and resolution. esbuild here is native,
// a process of its own beside this one, where worker-bundler ran it as
// WebAssembly inside the isolate.
//
// Every file a build reads comes out of the files, in the `virtual` namespace
// (an error names `virtual:main.ts`, and ./said.ts strips it). A relative
// import tries the path, then each extension, then an index file. A package
// import reads the package's package.json: its `exports` under the `import`
// and `browser` conditions, then `module` and `main`, then an index file. An
// import that resolves to nothing, or a `cloudflare:` one, is left an import,
// for ./compile.ts to judge.
import * as esbuild from 'esbuild'
import { legacy, resolve } from 'resolve.exports'
import { packageOf, TRIES } from './graph.ts'

/** What a build reads: a path's text, or null when there is no such file. */
export type Source = { read(path: string): string | null }

/** How an entry is built. */
export type Options = {
  /** Built for Node's built-ins (a worker with `nodejs_compat`), else for a
   * browser. */
  node?: boolean
  minify?: boolean
  define?: Record<string, string>
}

/** esbuild's process ended under a build. That is the compiler's room, not
 * the app's code: a process killed for memory ends this way. */
export class Stopped extends Error {
  override name = 'Stopped'
}

/** One entry built: a single ES module, and what esbuild warned. */
export type Built = { code: string; warnings: string[] }

let PACKAGE_TRIES = [...TRIES, '.json']

// A path, else the path with each extension, else its index file.
let tried = (files: Source, path: string, tries: string[]) => {
  path = path.replace(/^\.\//, '').replace(/\/+/g, '/').replace(/\/$/, '')
  return [
    path,
    ...tries.map((ext) => path + ext),
    ...tries.map((ext) => `${path}/index${ext}`),
  ].find((p) => files.read(p) != null)
}

// `dir` joined to a relative path, `..` popping a segment.
let joined = (dir: string, path: string) => {
  let parts = dir ? dir.split('/') : []
  for (let part of path.split('/')) {
    if (part == '..') parts.pop()
    else if (part != '.') parts.push(part)
  }
  return parts.join('/')
}

let inside = (name: string, path: string) =>
  `node_modules/${name}/${path.replace(/^\.?\//, '')}`

/** The file a package import names, or undefined when the package is not
 * installed or names no file. Throws for a package.json that is not JSON. */
let packaged = (files: Source, spec: string) => {
  let name = packageOf(spec)
  if (!name) return
  let manifest = files.read(`node_modules/${name}/package.json`)
  if (manifest == null) return
  let pkg = JSON.parse(manifest)
  let subpath = spec.slice(name.length + 1)
  try {
    let [hit] = resolve(pkg, subpath ? `./${subpath}` : '.', {
      conditions: ['import', 'browser'],
    }) ?? []
    if (hit && files.read(inside(name, hit)) != null) return inside(name, hit)
  } catch {
    // No export matches: the legacy fields may still name it.
  }
  let main = legacy(pkg, { fields: ['module', 'main'] })
  if (typeof main == 'string' && files.read(inside(name, main)) != null) {
    return inside(name, main)
  }
  return tried(
    files,
    `node_modules/${name}${subpath ? `/${subpath}` : ''}`,
    PACKAGE_TRIES,
  )
}

let loader = (path: string): esbuild.Loader =>
  /\.[mc]?ts$/.test(path)
    ? 'ts'
    : path.endsWith('.tsx')
    ? 'tsx'
    : path.endsWith('.jsx')
    ? 'jsx'
    : path.endsWith('.json')
    ? 'json'
    : path.endsWith('.css')
    ? 'css'
    : 'js'

let virtual = (files: Source): esbuild.Plugin => ({
  name: 'virtual-fs',
  setup(build) {
    let found = (path: string) => ({ path, namespace: 'virtual' })
    let left = (path: string) => ({ path, external: true })
    build.onResolve({ filter: /.*/ }, ({ kind, path, resolveDir }) => {
      if (kind == 'entry-point') return found(path)
      if (path.startsWith('.')) {
        let hit = tried(
          files,
          joined(resolveDir.replace(/^\//, ''), path),
          TRIES,
        )
        return hit ? found(hit) : left(path)
      }
      if (path.startsWith('/')) {
        return files.read(path.slice(1)) != null
          ? found(path.slice(1))
          : left(path)
      }
      if (path.startsWith('cloudflare:')) return left(path)
      try {
        let hit = packaged(files, path)
        if (hit) return found(hit)
      } catch {
        // A package.json that is not JSON resolves nothing.
      }
      return left(path)
    })
    build.onLoad({ filter: /.*/, namespace: 'virtual' }, ({ path }) => {
      let contents = files.read(path)
      if (contents == null) {
        return { errors: [{ text: `File not found: ${path}` }] }
      }
      return {
        contents,
        loader: loader(path),
        resolveDir: path.slice(0, Math.max(0, path.lastIndexOf('/'))),
      }
    })
  },
})

// What esbuild's JS API rejects with once its process is gone: "was stopped"
// for the builds it was running, "is no longer running" for any after.
let GONE = /^The service (?:was stopped|is no longer running)/

/** Build one entry of `files` into a single ES module. Throws esbuild's
 * failure, whose `errors` ./said.ts reads, or {@link Stopped}, after which
 * the next build starts esbuild afresh. */
export let bundle = async (
  files: Source,
  entry: string,
  options: Options = {},
): Promise<Built> => {
  if (files.read(entry) == null) throw new Error(`${entry}: no such file`)
  try {
    return await built(files, entry, options)
  } catch (e) {
    if (!GONE.test((e as Error)?.message)) throw e
    await esbuild.stop()
    throw new Stopped(`esbuild's process ended while building ${entry}`)
  }
}

let built = async (
  files: Source,
  entry: string,
  { node = false, minify = false, define }: Options,
): Promise<Built> => {
  let out = await esbuild.build({
    entryPoints: [entry],
    bundle: true,
    write: false,
    format: 'esm',
    platform: node ? 'node' : 'browser',
    target: 'es2022',
    minify,
    plugins: [virtual(files)],
    outfile: 'bundle.js',
    // A plugin's relative resolveDir is taken from here, as esbuild-wasm took
    // it from its own root: `node_modules/x/dist` is `/node_modules/x/dist`.
    absWorkingDir: '/',
    // Errors and warnings come back in the answer; nothing is printed.
    logLevel: 'silent',
    ...define ? { define } : {},
  })
  return {
    code: out.outputFiles[0].text,
    warnings: out.warnings.map((w) => w.text),
  }
}

/** Stop esbuild's process, which otherwise outlives the last build. */
export let stop = (): Promise<void> => esbuild.stop()
