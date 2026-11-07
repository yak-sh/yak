// An erased account stays erased (T-144468): the cookie it was given still
// verifies, but what it asks for next brings back no `person{}` with nothing
// to name it by.

import { assertEquals } from '@std/assert'
import { test } from '@yaks/testing'
import { directoryOf } from './directory.ts'
import type { Env } from './env.ts'
import { connector, fresh, signIn } from './probe.ts'
import { ledger, mint } from './grants.ts'
import { KERNEL, meta } from './meta.ts'
import { closed } from './erase.ts'
import { BOT } from '@yaks/platform/bots'

let env!: Env
let k = await fresh({}, (e) => env = e)
let dir = directoryOf(env.STORE)

let cy = await signIn(k, `cy-${crypto.randomUUID()}${BOT}`)
// The box's connection to a test account is a grant, and outlived the account
// it was for (T-144541).
let { token } = await mint(k.secret, ledger(env.OAUTH_KV)!, {
  person: cy.person,
})
await closed(env, dir, cy.email, { person: k.owner.person, role: 'owner' })
let page = await k.at(k.host, '/connect', {
  redirect: 'manual',
  headers: { cookie: cy.cookie },
})
let said = { status: page.status }
await page.body?.cancel()
await k.flushReports()
let reported = k.reported.length
let called = await connector(k, undefined, token).call('initialize', {
  protocolVersion: '2025-06-18',
  capabilities: {},
  clientInfo: { name: 'probe', version: '1' },
}).then(() => 'answered', (e: Error) => e.message.slice(0, 7))
let left = await meta(env).query(`.entity.eid=${cy.person}`)

test('an erased account is not revived by its cookie', () => {
  assertEquals(left, [])
  assertEquals({ ...said, reported }, {
    status: 403,
    reported: 0,
  })
})

test("an erased account's grant is revoked with it", () => {
  assertEquals(called, 'mcp 401')
})

// A row a credential wrote back before its erase revoked them is a bare
// `person{}` with no address to find it by, so it is named by its eid
// (T-147822); a newcomer's row, also without an address, is a person building.
let owner = { person: k.owner.person, role: 'owner' } as const
let bare = async (more = {}) => {
  let eid = crypto.randomUUID()
  await meta(env).apply([{ entity: { eid }, person: {}, ...more }], KERNEL)
  return eid
}
let revived = await bare()
let newcomer = await bare({ newcomer: { at: new Date().toISOString() } })
let gone = await closed(env, dir, revived, owner)
let kept = await closed(env, dir, newcomer, owner).then(
  () => 'erased',
  (e: Error) => e.message,
)

test('a bare person row is erased by its eid', async () => {
  assertEquals(gone?.person, revived)
  assertEquals(await meta(env).query(`.entity.eid=${revived}`), [])
})

test("a newcomer's row is not erased by its eid", () => {
  assertEquals(
    kept,
    `${newcomer} is not an expendable test account: only those are erased here`,
  )
})
