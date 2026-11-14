// A Plus plan space has mail at its subdomain from the first time it uses
// mail (D-415): its first letter sets the mail domain up at the provider
// (probe.ts `mailDomains`) and writes its records and the space's own AAAA
// record in the zone (probe.ts `zoneRecords`). A free space keeps
// `<space>@yaks.app`. Where a letter there lands, and the address a reply
// leaves from, are inbox_test.ts's.
import { assertEquals, assertStringIncludes } from '@std/assert'
import { test, until } from '@yaks/testing'
import { domainsApi } from '../../packages/resend/testing.ts'
import type { Space } from './directory.ts'
import {
  arrives,
  client,
  cloudflare,
  connector,
  kernel,
  meta,
  onPlus,
  rfc822,
  seed,
  unique,
  zoneRecords,
} from './probe.ts'
import { mailDomains } from './mail-domains.ts'
import { unmailSpace } from './space-mail.ts'
import { written } from './zone.ts'

// The records a subdomain takes mail by, as the zone holds them.
let recordsOf = (name: string) =>
  [
    `AAAA ${name} 100::`,
    `CNAME rsend.${name} send.forge.rmta.net`,
    `MX ${name} receive.forge.rmta.net`,
    `MX send.${name} feedback-smtp.us-east-1.amazonses.com`,
    `TXT resend._domainkey.${name} p=MIGfMA0GCSq`,
    `TXT send.${name} v=spf1 include:amazonses.com ~all`,
  ].sort()

test("a Plus plan space's first letter sets its subdomain up for mail, and a free space's does not", async () => {
  let k = await kernel()
  try {
    let plus = unique('plus'), free = unique('free'), sends = unique('sends')
    let { cookie, eids } = await seed(k, [
      { slug: plus, apps: ['recipes'] },
      { slug: free, apps: ['notes'] },
      { slug: sends, apps: ['shop'] },
    ])
    await onPlus(k, eids[plus])
    await onPlus(k, eids[sends])
    let letter = async (to: string) => {
      let landed = await arrives(k, {
        from: 'ana@books.example',
        to,
        raw: rfc822({ From: 'ana@books.example', Subject: 'Hi' }, 'Hello.'),
      })
      assertEquals(landed.status, 200, await landed.text())
    }
    let held = () =>
      [...k.mailDomains.held.values()].map((d) => d.name)
        .filter((n) => [plus, free, sends].some((s) => n.startsWith(s)))
    let mailOf = async (eid: string) =>
      (await meta(k).query(`.entity.eid=${eid}&?mail_domain`))[0]
        ?.mail_domain

    await letter(`${free}.notes@yaks.app`)
    assertEquals(held(), [])
    assertEquals(await mailOf(eids[free]), undefined)

    await letter(`${plus}.recipes@yaks.app`)
    let name = `${plus}.yaks.app`
    assertEquals(held(), [name])
    assertEquals(
      (await zoneRecords(k)).filter((r) => r.includes(name)),
      recordsOf(name),
    )
    assertEquals(await mailOf(eids[plus]), { name, via: 'resend' })
    // Writing the records asked the provider to check them.
    assertEquals(
      k.mailDomains.calls.filter((c) => c.endsWith('/verify')).length,
      1,
    )

    // app_list says the app's address there.
    assertStringIncludes(
      await connector(k, cookie).tool('app_list', {
        space: plus,
        app: 'recipes',
      }),
      `email ${plus}.recipes@yaks.app, recipes@${name}`,
    )

    // Once set up, a letter asks the provider nothing.
    k.mailDomains.calls.length = 0
    await letter(`recipes@${name}`)
    assertEquals(k.mailDomains.calls, [])

    // Sending is using mail too.
    await client(k, `${sends}.yaks.app`, 'shop', cookie).post({
      entities: [
        { entity: { eid: '$ana' }, email: { address: 'ana@books.example' } },
        {
          entity: { eid: '$note' },
          doc: { title: 'Your order', body: 'On its way.' },
          mail: {},
          deliver: { to: '$ana' },
        },
      ],
    })
    await until(() => held().includes(`${sends}.yaks.app`))
  } finally {
    await k.stop()
  }
})

test("erasing a space removes its subdomains' mail, but not one another space has taken", async () => {
  let cf = cloudflare()
  let api = domainsApi('a-token')
  let env = {
    CF_ZONE: 'zone',
    CF_DNS_TOKEN: 'a-token',
    HOSTNAMES_API: cf.url,
    RESEND_DOMAINS_TOKEN: 'a-token',
    MAIL_FETCH: api.fetch,
  }
  let k = { cloudflare: cf.url }
  let space = (slug: string, slugs: string[] = []) =>
    ({ eid: slug, slug, slugs, tier: 'plus', mail: null }) as unknown as Space
  // Each subdomain set up as a space's first letter sets it up.
  let wrote = async (slug: string) => {
    let name = `${slug}.yaks.app`
    let { records } = await (await mailDomains(env)).setup(name)
    await written(env, [
      ...records.map((r) => ({ type: r.type, name: r.name, content: r.value })),
      { type: 'AAAA', name, content: '100::' },
    ])
  }
  for (let slug of ['ada', 'was', 'taken']) await wrote(slug)

  let ada = {
    ...space('ada', ['was', 'taken']),
    mail: { name: 'ada.yaks.app', via: 'resend' },
  }
  let dir = {
    space: (slug: string) =>
      Promise.resolve(slug == 'taken' ? space('taken') : null),
  }
  await unmailSpace(env, dir, ada)
  assertEquals([...api.held.values()].map((d) => d.name), ['taken.yaks.app'])
  assertEquals(await zoneRecords(k), recordsOf('taken.yaks.app'))
})
