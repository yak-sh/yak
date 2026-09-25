// Past transcripts, read into the graph after the fact. Claude keeps every
// interactive session as a file (`~/.claude/projects/<project>/<sid>.jsonl`),
// and a session that ran before the turn hooks were installed (./turn.ts) left
// nothing else. This reads such a file into the same turns the hooks would have
// spooled: each prompt a person typed, and the reply each turn ended on. The
// service duty (./service.ts) writes them exactly as it writes the spool's.
//
// It is lazy on purpose: one transcript per pass of a long-running host, and
// never in a one-shot command's pass, so a backfill never makes anybody wait.
//
// A transcript the graph already holds entries for is left alone, whoever wrote
// them: the hooks, or an import from an older graph. So is one written to in
// the last hour, which is a session still running; it is read once it has gone
// quiet. Subagents' transcripts, under `<sid>/subagents/`, are not sessions a
// person typed into and are not read.

import type { Graph } from '@yaks/graph'
import type { Turn } from './turn.ts'
import { sessionFor } from './who.ts'

/** One transcript on disk: the harness's id for the session, and the file. */
export type Past = { sid: string; path: string }

/** How long a transcript must go unwritten before it counts as finished. */
export let QUIET = 60 * 60 * 1000

/** Where Claude keeps its transcripts on this machine. */
export let claudeProjects = (): string | undefined => {
  let env = globalThis.Deno?.env
  let root = env?.get('CLAUDE_CONFIG_DIR') ??
    (env?.get('HOME') ? `${env.get('HOME')}/.claude` : undefined)
  return root && `${root}/projects`
}

type Line = Record<string, unknown>
let str = (v: unknown): string => typeof v == 'string' ? v : ''
let obj = (v: unknown): Line => v && typeof v == 'object' ? v as Line : {}

// A slash command is recorded as its wrapper; the person typed the command.
let typedAs = (text: string): string => {
  let name = text.match(/<command-name>([\s\S]*?)<\/command-name>/)?.[1]
  if (!name) return text
  let args = text.match(/<command-args>([\s\S]*?)<\/command-args>/)?.[1]
  return args?.trim() ? `${name.trim()} ${args.trim()}` : name.trim()
}

// What a person typed at the prompt: a user line the harness marks as a
// person's (every other user line is a tool's result or something the harness
// injected). A message typed while a turn ran, and taken by that turn, is
// recorded only as a queue removal.
let typed = (e: Line): string | undefined => {
  if (e.isSidechain) return undefined
  if (e.type == 'user' && obj(e.origin).kind == 'human') {
    let text = str(obj(e.message).content)
    return text.trim() ? typedAs(text) : undefined
  }
  if (
    e.type == 'queue-operation' && e.operation == 'remove' &&
    e.reason == 'absorbed_mid_turn'
  ) {
    let text = str(e.content)
    return text.trim() && !text.trimStart().startsWith('<') ? text : undefined
  }
}

/**
 * What the transcript at `path` says about the prompt the harness's hook named
 * `id` (its `prompt_id`, each line's `promptId`): `true` where a person typed
 * it, `false` where the harness put it there (a task's notification), and
 * `undefined` where the transcript holds no line of it. The hook fires before
 * the harness writes the prompt down, so a moment later is when to ask.
 */
export let typedIn = (path: string, id: string): boolean | undefined => {
  let text: string
  try {
    text = Deno.readTextFileSync(path)
  } catch {
    return undefined
  }
  let seen: boolean | undefined
  for (let raw of text.split('\n')) {
    if (!raw.includes(id)) continue
    let e: Line
    try {
      e = obj(JSON.parse(raw))
    } catch {
      continue
    }
    if (e.type != 'user' || e.promptId != id) continue
    if (obj(e.origin).kind == 'human') return true
    seen = false
  }
  return seen
}

