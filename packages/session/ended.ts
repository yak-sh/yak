// A session is live until it has `session.ended`, so a page of live sessions is
// a presence test and never reads an entry. An outside harness's session has no
// entry to say it is over when its process dies: a crash writes no SessionEnd,
// and a log read again can leave a model request newest, which reads `running`
// for good. So the mark is written here, from what the computer says runs now.
// Only what its entries leave unfinished reads `stopped` for it (`statusOf`),
// and its claims go with it (`session_release`).
//
// A session the harness moved on from reads as gone too, since the running
// process no longer names it; resuming it clears the mark (`session_context`).
// A managed run is left to its own `exit` (@yaks/process). A session with no
// transcript file has no process here to ask about, so it is over once it has
// been quiet, owes nothing and holds nothing; a message clears the mark
// (`session_send`).

import type { Bundle, Comp, Eid, Graph } from '@yaks/graph'
import { TOMBSTONE } from '@yaks/graph/bundle'
import { absolute } from '@yaks/file/local'
import { runs } from '@yaks/process'
import { CLAIM, SESSION } from './comp.ts'
import { versionOf } from './files.ts'
import { UNFINISHED } from './state.ts'

// A log this recent may belong to a process that has yet to list itself.
let SETTLING = 5 * 60 * 1000
// A log with no process to ask about counts as over when this quiet.
let QUIET = 2 * 60 * 60 * 1000
let BATCH = 50

let comp = (b: Bundle | undefined, name: string) => (b?.[name] ?? {}) as Comp

/** The session ids Claude's processes run now, from the files in `dir`, one per
 * process. A file outlives a crash, so its pid is asked too. Nothing where
 * there is no such directory, so a computer without one ends nothing. */
export let runningSessions = async (
  dir: string,
  alive: (pid: number) => Promise<boolean> = runs,
): Promise<Set<string> | undefined> => {
  let names: string[]
  try {
    names = [...Deno.readDirSync(dir)].map((f) => f.name)
  } catch (e) {
    if (e instanceof Deno.errors.NotFound) return undefined
    throw e
  }
  let ids = new Set<string>()
  for (let name of names.filter((n) => n.endsWith('.json'))) {
    let text: string
    try {
      text = Deno.readTextFileSync(`${dir}/${name}`)
    } catch (e) {
      if (e instanceof Deno.errors.NotFound) continue // it just ended
      throw e
    }
    let { pid, sessionId } = JSON.parse(text)
    if (!pid || !sessionId) throw new Error(`${name} names no running session`)
    if (await alive(Number(pid))) ids.add(String(sessionId))
  }
  return ids
}

let mtime = (path: string): number | undefined => {
  try {
    return Deno.statSync(path).mtime?.getTime()
  } catch {
    return undefined
  }
}

// Quiet since `cutoff`, and every line of it imported. A compressed log's lines
// can't be counted here: the importer says it reached the end of this version.
// The second stat closes a race with a harness appending during the read.
let endedFile = (path: string, read: Comp, cutoff: number): boolean => {
  try {
    let before = Deno.statSync(path)
    if (!before.isFile || (before.mtime?.getTime() ?? Infinity) > cutoff) {
      return false
    }
    if (path.endsWith('.zst')) return read.finished == versionOf(before)
    let consumed = Number(read.consumed)
    let bytes = Deno.readFileSync(path)
    let after = Deno.statSync(path)
    if (
      before.size != after.size ||
      before.mtime?.getTime() != after.mtime?.getTime() ||
      bytes.at(-1) != 10
    ) return false
    let lines = 0
    for (let byte of bytes) if (byte == 10) lines++
    return lines == consumed
  } catch {
    return false
  }
}

// Nothing has been written to this session since `cutoff`.
let quiet = async (g: Graph, b: Bundle, cutoff: number): Promise<boolean> => {
  let [last] = await g.rows(
    `.entry.session=${b.entity.eid}&.order=-entry.seq&.limit=1&.fields=created.at`,
  )
  let at = last?.['created.at'] ?? comp(b, 'created').at
  return Date.parse(String(at)) <= cutoff
}

type Sweep = {
  projects?: string
  running?: string
  alive?: (pid: number) => Promise<boolean>
  now?: number
}

/** The sessions {@link endGone} would mark, without marking them. */
export let goneSessions = async (g: Graph, o: Sweep = {}): Promise<Eid[]> => {
  let now = o.now ?? Date.now()
  let live = o.running && await runningSessions(o.running, o.alive)
  let open = await g.read(`.${SESSION} !${SESSION}.ended .fields=entity.eid`)
  let held = await g.read(`.${CLAIM}.session .fields=${CLAIM}.session`)
  let parts = [SESSION, 'spawned', 'process', 'exit', 'created']
  let rows = new Map<string, Bundle>()
  let read = async (eids: string[]) => {
    let wanted = eids.filter((eid) => !rows.has(eid))
    if (!wanted.length) return
    for (let b of await g.get(wanted, parts)) {
      if (b && b[TOMBSTONE] == null) rows.set(b.entity.eid, b)
    }
  }
  let holding = new Set(held.map((b) => String(comp(b, CLAIM).session)))
  await read([...new Set([...open.map((b) => b.entity.eid), ...holding])])
  // A subagent runs in the process of the session at the top of its line.
  let root = async (b: Bundle): Promise<Bundle> => {
    let seen = new Set<string>()
    while (true) {
      let parent = String(comp(b, 'spawned').parent ?? '')
      if (!parent || seen.has(parent)) return b
      seen.add(parent)
      await read([parent])
      if (!rows.has(parent)) return b
      b = rows.get(parent)!
    }
  }
  let gone: Eid[] = []
  for (let b of [...rows.values()]) {
    let s = comp(b, SESSION)
    if (!b[SESSION] || s.ended == true) continue
    let eid = b.entity.eid
    let owes = UNFINISHED.includes(String(s.status))
    let rests = !owes && !holding.has(eid)
    if (b.process) {
      if (b.exit && (rests || (owes && s.transcript))) gone.push(eid)
      continue
    }
    if (!s.transcript) {
      if (rests && await quiet(g, b, now - QUIET)) gone.push(eid)
      continue
    }
    let [file] = await g.get([String(s.transcript)])
    let path = file && await absolute(g, file)
    if (!path) continue
    if (o.projects && path.startsWith(`${o.projects}/`)) {
      if (!live || (mtime(path) ?? 0) > now - SETTLING) continue
      let id = String(comp(await root(b), SESSION).id ?? '')
      if (!live.has(id)) gone.push(eid)
    } else if (
      endedFile(path, comp(file, 'transcript'), now - QUIET)
    ) gone.push(eid)
  }
  return gone
}

/**
 * Write `session.ended` on every session whose process is gone or, with no
 * process to ask about, that has come to rest, and answer with their eids.
 * `projects` is where Claude's transcripts are and `running` where it lists its
 * processes.
 *
 * ```ts
 * import { endGone } from '@yaks/session/ended'
 *
 * // await endGone(graph, { projects, running })
 * ```
 */
export let endGone = async (g: Graph, o: Sweep = {}): Promise<Eid[]> => {
  let gone = await goneSessions(g, o)
  for (let i = 0; i < gone.length; i += BATCH) {
    await g.apply(
      gone.slice(i, i + BATCH).map((eid) => ({
        entity: { eid },
        [SESSION]: { ended: true },
      })),
      { trusted: true },
    )
  }
  return gone
}
