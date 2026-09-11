// MCP workerd probes, split by subject so Deno can run the modules in parallel.
import {
  assert,
  assertEquals,
  assertRejects,
  assertStringIncludes,
} from '@std/assert'
import { slow } from '../../src/testing.ts'

import { connector, kernel, letter, meta, seed, signIn } from './probe.ts'
import { VERSION } from '../../src/version.ts'
import { HELLO, minted } from './mcp-probe.ts'

// The other direction (T-32950): an app's breaks reach the person's agent,
// and this is how the person reaches US. The tool writes a `report` row in
// the meta store, attributed to whoever's agent called it, and mails the same
// words to the platform's own address — the letter leading with what was
// said, since a person reads it at a glance.
// What the person said, kept as they said it (memory.ts, T-34473, T-34474).
// The whole point is that the words survive the conversation they were said
// in, so the proof is a SECOND connection reading them without asking.
slow('what the person said is kept, and read back whole', async () => {
  let k = await kernel()
  try {
    let them = await seed(k, [{ slug: 'kitchen', apps: ['recipes'] }])
    let agent = connector(k, them.cookie)
    let words = 'use grams, never cups'
    let kept = await agent.tool('memory_save', {
      said: words,
      // Three lines of context: the third is clamped off, because context is
      // the handle and never the summary.
      context: 'setting up the recipe app\nwe were on ingredients\nand this',
      about: 'recipes',
      space: 'kitchen',
    })
    assertStringIncludes(kept, `"${words}"`)
    assertStringIncludes(kept, 'kitchen')

    // The row, in the space's own store: the words verbatim in doc.body,
    // where the store's search index reads them, and the byline nobody typed.
    let rows = await meta(k, them.cookie).query('.memory!&.doc?&.created?')
    assertEquals(rows.length, 1)
    let one = rows[0] as unknown as {
      doc: { body: string }
      memory: { context: string; about: string; space: unknown }
      created: { by: { name: string } }
    }
    assertEquals(one.doc.body, words)
    assertEquals(
      one.memory.context,
      'setting up the recipe app\nwe were on ingredients',
    )
    assertEquals(one.memory.about, 'recipes')
    assertStringIncludes(JSON.stringify(one.memory.space), them.eids.kitchen)
    assertEquals(one.created.by.name, them.name)

    // Recall by words: whole, with the context under it. Ranked by meaning
    // where a vector service is bound, and by the words themselves here,
    // where none is.
    let found = await agent.tool('memory_recall', {
      words: 'grams',
      space: 'kitchen',
    })
    assertStringIncludes(found, `"${words}"`)
    assertStringIncludes(found, 'setting up the recipe app')
    assertStringIncludes(found, 'about the recipes app')
    // And words that match nothing answer the newest rather than nothing:
    // an agent told nothing was kept builds against preferences it could
    // have read.
    assertStringIncludes(
      await agent.tool('memory_recall', {
        words: 'how should it look',
        space: 'kitchen',
      }),
      words,
    )

    // A memory with no sentence in it is an agent's note about a
    // conversation, which is the one thing this is not.
    let no = await assertRejects(
      () => agent.tool('memory_save', { said: '   ', space: 'kitchen' }),
      Error,
    )
    assertStringIncludes(no.message, 'never your summary')

    // The next agent to connect gets it from `about`, with the rule for
    // keeping the next one (T-34474). It rides there rather than on the
    // instructions since T-34632: what the person said is their prose, and a
    // host classifies the instructions it is handed at connect.
    let fresh = connector(k, them.cookie)
    let said = await fresh.tool('about')
    assertStringIncludes(said, `## What ${them.name} has said`)
    assertStringIncludes(said, `"${words}"`)
    assertStringIncludes(said, 'setting up the recipe app')
    assertStringIncludes(said, 'keep their exact words with memory_save')
    let init = await fresh.call('initialize', HELLO)
    assertEquals(init.instructions.includes(words), false)

    // Somebody else's space is somebody else's: they are not handed it, they
    // cannot ask for it, and their own space holds nothing.
    let ana = connector(k, (await signIn(k)).cookie)
    assertEquals((await ana.tool('about')).includes(words), false)
    let shut = await assertRejects(
      () => ana.tool('memory_recall', { space: 'kitchen' }),
      Error,
    )
    assertStringIncludes(shut.message, 'not a member of kitchen')
    assertStringIncludes(
      await ana.tool('memory_recall', {}),
      'Nothing has been kept',
    )
  } finally {
    await k.stop()
  }
})

