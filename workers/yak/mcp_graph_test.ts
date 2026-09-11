// MCP workerd probes, split by subject so Deno can run the modules in parallel.
import {
  assert,
  assertEquals,
  assertMatch,
  assertRejects,
  assertStringIncludes,
} from '@std/assert'
import { slow } from '../../src/testing.ts'
import {
  client,
  connector,
  kernel,
  meta,
  seed,
  signed,
  signIn,
} from './probe.ts'
import { FREE, monthOf, PLUS } from './meter.ts'
import { minted } from './mcp-probe.ts'

// An entity spans apps (T-32699): a read that names no app asks every store
// the caller can reach and answers one bundle per eid — and only the stores
// they can reach.
slow('a read with no app composes every app the caller can reach', async () => {
  let k = await kernel()
  try {
    let jeff = await signIn(k)
    let agent = connector(k, jeff.cookie)
    // Two apps of his own, each with a word of its own.
    let made = async (
      who: ReturnType<typeof connector>,
      slug: string,
      comp: string,
      cols: Record<string, string>,
      access?: string,
    ) => {
      await who.tool('app_new', {
        slug,
        title: slug,
        ...(access ? { access } : {}),
      })
      await who.tool('app_files', {
        app: slug,
        files: [{
          path: 'vocab.json',
          content: JSON.stringify({ [comp]: cols }),
        }],
      })
      await who.tool('app_deploy', { app: slug })
    }
    await made(agent, 'recipes', 'recipe', { serves: 'number' })
    await made(agent, 'lending', 'loan', { to: 'text' })

    // ONE entity, its title and recipe in one app, its loan in the other:
    // the eid is minted by the caller, so it names the same thing in both.
    let cake = crypto.randomUUID()
    await agent.tool('graph_apply', {
      app: 'recipes',
      entities: [{
        entity: { eid: cake },
        doc: { title: 'Lemon cake' },
        recipe: { serves: 4 },
      }],
    })
    await agent.tool('graph_apply', {
      app: 'recipes',
      entities: [{
        entity: { eid: '$pancakes' },
        doc: { title: 'Pancakes' },
        recipe: { serves: 2 },
      }],
    })
    await agent.tool('graph_apply', {
      app: 'lending',
      entities: [
        { entity: { eid: cake }, loan: { to: 'Maya' } },
        {
          entity: { eid: '$zester' },
          doc: { title: 'Lemon zester' },
          loan: { to: 'Bo' },
        },
      ],
    })

    // `id=` with no app answers everything known about it, in one bundle,
    // saying which app holds which component.
    let rows = async (filter: string, who = agent, app?: string) =>
      JSON.parse(
        await who.tool('graph_query', { filter, ...(app ? { app } : {}) }),
      ) as {
        kind: string
        entity: { eid: string }
        doc?: { title: string }
        recipe?: { serves: number }
        loan?: { to: string }
        created?: { by: string; at: string }
        _stores?: Record<string, string>
      }[]
    let [bundle] = await rows(`id=${cake}`)
    assertEquals(bundle.doc!.title, 'Lemon cake')
    assertEquals(bundle.recipe!.serves, 4)
    assertEquals(bundle.loan!.to, 'Maya')
    // An app's own word is what the entity IS, and the composition says where
    // each component lives.
    assertEquals(bundle.kind, 'recipe')
    assertMatch(bundle._stores!.recipe, /\/recipes$/)
    assertMatch(bundle._stores!.loan, /\/lending$/)

    // A filter naming two apps' words is intersected at the door: the cake
    // wears both, the pancakes and the zester wear one each.
    assertEquals(
      (await rows('.recipe!&.loan!')).map((r) => r.entity.eid),
      [cake],
    )
    // An answer carries the components the filter NAMES and no more, so the
    // title is asked for beside the recipe.
    assertEquals(
      (await rows('.recipe!&.doc?')).map((r) => r.doc!.title),
      ['Lemon cake', 'Pancakes'],
    )
    assertEquals((await rows('.recipe!')).map((r) => r.doc), [
      undefined,
      undefined,
    ])
    // `.recipe!&.loan?` is the composition asked for by name: every recipe,
    // wearing the lending app's loan where it has one.
    assertEquals(
      (await rows('.recipe!&.loan?')).map((r) => r.loan?.to),
      ['Maya', undefined],
    )
    // The fan-out answers what a single store answers (C-32800 items 2-4).
    // A REQUEST rides anywhere in the line, last included: it asks for a
    // component beside the filter and narrows nothing, so a store that never
    // planted the word answers the same rows without it — which is what the
    // guide's own example asks of the app the person names.
    assertEquals(await rows('.recipe!&.loan?'), await rows('.loan?&.recipe!'))
    assertEquals(
      (await rows('.recipe!&.loan?', agent, 'recipes')).map((r) =>
        r.recipe!.serves
      ),
      [4, 2],
    )
    // And the kind follows the component the filter REQUIRED, never the
    // clause the caller happened to type first: a recipe is a recipe either
    // way round, exactly as the recipes store alone calls it.
    assertEquals(
      (await rows('.loan?&.recipe!')).map((r) => r.kind),
      (await rows('.recipe!', agent, 'recipes')).map((r) => r.kind),
    )
    // A stamp NAMED in the filter comes back from the fan-out too: the
    // listing rule is cut by the caller's own line, not by the `id=` the
    // composition gathers with, which dropped every byline (item 4).
    assertEquals(
      await rows('.recipe!&.created!'),
      await rows('.recipe!&.created!', agent, 'recipes'),
    )
    assertEquals(
      (await rows('.recipe!&.created!')).map((r) => !!r.created?.at),
      [true, true],
    )
    // `.doc!` is a platform word both stores speak, so the answer is both
    // apps' rows — and the cake is one row, not two. The person row each
    // store mints for its writer wears a title too (graph.ts `#vouching`), and
    // is the platform's bookkeeping, never a row in the person's own list.
    assertEquals(
      (await rows('.doc!')).map((r) => r.doc!.title),
      ['Lemon cake', 'Pancakes', 'Lemon zester'],
    )
    // `*` is the debugging form: every component, wherever it lives.
    let [whole] = await rows(`.doc.title~="Lemon cake"&*`)
    assertEquals(whole.recipe!.serves, 4)
    assertEquals(whole.loan!.to, 'Maya')
    // A word nobody planted is nobody's, and the store's own sentence says so
    // rather than an empty answer.
    await assertRejects(
      () => agent.tool('graph_query', { filter: '.sandwich!' }),
      Error,
      'unknown prop',
    )
    // Search with no app merges the ranked hits of every app.
    let found = JSON.parse(
      await agent.tool('search', { text: 'lemon' }),
    ) as { doc: { title: string }; recipe?: { serves: number } }[]
    assertEquals(
      found.map((r) => r.doc.title).sort(),
      ['Lemon cake', 'Lemon zester'],
    )
    // And a hit carries the app's OWN components, not a doc and a rank
    // alone: a word names nothing to leave out, so a page drawing cards from
    // a search has what to draw (T-33144).
    assertEquals(
      found.find((r) => r.doc.title == 'Lemon cake')?.recipe?.serves,
      4,
    )
    // A bare word is a text pred in the query grammar, so narrowing a search
    // is graph_query with the words in the line — and the ordinary rule about
    // which components an answer carries is back with it.
    let narrowed = JSON.parse(
      await agent.tool('graph_query', { q: 'lemon&.recipe!' }),
    ) as { doc?: { title: string }; recipe: { serves: number } }[]
    assertEquals(narrowed.map((r) => r.recipe.serves), [4])
    assertEquals(narrowed.map((r) => r.doc), [undefined])

    // What another person keeps in their own space is not in reach: her app
    // is private, he is nobody there, and her component never appears on the
    // bundle he reads — even though it is written on the same eid.
    let maya = await signIn(k)
    let hers = connector(k, maya.cookie)
    await made(hers, 'diary', 'entryline', { note: 'text' }, 'private')
    await hers.tool('graph_apply', {
      app: 'diary',
      entities: [{ entity: { eid: cake }, entryline: { note: 'he baked it' } }],
    })
    assertEquals('entryline' in (await rows(`id=${cake}`))[0], false)
    // His word is not even a WORD in her reach: the one store she can read
    // never planted `recipe`, and a line every store in reach refuses is the
    // first store's sentence (reach.ts asked). It answered an empty set while
    // the grammar's learned words were process-wide — her parse borrowed his
    // store's vocabulary, in whichever order the isolate happened to plant
    // them (T-32814).
    assertStringIncludes(
      await rows('.recipe!', hers).then(() => '', (e: Error) => e.message),
      'unknown prop: .recipe',
    )
    assertEquals((await rows(`id=${cake}`, hers))[0].entity.eid, cake)
  } finally {
    await k.stop()
  }
})

