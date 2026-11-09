import { equal, ok, test } from '@yaks/testing'
import { mint } from '@yaks/graph'
import { outputView } from '@yaks/context'
import { keepResult, readResult } from './results.ts'
import { wordsOf } from '@yaks/session'
import { toolEid } from '@yaks/tools'
import { platform } from './directory-probe.ts'
import { directoryOf } from './directory.ts'
import { operating, operatorContext, operatorRoster } from './operator.ts'
import { operatorMemory, operatorModel } from './operator-testing.ts'
import { compiler } from './testing.ts'
import { evaluate } from '../../packages/code-mode/testing.ts'

// Exercise the Operator's tools through the same presentation boundary a
// session uses: the complete rows remain available after its small answer.
test('Operator narrows a kept query with jq and reads it inside code mode', async () => {
  let { env } = platform('operator-results', {
    CODE_MODE: evaluate,
    ESBUILD: compiler(),
  })
  let person = mint()
  let dir = directoryOf(env.STORE)
  let eid = await dir.mint(person, 'results', 'Results', {
    'x-yak-person': person,
    'x-yak-role': 'owner',
  })
  let space = (await dir.at(eid))!
  let store = operatorMemory()
  await store.g.apply(
    Array.from({ length: 30 }, (_, i) => ({
      entity: { eid: mint() },
      doc: { title: `Row ${i}`, body: String(i).padEnd(10_000, 'x') },
    })),
    { trusted: true },
  )
  let ctx = await operatorContext(env, { person }, space, () => dir)
  let tools = await operatorRoster(ctx, store, { space: eid })
  let run = async (name: string, args: Record<string, unknown>) => {
    let call = {
      entity: { eid: mint() },
      call: { to: toolEid(name), args },
    }
    let out = await tools.find((t) => t.name == name)!.run(args, {
      session: mint(),
      call,
      entries: [],
    })
    let entry = {
      entity: call.entity,
      content: { body: wordsOf(out) },
      ...typeof out == 'string' ? {} : out.with,
    }
    return JSON.parse(
      await outputView(
        store.g,
        entry,
        undefined,
        (value, source) => keepResult(store.g, value, source, person),
      ),
    )
  }
  let kept = await run('graph_query', { self: true, q: '.doc' })
  ok(kept.bytes > 256 * 1024)
  equal(kept.shape.rows, 30)
  ok(kept.id)
  let selected = await run('result_query', {
    id: kept.id,
    query: '.result | map(.doc.title) | length',
  })
  equal(selected.values, [30])
  let read = await run('code_mode', {
    script: `let value = await results.read(${
      JSON.stringify(kept.id)
    }); return {rows:value.result.length, last:value.result.at(-1).doc.body.length}`,
  })
  equal(read.error, undefined)
  equal(read.value, { rows: 30, last: 10_000 })
})

test('Operator keeps extension tool results at its loop and realtime model boundaries', async () => {
  let { env } = platform('operator-extension-results')
  let person = mint(), dir = directoryOf(env.STORE)
  let eid = await dir.mint(person, 'external', 'External', {
    'x-yak-person': person,
    'x-yak-role': 'owner',
  })
  let space = (await dir.at(eid))!
  let store = operatorMemory()
  let value = { rows: [{ title: 'Complete', body: 'x'.repeat(20_000) }] }
  let summary: { id: string; bytes: number } | undefined
  let queried = false
  let requests = 0
  let model = operatorModel((req) => {
    requests++
    for (let item of req.items) {
      let text = item.kind == 'result'
        ? item.output
        : item.kind == 'user'
        ? item.text
        : ''
      if (text.includes('"preview"')) {
        summary = JSON.parse(text.slice(text.indexOf('{')).split('\ntook ')[0])
      }
      if (text.includes('"values":["Complete"]')) queried = true
    }
    let item = requests == 1
      ? { kind: 'call' as const, id: 'external', name: 'external', args: '{}' }
      : summary && !queried
      ? {
        kind: 'call' as const,
        id: 'query',
        name: 'result_query',
        args: JSON.stringify({ id: summary.id, query: '.rows[0].title' }),
      }
      : { kind: 'assistant' as const, text: 'done' }
    return Promise.resolve({ id: mint(), model: req.model, items: [item] })
  })
  let operator = operating(store, env, {
    ...model,
    directory: () => dir,
    tools: () => [{
      name: 'external',
      description: 'External tool',
      parameters: { type: 'object' },
      run: () => JSON.stringify(value),
    }],
  })
  let finished = await operator.run({ person }, space, {
    say: 'Read the external rows.',
  })
  equal(finished.text, 'done')
  ok(summary)
  equal(queried, true)
  equal(await readResult(store.g, summary!.id, person), value)
  let realtime = await operator.tools({ person }, space)
  let kept = JSON.parse(await realtime.run('external', {}))
  ok(kept.bytes > 20_000)
  equal(await readResult(store.g, kept.id, person), value)
})
