// The code behind `session_run` where a `yak` host lists the harness,
// exported as `@yaks/harness/effects`: the runner (@yaks/session `running`)
// lent this machine, as the harness on its own lends it (./local.ts `here`).
// @yaks/session declares the effect and knows nothing of a machine; the
// harness handles it because the machine is the harness's to lend. What the
// box opened is let go after the host's admitted work drains.
//
// `session_start` is handled here too (@yaks/session `starting`): a session
// started on a person's comment wears the persona of the task's lineage and
// asks what the task's project says its work runs on (./default.ts
// `usingFor`): the project's own `using{provider, model}`, and the harness's
// default model where the project names none.

import { promptEntry } from '@yaks/context'
import { type Comp, derivedEid, Refused } from '@yaks/graph'
import { type Built, line, sub } from '@yaks/query'
import { openingFor } from './instructions.ts'
import type { Handlers } from '@yaks/effects'
import type { Host } from '@yaks/host'

import { recall, type Runner, running, starting } from '@yaks/session'
import { usingFor } from './default.ts'
import { lend } from './agent.ts'
import { here, type Opts } from './local.ts'
import { hosted } from './store.ts'
import { unfinishedEach } from './unfinished.ts'
import { machines } from './session_machines.ts'
import { exposed, isolate, type Isolation, snapshot } from './isolated.ts'

/** What config says an exposed session's sandbox is (./isolated.ts): a
 * bubblewrap sandbox under `dir` with `limits`, the read-only `binds` and
 * the command `env`, holding the committed HEAD of `source` over what `setup`
 * made of it, shared read-only (kept under `dir`'s `.layers`); the host
 * `tools` it is offered by name; and the tools its lander is offered
 * (`landing`). */
export type IsolationConfig = {
  dir?: string
  limits?: { cpuQuota: number; memoryMax: number; tasksMax: number }
  binds?: string[]
  env?: Record<string, string>
  source?: string
  setup?: string
  tools?: string[]
  landing?: string[]
}

// The isolation config names. A sandbox needs a directory, limits and a
// source; without them an exposed session has its host tools alone.
let isolation = async (config: IsolationConfig = {}): Promise<Isolation> => {
  let { dir, limits, source } = config
  if (!dir || !limits || !source) {
    return { tools: config.tools, landing: config.landing }
  }
  let { sandboxProvider } = await import('@yaks/sandbox/bubblewrap')
  return {
    tools: config.tools,
    landing: config.landing,
    sandbox: sandboxProvider({
      dir,
      limits,
      binds: config.binds,
      env: () => ({ ...config.env }),
      ...snapshot(source, {
        setup: config.setup,
        env: config.env,
        dir: `${dir}/.layers`,
      }),
    }),
  }
}

/** The runner, lent this machine, over the host's graph. The plugin's options
 * may name `compactAt`, the share of its model's context window a transcript
 * fills before it is compacted (half where absent), and `starts`, the most
 * sessions started on comments at work at once (two where absent); the model
 * a session asks by default is graph data (./default.ts `defaultUsing`), and
 * so is the one a project's work runs on (`usingFor`). `isolation`
 * ({@link IsolationConfig}) is what a session outside words started works
 * with instead of the host's tools. */
