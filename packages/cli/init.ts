// What `yak init` writes: the config a new machine's graph starts from. A
// config is the one statement of where a graph is and what reads and writes it
// (./config.ts), and a person arriving with nothing should not have to know
// which of the @yaks packages compose before their first command works.
//
// The set is the graph, its tasks and projects, the people and sessions that
// work on them and the processes a session runs in — so Claude Code or any MCP
// agent can join through hooks and `/mcp` — and the web canvas `yak serve`
// answers with, whose session tray reads those processes. Everything else is one
// line added to `plugins` later. Pure data: yak.ts writes it and opens the
// graph it names.

import type { Config } from './config.ts'

/** The plugins a new graph starts with, each a bare `@yaks/…` name the CLI
 * resolves from its own release (./config.ts `located`). */
export let STARTER = [
  '@yaks/kernel',
  '@yaks/id',
  '@yaks/secrets',
  '@yaks/alias',
  '@yaks/edge',
  '@yaks/doc',
  '@yaks/effects',
  '@yaks/journal',
  '@yaks/tools',
  '@yaks/task',
  '@yaks/project',
  '@yaks/persona',
  '@yaks/memory',
  '@yaks/process',
  '@yaks/session',
  '@yaks/api',
  '@yaks/mcp',
  '@yaks/web',
  '@yaks/canvas',
]

/** What nobody types a number for: the record a tool call, an effect, a lease
 * or a transcript line leaves. Numbered, they would spend the numbers a person
 * reads — a first task would be T-27. A name here no plugin declares excepts
 * nothing, so a plugin added later needs no edit here. */
export let UNNUMBERED = [
  'call',
  'edge',
  'effect',
  'entry',
  'execution',
  'lease',
  'output',
  'process',
  'result',
  'secret',
  'tool',
]

/** The config a new graph starts from, its database beside it on disk, worked
 * at by `person`. */
export let starter = (person: string): Config => ({
  db: 'yak.db',
  plugins: [...STARTER],
  numbers: { except: [...UNNUMBERED] },
  person,
})
