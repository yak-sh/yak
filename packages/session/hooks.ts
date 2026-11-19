// Lifecycle commands post to the running server, preserving its JSON stdout.
// Claude Code does not support HTTP SessionStart hooks. A small shell command
// keeps its additionalContext and retries through the local CLI on failure.
// The harness transcript remains the source of turns (./service.ts).
//
// The MCP connection names its session on every call it makes (`connection`),
// so a write is stamped with its caller whether or not that call's hook ever
// arrives. The `PreToolUse` hook still says which subagent made a call, which
// one connection serving a session and all its subagents cannot
// (./announce.ts).

import * as fs from '@yaks/file/io'
import * as systemProcess from '@yaks/process/system'
import { accountHome } from '@yaks/model'

import { PATH } from './routes.ts'

// The Claude Code account this process signs in with (@yaks/model).
let own = (): string =>
  accountHome('claude', (name) => systemProcess.env.get(name)) ?? '.claude'

/** Where a Claude Code account (its directory, this process's by default)
 * keeps the MCP servers of every project: the default account beside its
 * directory, in `~/.claude.json`, and any other inside it. */
export let configPath = (
  account = own(),
  home = systemProcess.env.get('HOME'),
): string =>
  account == `${home}/.claude`
    ? `${home}/.claude.json`
    : `${account}/.claude.json`

/** What Claude Code starts beside itself to speak to this graph's MCP door.
 * The client owns local file input; the HTTP server receives only values. */
export type Connection = { type: 'stdio'; command: string; args: string[] }

/** The local client for the MCP door of the `yak serve` at `server`. */
export let connection = (server: string, yak = 'yak'): Connection => ({
  type: 'stdio',
  command: yak,
  args: ['mcp', '--host', server.replace(/\/+$/, '')],
})

// One door, however its host is spelled: `localhost` and `127.0.0.1` are the
// same server to everyone on this machine.
let LOOPBACK = ['localhost', '127.0.0.1', '[::1]']
let door = (url: unknown): string | undefined => {
  if (typeof url != 'string' || !URL.canParse(url)) return
  let u = new URL(url)
  let host = LOOPBACK.includes(u.hostname) ? 'loopback' : u.hostname
  return `${u.protocol}//${host}:${u.port}${u.pathname.replace(/\/+$/, '')}`
}

type Connected = { url?: string; command?: string; args?: string[] }

let connectedDoor = (entry: Connected): string | undefined => {
  if (entry.url) return door(entry.url)
  let args = entry.args ?? []
  let host = args.indexOf('--host')
  return entry.command && args[0] == 'mcp' && host >= 0
    ? door(`${args[host + 1]?.replace(/\/+$/, '')}/mcp`)
    : undefined
}

/**
 * Write the connection into Claude Code's config, keeping everything else in
 * it: the first entry already on this door is replaced under its own name and
 * any other on it taken out, else it is added as `name`. `remove` takes them
 * all out. Answers the name it is under.
 */
export let connect = (
  path: string,
  opts: { server: string; name?: string; yak?: string; remove?: boolean },
): string => {
  let config: Record<string, unknown> = {}
  try {
    config = JSON.parse(fs.readTextFileSync(path))
  } catch (e) {
    if (!fs.isNotFound(e)) throw e
  }
  let entry = connection(opts.server, opts.yak)
  let servers = { ...config.mcpServers as Record<string, Connected> }
  let ours = Object.keys(servers)
    .filter((n) => connectedDoor(servers[n]) == connectedDoor(entry))
  let name = ours[0] ?? opts.name ?? 'yak'
  for (let n of ours) delete servers[n]
  if (!opts.remove) servers[name] = entry
  fs.writeTextFileSync(
    path,
    `${JSON.stringify({ ...config, mcpServers: servers }, null, 2)}\n`,
  )
  return name
}

/** One lifecycle entry, in the form a harness settings file stores it. */
export type Hook = {
  /** the tool names it runs for, a pattern the harness matches */
  matcher?: string
  hooks: (
    | { type: 'command'; command: string; timeout?: number }
    | { type: 'http'; url: string; timeout?: number }
  )[]
}

/** Where the entries go for a Claude Code account, this process's by
 * default, unless the caller names another path. */
export let settingsPath = (account = own()): string =>
  `${account}/settings.json`

let cmd = (command: string, timeout?: number): Hook => ({
  hooks: [{
    type: 'command',
    command,
    ...(timeout == null ? {} : { timeout }),
  }],
})

// A hook posted to a server: a server that is down costs the harness the
// timeout and nothing else.
let post = (url: string, matcher?: string): Hook => ({
  ...(matcher ? { matcher } : {}),
  hooks: [{ type: 'http', url, timeout: 2 }],
})

