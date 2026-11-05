// A change to an app reaches the space's other people in their Updates
// (updates.ts), through the kernel's own doors: the connector deploys, and
// the Updates page says who changed what.
import { test } from '@yaks/testing'
import { assertEquals } from '@std/assert'
import { parseHTML } from 'linkedom'
import { connector, kernel, seed, signIn, unique } from './probe.ts'
import { managePath } from './route.ts'

let k = await kernel()
let slug = unique('told')
let { cookie, person, eids } = await seed(k, [{ slug, apps: ['notes'] }])
let other = await signIn(k)
await k.dir.apply({
  entities: [{
    entity: { eid: crypto.randomUUID() },
    member: { space: eids[slug], person: other.person, role: 'editor' },
  }],
}, { 'x-yak-person': person, 'x-yak-role': 'owner' })
let agent = connector(k, cookie)
await agent.tool('app_files', {
  space: slug,
  app: 'notes',
  files: [{ path: 'index.html', content: '<h1>Notes</h1>' }],
})
await agent.tool('app_deploy', { space: slug, app: 'notes' })
await k.settled()

let said = async (as: string) => {
  let page = await k.at('yaks.app', managePath('updates', slug), {
    headers: { cookie: as },
  })
  return [
    ...parseHTML(await page.text()).document.querySelectorAll(
      '.Update_Words',
    ),
  ].map((p) => p.textContent)
}

test('a change to an app tells the space’s other people, and not who made it', async () => {
  let words = await said(other.cookie)
  assertEquals(words.length, 1)
  assertEquals(words[0]!.endsWith(' changed notes.'), true)
  assertEquals(await said(cookie), [])
})
