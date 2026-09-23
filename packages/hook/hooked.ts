// A request another system delivered, as the bundles that record it.
//
// Pure: a request in, bundles out. Who received it, and whether its signature
// held, are the receiver's to say; this names the event and keeps the rest as
// it arrived.
//
// The event name is read in order of how much the sender said: its own header
// (`x-github-event`), then a JSON body's `event`, `type` or `action`, then the
// route itself. A source nobody wrote a parser for still lands whole.
//
// The entity id is derived from where the request came from and the id the
// receiver gave it, so recording the same request twice writes one entity — a
// receiver that crashed after writing and before acknowledging only repeats
// itself.

import { type Bundle, derivedEid, type Eid } from '@yaks/graph'
import { DOC } from '@yaks/doc'
import { link } from '@yaks/edge'

/** A delivered request, as its receiver captured it. */
export type Request = {
  /** the id the receiver gave it — with `source`, what makes it one entity */
  id: string
  /** who sent it */
  source: string
  /** the HTTP method it arrived by */
  method?: string
  /** the path it arrived on */
  path?: string
  /** the headers as sent: a JSON object, as text */
  headers?: string
  /** the body exactly as delivered */
  body?: string
  /** whether the sender's signature verified, where the receiver checked */
  verified?: boolean
}

// A header off the captured set, by name, case-insensitively.
let header = (r: Request, name: string): string | undefined => {
  try {
    let all = JSON.parse(r.headers ?? '{}') as Record<string, string>
    let k = Object.keys(all).find((k) => k.toLowerCase() == name)
    return k ? all[k] : undefined
  } catch {
    return undefined
  }
}

// The event word a JSON body names, if it names one.
let bodyEvent = (r: Request): string | undefined => {
  try {
    let b = JSON.parse(r.body ?? '') as Record<string, unknown>
    let k = ['event', 'type', 'action'].find((k) =>
      typeof b[k] == 'string' && b[k]
    )
    return k ? String(b[k]) : undefined
  } catch {
    return undefined
  }
}

/**
 * The event a request reports, best first.
 *
 * ```ts
 * import { event } from '@yaks/hook'
 * event({ id: '1', source: 'gh', headers: '{"X-GitHub-Event":"push"}' }) // 'push'
 * event({ id: '2', source: 'ph', body: '{"type":"issue"}' })             // 'issue'
 * event({ id: '3', source: 'x', method: 'POST', path: '/hook/a' })       // 'POST /hook/a'
 * ```
 */
export let event = (r: Request): string =>
  header(r, 'x-github-event') ?? header(r, 'x-event-key') ?? bodyEvent(r) ??
    `${r.method ?? 'POST'} ${r.path ?? '/'}`

/** The id a request is recorded under: the same request, the same entity. */
export let hookEid = (r: Request): Eid => derivedEid(`hook|${r.source}|${r.id}`)

/**
 * A delivered request → the bundles that record it: a `hook` carrying it as it
 * arrived, a `doc` title naming it, and an `about` link to the entity it is
 * for when the receiver knows one. Every `hook` property is server-owned, so
 * apply these trusted.
 */
export let hooked = (r: Request, about?: Eid): Bundle[] => {
  let eid = hookEid(r)
  let said = event(r)
  return [
    {
      entity: { eid },
      [DOC]: { title: `${r.source}: ${said}` },
      hook: {
        source: r.source,
        event: said,
        ...(r.body == null ? {} : { payload: r.body }),
        ...(r.method == null ? {} : { method: r.method }),
        ...(r.path == null ? {} : { path: r.path }),
        ...(r.headers == null ? {} : { headers: r.headers }),
        ...(r.verified == null ? {} : { verified: r.verified }),
      },
    },
    ...(about ? [link(eid, 'about', about)] : []),
  ]
}
