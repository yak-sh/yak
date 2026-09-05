// The whole thing, as one Durable Object: a bookshop whose graph lives in the
// object's SQLite and whose subscribers hear about every batch. It is a CLASS
// because the platform requires one — a Durable Object is a class the runtime
// constructs — and it is the only class in the package.
//
// Three handlers, and each is one line of plumbing:
//   fetch               @yaks/api's routes, with /ws taken first
//   webSocketMessage    a frame from a hibernatable socket
//   webSocketClose      that socket went away
//
// Copy it, swap the vocabulary for yours, and point a `wrangler.toml` binding
// at the class. The README carries the same code with the deploy steps.

import { api, type Handler, subscriptions } from '@yaks/api'
import { graph } from '@yaks/graph'
import { loadVocab, type VocabDoc } from '@yaks/vocab'
import {
  type DurableStorage,
  type Hibernation,
  type Sockets,
  sockets,
  storage,
  type Wire,
} from './mod.ts'

// In your Worker this is `DurableObjectState`, and you would write that. Here
// it is the slice of one this package needs, so the file compiles without
// pulling Cloudflare's globals into a type-check shared with every other
// package; workers_check.ts is where the runtime's own type is held to it.
type State = Hibernation & { storage: DurableStorage }

// The shop's vocabulary: JSON Schema plus the yaks keywords. A book is a `doc`
// (title and body) plus a `book` (price, status, who wrote it); deleting an
// author detaches their books rather than deleting them.
let doc: VocabDoc = {
  $defs: {
    entity: {
      type: 'object',
      wire: false,
      properties: { num: { type: 'number', stamped: true } },
    },
    doc: {
      type: 'object',
      kind: true,
      properties: {
        title: { type: 'string' },
        body: { type: 'string', store: 'blob' },
      },
    },
    book: {
      type: 'object',
      kind: true,
      before: ['doc'],
      properties: {
        price: { type: 'number' },
        status: { enum: ['shelved', 'sold'] },
        author: { type: 'string', ref: 'entity', death: 'detach' },
      },
    },
  },
}

let vocab = loadVocab(doc)

/**
 * One bookshop, in one Durable Object: `POST /apply` writes, `GET /query`
 * reads, and `/ws` is a live subscription that survives the object being
 * evicted between two batches.
 */
export class Bookshop {
  #live: Sockets
  #route: Handler

  /** @param ctx the object's own state — its storage and its sockets */
  constructor(ctx: State) {
    let store = storage(ctx.storage, vocab)
    // Create-if-not-exists, so every wake-up is safe.
    store.install()
    let shop = graph({ storage: store, vocab })
    // One registry, shared: the sockets push what the routes commit.
    let subs = subscriptions(shop)
    this.#live = sockets(subs, ctx)
    this.#route = api({ graph: shop, subs })
  }

  /** The object's door. `wake()` first: a batch applied by a request that
   * woke this object must still reach the sockets it inherited. */
  fetch(request: Request): Response | Promise<Response> {
    this.#live.wake()
    return new URL(request.url).pathname == '/ws'
      ? this.#live.accept(request)
      : this.#route(request)
  }

  /** A frame from a client: a subscription opened or closed. */
  webSocketMessage(ws: Wire, data: string | ArrayBuffer): void {
    this.#live.message(ws, data)
  }

  /** That client went away. */
  webSocketClose(ws: Wire): void {
    this.#live.close(ws)
  }
}
