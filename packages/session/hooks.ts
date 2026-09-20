// The injection loop's own half: the lifecycle entries a harness runs, and the
// settings file they are merged into.
//
// A harness (Claude Code, and anything else with the same shape) runs a
// command at the edges of a session and hands it the event as JSON on stdin.
// That is all a graph needs to be told: the START of a session is where a
// transcript becomes an entity and reads back what it was in the middle of,
// and the END is where it says what it did and lets go of what it held. So the
// entries here are two words of `yak` and a `-`, which is the command line's
// own spelling for "this value is stdin" — the tool parses the payload, and
// nothing in between has to know the harness's dialect.
//
// NOTHING HERE MAY FAIL LOUDLY. A hook that exits non-zero is a session that
// will not start, so every entry ends `|| true`: a graph that is not there
// means no context today, never a wedged harness.
//
// The merge is the careful part. A settings file is the person's, with their
// own entries in it, so an install REPLACES what an earlier install wrote and
// leaves everything else exactly where it was — told apart by the commands,
// which is the only durable mark a JSON file carries.

/** One lifecycle entry, as a harness settings file spells it. */
export type Hook = {
  hooks: { type: 'command'; command: string; timeout?: number }[]
}

/** Where the entries go, unless the caller says otherwise. */
export let settingsPath = (home = Deno.env.get('HOME') ?? '.'): string =>
  `${home}/.claude/settings.json`

let cmd = (command: string, timeout?: number): Hook => ({
  hooks: [{
    type: 'command',
    command,
    ...(timeout == null ? {} : { timeout }),
  }],
})

/**
 * The entries this package owns, keyed by the event each answers.
 *
 * `yak` is how the command is spelled on this box — a full path where it is
 * not on the harness's PATH.
 */
export let lifecycle = (yak = 'yak'): Record<string, Hook[]> => ({
  SessionStart: [cmd(`${yak} session context --hook - || true`)],
  SubagentStart: [cmd(`${yak} session context --hook - || true`)],
  SessionEnd: [cmd(`${yak} session wrap --hook - || true`, 5)],
})

// Ours, told apart by what it runs. A person's own entry never says this.
let MINE = /\byak\b.*\bsession (context|wrap) --hook\b/
let mine = (h: unknown): boolean =>
  ((h as Hook | undefined)?.hooks ?? []).some((x) =>
    MINE.test(x?.command ?? '')
  )

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
  opts: { yak?: string; remove?: boolean } = {},
): string => {
  let settings: Record<string, unknown> = {}
  try {
    settings = JSON.parse(Deno.readTextFileSync(path))
  } catch (e) {
    if (!(e instanceof Deno.errors.NotFound)) throw e
  }
  let hooks = merged(
    settings.hooks as Record<string, unknown> | undefined,
    lifecycle(opts.yak),
    opts.remove,
  )
  let next: Record<string, unknown> = { ...settings, hooks }
  if (!Object.keys(hooks).length) delete next.hooks
  let dir = path.slice(0, path.lastIndexOf('/'))
  if (dir) Deno.mkdirSync(dir, { recursive: true })
  Deno.writeTextFileSync(path, `${JSON.stringify(next, null, 2)}\n`)
  return path
}
