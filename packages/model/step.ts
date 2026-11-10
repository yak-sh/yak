/**
 * One model step across two hosts. A step is one call of a `Model`: a request
 * in, a reply out. Here one host forwards the step and another answers it
 * from its own providers, which is how a provider comes to be a machine
 * (`provider{transport: 'machine', machine}`).
 *
 * The serving host mounts {@link answering} at {@link PATH} over whichever of
 * its providers it lends (`serving`, @yaks/model). The calling host builds a
 * `Model` with {@link forwarding} over whatever `fetch` reaches that host, or
 * one for each provider row a machine serves with {@link forwarded}.
 *
 * ```ts
 * import { answering, forwarding } from '@yaks/model/step'
 * import { equal } from '@yaks/testing'
 *
 * let answer = answering((req) =>
 *   Promise.resolve({
 *     id: 'r1',
 *     model: req.model,
 *     items: [{ kind: 'assistant', text: 'Hello' }],
 *   }), console.error)
 * let model = forwarding({ fetch: (at, init) => answer(new Request(at, init)) })
 * let reply = await model({ model: 'example', items: [], tools: [] })
 * equal(reply.items, [{ kind: 'assistant', text: 'Hello' }])
 * ```
 *
 * On the wire the step is a POST of the request as JSON (`frozenRequest`),
 * answered with server-sent events: `{first}` when the reply's first output
 * arrived, `{text}` for each `TextDelta`, then one `{reply}` or `{error}`. A
 * step that is quiet sends a comment every {@link BEAT} milliseconds, so the
 * caller's stall timeout measures the link between the hosts, and the serving
 * host's own measures its provider.
 *
 * @module
 */

import { type Clock, system } from '@yaks/fp'
import type { Comp, Eid, Graph } from '@yaks/graph'
import {
  type FrozenModelRequest,
  frozenRequest,
  thawedRequest,
} from './inference.ts'
import {
  type Model,
  ModelError,
  type Reply,
  type Request as Step,
  type TextDelta,
} from './mod.ts'
import type { Lent } from './provider.ts'
import { jsonFrames } from './sse.ts'
import { Stalled, stallMs, watched } from './stall.ts'
import { began, submitted } from './submission.ts'

/** Where a serving host answers a step. */
export const PATH = '/model/step'

/** Milliseconds between the comments a quiet step sends. */
export const BEAT = 15_000

// What crosses: the request without its callbacks, and its two timings.
type Asked = FrozenModelRequest & Pick<Step, 'cacheRetention' | 'stallTimeout'>

// One event of an answer's stream.
type Told =
  | { first: true }
  | { text: TextDelta }
  | { reply: Reply }
  | {
    error: Pick<ModelError, 'code' | 'message' | 'retry' | 'response'>
  }

let asked = (body: unknown): body is Asked => {
  let b = body as Partial<Asked> | null
  return !!b && typeof b.model == 'string' && Array.isArray(b.items) &&
    Array.isArray(b.tools)
}

/**
 * The serving host's end: a web handler that answers one step from `serve`
 * and streams it as it arrives. The caller hanging up, or cancelling the
 * answer, aborts the step's `signal`. A `ModelError` reaches the caller as it
 * was thrown; anything else is this host's bug, handed to `report`, and the
 * caller is told only that the step failed here (a `ModelError` coded
 * `serving`). A body that is no model request is refused with a 400.
 */
export let answering = (
  serve: Model,
  report: (error: unknown) => void,
  clock: Clock = system,
): (request: Request) => Promise<Response> =>
async (request) => {
  let step: unknown = await request.json().catch(() => null)
  if (!asked(step)) {
    return Response.json(
      { error: 'a step is a model request as JSON' },
      { status: 400 },
    )
  }
  let stop = new AbortController()
  let hung = () => stop.abort(request.signal.reason)
  if (request.signal.aborted) hung()
  else request.signal.addEventListener('abort', hung, { once: true })
  let encoder = new TextEncoder()
  let open = true
  let rest = () => {}
  let end = () => {
    open = false
    rest()
    request.signal.removeEventListener('abort', hung)
  }
  let body = new ReadableStream<Uint8Array>({
    start(out) {
      let put = (chunk: string) => {
        if (open) out.enqueue(encoder.encode(chunk))
      }
      let tell = (event: Told) => put(`data: ${JSON.stringify(event)}\n\n`)
      let beat = () => {
        rest = clock.after(BEAT, () => {
          put(':\n\n')
          beat()
        })
      }
      beat()
      Promise.resolve().then(() =>
        serve({
          ...thawedRequest(step),
          signal: stop.signal,
          onFirst: () => tell({ first: true }),
          onText: (text) => tell({ text }),
        })
      ).then((reply) => tell({ reply }), (error) => {
        // A stopped step has nobody to tell.
        if (stop.signal.aborted) return
        if (error instanceof ModelError) {
          let { code, message, retry, response } = error
          return tell({ error: { code, message, retry, response } })
        }
        report(error)
        tell({
          error: {
            code: 'serving',
            message: `the serving host failed (${(error as Error)?.name})`,
          },
        })
      }).finally(() => {
        if (open) out.close()
        end()
      })
    },
    cancel(reason) {
      end()
      stop.abort(reason)
    },
  })
  return new Response(body, {
    headers: {
      'content-type': 'text/event-stream',
      'cache-control': 'no-store',
    },
  })
}