slow('feedback reaches the platform, in the words it was said in', async () => {
  let k = await kernel()
  try {
    let them = await seed(k, [{ slug: 'kitchen', apps: ['recipes'] }])
    let agent = connector(k, them.cookie)
    let app = { space: 'kitchen', app: 'recipes' }
    await agent.tool('app_files', {
      ...app,
      files: [{ path: 'index.html', content: '<h1>Recipes</h1>' }],
    })
    await agent.tool('app_deploy', app)

    let words = 'She said renaming an app is impossible to find. I looked ' +
      'for app_rename and there is no such tool.'
    let said = await agent.tool('feedback', { app: 'recipes', text: words })
    // One sentence the agent can repeat: it arrived, and they can answer.
    assertStringIncludes(said, 'people who run yaks.app')
    assertStringIncludes(said, 'kitchen/recipes v1')
    assertStringIncludes(said, them.email)

    // The letter: the words first, the context under a rule beneath them.
    let sent = await letter(k, 'hello@yaks.app', 'app_rename')
    assertStringIncludes(sent.subject, 'feedback: She said renaming')
    assert(sent.body.startsWith(words), sent.body)
    assertStringIncludes(sent.body, `${them.name} <${them.email}>`)
    assertStringIncludes(sent.body, 'kitchen/recipes v1')
    assertStringIncludes(sent.body, 'https://kitchen.yaks.app/recipes/')
    assertStringIncludes(sent.body, `yaks.app ${VERSION}`)
    // The SAME letter is addressed to the fleet's graph inbox as well, so it
    // lands in `task inbox` instead of waiting on a person to relay it. One
    // send, two readers: the graph copy is the letter, not a summary of it.
    assertEquals(sent.to, ['hello@yaks.app', 'task@bot.yak.sh'])
    assertEquals(await letter(k, 'task@bot.yak.sh', 'app_rename'), sent)

    // The row, in the meta store: the words, who said them, and where they
    // were standing — the app, the deploy it was serving, and the platform's
    // own release, none of which anyone was asked for.
    let rows = await meta(k, them.cookie).query('.report!&.doc?&.created?')
    assertEquals(rows.length, 1)
    let one = rows[0] as unknown as {
      doc: { title: string; body: string }
      report: {
        app: unknown
        space: unknown
        version: number
        release: string
        at: string
      }
      created: { by: { name: string } }
    }
    assertEquals(one.doc.body, words)
    assertStringIncludes(one.doc.title, 'She said renaming')
    assertEquals(one.created.by.name, them.name)
    assertEquals(one.report.version, 1)
    assertEquals(one.report.release, VERSION)
    assertStringIncludes(
      JSON.stringify(one.report.app),
      them.eids['kitchen/recipes'],
    )
    assertStringIncludes(JSON.stringify(one.report.space), them.eids.kitchen)

    // And with no app: the space still rides along, and the letter carries no
    // link to a page nobody named.
    let plain = await agent.tool('feedback', {
      text: 'The sign-in code took four minutes to arrive.',
    })
    assertStringIncludes(plain, 'people who run yaks.app')
    let second = await letter(k, 'hello@yaks.app', 'four minutes')
    assertEquals(second.body.includes('/recipes/'), false)
    let [, noApp] = await meta(k, them.cookie).query(
      '.report!&.doc?',
    ) as unknown as { report: { app: unknown; version: unknown } }[]
    assertEquals(noApp.report.app, null)
    assertEquals(noApp.report.version, null)

    // A few an hour is plenty. The fourth is a pause, not a no: it says the
    // ones already sent are kept, and where to write if it cannot wait.
    await agent.tool('feedback', { text: 'The board scrolls sideways.' })
    let stopped = await assertRejects(
      () => agent.tool('feedback', { text: 'And again.' }),
      Error,
    )
    assertStringIncludes(stopped.message, 'kept and will be read')
    assertStringIncludes(stopped.message, 'hello@yaks.app')
    // Nothing was written for the one that was held.
    assertEquals((await meta(k, them.cookie).query('.report!')).length, 3)
  } finally {
    await k.stop()
  }
})

// The funnel (T-33142): somebody invited into a space before they have ever
// signed in still gets a space of their OWN, and every tool that defaults to
// "theirs" aims at it. Belonging to the inviter's space is not having one —
// while it was, an invited person's first app_install aimed at the
// PUBLISHER's space and was refused there by the publisher's own app ceiling.
slow('an invited person gets a space of their own', async () => {
  let k = await kernel()
  try {
    let jeff = await signIn(k)
    let his = connector(k, jeff.cookie)
    let mine = jeff.email.split('@')[0]
    await his.tool('app_new', { slug: 'recipes', title: 'Recipes' })
    await his.tool('app_files', {
      app: 'recipes',
      op: 'write',
      path: 'index.html',
      content: '<h1>Recipes</h1>',
    })
    await his.tool('app_deploy', { app: 'recipes' })
    await his.tool('app_publish', { app: 'recipes', name: 'recipe-box' })

    // Invited FIRST, signed in after: the order a new person arrives in.
    let ana = `ana-${crypto.randomUUID().slice(0, 8)}@yaks.app`
    let hers = ana.split('@')[0]
    await his.tool('member_add', { email: ana, role: 'editor' })
    let agent = connector(k, (await signIn(k, ana)).cookie)

    // She belongs to his and owns hers.
    let listed = await agent.tool('app_list')
    assertStringIncludes(listed, `${hers}.yaks.app`)
    assertStringIncludes(listed, `${mine}.yaks.app`)

    // Naming the app is still naming the space, so the app she was invited
    // to needs no address.
    assertStringIncludes(
      await agent.tool('app_files', { app: 'recipes', op: 'list' }),
      'index.html',
    )

    // And what she makes lands in HERS.
    assertStringIncludes(
      await agent.tool('app_install', { name: 'recipe-box', as: 'cooking' }),
      `as ${hers}/cooking`,
    )
    assertStringIncludes(
      await agent.tool('app_new', { slug: 'notes', title: 'Notes' }),
      `${hers}.yaks.app/notes/`,
    )
  } finally {
    await k.stop()
  }
})

