// Full observer and lease integrations; fixtures are built outside the timed acts.
import { announceExample, observerExample } from './testing.ts'
import {
  drop,
  effectDoc,
  effects,
  held,
  holding,
  take,
  until,
} from '@yaks/effects'
import { equal, test } from '@yaks/testing'
import { graph } from '@yaks/graph'
import { loadVocab } from '@yaks/vocab'
import { ram } from '@yaks/ram'

const example0 = (() => {
  let vocab = announceExample

  let fx = effects(vocab)
  let g = graph({ storage: ram(vocab), vocab, plugins: [fx] })
  let announced: string[] = []
  fx.handle({ post_announce: (event) => announced.push(event.kind) })

  return async () => {
    await g.apply([{ entity: { eid: 'p1' }, post: { title: 'First post' } }])
    await g.apply([{ entity: { eid: 'p1' }, post: { published: true } }])
    equal(announced, ['created', 'changed'])
  }
})()
test('declared effects announce creation and change', example0)

const example2 = (() => {
  let vocab = observerExample

  let fx = effects(vocab)
  let g = graph({ storage: ram(vocab), vocab, plugins: [fx] })
  let matched: string[] = []
  let removed: string[] = []
  fx.on('.post !post.published', (e) => matched.push(e.entity.eid))
  fx.on('-post', (e) => removed.push(e.kind))

  return async () => {
    await g.apply([{ entity: { eid: 'p1' }, post: {} }])
    await g.apply([{ entity: { eid: 'p1' }, post: { published: true } }])
    await g.apply([{ entity: { eid: 'p1' }, post: null }])
    equal(matched, ['p1'])
    equal(removed, ['removed'])
  }
})()
test('patterns distinguish absent fields and removal', example2)

const example4 = (() => {
  let vocab = loadVocab({ $defs: { post: { component: true } } })
  let reported: string[] = []
  let seen: string[] = []
  let fx = effects(vocab, {
    report: (error, { handler }) => reported.push(`${handler}: ${error}`),
  })
  let g = graph({ storage: ram(vocab), vocab, plugins: [fx] })
  fx.created('post', () => {
    throw new Error('mail unavailable')
  })
  fx.created('post', (e) => seen.push(e.entity.eid))

  return async () => {
    await g.apply([{ entity: { eid: 'p1' }, post: {} }])
    equal(reported, ['post.created: Error: mail unavailable'])
    equal(seen, ['p1'])
    equal((await g.get(['p1']))[0].post, {})
  }
})()
test('a failed observer reports without preventing other handlers', example4)

const example13 = await (async () => {
  let vocab = loadVocab([effectDoc])
  let g = graph({ storage: ram(vocab), vocab })
  await g.apply([
    { entity: { eid: 'w1' }, worker: {} },
    { entity: { eid: 'w2' }, worker: {} },
  ])

  const exclusive = async () => {
    equal(await take(g, 'refresh-index', { holder: 'w1' }), true)
    equal(await take(g, 'refresh-index', { holder: 'w2' }), false)
    equal((await held(g, 'refresh-index'))?.holder, 'w1')
    await drop(g, 'refresh-index', { holder: 'w1' })
  }
  test('a lease is exclusive and drops', exclusive)
  return async () => {
    let stopping = new AbortController()
    let refreshed = await holding(g, 'held-index', {
      holder: 'w2',
      signal: stopping.signal,
    }, async (signal) => {
      equal((await held(g, 'held-index'))?.holder, 'w2')
      stopping.abort()
      await until(signal)
      return 'refreshed'
    })
    equal(refreshed, 'refreshed')
    equal((await held(g, 'held-index'))?.holder, undefined)
  }
})()
test('holding releases its lease after abort', example13)