// A write is routed by component (T-32700): each one goes to the app that
// declares it, a shared one to the app named or the app the entity already
// lives in, and the parts are admitted everywhere before any of them commits.
slow('a write with no app routes each component to its own app', async () => {
  let k = await kernel()
  try {
    let jeff = await signIn(k)
    let agent = connector(k, jeff.cookie)
    let made = async (
      slug: string,
      comp: string,
      cols: Record<string, string>,
    ) => {
      await agent.tool('app_new', { slug, title: slug })
      await agent.tool('app_files', {
        app: slug,
        files: [{
          path: 'vocab.json',
          content: JSON.stringify({ [comp]: cols }),
        }],
      })
      await agent.tool('app_deploy', { app: slug })
    }
    await made('recipes', 'recipe', { serves: 'number' })
    await made('lending', 'loan', { to: 'text' })
    let rows = async (filter: string, app?: string) =>
      JSON.parse(
        await agent.tool('graph_query', { filter, ...(app ? { app } : {}) }),
      ) as {
        entity: { eid: string }
        doc?: { title: string }
        recipe?: { serves: number }
        loan?: { to: string }
        created?: { by: string | { eid: string; name: string } }
        _stores?: Record<string, string>
      }[]

    // A new entity with one app's word: the title rides with it, because a
    // shared word with nowhere else to go belongs to the app whose own words
    // are in the same bundle.
    let said = await agent.tool('graph_apply', {
      entities: [{
        entity: { eid: '$cake' },
        doc: { title: 'Lemon cake' },
        recipe: { serves: 4 },
      }],
    })
    let cake = minted(said, '$cake')
    assertEquals((await rows('.doc!', 'recipes')).map((r) => r.entity.eid), [
      cake,
    ])
    assertEquals((await rows('.doc!', 'lending')).length, 0)

    // ONE bundle wearing two apps' words: the loan is the lending app's row,
    // the retitle lands where the title already lives, and the call is one.
    let spans = JSON.parse(
      await agent.tool('graph_apply', {
        entities: [{
          entity: { eid: cake },
          doc: { title: 'Lemon drizzle' },
          loan: { to: 'Maya' },
        }],
      }),
    ) as {
      entity: { eid: string }
      doc?: { title: string }
      loan?: { to: string }
      $actor?: unknown
    }[]
    // And ONE bundle back, though two stores each answered their own half
    // (T-34294) — with none of the `$` words the pipeline speaks in.
    assertEquals(spans.length, 1)
    assertEquals(spans[0].entity.eid, cake)
    assertEquals(spans[0].doc!.title, 'Lemon drizzle')
    assertEquals(spans[0].loan!.to, 'Maya')
    assertEquals(spans[0].$actor, undefined)
    // Where each half landed is what the stores themselves say.
    assertEquals(
      (await rows(`id=${cake}`, 'recipes'))[0].doc!.title,
      'Lemon drizzle',
    )
    assertEquals((await rows(`id=${cake}`, 'lending'))[0].loan!.to, 'Maya')
    let [bundle] = await rows(`id=${cake}`)
    assertEquals(bundle.recipe!.serves, 4)
    assertEquals(bundle.loan!.to, 'Maya')
    assertMatch(bundle._stores!.doc, /\/recipes$/)
    assertMatch(bundle._stores!.loan, /\/lending$/)

    // A routed write carries the same vouch a page's write does, so a store
    // it lands in — one that had never met this person — mints them with a
    // NAME and the byline reads as one: `created.by` is {eid, name} in the
    // lending store, and the fan-out says the same (C-32800 item 5).
    for (
      let by of [
        (await rows('.loan!&.created!', 'lending'))[0].created!.by,
        (await rows('.loan!&.created!'))[0].created!.by,
      ]
    ) {
      assertEquals(typeof by == 'string' ? by : by.name, jeff.name)
    }

    // A refusal in one store leaves the other unwritten: every part is
    // admitted before any of them commits.
    await assertRejects(
      () =>
        agent.tool('graph_apply', {
          entities: [{
            entity: { eid: cake },
            recipe: { serves: 12 },
            loan: { to: 'Bo' },
            was: { loan: { to: 'f'.repeat(64) } },
          }],
        }),
      Error,
      'lending',
    )
    assertEquals((await rows(`id=${cake}`))[0].recipe!.serves, 4)
    assertEquals((await rows(`id=${cake}`))[0].loan!.to, 'Maya')

    // A shared word on a new entity that two apps could equally claim is a
    // question, not a guess.
    await assertRejects(
      () =>
        agent.tool('graph_apply', {
          entities: [{
            entity: { eid: '$zester' },
            doc: { title: 'Zester' },
            recipe: { serves: 1 },
            loan: { to: 'Bo' },
          }],
        }),
      Error,
      'which app should doc go in?',
    )

    // Death is the whole entity's: it clears every store holding a piece.
    await agent.tool('graph_apply', {
      entities: [{ entity: { eid: cake }, tombstone: {} }],
    })
    assertEquals((await rows(`id=${cake}`)).length, 0)
    assertEquals((await rows(`id=${cake}`, 'recipes')).length, 0)
    assertEquals((await rows(`id=${cake}`, 'lending')).length, 0)
  } finally {
    await k.stop()
  }
})

