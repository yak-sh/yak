// A leftover process must never see a different member's command environment.
import { equal, match, test } from '@yaks/testing'
import { kv, sandboxes, workspaces } from './testing.ts'
import type { Space } from './directory.ts'
import { held, ledger, mint } from './grants.ts'
import {
  destroyed,
  destroyedAll,
  lent,
  named,
  shared,
  spending,
  workbench,
} from './sandbox.ts'
import { cloudflareProvider } from '@yaks/sandbox/cloudflare'

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

let isolated = async () => {
  let oauth = kv(), book = ledger(oauth)!
  let { grant: owned } = await mint(secret, book, {
    person: 'owner',
    space: space.slug,
  })
  let box = containers()
  let env = { SANDBOX: box.SANDBOX, OAUTH_KV: oauth, SESSION_SECRET: secret }
  let [theirs, mine] = [named(space, 'editor'), named(space, 'owner')]
  let provider = cloudflareProvider(box.SANDBOX, { legacyRecreation: true })
  let editor = await provider.connect({ id: theirs })
  let leftover = await editor.workspace.start('leftover-process')
  let owner = await provider.connect({ id: mine })
  await book.wear(mine, owned)
  return { box, env, book, theirs, mine, editor, leftover, owner }
}
let memberIsolation = await isolated()
let endingIsolation = await isolated()

test('a member cannot read another member’s grant through leftover sandbox code', async () => {
  let { env, mine, book } = memberIsolation
  // The placeholder the owner's command holds is swapped for the owner's
  // token, as the key it was sealed under reads it, and only in the owner's
  // container.
  let [lend] = await lent(env, mine)
  match(await held(lend.value, secret, book), {
    person: 'owner',
    space: space.slug,
  })
})
test('a different member receives no owner grant', async () => {
  let { env, theirs } = memberIsolation
  equal(await lent(env, theirs), [])
})
test('a member’s leftover process is absent from the owner’s sandbox', async () => {
  let { owner, leftover } = memberIsolation
  equal(await owner.workspace.look(leftover), null)
})
test('ending a build leaves another member’s running work alone', async () => {
  let { env, editor, leftover } = endingIsolation
  await destroyed(env, space, 'owner')
  equal((await editor.workspace.look(leftover))?.exit, undefined)
})

test('a personal sandbox keeps its files and process across calls and a space rename', async () => {
  let box = containers()
  let env = { SANDBOX: box.SANDBOX, WORKSPACES: workspaces(box.SANDBOX) }
  let first = await workbench(env, space, 'owner', spending())
  await first.workspace.write('/workspace/artifact', 'compiled')
  let process = await first.workspace.start('leftover-process')
  await workbench(env, space, 'editor', spending())
  let next = await workbench(
    env,
    { ...space, slug: 'renamed' },
    'owner',
    spending(),
  )
  equal(await next.workspace.read('/workspace/artifact'), 'compiled')
  equal((await next.workspace.look(process))?.exit, undefined)
})

let legacyFixture = async () => {
  let box = containers()
  let env = {
    SANDBOX: box.SANDBOX,
    WORKSPACES: workspaces(box.SANDBOX),
    OAUTH_KV: kv(),
    SESSION_SECRET: secret,
  }
  let old = cloudflareProvider(box.SANDBOX, { legacyRecreation: true })
  let ref = { id: shared(space) }
  let sharedBox = await old.connect(ref)
  await sharedBox.workspace.write('/workspace/artifact', 'compiled')
  let process = await sharedBox.workspace.start('leftover-process')
  return { box, env, old, ref, process }
}
let legacyIsolation = await legacyFixture()
let continuedLegacy = await legacyFixture()
let continuedOwner = await workbench(
  continuedLegacy.env,
  space,
  'owner',
  spending(),
)
await continuedOwner.workspace.start('owner-command')

test('a legacy compile and workspace survive without giving its leftover code fresh credentials', async () => {
  let { env, old, ref, process } = legacyIsolation
  let owner = await workbench(env, space, 'owner', spending())
  await owner.workspace.start('owner-command')
  equal(await owner.workspace.read('/workspace/artifact'), 'compiled')
  equal((await owner.workspace.look(process))?.exit, undefined)
  equal((await old.exec(ref, 'read-owner-environment')).stdout, 'absent')
})

test('a migrated personal workspace keeps later edits and destroys every sandbox', async () => {
  let { box, env, ref } = continuedLegacy, owner = continuedOwner
  await owner.workspace.write('/workspace/artifact', 'new work')
  let next = await workbench(env, space, 'owner', spending())
  equal(await next.workspace.read('/workspace/artifact'), 'new work')
  box.calls.length = 0
  equal(await next.workspace.look('unknown-process'), null)
  equal(box.calls.includes(ref.id), false)
  await workbench(env, space, 'former-member', spending())
  await destroyedAll(env, space)
  equal([...box.box.alive], [])
})
