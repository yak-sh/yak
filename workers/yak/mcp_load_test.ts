// MCP workerd probes, split by subject so Deno can run the modules in parallel.
import {
  assert,
  assertEquals,
  assertRejects,
  assertStringIncludes,
} from '@std/assert'
import { parseHTML } from 'linkedom'
import { slow } from '../../src/testing.ts'
import { connector, kernel, seed, signed, signIn, stripe } from './probe.ts'
import { HAS_NOTES } from './standing.ts'
import { managePath } from './route.ts'
import { HELLO } from './mcp-probe.ts'

// And a bundle the store refuses refuses the DEPLOY, naming the file and the
// entry: an agent that wrote ten seed files needs to know which one it
// mistyped, and the refusal itself only ever names the word.
slow('a refused seed bundle names its file and index', async () => {
  let k = await kernel()
  try {
    let jeff = await signIn(k)
    let agent = connector(k, jeff.cookie)
    await agent.tool('app_new', { slug: 'cellar', title: 'Cellar' })
    let app = { app: 'cellar' }
    await agent.tool('app_files', {
      ...app,
      files: [
        { path: 'index.html', content: '<!doctype html><h1>Cellar' },
        { path: 'vocab.json', content: '{"bottle":{"year":"number"}}' },
        {
          path: 'seed/01-bottles.json',
          content: JSON.stringify([
            { entity: { eid: '$a' }, bottle: { year: 2019 } },
            { entity: { eid: '$b' }, bottle: { vintage: 2020 } },
          ]),
        },
      ],
    })
    let why = (await assertRejects(() => agent.tool('app_deploy', app), Error))
      .message
    assertStringIncludes(why, 'seed/01-bottles.json[1] was refused')
    assertStringIncludes(why, 'bottle.vintage')
    // Nothing was written: the batch is atomic and the mark is only made when
    // it lands, so fixing the file and deploying again seeds the whole thing.
    assertEquals(await agent.tool('graph_query', { q: '.bottle!' }), '[]')
    await agent.tool('app_files', {
      ...app,
      op: 'write',
      path: 'seed/01-bottles.json',
      content: JSON.stringify([
        { entity: { eid: '$a' }, bottle: { year: 2019 } },
        { entity: { eid: '$b' }, bottle: { year: 2020 } },
      ]),
    })
    assertStringIncludes(
      await agent.tool('app_deploy', app),
      'seeded 2 entities',
    )
  } finally {
    await k.stop()
  }
})

// Bulk data that is not seed data (T-34392). Owner, 2026-09-05: "any other
// improvements we can make for bulk data that isn't seed data?" The same
// reading as the seed, asked for on purpose: a folder of files as one batch,
// aliases across them, only the *.json among them, and no once-only mark — so
// a second call loads the same file again.
slow('store_load writes a file already in the app into its store', async () => {
  let k = await kernel()
  try {
    let jeff = await signIn(k)
    let agent = connector(k, jeff.cookie)
    await agent.tool('app_new', { slug: 'atlas', title: 'Atlas' })
    let app = { app: 'atlas' }
    await agent.tool('app_files', {
      ...app,
      files: [
        { path: 'index.html', content: '<!doctype html><h1>Atlas' },
        // A folder, written a call at a time the way a large dataset is — and
        // a file beside them that is not JSON, which is never read and so
        // never refuses anything.
        {
          path: 'data/01-places.json',
          content: JSON.stringify([{
            entity: { eid: '$here' },
            doc: { title: 'Reykjavik' },
          }]),
        },
        {
          path: 'data/02-notes.json',
          content: JSON.stringify([{
            entity: { eid: '$note' },
            doc: { body: 'the pool opens at six' },
            comment: { target: '$here' },
          }]),
        },
        { path: 'data/README.md', content: '# where the cities came from' },
        {
          path: 'more.json',
          content: JSON.stringify([{
            entity: { eid: '$one' },
            doc: { title: 'Akureyri' },
          }]),
        },
      ],
    })
    // The folder: both files, one batch, so the comment in the second points
    // at the entity the first minted.
    assertStringIncludes(
      await agent.tool('store_load', { ...app, path: 'data' }),
      'loaded 2 entities into',
    )
    let [place] = JSON.parse(
      await agent.tool('graph_query', { q: '.doc.title=Reykjavik' }),
    ) as { entity: { eid: string } }[]
    let [note] = JSON.parse(
      await agent.tool('graph_query', { q: '.comment!' }),
    ) as { comment: { target: { eid: string } | string } }[]
    let target = note.comment.target
    assertEquals(
      typeof target == 'string' ? target : target.eid,
      place.entity.eid,
    )
    // One file by name, too.
    assertStringIncludes(
      await agent.tool('store_load', { ...app, path: 'more.json' }),
      'loaded 1 entity into',
    )
    let titles = async () =>
      (JSON.parse(await agent.tool('graph_query', { q: '.doc.title!' })) as {
        doc: { title: string }
      }[]).map((r) => r.doc.title).sort()
    assertEquals(await titles(), ['Akureyri', 'Reykjavik'])

    // And no once-only mark: it is a call anyone can make again, which is what
    // separates it from the seed.
    assertStringIncludes(
      await agent.tool('store_load', { ...app, path: 'data' }),
      'loaded 2 entities into',
    )
    assertEquals(await titles(), ['Akureyri', 'Reykjavik', 'Reykjavik'])

    // A path that names nothing says so, and says where to look.
    assertStringIncludes(
      (await assertRejects(
        () => agent.tool('store_load', { ...app, path: 'nowhere' }),
        Error,
      )).message,
      'no file nowhere in atlas',
    )
  } finally {
    await k.stop()
  }
})

