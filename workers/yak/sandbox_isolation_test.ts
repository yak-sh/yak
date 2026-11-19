// A leftover process must never see a different member's command environment.
import { whole } from '@yaks/query'
import { equal, match, test } from '@yaks/testing'
import { kv, platform, sandboxes } from './testing.ts'
import { directoryOf, type Space } from './directory.ts'
import { held, ledger, mint } from './grants.ts'
import { type Bundle, graph } from '@yaks/graph'
import { ram } from '@yaks/ram'
import { loadVocab } from '@yaks/vocab'
import { kernelDoc } from '@yaks/kernel'
import { sandboxDoc } from '@yaks/sandbox/vocab'
import {
  destroyed,
  destroyedAll,
  lent,
  spending,
  workbench,
} from './sandbox.ts'
import { cloudflareProvider, named } from '@yaks/sandbox/cloudflare'

let space = { eid: 'isolation', slug: 'isolation' } as Space
let secret = 'sandbox isolation probe'

let containers = () => {
  let tokens = new Map<string, string>()
  let calls: string[] = []
  let box = sandboxes((command) => ({
    running: command == 'leftover-process',
  }))
  return {
    box,
    tokens,
    calls,
    WORKBENCH: {
      idFromName: (name: string) => name,
      get: (id: unknown) => {
        let name = String(id)
        calls.push(name)
        let stub = box.WORKBENCH.get(name)
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

// The directory the grants are kept in, and the person the owner's grant is
// for.
let door = platform(secret)
let dir = directoryOf(door.env.STORE)
let OWNER = crypto.randomUUID()
await dir.stamp({ entities: [{ entity: { eid: OWNER }, person: {} }] })

let isolated = async () => {
  let oauth = kv(), book = ledger(oauth, dir)!
  let { grant: owned } = await mint(secret, book, {
    person: OWNER,
    space,
  })
  let box = containers()
  let env = {
    WORKBENCH: box.WORKBENCH,
    OAUTH_KV: oauth,
    STORE: door.env.STORE,
    SESSION_SECRET: secret,
  }
  let [theirs, mine] = [named(space.eid, 'editor'), named(space.eid, 'owner')]
  let provider = cloudflareProvider(box.WORKBENCH, { ephemeral: true })
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
    person: OWNER,
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
  let env = { WORKBENCH: box.WORKBENCH }
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

// Who the space lent a sandbox to is in the store its `lent` rows are kept in,
// and a member who has since left is among them.
let lending = async () => {
  let vocab = loadVocab([kernelDoc, sandboxDoc])
  let store = graph({ storage: ram(vocab), vocab })
  await store.apply(
    [space.eid, 'owner', 'former-member'].map((eid) => ({
      entity: { eid },
      opened: {},
    })),
  )
  return {
    query: async (line: string) => await store.read(whole(line)),
    apply: async (bundles: Bundle[]) => await store.apply(bundles),
  }
}

test('erasing a space destroys every sandbox it lent, a former member’s too', async () => {
  let box = containers()
  let env = { WORKBENCH: box.WORKBENCH, META: await lending() }
  for (let person of ['owner', 'former-member']) {
    await workbench(env, { ...space, tier: 'plus' }, person, spending())
  }
  equal(box.box.alive.size, 2)
  await destroyedAll(env, space)
  equal([...box.box.alive], [])
})
