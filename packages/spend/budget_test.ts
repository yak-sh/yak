// Each account's status-line reading is kept as its own plan's.
import { equal, test } from '@yaks/testing'
import { compose } from '@yaks/cli/host'
import { accountEid } from '@yaks/model'
import { read } from './budget.ts'

test("each account's newest status-line reading is kept as its own", async () => {
  let { graph } = await compose({
    db: ':memory:',
    person: 'owner',
    plugins: ['@yaks/kernel', '@yaks/id', '@yaks/session', '@yaks/model'],
  }, ['graph'])
  let dir = Deno.makeTempDirSync({ prefix: 'usage-' })
  let file = (name: string, used: number, at: number, of?: string) =>
    Deno.writeTextFileSync(
      `${dir}/usage.${name}`,
      `SEVEN_DAY_PCT=${used}\nUPDATED_AT=${at}\n` +
        (of ? `CLAUDE_CONFIG_DIR=${of}\n` : ''),
    )
  try {
    file('a', 40, 1792531227)
    file('b.claude-teams', 5, 1792531228, '/u/.claude-teams')
    await read(graph, dir)
    let used = new Map(
      (await graph.read('.rate_limit *')).map((b) => {
        let r = b.rate_limit as { account: string; used: number }
        return [r.account, r.used]
      }),
    )
    equal(used.get(accountEid('/u/.claude-teams')), 5)
    equal(used.size, 2)
  } finally {
    Deno.removeSync(dir, { recursive: true })
  }
})