// The meter as the agent reads it (T-32757): the hourly sweep's rows, seeded
// here through the one door into the meta store, come back in app_list beside
// the version. The sweep's own parse is usage_test.ts's; what this holds is
// that the word landed in the directory's store and that the answer says it.
slow('app_list answers what the month cost', async () => {
  let k = await kernel()
  try {
    let { cookie, eids } = await seed(k, [
      { slug: 'metered', apps: ['recipes'] },
    ])
    let agent = connector(k, cookie)
    let month = monthOf(new Date())
    let at = new Date().toISOString()
    let spent = {
      month,
      requests: 1200,
      rows_read: 48358,
      rows_written: 1632,
      bytes: 252_706_816,
      at,
    }
    await meta(k, cookie).apply([
      {
        entity: { eid: eids['metered/recipes'] },
        meter: spent,
      },
      {
        entity: { eid: eids.metered },
        plan: { tier: 'free' },
        meter: spent,
      },
    ])
    // A directory write empties the kernel's 30-second read cache
    // (directory.ts), and the seeding above went in through the graph tier,
    // which is not that door. The sweep itself writes through `stamp`, which
    // clears it; a test standing in for the sweep says so here instead of
    // waiting out a TTL.
    await agent.tool('space_new', { slug: 'metered-too', title: 'Too' })
    let said = await agent.tool('app_list', { space: 'metered' })
    assertStringIncludes(said, '1200 requests')
    assertStringIncludes(said, '241 MB')

    // The one number analytics cannot answer: what a store weighs. It comes
    // off the store itself (graph.ts `/graph`), which is where the sweep
    // reads it, so a planted store already weighs something.
    let graph = await k.at('metered.yaks.app', '/recipes/api/graph', {
      headers: { cookie },
    })
    assert((await graph.json()).bytes > 0, 'the store says what it weighs')

    // Where the space stands against what it is allowed (T-32758), in the
    // same answer: nothing here is near a ceiling, so it is only the numbers.
    assertStringIncludes(said, 'metered (free tier')
    assertStringIncludes(said, '1 of 5 apps')

    // And the other address every app has (T-34149), in the words and in the
    // rows: nobody should have to derive a mailbox from a slug.
    assertStringIncludes(said, 'metered.recipes@yaks.app')
    let listing = await agent.call('tools/call', {
      name: 'app_list',
      arguments: { space: 'metered' },
    })
    assertEquals(
      listing.structuredContent.spaces[0].apps[0].mail,
      'metered.recipes@yaks.app',
    )
  } finally {
    await k.stop()
  }
})

