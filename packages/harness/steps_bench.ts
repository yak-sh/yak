/** Native step overhead with an instantly answered scripted model and no I/O.
 * Fixture composition, verification and cleanup are outside the timed boundary. */
import type { Samples } from '@yaks/benchmark'
import type { Comp } from '@yaks/graph'
import type { Model } from '@yaks/model'
import type { Host } from '@yaks/host'
import { textOf, transcript } from '@yaks/session'
import { standaloneMain } from '../../bench/standalone.ts'
import { seed } from './agent.ts'
import { agent } from './agent.ts'
import { harness, working } from './testing.ts'
import { unfinishedEach } from './unfinished.ts'
import { overheadEach } from './overhead.ts'

const ROUNDS = 3
const STEPS = 12
const PROMPT = 'Run the finite scripted workload.'

let check = (holds: boolean, message: string) => {
  if (!holds) throw new Error(`harness-steps: ${message}`)
}

let round = async (steps: number) => {
  const h = await harness(':memory:')
  let asks = 0, calls = 0, issued = 0, pendingTurns = 0
  const model: Model = (request) => {
    asks++
    check(asks <= 2 * steps + 1, 'script exceeded its finite model-call limit')
    // Pending. remains a protocol result; the final answer can be a later
    // user update rather than a replacement result.
    const final = (text: string) =>
      request.items.some((item) =>
        item.kind == 'result'
          ? item.output.split('\n')[0] == text
          : item.kind == 'user' && item.text.includes(text)
      )
    let completed = 0
    while (completed < steps && final(`echoed ${completed + 1}!`)) completed++
    let items: Awaited<ReturnType<Model>>['items']
    if (completed < issued) {
      pendingTurns++
      check(
        pendingTurns <= issued,
        'the same progress owed repeated model turns',
      )
      items = [{ kind: 'assistant', text: 'Continue when the tool finishes.' }]
    } else if (issued < steps) {
      issued++
      items = [{ kind: 'call', id: `call-${issued}`, name: 'echo', args: '{}' }]
    } else {
      items = [{ kind: 'assistant', text: 'done' }]
    }
    return Promise.resolve({ id: `reply-${asks}`, model: 'scripted', items })
  }
  const tools = [{
    name: 'echo',
    description: 'Instant scripted answer',
    parameters: { type: 'object', properties: {} },
    run: () => `echoed ${++calls}!`,
  }]
  await h.g.apply(seed({ provider: 'openai', model: 'scripted', tools }), {
    trusted: true,
  })
  const a = agent({ h, name: 'scripted', tools, model })
  const runner = working(h, {
    asyncTools: true,
    tools,
    model,
    each: overheadEach(
      { graph: h.g, storage: h.store } as Host,
      unfinishedEach({ graph: h.g } as Host),
    ),
  })
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    const start = performance.now()
    const entries = await Promise.race([
      (async () => {
        const session = await a.start(PROMPT)
        await a.idle(session)
        return await transcript(h.g, session)
      })(),
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error('harness-steps timed out')),
          30_000,
        )
      }),
    ])
    const elapsed = performance.now() - start
    clearTimeout(timer)
    const reply = entries.at(-1)!
    const asyncCalls = entries.filter((entry) => !!entry.tool_async)
    const results = entries.filter((entry) => !!entry.result)
    const progress = entries.filter((entry) => !!entry.tool_progress)
    check(
      textOf(reply) == 'done',
      `wrong final output: ${
        JSON.stringify(reply)
      }; asks=${asks}, calls=${calls}`,
    )
    check(
      asks == steps + pendingTurns + 1 && calls == steps &&
        issued == steps,
      'wrong model/tool step count',
    )
    check(asyncCalls.length == steps, 'did not dispatch real async tools')
    check(results.length == steps, 'wrong completed result count')
    check(progress.length == steps, 'wrong tool progress count')
    check(
      entries.some((entry) => !entry.output && textOf(entry) == PROMPT),
      'input lost',
    )
    for (let i = 0; i < steps; i++) {
      check(textOf(results[i]) == `echoed ${i + 1}!`, 'persisted result lost')
      check(
        (results[i].result as Comp).call == asyncCalls[i].entity.eid,
        'result has wrong call',
      )
    }
    return {
      value: elapsed / (steps || 1),
      counts: {
        modelCalls: asks,
        pendingTurns,
        toolSteps: calls,
        results: results.length,
        asyncCalls: asyncCalls.length,
        progress: progress.length,
        entries: entries.length,
      },
    }
  } finally {
    clearTimeout(timer)
    try {
      await runner.stop()
    } finally {
      await a.close()
    }
  }
}

export async function measure(
  _args: string[] = [],
): Promise<Record<string, Samples>> {
  const samples: Record<string, Samples> = {}
  for (
    const [name, steps] of [['no-tools', 0], ['tool-step', STEPS]] as const
  ) {
    // Warm the same code paths without carrying transcript growth into samples.
    await round(steps)
    const rounds = []
    for (let i = 0; i < ROUNDS; i++) rounds.push(await round(steps))
    samples[name] = rounds
  }
  return samples
}

if (import.meta.main) await standaloneMain('harness-steps')
