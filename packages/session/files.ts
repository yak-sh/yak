// The transcript files each CLI keeps: discovery and the first metadata line.
// Discovery describes sources; the bounded session duty decides when to read.

import * as fs from '@yaks/file/io'
import * as systemProcess from '@yaks/process/system'
import type { Bundle } from '@yaks/graph'
import { identityEid } from '@yaks/graph/identity'
import { accountEid, accountHome } from '@yaks/model'

/** An account a CLI keeps on this machine: its config directory, the one
 * `CLAUDE_CONFIG_DIR` or `CODEX_HOME` names, which holds its transcripts. */
export type Home = { runner: 'claude' | 'codex'; dir: string }

type Env = Pick<systemProcess.Env, 'get'>

/** The account a CLI signs in with in an environment, this process's by
 * default: `CLAUDE_CONFIG_DIR` or `CODEX_HOME`, else `~/.claude` or
 * `~/.codex`. */
export let home = (
  runner: Home['runner'],
  env: Env = systemProcess.env,
): string | undefined => accountHome(runner, (name) => env.get(name))

/** Where an account keeps its transcripts: Claude Code's `projects`, Codex's
 * `sessions`. */
export let transcriptsOf = (h: Home): string =>
  `${h.dir}/${h.runner == 'claude' ? 'projects' : 'sessions'}`

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

// Which CLI's account a directory listed by hand is, by what it holds:
// Claude Code keeps `projects`, Codex only `sessions`. One found on its own
// says by its name.
let kindOf = async (dir: string): Promise<Home['runner'] | undefined> =>
  await isDir(`${dir}/projects`)
    ? 'claude'
    : await isDir(`${dir}/sessions`)
    ? 'codex'
    : undefined

/**
 * Every account on this machine that holds transcripts: the directories
 * `listed` names and, unless `find` is false, the ones the environment (this
 * process's by default) signs in with and each `~/.claude*` and `~/.codex*`
 * directory. Someone
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
  let named = (dir: string): Home['runner'] | undefined =>
    dir.match(/\/\.(claude|codex)[^/]*$/)?.[1] as Home['runner'] | undefined
  let found = find && at
    ? (await list(at)).filter((f) => f.isDirectory)
      .map((f) => `${at}/${f.name}`).filter(named).sort()
    : []
  let out = new Map<string, Home>()
  let add = async (runner: Home['runner'] | undefined, dir?: string) => {
    if (!runner || !dir || out.has(dir)) return
    if (await isDir(transcriptsOf({ runner, dir }))) {
      out.set(dir, { runner, dir })
    }
  }
  if (find) {
    await add('claude', home('claude', env))
    await add('codex', home('codex', env))
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
 * by {@link transcripts}, Codex's by {@link rollouts}. */
export let held = async (from: Home[]): Promise<Found[]> =>
  (await Promise.all(from.map(async (h) => {
    let dir = transcriptsOf(h)
    let found = h.runner == 'claude'
      ? await transcripts(dir)
      : await rollouts(dir)
    let account = accountEid(h.dir)
    return found.map((f) => ({ ...f, account }))
  }))).flat()

/** What a compressed transcript is at a moment: its size and when it was
 * written. A read that reached its end records this as `transcript.finished`. */
export let versionOf = (
  file: { size: number; mtime: Date | null } | undefined,
): string => file ? `${file.size}:${file.mtime?.getTime() ?? 0}` : ''

/** One transcript on disk: the harness's id for the session, and the file. */
export type Found = {
  id: string
  path: string
  runner?: 'codex'
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
