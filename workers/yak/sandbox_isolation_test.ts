// A leftover process must never see a different member's command environment.
import { equal, ok, test } from '@yaks/testing'
import { kv, sandboxes, workspaces } from './testing.ts'
import type { Space } from './directory.ts'
import { GRANT, ledger } from './grants.ts'
import {
  destroyed,
  destroyedAll,
  lent,
  named,
  shared,
  spending,
  workbench,
} from './sandbox.ts'
import { cloudflareProvider } from '@yaks/machine/cloudflare'

let space = { eid: 'isolation', slug: 'isolation' } as Space
let secret = 'sandbox isolation probe'

let containers = () => {
  let tokens = new Map<string, string>()
  let calls: string[] = []
  let box = sandboxes((command) => ({ running: command == 'leftover-process' }))
  return {
    box,
    tokens,
    calls,
    SANDBOX: {
      idFromName: (name: string) => name,
      get: (id: unknown) => {
        let name = String(id)
        calls.push(name)
        let stub = box.SANDBOX.get(name)
        return {
          ...stub,
          startProcess: (
            command: string,
            opts?: { env?: Record<string, string> },
          ) => {
            if (command == 'owner-command') {
              tokens.set(name, opts!.env!.YAKS_TOKEN)
            }
            return stub.startProcess(command, opts)
          },
          exec: (command: string, opts?: { env?: Record<string, string> }) =>
            command == 'read-owner-environment'
              ? Promise.resolve({
                stdout: tokens.get(name) ?? 'absent',
                stderr: '',
                exitCode: 0,
              })
              : stub.exec(command, opts),
        }
      },
    },
  }
}

test('a personal sandbox keeps its files and process across calls and a space rename', async () => {
  let box = containers()
  let env = { SANDBOX: box.SANDBOX, WORKSPACES: workspaces(box.SANDBOX) }
  let first = await workbench(env, space, 'owner', spending())
  await first.machine.write('/workspace/artifact', 'compiled')
  let process = await first.machine.start('leftover-process')
  await workbench(env, space, 'editor', spending())
  let next = await workbench(
    env,
    { ...space, slug: 'renamed' },
    'owner',
    spending(),
  )
  equal(await next.machine.read('/workspace/artifact'), 'compiled')
  equal((await next.machine.look(process))?.exit, undefined)
})

test('a member cannot read another member’s grant through leftover sandbox code', async () => {
  let box = containers()
  let env = {
    SANDBOX: box.SANDBOX,
    OAUTH_KV: kv(),
    SESSION_SECRET: secret,
  }
  let [theirs, mine] = [named(space, 'editor'), named(space, 'owner')]
  let provider = cloudflareProvider(box.SANDBOX)
  let editor = await provider.wake({ id: theirs })
  let leftover = await editor.machine.start('leftover-process')
  let owner = await provider.wake({ id: mine })
  // The placeholder the owner's command holds is swapped for its token only
  // in the owner's container.
  let book = ledger(env.OAUTH_KV)!
  let grant = { id: 'g1', person: 'owner', space: space.slug, exp: 2 ** 31 }
  await book.keep(grant)
  await book.wear(mine, grant)
  let [lend] = await lent(env, mine)
  ok(lend.value.startsWith(GRANT), 'the owner container is lent its grant')
  equal(await lent(env, theirs), [])
  equal(await owner.machine.look(leftover), null)

  // A build ending must leave another member's running work alone.
  await destroyed(env, space, 'owner')
  equal((await editor.machine.look(leftover))?.exit, undefined)
})

test('a legacy compile and workspace survive without giving its leftover code fresh credentials', async () => {
  let box = containers()
  let env = {
    SANDBOX: box.SANDBOX,
    WORKSPACES: workspaces(box.SANDBOX),
    OAUTH_KV: kv(),
    SESSION_SECRET: secret,
  }
  let old = cloudflareProvider(box.SANDBOX)
  let ref = { id: shared(space) }
  let sharedBox = await old.wake(ref)
  await sharedBox.machine.write('/workspace/artifact', 'compiled')
  let process = await sharedBox.machine.start('leftover-process')
  let owner = await workbench(env, space, 'owner', spending())
  await owner.machine.start('owner-command')
  equal(await owner.machine.read('/workspace/artifact'), 'compiled')
  equal((await owner.machine.look(process))?.exit, undefined)
  equal((await old.exec(ref, 'read-owner-environment')).stdout, 'absent')
  await owner.machine.write('/workspace/artifact', 'new work')
  let next = await workbench(env, space, 'owner', spending())
  equal(await next.machine.read('/workspace/artifact'), 'new work')
  box.calls.length = 0
  equal(await next.machine.look('unknown-process'), null)
  equal(box.calls.includes(ref.id), false)
  await workbench(env, space, 'former-member', spending())
  await destroyedAll(env, space)
  equal([...box.box.alive], [])
})
