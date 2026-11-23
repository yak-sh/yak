// A session opened in Claude Code: its conversation written as the transcript
// Claude Code keeps (`<account>/projects/<cwd>/<session>.jsonl`), under the
// session's own id, so `claude --resume <id>` (or `/resume <id>` inside Claude
// Code) continues it there. Claude Code resumes a transcript it did not write,
// other harnesses' tool calls included, as long as each line has the shape of
// its own.
//
// Each line written here names the entry it came from (`yak.entry`), and the
// Claude Code reader leaves such a line alone (./readers.ts): it is already
// the session's. What Claude Code appends after them is read like any of its
// lines, into the same session, so the conversation stays one transcript
// whichever harness says its next line.
//
// A session Claude Code already keeps a file of gets only what was said since
// that file's last line (a native model took it over meanwhile, @yaks/harness
// `session_send`); any other gets its whole conversation. Either way the lines
// end with the note any model gets when it takes over another harness's
// conversation (./handoff.ts).

import type { Bundle, Comp, Eid, Graph } from '@yaks/graph'
import { derivedEid } from '@yaks/graph/identity'
import { line as query } from '@yaks/query'
import { onDisk } from '@yaks/file/local'
import * as fs from '@yaks/file/io'
import { handoff, namesOf } from './handoff.ts'
import { kindOf, ordered, seqOf, textOf } from './state.ts'

let comp = (b: Bundle | undefined, name: string) =>
  b?.[name] as Comp | undefined

/** One line of a Claude Code transcript. */
export type Line = Record<string, unknown>

/** The directory Claude Code keeps a working directory's transcripts in,
 * under its account's `projects`: the path with every character that is not
 * a letter or a digit made a `-`.
 *
 * ```ts
 * import { projectDir } from './resume.ts'
 * import { equal } from '@yaks/testing'
 *
 * equal(projectDir('/u/.claude', '/w/my.app'), '/u/.claude/projects/-w-my-app')
 * ```
 */
export let projectDir = (account: string, cwd: string): string =>
  `${account}/projects/${cwd.replace(/[^A-Za-z0-9]/g, '-')}`

// What the API takes as a tool's name and a call's id.
let named = (s: string) => s.replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 64) || '_'

let args = (v: unknown): Record<string, unknown> => {
  if (v && typeof v == 'object' && !Array.isArray(v)) {
    return v as Record<string, unknown>
  }
  if (typeof v == 'string') {
    try {
      return args(JSON.parse(v))
    } catch {
      return { input: v }
    }
  }
  return v == null ? {} : { input: v }
}

/**
 * Entries as Claude Code's transcript lines, chained after the line `parent`
 * names: what a person said as theirs, what a model said and called as the
 * assistant's, and each call's result. A call nothing answered is left out,
 * and so is a result of a call not written, as the API refuses either; so is
 * everything that is not conversation (requests, reasoning, stops). `note`
 * closes them, where there are any, as the person's words.
 *
 * ```ts
 * import { claudeLines } from './resume.ts'
 * import { equal } from '@yaks/testing'
 *
 * let e = (eid: string, seq: number, c: object) =>
 *   ({ entity: { eid }, entry: { session: 's', seq }, ...c })
 * let lines = claudeLines([
 *   e('a', 1, { content: { body: 'list it' } }),
 *   e('b', 2, { call: { id: 'call.1', name: 'exec_command', args: { cmd: 'ls' } } }),
 *   e('c', 3, { result: { call: 'b' }, content: { body: 'x.txt' } }),
 *   e('d', 4, { call: { id: 'call_2', name: 'shell' } }),
 * ], { session: 's', cwd: '/w' })
 * equal(lines.map((l) => [l.type, l.uuid, l.parentUuid]), [
 *   ['user', 'a', null], ['assistant', 'b', 'a'], ['user', 'c', 'b'],
 * ])
 * equal((lines[1].message as { content: unknown }).content, [
 *   { type: 'tool_use', id: 'call_1', name: 'exec_command', input: { cmd: 'ls' } },
 * ])
 * ```
 */
