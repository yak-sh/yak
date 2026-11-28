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

// Each timestamp the browser gave, kept on its own: WebKit omits some, and
// one missing never loses the rest.
let navigationOf = (value: unknown): Navigation | undefined => {
  if (!OBJECT(value)) return
  let navigation: Navigation = {}
  for (let key of NAVIGATION_DETAILS) {
    let n = value[key]
    if (duration(n)) navigation[key] = n
  }
  return Object.keys(navigation).length ? navigation : undefined
}

let STAGE = /^[a-z]{1,16}$/

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
    stage,
    left,
    hidden,
    parsed,
    frame,
    unseen,
    gateway,
  } = value as Partial<Open>
  if (
    !source || !OPEN_SOURCES.includes(source) ||
    !device || !DEVICES.includes(device) ||
    typeof picture != 'boolean' ||
    source != 'push' && picture != (source == 'picture' || source == 'shell') ||
    typeof installed != 'boolean' || typeof estimated != 'boolean' ||
    controlled != null && typeof controlled != 'boolean' ||
    stage != null && !(typeof stage == 'string' && STAGE.test(stage)) ||
    left != null && typeof left != 'boolean' ||
    hidden != null && typeof hidden != 'boolean' ||
    unseen != null && typeof unseen != 'boolean' ||
    parsed != null && !duration(parsed) || frame != null && !duration(frame) ||
    gateway != null && !duration(gateway) ||
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
    ...stage == null ? {} : { stage },
    ...left ? { left } : {},
    ...hidden ? { hidden } : {},
    ...parsed == null ? {} : { parsed },
    ...frame == null ? {} : { frame },
    ...unseen ? { unseen } : {},
    ...gateway == null ? {} : { gateway },
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

// A sample past its budget is slow, and past twice its budget it is a
// failure. Within that, a phone's busy frame is enough to cross the line: a
// warning, which the tracker files under no bug and the daily digest's chart
// counts.
let graded = (ms: number, budget: number): Context['level'] =>
  ms > 2 * budget ? 'error' : 'warning'

type Reporting = {
  sink: Sink
  now?: () => number
  commit?: string
  environment?: Context['environment']
  opened?: { page: string; person?: string | null }
  /** The app a report came from, as `space/app`: a slow app page is one
   * app's, and only its name says which. */
  app?: string
  failed: (error: unknown) => void
}

// Grade direct cold opens from the document request. The timing rows still
// count everything since navigation began. Redirects and service workers
// can do platform work before the final document request.
let requestOffset = (open: Open): number => {
  let nav = open.navigation
  if (
    open.source != 'cold' || open.controlled !== false ||
    nav?.workerStart !== 0 || nav.redirectCount !== 0 ||
    nav.redirectStart || nav.redirectEnd
  ) return 0
  let { requestStart, responseStart } = nav
  let first = open.paint ?? open.usable
  return requestStart && responseStart != null && first != null &&
      (nav.fetchStart ?? 0) <= requestStart && requestStart <= responseStart &&
      responseStart <= first
    ? requestStart
    : 0
}

// An open begun hidden (a tab opened behind the one in front) paints only
// once it is shown: its times are how long it stood unseen, which nobody
// waited for, so they are counted but never judged against a budget.
let slowOpen = (
  seen: Batch,
  { sink, commit, environment, opened, app }: Reporting,
): Bundle[] => {
  let open = seen.open
  if (!open || !opened || open.unseen) return []
  let offset = requestOffset(open)
  return openMilestones(open).flatMap(({ name, ms: elapsed, budget }) => {
    if (elapsed == null) return []
    let ms = elapsed - offset
    if (ms <= budget) return []
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
      level: graded(ms, budget),
      fault: `interaction|${kind}`,
      during: { kind: 'browser interaction' },
      tags: {
        page: opened.page,
        ...app ? { app } : {},
        source: open.source,
        device: open.device,
        ms,
        ...offset ? { elapsed } : {},
        budget,
        ...open.server == null ? {} : { server: open.server },
        ...open.gateway == null ? {} : { gateway: open.gateway },
        estimated: open.estimated,
        ...open.parsed == null ? {} : { parsed: open.parsed },
        ...open.frame == null ? {} : { frame: open.frame },
        ...open.unseen ? { unseen: true } : {},
        ...open.navigation,
        ...open.controlled == null ? {} : { controlled: open.controlled },
        ...open.usable == null ? { usable: null } : {},
        ...open.stage == null ? {} : { stage: open.stage },
        ...open.left ? { left: true } : {},
        ...open.hidden ? { hidden: true } : {},
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
    let { sink, commit, environment, app } = reporting
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
      level: cause ? 'error' : graded(p.ms, budget),
      fault: `interaction|${name}`,
      during: { kind: 'browser interaction' },
      tags: {
        ...p,
        ...app ? { app } : {},
        account: 'person',
        entrypoint: 'browser interaction',
      },
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
