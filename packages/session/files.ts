// The transcript files each CLI keeps: discovery and the first metadata line.
// Discovery describes sources; the bounded session duty decides when to read.

import * as fs from '@yaks/file/io'
import * as systemProcess from '@yaks/process/system'
import type { Bundle } from '@yaks/graph'
import { identityEid } from '@yaks/graph/identity'
import { accountEid, accountHome, ACCOUNTS, type Runner } from '@yaks/model'

/** An account a CLI keeps on this machine: its config directory, the one
 * `CLAUDE_CONFIG_DIR`, `CODEX_HOME` or `GROK_HOME` names, which holds its
 * transcripts (@yaks/model `ACCOUNTS`). */
export type Home = { runner: Runner; dir: string }

// The directory under an account that holds its transcripts.
let KEEPS: Record<Runner, string> = {
  claude: 'projects',
  codex: 'sessions',
  grok: 'sessions',
  antigravity: 'brain',
}

type Env = Pick<systemProcess.Env, 'get'>

/** The account a CLI signs in with in an environment, this process's by
 * default: the directory its variable names, else its own under the home
 * directory (`~/.claude`, `~/.codex`, `~/.grok`,
 * `~/.gemini/antigravity-cli`). */
export let home = (
  runner: Home['runner'],
  env: Env = systemProcess.env,
): string | undefined => accountHome(runner, (name) => env.get(name))

/** Where an account keeps its transcripts: Claude Code's `projects`, Codex's
 * and Grok's `sessions`, Antigravity's `brain`. */
export let transcriptsOf = (h: Home): string => `${h.dir}/${KEEPS[h.runner]}`

/** Where a Claude Code account keeps one file per running process, naming
 * its session. */
export let runningOf = (h: Home): string => `${h.dir}/sessions`

let isDir = async (path: string) => {
  try {
    return (await fs.stat(path)).isDirectory
  } catch {
    return false
  }
}

// Which CLI's account a directory is by its name: `~/.claude-work` is
// Claude Code's, `~/.grok` Grok's.
let named = (dir: string): Runner | undefined =>
  (dir.match(/\/\.(claude|codex|grok)[^/]*$/)?.[1] ??
    (dir.endsWith('/antigravity-cli') ? 'antigravity' : undefined)) as
      | Runner
      | undefined

// Which CLI's account a directory listed by hand is, by its name or else by
// what it holds: Claude Code keeps `projects`, Antigravity `brain`, Codex
// `sessions`.
let kindOf = async (dir: string): Promise<Runner | undefined> =>
  named(dir) ??
    (await isDir(`${dir}/projects`)
      ? 'claude'
      : await isDir(`${dir}/brain`)
      ? 'antigravity'
      : await isDir(`${dir}/sessions`)
      ? 'codex'
      : undefined)

/**
 * Every account on this machine that holds transcripts: the directories
 * `listed` names and, unless `find` is false, the ones the environment (this
 * process's by default) signs in with and each `~/.claude*`, `~/.codex*` and
 * `~/.grok*` directory. Someone
 * with several accounts keeps each in a directory of its own
 * (`CLAUDE_CONFIG_DIR=~/.claude-work`), so each is found on its own.
 *
 * ```ts
 * import { homes } from './files.ts'
 *
 * // await homes(['/Volumes/work/claude']) — [{ runner: 'claude', dir }, …]
 * ```
 */
export let homes = async (
  listed: string[] = [],
  find = true,
  env: Env = systemProcess.env,
): Promise<Home[]> => {
  let at = env.get('HOME')
  let expand = (dir: string) =>
    dir.replace(/^~(?=\/|$)/, at ?? '~').replace(/(.)\/+$/, '$1')
  let found = find && at
    ? (await list(at)).filter((f) => f.isDirectory)
      .map((f) => `${at}/${f.name}`).filter(named).sort()
    : []
  let out = new Map<string, Home>()
  let add = async (runner: Runner | undefined, dir?: string) => {
    if (!runner || !dir || out.has(dir)) return
    if (await isDir(transcriptsOf({ runner, dir }))) {
      out.set(dir, { runner, dir })
    }
  }
  if (find) {
    for (let runner of Object.keys(ACCOUNTS) as Runner[]) {
      await add(runner, home(runner, env))
    }
  }
  for (let dir of listed.map(expand)) await add(await kindOf(dir), dir)
  for (let dir of found) await add(named(dir), dir)
  return [...out.values()]
}

