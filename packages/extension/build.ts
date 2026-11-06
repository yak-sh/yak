// The unpacked extension for a configuration, written to a directory the
// browser loads: the manifest, the background and popup bundled by esbuild
// with the configuration in them, the popup's page and styles, and the icons.
//
//   deno run -A packages/extension/build.ts <config.json> <outdir>

import { build as bundle, stop } from 'esbuild'
import { fileURLToPath } from 'node:url'
import { type Config, configOf } from './connect.ts'
import { manifest, SIZES } from './manifest.ts'
import { png } from './icon.ts'

let HERE = fileURLToPath(new URL('.', import.meta.url))

// Each bundle: the module it starts, and the function it calls there.
let ENTRIES = { background: 'start', popup: 'popup' }

let script = async (config: Config, name: string, starts: string) => {
  let out = await bundle({
    stdin: {
      contents: `import { ${starts} } from './${name}.ts'\n` +
        `${starts}(${JSON.stringify(config)})\n`,
      resolveDir: HERE,
      sourcefile: `${name}.entry.ts`,
      loader: 'ts',
    },
    bundle: true,
    format: 'esm',
    platform: 'browser',
    target: 'chrome120',
    write: false,
    logLevel: 'silent',
  })
  return out.outputFiles[0].contents
}

/** Write the unpacked extension for a configuration to `dir`. */
export let build = async (config: Config, dir: string): Promise<string[]> => {
  await Deno.mkdir(dir, { recursive: true })
  let files: Record<string, Uint8Array | string> = {
    'manifest.json': JSON.stringify(manifest(config), null, 2) + '\n',
    'popup.html': await Deno.readTextFile(HERE + 'popup.html'),
    'popup.css': await Deno.readTextFile(HERE + 'popup.css'),
  }
  for (let [name, starts] of Object.entries(ENTRIES)) {
    files[`${name}.js`] = await script(config, name, starts)
  }
  for (let n of SIZES) files[`icon${n}.png`] = await png(n)
  await stop()
  for (let [name, bytes] of Object.entries(files)) {
    typeof bytes == 'string'
      ? await Deno.writeTextFile(`${dir}/${name}`, bytes)
      : await Deno.writeFile(`${dir}/${name}`, bytes)
  }
  return Object.keys(files)
}

if (import.meta.main) {
  let [from, dir] = Deno.args
  if (!from || !dir) {
    console.error('usage: build.ts <config.json> <outdir>')
    Deno.exit(2)
  }
  let config = configOf(JSON.parse(await Deno.readTextFile(from)))
  if (typeof config == 'string') {
    console.error(`${from}: ${config}`)
    Deno.exit(1)
  }
  let wrote = await build(config, dir)
  console.log(`${dir}: ${wrote.join(' ')}`)
}
