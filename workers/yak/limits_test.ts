// Every allowance is the space's (D-131886), through the whole kernel: a
// person owns one free space, a space somebody invited them into is not one
// of them, a space on the Plus plan does not count, spaces that were free
// before the cap stay free, and a space that has sent its month's letters
// stops only itself. usage_test.ts holds the readings at their seam; this
// holds that the doors ask them.
import { assertEquals, assertStringIncludes } from '@std/assert'
import { test, until } from '@yaks/testing'
import { connector, kernel, letter, meta, onPlus, signIn } from './probe.ts'

test('one free space a person, and each space answers to its own allowances', async () => {
  let k = await kernel()
  try {
    let [ada, bob, cy] = [await signIn(k), await signIn(k), await signIn(k)]
    let hers = connector(k, ada.cookie)
    let tag = crypto.randomUUID().slice(0, 6)
    let make = () =>
      hers.answer('space_new', { slug: `a${tag}`, title: 'A' })
        .then(() => '', (e) => String(e))
    // The spaces a person owns, eid and address, as the directory has them.
    let owned = async (p: { person: string }) => {
      let seats = await meta(k).query(
        `.member.person=${p.person}&.member.role=owner`,
      )
      return await Promise.all(seats.map(async (r) => {
        let eid = String((r.member as { space: string }).space)
        let [s] = await meta(k).query(`.entity.eid=${eid}`)
        return { eid, slug: String((s.space as { slug: string }).slug) }
      }))
    }

    // Signing in made her one, and Bob inviting her into his is not hers.
    await connector(k, bob.cookie).tool('member_add', { email: ada.email })
    let [first] = await owned(ada)
    let refused = await make()
    assertStringIncludes(
      refused,
      `one person gets one free space, and you own 1 (${first.slug})`,
    )

    // A space she owned before the cap stays hers, free and working.
    let [old] = await owned(cy)
    await meta(k).apply([{
      entity: { eid: '$seat' },
      member: { space: old.eid, person: ada.person, role: 'owner' },
    }])
    assertStringIncludes(await make(), 'you own 2')

    // The letters: one free space has sent its month's hundred, so it may not
    // send another, and her other, at ninety-nine, still sends.
    let month = new Date().toISOString().slice(0, 7)
    await meta(k).apply([
      { entity: { eid: first.eid }, meter: { month, emails: 100 } },
      { entity: { eid: old.eid }, meter: { month, emails: 99 } },
    ])
    let send = async (space: string, subject: string) => {
      await hers.tool('app_new', { space, slug: 'post', title: 'Post' })
      await hers.tool('store_mail_send', {
        space,
        app: 'post',
        to: 'nobody@probe.invalid',
        subject,
        body: 'Nothing to answer.',
      })
    }
    await send(first.slug, 'One too many')
    let said = await until(async () => {
      let { rows } = await hers.answer('mail_list', {
        space: first.slug,
        app: 'post',
      })
      let letters = rows as unknown as { bounced?: { reason: string } }[]
      return letters.map((l) => l.bounced?.reason).find(Boolean) ?? ''
    }, { timeout: 20_000, poll: 250, label: 'the letter to come to rest' })
    assertStringIncludes(
      said,
      `${first.slug} is on the free tier, which is 100`,
    )
    await send(old.slug, 'Its own hundredth')
    await letter(k, 'nobody@probe.invalid', 'Its own hundredth')

    // Spaces on the Plus plan are paid for on their own, and make room.
    await onPlus(k, first.eid)
    await onPlus(k, old.eid)
    assertEquals(await make(), '')
    assertEquals((await owned(ada)).length, 3)
  } finally {
    await k.stop()
  }
})
