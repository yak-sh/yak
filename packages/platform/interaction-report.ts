import { holding } from '@yaks/blob/stream'
import { derivedEid, minted } from '@yaks/graph/identity'
import type { Bundle } from '@yaks/graph'
import {
  type Batch,
  DEVICES,
  interactionName,
  interactionRows,
  MAX_MS,
  MAX_POINTS,
  type Navigation,
  NAVIGATION_DETAILS,
  type Open,
  OPEN_SOURCES,
  openMilestones,
  openName,
  type Point,
} from '@yaks/timing/interaction'
import { capture, type Context, type Sink } from '@yaks/tracker/report'
import {
  ANSWERS,
  budgetOf,
  interactionPage,
  interactionTarget,
  reloading,
  unexpected,
} from './interaction.ts'

let MAX_BODY = 8192
let OBJECT = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value == 'object' && !Array.isArray(value)
let duration = (n: unknown): n is number =>
  typeof n == 'number' && n >= 0 && n <= MAX_MS
let milestone = (n: unknown): n is number | null => n === null || duration(n)

let navigationOf = (value: unknown): Navigation | undefined => {
  if (!OBJECT(value)) return
  let { workerStart, fetchStart, requestStart, responseStart } = value
  if (
    duration(workerStart) && duration(fetchStart) && duration(requestStart) &&
    duration(responseStart)
  ) {
    let navigation = {
      workerStart,
      fetchStart,
      requestStart,
      responseStart,
    } as Navigation
    for (let key of NAVIGATION_DETAILS) {
      let n = value[key]
      if (duration(n)) navigation[key] = n
    }
    return navigation
  }
}

let opening = (value: unknown): Open | undefined => {
  if (!OBJECT(value)) return
  let {
    source,
    picture,
    device,
    installed,
    paint,
    usable,
    server,
    estimated,
    controlled,
  } = value as Partial<Open>
  if (
    !source || !OPEN_SOURCES.includes(source) ||
    !device || !DEVICES.includes(device) ||
    typeof picture != 'boolean' ||
    source != 'push' && picture != (source == 'picture' || source == 'shell') ||
    typeof installed != 'boolean' || typeof estimated != 'boolean' ||
    controlled != null && typeof controlled != 'boolean' ||
    !milestone(paint) || !milestone(usable) || !milestone(server) ||
    paint != null && usable != null && usable < paint
  ) return
  let navigation = navigationOf(value.navigation)
  return {
    source,
    picture,
    device,
    installed,
    paint,
    usable,
    server,
    estimated,
    ...controlled == null ? {} : { controlled },
    ...navigation ? { navigation } : {},
  }
}

let point = (value: unknown): Point | undefined => {
  if (!OBJECT(value)) return
  let { page, target, ms, input, server, script, render } = value
  if (
    typeof page != 'string' || !interactionPage(page) ||
    typeof target != 'string' || !interactionTarget(target) ||
    !duration(ms) || !duration(input) || !duration(server) ||
    !duration(script) || !duration(render) ||
    Math.abs(ms - input - server - script - render) > 1
  ) return
  return { page, target, ms, input, server, script, render }
}

let batch = (
  value: unknown,
  now: number,
  opened: boolean,
): Batch | undefined => {
  if (!OBJECT(value)) return
  let { id, at, points } = value
  if (
    typeof id != 'string' || id.length != 36 || !minted(id) ||
    typeof at != 'number' || !Number.isSafeInteger(at) ||
    at > now + 10 * 60_000 ||
    now - at > (opened ? 24 * 60 : 10) * 60_000 ||
    !Array.isArray(points) || points.length > MAX_POINTS
  ) return
  if (opened && !points.length) {
    let open = opening(value.open)
    if (open) return { id, at, points: [], open }
  }
  if (!points.length || value.open != null) return
  let safe = points.map(point)
  if (safe.every((p) => p != null)) return { id, at, points: safe }
}

type Reporting = {
  sink: Sink
  now?: () => number
  commit?: string
  environment?: Context['environment']
  opened?: { page: string; person?: string | null }
  failed: (error: unknown) => void
}

let slowOpen = (
  seen: Batch,
  { sink, commit, environment, opened }: Reporting,
): Bundle[] => {
  let open = seen.open
  if (!open || !opened) return []
  return openMilestones(open).flatMap(({ name, ms, budget }) => {
    if (ms == null || ms <= budget) return []
    let kind = openName(opened.page, open, name)
    return capture({
      name: 'Slow interaction',
      message: `${kind} took ${Math.round(ms)} ms (budget ${budget} ms)`,
    }, {
      sink,
      commit,
      environment,
      eid: derivedEid(`open|${seen.id}|${name}`),
      at: new Date(seen.at).toISOString(),
      fault: `interaction|${kind}`,
      during: { kind: 'browser interaction' },
      tags: {
        page: opened.page,
        source: open.source,
        device: open.device,
        ms,
        budget,
        ...open.server == null ? {} : { server: open.server },
        ...open.navigation,
        ...open.controlled == null ? {} : { controlled: open.controlled },
        account: 'person',
        entrypoint: 'browser interaction',
      },
    })
  })
}

let rows = (
  seen: Batch,
  reporting: Reporting,
): Bundle[] => [
  ...interactionRows(seen, reporting.commit, reporting.opened),
  ...slowOpen(seen, reporting),
  ...seen.points.flatMap((p, i) => {
    let { sink, commit, environment } = reporting
    let name = interactionName(p)
    let cause = unexpected(p.target)
    let budget = budgetOf(p.target)
    // A reload is counted, never a slow press: its time is the page
    // standing blank until the new one paints. One nobody chose is a bug.
    if (!cause && (p.ms <= budget || reloading(p.target))) return []
    return capture({
      name: cause ? 'Unexpected reload' : 'Slow interaction',
      message: cause
        ? `${p.page} reloaded under the person (${cause}), blank ${
          Math.round(p.ms)
        } ms`
        : `${name} took ${Math.round(p.ms)} ms${
          Object.hasOwn(ANSWERS, p.target) ? ` (budget ${budget} ms)` : ''
        }`,
    }, {
      sink,
      commit,
      environment,
      eid: derivedEid(`interaction|${seen.id}|${i}`),
      at: new Date(seen.at).toISOString(),
      fault: `interaction|${name}`,
      during: { kind: 'browser interaction' },
      tags: { ...p, account: 'person', entrypoint: 'browser interaction' },
    })
  }),
]

/** Accept a bounded batch of value-free timings. Its immutable rows can be
 * redelivered without inflating the digest or a bug's occurrence count. */
export let reportInteractions = async (
  req: Request,
  reporting: Reporting,
): Promise<Response> => {
  let empty = () => new Response(null, { status: 204 })
  if (req.method != 'POST' || !req.body) return empty()
  let bytes = await holding({ stream: req.body }, MAX_BODY)
  if (!(bytes instanceof Uint8Array)) {
    await bytes.stream.cancel()
    return empty()
  }
  let value: unknown
  try {
    value = JSON.parse(new TextDecoder().decode(bytes))
  } catch {
    return empty()
  }
  let got = batch(value, (reporting.now ?? Date.now)(), !!reporting.opened)
  if (got) {
    try {
      await reporting.sink(rows(got, reporting))
    } catch (error) {
      reporting.failed(error)
    }
  }
  return empty()
}
