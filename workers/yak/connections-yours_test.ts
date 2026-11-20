// A person's own connections on their connections page, read through the
// directory's door, which names a reference to a person as it answers.
import { assertStringIncludes } from '@std/assert'
import { test } from '@yaks/testing'
import { kernel, meta, signIn } from './probe.ts'

test("a person's own connection shows under Yours on their own space's page", async () => {
  let k = await kernel()
  let ada = await signIn(k)
  let [own] = (await k.dir.seats(ada.person)).filter((s) => s.own)
  await meta(k).apply([{
    entity: { eid: '$c' },
    connection: {
      integration: `mcp:${crypto.randomUUID()}`,
      owner: ada.person,
      status: 'needed',
    },
    secret: { name: `connection:${crypto.randomUUID()}` },
  }])
  let page = await k.at(k.host, `/manage/${own.space.slug}/connections`, {
    headers: { cookie: ada.cookie },
  })
  assertStringIncludes(await page.text(), '>Yours</h2>')
})
