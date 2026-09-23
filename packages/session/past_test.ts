import { assertEquals } from '@std/assert'
import type { Bundle, Comp } from '@yaks/graph'
import { ids, locked, seed, store } from './harness.ts'
import { QUIET, turnsOf } from './past.ts'
import { backfill } from './service.ts'

let line = (e: Record<string, unknown>) => JSON.stringify(e)
let typed = (text: string, at: string) =>
  line({
    type: 'user',
    origin: { kind: 'human' },
    message: { content: text },
    timestamp: at,
  })
let said = (id: string, text: string, at: string) =>
  line({
    type: 'assistant',
    message: { id, content: [{ type: 'text', text }] },
    timestamp: at,
  })
let tool = (at: string) =>
  line({
    type: 'user',
    message: { content: [{ type: 'tool_result', content: 'ok' }] },
    timestamp: at,
  })
let end = (at: string) =>
  line({ type: 'system', subtype: 'turn_duration', timestamp: at })

Deno.test('a transcript becomes its typed prompts and each turn’s last reply', () => {
  assertEquals(
    turnsOf('s', [
      typed('fix it', 'T1'),
      said('m1', 'looking', 'T2'),
      tool('T3'),
      said('m2', 'fixed', 'T4'),
      said('m2', 'and tested', 'T4'),
      end('T5'),
      line({ type: 'system', subtype: 'stop_hook_summary', timestamp: 'T5' }),
      line({
        type: 'user',
        origin: { kind: 'task-notification' },
        message: { content: 'done' },
        timestamp: 'T6',
      }),
      '{not json',
      typed(
        '<command-name>/loop</command-name><command-args>5m go</command-args>',
        'T7',
      ),
      said('m3', 'cut off', 'T8'),
      typed('again', 'T9'),
    ]),
    [
      { sid: 's', at: 'T1', input: 'fix it' },
      { sid: 's', at: 'T5', output: 'fixed\n\nand tested' },
      { sid: 's', at: 'T7', input: '/loop 5m go' },
      { sid: 's', at: 'T9', input: 'again' },
    ],
  )
})

Deno.test('a message a running turn took is typed once, and a subagent’s lines are not the person’s', () => {
  let taken = (content: string) =>
    line({
      type: 'queue-operation',
      operation: 'remove',
      reason: 'absorbed_mid_turn',
      content,
      timestamp: 'T2',
    })
  assertEquals(
    turnsOf('s', [
      taken('also this'),
      taken('<task-notification>x</task-notification>'),
      typed('also this', 'T3'),
      line({
        type: 'user',
        isSidechain: true,
        origin: { kind: 'human' },
        message: { content: 'brief' },
      }),
    ]),
    [{ sid: 's', at: 'T2', input: 'also this' }],
  )
})

let c = (b: Bundle, name: string) => b[name] as Comp | undefined

// A Claude projects directory with one transcript per [sid, lines], written
// long enough ago to count as finished.
let projects = async (
  files: [string, string[]][],
  body: (dir: string) => Promise<void>,
) => {
  let dir = Deno.makeTempDirSync()
  try {
    Deno.mkdirSync(`${dir}/-home-me-code`)
    for (let [sid, lines] of files) {
      let path = `${dir}/-home-me-code/${sid}.jsonl`
      Deno.writeTextFileSync(path, lines.join('\n'))
      let old = new Date(Date.now() - QUIET - 1000)
      Deno.utimeSync(path, old, old)
    }
    await body(dir)
  } finally {
    Deno.removeSync(dir, { recursive: true })
  }
}

let turn = [
  typed('ship it', '2026-09-01T10:00:00.000Z'),
  said('m', 'shipped', '2026-09-01T10:05:00.000Z'),
  end('2026-09-01T10:05:01.000Z'),
]

Deno.test('a past transcript is read in once, each entry dated when it was said', () =>
  projects([['old-sid', turn]], async (dir) => {
    let g = locked(store())
    let known = new Set<string>()
    assertEquals(await backfill(g, dir, known), 'old-sid')
    let [s] = await g.read('.session.id=old-sid')
    assertEquals(c(s, 'session')?.operator, true)
    let entries = await g.read(
      `.entry.session=${s.entity.eid}&.order=entry.seq`,
    )
    assertEquals(
      entries.map((b) => [
        c(b, 'output') ? 'output' : 'input',
        c(b, 'content')?.body,
        c(b, 'created')?.at,
      ]),
      [
        ['input', 'ship it', '2026-09-01T10:00:00.000Z'],
        ['output', 'shipped', '2026-09-01T10:05:01.000Z'],
      ],
    )
    assertEquals(await backfill(g, dir, known), undefined)
  }))

Deno.test('a transcript the graph already holds, or one still being written, is left', () =>
  projects([['one', turn], ['live', turn]], async (dir) => {
    let s = store()
    seed(s, {
      entity: { eid: 'e1' },
      entry: { session: ids.run1 },
      content: { body: 'imported' },
    })
    let g = locked(s)
    let now = Date.now()
    Deno.utimeSync(`${dir}/-home-me-code/live.jsonl`, new Date(), new Date())
    assertEquals(await backfill(g, dir, new Set(), now), undefined)
    assertEquals(await g.read('.session.id=live'), [])
  }))
