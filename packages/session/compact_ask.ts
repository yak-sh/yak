// Record a model exchange through the existing request/session components.
// Passive inputs keep this observed exchange out of the session runner's work.
import type { Bundle, Comp, Eid, Graph } from '@yaks/graph'
import { derivedEid, identityEid } from '@yaks/graph/identity'
import { Stale } from '@yaks/graph/errors'
import { token } from '@yaks/graph/sha256'
import { attemptState } from './attempt.ts'
import type { ModelResult } from '@yaks/model'
import {
  MODEL,
  type Model,
  ModelError,
  type Reply,
  type Request,
} from '@yaks/model'

// Failed provider responses may contain usage even when no Reply was returned.
let failureUsage = (error: unknown): Comp | undefined => {
  if (!(error instanceof ModelError) || !error.response?.body) return
  try {
    let raw = JSON.parse(error.response.body)
    let usage = raw.response?.usage ?? raw.usage
    if (!usage || typeof usage != 'object') return
    let values = {
      input_tokens: usage.input_tokens,
      output_tokens: usage.output_tokens,
      total_tokens: usage.total_tokens,
      cached_tokens: usage.input_tokens_details?.cached_tokens,
      reasoning_tokens: usage.output_tokens_details?.reasoning_tokens,
    }
    let valid = Object.entries(values).filter(([, v]) =>
      typeof v == 'number' && Number.isFinite(v) && v >= 0
    )
    return valid.length ? Object.fromEntries(valid) : undefined
  } catch {
    return
  }
}

/** Deliver a saved passive exchange even though its transcript owes no model turn. */
export let completeCompact = async (
  g: Graph,
  ask: Bundle,
  { reply, mark }: ModelResult,
): Promise<void> => {
  if (attemptState(ask) != 'inflight') return
  let session = (ask.entry as Comp).session as Eid
  let texts = reply.items.filter((i) => i.kind == 'assistant').map((i) =>
    i.text
  )
  let empty = !texts.join('\n').trim()
    ? new ModelError('compaction', 'Empty summary')
    : undefined
  let actor = { by: String((ask.ask as Comp).to), via: session }
  try {
    await g.apply([
      {
        entity: ask.entity,
        $actor: actor,
        $was: { attempt: { by: token((ask.attempt as Comp).by) } },
        attempt: { by: null },
        completed: {},
        ...empty
          ? { failed: { reason: empty.message }, refusal: { code: empty.code } }
          : {},
        ...mark,
        ...reply.usage ? { usage: reply.usage } : {},
        ...reply.cost == null ? {} : {
          cost: { dollars: reply.cost, reported: reply.costReported ?? true },
        },
      },
      ...(empty ? [empty.message] : texts).map((body, index) => ({
        entity: {
          eid: derivedEid('compaction-result|' + ask.entity.eid + '|' + index),
        },
        $actor: actor,
        entry: { session },
        output: { source: ask.entity.eid },
        content: { body },
      })),
    ], { trusted: true })
  } catch (error) {
    if (
      !(error instanceof Stale) || error.eid != ask.entity.eid ||
      error.comp != 'attempt'
    ) throw error
  }
}

/** One observed compaction exchange, with stable affinity across cuts. */
export let compactAsk = async (
  g: Graph,
  parent: Eid,
  source: Eid,
  offered: { model: Model; name: string; provider?: Eid },
  req: Request,
): Promise<Reply> => {
  let served = offered
  let conversation = identityEid('compaction', [parent])
  let tool = identityEid('tool', ['session_compact'])
  let call = crypto.randomUUID()
  let input = crypto.randomUUID()
  let ask = crypto.randomUUID()
  let model = identityEid(MODEL, [served.name])
  let provider = served.provider
  let actor = { by: model, via: conversation }
  let save = (rows: Bundle[]) =>
    g.apply(rows.map((b) => ({ ...b, $actor: actor })), { trusted: true })
  req = { ...req, conversation, call: ask }
  await save([
    { entity: { eid: model }, model: { name: served.name } },

    { entity: { eid: tool }, tool: { name: 'session_compact' } },
    {
      entity: { eid: call },
      call: { to: tool, source },
      execution: {},
    },
    { entity: { eid: conversation }, session: { source: call } },
    {
      entity: { eid: input },
      entry: { session: conversation },
      notice: {},
      content: { body: JSON.stringify(req.items) },
    },
    {
      entity: { eid: ask },
      entry: { session: conversation },
      notice: {},
      using: { model, ...provider ? { provider } : {} },
      sending: { instructions: req.instructions },
      ask: { to: model, through: input },
      attempt: { by: conversation },
    },
  ])
  // Notice entries remain passive while preserving the original selection.
  let using = {
    model,
    ...provider ? { provider } : {},
  }
  let compacted: Reply
  try {
    compacted = await served.model(req)
  } catch (e) {
    if (e instanceof ModelError && e.code == 'model_result_delivery') throw e
    // Provider failure bodies can still report billed tokens. Keep unknown
    // counts absent rather than recording a made-up zero.
    let usage = failureUsage(e)
    // The parent records a compaction defect once. This observed exchange
    // keeps its failure without creating another exception.
    await save([
      {
        entity: { eid: ask },
        using,
        sending: { instructions: req.instructions },
        attempt: { by: null },
        completed: {},
        ...usage ? { usage } : {},
        ...e instanceof ModelError
          ? {
            refusal: { code: e.code },
            ...e.response && g.vocab.comp('response')
              ? { response: e.response }
              : {},
          }
          : { failed: { reason: String(e) } },
      },
      {
        entity: { eid: crypto.randomUUID() },
        entry: { session: conversation },
        output: { source: ask },
        content: { body: String(e) },
      },
    ])
    throw e
  }
  let [original] = await g.get([ask])
  await completeCompact(g, original, {
    reply: compacted,
    mark: served.model.mark?.(compacted),
  })
  if (!compacted.items.some((i) => i.kind == 'assistant' && i.text.trim())) {
    throw new ModelError('compaction', 'Empty summary')
  }
  return compacted
}
