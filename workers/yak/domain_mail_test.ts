// A space's own domain takes mail (D-415): domain_attach puts the mail domain
// at the domain, or at mail.<domain> beside mail it already takes or below its
// apex, and answers its records in the list with the web's; domain_status
// reads each record's arrival from the provider; domain_detach removes it.
// Resend's Domains API is stood in for (probe.ts `mailDomains`).
import { test } from '@yaks/testing'
import { assert, assertEquals, assertStringIncludes } from '@std/assert'
import {
  connector,
  dnsMx,
  kernel,
  meta,
  onPlus,
  seed,
  unique,
} from './probe.ts'

test('a domain takes mail at itself, or at mail.<domain> when it already takes mail', async () => {
  let k = await kernel()
  let api = k.mailDomains
  try {
    let ada = unique('ada')
    let { cookie, eids } = await seed(k, [{ slug: ada, apps: ['recipes'] }])
    await onPlus(k, eids[ada])
    let agent = connector(k, cookie)
    let bare = unique('township') + '.org'
    let taken = unique('church') + '.org'
    let www = `www.${unique('shop')}.com`
    let legacy = unique('legacy') + '.com'
    // The mail domains the stand-in holds for this test's hostnames.
    let held = () =>
      [...api.held.values()].map((d) => d.name).filter((n) =>
        [bare, taken, www, legacy].some((h) => n == h || n == `mail.${h}`)
      ).sort()
    let attach = (hostname: string, app?: string) =>
      agent.tool('domain_attach', { space: ada, hostname, app })
    let status = (hostname: string) =>
      agent.tool('domain_status', { space: ada, hostname })

    // No MX: mail is at the domain, and its records follow the web's.
    let said = await attach(bare)
    assertStringIncludes(said, `Mail is at ${bare}, carried by resend.`)
    assertStringIncludes(said, `  CNAME  ${bare}  →`)
    assertStringIncludes(
      said,
      `  MX  ${bare}  →  receive.forge.rmta.net  (priority 10)`,
    )
    assertStringIncludes(said, `recipes@${bare}`)
    assertStringIncludes(said, `such as clerk@${bare}`)
    assertEquals(held(), [bare])

    // Status reads each record's arrival from the provider.
    assertStringIncludes(
      await status(bare),
      `… mail: 0 of 5 records at ${bare} have arrived.`,
    )
    api.arrive(bare)
    assertStringIncludes(
      await status(bare),
      `✓ mail: every record at ${bare} has arrived`,
    )

    // An MX already there: mail.<domain>, and their mailboxes keep working.
    await dnsMx(k, taken, '10 mx.elsewhere.example.')
    let beside = await attach(taken, 'recipes')
    assertStringIncludes(beside, `Mail is at mail.${taken}`)
    assertStringIncludes(beside, `  MX  mail.${taken}  →`)
    assertStringIncludes(beside, `Every address at mail.${taken} reaches`)

    // Below an apex the CNAME leaves no room for an MX.
    assertStringIncludes(await attach(www), `Mail is at mail.${www}`)

    // A domain attached before it took mail gets it when attached again.
    await meta(k).apply([{
      hostname: { name: legacy, serves: eids[ada], stage: 'active' },
    }])
    assertStringIncludes(await status(legacy), '… mail: none yet')
    assertStringIncludes(await attach(legacy), `Mail is at ${legacy}`)
    assertEquals(held(), [bare, `mail.${taken}`, `mail.${www}`, legacy].sort())

    // Detached, its mail domain goes with it.
    let gone = await agent.tool('domain_detach', { space: ada, hostname: bare })
    assertStringIncludes(gone, `Its mail at ${bare} is removed.`)
    assert(!held().includes(bare))
  } finally {
    await k.stop()
  }
})
