import { test } from '@yaks/testing'
import { assert, assertEquals } from '@std/assert'
import type { Bundle } from '@yaks/graph'
import { again, SUBJECT, unsealed } from './invite.ts'
import type { Directory, Space } from './directory.ts'
import type { Env } from './env.ts'
import type { Letter } from './mail.ts'

let SECRET = 'secret'
let JEFF = 'jeff-eid'
let space = { eid: 'sp', slug: 'jeff', title: 'Jeff' } as Space
let emailOf = (person: string) => `${person}@x.test`
let cy = emailOf('cy')

let resending = () => {
  let elsewhere = { eid: 'other', slug: 'other', title: 'Other' } as Space
  let invitations: Record<string, { to: string }> = {
    'inv-cy': { to: 'sp' },
    'inv-far': { to: 'other' },
  }
  let dir = {
    invitation: (eid: string) =>
      Promise.resolve(
        invitations[eid] && {
          eid,
          ...invitations[eid],
          person: 'cy',
          role: 'viewer',
          by: JEFF,
        },
      ),
    appAt: () => Promise.resolve(null),
    at: (eid: string) =>
      Promise.resolve(
        eid == 'sp' ? space : eid == 'other' ? elsewhere : null,
      ),
    emailAt: (person: string) => Promise.resolve(emailOf(person)),
    nameAt: () => Promise.resolve('Jeff'),
    inviting: () => Promise.resolve(null),
    owners: () => Promise.resolve([]),
    spaces: () => Promise.resolve([]),
  } as unknown as Directory
  let wrote: Bundle[] = []
  let env = {
    SESSION_SECRET: SECRET,
    META: {
      query: () => Promise.resolve([]),
      apply: (b: Bundle[]) => (wrote.push(...b), Promise.resolve(b)),
    },
  } as unknown as Env
  let sent: Letter[] = []
  let post = (l: Letter) => Promise.resolve(void sent.push(l))
  let press = (eid: string) =>
    again(env, dir, space, { person: JEFF }, eid, post)
  return { press, sent, wrote }
}
let resent = resending()
let marked = resending()
let goneSince = resending()
let elsewhere = resending()
test('Send again mails a standing invitation again', async () => {
  let { press, sent } = resent
  assertEquals(await press('inv-cy'), null)
  assertEquals(sent.map((l) => [l.to, l.subject]), [[cy, SUBJECT]])
  let t = /\/invite\?t=(\S+)/.exec(sent[0].body)![1]
  let sealed = await unsealed(decodeURIComponent(t), SECRET)
  assertEquals([sealed?.invite, sealed?.to], ['inv-cy', 'sp'])
})

test('Send again records that the standing invitation was mailed', async () => {
  let { press, wrote } = marked
  await press('inv-cy')
  assert(wrote.some((b) => b.entity.eid == 'inv-cy' && b.invite))
})

test('Send again sends nothing for an invitation gone', async () => {
  let { press, sent } = goneSince
  let gone = { say: 'That invitation is no longer waiting.', no: true }
  assertEquals(await press('inv-gone'), gone)
  assertEquals(sent.length, 0)
})

test('Send again sends nothing for an invitation in another space', async () => {
  let { press, sent } = elsewhere
  let gone = { say: 'That invitation is no longer waiting.', no: true }
  assertEquals(await press('inv-far'), gone)
  assertEquals(sent.length, 0)
})