// The token that signs a terminal in (grants.ts, T-34385): the connector mints
// it, the same door takes it as the same person, `about` says who is holding
// it and until when, a grant cannot mint another, and revoking it shuts the
// door that bearer was walking through — the 401 every credential that did not
// verify gets (T-34344), rather than the surface a stranger sees.
slow(
  'a grant signs a terminal in, and revoking it shuts the door',
  async () => {
    let k = await kernel()
    try {
      let them = await seed(k, [
        { slug: `one-${crypto.randomUUID().slice(0, 6)}`, apps: ['notes'] },
        { slug: `two-${crypto.randomUUID().slice(0, 6)}`, apps: ['lists'] },
      ])
      let [one, two] = Object.keys(them.eids).filter((s) => !s.includes('/'))
      let agent = connector(k, them.cookie)
      await agent.call('initialize', HELLO)
      let said = await agent.tool('grant', {})
      // The answer is the line to paste, and what the token is worth beside it.
      let token = /^yak login (\S+)$/m.exec(said)![1]
      assertStringIncludes(said, 'shown once')
      assertStringIncludes(said, 'exactly the access they have here')
      let id = /revoke (\w+)\./.exec(said)![1]

      // The terminal: the same door, the same tools, the same person — carrying
      // no cookie at all.
      let cli = connector(k, undefined, token)
      let listed = await cli.call('tools/list')
      assert(listed.tools.some((t: { name: string }) => t.name == 'app_new'))
      let me = await cli.tool('about')
      assertStringIncludes(me, `<${them.email}>`)
      assertStringIncludes(me, 'with a CLI grant')
      assertStringIncludes(me, id)
      assertStringIncludes(await cli.tool('app_list'), 'notes')

      // A grant cannot mint another: a short life that renews itself is not one.
      assertStringIncludes(
        (await assertRejects(() => cli.tool('grant'), Error)).message,
        'cannot mint another',
      )

      // Narrowed to one space it reaches that space and no other — and cannot
      // make a third to escape into.
      let narrow = await agent.tool('grant', { space: two, hours: 6 })
      assertStringIncludes(narrow, `It reaches ${two} and no other space`)
      let only = connector(k, undefined, /^yak login (\S+)$/m.exec(narrow)![1])
      assertStringIncludes(await only.tool('app_list'), 'lists')
      assertStringIncludes(
        (await assertRejects(
          () => only.tool('app_list', { space: one }),
          Error,
        ))
          .message,
        `no space ${one}`,
      )
      assertStringIncludes(
        (await assertRejects(
          () => only.tool('space_new', { slug: 'three', title: 'three' }),
          Error,
        )).message,
        'and no other space',
      )

      // Revoked, that bearer is refused — and the narrowed one still works,
      // since only the grant named went.
      assertStringIncludes(await agent.tool('grant', { revoke: id }), id)
      assertStringIncludes(
        (await assertRejects(() => cli.call('tools/list'), Error)).message,
        'mcp 401',
      )
      assert(await only.call('tools/list'))
    } finally {
      await k.stop()
    }
  },
)

