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
  // A caller polling until the answer stops saying "still running" stops
  // here, rather than starting a run of its own on every late answer.
  let text = (late.content as { body: string }).body
  equal(
    [/asked at T\b/.test(text), text.endsWith('\ndeployed v42')],
    [true, true],
  )
  equal(text.includes('still running'), false)
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
