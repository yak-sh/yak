import { equal, ok, test } from '@yaks/testing'
import { mint } from '@yaks/graph'
import { toolEid } from '@yaks/tools'
import { platform } from './directory-probe.ts'
import { directoryOf } from './directory.ts'
import { operatorContext, operatorRoster } from './operator.ts'
import { operatorMemory } from './operator-testing.ts'
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
    return JSON.parse(String(out))
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
