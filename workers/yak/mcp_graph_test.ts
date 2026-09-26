// The connector through the whole kernel (probe.ts `kernel`), by subject.
import {
  assert,
  assertEquals,
  assertMatch,
  assertRejects,
  assertStringIncludes,
} from '@std/assert'
import { handle, secretEid } from '@yaks/secrets'
import {
  client,
  connector,
  kernel,
  meta,
  num,
  plus,
  seed,
  signIn,
  txt,
  vocabFile,
} from './probe.ts'
import { FREE, monthOf } from './meter.ts'
import { minted } from './mcp-probe.ts'
import { token } from '@yaks/graph'

Deno.test(
  'a platform secret alias derives before the reach hands it to the store',
  async () => {
    let k = await kernel()
    try {
      let agent = connector(k, k.owner.cookie)
      let name = 'oauth_client probe-dry-run'
      let said = await agent.tool('graph_apply', {
        app: 'yak/platform',
        check: true,
        entities: [{
          entity: { eid: '$secret' },
          secret: { name, value: handle() },
        }],
      })
      assertEquals(minted(said, '$secret'), secretEid(name))
      assertEquals(
        await meta(k).query(`.secret.name="${name}"`),
        [],
      )
    } finally {
      await k.stop()
    }
  },
)

// A reduction asks about the selection, not its members, and is answered with
// its value, as `/query` answers it — one app's or the whole reach's.
Deno.test('graph_query answers a count and a tally as their value', async () => {
  let k = await kernel()
  try {
    let agent = connector(k, (await signIn(k)).cookie)
    await agent.tool('app_new', { slug: 'recipes', title: 'recipes' })
    await agent.tool('app_files', {
      app: 'recipes',
      files: [{
        path: 'vocab.json',
        content: vocabFile({ recipe: { cuisine: txt } }),
      }],
    })
    await agent.tool('app_deploy', { app: 'recipes' })
    await agent.tool('graph_apply', {
      app: 'recipes',
      entities: ['thai', 'thai', 'greek'].map((cuisine, i) => ({
        entity: { eid: `$r${i}` },
        recipe: { cuisine },
      })),
    })
    let said = async (filter: string, app?: string) =>
      JSON.parse(
        await agent.tool('graph_query', { filter, ...(app ? { app } : {}) }),
      )
    assertEquals(await said('.recipe&.count', 'recipes'), { count: 3 })
    assertEquals(await said('.recipe&.tally=recipe.cuisine', 'recipes'), {
      tally: { greek: 1, thai: 2 },
    })
    assertEquals(await said('.recipe&.count'), { count: 3 })
  } finally {
    await k.stop()
  }
})