// The ceilings the agent sees coming (T-32758): a line at 80%, said once; the
// sixth app refused and the fifth not; data past 1 GB refused at the door.
slow('the free tier: a warning once, then the refusals', async () => {
  let secret = 'whsec_quota_probe'
  let k = await kernel({ STRIPE_WEBHOOK_SECRET: secret })
  try {
    let { cookie, eids } = await seed(k, [
      { slug: 'brim', apps: ['one'] },
      { slug: 'heavy', apps: ['big'] },
    ])
    let agent = connector(k, cookie)
    let month = monthOf(new Date())
    let at = new Date().toISOString()
    let row = {
      month,
      rows_read: 0,
      rows_written: 0,
      at,
    }
    await meta(k, cookie).apply([
      // 81% of the request ceiling, and nothing else near one.
      {
        entity: { eid: eids.brim },
        plan: { tier: 'free' },
        meter: { ...row, requests: 40_500, bytes: 0 },
      },
      // A gigabyte held: the byte ceiling, exactly at it.
      {
        entity: { eid: eids.heavy },
        plan: { tier: 'free' },
        meter: { ...row, requests: 0, bytes: 1024 ** 3 },
      },
    ])
    // The seeding went in through the graph tier, which is not the door that
    // empties the directory's read cache; a directory write is.
    await agent.tool('space_new', { slug: 'brim-too', title: 'Too' })

    // The line rides the unseen channel, once — the reply after is quiet.
    let said = await agent.tool('app_list', { space: 'brim' })
    assertStringIncludes(said, '## ceiling')
    assertStringIncludes(said, '40,500 of 50,000 requests')
    assertStringIncludes(said, 'App serving pauses at')
    let again = await agent.tool('app_list', { space: 'brim' })
    assert(!again.includes('## ceiling'), 'the ceiling line is said once')

    // Four more apps make five, which is the tier. The fifth is fine.
    for (let n of [2, 3, 4, 5]) {
      await agent.tool('app_new', {
        space: 'brim',
        slug: `a${n}`,
        title: `A${n}`,
      })
    }
    await assertRejects(
      () => agent.tool('app_new', { space: 'brim', slug: 'a6', title: 'A6' }),
      Error,
      'which is 5 apps',
    )
    // And where the ceiling lifts: the pricing page, never a checkout link
    // (usage.ts `atCeiling`).
    await assertRejects(
      () => agent.tool('app_new', { space: 'brim', slug: 'a6', title: 'A6' }),
      Error,
      'Plus lifts it: https://yaks.app/pricing',
    )

    // Data past the ceiling is refused at the app's own door, in the
    // platform's sentence, the way every other refusal is (unseen.ts
    // `refusal`: a no is not a break).
    let heavy = client(k, 'heavy.yaks.app', 'big', cookie)
    let stopped = await heavy.post([{
      entity: { eid: crypto.randomUUID() },
      doc: { title: 'one more' },
    }])
    assertEquals(stopped.status, 413)
    let why = (await stopped.json()).error
    assertEquals(why.code, 'space_full')
    assertStringIncludes(why.message, 'of app data')

    await meta(k, cookie).apply([{
      entity: { eid: eids.brim },
      meter: { ...row, requests: FREE.requests },
    }])
    await agent.tool('space_new', { slug: 'quota-cache', title: 'Quota' })
    let over = await k.at('brim.yaks.app', '/one/')
    assertEquals(over.status, 429)
    assertStringIncludes(await over.text(), '50,000 monthly visits')
    let manage = await k.at('brim.yaks.app', '/_yaks', { headers: { cookie } })
    assertEquals(manage.status, 200)
    await manage.body?.cancel()
    // MCP management still works, and raising the allowance reopens serving.
    assertStringIncludes(await agent.tool('app_list', { space: 'brim' }), 'one')
    let created = Math.floor(Date.now() / 1000)
    let raw = JSON.stringify({
      id: 'evt_quota_upgrade',
      type: 'customer.subscription.updated',
      created,
      data: {
        object: {
          id: 'sub_quota',
          customer: 'cus_quota',
          status: 'active',
          metadata: { space: eids.brim },
        },
      },
    })
    let paid = await k.at('yaks.app', '/stripe/webhook', {
      method: 'POST',
      body: raw,
      headers: {
        'content-type': 'application/json',
        'stripe-signature': await signed(secret, raw, created),
      },
    })
    assertEquals(paid.status, 200)
    assertEquals((await paid.json()).did, 'brim is plus')
    let reopened = await k.at('brim.yaks.app', '/one/api/graph')
    assertEquals(reopened.status, 200)
    await reopened.body?.cancel()
  } finally {
    await k.stop()
  }
})

