import { caller, commands, printService } from './service.ts'
import { type Environment, runtime } from './runtime.ts'
import { storefront } from './storefront.ts'
import { site } from './site.ts'
import { legacyPage } from './legacy.ts'
import { store } from './store.ts'
import { InputError } from './refusal.ts'
import { DocumentInputError } from './document.ts'
import { relative } from './request.ts'
import { receiptPage } from './receipt.ts'

export default {
  async fetch(request: Request, env: Environment) {
    try {
      request = relative(request)
      let path = new URL(request.url).pathname
      if (
        /^\/service\/(prepare|quote|purchase|order_status|cancel|step|reconcile|document_file|document_status|prepare_step)$/
          .test(path)
      ) {
        return await printService(request, await runtime(env, request))
      }
      return await receiptPage(request, env) ??
        await site(request, env) ??
        await legacyPage(request, store(env.APP)) ??
        await storefront(
          request,
          env,
          async (name, args) =>
            commands(await runtime(env, request))(name, args, caller(request)),
        ) ??
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
