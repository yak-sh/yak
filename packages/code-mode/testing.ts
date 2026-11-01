// Trusted fixture scripts only: production supplies an isolated evaluator.
import type { Evaluate } from './mod.ts'

export let evaluate: Evaluate = async (modules, bridge) => {
  let user = `data:text/javascript,${encodeURIComponent(modules['user.js'])}`
  let code = modules['script.js'].replace("'./user.js'", JSON.stringify(user))
    .replace(
      "import { WorkerEntrypoint } from 'cloudflare:workers';",
      'class WorkerEntrypoint {}',
    )
  let module = await import(`data:text/javascript,${encodeURIComponent(code)}`)
  return await new module.default().run(bridge)
}
