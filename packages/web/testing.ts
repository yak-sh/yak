// The tests' vocabulary and their one sanctioned wait. Importing this module
// learns the documents a host composes from the plugins a yak serve config
// lists, so a test sees the components a page does. Import it before anything
// else in a test file: a module that reads the tables as it loads reads them
// once. A `slow` test rides a real subprocess or server and runs only under
// TASKS_SLOW; a fast test never sleeps a fixed span, it yields with `tick` and
// waits on a fact with `until`.

import type { VocabDoc } from '@yaks/vocab'
import { learn } from './types.ts'

// The plugins whose components the views draw, as a config lists them.
let plugins = [
  'kernel',
  'id',
  'key',
  'alias',
  'edge',
  'blob',
  'doc',
  'archetype',
  'journal',
  'task',
  'project',
  'goal',
  'design',
  'session',
  'tools',
  'model',
  'process',
  'persona',
  'memory',
  'mail',
  'notify',
  'page',
  'git',
  'canvas',
  'member',
]
let docs: VocabDoc[] = []
for (let p of plugins) {
  let m = await import(`../${p}/vocab.ts`) as { docs?: VocabDoc[] }
  docs.push(...(m.docs ?? []))
}
learn(docs)

type Fn = () => void | Promise<void>
export let slow = (
  name: string,
  a: Fn | Omit<Deno.TestDefinition, 'name' | 'fn'>,
  b?: Fn,
) =>
  Deno.test({
    ...(b ? a as object : {}),
    name,
    fn: (b ?? a) as Fn,
    ignore: !Deno.env.get('TASKS_SLOW'),
  })

/** One macrotask yield. */
export let tick = () => new Promise<void>((go) => setTimeout(go, 0))

/** Wait for a fact to become true, polling; the budget only exists to fail
 * rather than hang. */
export let until = async <T>(
  fact: () => T | Promise<T>,
  { timeout = 2000, poll = 5, label = 'it' }: {
    timeout?: number
    poll?: number
    label?: string | (() => string)
  } = {},
): Promise<T> => {
  let deadline = Date.now() + timeout
  while (true) {
    let v = await fact()
    if (v) return v
    if (Date.now() >= deadline) break
    await new Promise((go) => setTimeout(go, poll))
  }
  throw new Error(
    `until: ${typeof label == 'function' ? label() : label} never held`,
  )
}
