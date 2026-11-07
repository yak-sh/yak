// A page bundled from a checkout: esbuild resolves its imports through the npm
// workspace. ./page.ts imports this only when it makes a body, so a host that
// makes none never loads esbuild.
import { context } from 'esbuild'
import { imported } from '@yaks/fp/imports'
import { fileURLToPath } from 'node:url'
import { compiled, type Written } from './page.ts'

export let bundle = async (
  entry: URL | Written,
  signal?: AbortSignal,
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
    plugins: [{
      name: 'file-urls',
      setup(build) {
        build.onResolve(
          { filter: /^file:/ },
          ({ path }) => ({ path: fileURLToPath(path) }),
        )
      },
    }],
    bundle: true,
    format: 'esm',
    platform: 'browser',
    target: 'esnext',
    jsx: 'automatic',
    jsxImportSource: 'preact',
    minify: true,
    write: false,
    metafile: true,
    logLevel: 'silent',
  })
  // The modules bundled are loaded for the browser, by this loader: what
  // watches this process's imports sees them too (./code.ts).
  return compiled(build, signal, ({ metafile }) =>
    imported(
      Object.keys(metafile?.inputs ?? {}).filter((i) => i != '<stdin>')
        .map((i) => new URL(i, dir).href),
    ))
}
