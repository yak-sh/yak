// A committed batch on its way to the server, and what comes back.
//
// The local commit has already happened — this runs on the `effect` phase, and
// an effect is by definition post-commit — so every write here is OPTIMISTIC:
// the page has already rendered it, and the server's answer is a reconciliation
// rather than a permission. Three answers are possible:
//
//   applied    the batch comes back as the server applied it — numbers,
//              stamps, casualties — and that batch is applied locally in turn,
//              marked as an echo so it is not sent again.
//   refused    the server would not take it. The optimistic change is undone
//              from the image captured before it, and the refusal is reported.
//   unreachable  nothing is undone. The batch may have landed and the answer
//              been lost, and a client that guesses wrong about that turns a
//              network blip into data loss.

import type { Bundle, Graph } from '@yaks/graph'
import { echo } from './mark.ts'
import { inverse, outward } from './tier.ts'

/** A server's refusal body: the error's own name, its message, and whatever
 * fields it carried — a `Stale` names the column and what the graph holds. */
export type Refusal = { error: string; message: string; [k: string]: unknown }

/** How a batch is sent. The global `fetch` satisfies it, and so does an
 * in-process handler, which is how this package is tested with no network. */
export type Fetch = (request: Request) => Response | Promise<Response>

/** One outbound batch that did not land. */
export type Trouble = {
  /** the batch as it was sent */
  sent: Bundle[]
  /** the server's refusal, when it answered with one */
  refused?: Refusal
  /** the transport error, when the batch never arrived */
  error?: unknown
  /** whether the optimistic local change was undone */
  reverted: boolean
}

/** Where trouble is surfaced: a page shows it, a test collects it. */
export type Report = (trouble: Trouble) => void

/** What {@link post} needs: where to send, how, and where to put the answer. */
export type PostOpts = {
  graph: Graph
  url: string
  fetch: Fetch
  headers?: Record<string, string>
  report: Report
}

// A refusal body, however the server phrased it. A door that answered with
// prose rather than JSON still names itself.
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
 * Send one committed batch to the server and reconcile the answer. Returns
 * when the exchange is over — the caller (the `effect` hook) does not wait for
 * it, so a local write stays as fast as the local store.
 */
export let post = async (
  batch: Bundle[],
  opts: PostOpts,
): Promise<void> => {
  let { graph } = opts
  let sent = outward(batch, graph.vocab)
  if (!sent.length) return // an entirely local batch: nothing to tell
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
    // Undelivered is not refused: the batch may have landed.
    opts.report({ sent, error, reverted: false })
    return
  }
  if (!res.ok) {
    let refused = await refusalOf(res)
    let back = inverse(batch)
    if (back.length) await graph.apply(echo(back), { trusted: true })
    opts.report({ sent, refused, reverted: back.length > 0 })
    return
  }
  let applied = await res.json() as Bundle[]
  if (Array.isArray(applied) && applied.length) {
    await graph.apply(echo(applied), { trusted: true })
  }
}
