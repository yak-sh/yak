import type { Environment } from './runtime.ts'
import { site } from './site.ts'
import { InputError } from './refusal.ts'
import { DocumentInputError } from './document-errors.ts'
import { relative } from './request.ts'

export default {
  async fetch(request: Request, env: Environment) {
    try {
      request = relative(request)
      let path = new URL(request.url).pathname
      if (
        /^\/service\/(prepare|quote|purchase|order_status|cancel|step|reconcile|document_file|document_status|prepare_step)$/
          .test(path)
      ) {
        let [{ printService }, { runtime }] = await Promise.all([
          import('./service.ts'),
          import('./runtime.ts'),
        ])
        return await printService(request, await runtime(env, request))
      }
      if (path == '/receipt') {
        let { receiptPage } = await import('./receipt.ts')
        return await receiptPage(request, env)
      }
      let page = await site(request, env)
      if (page) return page
      let [{ legacyPage }, { store }, { storefront }] = await Promise.all([
        import('./legacy.ts'),
        import('./store.ts'),
        import('./storefront.ts'),
      ])
      return await legacyPage(request, store(env.APP)) ??
        await storefront(request, env, async (name, args) => {
          let [{ caller, commands }, { runtime }] = await Promise.all([
            import('./service.ts'),
            import('./runtime.ts'),
          ])
          return commands(await runtime(env, request))(
            name,
            args,
            caller(request),
          )
        }) ??
        new Response('not found', { status: 404 })
    } catch (error) {
      if (error instanceof InputError || error instanceof DocumentInputError) {
        return Response.json({ error: { message: error.message } }, {
          status: 400,
        })
      }
      throw error
    }
  },
}
