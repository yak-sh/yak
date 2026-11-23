// Claude Code's status line: its reading kept as its account's plan, and
// every plan's room said back.
import { line } from '@yaks/query'
import { test } from '@yaks/testing'
import { assertEquals } from '@std/assert'
import { accountEid, limitRows } from '@yaks/model'
import { locked, store } from './testing.ts'
import { statusLine } from './statusline.ts'

let now = Date.parse('2026-11-23T12:00:00Z')
let g = locked(store())
let codex = accountEid('/u/.codex')
await g.apply([
  { entity: { eid: codex }, account: { home: '/u/.codex' } },
  ...limitRows([{
    provider: 'codex',
    account: codex,
    window: 10080,
    used: 30,
  }]),
], { trusted: true })

let status = {
  transcript_path: '/u/.claude-work/projects/-w/s.jsonl',
  model: { display_name: 'Opus 5.5' },
  context_window: { used_percentage: 41.6 },
  rate_limits: {
    five_hour: { used_percentage: 92, resets_at: now / 1000 + 5400 },
    seven_day: { used_percentage: 40 },
  },
}
let said = await statusLine(g, status, now)
let kept = await g.read(
  line`.rate_limit.account=${accountEid('/u/.claude-work')} *`,
)

test("a status line says this session's plan first, then every other plan's room", () => {
  assertEquals(
    said,
    'Opus 5.5 ctx 42% │ claude-work 5h 8% (90m) · wk 60% │ codex wk 70%',
  )
})

test("the reading it was handed is kept as its account's", () => {
  assertEquals(
    kept.map((b) => (b.rate_limit as { used: number }).used).sort(),
    [
      40,
      92,
    ],
  )
})