// The spreadsheet half (csv.ts, T-34393): `as` is what a row IS, the headers
// are its columns, and the id column names each row — which is what makes the
// SECOND load patch the same two rows rather than mint two more (T-34454).
slow('store_load reads a CSV as rows of one component', async () => {
  let k = await kernel()
  try {
    let jeff = await signIn(k)
    let agent = connector(k, jeff.cookie)
    await agent.tool('app_new', { slug: 'kitchen', title: 'Kitchen' })
    let app = { app: 'kitchen' }
    await agent.tool('app_files', {
      ...app,
      files: [
        { path: 'index.html', content: '<!doctype html><h1>Kitchen' },
        {
          path: 'vocab.json',
          content: '{"recipe":{"name":"text","serves":"number",' +
            '"vegan":"bool"}}',
        },
        // As a spreadsheet writes one: a BOM, CRLF, a quoted comma, and a
        // header nothing matches until `map` renames it.
        {
          path: 'data/menu.csv',
          content: '﻿id,name,Serves how many,vegan,title\r\n' +
            'lentil,"Lentil, soup",4,yes,Lentil soup\r\n' +
            'fig,Fig tart,8,no,Fig tart\r\n',
        },
      ],
    })
    await agent.tool('app_deploy', app)
    let load = (args: Record<string, unknown> = {}) =>
      agent.tool('store_load', {
        ...app,
        path: 'data/menu.csv',
        as: 'recipe',
        map: { 'Serves how many': 'serves' },
        ...args,
      })
    assertStringIncludes(await load(), 'loaded 2 entities into')
    let recipes = async () =>
      (JSON.parse(await agent.tool('graph_query', { q: '.recipe!' })) as {
        entity: { eid: string }
        recipe: { name: string; serves: number; vegan: number }
      }[]).sort((a, b) => a.recipe.serves - b.recipe.serves)
    let [soup, tart] = await recipes()
    // `yes` coerced to a boolean, which a store keeps in an integer column and
    // reads back as one — the same 1 a JSON load's `true` writes.
    assertEquals(soup.recipe, { name: 'Lentil, soup', serves: 4, vegan: 1 })
    assertEquals(tart.recipe.vegan, 0)
    // The `title` header is the row's doc, not the recipe's own word.
    assertEquals(
      (JSON.parse(await agent.tool('graph_query', { q: '.doc.title!' })) as {
        doc: { title: string }
      }[]).map((r) => r.doc.title).sort(),
      ['Fig tart', 'Lentil soup'],
    )
    // Again: the id column NAMED these two entities, so the second load lands
    // on the same two where a bare `$` mint would have made two more.
    assertStringIncludes(await load(), 'loaded 2 entities into')
    let again = await recipes()
    assertEquals(again.length, 2)
    assertEquals(again[0].entity.eid, soup.entity.eid)
    // And the name stands where an eid does: `lentil` is that row. WITH the
    // backrefs, which is `.refs=` — one term per reference column, over a
    // vocabulary with thirty of them, and workerd's SQLite takes five in a
    // compound (@yaks/sql `ARMS`, T-34489). The name row points back, so it
    // comes with it.
    let shown = JSON.parse(
      await agent.tool('graph_show', { ids: ['lentil'], backrefs: true }),
    ) as { bundles: { entity: { eid: string } }[] }
    assert(shown.bundles.some((b) => b.entity.eid == soup.entity.eid))

    // A header the component has no column for names itself, and says the
    // two ways out.
    let why = (await assertRejects(() => load({ map: {} }), Error)).message
    assertStringIncludes(why, '"Serves how many" is not a column of recipe')
    assertStringIncludes(why, 'recipe takes name, serves, vegan')
    // And a word no store says is refused before a byte is read.
    assertStringIncludes(
      (await assertRejects(() => load({ as: 'dish' }), Error)).message,
      'as: dish is not a component',
    )
  } finally {
    await k.stop()
  }
})