/** The rows that name accounts: each one's `account`, and its provider's. */
export let accountRows = (from: Home[]): Bundle[] => {
  let providers = [...new Set(from.map((h) => h.runner))]
  return [
    ...providers.map((name) => ({
      entity: { eid: identityEid('provider', [name]) },
      provider: { name },
    })),
    ...from.map((h) => ({
      entity: { eid: accountEid(h.dir) },
      account: { home: h.dir, provider: identityEid('provider', [h.runner]) },
    })),
  ]
}

/** Every transcript the accounts keep, each with its account: Claude Code's
 * by {@link transcripts}, Codex's by {@link rollouts}, Grok's by
 * {@link grokSessions} and Antigravity's by {@link conversations}. */
export let held = async (from: Home[]): Promise<Found[]> =>
  (await Promise.all(from.map(async (h) => {
    let found = await LISTS[h.runner](transcriptsOf(h))
    let account = accountEid(h.dir)
    return found.map((f) => ({ ...f, account }))
  }))).flat()

/**
 * Move a thread's transcript from one account of a CLI to another, at the
 * same place under the other's transcripts, so the CLI signed in there
 * carries the thread on (`claude --resume`, `codex resume`). Its subagents'
 * transcripts stay where they were read from. Whether it was found to move.
 *
 * ```ts
 * import { moveThread } from './files.ts'
 *
 * // await moveThread({ runner: 'claude', dir: '~/.claude-a' }, '~/.claude-b', id)
 * ```
 */
export let moveThread = async (
  from: Home,
  to: string,
  thread: string,
): Promise<boolean> => {
  let [found] = (await held([from])).filter((f) => f.id == thread && !f.parent)
  if (!found) return false
  let path = to + found.path.slice(from.dir.length)
  await fs.mkdir(path.slice(0, path.lastIndexOf('/')), { recursive: true })
  await fs.rename(found.path, path)
  return true
}

/** What a compressed transcript is at a moment: its size and when it was
 * written. A read that reached its end records this as `transcript.finished`. */
export let versionOf = (
  file: { size: number; mtime: Date | null } | undefined,
): string => file ? `${file.size}:${file.mtime?.getTime() ?? 0}` : ''

/** One transcript on disk: the harness's id for the session, and the file. */
export type Found = {
  id: string
  path: string
  /** the CLI that keeps it, where it is not Claude Code */
  runner?: Exclude<Runner, 'claude'>
  /** a subagent's: the harness's id for the session that started it */
  parent?: string
  /** the account whose transcript it is (@yaks/model `account`) */
  account?: string
}

/** Every transcript under a Claude projects directory: the sessions', then
 * their subagents'. Listed a directory at a time, so the thread runs its
 * timers between them: a box keeps thousands. */
export let transcripts = async (dir: string): Promise<Found[]> => {
  let out: Found[] = []
  let agents: Found[] = []
  for (let project of await list(dir)) {
    if (!project.isDirectory) continue
    let at = `${dir}/${project.name}`
    for (let f of await list(at)) {
      if (f.isFile && f.name.endsWith('.jsonl')) {
        out.push({
          id: f.name.slice(0, -'.jsonl'.length),
          path: `${at}/${f.name}`,
        })
      }
      if (!f.isDirectory) continue
      for (let a of await list(`${at}/${f.name}/subagents`)) {
        let id = a.name.match(/^agent-(.+)\.jsonl$/)?.[1]
        if (!a.isFile || !id) continue
        let path = `${at}/${f.name}/subagents/${a.name}`
        agents.push({ id, path, parent: f.name })
      }
    }
  }
  return [...out, ...agents]
}