// One word, one home (T-32728): a second app in the space naming a word the
// space already has uses it there — nothing is planted twice, the writes land
// in the home store, a new column grows the home's table, and a shape
// conflict is the only refusal.
slow('a word the space already has is used where it lives', async () => {
  let k = await kernel()
  try {
    let jeff = await signIn(k)
    let agent = connector(k, jeff.cookie)
    let manifest = async (slug: string, vocab: unknown) => {
      await agent.tool('app_files', {
        app: slug,
        op: 'write',
        path: 'vocab.json',
        content: JSON.stringify(vocab),
      })
      return await agent.tool('app_deploy', { app: slug })
    }
    let made = async (slug: string, vocab: unknown) => {
      await agent.tool('app_new', { slug, title: slug })
      return await manifest(slug, vocab)
    }
    // The reading list says `book` first, so `book` is the reading list's.
    await made('reading-list', { book: { title: 'text', pages: 'number' } })
    // The lending app says it second: the deploy plants its own word and
    // names where the shared one lives.
    let second = await made('lending', {
      book: { title: 'text' },
      loan: { to: 'text' },
    })
    assertStringIncludes(
      second,
      'book lives in reading-list; this app reads and writes it there',
    )
    assertStringIncludes(second, 'components: loan')
    assertEquals(second.includes('components: book'), false)

    // A book written through the lending app lands in the reading list's
    // store, because that is where the word lives.
    let said = await agent.tool('graph_apply', {
      app: 'lending',
      entities: [{ entity: { eid: '$b' }, book: { title: 'Piranesi' } }],
    })
    let piranesi = minted(said, '$b')
    let rows = async (filter: string, app?: string) =>
      JSON.parse(
        await agent.tool('graph_query', { filter, ...(app ? { app } : {}) }),
      ) as {
        entity: { eid: string }
        book?: { title?: string } & Record<string, unknown>
      }[]
    assertEquals(
      (await rows('.book!', 'reading-list')).map((r) => r.entity.eid),
      [piranesi],
    )
    // And there is no second copy: the fan-out answers one bundle, while each
    // store REFUSES the word it never planted. Two stores live in one isolate,
    // so this used to depend on which of them parsed first — the grammar's
    // learned words were process-wide, and the answer was an empty row set
    // where a refusal is owed (T-32814). The vocabulary now rides the parse,
    // per store handle, so both refusals are the store's own, every run.
    assertEquals((await rows(`id=${piranesi}`))[0].book!.title, 'Piranesi')
    let refused = (filter: string, app: string) =>
      agent.tool('graph_query', { filter, app }).then(
        () => '',
        (e: Error) => e.message,
      )
    assertStringIncludes(
      await refused('.book!', 'lending'),
      'unknown prop: .book',
    )
    assertStringIncludes(
      await refused('.loan!', 'reading-list'),
      'unknown prop: .loan',
    )

    // A column the lending app adds to the shared word grows the HOME's
    // table, additively — and is then writable from either app.
    let grew = await manifest('lending', {
      book: { title: 'text', isbn: 'text' },
      loan: { to: 'text' },
    })
    assertStringIncludes(grew, 'added: book.isbn')
    await agent.tool('graph_apply', {
      app: 'lending',
      entities: [{ entity: { eid: piranesi }, book: { isbn: '978' } }],
    })
    assertEquals(
      (await rows(`id=${piranesi}`, 'reading-list'))[0].book!.isbn,
      '978',
    )

    // A COMMAND of the lending app may name the borrowed word — the word is
    // this app's to write either way — and the call goes where it lives.
    await agent.tool('app_files', {
      app: 'lending',
      op: 'write',
      path: 'tools.json',
      content: JSON.stringify({
        shelve: {
          description: 'Add a book to the shelf',
          input: { title: 'text' },
          apply: { book: { title: '{{title}}' } },
        },
        shelf: { description: 'Every book', input: {}, query: '.book!' },
      }),
    })
    let tooled = await agent.tool('app_deploy', { app: 'lending' })
    assertStringIncludes(tooled, 'commands: shelve, shelf')
    await agent.tool('command', {
      name: 'shelve',
      args: { title: 'Solenoid' },
    })
    // One store holds both books: the reading list's, where `book` lives.
    assertEquals(
      (await rows('.book!', 'reading-list')).map((r) => r.book!.title).sort(),
      ['Piranesi', 'Solenoid'],
    )
    // And the lending app's own read command answers from there too.
    let shelf = await agent.call('tools/call', {
      name: 'command',
      arguments: { name: 'shelf' },
    })
    assertStringIncludes(shelf.content[0].text, 'shelf: 2 rows')

    // The one refusal: the same column with two types, named with both and
    // with the app the word lives in.
    await agent.tool('app_files', {
      app: 'lending',
      op: 'write',
      path: 'vocab.json',
      content: JSON.stringify({
        book: { pages: 'text' },
        loan: { to: 'text' },
      }),
    })
    let why = (await assertRejects(
      () => agent.tool('app_deploy', { app: 'lending' }),
      Error,
    )).message
    assertStringIncludes(why, 'book.pages is text here and number in')
    assertStringIncludes(why, 'reading-list, where book lives')
    // Refused whole: the home's column keeps the type its rows were written
    // under, and nothing about it moved.
    assertEquals(
      (await rows(`id=${piranesi}`, 'reading-list'))[0].book!.pages,
      null,
    )
  } finally {
    await k.stop()
  }
})

