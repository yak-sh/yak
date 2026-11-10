import { equal, match, ok, test } from '@yaks/testing'
import { addressed, type Bundle, type Comp } from '@yaks/graph'
import type { Request } from '@yaks/model'
import { evaluate } from '../../packages/code-mode/testing.ts'
import { platform } from './directory-probe.ts'
import { directoryOf } from './directory.ts'
import { compiler } from './testing.ts'
import { operatorModel, operatorService } from './operator-testing.ts'
import { wakeTools } from './operator-wakes.ts'
import { seenBy } from './operator-access.ts'
import { within } from './defects.ts'
import { occurrence, scheduled } from './operator-work.ts'
import { toolEid } from '@yaks/tools'
import { short } from '@yaks/id'
import { remove } from './operator-remove.ts'

let { env } = platform('operator-work', {
  CODE_MODE: evaluate,
  ESBUILD: compiler(),
})
let person = crypto.randomUUID()
let dir = directoryOf(env.STORE)
let eid = await dir.mint(person, 'work-home', 'Work home', {
  'x-yak-person': person,
  'x-yak-role': 'owner',
})
let space = (await dir.at(eid))!
let reports: Bundle[] = []
env.ERRORS = { send: (rows) => (reports.push(...rows), Promise.resolve()) }
let models: Request[] = []
let writes = 0
let service = operatorService(env, { person, role: 'owner', space: eid }, {
  ...operatorModel((req) => {
    models.push(req)
    return Promise.resolve({
      id: crypto.randomUUID(),
      model: req.model,
      items: [{ kind: 'assistant', text: 'Checked the scheduled result.' }],
      cost: 0.001,
    })
  }),
  tools: () => [{
    name: 'work_write',
    description: 'Record work.',
    parameters: { type: 'object', properties: {} },
    run: () => {
      writes++
      return Promise.resolve('written')
    },
  }],
})
env.BUILDER = service.binding
let { store } = service
let session = crypto.randomUUID()
await store.g.apply([{
  entity: { eid: session },
  session: {},
  operator_session: { space: eid, person },
}], { trusted: true })
let tools = wakeTools(store, space)
let context = {
  session,
  call: { entity: { eid: crypto.randomUUID() } },
  entries: [],
}
let setting = async (args: Comp) => {
  let answer = JSON.parse(
    String(
      await tools[0].run(
        { every: '0 18 * * 6 America/Detroit', ...args },
        context,
      ),
    ),
  )
  return (await store.g.get(await addressed(store.g, [answer.wake])))[0]
}
let ring = async (row: Bundle) => {
  await store.g.apply([{
    entity: row.entity,
    wake: { at: new Date().toISOString() },
  }], { trusted: true })
  await within(env, { request: 'scheduled test' }, () => service.drain())
  return (await store.g.read(`.operator_work.schedule=${row.entity.eid}&*`)).at(
    -1,
  )!
}

let script = await setting({
  tool: 'code_mode',
  args: { script: 'await tools.yaks.app_list({}); return {upserted: 2}' },
})
let before = models.length
let scriptRun = await ring(script)
let afterScript = models.length
let scriptCall =
  (await store.g.get([String((scriptRun.operator_work as Comp).call)]))[0]
let scriptOutputs = await store.g.read(
  `.output.source=${scriptCall.entity.eid}&*`,
)
let nested = await store.g.read(`.call.source=${scriptCall.entity.eid}&*`)
let nestedOutputs = (await Promise.all(
  nested.map((b) => store.g.read(`.output.source=${b.entity.eid}&*`)),
)).flat()
let nestedResults = (await Promise.all(
  nested.map((b) => store.g.read(`.result.call=${b.entity.eid}&*`)),
)).flat()
let snapshot = crypto.randomUUID()
let memory = crypto.randomUUID()
await store.g.apply([
  {
    entity: { eid: snapshot },
    context_output: {
      reader: person,
      source: scriptCall.entity.eid,
      body: JSON.stringify({ secret: 'a kept result' }),
    },
  },
  {
    entity: { eid: memory },
    memory: {},
    doc: { title: 'Shared instruction' },
    $actor: { by: eid, via: scriptRun.entity.eid },
  },
], { trusted: true })

let helper = await setting({ helper: 'Check the weekly records.' })
let helperRun = await ring(helper)
let checked = await setting({
  tool: 'code_mode',
  args: { script: 'return {upserted: 3}' },
  helper: 'Verify this import.',
})
let checkedRun = await ring(checked)
let checkInput = await store.g.read(
  `.entry.session=${checkedRun.entity.eid} .content .order=entry.seq&*`,
)

let broken = await setting({
  tool: 'code_mode',
  args: { script: 'throw new Error("weekly import broke")' },
  helper: 'Inspect the failure.',
})
let brokenRun = await ring(broken)
let recoveries = await store.g.read(
  `.operator_request.about=${broken.entity.eid} .operator_request.channel=wake&*`,
)

