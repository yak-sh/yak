// A web keeps one minute of sparse CPU samples. A late tick asks for the
// stacks inside its gap, before starting a fresh profile. Inspector sessions
// are in-process: no debugging port or listener is opened.
import { type Profiler, Session } from 'node:inspector'

/** The hottest sampled stacks within the last `ms` of a profile. Keep caller
 * frames down to the root: native leaves such as JSON serialization don't name
 * the work, and a storage read doesn't name who asked for it. */
export let stacks = (profile: Profiler.Profile, ms: number): string => {
  let nodes = new Map(profile.nodes.map((node) => [node.id, node]))
  let parents = new Map<number, number>()
  for (let node of profile.nodes) {
    for (let child of node.children ?? []) parents.set(child, node.id)
  }
  let hits = new Map<number, number>(), at = profile.startTime
  for (let [i, id] of (profile.samples ?? []).entries()) {
    at += profile.timeDeltas?.[i] ?? 0
    if (at < profile.endTime - ms * 1000) continue
    let name = nodes.get(id)?.callFrame.functionName
    if (name == '(idle)' || name == '(root)') continue
    hits.set(id, (hits.get(id) ?? 0) + 1)
  }
  let hot = [...hits].sort((a, b) => b[1] - a[1]).slice(0, 3)
  if (!hot.length) return 'no running stacks were sampled during the gap'
  return hot.map(([id, count]) => {
    let frames: string[] = []
    while (id) {
      let node = nodes.get(id)
      if (!node) break
      let f = node.callFrame
      frames.push(
        `    at ${f.functionName || '(anonymous)'}${
          f.url ? ` (${f.url}:${f.lineNumber + 1}:${f.columnNumber + 1})` : ''
        }`,
      )
      id = parents.get(id) ?? 0
    }
    return `${count} samples:\n${trim(frames).join('\n')}`
  }).join('\n')
}

/** A deep stack's leaf, which says what ran, and its root, which says who
 * asked: the frames between are the layers a read passes through. */
let trim = (frames: string[], leaf = 8, root = 32): string[] =>
  frames.length <= leaf + root ? frames : [
    ...frames.slice(0, leaf),
    `    … ${frames.length - leaf - root} frames`,
    ...frames.slice(-root),
  ]

/** Samples only this isolate, at 10 Hz. Rotate once a minute (starting V8's
 * profiler costs tens of ms), or when a tick needs its evidence. Ordinary
 * profiles die unrendered; only the held gap's top three stacks are reported. */
export let sampler = async ({
  session = new Session(),
  now = () => performance.now(),
}: {
  session?: {
    connect: () => void
    disconnect: () => void
    post: (
      method: string,
      params: object,
      done: (error: Error | null, value?: unknown) => void,
    ) => void
  }
  now?: () => number
} = {}) => {
  session.connect()
  let post = (method: string, params: object = {}): Promise<unknown> =>
    new Promise((resolve, reject) => {
      session.post(
        method,
        params,
        (error, value) => error ? reject(error) : resolve(value),
      )
    })
  let running = false, since = now()
  let pending: Promise<Profiler.Profile> | undefined
  let close = async () => {
    try {
      await pending
      if (running) await post('Profiler.stop')
    } finally {
      running = false
      session.disconnect()
    }
  }
  try {
    await post('Profiler.enable')
    await post('Profiler.setSamplingInterval', { interval: 100_000 })
    await post('Profiler.start')
    running = true
  } catch (error) {
    await close()
    throw error
  }
  return {
    take: (
      ms: number,
      held: boolean,
    ): Promise<string | undefined> | undefined => {
      if (!held && now() - since < 60_000) return
      pending ??= (async () => {
        let { profile } = await post('Profiler.stop') as {
          profile: Profiler.Profile
        }
        running = false
        await post('Profiler.start')
        running = true
        since = now()
        return profile
      })().finally(() => pending = undefined)
      return pending.then((profile) => held ? stacks(profile, ms) : undefined)
    },
    close,
  }
}
