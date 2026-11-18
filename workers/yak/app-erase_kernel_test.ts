// Erasing an app before its thirty days are up, through the whole kernel:
// two steps, and an agent takes at most the first. app_delete trashes,
// app_erase only mails the owner, and the owner's press on the letter's page
// is what erases (erase.ts `appTicket`, identity.ts `erasing`).

import { assert, assertEquals, assertStringIncludes } from '@std/assert'
import { test, until } from '@yaks/testing'
import { client, connector, kernel, letters, meta, seed } from './probe.ts'

test('an app is erased only by its owner from the letter an agent asked for', async () => {
  let k = await kernel()
  try {
    let slug = `eraselab-${crypto.randomUUID().slice(0, 8)}`
    let them = await seed(k, [{ slug, apps: ['shop'] }])
    let agent = connector(k, them.cookie)
    let at = { space: slug, app: 'shop' }
    await client(k, `${slug}.yaks.app`, 'shop', them.cookie).applied({
      entities: [{ doc: { title: 'a note to keep' } }],
    })
    let row = async () =>
      (await meta(k).query(`.app.space=${them.eids[slug]}&?trashed`))[0]
    let eid = (await row()).entity.eid as string

    // Not in the trash yet: there is nothing to ask for.
    let early = await agent.tool('app_erase', at).catch((e: Error) => e.message)
    assertStringIncludes(early, 'is not in the trash')

    // The retired `forever` trashes like any delete; then the agent asks.
    assertStringIncludes(
      await agent.tool('app_delete', { ...at, forever: true }),
      'is in the trash',
    )
    let said = await agent.tool('app_erase', { space: slug, app: eid })
    assertStringIncludes(said, 'nothing is erased')
    assertStringIncludes(said, 'check their email')
    assert(await row(), 'the ask erased the app')

    let mail = await until(
      () => letters(k, them.email).findLast((l) => l.subject.includes('Erase')),
      { timeout: 20_000, poll: 100, label: 'the erase letter' },
    )
    let link =
      /https:\/\/yaks\.app(\/space\/[\w-]+\/apps\/[\w-]+\/erase\?t=\S+)/
        .exec(mail!.body)
    assert(link, `no confirmation link in: ${mail!.body}`)
    let page = link[1]

    // An agent's bearer is sent to sign in, and a stranger is told nothing.
    let shut = await k.at('yaks.app', page, {
      method: 'POST',
      redirect: 'manual',
      headers: { authorization: 'Bearer whatever-an-agent-holds' },
    })
    assertEquals(shut.status, 302)
    await shut.body?.cancel()
    let stranger = await seed(k, [])
    let no = await k.at('yaks.app', page, {
      headers: { cookie: stranger.cookie },
    })
    assertEquals(no.status, 404)
    await no.body?.cancel()

    // The owner's GET only draws the page.
    let drawn = await (await k.at('yaks.app', page, {
      headers: { cookie: them.cookie },
    })).text()
    assertStringIncludes(drawn, 'What goes, for good')
    assert(await row(), 'opening the page erased the app')

    // Their press erases it.
    let form = (fields: Record<string, string>) =>
      k.at('yaks.app', `/space/${slug}/apps/${eid}/erase`, {
        method: 'POST',
        headers: {
          cookie: them.cookie,
          'content-type': 'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams(fields).toString(),
      })
    let wrong = await form({ confirm: 'nope' })
    assertEquals(wrong.status, 400)
    await wrong.body?.cancel()
    assert(await row(), 'a wrong name erased the app')
    let gone = await form({ t: decodeURIComponent(page.split('t=')[1]) })
    assertEquals(gone.status, 200)
    assertStringIncludes(await gone.text(), 'is erased')
    assertEquals(await row(), undefined)
  } finally {
    await k.stop()
  }
})