// A machine that did not answer, or stopped answering, is `unreachable`; one
// that went quiet is `stalled`. Either may pass, so the caller may ask again
// or ask another provider.
let fault = (kind: string, message: string) =>
  new ModelError(kind == 'transport' ? 'unreachable' : kind, message, {})

/**
 * The calling host's end: a model that sends each step to the host `fetch`
 * reaches, at {@link PATH} under `base`, and answers with its reply: text as
 * it streams, the `usage` the serving provider counted, and no `cost`, since
 * what the step cost the serving host is not what it costs this one. The
 * request's `signal` stops the step on both hosts.
 *
 * A step asking for anything but text is refused (`modalities`): generated
 * media would stay in the serving host's store. A host that does not answer
 * fails as `unreachable` and one that goes quiet as `stalled`, both of which
 * may pass.
 */
export let forwarding = (
  lent: Pick<Lent, 'fetch'>,
  options: { base?: string; clock?: Clock } = {},
): Model =>
async (req) => {
  if (req.modalities?.some((m) => m != 'text')) {
    throw new ModelError(
      'modalities',
      'A step another machine serves writes text only',
    )
  }
  req.signal?.throwIfAborted()
  let { cacheRetention, stallTimeout } = req
  let sent: Asked = { ...frozenRequest(req), cacheRetention, stallTimeout }
  let ask = watched(lent.fetch, stallMs(req), options.clock)
  await submitted(req)
  try {
    let response = await ask((options.base ?? 'http://machine') + PATH, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        accept: 'text/event-stream',
      },
      body: JSON.stringify(sent),
      signal: req.signal,
    }).catch((error) => {
      throw error instanceof Stalled
        ? fault('stalled', `stalled — ${error.message}`)
        : fault('transport', (error as Error)?.message ?? String(error))
    })
    if (!response.ok || !response.body) {
      let body = await response.text().catch(() => '')
      throw new ModelError(
        'unreachable',
        `the serving host answered ${response.status}`,
        response.status >= 500 ? {} : undefined,
        { body },
      )
    }
    for await (let told of jsonFrames(response.body, fault)) {
      let event = told as Told
      began(req)
      if ('text' in event) req.onText?.(event.text)
      if ('error' in event) {
        let { code, message, retry, response } = event.error
        throw new ModelError(code, message, retry, response)
      }
      if ('reply' in event) {
        let { cost: _cost, costReported: _reported, ...reply } = event.reply
        return reply
      }
    }
    throw fault('transport', 'the step ended before its reply')
  } catch (error) {
    // A stop the caller asked for is thrown on as it came, however the
    // stopped exchange happened to end.
    req.signal?.throwIfAborted()
    throw error
  }
}

/**
 * The providers `g`'s rows say a machine serves
 * (`provider{transport: 'machine', machine}`), keyed by `provider.name`, each
 * forwarding its steps through the `fetch` that `reach` gives for its machine.
 * A row naming no machine, or a machine `reach` has no `fetch` for, is served
 * by nobody and left out.
 */
export let forwarded = async (
  g: Pick<Graph, 'read'>,
  reach: (machine: Eid) => typeof fetch | undefined,
): Promise<Record<string, Model>> => {
  let rows = await g.read('.provider.transport=machine')
  let served: Record<string, Model> = {}
  for (let row of rows) {
    let { name, machine } = row.provider as Comp
    let fetch = typeof machine == 'string' ? reach(machine) : undefined
    if (typeof name == 'string' && fetch) served[name] = forwarding({ fetch })
  }
  return served
}
