// An expired body's bytes go with it, unless another row still names them; a
// body removed any other way keeps its bytes for history.
import { equal, test } from '@yaks/testing'
import type { Bundle, Tx } from '@yaks/graph'
import type { Hook } from '@yaks/graph/plugin'
import { loadVocab } from '@yaks/vocab'
import { by, scan, val } from '@yaks/sql'
import { blobKeywords } from './keywords.ts'
import { blobSchema, sqliteBlobs } from './sqlite.ts'
import { blobs } from './plugin.ts'
import { address, type Blobs, encode } from './store.ts'
import type { Body } from './props.ts'
import { mem } from './testing.ts'

let vocab = loadVocab({
  $defs: {
    note: {
      component: true,
      properties: { body: { type: 'string', store: 'blob' } },
    },
    copy: {
      component: true,
      properties: { sha: { type: 'string', address: true } },
    },
  },
}, [blobKeywords])

// The plugin's two hooks, as a batch removing the note `n1` meets them.
let dropped: [string[], Body[]][] = []
let store: Blobs = {
  transactional: true,
  has: () => true,
  get: () => undefined,
  put: () => {},
  drop: (shas, held) => void dropped.push([shas, held]),
}
let { precondition, commit } = blobs(vocab, store).hooks! as Record<
  string,
  Hook
>
let tx = {
  get: () => [{ entity: { eid: 'n1' }, note: { body: 'gone' } }],
} as unknown as Tx
let removal: Bundle[] = [{ entity: { eid: 'n1' }, note: null }]
let removed = async (expiring: boolean) => {
  dropped = []
  let context = { graph: {}, transaction: {}, expiring }
  await precondition(removal, tx, undefined, context)
  await commit(removal, tx, undefined, context)
  return dropped
}

test('an expiring removal asks the store to drop the bytes it named, keeping what any holder names', async () => {
  equal(await removed(true), [[[address('gone')], [
    { comp: 'copy', prop: 'sha' },
    { comp: 'note', prop: 'body' },
  ]]])
})

test('a removal that is not expiring keeps its bytes for history', async () => {
  equal(await removed(false), [])
})

// The SQLite store drops exactly the objects no holding column names.
let driver = mem()
for (let stmt of blobSchema()) driver.query(stmt)
driver.query({ t: 'create table', name: 'note', cols: [{ name: 'body' }] })
driver.query({ t: 'create table', name: 'copy', cols: [{ name: 'sha' }] })
let bytes = sqliteBlobs(driver)
let held: Body[] = [
  { comp: 'note', prop: 'body' },
  { comp: 'copy', prop: 'sha' },
]
let texts = ['lone', 'noted', 'copied']
for (let t of texts) bytes.put(address(t), encode(t))
for (
  let [table, col, text] of [['note', 'body', 'noted'], [
    'copy',
    'sha',
    'copied',
  ]]
) {
  driver.query({
    t: 'insert',
    into: table,
    cols: [col],
    rows: [[val(address(text))]],
  })
}

test('the SQLite store drops only the objects no holder names', () => {
  bytes.drop!(texts.map(address), held)
  equal(
    texts.filter((t) =>
      scan(driver, 'blob_text', by({ sha: address(t) }), ['value']).length
    ),
    ['noted', 'copied'],
  )
})
