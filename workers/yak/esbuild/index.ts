// The platform supplies its compiler with the toolkit source catalog captured
// at deployment. An app asks for package names, never chooses these sources.
import { compile } from '../../../packages/esbuild/worker.ts'
import type { Ask } from '../../../packages/esbuild/plan.ts'
import catalog from '../.wrangler/packages.json' with { type: 'json' }

export default {
  fetch: async (req: Request): Promise<Response> =>
    req.method == 'POST'
      ? Response.json(await compile(await req.json() as Ask, catalog))
      : new Response('POST an ask', { status: 405 }),
}
