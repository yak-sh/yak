#!/usr/bin/env -S deno run -A
// Capture one immutable compiler workload from a pinned checkout. No app write,
// deploy, or connection; package catalog and app sources travel together.
// deno run -A bin/app-compile-job.ts /path/to/pinned/checkout apps/vale job.json
import { resolve } from 'node:path'
import { write } from './compiler-packages.ts'
import { plan } from '../packages/esbuild/plan.ts'

if (import.meta.main) {
  let [root, app = 'apps/vale', output = 'compile-job.json'] = Deno.args
  if (!root) throw new Error('need checkout path [apps/vale] [job.json]')
  root = resolve(root)
  let dir = resolve(root, app)
  let paths: string[] = []
  let walk = async (at = '') => {
    for await (let file of Deno.readDir(`${dir}/${at}`)) {
      if (file.name.startsWith('.')) continue
      let path = at ? `${at}/${file.name}` : file.name
      if (file.isDirectory) await walk(path)
      else if (file.isFile) paths.push(path)
    }
  }
  await walk()
  // Match app_deploy's default worker selection (worker.js, else worker.ts).
  let main = paths.includes('worker.js') ? 'worker.js' : 'worker.ts'
  let result = await plan({
    paths,
    main,
    flags: ['nodejs_compat'],
    read: async (path) => {
      try {
        return await Deno.readFile(`${dir}/${path}`)
      } catch (error) {
        if (error instanceof Deno.errors.NotFound) return null
        throw error
      }
    },
  })
  if (!result) throw new Error('app needs no compile')
  let temporary = await Deno.makeTempDir({ prefix: 'compiler-catalog-' })
  try {
    let cache = Deno.env.get('DENO_DIR') ??
      `${Deno.env.get('HOME')}/.cache/deno`
    let catalog = await write(
      root,
      `${temporary}/packages.json`,
      `${cache}/yak/compiler-transpiled.json`,
    )
    await Deno.writeTextFile(
      output,
      JSON.stringify({
        ask: result.ask,
        catalog,
        shared: true,
        origin: 'https://yaks.app',
      }),
    )
  } finally {
    await Deno.remove(temporary, { recursive: true })
  }
  console.log(
    `captured ${
      Object.keys(result.ask.files).length
    } files, ${result.ask.pages.length} pages → ${output}`,
  )
}
