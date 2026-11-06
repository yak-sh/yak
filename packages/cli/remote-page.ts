// Published JSR plugins have remote module graphs until the npm release
// migration completes (D-135458 step 6). Keep that compatibility resolver at
// this boundary; local workspace bundles use esbuild's package resolution.
// ./page.ts imports this only when it makes a body, so a host that makes none
// never downloads esbuild or the loader.
import { context, type Plugin, type PluginBuild } from 'esbuild'
import { denoPlugins, urlToEsbuildResolution } from '@luca/esbuild-deno-loader'
import * as disk from '@yaks/file/io'
import { released } from './release.ts'
import { compiled, type Written } from './page.ts'

export let bundle = async (
  entry: URL | Written,
  signal?: AbortSignal,
): Promise<string> => {
  let at = entry instanceof URL ? entry : entry.at
  let dir = await disk.makeTempDir({ prefix: 'yaks-page-' })
  let from = entry instanceof URL ? entry : new URL('./.yak-page.ts', at)
  let virtual = urlToEsbuildResolution(from)
  try {
    await disk.writeTextFile(`${dir}/deno.json`, JSON.stringify(released))
    let configPath = `${dir}/deno.json`
    if (signal?.aborted) throw new Error('browser bundle was stopped')
    let build = await context({
      absWorkingDir: dir,
      entryPoints: [from.href],
      bundle: true,
      format: 'esm',
      platform: 'browser',
      target: 'esnext',
      // esbuild reads no deno.json: said here, or JSX compiles to `React`.
      jsx: 'automatic',
      jsxImportSource: 'preact',
      minify: true,
      write: false,
      logLevel: 'silent',
      plugins: [
        ...entry instanceof URL ? [] : [{
          name: 'written',
          setup(build: PluginBuild) {
            build.onResolve(
              { filter: /.*/ },
              (args) =>
                args.kind == 'entry-point' && args.path == from.href
                  ? virtual
                  : undefined,
            )
            build.onLoad(
              { filter: /.*/, namespace: virtual.namespace },
              (args) =>
                args.path == virtual.path
                  ? { contents: entry.code, loader: 'ts' }
                  : undefined,
            )
          },
        }],
        // The loader carries esbuild 0.20 types; its plugin API is unchanged.
        ...denoPlugins(
          { configPath },
        ) as Plugin[],
      ],
    })
    return await compiled(build, signal)
  } finally {
    await disk.remove(dir, { recursive: true })
  }
}
