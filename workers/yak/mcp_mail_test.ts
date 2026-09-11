// MCP workerd probes, split by subject so Deno can run the modules in parallel.
import {
  assert,
  assertEquals,
  assertRejects,
  assertStringIncludes,
} from '@std/assert'
import { slow, until } from '../../src/testing.ts'
import {
  arrives,
  client,
  connector,
  kernel,
  rfc822,
  seed,
  signIn,
} from './probe.ts'
import { type Letter } from './mcp-probe.ts'

slow("an app's letters, listed and sent through the connector", async () => {
  let k = await kernel()
  try {
    let them = await seed(k, [{ slug: 'jeff', apps: ['recipes'] }])
    let agent = connector(k, them.cookie)
    // Two letters arrive at the app's address, the way a stranger's does.
    for (
      let [subject, body] of [
        ['Bring a dish', 'Potluck Friday.'],
        ['And a pudding', 'If you have one.'],
      ]
    ) {
      assertEquals(
        (await arrives(k, {
          from: 'ana@books.example',
          to: 'jeff.recipes@yaks.app',
          raw: rfc822({
            From: 'Ana <ana@books.example>',
            To: 'jeff.recipes@yaks.app',
            Subject: subject,
            'Content-Type': 'text/plain; charset="utf-8"',
          }, body),
        })).status,
        200,
      )
    }

    // And the app writes one of its own. The answer is the letter as applied,
    // leaving from the app's own address whatever the tool was handed, and
    // addressed to an ENTITY rather than to a string.
    let sent = JSON.parse(
      await agent.tool('mail_send', {
        app: 'recipes',
        to: 'ana@books.example',
        title: 'Thanks for the pudding',
        body: 'It went in **one** sitting.',
      }),
    ) as Letter
    assertEquals(sent.mail.from, 'jeff.recipes@yaks.app')
    assertEquals(sent.doc.title, 'Thanks for the pudding')
    assert(sent.deliver!.to, 'the letter names a recipient entity')

    // The mailbox, newest first: what it wrote, then the two that arrived.
    let titles = async (args: Record<string, unknown> = {}) =>
      (JSON.parse(
        await agent.tool('mail_list', { app: 'recipes', ...args }),
      ) as Letter[]).map((b) => b.doc.title)
    assertEquals(await titles(), [
      'Thanks for the pudding',
      'And a pudding',
      'Bring a dish',
    ])
    // Each side on its own: the ask to send is the whole distinction.
    assertEquals(await titles({ direction: 'received' }), [
      'And a pudding',
      'Bring a dish',
    ])
    assertEquals(await titles({ direction: 'sent' }), [
      'Thanks for the pudding',
    ])
    let inbox = JSON.parse(
      await agent.tool('mail_list', { app: 'recipes', direction: 'received' }),
    ) as Letter[]
    assertEquals(inbox[0].mail.from, 'ana@books.example')
    assertEquals(inbox[0].mail.to, 'jeff.recipes@yaks.app')
    assert(!inbox[0].deliver, 'an arrival asked nobody to send it')

    // What became of the one that went is a row on that same letter, written
    // back a moment after the tool answered — which is what makes mail_list
    // the way to read it, rather than the send's own reply. What the letter
    // came to rest AS is mail_test.ts's; what is held here is that the tool's
    // own answer names the letter that settled.
    let settled = await until(async () => {
      let [one] = JSON.parse(
        await agent.tool('mail_list', { app: 'recipes', direction: 'sent' }),
      ) as Letter[]
      return one.delivered || one.bounced ? one : null
    }, { timeout: 30_000, poll: 250, label: 'the letter to come to rest' })
    assertEquals(settled!.entity.eid, sent.entity.eid)

    // A DRAFT — a letter kept and never asked for — is neither side: it did
    // not arrive and it has not gone. It is in the whole mailbox and in
    // neither half, which is what the two words mean.
    await agent.tool('graph_apply', {
      app: 'recipes',
      entities: [{
        entity: { eid: '$draft' },
        doc: { title: 'Next month', body: 'Not yet.' },
        mail: {},
      }],
    })
    assert((await titles()).includes('Next month'))
    assert(!(await titles({ direction: 'received' })).includes('Next month'))
    assert(!(await titles({ direction: 'sent' })).includes('Next month'))

    // A second letter to the same address hangs off the recipient the app
    // already has, rather than a second row for one person.
    let again = JSON.parse(
      await agent.tool('mail_send', {
        app: 'recipes',
        to: 'ana@books.example',
        title: 'One more thing',
        body: 'Bring the tin back.',
      }),
    ) as Letter
    assertEquals(again.deliver!.to, sent.deliver!.to)

    // Only a member sends: the platform tier is the space's, and an app that
    // anyone with the link may WRITE is still not an open relay (the letter
    // leaves DKIM-signed as ours). A stranger's own agent is refused, and so
    // is an anonymous batch through the app's own page door — 403, whole, so
    // the letter is not written either.
    await agent.tool('app_set', { app: 'recipes', access: 'open' })
    let stranger = connector(k, (await signIn(k)).cookie)
    await assertRejects(
      () =>
        stranger.tool('mail_send', {
          app: 'recipes',
          space: 'jeff',
          to: 'ana@books.example',
          title: 'Not mine to send',
          body: 'From nobody here.',
        }),
      Error,
      'not a member of jeff',
    )
    let anybody = client(k, 'jeff.yaks.app', 'recipes')
    let relay = await anybody.post({
      entities: [
        { entity: { eid: '$them' }, email: { address: 'ana@books.example' } },
        {
          entity: { eid: '$note' },
          doc: { title: 'Open relay', body: 'Anyone at all.' },
          mail: {},
          deliver: { to: '$them' },
        },
      ],
    })
    // The store answers 403 `Denied`; the page door hands a visitor the
    // refusal and its reason (apps.ts), which is what says the rule held.
    assert(!relay.ok, 'an open app is not an open relay')
    assertStringIncludes(await relay.text(), 'Denied')
    assertEquals(await titles({ direction: 'sent' }), [
      'One more thing',
      'Thanks for the pudding',
    ])
  } finally {
    await k.stop()
  }
})

