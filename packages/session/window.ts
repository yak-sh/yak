/** Bounded, fork-aware transcript queries. This does not change model history. */
import type { Bundle, Comp, Eid, Graph } from '@yaks/graph'

export type TranscriptWindow = {
  /** Entry identity, not a global entity number. Absent means the newest page. */
  anchor?: Eid
  edge?: 'start' | 'end'
  /** Number of entry bodies to load, clamped to 1..256. */
  limit?: number
}
export type TranscriptPage = {
  entries: Bundle[]
  before: boolean
  after: boolean
}
export type TranscriptPlan = Omit<TranscriptPage, 'entries'> & {
  queries: string[]
}
type Segment = { session: Eid; through: number }
type Position = { entity: { eid: Eid }; entry: Comp }

/** A fork contributes a bounded prefix of each ancestor, followed by local rows. */
export let transcriptSegments = async (
  g: Graph,
  session: Eid,
): Promise<Segment[]> => {
  let segments: Segment[] = [], seen = new Set<Eid>(), through = Infinity
  while (!seen.has(session)) {
    seen.add(session)
    let [row] = await g.storage.tx((tx) => tx.get([session]))
    if (!row?.session) throw new Error('Unknown transcript: ' + session)
    segments.unshift({ session, through })
    let from = (row.fork as Comp | undefined)?.from
    if (!from) break
    let [anchor] = await g.read(
      '.eid=' + from + '&.fields=entry.session,entry.seq',
    )
    if (!anchor?.entry) break
    let entry = anchor.entry as Comp
    session = String(entry.session)
    through = Math.min(through, Number(entry.seq))
  }
  return segments
}
let base = (s: Segment) =>
  '.entry.session=' + s.session +
  (Number.isFinite(s.through) ? '&.entry.seq<=' + s.through : '')

/** Only positions are read while locating a page: no old content/blob bodies. */
export let transcriptPlan = async (
  g: Graph,
  session: Eid,
  request: TranscriptWindow = {},
): Promise<TranscriptPlan> => {
  let size = Math.max(1, Math.min(256, Math.floor(request.limit ?? 64)))
  if (!Number.isFinite(size)) throw new Error('Invalid transcript window limit')
  let segments = await transcriptSegments(g, session)
  let anchor: { segment: number; seq: number } | undefined
  if (request.anchor && !request.edge) {
    let [row] = await g.read(
      '.eid=' + request.anchor + '&.fields=entry.session,entry.seq',
    )
    let entry = row?.entry as Comp | undefined
    let segment = segments.findIndex((s) =>
      s.session == entry?.session && Number(entry.seq) <= s.through
    )
    if (segment >= 0) anchor = { segment, seq: Number(entry!.seq) }
  }
  let positions = async (
    direction: 'before' | 'after',
    n: number,
  ): Promise<Position[]> => {
    let found: Position[] = []
    let order = direction == 'before' ? '-' : ''
    let indices = segments.map((_, i) => i)
    if (direction == 'before') indices.reverse()
    for (let i of indices) {
      if (
        anchor &&
        (direction == 'before' ? i > anchor.segment : i < anchor.segment)
      ) continue
      let bound = anchor && i == anchor.segment
        ? '&.entry.seq' + (direction == 'before' ? '<' : '>=') + anchor.seq
        : ''
      let rows = await g.read(
        base(segments[i]) + bound + '&.fields=entry.session,entry.seq&.order=' +
          order + 'entry.seq&.limit=' + (n - found.length),
      )
      found.push(...rows as Position[])
      if (found.length >= n) break
    }
    return found
  }
  let chosen: Position[], before: boolean, after: boolean
  if (anchor) {
    let left = await positions('before', Math.floor(size / 2) + 1)
    let right = await positions(
      'after',
      size - Math.min(left.length, Math.floor(size / 2)) + 1,
    )
    // Near the end, use unused right-hand capacity for older entries.
    let leftSize = size -
      Math.min(right.length, size - Math.min(left.length, Math.floor(size / 2)))
    if (leftSize > Math.floor(size / 2)) {
      left = await positions('before', leftSize + 1)
    }
    let rightSize = size - Math.min(left.length, leftSize)
    before = left.length > leftSize
    after = right.length > rightSize
    chosen = [
      ...left.slice(0, leftSize).reverse(),
      ...right.slice(0, rightSize),
    ]
  } else {
    let start = request.edge == 'start'
    chosen = await positions(start ? 'after' : 'before', size + 1)
    before = !start && chosen.length > size
    after = start && chosen.length > size
    chosen = chosen.slice(0, size)
    if (!start) chosen.reverse()
  }
  // Bound subscriptions to the page's entry intervals. Membership/updates still
  // travel through ordinary graph queries, API subscriptions and sync frames.
  let queries: string[] = []
  for (let s of segments) {
    let own = chosen.filter((r) => r.entry.session == s.session)
    if (!own.length) continue
    let low = Number(own[0].entry.seq), high = Number(own.at(-1)!.entry.seq)
    queries.push(
      base(s) + '&.entry.seq>=' + low + '&.entry.seq<=' + high +
        '&.order=entry.seq&.limit=' + size,
    )
  }
  return { queries, before, after }
}

export let transcriptWindow = async (
  g: Graph,
  session: Eid,
  request?: TranscriptWindow,
): Promise<TranscriptPage> => {
  let plan = await transcriptPlan(g, session, request)
  return {
    entries: (await Promise.all(plan.queries.map((q) => g.read(q)))).flat(),
    before: plan.before,
    after: plan.after,
  }
}

/** Latest reported usage in a logical fork transcript, without reading prose. */
export let transcriptUsage = async (
  g: Graph,
  session: Eid,
): Promise<Bundle[]> => {
  for (let segment of (await transcriptSegments(g, session)).reverse()) {
    let rows = await g.read(
      base(segment) +
        '&.ask&.usage&.fields=ask.to,ask.through,usage.input_tokens,usage.output_tokens,usage.total_tokens,usage.cached_tokens,usage.reasoning_tokens&.order=-entry.seq&.limit=1',
    )
    if (rows.length) return rows
  }
  return []
}
