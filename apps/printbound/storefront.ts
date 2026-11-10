import { type Binding, identifier, Refusal, store, who } from './store.ts'
import { type Service, studio } from './source.ts'

export type Env = { APP: Binding; STORE: Binding; FILES: Binding }
export let storefront = async (
  request: Request,
  env: Env,
  service: Service,
): Promise<Response | null> => {
  let url = new URL(request.url), route = url.pathname.split('/studio/')[1]
  if (!route) return null
  let caller = who(request), desk = studio(store(env.APP), service)
  try {
    if (route === 'drafts') {
      return await env.STORE.fetch('/drafts', {
        method: request.method,
        ...request.method === 'POST'
          ? {
            headers: { 'content-type': 'application/json' },
            body: await request.text(),
          }
          : {},
      })
    }
    if (route === 'shelf' && request.method === 'GET') {
      return Response.json(await desk.shelf(caller))
    }
    if (route === 'book' && request.method === 'GET') {
      return Response.json(
        await desk.owned(url.searchParams.get('id'), caller),
      )
    }
    if (route === 'file' && request.method === 'GET') {
      let book = await desk.owned(url.searchParams.get('id'), caller)
      let document = book.book_prepared?.document,
        blob = identifier(url.searchParams.get('blob'))
      let files = document
        ? [
          document.interior.blob,
          document.cover.blob,
          ...document.pages.map((p) => p.blob),
        ]
        : []
      if (!files.includes(blob)) {
        throw new Refusal('That document is not available.', 403)
      }
      return await env.APP.fetch('/pay/artifacts/' + blob)
    }
    if (request.method !== 'POST') {
      throw new Refusal('Use the controls on this page.', 405)
    }
    let value: Record<string, unknown>
    try {
      value = await request.json()
    } catch {
      throw new Refusal('Send the form again.')
    }
    let result
    if (route === 'save') result = await desk.save(value, caller)
    else if (route === 'prepare') result = await desk.prepare(value.id, caller)
    else if (route === 'preparation') {
      result = await desk.preparation(value.id, caller)
    } else if (route === 'quote') {
      result = await desk.quote(value.id, value, caller)
    } else if (route === 'purchase') {
      result = await desk.purchase(value.id, caller)
    } else if (route === 'progress') {
      result = await desk.progress(value.id, caller)
    } else if (route === 'cancel') result = await desk.cancel(value.id, caller)
    else return new Response('Not found', { status: 404 })
    return Response.json(result)
  } catch (error) {
    if (!(error instanceof Refusal)) throw error
    return Response.json({ error: error.message }, {
      status: error.status,
      headers: { 'cache-control': 'private, no-store' },
    })
  }
}
