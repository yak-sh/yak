// The kernel's modules: optional doors stay dynamic imports, and the modules
// every invocation needs share one chunk. This keeps both singleton state
// and the exported runtime classes while avoiding hundreds of eager links.
import { build, type Metafile, stop } from 'npm:esbuild@0.28.1'
import { rollup } from 'npm:rollup@4.65.1'
import { createRequire } from 'node:module'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parse } from '@std/toml'
import { from, plan } from './sheet-assets.ts'

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

let native = (name: string) =>
  name.startsWith('node:') || name.startsWith('cloudflare:')

// Wrangler's aliases match a whole specifier. esbuild's native aliases also
// match subpaths, which would turn zod/v3 into zod/index.js/v3.
let aliases = (root: string, names: Record<string, string>) => ({
  name: 'aliases',
  setup(build: import('npm:esbuild@0.28.1').PluginBuild) {
    let require = createRequire(join(root, 'package.json'))
    build.onResolve({ filter: /.*/ }, ({ path }) => {
      let alias = names[path]
      return alias ? { path: require.resolve(alias) } : undefined
    })
  },
})

/** Build the source once, then group its eager closure without duplicating
 * the modules shared with a deferred door. Both passes compose source maps. */
export let bundle = async (root: string, output: string, meta: string) => {
  let config = parse(Deno.readTextFileSync(join(root, 'wrangler.toml')))
  let scratch = Deno.makeTempDirSync({
    dir: dirname(output),
    prefix: '.modules-',
  })
  try {
    let built = await build({
      absWorkingDir: root,
      entryPoints: ['index.ts'],
      outdir: scratch,
      bundle: true,
      splitting: true,
      format: 'esm',
      platform: 'browser',
      target: 'es2022',
      conditions: ['workerd', 'worker', 'browser'],
      external: ['node:*', 'cloudflare:*'],
      plugins: [aliases(root, config.alias as Record<string, string>)],
      tsconfig: join(root, '.wrangler/paths.json'),
      minify: true,
      keepNames: true,
      sourcemap: true,
      metafile: true,
      define: {
        'process.env.NODE_ENV': '"production"',
        YAK_SHEETS: JSON.stringify(plan(from(join(root, 'public'))).names),
      },
    })
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
      plugins: [{
        name: 'source-maps',
        load(id) {
          return {
            code: Deno.readTextFileSync(id),
            map: JSON.parse(Deno.readTextFileSync(id + '.map')),
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
        manualChunks: (id) => eager.has(id) ? 'kernel' : undefined,
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
      Deno.writeTextFileSync(
        meta + '.modules.json',
        JSON.stringify(modules, null, 2),
      )
    } finally {
      await grouped.close()
    }
    Deno.writeTextFileSync(meta, JSON.stringify(source, null, 2))
  } finally {
    Deno.removeSync(scratch, { recursive: true })
    stop()
  }
}

if (import.meta.main) {
  let root = dirname(fileURLToPath(import.meta.url))
  let [output, meta] = Deno.args.map((arg) => resolve(arg))
  await bundle(root, output, meta)
}
