// The D1 vault, handed to @yaks/secrets the way yaks.app hands it: the plugin
// seals into it, the value reads back, and the rows hold only ciphertext.

import { assert, assertEquals, assertRejects } from '@std/assert'
import { graph } from '@yaks/graph'
import { ram } from '@yaks/ram'
import {
  records,
  retryable,
  reveal,
  sealed,
  secretEid,
  secrets,
  secretsDoc,
  unsealed,
  type Vault,
} from '@yaks/secrets'
import { loadVocab } from '@yaks/vocab'
import { col, select, table } from '@yaks/sql'
import { prepare } from './d1.ts'
import { d1 } from './testing.ts'
import { d1Vault, transient } from './vault.ts'

let vocab = loadVocab([secretsDoc])
let key = () =>
  crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, [
    'encrypt',
    'decrypt',
  ])

let setup = (db = d1()) => {
  // The key still on its way, as one imported from a Worker secret is.
  let vault: Vault = d1Vault(db, key())
  let g = graph({
    storage: ram(vocab),
    vocab,
    plugins: [secrets(vault, (b) => g.apply(b, { trusted: true }))],
  })
  return { db, g, vault }
}

Deno.test('a secret sealed through the graph is ciphertext in D1', async () => {
  let { db, g, vault } = setup()
  await g.apply([sealed('A', 'plain-value')])
  assertEquals(await reveal(vault, 'A'), 'plain-value')
  let { results } = await prepare(
    db,
    select({ cols: [col('k'), col('v')], from: table('yak_vault') }),
  ).all<{ k: string; v: string }>()
  assert(results.every((r) => !atob(r.v).includes('plain-value')))
  assertEquals((await vault.all()).map(([e]) => e), [secretEid('A')])
  await g.apply([unsealed('A')])
  assertEquals(await vault.all(), [])
})

Deno.test('the salt is made once, and opens only under its key', async () => {
  let db = d1()
  let k = await key()
  let salt = await d1Vault(db, k).salt()
  assertEquals(await d1Vault(db, k).salt(), salt)
  await assertRejects(async () => await d1Vault(db, await key()).salt())
})

Deno.test('the lock holds a read, a change and the write back as one step', async () => {
  let { g, vault } = setup()
  let store = records<{ n?: number }>(g, vault, 'count ')
  await Promise.all(
    [1, 2, 3].map(() =>
      store.update('a', (r) => Promise.resolve(void (r.n = (r.n ?? 0) + 1)))
    ),
  )
  assertEquals(await store.read('a'), { n: 3 })
})

Deno.test('a lease held by another isolate is waited for', async () => {
  let db = d1()
  let k = await key()
  let one = d1Vault(db, k)
  let two = d1Vault(db, k)
  let order: string[] = []
  let first = one.lock('x', async () => {
    order.push('one in')
    await new Promise((r) => setTimeout(r, 20))
    order.push('one out')
  })
  await new Promise((r) => setTimeout(r, 1))
  await two.lock('x', () => Promise.resolve(void order.push('two')))
  await first
  assertEquals(order, ['one in', 'one out', 'two'])
})

Deno.test('what D1 says to retry is flagged retryable, and nothing else is', async () => {
  let failing = (message: string) => {
    let db = d1()
    return d1Vault({
      ...db,
      prepare: () => {
        throw new Error(`D1_ERROR: ${message}`)
      },
    }, key())
  }
  let lost = await failing('Network connection lost.').drop('x').catch((e) => e)
  assert(retryable(lost) && transient(lost))
  let typo = await failing('no such table: yak_vault').drop('x').catch((e) => e)
  assert(!retryable(typo))
})
