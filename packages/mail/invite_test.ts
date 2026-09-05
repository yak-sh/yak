// The worked example, end to end: somebody joins the club and a letter about
// it is written, sent, and stamped — through one apply() and two effects that
// have never heard of each other.

import { assert, assertEquals } from '@std/assert'
import type { Bundle, Comp } from '@yaks/graph'
import { clubhouse, noon } from './harness.ts'
import { invited } from './invite.ts'

let club = 'sp-club'
let ana = 'p-ana'

let rig = async (refuse?: string) => {
  let house = clubhouse(refuse)
  house.fx.created(
    'member',
    invited({
      apply: (change) => house.g.apply(change),
      eid: () => 'e-invite',
      now: noon,
      welcome: ({ role }) => ({
        from: 'hello@books.example',
        subject: role == 'owner'
          ? 'You run the book club'
          : 'You are in the book club',
        body: 'Welcome. We meet Thursdays.',
      }),
    }),
  )
  await house.g.apply([
    { entity: { eid: club }, space: { name: 'Book club' } },
    {
      entity: { eid: ana },
      person: { name: 'Ana' },
      email: { address: 'ana@books.example' },
    },
  ])
  return house
}

Deno.test('a new seat writes an invitation, and the invitation goes', async () => {
  let { g, post } = await rig()
  await g.apply([{
    entity: { eid: 'm-first' },
    member: { space: club, person: ana, role: 'member' },
  }])
  assertEquals(post.sent.length, 1)
  assertEquals(post.last()?.to, 'ana@books.example')
  assertEquals(post.last()?.subject, 'You are in the book club')
  // The letter is an entity like any other: about the seat, and settled.
  let [invite] = (await g.read('.eid=e-invite')) as Bundle[]
  assertEquals((invite.mail as Comp).target, 'm-first')
  assertEquals((invite.delivered as Comp).via, 'stash-1')
})

Deno.test("the role is the letter's business, not the handler's", async () => {
  let { g, post } = await rig()
  await g.apply([{
    entity: { eid: 'm-first' },
    member: { space: club, person: ana, role: 'owner' },
  }])
  assertEquals(post.last()?.subject, 'You run the book club')
})

Deno.test('a member with no address gets a bounced invitation, not silence', async () => {
  let { g, post } = await rig()
  await g.apply([{ entity: { eid: 'p-bo' }, person: { name: 'Bo' } }])
  await g.apply([{
    entity: { eid: 'm-second' },
    member: { space: club, person: 'p-bo', role: 'member' },
  }])
  assertEquals(post.sent.length, 0)
  let [invite] = (await g.read('.eid=e-invite')) as Bundle[]
  assert(String((invite.bounced as Comp).reason).includes('no address on file'))
})
