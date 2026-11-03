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
// answers with, whose session pages read those processes. Everything else is one
// line added to `plugins` later. Pure data: yak.ts writes it and opens the
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
]

/** What nobody needs a new number for: people, sessions, letters, knocks and
 * internal records, the vocabulary's description among them (@yaks/vocab). A
 * person is called by name (@yaks/persona's `by_name`); content-addressed
 * artifacts and Git objects already have addresses. Numbered, these would
 * spend the numbers a person reads — a first task would be T-27, or T-2 after
 * the person `yak init` makes. A name here no plugin declares excepts nothing.
 * Existing numbers remain addresses; this policy only governs allocation. */
export let UNNUMBERED = [
  '_comp',
  '_effect',
  '_extends',
  '_package',
  '_prop',
  '_vocab',
  'archetype',
  'artifact',
  'build',
  'call',
  'chat',
  'context_output',
  'edge',
  'effect',
  'entry',
  'execution',
  'file',
  'gitobj',
  'key',
  'knock',
  'lease',
  'mail',
  'module',
  'output',
  'package',
  'person',
  'process',
  'ref',
  'result',
  'secret',
  'session',
  'subscription',
  'symbol',
  'tool',
  'volume',
]

/** The config a new graph starts from, its database beside it on disk, worked
 * at by `person`. */
export let starter = (person: string): Config => ({
  db: 'yak.db',
  plugins: [...STARTER],
  numbers: { except: [...UNNUMBERED] },
  person,
})
