// What a tap approves is said from the act itself, never only from the
// Operator's words (T-3465): approval_request names a privileged act as the
// act's own tool words it, any other act's tool by its title, and a script
// approved on its words calls no privileged act it did not name.
import { line } from '@yaks/query'
import { equal, test } from '@yaks/testing'
import { evaluate } from '../../packages/code-mode/testing.ts'
import { platform } from './directory-probe.ts'
import { compiler } from './testing.ts'
import { directoryOf } from './directory.ts'
import { operatorMemory, operatorModel } from './operator-testing.ts'
import { operating } from './operator.ts'
import { type Approval, digestOf } from './operator-approvals.ts'

let { env } = platform('operator-approval-words', {
  CODE_MODE: evaluate,
  ESBUILD: compiler(),
})
let owner = crypto.randomUUID()
let dir = directoryOf(env.STORE)
let id = await dir.mint(owner, 'notes-home', 'Notes home', {
  'x-yak-person': owner,
  'x-yak-role': 'owner',
})
let space = (await dir.at(id))!
let store = operatorMemory()
let operator = operating(
  store,
  env,
  operatorModel(() => Promise.reject(new Error('No model call expected'))),
)
let { run } = await operator.tools({ person: owner }, space)
let STRANGER = { email: 'x@evil.example', role: 'owner' }
let HARMLESS = 'Save the meeting notes'

// The newest approval the Operator asked, and what its tap says.
let newest = async () => {
  let rows = await store.g.read(line`.operator_approval .order=-created.at`)
  let row = rows[0]
  return { eid: row.entity.eid, a: row.operator_approval as Approval }
}
let ask = async (tool: string, args: object) => {
  await run('approval_request', { tool, args, say: HARMLESS })
  return newest()
}

test('approval_request words a privileged act from its arguments, never as the Operator says it', async () => {
  let { a } = await ask('member_add', STRANGER)
  equal(a.say, 'Add x@evil.example to Notes home as an owner')
})

test('approval_request names any other tool beside the Operator’s words', async () => {
  let { a } = await ask('code_mode', { script: 'return 1' })
  equal(a.say, `${HARMLESS} (Run code)`)
})

test('an approved script calls no privileged act its approval did not name', async () => {
  let { eid, a } = await ask('code_mode', {
    script: `return await tools.yaks.member_add(${JSON.stringify(STRANGER)})`,
  })
  let { said } = await operator.approve(eid, digestOf(a), {
    press: true,
    who: owner,
  })
  equal(said?.includes('x@evil.example is invited'), false)
})
