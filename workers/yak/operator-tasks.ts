// The space's work its Operator keeps in its own store, with the tools the
// packages declare for it: tasks and the questions the Operator asks
// (@yaks/task), and goals and the work that serves them (@yaks/goal). The
// Operator holds these tools (operator.ts `operatorRoster`) and the connector
// lists the same declarations (package-tools.ts), so a task or a goal made
// through either is kept in one place, the space's Operator store.
//
// The connector also lists the sessions that work the space's tasks and the
// comments on them (@yaks/spawn, @yaks/kernel's `comment_new`): a session is
// asked of a provider a developer's machine lends, and that machine's runner
// takes it, runs it and hands it back (@yaks/spawn/machines). These are the
// person's own, called through the connector; the Operator holds none of
// them.
import type { Bundle, Comp, Graph, NamedTool } from '@yaks/graph'
import { loadTools } from '@yaks/graph/tools'
import type { Meta } from '@yaks/sqlite'
import { invoke } from '@yaks/tools'
import { type Reader, seenBy } from './operator-access.ts'
import { caught } from './defects.ts'
import { refuse } from './tool.ts'
import { toolsIn } from '@yaks/vocab/tools'
import { taskDoc } from '@yaks/task/vocab'
import { runs as taskRuns } from '@yaks/task/tools'
import { goalDoc } from '@yaks/goal/vocab'
import { runs as goalRuns } from '@yaks/goal/tools'
import { spawnDoc } from '@yaks/spawn/vocab'
import { runs as spawnRuns } from '@yaks/spawn/tools'
import { kernelDoc } from '@yaks/kernel/vocab'
import { runs as commentRuns } from '@yaks/kernel/tools'

/** The declarations of the work the Operator's store keeps. */
export let workDocs = [taskDoc, goalDoc, spawnDoc, kernelDoc]

// A decision is the Operator's question to the person it works for: it asks
// with decision_new, and the person answers in their Updates, whose answer
// goes on into their conversation (operator-updates.ts), or in their own
// words to it, which it records as theirs (operator-relay.ts
// `decisionRelay`). So the Operator never answers one itself, and the
// connector, whose caller is that person, offers neither half.
//
// A wait holds its request open until a run ends, and a Worker answers at
// once: `session_peek` says where a run stands.
let unlisted = new Set(['decision_new', 'decision_answer', 'session_wait'])

/** The work tools the Operator holds. */
export let held = (): NamedTool[] =>
  [
    ...loadTools([taskDoc], taskRuns()),
    ...loadTools([goalDoc], goalRuns()),
  ].filter((t) => t.name != 'decision_answer')

// Every work tool, the connector's sessions and comments beside the
// Operator's own.
let all = (): NamedTool[] => [
  ...held(),
  ...loadTools([spawnDoc], spawnRuns()),
  ...loadTools([kernelDoc], commentRuns()),
]

/** The declarations the connector lists, and runs in the Operator's store. */
export let shared = () =>
  toolsIn(workDocs).filter((d) => !unlisted.has(d.name!))

/** Every name the work's packages declare. */
export let workNames: Set<string> = new Set(
  toolsIn(workDocs).map((d) => d.name!),
)

/**
 * One of the shared work tools, called through the connector by `reader`:
 * run in the Operator's store as they read it, its answer applied there, and
 * the applied bundles returned.
 */
export let working = async (
  store: { g: Graph; marks?: Pick<Meta, 'get'> },
  reader: Reader,
  name: string,
  args: unknown,
): Promise<Bundle[]> => {
  let tool = shared().some((d) => d.name == name)
    ? all().find((t) => t.name == name)
    : undefined
  if (!tool) throw refuse('missing', `no Operator work tool ${name}`)
  let self = seenBy(store, reader)
  // Registration tools scope their own reads and writes to the caller's
  // machine. They also need its old identity when it has been retired.
  let graph = name == 'machine_register' || name == 'machine_remove'
    ? store.g
    : self
  let actor = { by: reader.person }
  let out = await invoke(
    {
      entity: { eid: crypto.randomUUID() },
      call: { name, args, actor },
      $actor: actor,
    },
    tool,
    graph,
    {
      report: (e) => caught(e, { request: 'operator work tool', tool: name }),
    },
    (answer, state, keeps) =>
      !tool.readOnly && state == 'done' && keeps !== false
        ? self.apply(answer)
        : answer,
  )
  let refusal = out.find((b) => b.refusal)
  if (refusal) {
    throw refuse(
      String((refusal.refusal as Comp).code),
      String((refusal.content as Comp | undefined)?.body),
    )
  }
  return out
}
