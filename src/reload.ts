// The server module graph that needs a process handoff. The dev supervisor and
// the browser hot-reload watcher share this predicate, so neither can mistake a
// backend edit for a client-only swap.
//
// A running supervisor holds the copy of this list it IMPORTED at its own
// start, and nothing re-imports it — so landing a name here does not reach the
// process screening the events. That is why this file is a devFile as well as
// a server one: the landing relaunches the supervisor, and the names it
// decides by are always the tree's.

export let serverFiles = [
  'server.ts',
  'bind.ts',
  'db.ts',
  'sha.ts',
  'effects.ts',
  'schema.ts',
  'types.ts',
  'url.ts',
  'query.ts',
  'sql.ts',
  'subs.ts',
  'freeze.ts',
  'page.ts',
  'hot.ts',
  'channel.ts',
  'mcp.ts',
  'client.ts',
  'sessions.ts',
  'ground.ts',
  'commands.ts',
  'obey.ts',
  'closing.ts',
  'door.ts',
  'tmux.ts',
  'roles.ts',
  'served.ts',
  'proc.ts',
  'probes.ts',
  'adapters.ts',
  'telemetry.ts',
  'mail.ts',
  // The markdown door is a browser module AND the mailer's renderer, so a
  // client-only swap would leave outbound mail rendering from stale code.
  'md.ts',
  'mailer.ts',
  'persona.ts',
  'git.ts',
  'inbound.ts',
  'scribe.ts',
  'knock.ts',
  'wake.ts',
  'embed.ts',
  'reload.ts',
]

let named = (files: string[]) => (path: string) =>
  files.some((file) => path.endsWith(`/${file}`))

export let serverFile = named(serverFiles)

// The supervisor's OWN module graph — dev.ts imports this file and nothing
// else. It is the list above that makes this one necessary: a landed name
// restarts the child, but the supervisor keeps deciding by the names it
// imported at its start, so the tree and the process disagree about what a
// server file even is until the supervisor relaunches (dev.ts, exit 42).
export let devFiles = ['dev.ts', 'reload.ts']

export let devFile = named(devFiles)
