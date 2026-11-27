// Trusted fixture scripts only: production supplies an isolated evaluator.
import type { Evaluate } from './mod.ts'

let runs = 0

/** An evaluator whose scripts see `env` as their Worker's. */
export let evaluating =
  (env: object = {}): Evaluate => async (modules, bridge) => {
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
        `class WorkerEntrypoint { env = globalThis[${JSON.stringify(key)}] }
       const scheduler = {wait:(ms,{signal})=>new Promise((resolve,reject)=>{let id=setTimeout(resolve,ms);signal.addEventListener('abort',()=>{clearTimeout(id);reject(signal.reason)},{once:true})})};`,
      )
    ;(globalThis as Record<string, unknown>)[key] = env
    try {
      let module = await import(
        `data:text/javascript,${encodeURIComponent(code)}`
      )
      return await new module.default().run(bridge)
    } finally {
      delete (globalThis as Record<string, unknown>)[key]
      if (root) await Deno.remove(root, { recursive: true })
    }
  }

export let evaluate: Evaluate = evaluating()
