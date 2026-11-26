import { equal, test } from '@yaks/testing'
import { outlasted } from './outlast.ts'

let body = (text: string) => ({
  said: [{ entity: { eid: '$said' }, content: { body: text } }],
})

test('the door says a late answer was asked earlier, and a refusal stays one', async () => {
  let objects = (heard: unknown) => ({
    idFromName: (name: string) => name,
    get: () => ({ call: () => Promise.resolve(heard as never) }),
  })
  let asked = { tool: 'app_deploy', args: { app: 'yak-sh' }, person: 'p' }
  let [late] = await outlasted(
    objects({ ...body('deployed v42'), asked: 'T', late: true }),
    'k',
    asked,
  )
  equal(
    (late.content as { body: string }).body,
    'This answers the app_deploy asked at T with the same arguments, which ' +
      'was still running when its caller stopped waiting; this call ran ' +
      'nothing of its own. If what it acts on changed since, call ' +
      'app_deploy again to run it anew:\ndeployed v42',
  )
  let [running] = await outlasted(objects({ running: 'T' }), 'k', asked)
  equal((running.output as { value: unknown }).value, {
    running: true,
    asked: 'T',
  })
  let [waking] = await outlasted(
    objects({ running: 'T', doing: 'the sandbox is waking' }),
    'k',
    { ...asked, tool: 'sandbox_shell' },
    'The sandbox is preparing or running your command.',
  )
  equal(
    (waking.content as { body: string }).body,
    'sandbox_shell asked at T is still running: the sandbox is waking. Call ' +
      'sandbox_shell again with the same arguments to wait for it and hear ' +
      'how it ended.',
  )
  equal((waking.output as { value: unknown }).value, {
    running: true,
    asked: 'T',
    doing: 'the sandbox is waking',
  })
  let [preparing] = await outlasted(
    objects({ running: 'T' }),
    'k',
    { ...asked, tool: 'sandbox_shell' },
    'The sandbox is preparing or running your command.',
  )
  equal(
    (preparing.content as { body: string }).body,
    'The sandbox is preparing or running your command. Call sandbox_shell ' +
      'again with the same arguments to wait for it and hear how it ended.',
  )
  let refused = await outlasted(
    objects({ refused: { code: 'limit', text: 'no' }, asked: 'T' }),
    'k',
    asked,
  ).catch((e) => [e.name, e.code, e.message])
  equal(refused, ['CallError', 'limit', 'no'])
})
