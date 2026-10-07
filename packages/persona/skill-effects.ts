// The declared skill_files and skill_watch effects. Skills are a separate
// opt-in: persona files:true must never enable bidirectional repository writes.
// The pool owns these promises, including polling and shutdown cleanup. Imports
// and exports share a bounded queue and a per-pass lease; the watcher has its
// own lease so graph edits need not wait for the polling duty to finish.

import { type Handlers, holding, sleep } from '@yaks/effects'
import { derivedEid, type Eid, type Graph } from '@yaks/graph'
import { dirname, join, resolve } from 'node:path'
import { skillRoots, syncSkills } from './skill-mirror.ts'

/** The explicit bidirectional mirror opt-in in the plugin config. */
export type SkillOptions = { skills?: boolean }

/** Only the host capabilities this facet uses; fixtures need no server. */
export type SkillHost = {
  graph: Graph
  config?: { db?: string }
  stopping?: AbortSignal
  me?: Eid
  gone?: (holder: Eid) => Promise<boolean>
}

/** Injectable boundaries for tests; production uses the mirror and timers. */
export type SkillRuntime = {
  roots?: typeof skillRoots
  sync?: typeof syncSkills
  pause?: typeof sleep
  poll?: number
}

/** Continuous polling is intentional: filesystem watches miss renames and
 * index-only changes. Each pass reconciles the present, not a stale event. */
export let skillEffects = (
  host: SkillHost,
  options: SkillOptions = {},
  runtime: SkillRuntime = {},
): Handlers => {
  if (!options.skills) return {}
  let roots = runtime.roots ?? skillRoots
  let sync = runtime.sync ?? syncSkills
  let pause = runtime.pause ?? sleep
  let stopping = host.stopping ?? AbortSignal.abort()
  let db = host.config?.db
  let persistent = db && db != ':memory:'
    ? join(dirname(resolve(db)), 'mirror', 'skills')
    : undefined
  let temporary: Promise<string> | undefined
  let saved = new Map<string, string>()
  let names = new Set<string>()
  let memory = async (root: string): Promise<string> => {
    let name = `${derivedEid(`skills|${root}`)}.json`
    names.add(name)
    let dir = persistent ?? await (temporary ??= (async () => {
      let dir = await Deno.makeTempDir({ prefix: 'yak-skills-' })
      try {
        for (let [name, body] of saved) {
          await Deno.writeTextFile(join(dir, name), body)
        }
        return dir
      } catch (error) {
        await Deno.remove(dir, { recursive: true })
        throw error
      }
    })())
    return join(dir, name)
  }
  // A handler-only host has no awaited shutdown callback. Keep its agreement
  // bytes, not an idle directory: clean inside the awaited handler and restore
  // on its next pass. A watcher retains its directory until it ends (including
  // failure), then uses the same route. No abort listener detaches I/O errors.
  let clean = async (): Promise<void> => {
    let owned = temporary
    if (!owned) return
    try {
      let dir = await owned
      try {
        for (let name of names) {
          try {
            saved.set(name, await Deno.readTextFile(join(dir, name)))
          } catch (error) {
            if (!(error instanceof Deno.errors.NotFound)) throw error
            saved.delete(name)
          }
        }
      } finally {
        await Deno.remove(dir, { recursive: true })
      }
    } finally {
      temporary = undefined
    }
  }
  // holding reports acquisition/renewal/release failures. Turn that report into
  // the awaited effect's failure instead of detaching an exception from a timer.
  let leased = async (
    name: string,
    signal: AbortSignal,
    work: (signal: AbortSignal) => Promise<void>,
  ): Promise<void> => {
    if (!host.me) return await work(signal)
    let failed = false
    let error: unknown
    let interrupted = new AbortController()
    await holding(host.graph, name, {
      holder: host.me,
      gone: host.gone,
      signal: AbortSignal.any([signal, interrupted.signal]),
      report: (e) => {
        if (!failed) error = e
        failed = true
        interrupted.abort()
      },
    }, work)
    if (failed) throw error
  }
  let pass = async (): Promise<void> => {
    if (host.stopping?.aborted) return
    await leased(
      '@yaks/persona/skill_files',
      host.stopping ?? new AbortController().signal,
      async (signal) => {
        for (let root of await roots(host.graph)) {
          if (signal.aborted) break
          let result = await sync(host.graph, root, await memory(root))
          for (let path of result.conflicts) {
            console.warn(`@yaks/persona skills — conflict: ${path}`)
          }
          for (let reason of result.failed) {
            console.warn('@yaks/persona skills —', reason)
          }
        }
      },
    )
  }
  let last = Promise.resolve()
  let active: Promise<void> | undefined
  let started = false
  let dirty = false
  let watching: Promise<void> | undefined
  let watcher = false
  let reconcile = (): Promise<void> => {
    if (active) {
      // Before the queued pass begins it already sees the latest graph. During
      // a pass, any number of events owe only one trailing reconciliation.
      if (started) dirty = true
      return active
    }
    let done = last.then(async () => {
      started = true
      try {
        do {
          dirty = false
          await pass()
          // Cleanup yields to I/O too: events arriving there still owe the
          // trailing pass before this shared batch promise can settle.
          if (!watcher || stopping.aborted) await clean()
        } while (dirty && !host.stopping?.aborted)
      } finally {
        try {
          if (temporary && (!watcher || stopping.aborted)) await clean()
        } finally {
          // Clear before yielding again: an event after the last dirty check
          // must enqueue a new batch, not join one that already finished.
          started = false
          active = undefined
        }
      }
    })
    active = done
    // Only the queue continuation recovers. Every caller receives the original
    // rejection so the effects pool can report/retry unknown mirror failures.
    last = done.then(() => {}, () => {})
    return done
  }
  let watch = (): Promise<void> => {
    if (watching) return watching
    watcher = true
    watching = (async () => {
      try {
        await leased('@yaks/persona/skill_watch', stopping, async (signal) => {
          // A minimal one-shot host reconciles once. Live hosts poll until
          // shutdown or loss of the singleton watcher lease.
          do {
            await reconcile()
            if (signal.aborted) break
            await pause(runtime.poll ?? 2_000, signal)
          } while (!signal.aborted)
        })
      } finally {
        watcher = false
        // Serialize cleanup with graph-triggered passes too, including a pass
        // still finishing when a poll or lease fails.
        let cleanup = last.then(clean)
        last = cleanup.then(() => {}, () => {})
        try {
          await cleanup
        } finally {
          watching = undefined
        }
      }
    })()
    return watching
  }
  return { skill_files: reconcile, skill_watch: watch }
}