slow(
  'Plus app ceilings count live apps at both creation doors; comps stay exempt',
  async () => {
    let k = await kernel({ STRIPE_WEBHOOK_SECRET: 'plus-limits-test' })
    try {
      let { cookie, eids } = await seed(k, [
        { slug: 'plus-limits', apps: ['original'] },
        { slug: 'yourname', apps: [] },
      ])
      let agent = connector(k, cookie)
      await agent.tool('app_files', {
        space: 'plus-limits',
        app: 'original',
        path: 'index.html',
        content: '<h1>Original</h1>',
      })
      await agent.tool('app_deploy', { space: 'plus-limits', app: 'original' })
      await agent.tool('app_publish', {
        space: 'plus-limits',
        app: 'original',
        name: 'limits-example',
      })
      let at = Math.floor(Date.now() / 1000)
      let raw = JSON.stringify({
        id: 'evt_plus_limits',
        type: 'customer.subscription.updated',
        created: at,
        data: {
          object: {
            id: 'sub_plus_limits',
            customer: 'cus_plus_limits',
            status: 'active',
            metadata: { space: eids['plus-limits'] },
          },
        },
      })
      let paid = await k.at('yaks.app', '/stripe/webhook', {
        method: 'POST',
        body: raw,
        headers: {
          'stripe-signature': await signed('plus-limits-test', raw, at),
        },
      })
      assertEquals(paid.status, 200)
      await paid.body?.cancel()
      await meta(k, cookie).apply([
        ...['plus-limits', 'yourname'].flatMap((slug) =>
          Array.from({ length: PLUS.apps - 2 }, (_, i) => ({
            entity: { eid: crypto.randomUUID() },
            doc: { title: `App ${i}` },
            app: {
              slug: `app-${i}`,
              space: eids[slug],
              store: `${slug}/app-${i}`,
            },
          }))
        ),
      ])
      // Refresh the directory after seeding through its graph.
      await agent.tool('space_new', {
        slug: 'limits-refresh',
        title: 'Refresh',
      })
      await agent.tool('app_new', {
        space: 'plus-limits',
        slug: 'last',
        title: 'Last',
      })
      await assertRejects(
        () =>
          agent.tool('app_new', {
            space: 'plus-limits',
            slug: 'over',
            title: 'Over',
          }),
        Error,
        'plus tier, which is 50 apps',
      )
      await assertRejects(
        () =>
          agent.tool('app_install', {
            space: 'plus-limits',
            name: 'limits-example',
            as: 'copy',
          }),
        Error,
        'plus tier, which is 50 apps',
      )
      await agent.tool('app_delete', { space: 'plus-limits', app: 'last' })
      assertStringIncludes(
        await agent.tool('app_install', {
          space: 'plus-limits',
          name: 'limits-example',
          as: 'copy',
        }),
        'as plus-limits/copy',
      )
      await agent.tool('app_delete', { space: 'plus-limits', app: 'copy' })
      await agent.tool('app_new', {
        space: 'plus-limits',
        slug: 'replacement',
        title: 'Replacement',
      })
      // Bring the comped space above the paid ceiling through both doors.
      for (let i = 0; i < 3; i++) {
        await agent.tool('app_new', {
          space: 'yourname',
          slug: `extra-${i}`,
          title: 'Extra',
        })
      }
      assertStringIncludes(
        await agent.tool('app_install', {
          space: 'yourname',
          name: 'limits-example',
          as: 'copy',
        }),
        'as yourname/copy',
      )
    } finally {
      await k.stop()
    }
  },
)
