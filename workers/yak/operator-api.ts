// The Operator's store as its page reads and writes it: @yaks/api's `/apply`,
// `/query` and `/ws`, each request as the person the kernel vouched for. Many
// people share a space's store, so each reads only what is theirs or nobody's
// (operator-access.ts `sight`), on the socket too, a reply's text as it is
// written included (@yaks/api's transient frames go to a subscription's
// members alone), and writes only what is theirs to write (`mayWrite`).
//
// The object the store stands in (build.ts) hands this its `/api/*` requests
// and the sockets it accepted; its other sockets (a build's page, a lent
// browser, a page on the Operator's frames from before) are not this door's.
import { api, type Handler, subscriptions } from '@yaks/api'
import { type Hibernation, sockets } from '@yaks/durable-object'
import type { Graph } from '@yaks/graph'
import { mayWrite, sight } from './operator-access.ts'
import type { OperatorStore } from './operator-store.ts'
import { paged } from './build-door.ts'

/** Who a request is from, as the kernel said: a person in a space. */
export type Asker = { person: string; space: string }

/** @yaks/api over `store`, its sockets among the object's (`ctx`). */
export let operatorApi = (
  store: OperatorStore,
  ctx: Hibernation,
  report?: (error: Error) => void,
) => {
  let subs = subscriptions(store.g)
  let live = sockets(
    subs,
    {
      acceptWebSocket: (ws) => ctx.acceptWebSocket(ws),
      getWebSockets: () =>
        ctx.getWebSockets().filter((ws) => paged(ws.deserializeAttachment())),
      storage: ctx.storage,
    },
    report,
    {
      // A socket keeps who opened it, and is read with their sight as it
      // stands on every wake.
      read: (read) => ({ ...read, ...sight(store, String(read?.person)) }),
    },
  )
  // The store as `who` writes it: what is theirs, or nothing in the batch.
  let writing = (who: Asker): Graph => ({
    ...store.g,
    apply: async (bundles, opts) => {
      await mayWrite(store, who, bundles)
      return store.g.apply(bundles, opts)
    },
  })
  let as = (who: Asker): Handler =>
    api({
      graph: writing(who),
      subs,
      authenticate: () => ({ by: who.person }),
      read: () => sight(store, who.person),
    })
  return {
    /** `/api/apply`, `/api/query` or `/api/ws`, asked by `who`. */
    answer: (request: Request, who: Asker): Response | Promise<Response> => {
      let url = new URL(request.url)
      url.pathname = url.pathname.slice('/api'.length)
      return url.pathname == '/ws'
        ? live.accept(request, { person: who.person })
        : as(who)(new Request(url, request))
    },
    /** A frame from one of its sockets: the object's `webSocketMessage`. */
    message: live.message,
    /** One of its sockets closed: the object's `webSocketClose`. */
    close: live.close,
    /** Its sockets' subscriptions opened again, as the object wakes. */
    wake: live.wake,
  }
}
