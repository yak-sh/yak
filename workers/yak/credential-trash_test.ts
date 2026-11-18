import { test } from '@yaks/testing'
import { assert, assertEquals, assertRejects } from '@std/assert'
import type { Bundle } from '@yaks/graph'
import { d1 } from '../../packages/d1/testing.ts'
import type { Directory, Space } from './directory.ts'
import type { Env } from './env.ts'
import {
  restoreCredential,
  retainedCredentials,
  trashedCredential,
} from './credential-trash.ts'
import { vaultOf } from './vault.ts'

let setup = async (refused = false) => {
  let env = {
    VAULT: d1(),
    VAULT_KEY: btoa(String.fromCharCode(...new Uint8Array(32).fill(42))),
  } as unknown as Env
  let vault = vaultOf(env)
  let space = { eid: 'space', slug: 'ada' } as Space
  let row = (eid: string, owner = 'space'): Bundle => ({
    entity: { eid },
    connection: { owner, integration: 'Weather', status: 'connected' },
    secret: { name: eid, value: `secret:${eid}` },
  })
  let live = [row('live'), row('moved', 'other')]
  let former = [row('gone'), row('moved'), row('personal', 'person')]
  for (let eid of ['live', 'gone', 'moved', 'personal']) {
    await vault.seal(eid, { handle: `secret:${eid}`, value: `${eid}-old` })
    await vault.drop(eid)
  }
  await vault.seal('live', { handle: 'secret:live', value: 'live-new' })
  let writes: Bundle[] = []
  let dir = {
    read: () => Promise.resolve(live),
    trash: () =>
      Promise.resolve([{
        id: 'deleted',
        at: new Date().toISOString(),
        bundles: former,
      }]),
    apply: ({ entities }: { entities: Bundle[] }) => {
      writes.push(...entities)
      return refused
        ? Promise.reject(new Error('write refused'))
        : Promise.resolve(entities)
    },
  } as unknown as Directory
  return { env, dir, space, vault, writes }
}

let own = await setup(),
  restored = await setup(),
  erased = await setup(),
  failed = await setup(true)

test('credential trash follows current ownership and private archived ownership', async () => {
  let { env, dir, space } = own
  assertEquals(
    (await retainedCredentials(env, dir, space, 'person')).map((c) => c.eid)
      .sort(),
    ['gone', 'live', 'personal'],
  )
  assertEquals(
    (await retainedCredentials(env, dir, space, 'stranger')).map((c) => c.eid)
      .sort(),
    ['gone', 'live'],
  )
})

test('restoring a retained credential uses the graph sealing door and keeps its saved version', async () => {
  let { env, dir, space, vault, writes } = restored
  let one = (await retainedCredentials(env, dir, space, 'person')).find((c) =>
    c.eid == 'gone'
  )!
  await restoreCredential(env, dir, one, { person: 'person', role: 'owner' })
  assertEquals(writes[0].connection, one.row.connection)
  assertEquals(writes[0].secret, {
    ...(one.row.secret as object),
    value: 'gone-old',
  })
  assert((await vault.trash()).some((c) => c.id == one.id))
})

test('permanent credential purge removes only the selected saved version', async () => {
  let { env, dir, space, vault } = erased
  let one = (await retainedCredentials(env, dir, space, 'person')).find((c) =>
    c.eid == 'live'
  )!
  assert(await trashedCredential.find(dir, space, one.id, env, 'person'))
  await trashedCredential.act(env, dir, space, one, {
    person: 'person',
    role: 'owner',
  })
  assert(!(await vault.trash()).some((c) => c.id == one.id))
  assertEquals((await vault.read('live'))?.value, 'live-new')
  assertEquals((await vault.trash()).length, 3)
})

test('a refused restoration keeps its saved credential and current value', async () => {
  let { env, dir, space, vault } = failed
  let one = (await retainedCredentials(env, dir, space, 'person')).find((c) =>
    c.eid == 'live'
  )!
  await assertRejects(
    () => restoreCredential(env, dir, one, { person: 'person', role: 'owner' }),
    Error,
    'write refused',
  )
  assert((await vault.trash()).some((c) => c.id == one.id))
  assertEquals((await vault.read('live'))?.value, 'live-new')
})