// The five things four separate builders each had to guess at (T-33145), each
// held here as well as written in the guide, so a guide sentence that stops
// being true fails rather than misleads: what a `time` column takes, filtering
// a column that holds an eid, what an unwritten column reads back as, and
// `task.status` before either mark.
slow('the answers four builders had to guess at', async () => {
  let k = await kernel()
  try {
    let them = await signIn(k)
    let agent = connector(k, them.cookie)
    await agent.tool('app_new', { slug: 'diary', title: 'Diary' })
    await agent.tool('app_files', {
      app: 'diary',
      op: 'write',
      path: 'vocab.json',
      content: '{"dayline":{"written":"time","mood":"text",' +
        '"pages":"number","aloud":"bool"}}',
    })
    await agent.tool('app_deploy', { app: 'diary' })
    let rows = async (filter: string) =>
      JSON.parse(
        await agent.tool('graph_query', { app: 'diary', filter }),
      ) as {
        entity: { eid: string }
        doc?: { title: string; body: string | null }
        dayline?: {
          written: string
          mood: string
          pages: number
          aloud: boolean
        }
        task?: { status: string; priority: number }
      }[]

    // A `time` column takes an ISO 8601 string with a zone, and gives it back
    // byte for byte. Noon UTC for a plain DATE is the trap: midnight renders
    // as the day before for anyone west of Greenwich.
    let written = await agent.tool('graph_apply', {
      app: 'diary',
      entities: [{
        entity: { eid: '$e' },
        doc: { title: 'Beans in' },
        dayline: { written: '2026-04-11T12:00:00Z' },
      }],
    })
    let entry = minted(written, '$e')
    let [one] = await rows('.dayline!')
    assertEquals(one.dayline!.written, '2026-04-11T12:00:00Z')
    assertEquals(
      new Date(one.dayline!.written).toISOString().slice(0, 10),
      '2026-04-11',
    )
    // Filtering on it is the ordinary comparison.
    assertEquals((await rows('.dayline.written>=2026-04-01')).length, 1)
    assertEquals((await rows('.dayline.written>=2026-05-01')).length, 0)

    // A column nobody wrote is PRESENT and null, not absent, so `in` is the
    // wrong test for "was this written" and the value is the right one.
    assertEquals(
      [one.dayline!.mood, one.dayline!.pages, one.dayline!.aloud],
      [null, null, null],
    )
    assert('mood' in one.dayline!, 'an unwritten column is present, and null')
    assertEquals(one.doc, undefined) // not named by the filter
    // And the platform's own columns are no exception: a doc nobody titled
    // answers null, the same as any column nobody wrote.
    await agent.tool('graph_apply', {
      app: 'diary',
      entities: [{
        entity: { eid: '$grey' },
        dayline: { mood: 'grey' },
        doc: { body: 'Rain again.' },
      }],
    })
    let [untitled] = await rows('.dayline.mood=grey&.doc?')
    assertEquals(untitled.doc!.title, null)
    assertEquals(untitled.dayline!.written, null)

    // A column that holds an eid is filtered by the eid, like any value —
    // `id=` addresses the row itself, which is a different question.
    await agent.tool('graph_apply', {
      app: 'diary',
      entities: [{
        entity: { eid: '$said' },
        comment: { target: entry },
        doc: { body: 'It rained.' },
      }],
    })
    let [said] = await rows(`.comment.target=${entry}`)
    assertEquals(said.entity.eid != entry, true)
    assertEquals((await rows(`.comment.target=${said.entity.eid}`)).length, 0)

    // `task.status` before either mark is `open` — the default, which the
    // two-marks sentence never named.
    await agent.tool('graph_apply', {
      app: 'diary',
      entities: [{ entity: { eid: entry }, task: {}, filed: { priority: 2 } }],
    })
    let [chore] = await rows('.task!')
    assertEquals(chore.task!.status, 'open')
    assertEquals((await rows('.task.status=open')).length, 1)
  } finally {
    await k.stop()
  }
})
