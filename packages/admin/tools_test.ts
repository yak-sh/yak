// The admin verbs at their pure seam: what one refuses before it touches an
// account or the network, and what one answers once it has. The rest of a
// verb is the wire (./api_test.ts) and the account rule (./accounts_test.ts).
import {
  assert,
  assertEquals,
  assertRejects,
  assertStringIncludes,
} from '@std/assert'
import type { Bundle, Comp, ToolCtx } from '@yaks/graph'
import { toolsIn } from '@yaks/vocab/tools'
import { fileVault, secretEid } from '@yaks/secrets'
import { CallError } from '@yaks/tools'
import { ADMIN } from '../../src/bots.ts'
import { Refused, sessionName } from './accounts.ts'
import { runs } from './tools.ts'
import { adminDoc } from './vocab.ts'

// A box: one graph's directory, whose vault sits beside a database nobody
// opens, and whose remembered account is its own, never this machine's.
let box = () => {
  let dir = Deno.makeTempDirSync()
  return { dir, config: { db: `${dir}/yak.db` } }
}

// What the last verb said on stderr: a banner, a note.
let heard: string[] = []

// One verb, asked the way the runner asks it. `read` stands in for the graph's
// letters.
let ask = async (
  tool: string,
  args: Record<string, unknown> = {},
  o: { at?: ReturnType<typeof box>; read?: () => Bundle[] } = {},
) => {
  let at = o.at ?? box()
  let error = console.error
  heard = []
  console.error = (line: string) => heard.push(line)
  Deno.env.set('YAKS_HOME', at.dir)
  try {
    return await runs({ config: at.config })[tool]([], {
      args,
      call: 'c1',
      read: o.read ?? (() => []),
    } as unknown as ToolCtx) as Bundle[]
  } finally {
    console.error = error
    Deno.env.delete('YAKS_HOME')
    if (!o.at) Deno.removeSync(at.dir, { recursive: true })
  }
}

let body = (answer: Bundle[]) =>
  answer.map((b) => (b.content as Comp | undefined)?.body).filter(Boolean)
    .join('\n')

Deno.test('every declared admin verb has an implementation, and no other', () => {
  let declared = toolsIn(adminDoc).map((t) => t.name).sort()
  assertEquals(declared, Object.keys(runs(box())).sort())
  assert(declared.every((n) => n?.startsWith('admin_')), declared.join(' '))
})

// The fee is the PLATFORM's (workers/yak/sell.ts `fees`), so reading it or
// moving it is a named act, and a typo is refused before any account is read.
Deno.test('the fee is a named act, in whole basis points', async () => {
  await assertRejects(
    () => ask('admin_fee', { bps: '250' }),
    Refused,
    '--owner',
  )
  await assertRejects(() => ask('admin_fee'), Refused)
  for (let no of ['2.5', '-5', 'lots', '2,50']) {
    await assertRejects(
      () => ask('admin_fee', { bps: no, owner: true }),
      CallError,
      'basis points',
    )
  }
})

// Signing in AS somebody is the same named act, refused before a letter goes
// anywhere; a word that is not an address is the bearer `yak login` keeps.
Deno.test('login refuses what the argv did not name', async () => {
  let refused = [
    [{ address: 'you@example.com' }, '--owner'],
    [{ address: ADMIN }, '--admin'],
    [{ address: 'not-an-address' }, 'yak login <token>'],
  ] as const
  for (let [args, why] of refused) {
    await assertRejects(() => ask('admin_login', args), Refused, why)
  }
})

let PLATFORM = [
  'admin_deploys',
  'admin_errors',
  'admin_tail',
  'admin_rollback',
  'admin_revert',
]

Deno.test('a platform operation names whose act it is before it runs anything', async () => {
  for (let name of PLATFORM) {
    await assertRejects(() => ask(name), Refused, '--owner')
    await assertRejects(() => ask(name, { owner: false }), Refused, '--admin')
  }
  await assertRejects(
    () => ask('admin_revert', { owner: true, sha: 'HEAD' }),
    CallError,
    '<sha>',
  )
  await assertRejects(
    () => ask('admin_errors', { owner: true, since: 'soon' }),
    CallError,
    '--since',
  )
})

