// A page bundled from a checkout: esbuild resolves its imports through the npm
// workspace. ./page.ts imports this only when it makes a body, so a host that
// makes none never loads esbuild.
import { context, type PluginBuild } from 'esbuild'
import { imported } from '@yaks/fp/imports'
import { fileURLToPath } from 'node:url'
import { relative } from 'node:path'
import {
  type Built,
  type Bundling,
  CHUNK,
  compiled,
  finished,
  type Written,
} from './page.ts'

let FILE_URLS = {
  name: 'file-urls',
  setup(build: PluginBuild) {
    build.onResolve(
      { filter: /^file:/ },
      ({ path }) => ({ path: fileURLToPath(path) }),
    )
  },
}

// React and the packages like it choose their production build, without
// development checks, by this.
let PRODUCTION = { 'process.env.NODE_ENV': '"production"' }

let BROWSER = {
  bundle: true,
  format: 'esm',
  platform: 'browser',
  target: 'esnext',
  jsx: 'automatic',
  jsxImportSource: 'react',
  minify: true,
  define: PRODUCTION,
  write: false,
  metafile: true,
  logLevel: 'silent',
} as const

// The modules bundled are loaded for the browser, by this loader: what
// watches this process's imports sees them too (./code.ts).
let watched = (dir: URL) => ({ metafile }: Built) =>
  imported(
    Object.keys(metafile?.inputs ?? {}).filter((i) => i != '<stdin>')
      .map((i) => new URL(i, dir).href),
  )

export let bundle = async (
  entry: URL | Written,
  signal?: AbortSignal,
  opts: Bundling = {},
): Promise<string> => {
  let at = entry instanceof URL ? entry : entry.at
  let dir = new URL('./', at)
  let build = await context({
    absWorkingDir: fileURLToPath(dir),
    ...entry instanceof URL ? { entryPoints: [fileURLToPath(entry)] } : {
      stdin: {
        contents: entry.code,
        sourcefile: fileURLToPath(at),
        resolveDir: fileURLToPath(new URL('./', at)),
        loader: 'ts',
      },
    },
    plugins: [FILE_URLS],
    external: opts.external,
    ...BROWSER,
    alias: opts.alias,
    format: opts.format ?? BROWSER.format,
  })
  return compiled(build, signal, watched(dir))
}

/** ./page.ts `split`: one build of every entry, its shared modules in
 * chunks the entries import from the site's root. */
export let split = async (
  entries: Record<string, URL>,
  signal?: AbortSignal,
  opts: Bundling = {},
): Promise<
  { entries: Record<string, string>; chunks: Record<string, string> }
> => {
  let dir = new URL('./', Object.values(entries)[0])
  let out = fileURLToPath(dir)
  let build = await context({
    absWorkingDir: out,
    entryPoints: Object.fromEntries(
      Object.entries(entries).map((
        [name, at],
      ) => [name.replace(/\.js$/, ''), fileURLToPath(at)]),
    ),
    plugins: [FILE_URLS],
    external: opts.external,
    splitting: true,
    outdir: out,
    entryNames: '[name]',
    chunkNames: `${CHUNK}.[hash]`,
    publicPath: '/',
    ...BROWSER,
  })
  let built = await finished(build, signal)
  watched(dir)(built)
  let made = { entries: {}, chunks: {} } as Awaited<ReturnType<typeof split>>
  for (let { path, text } of built.outputFiles!) {
    let name = relative(out, path)
    if (name in entries) made.entries[name] = text
    else made.chunks[name] = text
  }
  return made
}
