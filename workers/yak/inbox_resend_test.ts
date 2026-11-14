// A letter Resend received, through the whole kernel: its signed
// `email.received` posted at `/mail/resend` (mail-receipts.ts), read in full
// from Resend's receiving API with the full-access key, and filed by the path
// a letter from Email Routing takes (inbox.ts `arrived`).
import { assertEquals, assertStringIncludes } from '@std/assert'
import { cleanup, test, until } from '@yaks/testing'
import { webhook } from '../../packages/resend/testing.ts'
import {
  client,
  connector,
  fresh,
  letters,
  meta,
  seed,
  unique,
} from './probe.ts'

let secret = 'whsec_' + btoa('the inbox webhook key')
let API = 'https://resend.test'

// Resend's receiving API, held here: each email by its id, its attachments
// at signed URLs that carry no key.
let held = new Map<string, Record<string, unknown>>()
let keys: string[] = []
let resend = (url: string, init: RequestInit = {}) => {
  if (url == `${API}/files/list.csv`) {
    return Promise.resolve(new Response('dish,who\nsoup,ana\n'))
  }
  keys.push(new Headers(init.headers).get('authorization') ?? '')
  let [, id, attachments] =
    /\/emails\/receiving\/([^/]+)(\/attachments)?$/.exec(url) ?? []
  let email = held.get(decodeURIComponent(id ?? ''))
  if (!email) return Promise.resolve(new Response(null, { status: 404 }))
  return Promise.resolve(Response.json(
    attachments
      ? {
        data: (email.attachments as { filename: string }[]).map((a) => ({
          download_url: `${API}/files/${a.filename}`,
          filename: a.filename,
          content_type: 'text/csv',
        })),
      }
      : email,
  ))
}

let k = await fresh({
  RESEND_WEBHOOK_SECRET: secret,
  RESEND_DOMAINS_TOKEN: 'full-access',
  RESEND_API: API,
  MAIL_FETCH: (url: string, init: RequestInit) =>
    url.startsWith(API) ? resend(url, init) : fetch(url, init),
})
cleanup(() => k.stop())

// One letter Resend took in, and its webhook posted as Resend posts it.
let posted = async (email: Record<string, unknown>) => {
  let id = crypto.randomUUID()
  held.set(id, {
    message_id: `<${id}@books.example>`,
    headers: { from: 'Ana <ana@books.example>' },
    authentication: { spf: 'pass', dkim: 'pass', dmarc: 'pass' },
    attachments: [],
    ...email,
  })
  let signed = await webhook(
    { type: 'email.received', data: { email_id: id } },
    secret,
  )
  let body = await signed.text()
  let post = () =>
    k.at(k.host, '/mail/resend', {
      method: 'POST',
      headers: Object.fromEntries(signed.headers),
      body,
    })
  return { first: await post(), again: await post() }
}

test('a letter Resend received files once in the app its address named, attachments and all', async () => {
  let jeff31 = unique('jeff31')
  {
    let them = await seed(k, [{ slug: jeff31, apps: ['recipes'] }])
    await connector(k, them.cookie).tool('app_set', {
      space: jeff31,
      app: 'recipes',
      access: 'private',
    })
    let { first, again } = await posted({
      from: 'ana@books.example',
      to: [`${jeff31}.recipes@yaks.app`],
      cc: ['friend@elsewhere.example'],
      subject: 'The list',
      text: 'It is attached.',
      attachments: [{ filename: 'list.csv' }],
    })
    assertEquals([first.status, again.status], [200, 200])
    assertEquals(new Set(keys), new Set(['Bearer full-access']))

    let recipes = client(k, `${jeff31}.yaks.app`, 'recipes', them.cookie)
    let [letter, ...more] = await recipes.get('.mail&?doc') as unknown as {
      entity: { eid: string }
      doc: { title: string; body: string }
      mail: { from: string; to: string; verified?: boolean }
    }[]
    assertEquals(more, [])
    assertEquals(letter.doc, { title: 'The list', body: 'It is attached.' })
    assertEquals(letter.mail.from, 'ana@books.example')
    assertEquals(letter.mail.to, `${jeff31}.recipes@yaks.app`)
    assertEquals(letter.mail.verified, true)
    let files = await until(async () => {
      let rows = await recipes.get('.attachment') as unknown as {
        entity: { eid: string }
        attachment: { name: string }
      }[]
      return rows.length ? rows : null
    }, { timeout: 15_000 })
    assertEquals(files!.map((f) => f.attachment.name), ['list.csv'])
    let links = await recipes.get(
      '.edge.from=' + letter.entity.eid,
    ) as unknown as { edge: { to: string } }[]
    assertEquals(links.map((l) => l.edge.to), [files![0].entity.eid])
    let [row] = await meta(k).query(
      `.entity.eid=${them.eids[jeff31]}&?meter`,
    )
    assertEquals((row?.meter as { emails?: number }).emails, 1)
  }
})

test('a letter Resend received for nobody here is answered with why, once its domain vouches for its sender', async () => {
  let nobody = unique('nobody')
  let { first } = await posted({
    from: 'bo@vouched.example',
    headers: { from: 'Bo <bo@vouched.example>' },
    to: [`${nobody}@yaks.app`],
    subject: 'Hello?',
    text: 'Anyone there?',
  })
  assertEquals(first.status, 200)
  let [told] = await until(() => {
    let said = letters(k, 'bo@vouched.example')
    return said.length ? said : null
  })
  assertEquals(told.subject, 'Not delivered: Hello?')
  assertStringIncludes(told.body, `${nobody}@yaks.app: no mailbox for`)

  // A From its domain does not vouch for is unproven: nobody is written to.
  await posted({
    from: 'cy@forged.example',
    headers: { from: 'cy@forged.example' },
    to: [`${nobody}@yaks.app`],
    authentication: { spf: 'fail', dkim: 'fail', dmarc: 'fail' },
  })
  assertEquals(letters(k, 'cy@forged.example'), [])
})
