// The free allowance is a person's, not a space's (T-37882), through the whole
// kernel: a person owns five free spaces, a space somebody invited them into
// is not one of them, a space on the Plus plan does not count, and the
// month's letters are shared by every free space the owner has. usage_test.ts
// holds the sums at their seam; this holds that the doors ask them.
import { assertStringIncludes } from '@std/assert'
import { until } from '../../bin/testing.ts'
import { connector, kernel, meta, plus, signIn } from './probe.ts'

let eidIn = (said: string) => /\(([0-9a-f-]{36})\)/.exec(said)![1]

Deno.test('free allowances hold per person, not per space', async () => {
  let k = await kernel()
  try {
    // The first to sign in owns the platform too, which is how this test
    // writes a meter reading below.
    let ada = await signIn(k)
    let bob = await signIn(k)
    let hers = connector(k, ada.cookie)
    let his = connector(k, bob.cookie)
    let tag = crypto.randomUUID().slice(0, 6)
    let make = (n: number) =>
      hers.tool('space_new', { slug: `a${tag}${n}`, title: `A${n}` })

    // Signing in made her one; three more is four.
    let made = [await make(1), await make(2), await make(3)].map(eidIn)
    // Bob invites her into his: sharing never counts against her.
    await his.tool('member_add', { email: ada.email })
    made.push(eidIn(await make(4)))
    let refused = await make(5).then(() => '', (e) => String(e))
    assertStringIncludes(refused, 'you own 5 free spaces')
    assertStringIncludes(refused, 'Plus plan')

    // One on the Plus plan is paid for on its own, and frees a place.
    await plus(k, made[0])
    made.push(eidIn(await make(5)))

    // The letters: two of her free spaces have sent the month's hundred
    // between them, so a third may not send one, though it has sent none.
    let month = new Date().toISOString().slice(0, 7)
    await meta(k).apply([
      { entity: { eid: made[1] }, meter: { month, emails: 60 } },
      { entity: { eid: made[2] }, meter: { month, emails: 40 } },
    ])
    let space = `a${tag}4`
    await hers.tool('app_new', { space, slug: 'post', title: 'Post' })
    await hers.tool('mail_send', {
      space,
      app: 'post',
      to: 'nobody@probe.invalid',
      title: 'One too many',
      body: 'Nothing to answer.',
    })
    let said = await until(async () => {
      let box = await hers.tool('mail_list', { space, app: 'post' })
      return box.includes('bounced') ? box : ''
    }, { timeout: 20_000, poll: 250, label: 'the letter to come to rest' })
    assertStringIncludes(said, 'shared by the free spaces its owner has')
  } finally {
    await k.stop()
  }
})
