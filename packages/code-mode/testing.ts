// Trusted fixture scripts only: production supplies an isolated evaluator.
import type { Evaluate } from './mod.ts'
import { type Carried, cells } from './repl.ts'

let runs = 0

/** A facet's storage, in memory: its kv. */
export let storage = () => {
  let kv = new Map<string, unknown>()
  return {
    kv: {
      get: (key: string) => structuredClone(kv.get(key)),
      put: (key: string, value: unknown) =>
        void kv.set(key, structuredClone(value)),
      delete: (key: string) => kv.delete(key),
    },
    sql: null,
  }
}

/** An evaluator whose scripts see `env` as their Worker's, and whose cells
 * see `ctx` as their Durable Object's. */
export let evaluating = (
  env: object = {},
  ctx: object = { storage: storage() },
): Evaluate =>
async (modules, bridge) => {
  let key = `code mode env ${++runs}`
  let user = `data:text/javascript,${encodeURIComponent(modules['user.js'])}`
  let files = modules['files.js']
  let root = files ? await Deno.makeTempDir() : undefined
  if (files) {
    files = files.replace(
      "import * as tmp from 'node:fs/promises';",
      `import * as native from 'node:fs/promises';
       const root = ${JSON.stringify(root)};
       const tmp = Object.fromEntries(['readFile', 'writeFile', 'readdir', 'unlink', 'mkdir']
         .map(name => [name, (path, ...args) => native[name](root + path.slice(4), ...args)]));`,
    )
  }
  let code = modules['script.js'].replace("'./user.js'", JSON.stringify(user))
    .replace(
      "'./files.js'",
      JSON.stringify(
        files ? `data:text/javascript,${encodeURIComponent(files)}` : '',
      ),
    )
    .replace(
      "'./puppeteer.js'",
      JSON.stringify(
        `data:text/javascript,${
          encodeURIComponent(modules['puppeteer.js'] ?? '')
        }`,
      ),
    )
    .replace(
      "import { WorkerEntrypoint } from 'cloudflare:workers';",
      `class WorkerEntrypoint { env = globalThis[${JSON.stringify(key)}].env }
       const scheduler = {wait:(ms,{signal})=>new Promise((resolve,reject)=>{let id=setTimeout(resolve,ms);signal.addEventListener('abort',()=>{clearTimeout(id);reject(signal.reason)},{once:true})})};`,
    )
    .replace(
      "import { DurableObject } from 'cloudflare:workers';",
      `class DurableObject {
         env = globalThis[${JSON.stringify(key)}].env;
         ctx = globalThis[${JSON.stringify(key)}].ctx;
       }
       const scheduler = {wait:(ms,{signal})=>new Promise((resolve,reject)=>{let id=setTimeout(resolve,ms);signal.addEventListener('abort',()=>{clearTimeout(id);reject(signal.reason)},{once:true})})};`,
    )
  ;(globalThis as Record<string, unknown>)[key] = { env, ctx }
  try {
    let module = await import(
      `data:text/javascript,${encodeURIComponent(code)}`
    )
    return await new (module.Cell ?? module.default)().run(bridge)
  } finally {
    delete (globalThis as Record<string, unknown>)[key]
    if (root) await Deno.remove(root, { recursive: true })
  }
}

export let evaluate: Evaluate = evaluating()

/** One REPL's evaluator: each cell carries what the cells before it kept. */
export let repl = (env: object = {}): Evaluate => {
  let carried: Carried | undefined
  let run = evaluating(env)
  return (modules, bridge, signal) =>
    cells(
      { read: () => carried, write: (c) => carried = c },
      (loaded) => run(loaded, bridge, signal),
    )(modules)
}
