// Trusted fixture scripts only: production supplies an isolated evaluator.
import type { Evaluate } from './mod.ts'

export let evaluate: Evaluate = async (modules, bridge) => {
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
      "import { WorkerEntrypoint } from 'cloudflare:workers';",
      `class WorkerEntrypoint {}
       const scheduler = {wait:(ms,{signal})=>new Promise((resolve,reject)=>{let id=setTimeout(resolve,ms);signal.addEventListener('abort',()=>{clearTimeout(id);reject(signal.reason)},{once:true})})};`,
    )
  try {
    let module = await import(
      `data:text/javascript,${encodeURIComponent(code)}`
    )
    return await new module.default().run(bridge)
  } finally {
    if (root) await Deno.remove(root, { recursive: true })
  }
}