// The data an app comes with (seed.ts, T-34327). Owner, 2026-09-05: "so when
// the app is first launced or installed, it comes with some initial data."
// The whole of it: one batch out of a file and a folder, an alias resolving
// across them, the app's OWN component seeded because the vocabulary is
// planted first, a redeploy that writes nothing more, and files the web never
// sees.
slow(
  'a deploy seeds the store once, and the seed is not on the web',
  async () => {
    let k = await kernel()
    try {
      let jeff = await signIn(k)
      let agent = connector(k, jeff.cookie)
      let space = /https:\/\/([a-z0-9-]+)\.yaks\.app/
        .exec(
          await agent.tool('app_new', { slug: 'cookbook', title: 'Cookbook' }),
        )![1]
      let app = { space, app: 'cookbook' }
      await agent.tool('app_files', {
        ...app,
        files: [
          { path: 'index.html', content: '<!doctype html><h1>Cookbook' },
          { path: 'vocab.json', content: '{"recipe":{"serves":"number"}}' },
          {
            path: 'seed.json',
            content: JSON.stringify([{
              entity: { eid: '$soup' },
              doc: { title: 'Lentil soup' },
              recipe: { serves: 4 },
            }]),
          },
          // A folder as well, because the data can be large and an agent writes
          // it a call at a time — and the alias `seed.json` minted resolves
          // here, which is what says the two are ONE batch.
          {
            path: 'seed/01-notes.json',
            content: JSON.stringify([{
              entity: { eid: '$note' },
              doc: { body: 'double the cumin' },
              comment: { target: '$soup' },
            }]),
          },
        ],
      })
      let out = await agent.tool('app_deploy', app)
      assertStringIncludes(out, 'components: recipe')
      assertStringIncludes(
        out,
        'seeded 2 entities from seed.json, seed/01-notes.json',
      )
      // The rows are there, wearing the app's own word — so the seed ran AFTER
      // the vocabulary was planted — and the comment points at the entity the
      // other file minted.
      let [soup] = JSON.parse(
        await agent.tool('graph_query', { q: '.recipe!&.doc?' }),
      ) as { entity: { eid: string }; doc: { title: string } }[]
      assertEquals(soup.doc.title, 'Lentil soup')
      let [note] = JSON.parse(
        await agent.tool('graph_query', { q: '.comment!' }),
      ) as { comment: { target: { eid: string } | string } }[]
      let target = note.comment.target
      assertEquals(
        typeof target == 'string' ? target : target.eid,
        soup.entity.eid,
      )

      // Once per store: the person renames the recipe, deploys again, and the
      // seed does not put the old title back.
      await agent.tool('graph_apply', {
        change: [{ entity: { eid: soup.entity.eid }, doc: { title: 'Dal' } }],
      })
      let again = await agent.tool('app_deploy', app)
      assertEquals(again.includes('seeded'), false)
      let all = JSON.parse(
        await agent.tool('graph_query', { q: '.recipe!&.doc?' }),
      ) as { doc: { title: string } }[]
      assertEquals(all.map((r) => r.doc.title), ['Dal'])

      // And the seed is the app's INSIDE, like vocab.json: deployed, never
      // served (apps.ts MANIFEST).
      for (
        let path of ['/cookbook/seed.json', '/cookbook/seed/01-notes.json']
      ) {
        let r = await k.at(`${space}.yaks.app`, path)
        assertEquals(r.status, 404, path)
        await r.body?.cancel()
      }
      // A member still reads them back.
      assertStringIncludes(
        await agent.tool('app_files', {
          ...app,
          op: 'read',
          path: 'seed.json',
        }),
        'Lentil soup',
      )

      // And a SECOND person taking the app gets their own store seeded — which
      // is the other half of the ask: an app arrives furnished wherever it is
      // installed, and what he renamed to `Dal` is his and travels with neither.
      await agent.tool('app_publish', {
        ...app,
        about: 'Recipes to start from',
      })
      let ann = await signIn(
        k,
        `ann-${crypto.randomUUID().slice(0, 8)}@yaks.app`,
      )
      let hers = connector(k, ann.cookie)
      assertStringIncludes(
        await hers.tool('app_install', { name: 'cookbook' }),
        'seeded 2 entities',
      )
      let theirs = JSON.parse(
        await hers.tool('graph_query', { q: '.recipe!&.doc?' }),
      ) as { doc: { title: string } }[]
      assertEquals(theirs.map((r) => r.doc.title), ['Lentil soup'])
    } finally {
      await k.stop()
    }
  },
)