// A directory's entries; none where it is missing or unreadable.
let list = async (dir: string): Promise<fs.DirEntry[]> => {
  try {
    return await Array.fromAsync(fs.readDir(dir))
  } catch {
    return []
  }
}

// Rollouts are dated YYYY/MM/DD, and the filename carries the thread UUID.
// The same bounded look follows both providers; no second duty scans them.
export let rollouts = async (dir: string, depth = 0): Promise<Found[]> => {
  let files = await list(dir)
  let names = new Set(files.map((f) => f.name))
  let found: Found[] = []
  for (let f of files) {
    let path = `${dir}/${f.name}`
    if (f.isDirectory && depth < 3 && /^\d+$/.test(f.name)) {
      found.push(...await rollouts(path, depth + 1))
      continue
    }
    let id = f.name.match(
      /^rollout-.+-([\da-f]{8}-(?:[\da-f]{4}-){3}[\da-f]{12})\.jsonl(?:\.zst)?$/i,
    )?.[1]
    if (!f.isFile || !id) continue
    if (
      f.name.endsWith('.zst') &&
      names.has(f.name.slice(0, -4))
    ) continue
    found.push({ id, path, runner: 'codex' })
  }
  return found
}

// Only the header is needed to identify a child. Never read its whole log
// merely to open a tail; the importer will read the remaining bytes once.
export let header = (path: string): Record<string, unknown> => {
  let file = fs.openSync(path)
  try {
    let buf = new Uint8Array(4096), text = '', dec = new TextDecoder()
    for (let n = file.readSync(buf); n; n = file.readSync(buf)) {
      text += dec.decode(buf.subarray(0, n), { stream: true })
      if (text.includes('\n')) {
        try {
          return JSON.parse(text.split('\n')[0]).payload ?? {}
        } catch {
          return {}
        }
      }
      if (text.length > 1024 * 1024) return {}
    }
    return {}
  } finally {
    file.close()
  }
}

// A session's id as its directory names it: a UUID.
let UUID = /^[\da-f]{8}-(?:[\da-f]{4}-){3}[\da-f]{12}$/i

/** Every Grok Build session under its `sessions` directory: one directory
 * per working directory (percent-encoded), and in it one per session, named
 * by its id, holding the model's history, `chat_history.jsonl`. */
export let grokSessions = async (dir: string): Promise<Found[]> => {
  let found: Found[] = []
  for (let cwd of await list(dir)) {
    if (!cwd.isDirectory) continue
    for (let s of await list(`${dir}/${cwd.name}`)) {
      if (!s.isDirectory || !UUID.test(s.name)) continue
      let path = `${dir}/${cwd.name}/${s.name}/chat_history.jsonl`
      if (await isFile(path)) found.push({ id: s.name, path, runner: 'grok' })
    }
  }
  return found
}

/** Every Antigravity CLI conversation under its `brain` directory: one
 * directory per conversation, named by its id, whose steps are logged in
 * `.system_generated/logs/transcript_full.jsonl`, or, where an older version
 * kept only the shortened log, `transcript.jsonl`. */
export let conversations = async (dir: string): Promise<Found[]> => {
  let found: Found[] = []
  for (let c of await list(dir)) {
    if (!c.isDirectory || !UUID.test(c.name)) continue
    let logs = `${dir}/${c.name}/.system_generated/logs`
    for (let name of ['transcript_full.jsonl', 'transcript.jsonl']) {
      if (!await isFile(`${logs}/${name}`)) continue
      found.push({ id: c.name, path: `${logs}/${name}`, runner: 'antigravity' })
      break
    }
  }
  return found
}

let isFile = async (path: string) => {
  try {
    return (await fs.stat(path)).isFile
  } catch {
    return false
  }
}

// How each CLI's transcripts are listed.
let LISTS: Record<Runner, (dir: string) => Promise<Found[]>> = {
  claude: (dir) => transcripts(dir),
  codex: (dir) => rollouts(dir),
  grok: grokSessions,
  antigravity: conversations,
}
