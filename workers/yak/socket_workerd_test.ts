// A page's socket, held in workerd: the one door the in-memory kernel cannot
// serve, since the upgrade is a 101 answered with the runtime's own
// `WebSocketPair` and the store holds its end hibernating. The page is the
// kernel's own client, run here; a socket carries the app's hostname on its
// handshake, which a probe can only put there at the wire (probe.ts `relay`).
// What the doors answer over HTTP is client_test.ts's and inbox_test.ts's.
import { assertEquals } from '@std/assert'
import { until } from '../../bin/testing.ts'
import {
  arrives,
  browser,
  type Kernel,
  relay,
  rfc822,
  seed,
  workerd,
} from './probe.ts'

type Row = {
  kind: string
  entity: { eid: string }
  doc: { title: string; body?: string }
  mail: { from: string }
  created: { by: { eid: string; name: string } }
}

let titles = (rows: Row[]) => rows.map((r) => r.doc.title)

// A space of the test's own with a recipes app, its person's page (the
// served client over `browser`), and that page's socket, opened from the
// page's own address.
let page = async (k: Kernel) => {
  let slug = `sock${crypto.randomUUID().slice(0, 6)}`
  let host = `${slug}.yaks.app`
  let them = await seed(k, [{ slug, apps: ['recipes'] }])
  let dir = Deno.makeTempDirSync({ prefix: 'tasks-socket-' })
  let source = await (await k.at(host, '/recipes/api/client.js')).text()
  Deno.writeTextFileSync(`${dir}/client.js`, source)
  let mod = await import(`file://${dir}/client.js`)
  let mine = browser(k, host, them.cookie)
  let wire = relay(k, host, them.cookie, `https://${host}`)
  return {
    them,
    slug,
    store: mod.store(`${mine.origin}/recipes/api/`),
    live: mod.store(`${wire.origin}/recipes/api/`),
    stop: async () => {
      await mine.stop()
      await wire.stop()
      Deno.removeSync(dir, { recursive: true })
    },
  }
}

// A page's store, as far as watching goes (public/client.js `subscribe`).
type Live = {
  subscribe: (filter: string, on: (rows: Row[]) => void) => () => void
}

// What a subscription has said so far, and a wait for its next word.
let heard = (live: Live, filter: string) => {
  let seen: Row[][] = []
  let stop = live.subscribe(filter, (rows: Row[]) => seen.push(rows))
  let next = async (n: number) => {
    await until(() => seen.length >= n, { timeout: 15_000 })
    return seen[n - 1]
  }
  return { next, stop }
}

Deno.test('a page watches its store and hears what others write', async () => {
  let k = workerd()
  let p = await page(k)
  try {
    let saved = await p.store.apply({
      entity: { eid: '$cake' },
      doc: { title: 'Lemon cake' },
      task: {},
    })
    let cake = saved.aliases.$cake
    let open = heard(p.live, '.task.status=open&?doc')
    let bylines = heard(p.live, '.doc&.created')
    try {
      assertEquals(titles(await open.next(1)), ['Lemon cake'])
      // Another device writes, and the page hears it without asking.
      await p.store.apply({
        entity: { eid: cake },
        doc: { title: 'Lime cake' },
      })
      assertEquals(titles(await open.next(2)), ['Lime cake'])
      // A subscription is that query still answering, so it answers with the
      // rows `query()` hands back for the same filter: its kind, its body, and
      // no eid inside a component (C-32624 item 2).
      await p.store.apply({
        doc: { title: 'Fig tart', body: 'six figs, honey' },
        task: {},
      })
      assertEquals(
        await open.next(3),
        await p.store.query('.task.status=open&?doc'),
      )
      // The byline rides the same projection, so a page draws its writers
      // without a second question.
      assertEquals(
        [...new Set((await bylines.next(1)).map((r) => r.created.by.name))],
        [p.them.name],
      )
    } finally {
      open.stop()
      bylines.stop()
    }
  } finally {
    await p.stop()
    await k.stop()
  }
})

Deno.test('a page watching its store hears a letter arrive', async () => {
  let k = workerd()
  let p = await page(k)
  try {
    let mail = heard(p.live, '.mail&?doc')
    try {
      assertEquals(await mail.next(1), [])
      let landed = await arrives(k, {
        from: 'ana@books.example',
        to: `${p.slug}.recipes@yaks.app`,
        raw: rfc822(
          { From: 'Ana <ana@books.example>', Subject: 'Bring a dish' },
          'Potluck Friday.',
        ),
      })
      assertEquals(landed.status, 200)
      let [letter] = await mail.next(2)
      assertEquals([letter.kind, letter.doc.title], ['mail', 'Bring a dish'])
      assertEquals(letter.mail.from, 'ana@books.example')
    } finally {
      mail.stop()
    }
  } finally {
    await p.stop()
    await k.stop()
  }
})