// NOTES.md beside an app (standing.ts, T-34425): what its person wrote down
// about how it is kept, and — for every app, notes or not — the heading that
// makes it discoverable. Owner, 2026-09-05: "if i later say, 'add this
// recipe', i want them to know there's a recipe app to add it to".
//
// The two halves are handed over at different moments since T-34632: the
// roster rides on `initialize`, and the notes are `about`'s answer.
slow('an app says what it holds, and keeps notes about itself', async () => {
  let k = await kernel()
  try {
    let jeff = await signIn(k)
    let agent = connector(k, jeff.cookie)
    let space = /https:\/\/([a-z0-9-]+)\.yaks\.app/
      .exec(
        await agent.tool('app_new', { slug: 'recipes', title: 'Recipes' }),
      )![1]
    let RULES = '# Recipes\n\nWeights in grams, never cups.\n' +
      'One photo per recipe, of the finished dish.'
    await agent.tool('app_files', {
      space,
      app: 'recipes',
      files: [
        { path: 'index.html', content: '<h1>Recipes</h1>' },
        {
          path: 'vocab.json',
          content: JSON.stringify({ recipe: { serves: 'number' } }),
        },
        {
          path: 'tools.json',
          content: JSON.stringify({
            add: {
              description: 'Write a recipe down',
              input: { title: 'text' },
              apply: { doc: { title: '{{title}}' }, recipe: {} },
            },
          }),
        },
        { path: 'NOTES.md', content: RULES },
      ],
    })
    await agent.tool('app_deploy', { space, app: 'recipes' })
    // A second app with words of its own and NO rules beside it: it is still
    // named, because being found is the point.
    await agent.tool('app_new', { slug: 'chores', title: 'Chores' })
    await agent.tool('app_files', {
      space,
      app: 'chores',
      files: [{
        path: 'vocab.json',
        content: JSON.stringify({ chore: { who: 'text' } }),
      }],
    })
    await agent.tool('app_deploy', { space, app: 'chores' })

    // What a model reads before it reads anything else.
    let init = await agent.call('initialize', HELLO)
    assertStringIncludes(init.instructions, `## ${space}/recipes`)
    assertStringIncludes(
      init.instructions,
      `https://${space}.yaks.app/recipes/`,
    )
    assertStringIncludes(init.instructions, 'holds recipes')
    assertStringIncludes(init.instructions, 'Commands: add, add_recipe')
    assertStringIncludes(init.instructions, `## ${space}/chores`)
    assertStringIncludes(init.instructions, 'holds chores')
    // The app's own words are NOT there (T-34632): a host classifies these
    // instructions, and somebody else's prose in them reads as an attempt to
    // steer the model. The roster says the notes exist and where they are.
    assertEquals(init.instructions.includes('Weights in grams'), false)
    assertStringIncludes(init.instructions, HAS_NOTES)

    // `about` is what hands them over — and it says the roster again too, for
    // a conversation the apps moved under.
    let about = await agent.tool('about')
    assertStringIncludes(about, 'Weights in grams, never cups.')
    assertStringIncludes(about, `## ${space}/chores`)

    // The person's own door onto the same words: a prompt named after the
    // app, described in OUR words, carrying the file as its text.
    let listed = async (
      c: ReturnType<typeof connector>,
    ) => ((await c.call('prompts/list')).prompts as {
      name: string
      description: string
    }[])
    let prompts = await listed(agent)
    let mine = prompts.find((p) => p.name == 'recipes')
    assert(mine, `no recipes prompt in ${prompts.map((p) => p.name)}`)
    assertEquals(mine.description, 'The notes kept beside the Recipes app.')
    assertEquals(prompts.some((p) => p.name == 'chores'), false)
    let got = await agent.call('prompts/get', { name: 'recipes' })
    assertEquals(got.messages.length, 1)
    assertEquals(got.messages[0].role, 'user')
    assertEquals(got.messages[0].content.text, RULES)

    // And the ideas door, which is about what they already have (T-34557):
    // every app of theirs by title and address, so a proposal lands on one
    // rather than in the abstract.
    let ideas = (await agent.call('prompts/get', { name: 'app-ideas' }))
      .messages[0].content.text as string
    assertStringIncludes(
      ideas,
      `- Recipes — https://${space}.yaks.app/recipes/`,
    )
    assertStringIncludes(ideas, `- Chores — https://${space}.yaks.app/chores/`)
    assertEquals(ideas.includes('https://yaks.app/login'), false)

    // It is the app's INSIDE: deployed, never served, whichever way the path
    // is spelled (apps.ts MANIFEST).
    assertEquals(
      (await k.at(`${space}.yaks.app`, '/recipes/NOTES.md')).status,
      404,
    )
    assertEquals(
      (await k.at(`${space}.yaks.app`, '/recipes/%4EOTES.md')).status,
      404,
    )
    // And the name it was written under before T-34632 is inside too, since
    // an app that still carries one is still read.
    assertEquals(
      (await k.at(`${space}.yaks.app`, '/recipes/AGENTS.md')).status,
      404,
    )

    // Too long is refused at the write, with the number, rather than
    // truncated at the read: half of what somebody wrote is worse than a
    // pointer to all of it.
    assertStringIncludes(
      (await assertRejects(
        () =>
          agent.tool('app_files', {
            space,
            app: 'recipes',
            path: 'NOTES.md',
            content: 'x'.repeat(4097),
          }),
        Error,
      )).message,
      '4097 bytes — 4096 at most',
    )

    // An app written before the rename keeps its notes: the old name is read
    // where there is no new one, and nothing migrates (standing.ts NAMES).
    await agent.tool('app_new', { slug: 'garden', title: 'Garden' })
    await agent.tool('app_files', {
      space,
      app: 'garden',
      files: [{ path: 'AGENTS.md', content: 'Water on Tuesdays.' }],
    })
    await agent.tool('app_deploy', { space, app: 'garden' })
    assertStringIncludes(await agent.tool('about'), 'Water on Tuesdays.')

    // A member of another space is told nothing about any of it: reach is
    // membership, the same question the tool list asks (declared.ts).
    let maya = connector(k, (await signIn(k)).cookie)
    let hers = await maya.call('initialize', HELLO)
    assertEquals(hers.instructions.includes('Weights in grams'), false)
    assertEquals(hers.instructions.includes(`${space}/recipes`), false)
    assertEquals((await listed(maya)).some((p) => p.name == 'recipes'), false)

    // Until she installs it. The notes are one of the app's files, so a copy
    // carries them — the publisher's notes, in her own copy, hers to rewrite.
    await agent.tool('app_publish', { space, app: 'recipes' })
    assertStringIncludes(
      await maya.tool('app_install', { name: 'recipes' }),
      'installed recipes',
    )
    assertStringIncludes(
      await maya.tool('app_files', {
        app: 'recipes',
        op: 'read',
        path: 'NOTES.md',
      }),
      'Weights in grams, never cups.',
    )
    assertStringIncludes(await maya.tool('about'), 'Weights in grams, never')
  } finally {
    await k.stop()
  }
})

