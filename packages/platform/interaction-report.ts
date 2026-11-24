import { holding } from '@yaks/blob/stream'
import { derivedEid, minted } from '@yaks/graph/identity'
import type { Bundle } from '@yaks/graph'
import {
  type Batch,
  interactionName,
  interactionRows,
  MAX_MS,
  MAX_POINTS,
  type Point,
  SLOW,
} from '@yaks/timing/interaction'
import { capture, type Context, type Sink } from '@yaks/tracker/report'
import { interactionPage, interactionTarget } from './interaction.ts'

let MAX_BODY = 8192
let OBJECT = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value == 'object' && !Array.isArray(value)
let duration = (n: unknown): n is number =>
  typeof n == 'number' && n >= 0 && n <= MAX_MS

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

let batch = (value: unknown, now: number): Batch | undefined => {
  if (!OBJECT(value)) return
  let { id, at, points } = value
  if (
    typeof id != 'string' || id.length != 36 || !minted(id) ||
    typeof at != 'number' || !Number.isSafeInteger(at) ||
    Math.abs(at - now) > 10 * 60_000 ||
    !Array.isArray(points) || !points.length || points.length > MAX_POINTS
  ) return
  let safe = points.map(point)
  if (safe.every((p) => p != null)) return { id, at, points: safe }
}

type Reporting = {
  sink: Sink
  now?: () => number
  commit?: string
  environment?: Context['environment']
  failed: (error: unknown) => void
}

let rows = (
  seen: Batch,
  { sink, commit, environment }: Reporting,
): Bundle[] => [
  ...interactionRows(seen, commit),
  ...seen.points.flatMap((p, i) => {
    if (p.ms <= SLOW) return []
    let name = interactionName(p)
    return capture({
      name: 'Slow interaction',
      message: `${name} took ${Math.round(p.ms)} ms`,
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
  let got = batch(value, (reporting.now ?? Date.now)())
  if (got) {
    try {
      await reporting.sink(rows(got, reporting))
    } catch (error) {
      reporting.failed(error)
    }
  }
  return empty()
}
