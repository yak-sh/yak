// An app's form door at yaks.app's edge (@yaks/forms/routes): the form is
// answered in the app's store, which holds its rows, and the browser here,
// where its address is. The edge says who is asking, which only it knows,
// and sends a submission as its bytes, never its stream, so the store's door
// can send it again when a deploy's restart cuts it off (door.ts `storeOf`).
import { FORM, native, noFile } from '@yaks/forms/routes'
import type { Door as Shown } from '@yaks/forms/fill'
import type { Answer } from './apps.ts'
import type { Door } from '@yaks/durable-object/door'
import { appStore } from './directory.ts'
import { KERNEL } from './meta.ts'
import { ADDRESS } from '@yaks/platform/routes'

export let forms: Answer = ({ req, env, path, space, app, who }) => {
  if (!/^\/form\/[^/]+$/.test(path)) return null
  let store = appStore(env.STORE, space, app, env)
  return native(
    async (req) =>
      store(
        `/api${path}`,
        {
          method: req.method,
          body: req.method == 'POST' ? await req.arrayBuffer() : null,
          headers: req.headers,
        },
        who.person ? { ...KERNEL, 'x-yak-person': who.person } : KERNEL,
      ),
    (req) => req.headers.get(ADDRESS) ?? req.url,
  )(req)
}

/** A public form admits bytes only for a file question it is accepting now. */
export let formUpload = (
  req: Request,
  store: Door,
): Promise<Response | null> => {
  let params = new URL(req.url).searchParams
  return store.consume(
    `${FORM}${encodeURIComponent(params.get('form') ?? '')}`,
    async (r) => {
      if (!r.ok) return r
      let why = noFile(await r.json() as Shown, params.get('question'))
      return why
        ? new Response(why, {
          status: 400,
          headers: { 'cache-control': 'no-store' },
        })
        : null
    },
    {},
    KERNEL,
  )
}
