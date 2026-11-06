// An erased account stays erased (T-144468): the cookie it was given still
// verifies, but what it asks for next brings back no `person{}` with nothing
// to name it by.

import { assertEquals } from '@std/assert'
import { test } from '@yaks/testing'
import { directoryOf } from './directory.ts'
import type { Env } from './env.ts'
import { fresh, signIn } from './probe.ts'
import { meta } from './meta.ts'
import { closed } from './erase.ts'
import { BOT } from './lib/bots.ts'

let env!: Env
let k = await fresh({}, (e) => env = e)
let dir = directoryOf(env.STORE)

let cy = await signIn(k, `cy-${crypto.randomUUID()}${BOT}`)
await closed(env, dir, cy.email, { person: k.owner.person, role: 'owner' })
let page = await k.at(k.host, '/connect', {
  redirect: 'manual',
  headers: { cookie: cy.cookie },
})
let said = { status: page.status }
await page.body?.cancel()
await k.flushReports()
let reported = k.reported.length
let left = await meta(env).query(`.entity.eid=${cy.person}`)

test('an erased account is not revived by its cookie', () => {
  assertEquals(left, [])
  assertEquals({ ...said, reported }, {
    status: 403,
    reported: 0,
  })
})