// An entity spans apps (T-32699): a read that names no app asks every store
// the caller can reach and answers one bundle per eid — and only the stores
// they can reach.
Deno.test('a read with no app composes every app the caller can reach', async () => {
  let k = await kernel()
  try {
    let jeff = await signIn(k)
    let agent = connector(k, jeff.cookie)
    // Two apps of his own, each with a word of its own.
    let made = async (
      who: ReturnType<typeof connector>,
      slug: string,
      comp: string,
      props: Record<string, unknown>,
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
          content: vocabFile({ [comp]: props }),
        }],
      })
      await who.tool('app_deploy', { app: slug })
    }
    await made(agent, 'recipes', 'recipe', { serves: num })
    await made(agent, 'lending', 'loan', { to: txt })

    // One entity, its title and recipe in one app, its loan in the other:
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
      (await rows('.recipe&.loan')).map((r) => r.entity.eid),
      [cake],
    )
    // An answer carries the components the filter names and no more, so the
    // title is asked for beside the recipe.
    assertEquals(
      (await rows('.recipe&?doc')).map((r) => r.doc!.title),
      ['Lemon cake', 'Pancakes'],
    )
    assertEquals((await rows('.recipe')).map((r) => r.doc), [
      undefined,
      undefined,
    ])
    // `.recipe&?loan` is the composition asked for by name: every recipe,
    // wearing the lending app's loan where it has one.
    assertEquals(
      (await rows('.recipe&?loan')).map((r) => r.loan?.to),
      ['Maya', undefined],
    )
    // The fan-out answers what a single store answers (C-32800 items 2-4).
    // A request rides anywhere in the line, last included: it asks for a
    // component beside the filter and narrows nothing, so a store that never
    // planted the word answers the same rows without it — which is what the
    // guide's own example asks of the app the person names.
    assertEquals(await rows('.recipe&?loan'), await rows('?loan&.recipe'))
    assertEquals(
      (await rows('.recipe&?loan', agent, 'recipes')).map((r) =>
        r.recipe!.serves
      ),
      [4, 2],
    )
    // And the kind follows the component the filter required, never the
    // clause the caller happened to type first: a recipe is a recipe either
    // way round, exactly as the recipes store alone calls it.
    assertEquals(
      (await rows('?loan&.recipe')).map((r) => r.kind),
      (await rows('.recipe', agent, 'recipes')).map((r) => r.kind),
    )
    // A stamp named in the filter comes back from the fan-out too: the
    // listing rule is cut by the caller's own line, not by the `id=` the
    // composition gathers with, which dropped every byline (item 4).
    assertEquals(
      await rows('.recipe&.created'),
      await rows('.recipe&.created', agent, 'recipes'),
    )
    assertEquals(
      (await rows('.recipe&.created')).map((r) => !!r.created?.at),
      [true, true],
    )
    // `.doc` is a platform word both stores speak, so the answer is both
    // apps' rows — and the cake is one row, not two. The person row each
    // store mints for its writer wears a title too (graph.ts `#vouching`), and
    // is the platform's bookkeeping, never a row in the person's own list.
    assertEquals(
      (await rows('.doc')).map((r) => r.doc!.title),
      ['Lemon cake', 'Pancakes', 'Lemon zester'],
    )
    // `*` is the debugging form: every component, wherever it lives.
    let [whole] = await rows(`.doc.title~="Lemon cake"&*`)
    assertEquals(whole.recipe!.serves, 4)
    assertEquals(whole.loan!.to, 'Maya')
    // A word nobody planted is nobody's, and the store's own sentence says so
    // rather than an empty answer.
    await assertRejects(
      () => agent.tool('graph_query', { filter: '.sandwich' }),
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
    // And a hit carries the app's own components, not a doc and a rank
    // alone: a word names nothing to leave out, so a page drawing cards from
    // a search has what to draw (T-33144).
    assertEquals(
      found.find((r) => r.doc.title == 'Lemon cake')?.recipe?.serves,
      4,
    )
    // What a search reads is what the vocabulary declares searched — @yaks/doc
    // says so of its title and body, and a property that declares nothing is
    // stored, readable, and not found by a bare word. These two apps declare
    // nothing of their own; the one below declares `"search": true` and is
    // found by it.
    await agent.tool('graph_apply', {
      app: 'lending',
      entities: [{
        entity: { eid: '$marzipan' },
        doc: { title: 'Kitchen notes' },
        loan: { to: 'marzipan' },
      }],
    })
    assertEquals(
      (JSON.parse(await agent.tool('search', { text: 'marzipan' })) as {
        doc: { title: string }
      }[]).map((r) => r.doc.title),
      [],
    )

    // A bare word is a text pred in the query grammar, so narrowing a search
    // is graph_query with the words in the line — and the ordinary rule about
    // which components an answer carries is back with it.
    let narrowed = JSON.parse(
      await agent.tool('graph_query', { q: 'lemon&.recipe' }),
    ) as { doc?: { title: string }; recipe: { serves: number } }[]
    assertEquals(narrowed.map((r) => r.recipe.serves), [4])
    assertEquals(narrowed.map((r) => r.doc), [undefined])

    // What another person keeps in their own space is not in reach: her app
    // is private, he is nobody there, and her component never appears on the
    // bundle he reads — even though it is written on the same eid.
    let maya = await signIn(k)
    let hers = connector(k, maya.cookie)
    await made(hers, 'diary', 'entryline', { note: txt }, 'private')
    await hers.tool('graph_apply', {
      app: 'diary',
      entities: [{ entity: { eid: cake }, entryline: { note: 'he baked it' } }],
    })
    assertEquals('entryline' in (await rows(`id=${cake}`))[0], false)
    // His word is not even a word in her reach: the one store she can read
    // never planted `recipe`, and a line every store in reach refuses is the
    // first store's sentence (reach.ts asked). It answered an empty set while
    // the grammar's learned words were process-wide — her parse borrowed his
    // store's vocabulary, in whichever order the isolate happened to plant
    // them (T-32814).
    assertStringIncludes(
      await rows('.recipe', hers).then(() => '', (e: Error) => e.message),
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
Deno.test('a write with no app routes each component to its own app', async () => {
  let k = await kernel()
  try {
    let jeff = await signIn(k)
    let agent = connector(k, jeff.cookie)
    let made = async (
      slug: string,
      comp: string,
      props: Record<string, unknown>,
    ) => {
      await agent.tool('app_new', { slug, title: slug })
      await agent.tool('app_files', {
        app: slug,
        files: [{
          path: 'vocab.json',
          content: vocabFile({ [comp]: props }),
        }],
      })
      await agent.tool('app_deploy', { app: slug })
    }
    await made('recipes', 'recipe', { serves: num })
    await made('lending', 'loan', { to: txt })
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
    assertEquals((await rows('.doc', 'recipes')).map((r) => r.entity.eid), [
      cake,
    ])
    assertEquals((await rows('.doc', 'lending')).length, 0)

    // A rehearsal answers what the kept write would have, name resolved, and
    // keeps none of it: not in the app's store, not anywhere.
    let pie = minted(
      await agent.tool('graph_apply', {
        change: [{
          entity: { eid: '$pie' },
          doc: { title: 'Apple pie' },
          recipe: { serves: 6 },
        }],
        check: true,
      }),
      '$pie',
    )
    assert(pie != '$pie')
    assertEquals((await rows('.doc', 'recipes')).map((r) => r.entity.eid), [
      cake,
    ])

    // One bundle wearing two apps' words: the loan is the lending app's row,
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
    // And one bundle back, though two stores each answered their own half
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
    // name and the byline reads as one: `created.by` is {eid, name} in the
    // lending store, and the fan-out says the same (C-32800 item 5).
    for (
      let by of [
        (await rows('.loan&.created', 'lending'))[0].created!.by,
        (await rows('.loan&.created'))[0].created!.by,
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

    // Arguments sent as a string are the caller's mistake, answered as one.
    await assertRejects(
      () => agent.tool('graph_apply', JSON.stringify({ change: [] })),
      Error,
      'not a string',
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
Deno.test('app_list answers what the month cost', async () => {
  let k = await kernel()
  try {
    let { cookie, eids } = await seed(k, [
      { slug: 'metered35', apps: ['recipes'] },
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
    await meta(k).apply([
      {
        entity: { eid: eids['metered35/recipes'] },
        meter: spent,
      },
      {
        entity: { eid: eids.metered35 },
        plan: { tier: 'free' },
        meter: spent,
      },
    ])
    // A directory write empties the kernel's 30-second read cache
    // (directory.ts), and the seeding above went in through the graph tier,
    // which is not that door. The sweep itself writes through `stamp`, which
    // clears it; a test standing in for the sweep says so here instead of
    // waiting out a TTL.
    await agent.tool('space_new', { slug: 'metered-too35', title: 'Too' })
    let said = await agent.tool('app_list', { space: 'metered35' })
    assertStringIncludes(said, '1200 requests')
    assertStringIncludes(said, '241 MB')

    // The one number analytics cannot answer: what a store weighs. It comes
    // off the store itself (graph.ts `/graph`), which is where the sweep
    // reads it, so a planted store already weighs something.
    let graph = await k.at('metered35.yaks.app', '/recipes/api/graph', {
      headers: { cookie },
    })
    assert((await graph.json()).bytes > 0, 'the store says what it weighs')

    // Where the space stands against what it is allowed (T-32758), in the
    // same answer: nothing here is near a ceiling, so it is only the numbers.
    assertStringIncludes(said, 'metered35 (free tier')
    assertStringIncludes(said, '1 of 5 apps')

    // And the other address every app has (T-34149), in the words: nobody
    // should have to derive a mailbox from a slug. An app is a directory row
    // rather than an entity in the caller's graph, so the listing says it in
    // the sentence and there is nowhere else for it to be.
    assertStringIncludes(said, 'metered35.recipes@yaks.app')
  } finally {
    await k.stop()
  }
})

// The ceilings the agent sees coming (T-32758): a line at 80%, said once; the
// sixth app refused and the fifth not; data past 1 GB refused at the door.
Deno.test('the free tier: a warning once, then the refusals', async () => {
  let k = await kernel()
  try {
    let { cookie, eids } = await seed(k, [
      { slug: 'brim36', apps: ['one'] },
      { slug: 'heavy36', apps: ['big'] },
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
    await meta(k).apply([
      // 81% of the request ceiling, and nothing else near one.
      {
        entity: { eid: eids.brim36 },
        plan: { tier: 'free' },
        meter: { ...row, requests: 40_500, bytes: 0 },
      },
      // A gigabyte held: the byte ceiling, exactly at it. The space's reading
      // says so, and so does the size its one app's store reported.
      {
        entity: { eid: eids.heavy36 },
        plan: { tier: 'free' },
        meter: { ...row, requests: 0, bytes: 1024 ** 3 },
      },
      {
        entity: { eid: eids['heavy36/big'] },
        meter: { ...row, requests: 0, bytes: 1024 ** 3 },
      },
    ])
    // The seeding went in through the graph tier, which is not the door that
    // empties the directory's read cache; a directory write is.
    await agent.tool('space_new', { slug: 'brim-too36', title: 'Too' })

    // The line rides the unseen channel, once — the reply after is quiet. A
    // look-up leaves it unsaid: only a tool that writes carries the channel.
    assert(
      !(await agent.tool('app_list', { space: 'brim36' })).includes(
        '## ceiling',
      ),
    )
    let files = { space: 'brim36', app: 'one', op: 'list' }
    let said = await agent.tool('app_files', files)
    assertStringIncludes(said, '## ceiling')
    assertStringIncludes(said, '40,500 of 50,000 requests')
    assertStringIncludes(said, 'App serving pauses at')
    let again = await agent.tool('app_files', files)
    assert(!again.includes('## ceiling'), 'the ceiling line is said once')

    // Four more apps make five, which is the tier. The fifth is fine.
    for (let n of [2, 3, 4, 5]) {
      await agent.tool('app_new', {
        space: 'brim36',
        slug: `a${n}`,
        title: `A${n}`,
      })
    }
    await assertRejects(
      () => agent.tool('app_new', { space: 'brim36', slug: 'a6', title: 'A6' }),
      Error,
      'which is 5 apps',
    )
    // And where the ceiling lifts: the pricing page, never a checkout link
    // (usage.ts `atCeiling`).
    await assertRejects(
      () => agent.tool('app_new', { space: 'brim36', slug: 'a6', title: 'A6' }),
      Error,
      'Compare paid plans in settings: https://yaks.app/manage/billing?space=brim36',
    )

    // Data past the ceiling is refused at the app's own door, in the
    // platform's sentence, the way every other refusal is (unseen.ts
    // `refusal`: a no is not a break).
    let heavy36 = client(k, 'heavy36.yaks.app', 'big', cookie)
    let stopped = await heavy36.post([{
      entity: { eid: crypto.randomUUID() },
      doc: { title: 'one more' },
    }])
    assertEquals(stopped.status, 413)
    let why = (await stopped.json()).error
    assertEquals(why.code, 'space_full')
    assertStringIncludes(why.message, 'of app data')

    await meta(k).apply([{
      entity: { eid: eids.brim36 },
      meter: { ...row, requests: FREE.requests },
    }])
    await agent.tool('space_new', { slug: 'quota-cache36', title: 'Quota' })
    let over = await k.at('brim36.yaks.app', '/one/')
    assertEquals(over.status, 429)
    assertStringIncludes(await over.text(), '50,000 monthly visits')
    let manage = await k.at('yaks.app', '/manage?space=brim36', {
      headers: { cookie },
    })
    assertEquals(manage.status, 200)
    await manage.body?.cancel()
    // MCP management still works, and raising the allowance reopens serving.
    assertStringIncludes(
      await agent.tool('app_list', { space: 'brim36' }),
      'one',
    )
    await plus(k, eids.brim36)
    let reopened = await k.at('brim36.yaks.app', '/one/api/graph')
    assertEquals(reopened.status, 200)
    await reopened.body?.cancel()
  } finally {
    await k.stop()
  }
})

// One word, one home (T-32728): a second app in the space naming a word the
// space already has uses it there — nothing is planted twice, the writes land
// in the home store, a new property grows the home's table, and a shape
// conflict is the only refusal.
Deno.test('a word the space already has is used where it lives', async () => {
  let k = await kernel()
  try {
    let jeff = await signIn(k)
    let agent = connector(k, jeff.cookie)
    let manifest = async (
      slug: string,
      defs: Record<string, Record<string, unknown>>,
    ) => {
      await agent.tool('app_files', {
        app: slug,
        op: 'write',
        path: 'vocab.json',
        content: vocabFile(defs),
      })
      return await agent.tool('app_deploy', { app: slug })
    }
    let made = async (
      slug: string,
      defs: Record<string, Record<string, unknown>>,
    ) => {
      await agent.tool('app_new', { slug, title: slug })
      return await manifest(slug, defs)
    }
    // The reading list says `book` first, so `book` is the reading list's.
    await made('reading-list', { book: { title: txt, pages: num } })
    // The lending app says it second: the deploy plants its own word and
    // names where the shared one lives.
    let second = await made('lending', {
      book: { title: txt },
      loan: { to: txt },
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
      (await rows('.book', 'reading-list')).map((r) => r.entity.eid),
      [piranesi],
    )
    // And there is no second copy: the fan-out answers one bundle, while each
    // store refuses the word it never planted. Two stores live in one isolate,
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
      await refused('.book', 'lending'),
      'unknown prop: .book',
    )
    assertStringIncludes(
      await refused('.loan', 'reading-list'),
      'unknown prop: .loan',
    )

    // A property the lending app adds to the shared word grows the HOME's
    // table, additively — and is then writable from either app.
    let grew = await manifest('lending', {
      book: { title: txt, isbn: txt },
      loan: { to: txt },
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

    // A command of the lending app may name the borrowed word — the word is
    // this app's to write either way — and the call goes where it lives.
    let lent = { book: { title: txt, isbn: txt }, loan: { to: txt } }
    let shelve = (title: string) => ({
      description: 'Add a book to the shelf',
      input: { title: txt },
      required: ['title'],
      apply: { book: { title } },
    })
    let every = { description: 'Every book', query: '.book' }
    await agent.tool('app_files', {
      app: 'lending',
      op: 'write',
      path: 'vocab.json',
      content: vocabFile(lent, { shelve: shelve('$title'), shelf: every }),
    })
    let tooled = await agent.tool('app_deploy', { app: 'lending' })
    assertStringIncludes(tooled, 'commands: shelve, shelf')
    await agent.tool('command', {
      name: 'shelve',
      args: { title: 'Solenoid' },
    })
    // One store holds both books: the reading list's, where `book` lives.
    assertEquals(
      (await rows('.book', 'reading-list')).map((r) => r.book!.title).sort(),
      ['Piranesi', 'Solenoid'],
    )
    // And the lending app's own read command answers from there too.
    let shelf = await agent.call('tools/call', {
      name: 'command',
      arguments: { name: 'shelf' },
    })
    assertStringIncludes(shelf.content[0].text, 'shelf: 2 rows')

    // The syntax before this one is refused at the door, in the sentence
    // that says what to write instead.
    await agent.tool('app_files', {
      app: 'lending',
      op: 'write',
      path: 'vocab.json',
      content: vocabFile(lent, { shelve: shelve('{{title}}') }),
    })
    let old = await assertRejects(() =>
      agent.tool('app_deploy', { app: 'lending' })
    ) as Error
    assertStringIncludes(old.message, '{{arg}} is not a hole any more')
    // And so is a command in the file it was once declared in, in the
    // sentence that says where it goes now (T-38021).
    await agent.tool('app_files', {
      app: 'lending',
      op: 'write',
      path: 'vocab.json',
      content: vocabFile(lent),
    })
    await agent.tool('app_files', {
      app: 'lending',
      op: 'write',
      path: 'tools.json',
      content: JSON.stringify({ shelf: { description: 'x', query: '.book' } }),
    })
    let stray = await assertRejects(() =>
      agent.tool('app_deploy', { app: 'lending' })
    ) as Error
    assertStringIncludes(
      stray.message,
      'tools.json is not read: a command is a $defs entry in vocab.json',
    )
    await agent.tool('app_files', {
      app: 'lending',
      op: 'delete',
      path: 'tools.json',
    })
    await agent.tool('app_files', {
      app: 'lending',
      op: 'write',
      path: 'vocab.json',
      content: vocabFile(lent, { shelve: shelve('$title'), shelf: every }),
    })
    await agent.tool('app_deploy', { app: 'lending' })

    // The one refusal: the same property with two types, named with both and
    // with the app the word lives in.
    await agent.tool('app_files', {
      app: 'lending',
      op: 'write',
      path: 'vocab.json',
      content: vocabFile({
        book: { pages: txt },
        loan: { to: txt },
      }),
    })
    let why = (await assertRejects(
      () => agent.tool('app_deploy', { app: 'lending' }),
      Error,
    )).message
    assertStringIncludes(why, 'book.pages is text here and number in')
    assertStringIncludes(why, 'reading-list, where book lives')
    // Refused whole: the home's property keeps the type its rows were written
    // under, and nothing about it moved.
    assertEquals(
      (await rows(`id=${piranesi}`, 'reading-list'))[0].book!.pages,
      null,
    )
  } finally {
    await k.stop()
  }
})

// Which prose is worth finding is the vocabulary's sentence (T-37546):
// @yaks/doc says `"search": true` of its title and body, and an app says it of
// its own properties, beside the type, in the one JSON Schema form the
// guide teaches.
Deno.test('an app declares which of its own properties are searched', async () => {
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
    let recipe = (props: Record<string, unknown>) => ({
      $defs: {
        recipe: {
          component: true,
          type: 'object',
          properties: props,
        },
      },
    })
    let titles = async (text: string) =>
      (JSON.parse(await agent.tool('search', { text })) as {
        doc: { title: string }
      }[]).map((r) => r.doc.title)

    await made(
      'kitchen',
      recipe({
        note: { type: 'string' },
        serves: { type: 'number' },
      }),
    )
    let cake = minted(
      await agent.tool('graph_apply', {
        app: 'kitchen',
        entities: [{
          entity: { eid: '$r' },
          doc: { title: 'Lemon cake' },
          recipe: { note: 'zest the marzipan', serves: 4 },
        }],
      }),
      '$r',
    )
    // Declared searched by nobody, the note is stored, readable, and not found.
    assertEquals(await titles('marzipan'), [])

    // The property says so, and the index is cut from the declaration — the row
    // already written is found by the word in it, because a schema that moved
    // rebuilds the index off the rows it mirrors (graph.ts `#build`).
    await manifest(
      'kitchen',
      recipe({
        note: { type: 'string', search: true },
        serves: { type: 'number' },
      }),
    )
    assertEquals(await titles('marzipan'), ['Lemon cake'])

    // A sibling app borrows the word and brings a searched property of its own.
    // The property is planted in the home's table, and its keywords travel with
    // it — the deploy writes the home's whole manifest back, so this is also
    // where the home's own `search` would be erased if that manifest went back
    // as types alone.
    let second = await made(
      'menus',
      recipe({
        blurb: { type: 'string', search: true },
      }),
    )
    assertStringIncludes(
      second,
      'recipe lives in kitchen; this app reads and writes it there',
    )
    await agent.tool('graph_apply', {
      app: 'menus',
      entities: [{
        entity: { eid: cake },
        recipe: { blurb: 'a citrus tearoom favourite' },
      }],
    })
    assertEquals(await titles('tearoom'), ['Lemon cake'])
    assertEquals(await titles('marzipan'), ['Lemon cake'])

    // The word has one HOME, and the door speaks the UNION of what the home and
    // its borrowers declare (agent.ts `spoken`): the schema an agent reads
    // names the borrowed property too, where the home's own manifest alone
    // would have left an app unable to discover a property it deployed itself.
    let schema = (await agent.call('tools/call', {
      name: 'graph_schema',
      arguments: {},
    })).structuredContent as {
      $defs: Record<string, { properties: Record<string, unknown> }>
    }
    assertEquals(
      Object.keys(schema.$defs.recipe.properties).sort(),
      ['blurb', 'note', 'serves'],
    )
    await agent.tool('graph_apply', {
      entities: [{
        entity: { eid: cake },
        recipe: { blurb: 'still warm from the oven' },
      }],
    })
    assertEquals(await titles('oven'), ['Lemon cake'])

    // A number holds no words. The deploy refuses the manifest in @yaks/vocab's
    // own sentence rather than planting an index over nothing, and refuses it
    // whole: the property that was searched still is.
    await agent.tool('app_files', {
      app: 'kitchen',
      op: 'write',
      path: 'vocab.json',
      content: JSON.stringify(recipe({
        note: { type: 'string', search: true },
        serves: { type: 'number', search: true },
      })),
    })
    let why = (await assertRejects(
      () => agent.tool('app_deploy', { app: 'kitchen' }),
      Error,
    )).message
    assertStringIncludes(why, 'recipe.serves is searched but holds no prose')
    assertEquals(await titles('marzipan'), ['Lemon cake'])
  } finally {
    await k.stop()
  }
})

Deno.test(
  'Plus and comped spaces can create and install more than fifty apps',
  async () => {
    let k = await kernel()
    try {
      let { cookie, eids } = await seed(k, [
        { slug: 'plus-limits37', apps: ['original'] },
        { slug: 'yourname', apps: [] },
      ])
      let agent = connector(k, cookie)
      await agent.tool('app_files', {
        space: 'plus-limits37',
        app: 'original',
        path: 'index.html',
        content: '<h1>Original</h1>',
      })
      await agent.tool('app_deploy', {
        space: 'plus-limits37',
        app: 'original',
      })
      await agent.tool('app_publish', {
        space: 'plus-limits37',
        app: 'original',
        name: 'limits-example',
      })
      await plus(k, eids['plus-limits37'])
      const seeded = [
        ...['plus-limits37', 'yourname'].flatMap((slug) =>
          Array.from({ length: 50 }, (_, i) => ({
            entity: { eid: crypto.randomUUID() },
            doc: { title: `App ${i}` },
            app: {
              slug: `app-${i}`,
              space: eids[slug],
              store: `${slug}/app-${i}`,
            },
          }))
        ),
      ]
      for (let i = 0; i < seeded.length; i += 10) {
        await meta(k).apply(seeded.slice(i, i + 10))
      }
      // Refresh the directory after seeding through its graph.
      await agent.tool('space_new', {
        slug: 'limits-refresh37',
        title: 'Refresh',
      })
      await agent.tool('app_new', {
        space: 'plus-limits37',
        slug: 'last',
        title: 'Last',
      })
      await agent.tool('app_new', {
        space: 'plus-limits37',
        slug: 'over',
        title: 'Over',
      })
      assertStringIncludes(
        await agent.tool('app_install', {
          space: 'plus-limits37',
          name: 'limits-example',
          as: 'copy',
        }),
        'as plus-limits37/copy',
      )
      await agent.tool('app_delete', { space: 'plus-limits37', app: 'copy' })
      await agent.tool('app_new', {
        space: 'plus-limits37',
        slug: 'replacement',
        title: 'Replacement',
      })
      // Comped spaces also remain uncapped through both doors.
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

// Compare-and-set, through the connector (T-37614). A batch is atomic, which
// says nothing about the read that came before it: two callers who both read
// 40 gold both write 50, and the second is wrong about the world rather than
// about the write. `$was` is the graph's `--ff-only` — the SHA-256 of the
// value as it was read, per property — and the batch is refused whole when that
// property has moved since.
Deno.test(
  'a $was precondition refuses a batch built on a value that moved',
  async () => {
    let k = await kernel()
    try {
      let jeff = await signIn(k)
      let agent = connector(k, jeff.cookie)
      await agent.tool('app_new', { slug: 'idler', title: 'Idler' })
      await agent.tool('app_files', {
        app: 'idler',
        files: [{
          path: 'vocab.json',
          content: vocabFile({ player: { gold: num, claimed: txt } }),
        }],
      })
      await agent.tool('app_deploy', { app: 'idler' })
      let hero = minted(
        await agent.tool('graph_apply', {
          app: 'idler',
          entities: [{
            entity: { eid: '$p' },
            player: { gold: 40, claimed: 'day 1' },
          }],
        }),
        '$p',
      )
      // What both claimants read, hashed the way the graph hashes it.
      let read = token('day 1')
      let claim = (gold: number, day: string) =>
        agent.tool('graph_apply', {
          app: 'idler',
          entities: [{
            entity: { eid: hero },
            player: { gold, claimed: day },
            $was: { player: { claimed: read } },
          }],
        })
      await claim(50, 'day 2')
      // The second reward, built on the same read, is refused by name — and the
      // sentence says which property moved, so the caller re-reads and merges.
      await assertRejects(
        () => claim(60, 'day 2'),
        Error,
        'player.claimed',
      )
      let [row] = JSON.parse(
        await agent.tool('graph_query', { app: 'idler', query: '.player' }),
      ) as { player: { gold: number } }[]
      assertEquals(row.player.gold, 50)
    } finally {
      await k.stop()
    }
  },
)

// Numbers are @yaks/id's, and an app's store does not load it (T-37831): an
// entity there is called by the eid its client minted, the answer carries no
// number to read, and asking the store to mint one is refused by name rather
// than answered with a bundle that has none.
Deno.test('an app store answers eids and no numbers, and refuses $num', async () => {
  let k = await kernel()
  try {
    let jeff = await signIn(k)
    let agent = connector(k, jeff.cookie)
    await agent.tool('app_new', { slug: 'recipes', title: 'Recipes' })
    await agent.tool('app_files', {
      app: 'recipes',
      files: [{
        path: 'vocab.json',
        content: vocabFile({ recipe: { serves: num } }),
      }],
    })
    await agent.tool('app_deploy', { app: 'recipes' })
    let wrote = JSON.parse(
      await agent.tool('graph_apply', {
        app: 'recipes',
        entities: [{
          entity: { eid: '$cake' },
          doc: { title: 'Lemon cake' },
          recipe: { serves: 4 },
        }],
      }),
    ) as { entity: { eid: string; num?: number } }[]
    assert(wrote.every((b) => b.entity.num == null), JSON.stringify(wrote))

    // And the read says the same: `id=` answers the whole bundle, stamps and
    // all, and the spine on it carries the eid and the archetype it was filed
    // under — no number to read.
    let [whole] = JSON.parse(
      await agent.tool('graph_query', {
        app: 'recipes',
        filter: `id=${wrote[0].entity.eid}`,
      }),
    ) as { entity: Record<string, unknown> }[]
    assert(!('num' in whole.entity), JSON.stringify(whole.entity))

    // A request nothing answers is a refusal naming it, never a silent write.
    await assertRejects(
      () =>
        agent.tool('graph_apply', {
          app: 'recipes',
          entities: [{
            entity: { eid: '$tart' },
            recipe: { serves: 2 },
            $num: true,
          }],
        }),
      Error,
      '$num',
    )
  } finally {
    await k.stop()
  }
})
