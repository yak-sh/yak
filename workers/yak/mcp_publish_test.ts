// MCP workerd probes, split by subject so Deno can run the modules in parallel.
import {
  assert,
  assertEquals,
  assertRejects,
  assertStringIncludes,
} from '@std/assert'
import { slow } from '../../src/testing.ts'
import { connector, kernel, letter, signIn } from './probe.ts'

// Across spaces a word means what its space says (T-32728): one name, two
// vocabularies. A bundle merges by name only where the shapes agree, and
// otherwise the rows stay apart with the space named beside `kind`.
slow('a word two spaces spell differently stays two words', async () => {
  let k = await kernel()
  try {
    let jeff = await signIn(k)
    let agent = connector(k, jeff.cookie)
    let made = async (space: string, slug: string, vocab: unknown) => {
      await agent.tool('space_new', { slug: space, title: space })
      await agent.tool('app_new', { space, slug, title: slug })
      await agent.tool('app_files', {
        space,
        app: slug,
        op: 'write',
        path: 'vocab.json',
        content: JSON.stringify(vocab),
      })
      await agent.tool('app_deploy', { space, app: slug })
    }
    let shelf = `shelf-${crypto.randomUUID().slice(0, 8)}`
    let stall = `stall-${crypto.randomUUID().slice(0, 8)}`
    // `book` agrees where both declare — `pages` is one space's alone, and a
    // vocabulary only ever grows. `note.body` does not: text here, number
    // there, so the name is two words.
    await made(shelf, 'reading', {
      book: { title: 'text', pages: 'number' },
      note: { body: 'text' },
    })
    await made(stall, 'catalog', {
      book: { title: 'text' },
      note: { body: 'number' },
    })
    let piranesi = crypto.randomUUID()
    await agent.tool('graph_apply', {
      space: shelf,
      app: 'reading',
      entities: [{
        entity: { eid: piranesi },
        book: { title: 'Piranesi', pages: 245 },
        note: { body: 'lovely' },
      }],
    })
    await agent.tool('graph_apply', {
      space: stall,
      app: 'catalog',
      entities: [{
        entity: { eid: piranesi },
        book: { title: 'Piranesi' },
        note: { body: 3 },
      }],
    })
    let rows = async (filter: string) =>
      JSON.parse(await agent.tool('graph_query', { filter })) as {
        kind: string
        space?: string
        book?: { title?: string; pages?: number }
        note?: { body?: unknown }
      }[]
    // The shapes agree, so the name is one word and the answer is one bundle.
    let agreed = await rows('.book!')
    assertEquals(agreed.length, 1)
    assertEquals(agreed[0].space, undefined)
    assertEquals(agreed[0].book!.pages, 245)
    // They do not agree, so the rows stay apart, each saying which space it
    // is answering for.
    let apart = await rows('.note!')
    assertEquals(apart.length, 2)
    assertEquals(apart.map((r) => r.space!).sort(), [shelf, stall].sort())
    assertEquals(
      apart.map((r) => r.note!.body).sort(),
      ['lovely', 3].sort(),
    )
  } finally {
    await k.stop()
  }
})

