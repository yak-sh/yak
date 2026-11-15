// The kernel's modules: every door stays a dynamic import, and what the entry
// imports statically shares one chunk. The entry (index.ts) loads each class's
// code on its first call, and a module is evaluated when it is first imported,
// so that chunk is all a cold isolate evaluates before it knows what it was
// woken for (T-148770).
import * as io from '@yaks/file/io'
import * as system from '@yaks/process/system'
import { build, type BuildOptions, type Metafile, stop } from 'esbuild'
import { rollup } from 'rollup'
import { dirname, join, resolve } from 'node:path'
import { isBuiltin } from 'node:module'
import { fileURLToPath } from 'node:url'
import { planned } from './assets.ts'

/** The entry's static imports, leaving every dynamic door unopened. */
export let closure = (meta: Metafile, entry: string): Set<string> => {
  let held = new Set<string>()
  let visit = (file: string) => {
    if (held.has(file) || !meta.outputs[file]) return
    held.add(file)
    for (let imported of meta.outputs[file].imports) {
      if (imported.kind != 'dynamic-import') visit(imported.path)
    }
  }
  visit(entry)
  return held
}

// The node modules workerd lacks under wrangler.toml's compatibility_date
// and flags: at 2025-05-08 with nodejs_compat, workerd 1.20261104 has no
// node:fs, node:os or node:child_process (node:fs/promises it has).
let ABSENT = new Set(['node:fs', 'node:os', 'node:child_process'])

// Opened only with a `cwd` (@yaks/mcp/skills), which a box passes and the
// Worker never does.
let HOST = new Set(['../../packages/mcp/skills-host.ts'])

/** Each chunk that imports a node module the Worker lacks, with those modules
 * and the source files importing them. A door whose chunk imports one fails
 * each time it is opened, after a deploy that uploaded fine. */
export let lacking = (meta: Metafile): Record<string, string[]> => {
  let failing: Record<string, string[]> = {}
  for (let [file, chunk] of Object.entries(meta.outputs)) {
    if (chunk.entryPoint && HOST.has(chunk.entryPoint)) continue
    let absent = [...new Set(chunk.imports.map((i) => i.path))]
      .filter((path) => ABSENT.has(path))
    if (!absent.length) continue
    let from = Object.keys(chunk.inputs).filter((input) =>
      meta.inputs[input]?.imports.some((i) => ABSENT.has(i.path))
    )
    failing[chunk.entryPoint ?? file] = [...absent, ...from]
  }
  return failing
}

let native = (name: string) =>
  name.startsWith('node:') || name.startsWith('cloudflare:')

/** How esbuild reads the kernel's source: `named` is the byte name of each
 * asset its modules point at (assets.ts `planned`). */
export let options = (
  root: string,
  named: Record<string, string> = {},
): BuildOptions => ({
  absWorkingDir: root,
  entryPoints: ['index.ts'],
  bundle: true,
  splitting: true,
  format: 'esm',
  platform: 'browser',
  target: 'es2022',
  jsx: 'automatic',
  jsxImportSource: 'preact',
  conditions: ['workerd', 'worker', 'browser'],
  external: ['node:*', 'cloudflare:*'],
  plugins: [{
    name: 'builtins',
    setup(build) {
      build.onResolve(
        { filter: /.*/ },
        ({ path }) =>
          isBuiltin(path)
            ? {
              path: path.startsWith('node:') ? path : `node:${path}`,
              external: true,
            }
            : undefined,
      )
    },
  }],
  minify: true,
  keepNames: true,
  sourcemap: true,
  metafile: true,
  define: {
    'process.env.NODE_ENV': '"production"',
    YAK_NAMED: JSON.stringify(named),
  },
})

/** Build the source once, then group its eager closure without duplicating
 * the modules shared with a deferred door. Both passes compose source maps. */
export let bundle = async (root: string, output: string, meta: string) => {
  let scratch = io.makeTempDirSync({
    dir: dirname(output),
    prefix: '.modules-',
  })
  try {
    let names = planned(join(root, 'public')).names
    let built = await build({ ...options(root, names), outdir: scratch })
    let source = built.metafile!
    let entry = Object.keys(source.outputs).find((file) =>
      source.outputs[file].entryPoint == 'index.ts'
    )!
    let eager = new Set(
      [...closure(source, entry)].map((file) => resolve(root, file)),
    )
    let grouped = await rollup({
      input: resolve(root, entry),
      external: native,
      // esbuild already dropped what nothing uses; shaking its output again
      // was half of this pass's CPU and kept only 1% fewer bytes.
      treeshake: false,
      plugins: [{
        name: 'source-maps',
        // esbuild just wrote every chunk a chunk imports. Rollup's own
        // resolver reads the chunk's whole directory for each import to check
        // its case, which was most of this pass.
        resolveId: (source, importer) =>
          importer && source.startsWith('.')
            ? resolve(dirname(importer), source)
            : null,
        load(id) {
          return {
            code: io.readTextFileSync(id),
            map: JSON.parse(io.readTextFileSync(id + '.map')),
          }
        },
      }],
      onwarn(warning) {
        if (warning.code != 'CIRCULAR_DEPENDENCY') {
          console.warn(warning.message)
        }
      },
    })
    try {
      let written = await grouped.write({
        dir: output,
        format: 'es',
        sourcemap: true,
        compact: true,
        footer: '\n',
        chunkFileNames: '[name]-[hash].js',
        manualChunks: (id) => eager.has(id) ? 'entry' : undefined,
        onlyExplicitManualChunks: true,
      })
      let modules = written.output.filter((part) => part.type == 'chunk')
        .map((part) => ({
          file: part.fileName,
          bytes: new TextEncoder().encode(part.code).byteLength,
          entry: part.isEntry,
          imports: part.imports,
          dynamicImports: part.dynamicImports,
        }))
      io.writeTextFileSync(
        meta + '.modules.json',
        JSON.stringify(modules, null, 2),
      )
    } finally {
      await grouped.close()
    }
    io.writeTextFileSync(meta, JSON.stringify(source, null, 2))
  } finally {
    io.removeSync(scratch, { recursive: true })
    stop()
  }
}

if (import.meta.main) {
  let root = dirname(fileURLToPath(import.meta.url))
  let [output, meta] = system.args.map((arg) => resolve(arg))
  await bundle(root, output, meta)
}