let privateIds = [
  scriptRun.entity.eid,
  scriptCall.entity.eid,
  ...scriptOutputs.map((b) => b.entity.eid),
  checkedRun.entity.eid,
  ...nested.map((b) => b.entity.eid),
  ...nestedOutputs.map((b) => b.entity.eid),
  ...nestedResults.map((b) => b.entity.eid),
  snapshot,
]
let outsider = await seenBy(store, crypto.randomUUID()).get(privateIds)
let mine = await seenBy(store, person).get(privateIds)
let shared = await seenBy(store, crypto.randomUUID()).get([memory])
let listed = JSON.parse(String(await tools[1].run({}, context)))
await tools[2].run({ wake: short(script.entity.eid) }, context)
let afterCancel = await seenBy(store, crypto.randomUUID()).get(privateIds)
await remove(store, [scriptRun.entity.eid])
let removedHistory = (await store.g.get([
  scriptCall.entity.eid,
  ...scriptOutputs.map((b) => b.entity.eid),
  ...nested.map((b) => b.entity.eid),
  ...nestedOutputs.map((b) => b.entity.eid),
  ...nestedResults.map((b) => b.entity.eid),
  snapshot,
])).filter((b) => !b.tombstone)

let revoked = await setting({ tool: 'work_write', args: {} })
let memberships = await dir.read(`.member.person=${person}`)
await dir.apply({
  entities: memberships.map((b) => ({ entity: b.entity, $delete: true })),
}, { 'x-yak-person': person, 'x-yak-role': 'owner' })
let revokedRun = await ring(revoked)

let once = 0, outcomes: string[] = []
let replay = {
  entity: { eid: crypto.randomUUID() },
  operator_ask: { space: eid, person, say: '', helper: 'Check it.' },
  call: { to: toolEid('count_once'), args: {} },
}
await store.g.apply([replay], { trusted: true })
let capabilities = {
  owner: crypto.randomUUID(),
  gone: () => true,
  tools: () =>
    Promise.resolve([{
      name: 'count_once',
      description: 'Count once.',
      parameters: { type: 'object', properties: {} },
      run: () => {
        once++
        return Promise.resolve('counted once')
      },
    }]),
  helper: (_: string, __: unknown, brief: string) => {
    outcomes.push(brief)
    return Promise.resolve()
  },
}
let at = new Date().toISOString()
await scheduled(store, replay, at, capabilities)
await scheduled(store, replay, at, {
  ...capabilities,
  owner: crypto.randomUUID(),
})
let cannotStart = { ...replay, entity: { eid: crypto.randomUUID() } }
await store.g.apply([cannotStart], { trusted: true })
await within(
  env,
  { request: 'helper startup test' },
  () =>
    scheduled(store, cannotStart, at, {
      ...capabilities,
      helper: () => Promise.reject(new Error('helper model unavailable')),
    }),
)
let [startupRun] = await store.g.get([occurrence(cannotStart.entity.eid, at)])
let startupRecovery = await store.g.read(
  `.operator_request.about=${cannotStart.entity.eid}&*`,
)

let told = async (run: Bundle) =>
  (await store.g.read(`.notification.about=${run.entity.eid}`)).length
let scriptTold = await told(scriptRun)
let helperTold = await told(helperRun)

test('a call run tells the person its outcome; a helper run tells only through notification_send', () => {
  equal(scriptTold, 1)
  equal(helperTold, 0)
})

test('a weekly code_mode call keeps its outcome without asking a model', () => {
  equal(afterScript, before)
  ok(scriptRun.completed)
  equal((scriptCall.execution as Comp).state, 'done')
  match(scriptOutputs[0], {
    output: { value: { structuredContent: { value: { upserted: 2 } } } },
  })
})

test('weekly helpers run fresh and a checking helper receives the call outcome', () => {
  ok(helperRun.completed)
  ok(checkedRun.completed)
  equal((checkedRun.operator_work as Comp).helper, checkedRun.entity.eid)
  ok(JSON.stringify(checkInput).includes('upserted'))
  ok(JSON.stringify(checkInput).includes('Call outcome'))
  ok(models.length >= 3)
})

test('a script failure reaches the tracker and Operator even when its checking helper succeeds', () => {
  ok(brokenRun.failed)
  equal(recoveries.length, 1)
  ok(reports.length > 0)
  ok(JSON.stringify(reports).includes('weekly import broke'))
})

test('run records are private and wake_list exposes recent occurrences', () => {
  equal(outsider.length, 0)
  equal(mine.length, privateIds.length)
  equal(nested.length, 1)
  equal(nestedResults.length, 1)
  equal(shared.length, 1)
  equal(afterCancel.length, 0)
  equal(removedHistory.length, 0)
  ok(
    listed.some((w: { runs: Bundle[] }) =>
      w.runs.some((r) => r.entity.eid == scriptRun.entity.eid)
    ),
  )
  ok(listed.some((w: { call?: Comp }) => w.call?.args))
})

test('scheduled tools re-read the person permissions at execution', () => {
  equal(writes, 0)
  ok(revokedRun.failed)
})

test('an interrupted occurrence reuses its recorded call outcome for the checking helper', () => {
  equal(once, 2) // one call for replay, one for cannotStart
  equal(outcomes.length, 2)
  ok(outcomes.every((outcome) => outcome.includes('counted once')))
})

test('a helper that cannot start leaves a failed run and a recovery request', () => {
  ok(startupRun.failed)
  equal(startupRecovery.length, 1)
  ok(JSON.stringify(startupRecovery).includes('helper model unavailable'))
})
