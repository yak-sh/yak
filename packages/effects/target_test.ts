import { test } from '@yaks/testing'
import { assertEquals } from '@std/assert'
import { graph, type Storage } from '@yaks/graph'
import { ram } from '@yaks/ram'
import { loadVocab } from '@yaks/vocab'
import { effects } from './registry.ts'
import { blog } from './testing.ts'

let targets = [
  '.post.published=true',
  '.post.ready=true',
  '.entity.eid=C-2 .comment.post.post.published=true',
]
let vocabularies = new Map(
  targets.map((target) => [
    target,
    loadVocab([
      ...blog.docs.map((doc) => ({
        ...doc,
        $defs: {
          ...doc.$defs,
          post: {
            ...doc.$defs!.post,
            properties: {
              ...doc.$defs!.post.properties,
              ready: { type: 'boolean', computed: true },
            },
          },
        },
      })),
      {
        $defs: {
          note: {
            effect: true,
            created: ['post', 'comment'],
            changed: ['post', 'comment'],
            removed: ['post', 'comment'],
            target,
          },
        },
      },
    ]),
  ]),
)

let fixture = (target: string) => {
  let vocab = vocabularies.get(target)!
  let seen: string[] = []
  let reads = 0
  let base = ram(vocab, {
    number: true,
    computed: {
      'post.ready': (b) => (b.post as { published?: boolean })?.published,
    },
  })
  let storage: Storage = {
    ...base,
    tx: (body) =>
      base.tx((tx) =>
        body({
          ...tx,
          read: (...args) => {
            reads++
            return tx.read(...args)
          },
        })
      ),
  }
  let fx = effects(vocab)
  fx.handle({ note: (e) => seen.push(`${e.kind} ${e.entity.eid}`) })
  let g = graph({ vocab, storage, plugins: [fx] })
  return { g, seen, reads: () => reads }
}

let post = (eid: string, published: boolean) => ({
  entity: { eid },
  post: { title: eid, published },
})

let born = fixture('.post.published=true')
test('local effect targets select canonical births from transaction facts', () => {
  born.g.apply([post('guest-0', true), post('outside', false)])
  assertEquals(born.reads(), 0)
  assertEquals(born.seen, ['created guest-0'])
})

let moved = fixture('.post.published=true')
moved.g.apply([post('guest-0', true), post('outside', false)])
moved.seen.length = 0
test('local effect targets reconcile subjects leaving and entering scope and removals', () => {
  moved.g.apply([post('guest-0', false), post('outside', true)])
  assertEquals(moved.reads(), 0)
  moved.g.apply([{ entity: { eid: 'outside' }, post: null }])
  assertEquals(moved.seen, [
    'changed guest-0',
    'changed outside',
    'removed outside',
  ])
})

let related = fixture('.entity.eid=C-2 .comment.post.post.published=true')
related.g.apply([post('parent', true)])
test('relational effect targets keep human reference addressing and exact subjects', () => {
  let f = related
  f.g.apply([{
    entity: { eid: 'guest-0' },
    comment: { post: 'parent', text: 'Hello' },
  }])
  f.g.apply([{ entity: { eid: 'guest-0' }, $delete: true }])
  assertEquals(f.seen, ['created guest-0', 'removed guest-0'])
})

let computed = fixture('.post.ready=true')
test('computed effect targets retain their storage-derived membership', () => {
  let f = computed
  f.g.apply([post('guest-0', true), post('outside', false)])
  f.g.apply([post('guest-0', false), post('outside', true)])
  f.g.apply([{ entity: { eid: 'outside' }, post: null }])
  assertEquals(f.seen, [
    'created guest-0',
    'changed guest-0',
    'changed outside',
    'removed outside',
  ])
})

let doomed = loadVocab([...blog.docs, {
  $defs: {
    note: { effect: true, removed: ['comment'], target: '.comment.text=kept' },
  },
}])
test('effect targets scope what a cascade deletes by what it was', () => {
  let seen: string[] = []
  let fx = effects(doomed).handle({ note: (e) => seen.push(e.entity.eid) })
  let g = graph({ vocab: doomed, storage: ram(doomed), plugins: [fx] })
  let comment = (eid: string, text: string) => ({
    entity: { eid },
    comment: { post: 'parent', text },
  })
  g.apply([post('parent', true), comment('c1', 'kept'), comment('c2', 'other')])
  g.apply([{ entity: { eid: 'parent' }, $delete: true }])
  assertEquals(seen, ['c1'])
})

let guestBrowser = '00000000-0000-4000-8000-000000000001'
let signedBrowser = '00000000-0000-4000-8000-000000000002'
let stamps = loadVocab(blog.docs.map((doc) => ({
  ...doc,
  $defs: {
    ...doc.$defs,
    updated: {
      ...doc.$defs!.updated,
      properties: {
        ...doc.$defs!.updated.properties,
        via: { type: 'string', stamped: true },
      },
    },
    note: {
      effect: true,
      changed: ['updated'],
      target: `.updated.via=${guestBrowser}`,
    },
  },
})))
let stamped = effects(stamps), exits: string[] = []
stamped.handle({ note: (e) => exits.push(e.entity.eid) })
let writing = graph({
  vocab: stamps,
  storage: ram(stamps),
  plugins: [stamped],
})
writing.apply([post('guest-0', false)])
writing.apply([{
  ...post('guest-0', true),
  $actor: { via: guestBrowser },
}])
exits.length = 0
test('automatic stamp triggers retain subjects leaving their prior target scope', () => {
  writing.apply([{
    ...post('guest-0', false),
    $actor: { via: signedBrowser },
  }])
  assertEquals(exits, ['guest-0'])
})

let pattern = effects(blog), matches: string[] = []
pattern.on('.post.published=true', (e) => matches.push(e.entity.eid))
let patterned = graph({
  vocab: blog,
  storage: ram(blog),
  plugins: [pattern],
})
test('single-entity matched triggers select canonical changed subjects', () => {
  patterned.apply([post('guest-0', true)])
  assertEquals(matches, ['guest-0'])
})
