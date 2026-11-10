// A scheduled tool call uses the same scoped tools and invocation ledger as
// an immediate one. The occurrence's transcript owns its outcome and, when
// requested, becomes the fresh helper that checks it.
import { type Bundle, type Comp, derivedEid, type Graph } from '@yaks/graph'
import { type Tool, transcript } from '@yaks/session'
import { answerOf, faulted, runner, worded } from '@yaks/tools'
import { caught, defect } from './defects.ts'
import { type Ask, fire, receive } from './operator-channels.ts'
import { notification } from './operator-updates.ts'
import type { operatorStore } from './operator-store.ts'

type Store = ReturnType<typeof operatorStore>
type Work = {
  schedule: string
  at: string
  call?: string
  helper?: string
  error?: string
}
let part = (b: Bundle | undefined, name: string) =>
  b?.[name] as Comp | undefined

// Bookkeeping belongs to the invocation's agent and session as much as its
// calls do. Direct provenance also keeps visibility independent of nesting.
export let recorded = (g: Graph, session: string, space: string): Graph => {
  let owned = (bundles: Bundle[]) =>
    bundles.map((b) =>
      b.tool ? b : { ...b, $actor: b.$actor ?? { by: space, via: session } }
    )
  return {
    ...g,
    apply: (bundles, opts) => g.apply(owned(bundles), opts),
    admit: (bundles, opts) => g.admit(owned(bundles), opts),
  }
}

export let occurrence = (schedule: string, at: string) =>
  derivedEid(`operator-work|${schedule}|${at}`)

let failed = async (store: Store, row: Bundle, text: string, error: string) => {
  let ask = part(row, 'operator_session') as Ask
  let work = part(row, 'operator_work') as Work
  let id = derivedEid(`operator-work-failed|${row.entity.eid}`)
  if ((await store.g.get([id]))[0]) return
  defect(new Error(`Scheduled Operator work failed: ${error}`), {
    request: 'operator scheduled work',
    schedule: work.schedule,
    run: row.entity.eid,
    space: ask.space,
  })
  await receive(
    store,
    {
      space: ask.space,
      person: ask.person,
      administrative: ask.administrative,
      channel: 'wake',
      about: work.schedule,
    },
    `Scheduled work ${row.entity.eid} failed. Find the cause and recover it.\n\n${text}`,
    {
      id,
    },
  )
}

/** Finish once, retaining the result in the run, and in the person's Updates
 * unless a helper wrote it: a helper tells them itself with notification_send
 * when they should hear, so a run with nothing to say tells nobody. A failed
 * scheduled operation also asks their Operator to recover it. */
export let finished = async (
  store: Store,
  row: Bundle,
  text: string,
  error?: string,
) => {
  let { g } = store
  let [current] = await g.get([row.entity.eid])
  if (current?.completed || current?.failed) return
  let ask = part(row, 'operator_session') as Ask
  let work = part(current, 'operator_work') as Work
  error ??= work.error
  if (error) await failed(store, row, text, error)
  await g.apply([
    { entity: row.entity, ...error ? { failed: {} } : { completed: {} } },
    {
      entity: { eid: derivedEid(`operator-work-outcome|${row.entity.eid}`) },
      entry: { session: row.entity.eid, from: 'the system' },
      content: { body: text },
      notice: {},
    },
    ...work.helper ? [] : [notification({
      to: ask.person,
      by: ask.space,
      words: text,
      about: row.entity.eid,
      id: row.entity.eid,
    })],
  ], { trusted: true })
}

type Capabilities = {
  tools: (session: string) => Promise<Tool[]>
  helper: (session: string, ask: Ask, brief: string) => Promise<void>
  owner: string
  gone: (owner: string) => boolean
}

/** Execute one occurrence; retries reuse its call's durable answer. */
export let scheduled = async (
  store: Store,
  row: Bundle,
  at: string,
  capabilities: Capabilities,
) => {
  let { g } = store
  let ask = part(row, 'operator_ask') as Ask
  let id = occurrence(row.entity.eid, at)
  let [held] = await g.get([id])
  if (held?.completed || held?.failed) return
  let call = row.call ? derivedEid(`operator-work-call|${id}`) : undefined
  let run: Bundle = {
    entity: { eid: id },
    session: {},
    operator_session: {
      space: ask.space,
      person: ask.person,
      ...ask.administrative ? { administrative: true } : {},
    },
    operator_work: { schedule: row.entity.eid, at, ...call ? { call } : {} },
    doc: { title: `Scheduled work: ${at}` },
  }
  if (!held) await g.apply([run], { trusted: true })
  let text = 'Scheduled work finished.'
  let error: string | undefined
  try {
    if (call) {
      let offered = await capabilities.tools(id)
      let tools = offered.map((tool) => ({
        name: tool.name,
        description: tool.description,
        inputSchema: tool.parameters,
        run: async (asked: Bundle): Promise<Bundle[]> => {
          let answer = await tool.run(part(asked, 'call')?.args as Comp ?? {}, {
            session: id,
            call: asked,
            entries: await transcript(g, id),
          })
          return [{
            entity: { eid: '$answer' },
            content: { body: typeof answer == 'string' ? answer : answer.text },
            ...typeof answer == 'string' ? {} : answer.with,
            output: {
              source: call,
              ...typeof answer == 'string'
                ? {}
                : part(answer.with as Bundle, 'output'),
            },
          }]
        },
      }))
      let execute = runner(recorded(g, id, ask.space), {
        tools,
        owner: capabilities.owner,
        gone: capabilities.gone,
        report: (e) =>
          caught(e, { request: 'operator scheduled tool', run: id }),
        otherwise: {
          name: 'unavailable',
          description: 'A scheduled tool that is no longer available.',
          run: () => {
            throw new Error(
              'Scheduled tool is no longer available to this person.',
            )
          },
        },
      })
      let answered = await execute.call({
        entity: { eid: call },
        call: { ...part(row, 'call'), source: id },
        $actor: { by: ask.space, via: id },
      })
      let out = answerOf(answered, call)
      text = worded(out, 16_384)
      let [stored] = await g.get([call])
      if (faulted([stored, ...answered], call)) error = text
      // code_mode answers with its receipts, so script and nested-call
      // failures remain visible even when the code_mode invocation answered.
      for (let answer of out) {
        let outer = part(answer, 'output')?.value as Comp | undefined
        let value = (outer?.structuredContent ?? outer) as Comp | undefined
        if (
          value?.error ||
          (value?.calls as Comp[] | undefined)?.some((c) =>
            c.isError || c.pending
          )
        ) {
          error = String(
            value?.error ??
              'A scheduled nested call failed or has not finished.',
          )
        }
      }
    }
  } catch (e) {
    error = e instanceof Error ? e.message : String(e)
    text = error
  }
  if (ask.say) await fire(store, row, 'wake', at, `Call outcome:\n${text}`)
  if (error) {
    await g.apply([{ entity: run.entity, operator_work: { error } }], {
      trusted: true,
    })
    await failed(store, run, text, error)
  }
  if (ask.helper) {
    try {
      await capabilities.helper(
        id,
        ask,
        `${ask.helper}\n\nScheduled occurrence: ${at}\nCall outcome${
          error ? ' (failed)' : ''
        }:\n${text}`,
      )
      return
    } catch (e) {
      error = e instanceof Error ? e.message : String(e)
      text = `The scheduled helper could not start: ${error}`
    }
  }
  await finished(store, run, text, error)
}
