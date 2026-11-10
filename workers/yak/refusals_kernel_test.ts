// The connector's refusals reach the platform store as occurrences, and the
// hourly wake sends TaskMaster what it has not yet counted.
import { equal, ok, test } from '@yaks/testing'
import { connector, kernel, letter, meta, seed, unique } from './probe.ts'
import { replyTo } from './host.ts'
import { countedIn } from './refusals.ts'

let k = await kernel()
let space = unique('refusing')
let them = await seed(k, [{ slug: space, apps: ['notes'] }])
let agent = connector(k, them.cookie)
let nobody = unique('no_such_tool')
// A tool nobody offers, and one admitted to the space that refuses there.
await agent.call('tools/call', { name: nobody, arguments: {} })
  .catch(() => {})
let missing = await agent.call('tools/call', {
  name: 'app_files',
  arguments: { space, app: unique('gone'), op: 'list' },
})
await k.settled()
type Row = {
  tool_refusal: { tool: string; space?: string; session?: string }
  refusal: { code: string }
  content: { body: string }
  counted?: { report: string }
}
let heard = async (tool: string) =>
  (await meta(k).query('.refusal&.tool_refusal *') as unknown as Row[])
    .filter((r) => r.tool_refusal.tool == tool)

test('a tool nobody offers is kept as one occurrence', async () => {
  let rows = (await heard(nobody)) as Row[]
  equal(rows.map((r) => [r.refusal.code, r.content.body]), [[
    'tool',
    'Tool <token> not found',
  ]])
})

test('a refusal inside a space keeps the space and never reaches the tracker', async () => {
  equal(missing.isError, true)
  let rows = (await heard('app_files')).filter((r) =>
    r.tool_refusal.space == them.eids[space]
  )
  equal(rows.length, 1)
  ok(rows[0].refusal.code)
  equal(
    k.reported.filter((r) => JSON.stringify(r).includes('app_files')).length,
    0,
  )
})

test('the hourly wake sends TaskMaster what it counted', async () => {
  await meta(k).apply([{
    entity: { eid: 'yak-refusals' },
    sweep: { kind: 'refusals' },
    fired: { at: new Date().toISOString() },
  }])
  await k.settled()
  let sent = await letter(k, replyTo(), nobody)
  ok(sent?.subject.startsWith('yaks.app tool refusals: '))
  let { report } = (await heard(nobody))[0].counted!
  ok(sent?.body.includes(countedIn(report)))
  // The letter's own query finds what it counted.
  let rows = await meta(k).query(countedIn(report)) as unknown as Row[]
  ok(rows.some((r) => r.tool_refusal.tool == nobody))
  // The letter is the report, and says it left.
  let [held] = await meta(k).query(`.entity.eid=${report} *`)
  ok(held.refusal_report && held.delivered)
})
