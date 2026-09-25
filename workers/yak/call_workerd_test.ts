// An app's own command with an argument, called through its store in workerd
// (T-37978). The runner checks the arguments against the command's schema
// before it runs; a validator that compiled the schema into a function was
// refused by the runtime, and every such call was answered as a refusal.
import { assertEquals } from '@std/assert'
import { toolEid } from '@yaks/tools'
import { slow } from '../../bin/testing.ts'
import { client, connector, kernel, seed, txt, vocabFile } from './probe.ts'

slow('a command that takes an argument runs in its store', async () => {
  let k = await kernel()
  try {
    let them = await seed(k, [{ slug: 'ada', apps: [] }])
    let agent = connector(k, them.cookie)
    let at = { space: 'ada', app: 'notes' }
    await agent.tool('app_new', { ...at, slug: 'notes', title: 'Notes' })
    await agent.tool('app_files', {
      ...at,
      files: [
        { path: 'index.html', content: '<!doctype html><h1>notes</h1>' },
        {
          path: 'vocab.json',
          content: vocabFile({ note: { at: txt } }, {
            log_note: {
              description: 'Write a note',
              input: { at: txt },
              required: ['at'],
              apply: { entity: { eid: '$n' }, note: { at: '$at' } },
            },
          }),
        },
      ],
    })
    await agent.tool('app_deploy', at)
    let app = client(k, 'ada.yaks.app', 'notes', them.cookie)
    let call = crypto.randomUUID()
    await app.applied([{
      entity: { eid: call },
      call: { to: toolEid('log_note'), args: { at: 'monday' } },
    }])
    assertEquals(
      (await app.get('.note')).map((r) => (r.note as { at: string }).at),
      ['monday'],
    )
    assertEquals((await app.get(`.result.call=${call}`)).length, 1)
  } finally {
    await k.stop()
  }
})