// The harness writes one of these when a turn ends, where the Stop hook runs.
let ended = (e: Line) =>
  e.type == 'system' &&
  (e.subtype == 'turn_duration' || e.subtype == 'stop_hook_summary')

/**
 * The turns a transcript holds, in order: each typed prompt as an input, and
 * the text of each turn's last assistant message as an output where the turn
 * ended. A turn that never ended (interrupted, or cut off) has no output, as
 * the Stop hook would have written none.
 *
 * ```ts
 * turnsOf('s', [
 *   '{"type":"user","origin":{"kind":"human"},"message":{"content":"hi"},"timestamp":"T1"}',
 *   '{"type":"assistant","message":{"id":"m","content":[{"type":"text","text":"hello"}]},"timestamp":"T2"}',
 *   '{"type":"system","subtype":"turn_duration","timestamp":"T3"}',
 * ])
 * // [{ sid: 's', at: 'T1', input: 'hi' }, { sid: 's', at: 'T3', output: 'hello' }]
 * ```
 */
export let turnsOf = (sid: string, lines: string[]): Turn[] => {
  let out: Turn[] = []
  let reply: { id: string; text: string[] } | undefined
  let absorbed = new Set<string>()
  let at = ''
  for (let raw of lines) {
    let e: Line
    try {
      e = obj(JSON.parse(raw))
    } catch {
      continue
    }
    at = str(e.timestamp) || at
    let input = typed(e)
    if (input != null) {
      // The harness may also record a taken message as a user line; the queue's
      // copy already stands.
      if (e.type == 'queue-operation') absorbed.add(input)
      else if (absorbed.has(input)) continue
      out.push({ sid, at, input, typed: true })
      reply = undefined
    } else if (e.type == 'assistant' && !e.isSidechain) {
      let msg = obj(e.message)
      let texts = (Array.isArray(msg.content) ? msg.content : [])
        .map(obj).filter((b) => b.type == 'text').map((b) => str(b.text))
        .filter((t) => t.trim())
      if (!texts.length) continue
      let id = str(msg.id)
      if (reply && reply.id == id) reply.text.push(...texts)
      else reply = { id, text: texts }
    } else if (ended(e) && reply) {
      out.push({ sid, at, output: reply.text.join('\n\n') })
      reply = undefined
    }
  }
  return out
}

/** Every top-level transcript under a Claude projects directory. */
export let transcripts = (dir: string): Past[] => {
  let out: Past[] = []
  let list = (d: string) => {
    try {
      return [...Deno.readDirSync(d)]
    } catch {
      return []
    }
  }
  for (let project of list(dir)) {
    if (!project.isDirectory) continue
    for (let f of list(`${dir}/${project.name}`)) {
      if (!f.isFile || !f.name.endsWith('.jsonl')) continue
      out.push({
        sid: f.name.slice(0, -'.jsonl'.length),
        path: `${dir}/${project.name}/${f.name}`,
      })
    }
  }
  return out
}

// Whether the graph already holds any of this session's transcript.
let held = async (g: Graph, sid: string): Promise<boolean> => {
  let s = await sessionFor(g, sid)
  return !!s &&
    (await g.read(`.entry.session=${s.entity.eid}&.limit=1`)).length > 0
}

let quiet = (path: string, now: number): boolean => {
  try {
    let at = Deno.statSync(path).mtime?.getTime()
    return at != null && now - at >= QUIET
  } catch {
    return false
  }
}

/**
 * The next transcript to read in: finished, and not yet in the graph. `known`
 * holds the sessions already settled, so each file is asked about once per
 * process.
 */
export let next = async (
  g: Graph,
  dir: string,
  known: Set<string>,
  now: number = Date.now(),
): Promise<Past | undefined> => {
  for (let past of transcripts(dir)) {
    if (known.has(past.sid) || !quiet(past.path, now)) continue
    if (!await held(g, past.sid)) return past
    known.add(past.sid)
  }
}