export let effects = (
  host: Host,
  options: Record<string, unknown> & Pick<Opts, 'env' | 'http'> & {
    isolation?: IsolationConfig
  } = {},
): Handlers => {
  // The providers the config names load before the first run is answered.
  let made = here(hosted(host), {
    env: options.env,
    http: options.http,
    compactAt: typeof options.compactAt == 'number'
      ? options.compactAt
      : undefined,
  })
  let lent = made.then((here) => here.lent)
  host.defer(() => lent.then((lent) => lent.release?.(), () => {}))
  let binding = machines(
    host.graph,
    host.sandboxes,
    host.resolveHome,
    host.workspaces,
  )
  let g = host.graph
  // A sandbox config that cannot be built is reported, and exposed sessions
  // keep their host tools alone; every other session goes on as it was.
  let isolated = isolation(options.isolation).catch(async (error) => {
    await made.then((h) => h.report(error, { phase: 'isolation' }), () => {})
    return { tools: options.isolation?.tools }
  }).then((i) => isolate(g, i))
  let scoped = async (session: string, runner: Runner) =>
    (await isolated)(session, runner)
  let entries = (session: string, q: Built) =>
    g.read(
      line`.entry.session=${session}&${sub(q)}&.limit=1&.fields=entity.eid`,
    )
  // What a transcript opens with, admitted once before it is answered, when
  // whoever began it wrote none: an HTTP fixer's instruction files (its home,
  // its claimed task or project), and those of the workspace a session's home
  // names, as any door writes one (a browser's chat names the persona, the
  // topic and its first message, no more). The persona itself is not
  // admitted: every ask is told its text and the topic's tree afresh, and
  // offered the tools it contains then (./local.ts `wear`).
  let opening = async (session: string) => {
    let [owner] = await g.get([session])
    let s = owner?.session as Comp | undefined
    if (
      !s || s.ended || ['stopped', 'failed'].includes(String(s.status))
    ) return
    let fixer = !!owner.fixer && !owner.process && !owner.stop
    let persona = typeof s.persona == 'string' ? s.persona : undefined
    let topic = typeof s.topic == 'string' ? s.topic : undefined
    if (!fixer && !persona && !topic) return
    try {
      if (fixer) {
        // HTTP fixer requests use the native runner, not an outside CLI. An
        // existing managed run keeps its original owner across config
        // changes.
        if (!owner.native) {
          await g.apply([{ entity: { eid: session }, native: {} }], {
            trusted: true,
          })
        }
        // An exposed fixer works in its sandbox, never a checkout of the
        // host's.
        if (!await exposed(g, session)) await binding.cwd(session)
        ;[owner] = await g.get([session])
      } else if ((await entries(session, line`.ask`)).length) return
      // Preparation is restartable. Admit each immutable source only once.
      if ((await entries(session, line`.prompt`)).length) return
      let work = fixer
        ? (await g.read(line`.claim.session=${session}&.task&.limit=1`))[0]
          ?.entity.eid ?? (owner.filed as Comp | undefined)?.project
        : undefined
      let { files, persona: worn } = await openingFor(
        g,
        { ...owner.home as Comp | undefined },
        host.workspaces,
        { persona, work: work as string | undefined, topic },
      )
      let writes = [
        // A persona its work chose is recorded, so each ask is told it.
        ...worn && !persona
          ? [{ entity: { eid: session }, session: { persona: worn } }]
          : [],
        ...files.map((file) =>
          promptEntry(
            session,
            undefined,
            file.body,
            file.source,
            'shared',
            file.revision,
          )
        ),
      ]
      if (writes.length) await g.apply(writes, { trusted: true })
    } catch (error) {
      // Configuration cannot improve by repeating the same preparation.
      // Keep a terminal answer in the transcript, also seen after restart.
      if (!(error instanceof Refused)) throw error
      let [last] = await g.read(
        line`.entry.session=${session}&.order=-entry.seq&.limit=1`,
      )
      await g.apply([{
        entity: {
          eid: derivedEid(`${session}:binding-refusal:${last.entity.eid}`),
        },
        entry: { session },
        refusal: { code: 'context' },
        content: { body: error.message },
      }], { trusted: true })
    }
  }
  return {
    ...running(
      g,
      lent.then((lent) => {
        let runner = lend(lent)
        return {
          ...runner,
          each: unfinishedEach(host, runner.each),
          answers: async (using, session) => {
            if (!await runner.answers?.(using, session)) return false
            if (session) await opening(session)
            return true
          },
          stopping: host.stopping,
        }
      }),
      scoped,
    ),
    ...starting(g, {
      beside: recall(host).beside,
      limit: typeof options.starts == 'number' ? options.starts : undefined,
      opening: async (work) => ({
        persona: (await openingFor(g, {}, host.workspaces, { work })).persona,
        using: await usingFor(g, work),
      }),
    }),
  }
}
