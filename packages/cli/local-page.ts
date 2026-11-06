// A page bundled from a checkout: esbuild resolves its imports through the npm
// workspace. ./page.ts imports this only when it makes a body, so a host that
// makes none never loads esbuild.
import { context } from 'esbuild'
import { fileURLToPath } from 'node:url'
import { compiled, type Written } from './page.ts'

export let bundle = async (
  entry: URL | Written,
  signal?: AbortSignal,
): Promise<string> => {
  let at = entry instanceof URL ? entry : entry.at
  let build = await context({
    absWorkingDir: fileURLToPath(new URL('./', at)),
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
    logLevel: 'silent',
  })
  return compiled(build, signal)
}