// An app is a plugin (D-32318 §Nouns, T-32888): a deployed app is OFFERED to
// every other space under a platform-wide name, that name is one app's — a
// second claim on it is refused in a sentence — and withdrawing the offer
// leaves the app, and everyone who took it, exactly as they were.
slow('an app is published by name, and the name is one app', async () => {
  let k = await kernel()
  try {
    let jeff = await signIn(k)
    let mine = jeff.email.split('@')[0]
    let agent = connector(k, jeff.cookie)
    let made = async (space: string, slug: string) => {
      await agent.tool('app_new', { space, slug, title: slug })
      await agent.tool('app_files', {
        space,
        app: slug,
        op: 'write',
        path: 'index.html',
        content: `<h1>${slug}</h1>`,
      })
    }
    assertEquals(await agent.tool('app_published'), 'nothing is published yet')

    // An app that has never deployed serves nothing an installer could copy.
    await made(mine, 'recipes')
    assertStringIncludes(
      (await assertRejects(
        () => agent.tool('app_publish', { space: mine, app: 'recipes' }),
        Error,
      )).message,
      'has never been deployed',
    )
    await agent.tool('app_deploy', { space: mine, app: 'recipes' })

    // Published under its own slug, at the version that is serving.
    let said = await agent.tool('app_publish', {
      space: mine,
      app: 'recipes',
      about: 'Somewhere to keep recipes',
    })
    assertStringIncludes(said, 'published recipes v1')
    assertStringIncludes(said, 'Somewhere to keep recipes')
    assertStringIncludes(said, "app_install(name: 'recipes')")
    let listed = await agent.tool('app_published')
    assertStringIncludes(listed, '- recipes v1')
    assertStringIncludes(listed, 'Somewhere to keep recipes')

    // A SECOND space claiming the same name is refused, named with the app
    // that has it — and its own slug is free, so it offers under another.
    await agent.tool('space_new', { slug: 'kitchen', title: 'kitchen' })
    await made('kitchen', 'recipes')
    await agent.tool('app_deploy', { space: 'kitchen', app: 'recipes' })
    assertStringIncludes(
      (await assertRejects(
        () => agent.tool('app_publish', { space: 'kitchen', app: 'recipes' }),
        Error,
      )).message,
      'recipes is published by',
    )
    await agent.tool('app_publish', {
      space: 'kitchen',
      app: 'recipes',
      name: 'recipe-box',
    })
    assertEquals((await agent.tool('app_published')).split('\n').length, 2)

    // A deploy does NOT move the offer: publishing is the owner's act and
    // pins what strangers install. Silence about that is what left the
    // guestbook offering v1 while v2 served (T-33146), so the deploy that
    // leaves the offer trailing says so at the door.
    let bumped = await agent.tool('app_deploy', { space: mine, app: 'recipes' })
    assertStringIncludes(bumped, 'offered as recipes is still v1')
    assertStringIncludes(bumped, 'app_publish again to offer this one')
    assertStringIncludes(await agent.tool('app_published'), '- recipes v1')
    // And app_versions marks which one is on offer beside which is live.
    let marks = await agent.tool('app_versions', {
      space: mine,
      app: 'recipes',
    })
    assertStringIncludes(marks, '- v2 (live)')
    assertStringIncludes(marks, '- v1 (offered)')

    // Publishing the same app again is not a second offer: it moves the
    // version on the one that stands, and keeps the line already said.
    assertStringIncludes(
      await agent.tool('app_publish', { space: mine, app: 'recipes' }),
      'published recipes v2',
    )
    assertStringIncludes(
      await agent.tool('app_versions', { space: mine, app: 'recipes' }),
      '- v2 (live) (offered)',
    )
    let again = await agent.tool('app_published')
    assertStringIncludes(again, '- recipes v2')
    assertStringIncludes(again, 'Somewhere to keep recipes')
    assertEquals(again.split('\n').length, 2)

    // A name is claimed ONCE (T-32908, C-32905 item 4). The kitchen app is
    // offered as `recipe-box`, which is not its slug: republishing it with no
    // name keeps that name and says so. Before this it silently renamed the
    // offer to the app's slug, and everyone told to install `recipe-box`
    // found nothing.
    await agent.tool('app_deploy', { space: 'kitchen', app: 'recipes' })
    assertStringIncludes(
      await agent.tool('app_publish', { space: 'kitchen', app: 'recipes' }),
      'published recipe-box v2',
    )
    let kept = await agent.tool('app_published')
    assertStringIncludes(kept, '- recipe-box v2')
    assertEquals(kept.split('\n').length, 2)

    // Moving it takes an explicit name, and the answer says what the old one
    // is worth now.
    let renamed = await agent.tool('app_publish', {
      space: 'kitchen',
      app: 'recipes',
      name: 'recipe-cards',
    })
    assertStringIncludes(renamed, 'published recipe-cards v2')
    assertStringIncludes(renamed, 'it was offered as recipe-box')
    assertStringIncludes(renamed, 'no longer resolves')
    let moved = await agent.tool('app_published')
    assertStringIncludes(moved, '- recipe-cards v2')
    assertEquals(moved.includes('recipe-box'), false)
    assertStringIncludes(
      (await assertRejects(
        () => agent.tool('app_install', { space: mine, name: 'recipe-box' }),
        Error,
      )).message,
      'nothing is published as recipe-box',
    )

    // Only an owner may: an editor writes the app's files and does not hand
    // its code to strangers.
    let ann = await signIn(k, `ann-${crypto.randomUUID().slice(0, 8)}@yaks.app`)
    await agent.tool('member_add', {
      space: mine,
      email: ann.email,
      role: 'editor',
    })
    assertStringIncludes(
      (await assertRejects(
        () =>
          connector(k, ann.cookie).tool('app_publish', {
            space: mine,
            app: 'recipes',
          }),
        Error,
      )).message,
      'not the owner of',
    )

    // Withdrawn: the app stands, the name is free again, the offer is gone.
    assertStringIncludes(
      await agent.tool('app_unpublish', { space: mine, app: 'recipes' }),
      'no longer offered',
    )
    let left = await agent.tool('app_published')
    assertEquals(left.split('\n').length, 1)
    assertStringIncludes(left, 'recipe-cards')
    assertStringIncludes(
      (await assertRejects(
        () => agent.tool('app_unpublish', { space: mine, app: 'recipes' }),
        Error,
      )).message,
      'is not published',
    )
    // And the app itself is untouched: it serves what it always did.
    assertStringIncludes(
      await agent.tool('app_files', {
        space: mine,
        app: 'recipes',
        op: 'read',
        path: 'index.html',
      }),
      '<h1>recipes</h1>',
    )
  } finally {
    await k.stop()
  }
})

