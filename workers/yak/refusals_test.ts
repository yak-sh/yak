// A hosted tool's refusals: one occurrence per call, grouped into a report of
// what no report has counted, sent until it leaves.
import { equal, ok, test } from '@yaks/testing'
import { graph, mint } from '@yaks/graph'
import { ram } from '@yaks/ram'
import { loadVocab } from '@yaks/vocab'
import { kernelDoc, kernelKeywords } from '@yaks/kernel'
import { toolsDoc } from '@yaks/tools'
import { docDoc } from '@yaks/doc'
import { mailDoc } from '@yaks/mail'
import { platformDoc } from '@yaks/platform/vocab'
import { identityEid } from '@yaks/graph/identity'
import { FROM } from './mail-config.ts'
import { cause, countedIn, occurrence, reported, reportOf } from './refusals.ts'

let vocab = loadVocab(
  [kernelDoc, toolsDoc, docDoc, mailDoc, platformDoc],
  [kernelKeywords],
)
let store = () => graph({ vocab, storage: ram(vocab) })
let env = { APEX: 'yaks.test' }
// Calls, sessions and spaces are entities elsewhere, named by eid.
let [s1, s2, session, shared] = Array.from({ length: 4 }, () => mint())
// A refusal heard at a boundary, as the platform store is sent it.
let heard = (
  tool: string,
  code: string,
  said: string,
  { call = mint(), at = '2026-11-10T10:00:00.000Z', space = s1 } = {},
) =>
  occurrence(
    { code, said },
    { entity: { eid: call }, $actor: { by: mint(), via: session } },
    tool,
    { space },
    at,
  )
let counted = async (g: ReturnType<typeof store>, report: string) =>
  (await g.read(countedIn(report))).length
let doc = async (g: ReturnType<typeof store>, report: string) =>
  (await g.get([report]))[0].doc as { title: string; body: string }

test('a cause keeps the words and loses the values', () => {
  for (
    let [said, kept] of [
      [
        'note: 342 characters, and a note is at most 200',
        'note: <n> characters, and a note is at most <n>',
      ],
      ['no space ada@example.com here', 'no space <email> here'],
      [
        'see https://ada.yaks.app/notes?key=1 for it',
        'see <url> for it',
      ],
      [
        'no entity 0b0f6b4e-6a8e-4f44-9c1c-3a1c3a1c3a1c',
        'no entity <id>',
      ],
      [
        'token a1b2c3d4e5f6g7h8i9j0 refused',
        'token <token> refused',
      ],
      [
        'text "a very long thing somebody typed into it" is too long',
        'text "…" is too long',
      ],
      ['`space` is required', '`space` is required'],
      ['  spread\n over   lines ', 'spread over lines'],
    ]
  ) equal(cause(said), kept)
})

test('a call heard at two boundaries is one occurrence', async () => {
  let g = store()
  let once = heard('graph_apply', 'Refused', 'no', { call: shared })
  await g.apply([once], { trusted: true })
  await g.apply([heard('graph_apply', 'Refused', 'no', { call: shared })], {
    trusted: true,
  })
  let rows = await g.read('.tool_refusal *')
  equal(rows.length, 1)
  equal(rows[0].entity.eid, identityEid('tool_refusal', [shared]))
  equal(rows[0].tool_refusal, {
    tool: 'graph_apply',
    source: shared,
    space: s1,
    session,
    release: (once.tool_refusal as { release: string }).release,
    at: '2026-11-10T10:00:00.000Z',
  })
  equal(rows[0].refusal, { code: 'Refused' })
})

let grouped = store()
await grouped.apply([
  heard('app_new', 'limit', 'a space holds at most 10 apps', {
    at: '2026-11-10T10:05:00.000Z',
  }),
  heard('app_new', 'limit', 'a space holds at most 12 apps', {
    at: '2026-11-10T10:45:00.000Z',
    space: s2,
  }),
  heard('app_new', 'missing', 'no such space', {
    at: '2026-11-10T10:10:00.000Z',
  }),
  heard('graph_query', 'arguments', '`q` is required', {
    at: '2026-11-10T10:20:00.000Z',
  }),
], { trusted: true })
let first = await reported(grouped, env, '2026-11-10T11:00:00.000Z')

test('a report groups by tool, code and cause, the most first', async () => {
  equal(first, reportOf('2026-11-10T11:00:00.000Z'))
  let { title, body } = await doc(grouped, first!)
  equal(title, 'yaks.app tool refusals: 4 in 3 groups')
  let [, top, ...rest] = body.split('\n\n')
  equal(top.split('\n').slice(0, 3), [
    '2 × app_new · limit',
    'a space holds at most <n> apps',
    'first 2026-11-10T10:05:00.000Z · last 2026-11-10T10:45:00.000Z · ' +
    `2 spaces · 1 sessions · release ${
      (heard('x', 'y', 'z').tool_refusal as { release: string }).release
    }`,
  ])
  equal(rest.filter((group) => group.includes(' × ')).length, 2)
  ok(body.includes(countedIn(first!)))
  equal(await counted(grouped, first!), 4)
})

test('the same firing again writes no second report', async () => {
  equal(await reported(grouped, env, '2026-11-10T11:00:00.000Z'), first)
  equal((await grouped.read('.refusal_report')).length, 1)
})

test('a late arrival goes in the next report and nothing is counted twice', async () => {
  await grouped.apply([
    heard('app_new', 'missing', 'no such space', {
      at: '2026-11-10T10:59:00.000Z',
    }),
  ], { trusted: true })
  let next = await reported(grouped, env, '2026-11-10T12:00:00.000Z')
  ok(next && next != first)
  equal(await counted(grouped, next!), 1)
  equal(await counted(grouped, first!), 4)
  equal(
    (await doc(grouped, next!)).title,
    'yaks.app tool refusals: 1 in 1 group',
  )
})

test('an hour with nothing to count writes and sends nothing', async () => {
  let g = store()
  equal(await reported(g, env, '2026-11-10T11:00:00.000Z'), null)
  await g.apply([heard('a', 'b', 'c')], { trusted: true })
  await reported(g, env, '2026-11-10T11:00:00.000Z')
  equal(await reported(g, env, '2026-11-10T12:00:00.000Z'), null)
  equal((await g.read('.refusal_report')).length, 1)
})

let crowded = store()
await crowded.apply(
  Array.from({ length: 5 }, () => heard('a', 'b', 'c')),
  { trusted: true },
)

test('a report counts at most its most, and the rest wait', async () => {
  let one = await reported(crowded, env, '2026-11-10T11:00:00.000Z', 3)
  let two = await reported(crowded, env, '2026-11-10T12:00:00.000Z', 3)
  equal([await counted(crowded, one!), await counted(crowded, two!)], [3, 2])
})

test('a report is its own letter to TaskMaster, for the pool to send', async () => {
  let [row] = await grouped.get([first!])
  let to = (row.deliver as { to: string }).to
  equal((await grouped.get([to]))[0].email, { address: 'hello@yaks.test' })
  equal((row.mail as { from: string }).from, FROM)
  equal(
    (row.doc as { title: string }).title,
    'yaks.app tool refusals: 4 in 3 groups',
  )
  equal(row.delivered, undefined)
})
