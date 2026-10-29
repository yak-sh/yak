/// <reference lib="deno.ns" />
import { effects, take } from '@yaks/effects'
import {
  type Bundle,
  type Comp,
  graph,
  match,
  Refused,
  Stale,
  token,
} from '@yaks/graph'
import { ram } from '@yaks/ram'
import { equal, ok, test } from '@yaks/testing'
import { remote, serve } from './graph.ts'
import { vocab } from './testing.ts'

let part = (b: Bundle | undefined, name: string): Comp | undefined =>
  b?.[name] as Comp | undefined

test('remote graph refuses writes and preserves claim conflicts across the port', async () => {
  let fx = effects(vocab, { owes: 'declared' })
  let g = graph({ storage: ram(vocab), vocab, plugins: [fx] })
  let { port1, port2 } = new MessageChannel()
  let serving = serve(port1, g)
  let client = remote(port2, vocab)
  let rejects = async (
    run: () => unknown,
    type: typeof Refused | typeof Stale,
  ) => {
    let error = await Promise.resolve().then(run).then(
      () => undefined,
      (error) => error,
    )
    ok(error instanceof type)
    return error
  }
  try {
    await client.apply([{ entity: { eid: 'job' }, job: { value: 1 } }])
    await rejects(
      () => client.apply([{ entity: { eid: 'job' }, missing: {} }]),
      Refused,
    )
    let error = await rejects(() =>
      client.apply([{
        entity: { eid: 'job' },
        job: { value: 2 },
        $was: { job: { value: token(0) } },
      }]), Stale)
    equal(error.current, 1)
    equal(part((await client.get(['job']))[0], 'job')?.value, 1)
    equal((await client.rows('.job .count'))[0].n, 1)
    let [bindings] = await client.outside.bindings!(
      [match('.job.value=$value')],
      [],
      ['job'],
    )
    equal(bindings.map((b) => b.vars), [{ value: 1 }])
    let holders = [crypto.randomUUID(), crypto.randomUUID()]
    let outcomes = await Promise.all(
      holders.map((holder) => take(client, 'clock', { holder })),
    )
    equal(outcomes.filter(Boolean).length, 1)
  } finally {
    client.close()
    serving.close()
    port1.close()
    port2.close()
  }
})