// The whole of T-34475: an owner asks for the gallery, a letter carries the
// decision, and the app is on the public page — and in a stranger's search —
// only after somebody here opens the link that says yes (gallery.ts, M-4522).
// Then the two ways off it: withdrawing, which clears the word, and the trash,
// which writes nothing and gives the listing back on a restore.
slow('an app reaches the gallery only when yaks.app says yes', async () => {
  let k = await kernel()
  try {
    let jeff = await signIn(k)
    let agent = connector(k, jeff.cookie)
    let mine = jeff.email.split('@')[0]
    await agent.tool('app_new', { slug: 'recipes', title: 'Recipe box' })
    await agent.tool('app_files', {
      space: mine,
      app: 'recipes',
      op: 'write',
      path: 'index.html',
      content:
        '<meta property="og:image" content="card.png"><h1>Recipe box</h1>',
    })
    await agent.tool('app_deploy', { space: mine, app: 'recipes' })

    // The ask: published, and put forward. Nothing is on the page yet, and the
    // answer says exactly that rather than implying it landed.
    let said = await agent.tool('app_publish', {
      space: mine,
      app: 'recipes',
      about: 'Somewhere to keep recipes',
      gallery: true,
    })
    assertStringIncludes(said, 'published recipes v1')
    let empty = await k.at('yaks.app', '/gallery')
    assert(!(await empty.text()).includes('class="Make_Card"'))

    // The letter, at the platform's own mailbox, carrying both answers.
    let post = await letter(k, 'hello@yaks.app', 'Recipe box')
    assertStringIncludes(post.body, `https://${mine}.yaks.app/recipes/`)
    assertStringIncludes(post.body, 'Somewhere to keep recipes')
    let [yes, no] = [
      ...post.body.matchAll(
        /https:\/\/yaks\.app(\/gallery\/review\?t=[^\s]+)/g,
      ),
    ]
      .map((m) => m[1])
    assert(yes && no, 'the letter carries two links')

    // The GET only ever DRAWS: a mail client that fetches every link in a
    // letter must not be able to list an app by doing its job.
    let drawn = await k.at('yaks.app', yes)
    assertEquals(drawn.status, 200)
    assertStringIncludes(await drawn.text(), '<form method="post"')
    assert(
      !(await k.at('yaks.app', '/gallery').then((r) => r.text()))
        .includes('class="Make_Card"'),
    )

    // The POST acts. Now it is on the page, with its own share card and the
    // line that gives somebody their own copy.
    let token = new URLSearchParams(yes.split('?')[1]).get('t')!
    let ok = await k.at('yaks.app', '/gallery/review', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ t: token }).toString(),
    })
    assertEquals(ok.status, 200)
    await ok.body?.cancel()
    let page = await k.at('yaks.app', '/gallery').then((r) => r.text())
    assertStringIncludes(page, 'Recipe box')
    assertStringIncludes(page, 'Somewhere to keep recipes')
    assertStringIncludes(page, `https://${mine}.yaks.app/recipes/`)
    // The app's own og:image, read off the bytes we hold and resolved against
    // its address — never against ours.
    assertStringIncludes(page, `https://${mine}.yaks.app/recipes/card.png`)
    // And on the home page, in place of the hand-written examples.
    let home = await k.at('yaks.app', '/').then((r) => r.text())
    assertStringIncludes(home, 'Recipe box')
    assertEquals(home.includes('A garden diary'), false)

    // A stranger finds it: no cookie, no bearer, the same answer with the
    // install line on it.
    let found = await connector(k).tool('gallery_search', { words: 'recipes' })
    assertStringIncludes(found, 'Recipe box — Somewhere to keep recipes')
    assertStringIncludes(found, "app_install(name: 'recipes')")
    // Words in neither the name nor the line find nothing.
    assertStringIncludes(
      await connector(k).tool('gallery_search', { words: 'spreadsheet' }),
      'nothing in the gallery answers',
    )
    // And the owner's own page says where it stands.
    let space = await k.at(`${mine}.yaks.app`, '/', {
      headers: { cookie: jeff.cookie },
    }).then((r) => r.text())
    assertStringIncludes(space, 'in the gallery')

    // The trash writes NOTHING: the listing simply stops being drawn, and a
    // restore gives it back with nobody asked twice.
    await agent.tool('app_delete', { space: mine, app: 'recipes' })
    assert(
      !(await k.at('yaks.app', '/gallery').then((r) => r.text()))
        .includes('class="Make_Card"'),
    )
    await agent.tool('app_restore', { space: mine, app: 'recipes' })
    assertStringIncludes(
      await k.at('yaks.app', '/gallery').then((r) => r.text()),
      'Recipe box',
    )

    // Withdrawing is the other direction, and it CLEARS the word: the app is
    // off the page, and putting it back asks yaks.app once more.
    assertStringIncludes(
      await agent.tool('app_unpublish', { space: mine, app: 'recipes' }),
      'off the gallery',
    )
    assert(
      !(await k.at('yaks.app', '/gallery').then((r) => r.text()))
        .includes('class="Make_Card"'),
    )
    assertStringIncludes(
      await connector(k).tool('gallery_search', { words: 'recipes' }),
      'nothing in the gallery answers',
    )
    // The link out of the old letter is worth nothing now: there is no offer
    // to list, and it says so rather than stamping a row nothing points at.
    let stale = await k.at('yaks.app', yes)
    assertEquals(stale.status, 409)
    assertStringIncludes(await stale.text(), 'no longer on offer')

    // Asked again, and declined this time: the ask is cleared and nothing is
    // shown.
    await agent.tool('app_publish', { space: mine, app: 'recipes' })
    await agent.tool('app_set', {
      space: mine,
      app: 'recipes',
      gallery: true,
    })
    let second = await letter(k, 'hello@yaks.app', 'Recipe box')
    let turned = [...second.body.matchAll(
      /https:\/\/yaks\.app(\/gallery\/review\?t=[^\s]+)/g,
    )]
      .map((m) => m[1])[1]
    let off = await k.at('yaks.app', '/gallery/review', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        t: new URLSearchParams(turned.split('?')[1]).get('t')!,
      }).toString(),
    })
    assertEquals(off.status, 200)
    await off.body?.cancel()
    assert(
      !(await k.at('yaks.app', '/gallery').then((r) => r.text()))
        .includes('class="Make_Card"'),
    )
    // An app that was never published cannot be shown: the gallery is what a
    // person can install.
    await agent.tool('app_new', { slug: 'draft', title: 'Draft' })
    assertStringIncludes(
      (await assertRejects(
        () =>
          agent.tool('app_set', { space: mine, app: 'draft', gallery: true }),
        Error,
      )).message,
      'is not published',
    )
  } finally {
    await k.stop()
  }
})

