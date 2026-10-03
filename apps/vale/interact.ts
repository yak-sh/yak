// One mouse-weighted interaction owns both its prompt and the E action.
// A click holds a reachable target; without a pointer, work keeps priority.
import type { Point } from './aim.ts'
import type { Frame } from './play.ts'
import type { Job } from './work.ts'

type Targets = {
  near: Pick<NonNullable<Job['near']>, 'eid' | 'at' | 'near'> | null
  bench: Job['bench']
  board: Pick<NonNullable<Job['board']>, 'at' | 'near'> | null
}
type Friendly = Pick<Frame, 'point' | 'friendly'> & {
  talk: Pick<NonNullable<Frame['talk']>, 'id' | 'x' | 'y' | 'z' | 'near'> | null
  peer: {
    eid: string
    body: { x: number; y: number; z: number }
  } | null
}

export let friendlyKey = (kind: string, at: number[]) =>
  `${kind}/${at.join('/')}`

/** Pointing weighs proximity to the mouse; a clicked target wins in reach. */
export let nearby = <T>(
  rows: T[],
  point: Point | undefined,
  chosen: string | undefined,
  key: (row: T) => string,
  spot: (row: T) => { x: number; z: number },
  distance: (row: T) => number,
): T | null => {
  let held = chosen && rows.find((r) => key(r) == chosen)
  if (held) return held
  let score = (r: T) =>
    point
      ? Math.hypot(spot(r).x - point.x, spot(r).z - point.z) + distance(r) * 0.1
      : distance(r)
  return rows.reduce<T | null>(
    (best, row) => !best || score(row) < score(best) ? row : best,
    null,
  )
}

export let interaction = (
  f: Friendly,
  job: Targets,
): 'node' | 'bench' | 'board' | 'talk' | 'peer' | null => {
  if (!f.point && !f.friendly) {
    return job.near
      ? 'node'
      : job.bench
      ? 'bench'
      : job.board
      ? 'board'
      : f.talk
      ? 'talk'
      : f.peer
      ? 'peer'
      : null
  }
  let candidates = [
    job.near &&
    { kind: 'node', key: job.near.eid, at: job.near.at, near: job.near.near },
    job.bench &&
    {
      kind: 'bench',
      key: friendlyKey(job.bench.craft, job.bench.at),
      at: job.bench.at,
      near: job.bench.near,
    },
    job.board &&
    {
      kind: 'board',
      key: friendlyKey('board', job.board.at),
      at: job.board.at,
      near: job.board.near,
    },
    f.talk &&
    {
      kind: 'talk',
      key: f.talk.id,
      at: [f.talk.x, f.talk.y, f.talk.z],
      near: f.talk.near,
    },
    f.peer &&
    {
      kind: 'peer',
      key: f.peer.eid,
      at: [f.peer.body.x, f.peer.body.y, f.peer.body.z],
      near: 0,
    },
  ].filter((r): r is NonNullable<typeof r> => !!r)
  let held = f.friendly
    ? candidates.find((r) => r.key == f.friendly)
    : undefined
  let pointed = f.point &&
    candidates.filter((r) =>
      Math.hypot(r.at[0] - f.point!.x, r.at[2] - f.point!.z) < 2
    )
  let target = held ??
    (pointed?.length
      ? nearby(
        pointed,
        f.point,
        undefined,
        (r) => r.key,
        (r) => ({ x: r.at[0], z: r.at[2] }),
        (r) => r.near,
      )
      : candidates[0])
  let kind = target?.kind
  return kind == 'node' || kind == 'bench' || kind == 'board' ||
      kind == 'talk' || kind == 'peer'
    ? kind
    : null
}

export let workTarget = (target: ReturnType<typeof interaction>) =>
  target == 'node' || target == 'bench' || target == 'board'

/** Only the chosen target may offer an interaction prompt this frame. */
export let prompted = <
  T extends { near: unknown; bench: unknown; board: unknown },
>(
  job: T,
  target: ReturnType<typeof interaction>,
): Omit<T, keyof Targets> & { [K in keyof Targets]: T[K] | null } => ({
  ...job,
  near: target == 'node' ? job.near : null,
  bench: target == 'bench' ? job.bench : null,
  board: target == 'board' ? job.board : null,
})