// The same act, named by an agent instead of by Jeff (D-35373): it gets past
// the guard, and the banner says it is the admin's.
Deno.test('an agent names a platform operation with --admin', async () => {
  await assertRejects(
    () => ask('admin_revert', { admin: true, sha: 'HEAD' }),
    CallError,
    '<sha>',
  )
  assertStringIncludes(heard.join('\n'), `ADMIN ACCOUNT — ${ADMIN}`)
})

// One test account, kept in the vault beside the graph.
let kept = (dir: string, address: string, value: string) => {
  let name = sessionName(address)
  fileVault(`${dir}/secrets`).seal(secretEid(name), {
    name,
    handle: 'h',
    value,
  })
}

// Every request this process makes, answered by `reply`.
let answering = async <T>(
  reply: (url: string) => Response,
  run: (hit: string[]) => Promise<T>,
): Promise<T> => {
  let hit: string[] = []
  let real = globalThis.fetch
  globalThis.fetch = ((url: string | URL | Request) => {
    hit.push(String(url))
    return Promise.resolve(reply(String(url)))
  }) as typeof fetch
  try {
    return await run(hit)
  } finally {
    globalThis.fetch = real
  }
}

// `whoami` asks ONCE (T-35384). The listing carries the caller's role in each
// space (workers/yak tools.ts `app_list`), so what is asserted here is the
// shape of the asking: one /mcp call and no per-space door, however many
// spaces come back.
let listing = (spaces: string[]) =>
  new Response(JSON.stringify({
    jsonrpc: '2.0',
    id: 1,
    result: { content: [{ type: 'text', text: spaces.join('\n') }] },
  }))

let whoami = (spaces: string[]) => {
  let at = box()
  kept(at.dir, 'ana@bot.yak.sh', 'ana.token')
  return answering(() => listing(spaces), async (hit) => {
    try {
      return { hit, said: body(await ask('admin_whoami', {}, { at })) }
    } finally {
      Deno.removeSync(at.dir, { recursive: true })
    }
  })
}

let space = (slug: string, role: string, apps: number) =>
  [
    `${slug} — https://${slug}.yaks.app/ — you are ${
      role == 'owner' ? 'the owner' : `a ${role}`
    }`,
    ...Array.from({ length: apps }, (_, i) => `- a${i} (a${i}) v1`),
  ].join('\n')

Deno.test('whoami asks the listing once and no space its own role', async () => {
  let { hit, said } = await whoami([
    space('ana', 'owner', 3),
    space('mom', 'editor', 1),
    space('empty', 'viewer', 0),
  ])
  assertEquals(hit, ['https://yaks.app/mcp'])
  for (let want of ['ana', 'owner', 'mom', 'editor', 'empty', 'viewer']) {
    assertStringIncludes(said, want)
  }
})

Deno.test('whoami with no spaces still asks once', async () => {
  let { hit, said } = await whoami([])
  assertEquals(hit, ['https://yaks.app/mcp'])
  assertStringIncludes(said, 'spaces    (none)')
})

// A throwaway's code is a letter in this graph, and the session it buys is
// answered sealed under the account, beside the words: the write that records
// the call keeps the session, and nothing else does.
Deno.test('a throwaway signs in with the code from the graph', async () => {
  let letter = {
    entity: { eid: 'l1' },
    doc: { title: '123456 is your yaks.app code' },
    mail: {
      to: 'cook@bot.yak.sh',
      at: new Date(Date.now() + 1000).toISOString(),
    },
  }
  let answer = await answering(
    (url) =>
      url.endsWith('/login/code')
        ? new Response(null, {
          status: 302,
          headers: { 'set-cookie': 'yak_session=cook.token; Path=/' },
        })
        : new Response('card'),
    () => ask('admin_throwaway', { name: 'cook' }, { read: () => [letter] }),
  )
  assertEquals(answer.find((b) => b.secret)?.secret, {
    name: sessionName('cook@bot.yak.sh'),
    value: 'cook.token',
  })
  assertEquals(body(answer), 'signed in as cook@bot.yak.sh — current')
})
