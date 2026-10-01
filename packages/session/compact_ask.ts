// Record a model exchange through the existing request/session components.
// Passive inputs keep this observed exchange out of the session runner's work.
import {
  type Bundle,
  type Comp,
  type Eid,
  type Graph,
  identityEid,
} from '@yaks/graph'
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
  req = { ...req, conversation }
  await save([
    { entity: { eid: model }, model: { name: served.name } },

    { entity: { eid: tool }, tool: { name: 'session_compact' } },
    {
      entity: { eid: call },
      call: { to: tool, source },
      execution: { state: 'done' },
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
      ask: { to: model, through: input },
      attempt: { state: 'inflight' },
    },
  ])
  // `using` admits runner work. Add it only with completion, when the
  // passive input/ask already has an output; no worker can run this exchange.
  let using = {
    model,
    ...provider ? { provider } : {},
    instructions: req.instructions,
  }
  let compacted: Reply
  try {
    compacted = await served.model(req)
  } catch (e) {
    // Provider failure bodies can still report billed tokens. Keep unknown
    // counts absent rather than recording a made-up zero.
    let usage = failureUsage(e)
    await save([
      {
        entity: { eid: ask },
        using,
        attempt: {
          state: e instanceof ModelError && e.retry
            ? 'interrupted'
            : 'completed',
        },
        ...usage ? { usage } : {},
        ...e instanceof ModelError
          ? {
            error: { code: e.code },
            ...e.response ? { response: e.response } : {},
          }
          : { exception: {} },
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
  await save([
    {
      entity: { eid: ask },
      using,
      attempt: { state: 'completed' },
      ...served.model.mark?.(compacted),
      ...compacted.usage ? { usage: compacted.usage } : {},
      ...compacted.cost == null ? {} : {
        cost: { dollars: compacted.cost, reported: true },
      },
    },
    ...compacted.items.filter((i) => i.kind == 'assistant').map((i) => ({
      entity: { eid: crypto.randomUUID() },
      entry: { session: conversation },
      output: { source: ask },
      content: { body: i.text },
    })),
  ])
  return compacted
}
