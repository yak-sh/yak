// A committed write on its way to the server as `POST /apply`, and the
// response.
//
// The local commit has already happened — this runs in the `effect` phase, and
// an effect is by definition post-commit — so every write here is optimistic:
// the page has already rendered it, and the server's response reconciles it
// rather than permitting it. Three responses are possible:
//
//   applied    the bundles come back as the server applied them — assigned
//              numbers, stamped properties, cascade deletions, what its rules
//              added — and they are applied locally in turn, marked as an echo
//              so they are not sent back again. What the page's own run of
//              those rules guessed is undone in the same batch, so the
//              server's answer replaces it.
//   refused    the server would not take it. The optimistic batch is undone
//              from the copy taken before it, with everything its rules added,
//              and the refusal is reported. A write that was held (a delete —
//              see sync.ts) was never applied locally, so there is nothing to
//              undo.
//   unreachable  nothing is undone. The write may have been applied on the
//              server with only the response lost, and a client that guesses
//              wrong about that turns a network blip into data loss.

import type { Bundle, Graph } from '@yaks/graph'
import { decode, stringify } from '@yaks/vocab/wire'
import { formed } from '@yaks/graph/bundle'
import { replicate } from './mark.ts'
import { guessed, inverse, outward } from './tier.ts'

/** The body of a server's refusal: the error's own name, its message, and
 * whatever fields it carried — a `Stale` names the property and the value the
 * graph holds. */
export type Refusal = { error: string; message: string; [k: string]: unknown }

/** The server deliberately refused the batch; none of it was accepted. */
export class WriteRefused extends Error {
  readonly outcome = 'refused'
  constructor(public sent: Bundle[], public refusal: Refusal) {
    super(refusal.message)
    this.name = refusal.error
  }
}

/** No usable acceptance or refusal arrived. Reconcile or retry `sent`;
 * the server may already have committed it. */
export class WriteUnknown extends Error {
  readonly outcome = 'unknown'
  constructor(public sent: Bundle[], cause: unknown) {
    super(
      `write outcome unknown: ${
        cause instanceof Error ? cause.message : String(cause)
      }`,
      { cause },
    )
    this.name = 'WriteUnknown'
  }
}

/** How a request is sent. The global `fetch` satisfies it, and so does an
 * in-process handler, which is how this package is tested with no network. */
export type Fetch = (request: Request) => Response | Promise<Response>

/** One outgoing write that was not applied on the server. */
export type Trouble = {
  /** the bundles as they were sent */
  sent: Bundle[]
  /** the server's refusal, when it responded with one */
  refused?: Refusal
  /** a transport or response failure: the server may have committed */
  error?: unknown
  /** whether the optimistic local change was undone */
  reverted: boolean
}

/** Where a failure is reported: a page shows it, a test collects it. */
export type Report = (trouble: Trouble) => void

/** What {@link post} needs: where to send, how, and where to put the answer. */
export type PostOpts = {
  graph: Graph
  url: string
  fetch: Fetch
  headers?: Record<string, string>
  report: Report
  /** A server-authoritative write already split from browser-owned state. */
  sent?: Bundle[]
  /** the write was held out of the local graph, not applied: a refusal has
   * nothing to revert */
  held?: boolean
  /** The write's idempotency key. Sending the same batch again under it is
   * the same write: a server that kept or applied it answers as it did the
   * first time, rather than taking it again. */
  key?: string
}

export type PostResult = {
  settled: boolean
  applied?: Bundle[]
  refused?: Refusal
  error?: unknown
}

// The refusal body, however the server phrased it. An endpoint that responded
// with plain text rather than JSON still produces a named error.
let refusalOf = async (res: Response): Promise<Refusal> => {
  let text = await res.text()
  try {
    let body = JSON.parse(text)
    if (body && typeof body == 'object' && typeof body.error == 'string') {
      return body as Refusal
    }
  } catch { /* not JSON: the text is the message */ }
  return { error: `HTTP ${res.status}`, message: text || res.statusText }
}

/**
 * Send one write to the server and reconcile the response. The result carries
 * the applied bundles for a caller that waited for the server to choose an eid.
 * `settled` is false only when the request outcome is unknown; an optimistic
 * caller then keeps its rows pinned.
 */
export let exchange = async (
  bundles: Bundle[],
  opts: PostOpts,
): Promise<PostResult> => {
  let { graph } = opts
  let sent = opts.sent ?? outward(bundles, graph.vocab)
  if (!sent.length) return { settled: true }
  let unknown = (cause: unknown): PostResult => {
    let error = new WriteUnknown(sent, cause)
    opts.report({ sent, error, reverted: false })
    return { settled: false, error }
  }
  let res: Response
  try {
    res = await opts.fetch(
      new Request(`${opts.url.replace(/\/$/, '')}/apply`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          ...opts.headers,
          ...(opts.key ? { 'idempotency-key': opts.key } : {}),
        },
        body: stringify(sent),
      }),
    )
  } catch (error) {
    // Undelivered is not refused: the write may have been applied.
    return unknown(error)
  }
  // A pending write is not an acceptance.
  if (res.status == 202) {
    return unknown(new Error(`HTTP ${res.status}`))
  }
  if (!res.ok) {
    let refused: Refusal
    try {
      refused = await refusalOf(res)
    } catch (error) {
      return unknown(error)
    }
    // The graph's explicit refusal body confirms rollback even at 500. A
    // generic gateway/server fault says nothing about whether it committed.
    if (res.status >= 500 && refused.error == `HTTP ${res.status}`) {
      return unknown(new Error(refused.message))
    }
    let back = opts.held ? [] : inverse(bundles, graph.vocab)
    if (back.length) await replicate(graph, back)
    opts.report({ sent, refused, reverted: back.length > 0 })
    return { settled: true, refused }
  }
  let applied: Bundle[]
  try {
    applied = formed(decode(graph.vocab, await res.json()))
  } catch (error) {
    return unknown(error)
  }
  let landing = [
    ...(opts.held ? [] : guessed(bundles, graph.vocab)),
    ...applied,
  ]
  if (landing.length) await replicate(graph, landing)
  return { settled: true, applied }
}

/** Send an optimistic or held write and say whether its outcome is known. */
export let post = async (bundles: Bundle[], opts: PostOpts): Promise<boolean> =>
  (await exchange(bundles, opts)).settled
