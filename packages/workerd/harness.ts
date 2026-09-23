// Shared test fixtures (not part of the published package — see deno.json).
// These tests cannot run inside a Worker, so the two Cloudflare features this
// package uses are replaced with stand-ins: a `WebSocketPair` installed on the
// global object, and a Durable Object namespace that is a Map of stubs. The
// graph under them is a bookshop kept in memory, so nothing here needs a
// database or anything defined outside this file.

import type { Frame, Socket } from '@yaks/api'
import { type Graph, graph } from '@yaks/graph'
import { ram } from '@yaks/ram'
import { loadVocab, type Vocab, type VocabDoc } from '@yaks/vocab'
import type { Namespace, Stub } from './stub.ts'

let doc: VocabDoc = {
  $defs: {
    entity: {
      component: true,
      type: 'object',
      wire: false,
      properties: { num: { type: 'number', stamped: true } },
    },
    doc: {
      component: true,
      type: 'object',
      kind: true,
      properties: { title: { type: 'string' }, body: { type: 'string' } },
    },
    book: {
      component: true,
      type: 'object',
      kind: true,
      before: ['doc'],
      properties: {
        price: { type: 'number' },
        status: { type: 'string', enum: ['draft', 'shelved', 'sold'] },
      },
    },
    created: {
      component: true,
      type: 'object',
      properties: {
        at: { type: 'string', format: 'date-time', stamped: true },
        by: { type: 'string', ref: 'entity', death: 'keep', stamped: true },
      },
    },
  },
}

/** The bookshop vocabulary these tests read and write against. */
export let shop: Vocab = loadVocab(doc)

/** A graph over a fresh in-memory store. */
export let shopGraph = (): Graph => graph({ storage: ram(shop), vocab: shop })

/** A request against the test host, from a path. */
export let req = (path: string, init: RequestInit = {}): Request =>
  new Request(`https://shop.test${path}`, init)

/** A `POST /apply` request carrying a list of changes as its JSON body. */
export let post = (path: string, body: unknown): Request =>
  req(path, { method: 'POST', body: JSON.stringify(body) })

/** One half of a stand-in pair: it records the frames sent to it, `emit` fires
 * the events a live socket would fire, and `accepted` reports whether the
 * server accepted its half. */
export type Half = Socket & {
  /** the frames sent to this half, parsed */
  sent: Frame[]
  /** whether `accept()` has been called on it */
  accepted: boolean
  /** start handling frames, as the runtime's own half does */
  accept: () => void
  /** fire an event at the listeners something registered */
  emit: (type: string, data?: unknown) => void
  /** the frames sent since the last call, clearing them */
  taken: () => Frame[]
}

let half = (): Half => {
  let at: Record<string, ((event: Event & { data?: unknown }) => void)[]> = {}
  let sent: Frame[] = []
  return {
    readyState: 1,
    accepted: false,
    sent,
    accept() {
      this.accepted = true
    },
    send: (data) => {
      sent.push(JSON.parse(data))
    },
    addEventListener: (type, listener) => {
      ;(at[type] ??= []).push(listener)
    },
    emit: (type, data) => {
      let event = type == 'message'
        ? new MessageEvent('message', { data })
        : new Event(type)
      for (let l of at[type] ?? []) l(event)
    },
    taken: () => sent.splice(0, sent.length),
  }
}

/** Every pair created since the stand-in was installed, newest last. */
export let made: Pair[] = []

/** The stand-in `WebSocketPair`. A class, because that is what the runtime
 * provides: two halves on one object, client first, created with `new`. */
export class Pair {
  /** the half handed back to the client on the 101 */
  0: Half
  /** the half the Worker keeps */
  1: Half
  constructor() {
    this[0] = half()
    this[1] = half()
    made.push(this)
  }
}

/** Put {@link Pair} on the global object where the adapter looks for it, and
 * return the function that removes it again. */
export let installPair = (): () => void => {
  made.length = 0
  Reflect.set(globalThis, 'WebSocketPair', Pair)
  return () => {
    Reflect.deleteProperty(globalThis, 'WebSocketPair')
  }
}

/** A Durable Object namespace that is a Map: one stub per name, each recording
 * the requests forwarded to it. */
export let namespace = (
  answer: (name: string, request: Request) => Response = () =>
    new Response('ok'),
): Namespace & { seen: { name: string; request: Request }[] } => {
  let seen: { name: string; request: Request }[] = []
  let stubs = new Map<string, Stub>()
  return {
    seen,
    idFromName: (name) => name,
    get: (id) => {
      let name = String(id)
      let stub = stubs.get(name)
      if (!stub) {
        stub = {
          fetch: (request) => {
            seen.push({ name, request })
            return Promise.resolve(answer(name, request))
          },
        }
        stubs.set(name, stub)
      }
      return stub
    },
  }
}
