// Every allowance is the space's (D-131886), through the whole kernel: a
// person owns five free spaces, a space somebody invited them into is not one
// of them, a space on the Plus plan does not count, and a space that has sent
// its month's letters stops only itself. usage_test.ts holds the readings at
// their seam; this holds that the doors ask them.
import { assertStringIncludes } from '@std/assert'
import { test, until } from '@yaks/testing'
import { connector, kernel, letter, meta, onPlus, signIn } from './probe.ts'

let eidIn = (said: { value?: Record<string, unknown> }) =>
  String(said.value?.eid)

test("free allowances hold per space, never across an owner's spaces", async () => {
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
      hers.answer('space_new', { slug: `a${tag}${n}`, title: `A${n}` })

    // Signing in made her one; three more is four.
    let made = [await make(1), await make(2), await make(3)].map(eidIn)
    // Bob invites her into his: sharing never counts against her.
    await his.tool('member_add', { email: ada.email })
    made.push(eidIn(await make(4)))
    let refused = await make(5).then(() => '', (e) => String(e))
    assertStringIncludes(refused, 'you own 5 free spaces')
    assertStringIncludes(refused, 'Plus plan')

    // One on the Plus plan is paid for on its own, and frees a place.
    await onPlus(k, made[0])
    made.push(eidIn(await make(5)))

    // The letters: one free space has sent its month's hundred, so it may not
    // send another, and her other free space, at ninety-nine, still sends.
    let month = new Date().toISOString().slice(0, 7)
    await meta(k).apply([
      { entity: { eid: made[1] }, meter: { month, emails: 100 } },
      { entity: { eid: made[3] }, meter: { month, emails: 99 } },
    ])
    let send = async (n: number, subject: string) => {
      let space = `a${tag}${n}`
      await hers.tool('app_new', { space, slug: 'post', title: 'Post' })
      await hers.tool('store_mail_send', {
        space,
        app: 'post',
        to: 'nobody@probe.invalid',
        subject,
        body: 'Nothing to answer.',
      })
      return space
    }
    let full = await send(2, 'One too many')
    let said = await until(async () => {
      let box = await hers.tool('mail_list', { space: full, app: 'post' })
      return box.includes('bounced') ? box : ''
    }, { timeout: 20_000, poll: 250, label: 'the letter to come to rest' })
    assertStringIncludes(said, `${full} is on the free tier, which is 100`)
    await send(4, 'Its own hundredth')
    await letter(k, 'nobody@probe.invalid', 'Its own hundredth')
  } finally {
    await k.stop()
  }
})
