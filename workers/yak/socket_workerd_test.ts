// A page's socket, held in workerd: the one door the in-memory kernel cannot
// serve, since the upgrade is a 101 answered with the runtime's own
// `WebSocketPair` and the store holds its end hibernating. The page is the
// kernel's own client, run here; a socket carries the app's hostname on its
// handshake, which a probe can only put there at the wire (probe.ts `relay`).
// What the doors answer over HTTP is client_test.ts's and inbox_test.ts's.
import { assertEquals, assertObjectMatch } from '@std/assert'
import { client } from '@yaks/client'
import { loadVocab } from '@yaks/vocab'
import { test, until } from '@yaks/testing'
import { minted } from './mcp-probe.ts'
import {
  arrives,
  browser,
  connector,
  type Kernel,
  relay,
  rfc822,
  seed,
  txt,
  vocabFile,
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
  for (let file of ['_draft.js', '_outbox.js', '_wire.js']) {
    let asset = await k.at(host, `/recipes/api/${file}`)
    assertEquals(asset.status, 200)
    Deno.writeTextFileSync(`${dir}/${file}`, await asset.text())
  }
  let mod = await import(`file://${dir}/client.js`)
  let mine = browser(k, host, them.cookie)
  let wire = await relay(k, host, them.cookie, `https://${host}`)
  return {
    them,
    slug,
    mine: `${mine.origin}/recipes/api`,
    wire: `${wire.origin}/recipes/api`,
    store: mod.store(`${mine.origin}/recipes/api/`),
    live: mod.store(`${wire.origin}/recipes/api/`),
    another: () => mod.store(`${wire.origin}/recipes/api/`),
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

// What a subscription shows, waited for. Its first rows may arrive twice, from
// a query and then from the socket, so a test waits on what the page would
// draw rather than counting answers.
let heard = (live: Live, filter: string) => {
  let last: Row[] | undefined
  let stop = live.subscribe(filter, (rows: Row[]) => last = rows)
  let showing = async (want: (rows: Row[]) => boolean) => {
    await until(() => last != null && want(last), { timeout: 15_000 })
    return last!
  }
  return { showing, stop }
}
let named = (...want: string[]) => (rows: Row[]) =>
  titles(rows).join('|') == want.join('|')

test('a page watches a component homed in another app', async () => {
  let k = workerd()
  let slug = `borrow${crypto.randomUUID().slice(0, 6)}`
  let host = `${slug}.yaks.app`
  let them = await seed(k, [{ slug, apps: ['probe', 'vale'] }])
  let agent = connector(k, them.cookie)
  let wire = await relay(k, host, them.cookie, `https://${host}`)
  let box: ReturnType<typeof client> | undefined
  try {
    for (let app of ['probe', 'vale']) {
      await agent.tool('app_files', {
        space: slug,
        app,
        op: 'write',
        path: 'vocab.json',
        content: vocabFile({ fire: { village: txt } }),
      })
      await agent.tool('app_deploy', { space: slug, app })
    }
    let saved = await agent.tool('graph_apply', {
      space: slug,
      app: 'vale',
      entities: [{
        entity: { eid: '$camp' },
        fire: { village: 'Vale' },
        doc: { title: 'Campfire' },
      }],
    })
    let eid = minted(saved, '$camp')
    let docs = await (await k.at(host, '/vale/api/vocab.json', {
      headers: { cookie: them.cookie },
    })).json()
    box = client(loadVocab(docs), [], {
      url: `${wire.origin}/vale/api`,
      vault: false,
      wireVault: false,
    })
    let fires = box.watch('.fire')
    let mixed = box.watch('.fire&?doc')
    let village = () => (fires.value[0]?.fire as { village?: string })?.village
    await until(() => fires.ready && mixed.ready && village() == 'Vale', {
      timeout: 15_000,
    })
    assertEquals(mixed.value[0]?.entity.eid, eid)
    assertEquals((mixed.value[0]?.doc as { title?: string })?.title, 'Campfire')

    await agent.tool('graph_apply', {
      space: slug,
      app: 'probe',
      entities: [{ entity: { eid }, fire: { village: 'Ridge' } }],
    })
    await until(() => village() == 'Ridge', { timeout: 15_000 })
    assertEquals(
      (mixed.value[0]?.fire as { village?: string })?.village,
      'Ridge',
    )
    await box.mutate([{
      entity: { eid },
      fire: { village: 'Forest' },
    }])
    await box.wire?.idle()
    await until(() => village() == 'Forest', { timeout: 15_000 })
    let home = JSON.parse(
      await agent.tool('graph_query', {
        space: slug,
        app: 'probe',
        filter: `.entity.eid=${eid}&.fire`,
      }),
    ) as { fire: { village: string } }[]
    assertEquals(home[0].fire.village, 'Forest')
    await agent.tool('graph_apply', {
      space: slug,
      app: 'probe',
      entities: [{ entity: { eid }, fire: null }],
    })
    await until(() => fires.value.length == 0 && mixed.value.length == 0, {
      timeout: 15_000,
    })
    fires.close()
    mixed.close()
  } finally {
    box?.close()
    await wire.stop()
    await k.stop()
  }
})

test('a page watches its store and hears what others write', async () => {
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
      await open.showing(named('Lemon cake'))
      // Another device writes, and the page hears it without asking.
      await p.store.apply({
        entity: { eid: cake },
        doc: { title: 'Lime cake' },
      })
      await open.showing(named('Lime cake'))
      // A subscription is that query still answering, so it answers with the
      // rows `query()` hands back for the same filter: its kind, its body, and
      // no eid inside a component (C-32624 item 2).
      await p.store.apply({
        doc: { title: 'Fig tart', body: 'six figs, honey' },
        task: {},
      })
      assertEquals(
        await open.showing((rows) => rows.length == 2),
        await p.store.query('.task.status=open&?doc'),
      )
      // The byline rides the same projection, so a page draws its writers
      // without a second question.
      assertEquals(
        [
          ...new Set(
            (await bylines.showing((rows) => rows.length > 0))
              .map((r) => r.created.by.name),
          ),
        ],
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

test('a page watching a projection hears what its paths reach', async () => {
  let k = workerd()
  let p = await page(k)
  try {
    await connector(k, p.them.cookie).tool('app_files', {
      space: p.slug,
      app: 'recipes',
      op: 'write',
      path: 'vocab.json',
      content: vocabFile({
        step: { recipe: { type: 'string', ref: 'doc', death: 'detach' } },
      }),
    })
    await connector(k, p.them.cookie).tool('app_deploy', {
      space: p.slug,
      app: 'recipes',
    })
    let saved = await p.store.apply([
      { entity: { eid: '$cake' }, doc: { title: 'Lemon cake' } },
      { doc: { title: 'Zest three lemons' }, step: { recipe: '$cake' } },
    ])
    let cake = saved.aliases.$cake
    let filter = '.step&.fields=doc.title,step.recipe.doc.title'
    let steps = heard(p.live, filter)
    try {
      // The step names its recipe, and the recipe it reaches rides beside it
      // with its title: the rows `query()` answers.
      let first = await steps.showing(named('Zest three lemons', 'Lemon cake'))
      assertEquals(first, await p.store.query(filter))
      // A write to the recipe moves no step, and the page still hears it.
      await p.store.apply({
        entity: { eid: cake },
        doc: { title: 'Lime cake' },
      })
      let next = await steps.showing(named('Zest three lemons', 'Lime cake'))
      assertEquals(next, await p.store.query(filter))
    } finally {
      steps.stop()
    }
  } finally {
    await p.stop()
    await k.stop()
  }
})

test('a workerd socket waits for the page to acknowledge its frame', async () => {
  let k = workerd()
  let p = await page(k)
  let socket = new WebSocket(`${p.wire.replace(/^http/, 'ws')}/ws`)
  let frames: { ack?: string; bundles?: Row[] }[] = []
  socket.addEventListener('message', (e) => frames.push(JSON.parse(e.data)))
  try {
    await new Promise<void>((resolve, reject) => {
      socket.addEventListener('open', () => resolve(), { once: true })
      socket.addEventListener('error', reject, { once: true })
    })
    socket.send(JSON.stringify({ subscribe: '.doc', id: 's', acks: true }))
    await until(() => frames.length == 1, { timeout: 15_000 })
    let token = frames[0].ack
    assertEquals(typeof token, 'string')

    await p.store.apply({ doc: { title: 'After snapshot' } })
    assertEquals(frames.length, 1)
    socket.send(JSON.stringify({ ack: 'stale-token' }))
    assertEquals(frames.length, 1)
    socket.send(JSON.stringify({ ack: token }))
    await until(() => frames.length == 2, { timeout: 15_000 })
    assertEquals(frames[1].bundles?.[0].doc.title, 'After snapshot')
  } finally {
    socket.close()
    await p.stop()
    await k.stop()
  }
})

// A page that keeps a copy of its store (@yaks/client) speaks the words the
// store serves, and lands the rows a socket sends in them: `created.by` is who
// made a row, so a page finds a person's rows by asking for the ones they made.
test('a page keeping a copy of its store watches rows by who made them', async () => {
  let k = workerd()
  let p = await page(k)
  let words = await (await fetch(`${p.mine}/vocab.json`)).json()
  let copy = client(loadVocab(words), [], {
    url: p.wire,
    vault: false,
    wireVault: false,
  })
  try {
    await p.store.apply({ doc: { title: 'Lemon cake' } })
    let { person } = await p.store.me()
    let made = copy.watch(`.doc&.created.by=${JSON.stringify(person)}`)
    await until(() => made.value.length > 0, { timeout: 15_000 })
    assertObjectMatch(made.value[0], {
      doc: { title: 'Lemon cake' },
      created: { by: person },
    })
  } finally {
    copy.close()
    await p.stop()
    await k.stop()
  }
})

test('a page watching its store hears a letter arrive', async () => {
  let k = workerd()
  let p = await page(k)
  try {
    let mail = heard(p.live, '.mail&?doc')
    try {
      await mail.showing((rows) => rows.length == 0)
      let landed = await arrives(k, {
        from: 'ana@books.example',
        to: `${p.slug}.recipes@yaks.app`,
        raw: rfc822(
          { From: 'Ana <ana@books.example>', Subject: 'Bring a dish' },
          'Potluck Friday.',
        ),
      })
      assertEquals(landed.status, 200, await landed.clone().text())
      let [letter] = await mail.showing((rows) => rows.length == 1)
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

test('public drafts follow a second interface through the store socket', async () => {
  let p = await page(workerd())
  let reports: unknown[] = []
  let options = {
    by: p.them.person,
    stash: false,
    pace: 0,
    report: (error: unknown) => reports.push(error),
  }
  let first = p.live.drafts(options)
  // Another desk on its own store instance and socket, as a second tab has.
  let second = p.another().drafts(options)
  try {
    first.type('compose', 'Unsent from the first interface')
    await until(() =>
      second.text('compose') == 'Unsent from the first interface'
    )
    second.type('compose', 'Unsent from the first interface, continued here')
    await until(() =>
      first.text('compose') == 'Unsent from the first interface, continued here'
    )
    assertEquals(await second.spend('compose'), true)
    await until(() => first.text('compose') == '')
    assertEquals(reports, [])
  } finally {
    first.close()
    second.close()
    await p.stop()
  }
})
