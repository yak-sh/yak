// The server module graph that needs a process handoff. The dev supervisor and
// the browser hot-reload watcher share this predicate, so neither can mistake a
// backend edit for a client-only swap.
//
// A running supervisor holds the copy of this list it IMPORTED at its own
// start, and nothing re-imports it — landing a name here restarts the child
// (this file is in the list) but leaves the supervisor deciding by yesterday's
// names until someone restarts `deno task dev`. The same goes for any edit to
// dev.ts itself.

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

export let serverFile = (path: string) =>
  serverFiles.some((file) => path.endsWith(`/${file}`))
