// A committed write on its way to the server as `POST /apply`, and the
// response.
//
// The local commit has already happened — this runs in the `effect` phase, and
// an effect is by definition post-commit — so every write here is optimistic:
// the page has already rendered it, and the server's response reconciles it
// rather than permitting it. Three responses are possible:
//
//   applied    the bundles come back as the server applied them — assigned
//              numbers, stamped properties, cascade deletions — and they are
//              applied locally in turn, marked as an echo so they are not sent
//              back again.
//   refused    the server would not take it. The optimistic change is undone
//              from the copy taken before it, and the refusal is reported. A
//              write that was held (a delete — see sync.ts) was never applied
//              locally, so there is nothing to undo.
//   unreachable  nothing is undone. The write may have been applied on the
//              server with only the response lost, and a client that guesses
//              wrong about that turns a network blip into data loss.

import type { Bundle, Graph } from '@yaks/graph'
import { echo } from './mark.ts'
import { inverse, outward } from './tier.ts'

/** The body of a server's refusal: the error's own name, its message, and
 * whatever fields it carried — a `Stale` names the property and the value the
 * graph holds. */
export type Refusal = { error: string; message: string; [k: string]: unknown }

/** How a request is sent. The global `fetch` satisfies it, and so does an
 * in-process handler, which is how this package is tested with no network. */
export type Fetch = (request: Request) => Response | Promise<Response>

/** One outgoing write that was not applied on the server. */
export type Trouble = {
  /** the bundles as they were sent */
  sent: Bundle[]
  /** the server's refusal, when it responded with one */
  refused?: Refusal
  /** the transport error, when the request never arrived */
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
  /** the write was held out of the local graph, not applied: a refusal has
   * nothing to revert */
  held?: boolean
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
 * Send one committed write to the server as `POST /apply` and reconcile the
 * response. Resolves when the exchange is over — the caller (the `effect`
 * hook) does not await it, so a local write stays as fast as the local store.
 * Resolves to true when the outcome is known (applied, refused, or nothing to
 * send), and to false when the request failed and the outcome is unknown; in
 * that case retention has to keep the optimistic bundles pinned.
 */
export let post = async (
  batch: Bundle[],
  opts: PostOpts,
): Promise<boolean> => {
  let { graph } = opts
  let sent = outward(batch, graph.vocab)
  if (!sent.length) return true // an entirely local write: nothing to send
  let res: Response
  try {
    res = await opts.fetch(
      new Request(`${opts.url.replace(/\/$/, '')}/apply`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...opts.headers },
        body: JSON.stringify(sent),
      }),
    )
  } catch (error) {
    // Undelivered is not refused: the write may have been applied.
    opts.report({ sent, error, reverted: false })
    return false
  }
  if (!res.ok) {
    let refused = await refusalOf(res)
    let back = opts.held ? [] : inverse(batch)
    if (back.length) await graph.apply(echo(back), { trusted: true })
    opts.report({ sent, refused, reverted: back.length > 0 })
    return true
  }
  let applied = await res.json() as Bundle[]
  if (Array.isArray(applied) && applied.length) {
    await graph.apply(echo(applied), { trusted: true })
  }
  return true
}
