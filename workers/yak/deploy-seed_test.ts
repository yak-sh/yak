import { assertEquals, assertRejects } from '@std/assert'
import { test } from '@yaks/testing'
import { client, connector, kernel, signIn, txt, vocabFile } from './probe.ts'

let k = await kernel()
let owner = await signIn(k)
let agent = connector(k, owner.cookie)
let page = { path: 'index.html', content: '<h1>Notes</h1>' }
let word = { title: txt }
let seed = (bundle: Record<string, unknown>) => ({
  path: 'seed.json',
  content: JSON.stringify([{ entity: { eid: '$sample' }, ...bundle }]),
})

let journal = { app: 'journal' }
await agent.tool('app_new', { slug: journal.app, title: 'Journal' })
await agent.tool('app_files', {
  ...journal,
  files: [
    page,
    {
      path: 'vocab.json',
      content: vocabFile({ journal_note: word, journal_tag: word }),
    },
    seed({
      journal_note: { title: 'First note' },
      journal_tag: { title: 'First tag' },
    }),
  ],
})
let tags = { app: 'tags' }
await agent.tool('app_new', { slug: tags.app, title: 'Tags' })
await agent.tool('app_files', {
  ...tags,
  files: [page, {
    path: 'vocab.json',
    content: vocabFile({ journal_tag: word }),
  }],
})
await agent.tool('app_deploy', tags)

test('a first deploy seeds its own new word and a word borrowed from a newer app', async () => {
  await agent.tool('app_deploy', journal)
  let space = (await k.dir.own(owner.person))!
  let host = `${space.slug}.${k.host}`
  let notes = await client(k, host, journal.app, owner.cookie).get(
    '.journal_note',
  )
  let labels = await client(k, host, tags.app, owner.cookie).get('.journal_tag')
  assertEquals(notes.map((row) => row.journal_note), [{ title: 'First note' }])
  assertEquals(labels.map((row) => row.journal_tag), [{ title: 'First tag' }])
  assertEquals(notes[0].entity.eid, labels[0].entity.eid)
})

let cards = { app: 'cards' }
await agent.tool('app_new', { slug: cards.app, title: 'Cards' })
await agent.tool('app_files', {
  ...cards,
  files: [
    page,
    { path: 'vocab.json', content: vocabFile({ card_note: word }) },
    seed({ card_photo: { title: 'First photo' } }),
  ],
})

test('a first deploy names the draft vocabulary when a seed word is unknown', async () => {
  await assertRejects(
    () => agent.tool('app_deploy', cards),
    Error,
    "seed.json[0] was refused: unknown component: card_photo — missing from the draft's vocab.json",
  )
})
