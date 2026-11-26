import { effectDoc, effects } from '@yaks/effects'
import { type Bundle, graph, mint } from '@yaks/graph'
import { ram } from '@yaks/ram'
import { equal, test } from '@yaks/testing'
import { loadVocab, pick } from '@yaks/vocab'
import { directoryDoc } from './directory-vocab.ts'
import { platformDoc } from './vocab.ts'

let vocab = loadVocab([
  pick(platformDoc, ['app', 'space']),
  pick(directoryDoc, [
    'app_icon',
    'app_splash',
    'app_splash_draw',
    'theme',
    'trashed',
    'untrashed',
  ]),
  effectDoc,
])

let directory = (version: number) => {
  let drawn: string[] = []
  let fx = effects(vocab, { singleOwner: true }).handle({
    app_splash_draw: ({ entity }) => {
      drawn.push(entity.eid)
    },
  })
  let g = graph({ vocab, storage: ram(vocab), plugins: [fx] })
  let space = { eid: mint() }, app = { eid: mint() }
  let write = (...rows: Bundle[]) => g.apply(rows, { trusted: true })
  write(
    { entity: space, space: { slug: 'checks' } },
    { entity: app, app: { space: space.eid, slug: 'cards', version } },
  )
  return {
    space,
    app,
    write,
    pending: async () =>
      (await g.read('.effect.handler=app_splash_draw')).length,
    drain: () => fx.work(g),
    drawn,
  }
}

test('an unreleased app owes no splash after a theme edit or a restore', async () => {
  let { app, write, pending } = directory(0)
  write({ entity: app, theme: { background_color: '#222' } })
  write({ entity: app, trashed: {} })
  write({ entity: app, trashed: null, untrashed: {} })
  equal(await pending(), 0)
})

test('a splash queued before trash is skipped at dispatch and runs after restore', async () => {
  let { app, write, pending, drain, drawn } = directory(0)
  write({ entity: app, app: { version: 1, source: 'release-1' } })
  equal(await pending(), 1)
  write({ entity: app, trashed: {} })
  await drain()
  equal(drawn, [])
  equal(await pending(), 0)

  write({ entity: app, trashed: null, untrashed: {} })
  await drain()
  equal(drawn, [app.eid])
})

test('a theme edit in the same write as trash owes no splash', async () => {
  let { app, write, pending } = directory(1)
  write({
    entity: app,
    trashed: {},
    theme: { background_color: '#444' },
  })
  equal(await pending(), 0)
})

test('splash work also becomes ineligible when its space is trashed', async () => {
  let { space, app, write, pending, drain, drawn } = directory(1)
  write({ entity: app, theme: { background_color: '#444' } })
  equal(await pending(), 1)
  write({ entity: space, trashed: {} })
  await drain()
  equal(drawn, [])
  equal(await pending(), 0)

  write({ entity: app, theme: { background_color: '#666' } })
  equal(await pending(), 0)
})
