// What a host does about a persona that changed, exported as
// `@yaks/persona/effects`: the code behind `persona_files` (./vocab.json),
// which writes the persona files again (./files.ts) a moment after the write
// commits, so a checkout's AGENTS.md says what the graph says without anybody
// running `persona sync`.
//
// Only where the config asks for it: `{"use": "@yaks/persona", "with":
// {"files": true}}`. Each file's path comes from a project's checkout, not from
// the database, so a host opened on a copy of a graph would write into the
// checkouts the original names. The live host opts in; a probe does not.
//
// A write starts a timer and returns, so the commit is never held open, and a
// burst of writes is one pass. A pass renders every persona (a few hundred
// milliseconds over the fleet's graph) and writes only the files whose text
// moved, so a run only has to avoid passes nothing asked for: a doc edit or a
// new link counts when it touches something the last pass said, and archiving
// or restoring a project with a repository counts because that moves its
// checkout in or out of the files. A host that has not made a pass yet counts
// every one, and its first pass learns the set. Passes run one at a time; the timer is dropped when the
// host shuts down.

import type { Handlers } from '@yaks/effects'
import type { Comp, Eid } from '@yaks/graph'
import { EDGE } from '@yaks/edge'
import { DOC } from '@yaks/doc'
import { sync } from '@yaks/mirror'
import { personaMirror, remembered } from './files.ts'
import {
  skillEffects,
  type SkillHost,
  type SkillRuntime,
} from './skill-effects.ts'

/** What this plugin reads from its entry in a config. */
export type Options = { files?: boolean; skills?: boolean }

/** How long a burst of writes settles before one pass answers all of it. */
export let AFTER = 1_000

/** Injectable boundaries for tests: the skills' (./skill-effects.ts), and how
 * long a burst settles. */
export type Runtime = SkillRuntime & { after?: number }

type Fired = Parameters<Handlers[string]>

/** Whether a write moves the persona files, given the entities the last pass
 * said (none until a pass has been made, and then every write counts). A doc or
 * a new link counts when it touches what the last pass said; a persona moving,
 * or a link carrying or reading one going — gone before anybody can read which
 * ends it had — always does. A project with a repository put away or brought
 * back does too: the last pass never said it while it was archived, and its
 * checkout is what the files are written into. */
export let moves = async (
  e: Fired[0],
  tx: Fired[1],
  said: Set<Eid>,
): Promise<boolean> => {
  let about = (...eids: unknown[]) =>
    !said.size || eids.some((x) => said.has(String(x)))
  if (e.name == 'archived') {
    let [row] = await tx.get([e.entity.eid], ['project', 'repo'])
    return !!(row?.project && row.repo)
  }
  if (e.name == DOC) return about(e.entity.eid)
  if (e.kind == 'created' && (e.name == 'contains' || e.name == 'reads')) {
    let [link] = await tx.get([e.entity.eid], [EDGE])
    let ends = link?.[EDGE] as Comp | undefined
    return about(ends?.from, ends?.to)
  }
  return true
}

/** The code that keeps the persona files current, when `files` is on. */
export let effects = (
  host: SkillHost,
  options: Options = {},
  runtime: Runtime = {},
): Handlers => {
  let skills = skillEffects(host, options, runtime)
  if (!options.files) return skills
  let db = host.config?.db ?? Deno.env.get('DB_PATH')
  let said = new Set<Eid>()
  let timer: ReturnType<typeof setTimeout> | undefined
  let last = Promise.resolve()
  let pass = async () => {
    try {
      let m = await personaMirror(host.graph, remembered(db))
      said = m.said
      let done = await sync(m.binding)
      for (let f of done.failed) console.warn('@yaks/persona files —', f)
      for (let p of done.conflicts) {
        console.warn(`@yaks/persona files — ${p} was edited by hand, left`)
      }
    } catch (error) {
      console.warn('@yaks/persona files —', error)
    }
  }
  let soon = () => {
    if (host.stopping?.aborted) return
    clearTimeout(timer)
    timer = setTimeout(() => last = last.then(pass), runtime.after ?? AFTER)
  }
  host.stopping?.addEventListener('abort', () => clearTimeout(timer), {
    once: true,
  })
  return {
    ...skills,
    persona_files: async (e, tx) => {
      if (await moves(e, tx, said)) soon()
    },
  }
}