// The whole of T-32889: an installed app is an ORDINARY app in the
// installer's space — its own store, its own address, its own data from the
// first byte — pinned to the version it took, so the publisher's next version
// arrives only when the installer asks for it. An update keeps their data: a
// vocabulary that only grew is grafted, one that conflicts is refused with
// the deploy's own sentence (T-32728) and nothing moves.
slow('an installed app is the installer own copy, data and all', async () => {
  let k = await kernel()
  try {
    let jeff = await signIn(k)
    let his = connector(k, jeff.cookie)
    let write =
      (agent: ReturnType<typeof connector>, app: string) =>
      (path: string, content: string) =>
        agent.tool('app_files', { app, op: 'write', path, content })
    let mine = write(his, 'tally')
    await his.tool('app_new', { slug: 'tally', title: 'Tally' })
    await mine('index.html', '<h1>Tally v1</h1>')
    await mine('vocab.json', '{"vote": {"who": "text", "pick": "text"}}')
    await his.tool('app_deploy', { app: 'tally' })
    await his.tool('app_publish', { app: 'tally', about: 'Count the votes' })
    let votes = (agent: ReturnType<typeof connector>) => async () =>
      (JSON.parse(
        await agent.tool('graph_query', { app: 'tally', filter: '.vote!' }),
      ) as { vote: { who: string; pick?: string } }[])
        .map((r) => r.vote.who).sort()
    let cast = (agent: ReturnType<typeof connector>, who: string) =>
      agent.tool('graph_apply', {
        app: 'tally',
        entities: [{ entity: { eid: '$v' }, vote: { who, pick: 'blue' } }],
      })
    await cast(his, 'jeff')

    // A SECOND person, in their own space, takes it.
    let ann = await signIn(k, `ann-${crypto.randomUUID().slice(0, 8)}@yaks.app`)
    let hers = connector(k, ann.cookie)
    let space = ann.email.split('@')[0]
    assertStringIncludes(await hers.tool('app_published'), '- tally v1')
    let took = await hers.tool('app_install', { name: 'tally' })
    assertStringIncludes(took, 'installed tally v1 as ' + space + '/tally')
    assertStringIncludes(took, `https://${space}.yaks.app/tally/`)
    assertStringIncludes(took, '2 files')
    assertStringIncludes(took, 'components: vote')

    // The code came; the data did not. Her store is empty and her page is
    // the one that was published.
    assertEquals(await votes(hers)(), [])
    assertStringIncludes(
      await hers.tool('app_files', {
        app: 'tally',
        op: 'read',
        path: 'index.html',
      }),
      '<h1>Tally v1</h1>',
    )
    // And it serves at HER address, out of her own app.
    let page = await k.at(`${space}.yaks.app`, '/tally/')
    assertEquals(page.status, 200)
    assertStringIncludes(await page.text(), '<h1>Tally v1</h1>')

    // Both write, and neither sees the other: two stores, one code.
    await cast(hers, 'ann')
    assertEquals(await votes(his)(), ['jeff'])
    assertEquals(await votes(hers)(), ['ann'])

    // A SECOND version, published. Nothing of hers moves until she asks.
    await mine('index.html', '<h1>Tally v2</h1>')
    await mine(
      'vocab.json',
      '{"vote": {"who": "text", "pick": "text", "at": "text"}}',
    )
    await his.tool('app_deploy', { app: 'tally' })
    await his.tool('app_publish', { app: 'tally' })
    assertStringIncludes(
      await hers.tool('app_files', {
        app: 'tally',
        op: 'read',
        path: 'index.html',
      }),
      '<h1>Tally v1</h1>',
    )

    // Asked for: the code moves, the data stays, the word grows.
    let moved = await hers.tool('app_update', { app: 'tally' })
    assertStringIncludes(moved, 'updated ' + space + '/tally from v1 to v2')
    assertStringIncludes(moved, 'everything it had saved is still there')
    assertStringIncludes(moved, 'added: vote.at')
    assertEquals(await votes(hers)(), ['ann'])
    assertStringIncludes(
      await hers.tool('app_files', {
        app: 'tally',
        op: 'read',
        path: 'index.html',
      }),
      '<h1>Tally v2</h1>',
    )
    // The grown column is writable in HER store, on the row she already had.
    await hers.tool('graph_apply', {
      app: 'tally',
      entities: [{
        entity: { eid: '$v' },
        vote: { who: 'ann2', pick: 'red', at: 'today' },
      }],
    })
    assertEquals(await votes(hers)(), ['ann', 'ann2'])
    // Twice is not twice: the pin is already there.
    assertStringIncludes(
      await hers.tool('app_update', { app: 'tally' }),
      'is already at v2',
    )

    // A CONFLICT: her copy declared a column of its own, and the publisher's
    // next version spells the same one differently. The update is refused
    // with the deploy's own sentence, and not a byte of her app moves.
    await write(hers, 'tally')(
      'vocab.json',
      '{"vote": {"who": "text", "pick": "text", "at": "text", ' +
        '"count": "number"}}',
    )
    await hers.tool('app_deploy', { app: 'tally' })
    await mine(
      'vocab.json',
      '{"vote": {"who": "text", "pick": "text", "at": "text", ' +
        '"count": "text"}}',
    )
    await mine('index.html', '<h1>Tally v3</h1>')
    await his.tool('app_deploy', { app: 'tally' })
    await his.tool('app_publish', { app: 'tally' })
    assertStringIncludes(
      (await assertRejects(
        () => hers.tool('app_update', { app: 'tally' }),
        Error,
      )).message,
      'vote.count is already number',
    )
    assertStringIncludes(
      await hers.tool('app_files', {
        app: 'tally',
        op: 'read',
        path: 'index.html',
      }),
      '<h1>Tally v2</h1>',
    )
    assertEquals(await votes(hers)(), ['ann', 'ann2'])

    // An app that was never installed has nothing to update to.
    assertStringIncludes(
      (await assertRejects(
        () => his.tool('app_update', { app: 'tally' }),
        Error,
      )).message,
      'was not installed from anywhere',
    )
  } finally {
    await k.stop()
  }
})
