// What `yak init` writes: the config a new machine's graph starts from. A
// config is the one statement of where a graph is and what reads and writes it
// (./config.ts), and a person arriving with nothing should not have to know
// which of the @yaks packages compose before their first command works.
//
// The set is the graph, its tasks and projects, the people and sessions that
// work on them and the processes a session runs in — so Claude Code or any MCP
// agent can join through hooks and `/mcp` — the person's connections to outside
// services, so `yak auth yaks.app` signs in to this graph and every command
// reaching yaks.app finds the token here, and the web canvas `yak serve`
// answers with, whose session pages read those processes, and the Spend page,
// which tallies what the models those sessions asked cost. Everything else is
// one line added to `plugins` later. Pure data: yak.ts writes it and opens the
// graph it names.

import type { Config } from './config.ts'

/** The plugins a new graph starts with, each a bare `@yaks/…` name the CLI
 * resolves from its own release (./config.ts `located`). */
export let STARTER = [
  '@yaks/kernel',
  '@yaks/provenance',
  '@yaks/id',
  '@yaks/secrets',
  '@yaks/connections',
  '@yaks/alias',
  '@yaks/edge',
  '@yaks/doc',
  '@yaks/markdown',
  '@yaks/draft',
  '@yaks/effects',
  '@yaks/journal',
  '@yaks/tools',
  '@yaks/task',
  '@yaks/project',
  '@yaks/persona',
  '@yaks/memory',
  '@yaks/topic',
  '@yaks/process',
  '@yaks/session',
  '@yaks/api',
  '@yaks/mcp',
  '@yaks/web',
  '@yaks/browse',
  '@yaks/canvas',
  '@yaks/model',
  '@yaks/spend',
]

/** The config a new graph starts from, its database beside it on disk, and
 * `person` the one who works in it. */
export let starter = (person: string): Config => ({
  db: 'yak.db',
  plugins: [...STARTER],
  numbers: true,
  person,
})

/** `yak init --force`'s config: the starter at this release, keeping `old`'s
 * graph (`db`) and person, with a line for each other value of `old` it
 * replaces or drops.
 *
 * ```ts
 * import { assertEquals } from '@std/assert'
 * let old = { db: 'g.db', person: 'p', plugins: ['@yaks/kernel', '@yaks/old'], port: 9 }
 * let { config, replaced } = refreshed(old)
 * assertEquals([config.db, config.person], ['g.db', 'p'])
 * assertEquals(replaced[0].startsWith('plugins: dropped @yaks/old; added '), true)
 * assertEquals(replaced[1], 'port: dropped 9')
 * ```
 */
export let refreshed = (
  old: Record<string, unknown>,
): { config: Config; replaced: string[] } => {
  let config = {
    ...starter(String(old.person)),
    ...(old.db ? { db: old.db as string } : {}),
  }
  let fresh = config as Record<string, unknown>
  let replaced = Object.entries(old).flatMap(([key, was]) => {
    let now = fresh[key]
    if (JSON.stringify(was) == JSON.stringify(now)) return []
    if (key == 'plugins' && Array.isArray(was)) {
      let named = (list: unknown[]) =>
        new Set(list.map((p) => typeof p == 'string' ? p : JSON.stringify(p)))
      let before = named(was)
      let after = named(now as unknown[])
      let dropped = [...before].filter((p) => !after.has(p))
      let added = [...after].filter((p) => !before.has(p))
      let parts = [
        dropped.length && `dropped ${dropped.join(', ')}`,
        added.length && `added ${added.join(', ')}`,
      ].filter(Boolean)
      return parts.length ? [`plugins: ${parts.join('; ')}`] : []
    }
    return [
      now === undefined
        ? `${key}: dropped ${JSON.stringify(was)}`
        : `${key}: was ${JSON.stringify(was)}`,
    ]
  })
  return { config, replaced }
}

/** The person `yak init` makes, under the name it found for them, or none. */
export let personOf = (eid: string, name?: string) => ({
  entity: { eid },
  person: {},
  ...(name ? { doc: { title: name } } : {}),
})

/** The graph's first task: confirming the name `yak init` gave the person it
 * made, found rather than asked for, so the first command asks for nothing.
 * It is filed to them, so any agent that connects finds it with the rest of
 * their work and asks them whether the name is right, or what it is where
 * none was found.
 *
 * ```ts
 * import { assertEquals } from '@std/assert'
 * assertEquals(naming('p').filed, { assignee: 'p' })
 * ```
 */
export let naming = (person: string, name?: string) => ({
  entity: { eid: crypto.randomUUID() },
  task: {},
  filed: { assignee: person },
  doc: {
    title: name
      ? `Confirm that ${name} is the name of the person who works in this graph`
      : 'Ask the person who works in this graph for their name',
    body: 'The person this task is filed to is who everything typed here is ' +
      'signed by. ' +
      (name
        ? `\`yak init\` named them ${name}, from git's \`user.name\` or the ` +
          'login user. Ask them whether that is right; '
        : '`yak init` found no name for them. Ask them for it; ') +
      '`yak name <their name>` writes it. Then complete this task.',
  },
})
