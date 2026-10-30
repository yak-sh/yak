// The declared skill_files and skill_watch effects. Skills are a separate
// opt-in: persona files:true must never enable bidirectional repository writes.
// The pool owns these promises, including polling and shutdown cleanup. Imports
// and exports share a bounded queue and a per-pass lease; the watcher has its
// own lease so graph edits need not wait for the polling duty to finish. A
// poll stats the files a sync would read and syncs only when they moved. What a
// pass could not do is retried, so one a retry did not clear reaches the tracker.

import { type Handlers, holding, sleep } from '@yaks/effects'
import type { Eid, Graph } from '@yaks/graph'
import type { Context } from '@yaks/tracker/report'
import { derivedEid } from '@yaks/graph/identity'
import { dirname, join, resolve } from 'node:path'
import { skillRoots, syncSkills } from './skill-mirror.ts'
import { stamp as stampOf } from './skill-mirror-io.ts'

/** The explicit bidirectional mirror opt-in in the plugin config. */
export type SkillOptions = { skills?: boolean }

/** Only the host capabilities this facet uses; fixtures need no server. */
export type SkillHost = {
  graph: Graph
  config?: { db?: string }
  stopping?: AbortSignal
  me?: Eid
  gone?: (holder: Eid) => Promise<boolean>
  report?: (error: unknown, context?: Partial<Context>) => void | Promise<void>
}

/** Injectable boundaries for tests; production uses the mirror and timers. */
export type SkillRuntime = {
  roots?: typeof skillRoots
  sync?: typeof syncSkills
  stamp?: typeof stampOf
  pause?: typeof sleep
  poll?: number
}

/** Continuous polling is intentional: filesystem watches miss renames and
 * index-only changes. Each pass reconciles the present, not a stale event.
 * A poll is only stats: it compares each root's stamp with the one its last
 * clean sync started from, and passes when any moved or never settled. */
export let skillEffects = (
  host: SkillHost,
  options: SkillOptions = {},
  runtime: SkillRuntime = {},
): Handlers => {
  if (!options.skills) return {}
  let roots = runtime.roots ?? skillRoots
  let sync = runtime.sync ?? syncSkills
  let stamp = runtime.stamp ?? stampOf
  let pause = runtime.pause ?? sleep
  let stopping = host.stopping ?? AbortSignal.abort()
  let db = host.config?.db
  let persistent = db && db != ':memory:'
    ? join(dirname(resolve(db)), 'mirror', 'skills')
    : undefined
  let temporary: Promise<string> | undefined
  let saved = new Map<string, string>()
  let names = new Map<string, string>()
  let memory = async (root: string): Promise<string> => {
    let name = names.get(root)
    if (!name) names.set(root, name = `${derivedEid(`skills|${root}`)}.json`)
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
  let clean = async (trailing = false): Promise<void> => {
    let owned = temporary
    if (!owned) return
    let retained = false
    try {
      let dir = await owned
      try {
        for (let name of names.values()) {
          try {
            saved.set(name, await Deno.readTextFile(join(dir, name)))
          } catch (error) {
            if (!(error instanceof Deno.errors.NotFound)) throw error
            saved.delete(name)
          }
        }
        // An event during cleanup shares this batch. Keep its memo in place
        // for the trailing pass; callers cannot observe completion yet.
        retained = trailing && dirty && !host.stopping?.aborted
      } finally {
        if (!retained) await Deno.remove(dir, { recursive: true })
      }
    } finally {
      if (!retained) temporary = undefined
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
  // The roots the last pass found, and the stamp each one's last clean sync
  // started from. Graph edits arrive as skill_files passes, which refresh both.
  let seen: string[] | undefined
  let settled = new Map<string, string>()
  let moved = (): boolean => {
    if (!seen) return true
    for (let root of seen) {
      let was = settled.get(root)
      if (was == undefined || was != stamp(root)) return true
    }
    return false
  }
  // What each root's last pass could not do, and whether it has been reported.
  // A race clears on the next pass; one that survives a retry is a failure, told
  // once however often it is retried, and told again if it clears and returns.
  let unsettled = new Map<string, Map<string, boolean>>()
  let unresolved = async (root: string, reasons: string[]): Promise<void> => {
    let was = unsettled.get(root)
    let now = new Map<string, boolean>()
    for (let reason of new Set(reasons)) {
      let told = was?.get(reason)
      now.set(reason, told != undefined)
      if (told == undefined) {
        console.warn('@yaks/persona skills —', root, reason)
      } else if (!told) {
        await host.report?.(new Error(`skills at ${root}: ${reason}`), {
          tags: { step: 'skill_files', root },
        })
      }
    }
    if (now.size) unsettled.set(root, now)
    else unsettled.delete(root)
  }
  let pass = async (): Promise<void> => {
    if (host.stopping?.aborted) return
    await leased(
      '@yaks/persona/skill_files',
      host.stopping ?? new AbortController().signal,
      async (signal) => {
        seen = await roots(host.graph)
        for (let root of settled.keys()) {
          if (!seen.includes(root)) settled.delete(root)
        }
        for (let root of unsettled.keys()) {
          if (!seen.includes(root)) unsettled.delete(root)
        }
        for (let root of seen) {
          if (signal.aborted) break
          settled.delete(root)
          // Stamped before the sync reads, so a change during it moves it.
          let before = stamp(root)
          let result = await sync(host.graph, root, await memory(root))
          // Conflicts and refusals (a dirty checkout, a diverged main) may
          // clear without touching these files, so they keep being retried.
          if (!result.conflicts.length && !result.failed.length) {
            settled.set(root, before)
          }
          await unresolved(root, [
            ...result.conflicts.map((path) => `conflict: ${path}`),
            ...result.failed,
          ])
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
          if (!watcher || stopping.aborted) await clean(true)
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
          // shutdown or loss of the singleton watcher lease. Every start
          // reconciles, whatever an earlier watcher settled.
          seen = undefined
          do {
            if (moved()) await reconcile()
            if (signal.aborted) break
            await pause(runtime.poll ?? 2_000, signal)
          } while (!signal.aborted)
        })
      } finally {
        watcher = false
        // Serialize cleanup with graph-triggered passes too, including a pass
        // still finishing when a poll or lease fails.
        let cleanup = last.then(() => clean())
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
