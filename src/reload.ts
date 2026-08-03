// The server module graph that needs a process handoff. The dev supervisor and
// the browser hot-reload watcher share this predicate, so neither can mistake a
// backend edit for a client-only swap.

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
  'subs.ts',
  'freeze.ts',
  'hot.ts',
  'channel.ts',
  'mcp.ts',
  'client.ts',
  'sessions.ts',
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
