// The one-time backfill writes back the snapshot each deploy kept.
import { directory, fetch as directoryFetch } from './directory.ts'
import { bound, type Env } from './env.ts'
import { r2RawObjects } from './lib/objects.ts'
import { backfill } from './backfill.ts'
import { equal, test } from '@yaks/testing'
import { connector, fresh, signIn, txt, vocabFile } from './probe.ts'

test('a backfill rewrites each deleted snapshot as its deploy kept it', async () => {
  let env: Env
  let k = await fresh({}, (e) => env = e)
  try {
    let agent = connector(k, (await signIn(k)).cookie)
    let space = ''
    let deploy = async (app: string, content: string, made = false) => {
      if (!made) {
        let said = await agent.tool('app_new', { slug: app, title: app })
        space ||= /https:\/\/([a-z0-9-]+)\.yaks\.app/.exec(said)![1]
      }
      await agent.tool('app_files', {
        space,
        app,
        files: [{ path: 'vocab.json', content }],
      })
      await agent.tool('app_deploy', { space, app })
    }
    await deploy(
      'recipes',
      vocabFile({ recipe: { name: txt } }, {
        soups: { description: 'List soups', query: '.recipe' },
      }),
    )
    await deploy(
      'chores',
      vocabFile({ chore: { name: txt }, recipe: { name: txt, note: txt } }),
    )
    await deploy('garden', vocabFile({ plant: { name: txt } }))
    await agent.tool('app_delete', { space, app: 'garden' })
    // Words the Store let go when their columns held nothing, which only it
    // knows: the reconstruction from files keeps them.
    await deploy('arena', vocabFile({ fight: { notes: txt }, memento: {} }))
    await deploy('arena', vocabFile({ fight: { dealt: txt } }), true)
    let blobs = r2RawObjects(env!.BLOBS)
    let prefix = `${space}/.declarations/`
    let snapshots = async () =>
      Object.fromEntries(
        await Promise.all(
          (await blobs.list(prefix)).map(async (key) => [
            key,
            JSON.parse(new TextDecoder().decode((await blobs.read(key))!)),
          ]),
        ),
      )
    // Six: chores grew recipe, a release of recipes' own declaration, and
    // arena released twice.
    let kept = await snapshots()
    equal(Object.keys(kept).length, 6)
    for (let key of Object.keys(kept)) await blobs.delete(key)
    let dir = directory(bound(env!.DIRECTORY, directoryFetch, env!), true)
    let here = (await dir.space(space))!
    let rehearsed = await backfill(env!, here, true)
    equal(
      rehearsed.map((r) => [
        r.app,
        r.had,
        r.wrote,
        typeof r.store == 'string' ? r.store : Object.keys(r.store!.vocab),
      ]),
      [
        ['recipes', false, false, 'same'],
        ['chores', false, false, 'same'],
        ['garden', false, false, 'unread'],
        ['arena', false, false, ['fight', 'memento']],
      ],
    )
    equal(await snapshots(), {})
    equal((await backfill(env!, here, false)).filter((r) => r.wrote).length, 4)
    let after = await snapshots()
    equal(Object.keys(after).length, 4)
    equal(
      after,
      Object.fromEntries(Object.keys(after).map((k) => [k, kept[k]])),
    )
    equal((await backfill(env!, here, false)).every((r) => r.had), true)
  } finally {
    await k.stop()
  }
})