// ---- selling (sell.ts, T-34524) --------------------------------------------
//
// `space_sell` through the whole kernel, and the space page beside it — which
// is here rather than in serving_test.ts because drawing that page reaches
// identity.ts for whether an assistant has ever connected, and the OAuth
// provider it carries imports `cloudflare:` modules only workerd can load.
// Stripe is a stand-in on a free port (probe.ts `stripe`), aimed at with
// STRIPE_API the way the analytics probe above aims ANALYTICS_API.
slow('space_sell connects an account and hands back one link', async () => {
  let fake = stripe(({ path }) =>
    path == '/v1/accounts'
      ? { id: 'acct_probe', charges_enabled: false, details_submitted: false }
      : path == '/v1/account_links'
      ? { url: 'https://connect.stripe.com/setup/c/acct_probe/TOKEN' }
      : path == '/v1/customers'
      ? { id: 'cus_probe' }
      : path == '/v1/checkout/sessions'
      ? { id: 'cs_probe', url: 'https://checkout.stripe.com/c/pay/cs_probe' }
      : null
  )
  let k = await kernel({
    STRIPE_KEY: 'sk_probe',
    STRIPE_PRICE: 'price_probe',
    STRIPE_API: fake.url,
    STRIPE_CONNECT_WEBHOOK_SECRET: 'whsec_a_connect_probe_secret',
    STRIPE_WEBHOOK_SECRET: 'whsec_plan_probe',
  })
  try {
    let { cookie, eids } = await seed(k, [{ slug: 'ada', apps: ['shop'] }])
    let agent = connector(k, cookie)
    // Selling has its own account page; the library links to it. The form's
    // action and next step must follow the account through all three states.
    let path = managePath('selling')
    let page = async (button: string, value = 'start') => {
      let r = await k.at('ada.yaks.app', path, { headers: { cookie } })
      assertEquals(r.status, 200)
      let { document } = parseHTML(await r.text())
      let form = document.querySelector(`form[action="${path}"]`)
      assert(form, 'the selling form')
      assertEquals(form.getAttribute('method'), 'post')
      assertEquals(
        form.querySelector('[name="sell"]')?.getAttribute('value'),
        value,
      )
      assertEquals(
        form.querySelector('button[type="submit"]')?.textContent,
        button,
      )
    }
    let library = await k.at('ada.yaks.app', '/', { headers: { cookie } })
    assertStringIncludes(await library.text(), `href="${path}"`)
    let freePage = async () => {
      let r = await k.at('ada.yaks.app', path, { headers: { cookie } })
      let { document } = parseHTML(await r.text())
      assert(!document.querySelector('[name="sell"][value="start"]'))
      assertEquals(
        document.querySelector('[data-door="checkout"]')?.getAttribute(
          'data-target',
        ),
        path,
      )
    }
    await freePage()
    await assertRejects(
      () => agent.tool('space_sell', { space: 'ada' }),
      Error,
      'Plus',
    )
    let denied = await k.at('ada.yaks.app', path, {
      method: 'POST',
      headers: { cookie, origin: 'https://ada.yaks.app' },
      body: new URLSearchParams({ sell: 'start' }),
    })
    assertEquals(denied.status, 400)
    assertEquals(fake.calls.length, 0)
    assert(
      !parseHTML(await denied.text()).document.querySelector(
        '[name="sell"][value="start"]',
      ),
    )
    // The subscription button uses this space's guarded form door, then the
    // existing billing checkout. A sibling page cannot start it.
    let subscribe = (origin = 'https://ada.yaks.app', session = cookie) =>
      k.at('ada.yaks.app', path, {
        method: 'POST',
        headers: { cookie: session, origin },
        body: new URLSearchParams({ billing: 'checkout' }),
      })
    for (
      let [origin, session] of [
        ['https://other.yaks.app', cookie],
        ['https://ada.yaks.app', ''],
        ['https://ada.yaks.app', (await signIn(k)).cookie],
      ]
    ) {
      let r = await subscribe(origin, session)
      assertEquals(r.status, 404)
      await r.body?.cancel()
    }
    assertEquals(fake.calls.length, 0)
    let checkout = await subscribe()
    assertEquals(checkout.status, 200)
    assertEquals(
      (await checkout.json()).url,
      'https://checkout.stripe.com/c/pay/cs_probe',
    )
    let purchase = fake.at('/v1/checkout/sessions')!
    assertEquals(purchase.sent.get('metadata[space]'), eids.ada)
    assertEquals(purchase.sent.get('line_items[0][price]'), 'price_probe')
    assertEquals(purchase.sent.get('managed_payments[enabled]'), 'true')
    assertEquals(purchase.sent.get('allow_promotion_codes'), 'true')
    assertEquals(
      purchase.sent.get('success_url'),
      'https://yaks.app/connect?paid=1',
    )
    assertEquals(
      purchase.sent.get('cancel_url'),
      'https://yaks.app/connect?paid=0',
    )
    let plan = async (status: string) => {
      let raw = JSON.stringify({
        id: `evt_plan_${status}`,
        type: 'customer.subscription.updated',
        created: Math.floor(Date.now() / 1000),
        data: {
          object: {
            id: 'sub_probe',
            customer: 'cus_probe',
            status,
            metadata: { space: eids.ada },
          },
        },
      })
      let r = await k.at('yaks.app', '/stripe/webhook', {
        method: 'POST',
        body: raw,
        headers: {
          'stripe-signature': await signed(
            'whsec_plan_probe',
            raw,
            Math.floor(Date.now() / 1000),
          ),
        },
      })
      assertEquals(r.status, 200)
      await r.body?.cancel()
    }
    await plan('active')
    await page('Connect Stripe')
    let paid = await subscribe()
    assertEquals(paid.status, 409)
    assertEquals((await paid.json()).error.code, 'already_plus')
    assertEquals(
      fake.calls.filter((c) => c.path == '/v1/checkout/sessions').length,
      1,
    )

    // The tool hands back ONE link and says to stop there — an assistant that
    // kept going would be an assistant clicking through somebody's identity
    // form.
    let said = await agent.tool('space_sell', { space: 'ada' })
    assertStringIncludes(said, 'https://connect.stripe.com/setup/c/acct_probe/')
    assertStringIncludes(said, 'They are the merchant')

    // What went out is the charge-merchants-directly model, and it named the
    // space both ways so an account read back at Stripe says whose it is.
    let made = fake.at('/v1/accounts')!
    assertEquals(made.sent.get('controller[fees][payer]'), 'account')
    assertEquals(made.sent.get('controller[losses][payments]'), 'stripe')
    assertEquals(made.sent.get('controller[stripe_dashboard][type]'), 'full')
    assertEquals(made.sent.get('controller[requirement_collection]'), 'stripe')
    assertEquals(made.sent.get('metadata[slug]'), 'ada')

    // The page now reads mid-setup, and does not offer the first step again.
    await page('Continue setup')

    // Stripe says they are ready, at the Connect door.
    let event = JSON.stringify({
      id: 'evt_ready',
      type: 'account.updated',
      account: 'acct_probe',
      data: {
        object: {
          id: 'acct_probe',
          charges_enabled: true,
          details_submitted: true,
        },
      },
    })
    let at = Math.floor(Date.now() / 1000)
    let hook = await k.at('yaks.app', '/stripe/connect', {
      method: 'POST',
      body: event,
      headers: {
        'content-type': 'application/json',
        'stripe-signature': await signed(
          'whsec_a_connect_probe_secret',
          event,
          at,
        ),
      },
    })
    assertEquals(hook.status, 200)
    assertEquals((await hook.json()).did, 'ada can sell')

    // The page says so, and the tool stops offering a link nobody needs.
    await page('Disconnect Stripe', 'stop')
    assertStringIncludes(
      await agent.tool('space_sell', { space: 'ada' }),
      'already selling',
    )
    assertEquals(
      fake.calls.filter((c) => c.path == '/v1/accounts').length,
      1,
      'one account, ever',
    )

    await plan('canceled')
    await freePage()
    await page('Disconnect Stripe', 'stop')
    await assertRejects(
      () => agent.tool('space_sell', { space: 'ada' }),
      Error,
      'Plus',
    )

    // Stopping is the platform forgetting, never Stripe deleting: the account
    // is the merchant's own.
    assertStringIncludes(
      await agent.tool('space_sell', { space: 'ada', disconnect: true }),
      'Their Stripe account is untouched',
    )
    await freePage()

    // And nobody but the owner may connect a space to a bank account.
    let stranger = connector(k, (await signIn(k)).cookie)
    await assertRejects(
      () => stranger.tool('space_sell', { space: 'ada' }),
      Error,
      'ada',
    )
  } finally {
    await k.stop()
    await fake.stop()
  }
})