// Keep a failed/partial HTTP response out of stdout before trying the CLI.
let quote = (s: string) => "'" + s.replaceAll("'", "'\"'\"'") + "'"
let relay = (door: string, fallback: string, timeout?: number): Hook =>
  cmd(
    'payload=$(cat); ' +
      'via=${CLAUDE_CODE_SESSION_ID:-${TASKS_SESSION:-${CODEX_THREAD_ID:-}}}; ' +
      'case "${CLAUDE_CODE_SESSION_ID:+${AI_AGENT:-}}" in *_agent) ' +
      'case "$PWD" in */.claude/worktrees/agent-*) ' +
      'agent=${PWD##*/.claude/worktrees/agent-}; agent=${agent%%/*}; ' +
      'case "$agent" in \'\'|*[!0-9a-f]*) ;; *) via=$agent ;; esac ;; esac ;; esac; ' +
      'if answer=$(printf %s "$payload" | curl --fail --silent ' +
      '--connect-timeout 0.1 --max-time 2 ' +
      '--header "x-via: $via" ' +
      "--header 'content-type: application/json' --data-binary @- " +
      quote(door) + '); then printf \'%s\\n\' "$answer"; ' +
      `else printf %s "$payload" | ${fallback} || true; fi`,
    timeout,
  )

/**
 * The entries this package owns, keyed by the harness event each responds to.
 *
 * `server` is the origin of the `yak serve` the hook door is on. `yak` is the
 * path to the command on this machine — a full path where it is not on the
 * harness's path.
 */
export let lifecycle = (
  server: string,
  yak = 'yak',
): Record<string, Hook[]> => {
  let door = `${server.replace(/\/+$/, '')}${PATH}`
  return {
    SessionStart: [relay(door, `${yak} session context --hook -`)],
    SubagentStart: [relay(door, `${yak} session context --hook -`)],
    UserPromptSubmit: [relay(door, `${yak} session context --hook -`, 5)],
    PreToolUse: [post(door, 'mcp__.*')],
    PostToolUse: [post(door)],
    Stop: [post(door)],
    SessionEnd: [relay(door, `${yak} session wrap --hook -`, 5)],
  }
}

// Ours, identified by the command it runs or the door it posts to, including
// the turn hooks an older install wrote (`session/turn.ts`), which an install
// now takes out. A person's own entry never runs either.
let MINE =
  /\byak\b.*\bsession (context|wrap) --hook\b|\bsession\b\S*\/turn\.ts\b/
let mine = (h: unknown): boolean =>
  ((h as Hook | undefined)?.hooks ?? []).some((
    x: { url?: string; command?: string },
  ) => !!x?.url?.endsWith(PATH) || MINE.test(x?.command ?? ''))

/**
 * The lifecycle entries merged into the hooks a settings file already had:
 * ours lead each event, everything else follows, and an earlier install of
 * ours is replaced rather than doubled. `gone` removes ours and keeps the
 * rest.
 */
export let merged = (
  had: Record<string, unknown> | undefined,
  add: Record<string, Hook[]>,
  gone = false,
): Record<string, unknown[]> => {
  let out: Record<string, unknown[]> = {}
  for (let event of new Set([...Object.keys(had ?? {}), ...Object.keys(add)])) {
    let was = had?.[event]
    let kept = (Array.isArray(was) ? was : []).filter((h) => !mine(h))
    let ours = gone ? [] : add[event] ?? []
    if (kept.length || ours.length) out[event] = [...ours, ...kept]
  }
  return out
}

/** What an install tells the person who ran it: what changed, and what to do
 * next for Claude Code to work with this graph. */
export let installed = (
  path: string,
  server: string,
  removed = false,
  mcp?: { path: string; name: string },
): string =>
  removed
    ? [
      `removed this graph's session hooks from ${path}`,
      ...mcp ? [`and its MCP server ${mcp.name} from ${mcp.path}`] : [],
    ].join('\n')
    : [
      `wrote the session hooks into ${path}.`,
      ...mcp
        ? [
          `wrote this graph's tools into ${mcp.path} as the MCP server ` +
          `${mcp.name}, each call naming its session.`,
        ]
        : [],
      'A Claude Code session started from now on, in any directory, is a ' +
      'session in this graph.',
      `next: yak serve, which the hooks post each tool call to (${server}${PATH}).`,
    ].join('\n')

/** Write the entries into a settings file, keeping everything else in it.
 * Answers the path written. */
export let install = (
  path: string,
  opts: { server: string; yak?: string; remove?: boolean },
): string => {
  let settings: Record<string, unknown> = {}
  try {
    settings = JSON.parse(fs.readTextFileSync(path))
  } catch (e) {
    if (!fs.isNotFound(e)) throw e
  }
  let hooks = merged(
    settings.hooks as Record<string, unknown> | undefined,
    lifecycle(opts.server, opts.yak),
    opts.remove,
  )
  let next: Record<string, unknown> = { ...settings, hooks }
  if (!Object.keys(hooks).length) delete next.hooks
  let dir = path.slice(0, path.lastIndexOf('/'))
  if (dir) fs.mkdirSync(dir, { recursive: true })
  fs.writeTextFileSync(path, `${JSON.stringify(next, null, 2)}\n`)
  return path
}
