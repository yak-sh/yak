// A write of an app's own word before its first deploy is refused with what
// installs it, app_deploy, rather than that its vocab.json does not declare
// it (vocab.ts `teach`); once deployed, a word it does not declare is said so.
import { test } from '@yaks/testing'
import { assertRejects } from '@std/assert'
import { connector, kernel, signIn, txt, vocabFile } from './probe.ts'

test('a word of an app never deployed is installed by app_deploy, and one it does not declare is said so after', async () => {
  let k = await kernel()
  try {
    let agent = connector(k, (await signIn(k)).cookie)
    await agent.tool('app_new', { slug: 'guestbook', title: 'Guestbook' })
    await agent.tool('app_files', {
      app: 'guestbook',
      path: 'vocab.json',
      op: 'write',
      content: vocabFile({ thanks_contact: { name: txt } }),
    })
    let write = (comp: string) =>
      agent.tool('graph_apply', {
        app: 'guestbook',
        entities: [{ entity: { eid: '$t' }, [comp]: { name: 'Ada' } }],
      })
    await assertRejects(
      () => write('thanks_contact'),
      Error,
      'the app has not been deployed yet, so none of the words its ' +
        'vocab.json declares are installed: app_deploy installs them',
    )
    await agent.tool('app_deploy', { app: 'guestbook' })
    await write('thanks_contact')
    await assertRejects(
      () => write('thanks_card'),
      Error,
      "the app's vocab.json does not declare it",
    )
  } finally {
    await k.stop()
  }
})
