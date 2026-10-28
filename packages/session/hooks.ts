// Lifecycle commands post to the running server, preserving its JSON stdout.
// Claude Code does not support HTTP SessionStart hooks. A small shell command
// keeps its additionalContext and retries through the local CLI on failure.
// The harness transcript remains the source of turns (./service.ts).

import { PATH } from './routes.ts'

/** One lifecycle entry, in the form a harness settings file stores it. */
export type Hook = {
  /** the tool names it runs for, a pattern the harness matches */
  matcher?: string
  hooks: (
    | { type: 'command'; command: string; timeout?: number }
    | { type: 'http'; url: string; timeout?: number }
  )[]
}

/** Where the entries go, unless the caller names another path. */
export let settingsPath = (home = Deno.env.get('HOME') ?? '.'): string =>
  `${home}/.claude/settings.json`

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

/** The server a session's hook door is on, unless the caller names another. */
export let SERVER = 'http://localhost:5173'

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
 * `yak` is the path to the command on this machine — a full path where it is
 * not on the harness's path. `server` is the `yak serve` the hook door is on.
 */
export let lifecycle = (
  yak = 'yak',
  server = SERVER,
): Record<string, Hook[]> => {
  let door = `${server.replace(/\/+$/, '')}${PATH}`
  return {
    SessionStart: [relay(door, `${yak} session context --hook -`)],
    SubagentStart: [relay(door, `${yak} session context --hook -`)],
    UserPromptSubmit: [
      cmd(`${yak} session context --hook - 2>/dev/null || true`, 2),
    ],
    PreToolUse: [post(door, 'mcp__.*')],
    PostToolUse: [post(door)],
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

/** Write the entries into a settings file, keeping everything else in it.
 * Answers the path written. */
export let install = (
  path: string,
  opts: { yak?: string; server?: string; remove?: boolean } = {},
): string => {
  let settings: Record<string, unknown> = {}
  try {
    settings = JSON.parse(Deno.readTextFileSync(path))
  } catch (e) {
    if (!(e instanceof Deno.errors.NotFound)) throw e
  }
  let hooks = merged(
    settings.hooks as Record<string, unknown> | undefined,
    lifecycle(opts.yak, opts.server),
    opts.remove,
  )
  let next: Record<string, unknown> = { ...settings, hooks }
  if (!Object.keys(hooks).length) delete next.hooks
  let dir = path.slice(0, path.lastIndexOf('/'))
  if (dir) Deno.mkdirSync(dir, { recursive: true })
  Deno.writeTextFileSync(path, `${JSON.stringify(next, null, 2)}\n`)
  return path
}