export let claudeLines = (
  entries: Bundle[],
  o: {
    session: Eid
    cwd: string
    parent?: string
    note?: string
    now?: string
  },
): Line[] => {
  let sorted = ordered(entries)
  let answered = new Set(
    sorted.flatMap((b) => b.result ? [String(comp(b, 'result')?.call)] : []),
  )
  let ids = new Map(
    sorted.flatMap((b) =>
      b.call && answered.has(b.entity.eid)
        ? [[b.entity.eid, named(String(comp(b, 'call')?.id ?? b.entity.eid))]]
        : []
    ),
  )
  let out: Line[] = []
  let parent = o.parent ?? null
  let message: string | undefined
  let put = (eid: Eid, at: unknown, said: Record<string, unknown>) => {
    let assistant = said.role == 'assistant'
    if (assistant) message ??= `msg_${eid.replaceAll('-', '').slice(0, 24)}`
    else message = undefined
    out.push({
      parentUuid: parent,
      isSidechain: false,
      userType: 'external',
      cwd: o.cwd,
      sessionId: o.session,
      type: said.role,
      message: assistant
        ? {
          id: message,
          type: 'message',
          role: 'assistant',
          model: 'yak',
          content: said.content,
          stop_reason: null,
          usage: { input_tokens: 0, output_tokens: 0 },
        }
        : said,
      uuid: eid,
      timestamp: String(at ?? o.now ?? new Date().toISOString()),
      yak: { entry: eid },
    })
    parent = eid
  }
  for (let b of sorted) {
    let eid = b.entity.eid
    let at = comp(b, 'created')?.at
    let kind = kindOf(b)
    if (kind == 'input' && textOf(b)) {
      put(eid, at, { role: 'user', content: textOf(b) })
    } else if (kind == 'output' && textOf(b)) {
      put(eid, at, {
        role: 'assistant',
        content: [{ type: 'text', text: textOf(b) }],
      })
    } else if (kind == 'call' && ids.has(eid)) {
      let call = comp(b, 'call')!
      put(eid, at, {
        role: 'assistant',
        content: [{
          type: 'tool_use',
          id: ids.get(eid),
          name: named(String(call.name ?? 'tool')),
          input: args(call.args),
        }],
      })
    } else if (b.result && ids.has(String(comp(b, 'result')?.call))) {
      put(eid, at, {
        role: 'user',
        content: [{
          type: 'tool_result',
          tool_use_id: ids.get(String(comp(b, 'result')?.call)),
          content: textOf(b),
        }],
      })
    }
  }
  if (o.note && out.length) {
    put(derivedEid(`claude note ${o.session} ${parent}`), o.now, {
      role: 'user',
      content: o.note,
    })
  }
  return out
}

// The lines of a file, each parsed, and nothing for one that is not JSON.
let parsedLines = (text: string): Line[] =>
  text.split('\n').flatMap((l) => {
    try {
      let v = JSON.parse(l)
      return v && typeof v == 'object' ? [v as Line] : []
    } catch {
      return []
    }
  })

/** The transcript Claude Code keeps of `session` in `account`, in whichever
 * working directory's projects it is, or nothing. */
export let claudeFile = (account: string, session: Eid): string | undefined => {
  let dir = `${account}/projects`
  try {
    for (let d of fs.readDirSync(dir)) {
      let path = `${dir}/${d.name}/${session}.jsonl`
      if (d.isDirectory && exists(path)) return path
    }
  } catch (e) {
    if (!fs.isNotFound(e)) throw e
  }
}

let exists = (path: string) => {
  try {
    return fs.statSync(path).isFile
  } catch (e) {
    if (fs.isNotFound(e)) return false
    throw e
  }
}

/** Where a session was written for Claude Code, and how to resume it. */
export type Opened = {
  path: string
  cwd: string
  /** the lines written: none where the file already held the conversation */
  written: number
}

/**
 * Write `session` into the Claude Code `account` so it resumes there: into
 * the file Claude Code already keeps of it, what was said since its last
 * line, else a new file in `cwd`'s projects holding the whole conversation.
 */
export let openInClaude = async (
  g: Graph,
  session: Eid,
  o: { account: string; cwd?: string; now?: string },
): Promise<Opened> => {
  let had = claudeFile(o.account, session)
  let lines = had ? parsedLines(fs.readTextFileSync(had)) : []
  let cwd = o.cwd ??
    lines.findLast((l) => typeof l.cwd == 'string')?.cwd as string | undefined
  if (!cwd) {
    throw new Error(
      `Claude Code keeps no transcript of ${session} in ${o.account}; ` +
        'name the directory to open it in (cwd)',
    )
  }
  let path = had ?? `${projectDir(o.account, cwd)}/${session}.jsonl`
  let entries = await g.read(query`.entry.session=${session} *`)
  // What the file holds already: the lines Claude Code wrote, read into the
  // session from it (or from the stream of the run that wrote it, the
  // session's first file), and those written here before.
  let [file] = had ? await onDisk(g, had) : []
  let [row] = await g.get([session], ['session'])
  let own = new Set([file?.entity.eid, comp(row, 'session')?.transcript])
  let marked = new Set(
    lines.map((l) => (l.yak as { entry?: string } | undefined)?.entry),
  )
  let held = entries.filter((b) =>
    marked.has(b.entity.eid) ||
    (had && own.has(comp(b, 'lines')?.file as string | undefined))
  )
  let since = Math.max(0, ...held.map(seqOf))
  let fresh = entries.filter((b) => seqOf(b) > since)
  let written = claudeLines(fresh, {
    session,
    cwd,
    parent: lines.findLast((l) => typeof l.uuid == 'string')?.uuid as
      | string
      | undefined,
    note: handoff(fresh, await namesOf(g, fresh)),
    now: o.now,
  })
  if (!written.length) return { path, cwd, written: 0 }
  fs.mkdirSync(path.slice(0, path.lastIndexOf('/')), { recursive: true })
  fs.writeTextFileSync(
    path,
    written.map((l) => JSON.stringify(l) + '\n').join(''),
    { append: true },
  )
  return { path, cwd, written: written.length }
}
