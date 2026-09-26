// The tests' vocabulary and their one sanctioned wait. Importing this module
// learns the documents a host composes from the plugins a yak serve config
// lists, so a test sees the components a page does, and gives the test a
// localStorage of its own. Import it before anything else in a test file: a
// module that reads the tables or the storage as it loads reads them once,
// and both are set below before any later import evaluates. A test never
// sleeps a fixed span: it yields with `tick` and waits on a fact with `until`.

import { learn } from './types.ts'
import { docs as kernel } from '@yaks/kernel/vocab'
import { docs as id } from '@yaks/id/vocab'
import { docs as secrets } from '@yaks/secrets/vocab'
import { docs as key } from '@yaks/key/vocab'
import { docs as alias } from '@yaks/alias/vocab'
import { docs as edge } from '@yaks/edge/vocab'
import { docs as blob } from '@yaks/blob/vocab'
import { docs as doc } from '@yaks/doc/vocab'
import { docs as archetype } from '@yaks/archetype/vocab'
import { docs as effects } from '@yaks/effects/vocab'
import { docs as journal } from '@yaks/journal/vocab'
import { docs as task } from '@yaks/task/vocab'
import { docs as project } from '@yaks/project/vocab'
import { docs as goal } from '@yaks/goal/vocab'
import { docs as design } from '@yaks/design/vocab'
import { docs as session } from '@yaks/session/vocab'
import { docs as tools } from '@yaks/tools/vocab'
import { docs as api } from '@yaks/api/vocab'
import { docs as model } from '@yaks/model/vocab'
import { docs as openai } from '@yaks/openai/vocab'
import { docs as processes } from '@yaks/process/vocab'
import { docs as spawn } from '@yaks/spawn/vocab'
import { docs as persona } from '@yaks/persona/vocab'
import { docs as memory } from '@yaks/memory/vocab'
import { docs as embedding } from '@yaks/embedding/vocab'
import { docs as dreaming } from '@yaks/dreaming/vocab'
import { docs as context } from '@yaks/context/vocab'
import { docs as mail } from '@yaks/mail/vocab'
import { docs as notify } from '@yaks/notify/vocab'
import { docs as wake } from '@yaks/wake/vocab'
import { docs as hook } from '@yaks/hook/vocab'
import { docs as page } from '@yaks/page/vocab'
import { docs as git } from '@yaks/git/vocab'
import { docs as code } from '@yaks/code/vocab'
import { docs as canvas } from '@yaks/canvas/vocab'
import { docs as tmux } from '@yaks/tmux/vocab'
import { docs as platform } from '@yaks/platform/vocab'
import { docs as member } from '@yaks/member/vocab'
import { docs as admin } from '@yaks/admin/vocab'

// A test's localStorage is its own, and starts empty the way a new browser's
// does. Deno's is one SQLite file for every test process in a checkout, so a
// write in one process failed a read in another with "database is locked"
// (Tray.tsx reads it as it loads), and what one run stored, the next read.
let kept = new Map<string, string>()
let storage: Storage = {
  get length() {
    return kept.size
  },
  key: (i) => [...kept.keys()][i] ?? null,
  getItem: (key) => kept.get(key) ?? null,
  setItem: (key, value) => void kept.set(key, String(value)),
  removeItem: (key) => void kept.delete(key),
  clear: () => kept.clear(),
}
Object.defineProperty(globalThis, 'localStorage', {
  value: storage,
  configurable: true,
})

learn([
  kernel,
  id,
  secrets,
  key,
  alias,
  edge,
  blob,
  doc,
  archetype,
  effects,
  journal,
  task,
  project,
  goal,
  design,
  session,
  tools,
  api,
  model,
  openai,
  processes,
  spawn,
  persona,
  memory,
  embedding,
  dreaming,
  context,
  mail,
  notify,
  wake,
  hook,
  page,
  git,
  code,
  canvas,
  tmux,
  platform,
  member,
  admin,
].flatMap((d) => d ?? []))

/**
 * Globals set for one test and put back as they were when it is disposed. The
 * test files of a run share one runtime, so a fake that outlived its test
 * would be the next file's world: `using _ = faked({ location, history })`.
 */
export let faked = (globals: Record<string, unknown>) => {
  let prior = Object.keys(globals).map((name) =>
    [name, Object.getOwnPropertyDescriptor(globalThis, name)] as const
  )
  for (let [name, value] of Object.entries(globals)) {
    Object.defineProperty(globalThis, name, {
      value,
      configurable: true,
      writable: true,
    })
  }
  return {
    [Symbol.dispose]: () => {
      for (let [name, was] of prior) {
        if (was) Object.defineProperty(globalThis, name, was)
        else delete (globalThis as Record<string, unknown>)[name]
      }
    },
  }
}

// A test has no server: the control frames a mounted view sends go nowhere,
// through live.ts's transport seam, and the cache is only what the test seeds.
// `wire` is the page's own route, for a test that follows a write out to
// /apply. live.ts reads the tables as it loads, so it is imported after them.
let { useRoute } = await import('./live.ts')
export let wire = useRoute(() => {})

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
