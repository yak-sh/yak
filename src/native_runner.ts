// The graph-native Session runner, assembled. managed_codex.ts is the
// scheduler and runner.ts the provider loop; this module is the wiring both
// need — the hosted tool host (the Tasks tools plus the worktree's local
// tools), worktree preparation, and the ollama generation runner — in one
// place, so whichever process owns the DOING half can hold the runner.
//
// It used to live in the serving process, welded there by its observation
// stream (T-35018): a slow or dead web server slowed or stopped every native
// session. It is a `where:'do'` effect now — effectsd holds it in the split
// topology, and a bare `deno run src/server.ts` (tests, probes) is inline and
// holds it itself. Live progress is the one thing that still belongs to the
// sockets, and observe_link.ts carries it there.
import type { Sql } from './store/sql.ts'
import type { Change } from './types.ts'
import type { IO } from './mcp.ts'
import type { Observation } from './observations.ts'
import type { Native } from './doing.ts'
import { managedCodex } from './managed_codex.ts'
import { codexGeneration, type ResponseTransport } from './runner.ts'
import { type OllamaConfig, ollamaTransport } from './ollama.ts'
import { combineTools, localTools, tasksTools } from './harness_tools.ts'
import { prepareWorktree, recoverWorktree } from './sessions.ts'
import { sessionRow } from './session_store.ts'

export type NativeRunner = {
  native: Native
  // Let in-flight generations and calls finish before the process exits, so a
  // restart never kills a live turn.
  settle: () => Promise<unknown>
}

export let nativeRunner = (o: {
  db: Sql
  cast: (changes: Change[]) => void
  // The graph the hosted Tasks tools reach — an in-process IO (local_io.ts).
  io: IO
  transport: ResponseTransport
  ollama: OllamaConfig
  stallMs: number
  observe?: (observation: Observation) => void
}): NativeRunner => {
  let managed = managedCodex({
    db: o.db,
    cast: o.cast,
    transport: o.transport,
    generators: {
      ollama: codexGeneration(
        ollamaTransport({ retries: 2, stallMs: o.stallMs }, o.ollama),
      ),
    },
    tools: async (tree, session) => {
      let tasks = await tasksTools(o.io, session)
      if (!tree) return tasks
      try {
        // A reaped checkout regrows before any tool runs in it (T-16761): the
        // provider thread outlives its worktree, so a later turn recreates the
        // recorded path from the base rather than dying at localTools' realPath.
        await recoverWorktree(session, o.cast)
        let identity = String(sessionRow(o.db, session)?.id ?? session)
        return combineTools(
          await localTools({ tree, session: identity }),
          tasks,
        )
      } catch (error) {
        await tasks.close?.()
        throw error
      }
    },
    prepare: prepareWorktree,
    observe: o.observe,
  })
  return {
    native: {
      soon: () =>
        void managed.sweep().catch((e) =>
          console.warn('Codex runner sweep —', e)
        ),
      start: managed.start,
      remove: (eid) => managed.remove(eid),
      stop: (eid, target) => managed.stop(eid, target),
      comment: (target, eid) => managed.comment(target, eid),
    },
    settle: () => managed.settle(),
  }
}
