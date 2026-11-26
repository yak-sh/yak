// A key given for a task's ask: checked, kept where the ask says, and the task
// completed; a key the service refuses breaks the connection and leaves the
// task open; a keeper nobody lends fails the run.

import { line } from '@yaks/query'
import { equal, test } from '@yaks/testing'
import { assertRejects } from '@std/assert'
import { kernelDoc } from '@yaks/kernel'
import { provenanceDoc } from '@yaks/provenance'
import { type Comp, graph } from '@yaks/graph'
import { ram } from '@yaks/ram'
import { loadVocab } from '@yaks/vocab'
import { provisionalDoc } from '@yaks/effects'
import { edgeDoc, edgeKeywords, edges } from '@yaks/edge'
import { ramVault, secrets, secretsDoc } from '@yaks/secrets'
import type { Keeper } from '@yaks/host/keepers'
import { connect, connectionsDoc, install, need } from './mod.ts'
import { given } from './given.ts'

let mark = { component: true, type: 'object', properties: {} }
let vocab = loadVocab(
  [kernelDoc, provenanceDoc, edgeDoc, secretsDoc, provisionalDoc, {
    $defs: { person: mark, task: mark },
  }, connectionsDoc],
  [edgeKeywords],
)

let CHECK = 'GET https://api.cf.example/user/tokens/verify'

// A person's ask for a Cloudflare key, answered with `key`, the service
// answering its check with `status`; what each keeper was handed, by name.
let asked = async (
  { key = 'cfut_live', status = 200, lent = ['vault'] } = {},
) => {
  let vault = ramVault()
  let g = graph({
    storage: ram(vocab),
    vocab,
    plugins: [
      secrets(vault, (b) => g.apply(b, { trusted: true }), vocab),
      edges(vocab),
    ],
  })
  await g.apply(await install(g.read), { trusted: true })
  await g.apply([
    { entity: { eid: 'jeff' }, person: {} },
    { entity: { eid: 'ask' }, task: {} },
  ])
  let [made] = await g.apply(
    await need(g.read, {
      owner: 'jeff',
      integration: 'cloudflare-builds',
      hosts: ['api.cf.example'],
      check: CHECK,
      task: 'ask',
      keep: [{ via: 'vault', at: 'Cloudflare build logs' }, {
        via: 'worker',
        at: 'yak/BUILD_LOG_TOKEN',
      }],
    }),
  )
  let eid = made.entity.eid
  let handed: Record<string, [string, string]> = {}
  let keeper = (via: string): Keeper => ({
    keep: (at, value) => (handed[via] = [at, value], Promise.resolve()),
  })
  let fetch = ((_: RequestInfo | URL, init?: RequestInit) =>
    Promise.resolve(
      new Response(
        new Headers(init?.headers).get('authorization'),
        { status },
      ),
    )) as typeof globalThis.fetch
  let host = {
    graph: g,
    vault,
    fetch,
    keepers: Object.fromEntries(lent.map((via) => [via, keeper(via)])),
  }
  await connect({ graph: g, vault }, eid, { key })
  let event = { kind: 'removed', name: 'provisional', entity: { eid } } as const
  let run = async () => {
    await given(host)(event, undefined as never, (b) => g.apply(b))
  }
  let at = async (id: string) =>
    (await g.read(line`.entity.eid=${id}&*`))[0] as Record<string, Comp>
  return { run, at, eid, handed }
}

test('a key that works is kept where the ask says, and the ask is done', async () => {
  let { run, at, eid, handed } = await asked({ lent: ['vault', 'worker'] })
  await run()
  equal(handed, {
    vault: ['Cloudflare build logs', 'cfut_live'],
    worker: ['yak/BUILD_LOG_TOKEN', 'cfut_live'],
  })
  equal(!!(await at('ask')).completed, true)
  equal((await at(eid)).connection.status, 'connected')
})

test('a key the service refuses goes nowhere, and the ask waits for another', async () => {
  let { run, at, eid, handed } = await asked({
    status: 401,
    lent: ['vault', 'worker'],
  })
  await run()
  equal(handed, {})
  equal(!!(await at('ask')).completed, false)
  equal((await at(eid)).connection.status, 'broken')
})

test('a keeper nobody lends fails the run, and the ask stays open', async () => {
  let { run, at } = await asked()
  await assertRejects(run, Error, 'nothing lends the keeper worker')
  equal(!!(await at('ask')).completed, false)
})
