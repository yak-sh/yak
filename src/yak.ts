// The `yak` on an owner's box: the published command (@yaks/cli) plus one
// plugin only a checkout can carry. What used to be a CLI of its own (T-33385)
// is now a table of verbs contributed at boot, so the account verbs and the
// platform's tools live under one help and one command line.
//
//   yak test                    mint a throwaway @bot.yak.sh account, signed in
//   yak whoami                  the account, its spaces, and its role in each
//   yak link                    a standing sign-in link for that account
//   yak app_list                any connector tool, through the bearer
//   yak query jeff/recipes .doc!    an app's store, through the filter grammar
//
// The one rule this plugin is shaped around: A TEST ACCOUNT IS THE DEFAULT AND
// EVERY OTHER ACCOUNT IS A NAMED ACT. No chain of defaults arrives at one —
// reaching the owner's takes `--owner` and reaching the platform's admin takes
// `--admin` on that command line, and every command that runs as either wears
// a banner on stderr (yaks_account.ts). `--admin` is what an agent uses for a
// platform act, so the act is recorded as the admin and not as Jeff (D-35373).
//
// It sits FIRST in the plugin list, so `login` and `logout` here shadow the
// ones the package ships. Nothing is lost by that: this box keeps two
// credentials, an account's session and the connector's bearer, and each verb
// tells them apart by what it is handed — an address signs an account in, a
// word that is not an address is a bearer, and `logout` with no account
// forgets the bearer.
//
// Sessions are secrets in the graph this box's `yak` opens (yaks_account.ts),
// so they are written through it and read back out of the vault beside it. It
// stays HERE rather than in the package because a bot's sign-in code is read
// out of the tasks graph (yaks_api.ts `codeFor`), which is this repo and
// nothing a `deno install` off jsr could reach.
import { fileURLToPath } from 'node:url'
import {
  type Command,
  type Ctx,
  forgetToken,
  main,
  read,
  saveToken,
  Usage,
} from '@yaks/cli'
import type { Bundle } from '@yaks/graph'
import { sealed, unsealed, vaultOf } from '@yaks/secrets'
import { ADMIN, BOT, isTestAddress } from './bots.ts'
import {
  type Account,
  accountsIn,
  banner,
  choose,
  current,
  isAdmin,
  isTest,
  named,
  pick,
  Refused,
  render,
  sessionName,
  throwaway,
  usable,
} from './yaks_account.ts'
import {
  askCode,
  claimsOf,
  close,
  codeFor,
  doomedIn,
  feeNow,
  linkFor,
  renewing,
  rpc,
  saidBy,
  setFee,
  spendCode,
  storeQuery,
  unlink,
  zone,
} from './yaks_api.ts'
import { watching } from './timing.ts'
import { deploys, rollback, table } from './yak_deploys.ts'
import { errors, tail } from './yak_logs.ts'
import { revert } from './yak_revert.ts'

// What a tool was told: the bag its own input schema produced (@yaks/cli
// `argsFor`). Only three of those words are this plugin's rather than the
// tool's — who to act as, and whose act it is — so that is all `Whose` names.
type Args = Record<string, unknown>
type Whose = { as?: string; owner?: boolean; admin?: boolean }

let word = (a: Args, name: string): string | undefined =>
  typeof a[name] == 'string' ? a[name] as string : undefined

let whose = (a: Args): Whose => ({
  as: word(a, 'as'),
  owner: a.owner === true,
  admin: a.admin === true,
})

let json = (v: unknown) => JSON.stringify(v, null, 2)

// The accounts this box is signed in as: the sessions the vault beside this
// box's graph keeps, read fresh each command so two shells never fight over a
// cached copy.
let vault = (c: Ctx) => {
  if (!c.config) {
    throw new Refused(
      'sessions are kept in this box’s graph, and no config names one ' +
        '(--config, $YAK_CONFIG, or ~/.yak/yak.json)',
    )
  }
  return vaultOf(read(c.config))
}

let accounts = (c: Ctx) => accountsIn(vault(c))

// A change to the sessions, written through the graph's own `graph_apply` —
// the same door `yak apply` uses — which seals each session into the vault
// and leaves the graph a sentinel (@yaks/secrets). A refusal is the tool's
// own words.
let wrote = async (c: Ctx, bundles: Bundle[]) => {
  vault(c)
  let tool = (await c.all()).find((t) => t.name == 'graph_apply')
  if (!tool) throw new Refused(`${c.config} has no graph to keep a session in`)
  let said: string[] = []
  let code = await tool.run({ change: bundles }, {
    ...c,
    out: (line) => said.push(line),
  })
  if (code) throw new Refused(said.join('\n'))
}

let kept = (c: Ctx, address: string, session: string) =>
  wrote(c, [sealed(sessionName(address), session)])

// A session the platform renewed, written back under the same account
// (yaks_api.ts `renewing`, workers/yak/session.ts `slid`): the platform
// re-mints a cookie past half its life, and a box that kept the old value
// would sign out ninety days after its first sign-in however often it called.
// The write is waited for before the command ends (`settled` below), so it
// never races the graph closing.
let renewals: Promise<unknown>[] = []

// WHO this command runs as, and the mark it wears when the answer is somebody
// else's own account. Every verb that touches the platform goes through here.
let acting = (s: Whose, c: Ctx): Account => {
  let at = pick(accounts(c), {
    as: s.as,
    owner: s.owner === true,
    admin: s.admin === true,
    current: current(),
  })
  if (!isTest(at)) c.note(banner(at))
  renewing((fresh) => renewals.push(kept(c, at.address, fresh)))
  return at
}

// Sign in end to end. A `@bot.yak.sh` code comes back through the tasks graph
// (the fleet sweep files the letter); anyone else's is in their own mail, so
// it is asked for rather than guessed at.
let signIn = async (address: string, c: Ctx, given?: string) => {
  let since = Date.now()
  await askCode(address)
  let bot = address.endsWith(BOT)
  let code = given ??
    (bot ? await waited(address, since, c.note) : await asked(address, c.note))
  let session = await spendCode(address, code)
  await kept(c, address, session)
  // Only a throwaway is ever remembered as the default (yaks_account.ts) — the
  // admin wears a bot address and is still not one.
  if (isTestAddress(address)) choose(address)
  return session
}

let waited = (address: string, since: number, note: (l: string) => void) => {
  note(`waiting for the code to reach the graph for ${address}…`)
  return codeFor(address, since)
}

let asked = async (address: string, note: (l: string) => void) => {
  note(`a code was mailed to ${address}. paste it here:`)
  let buf = new Uint8Array(64)
  let n = await Deno.stdin.read(buf)
  let word = new TextDecoder().decode(buf.subarray(0, n ?? 0)).trim()
  if (!/^\d{6}$/.test(word)) throw new Error(`not a six-digit code: ${word}`)
  return word
}

// What this account HAS, as the connector says it: one `app_list`, whose
// answer is the listing a person reads — every space, the caller's own role in
// each (the DIRECTORY's fact, read once, T-35384) and the apps under it. It is
// the tool's own sentence rather than a shape this end re-formats: a tool
// answers bundles now and its words are the prose they carry, so there is
// nothing here to spell a second time.
let listingOf = async (at: Account): Promise<string> =>
  saidBy(
    await rpc(at.session)('tools/call', {
      name: 'app_list',
      arguments: {},
    }),
  ).trim()

// One account, named the way `--as` names one.
let one = (all: Account[], want: string): Account => {
  let hit = named(all, want)
  if (hit.length != 1) throw new Refused(`${want} names ${hit.length} accounts`)
  return hit[0]
}

// Infrastructure belongs to the platform owner. Its credentials are the
// box's Wrangler/GitHub logins, independent of a yaks.app account session.
let root = fileURLToPath(new URL('../', import.meta.url)).replace(/\/$/, '')
// The act is named either way; the flag says WHOSE it is — an agent's
// (`--admin`) or Jeff's (`--owner`) — and the banner says that out loud. The
// credentials used below are this box's Cloudflare/GitHub login for both,
// until the admin path has a token of its own (T-35375).
let platform = (a: Args, note: (line: string) => void): void => {
  if (a.admin !== true && a.owner !== true) {
    throw new Refused(
      'yaks.app operations are a named act: add --admin (an agent) or ' +
        '--owner (Jeff)',
    )
  }
  note(
    a.admin === true
      ? banner({ name: 'admin', address: ADMIN, session: '' })
      : banner({
        name: 'platform',
        address: 'yaks.app (this box’s Cloudflare/GitHub login)',
        session: '',
      }),
  )
}

// The three words every tool here shares: who to act as, and whose act it is.
let NAMED = {
  as: { type: 'string', description: 'act as this account' },
  admin: { type: 'boolean', description: 'as the platform’s admin' },
  owner: { type: 'boolean', description: 'as Jeff' },
} as const

let takes = (props: Record<string, unknown> = {}, required?: string[]) => ({
  type: 'object',
  additionalProperties: false,
  ...(required ? { required } : {}),
  properties: { ...NAMED, ...props },
})

let said: Command[] = [
  {
    name: 'deploys',
    title: 'yaks.app versions, commits, live times, and data boundaries',
    description:
      'Recent uploads and deployments; ~ marks a commit inferred by time. ' +
      'Migration boundaries survive code rollbacks. Unknown history refuses ' +
      'rollback.',
    inputSchema: takes(),
    readOnly: true,
    run: async (args, c) => {
      platform(args, c.note)
      c.out(table(await deploys(root)))
      return 0
    },
  },
  {
    name: 'errors',
    title: 'yaks.app exceptions and error logs grouped by signature',
    description:
      'Count, first/last seen, entrypoint and version for each error ' +
      'signature. Uses Workers Logs when available; otherwise observes the ' +
      'NEXT window by tail.',
    inputSchema: takes({
      since: { type: 'string', description: 'how far back (default 10m)' },
    }),
    readOnly: true,
    run: async (args, c) => {
      platform(args, c.note)
      return await errors(root, word(args, 'since') ?? '10m', c.out, c.note)
    },
  },
  {
    name: 'tail',
    title: 'yaks.app live events: outcome, entrypoint, request and errors',
    description: 'One line per live event. Ctrl-C stops the tail.',
    inputSchema: takes(),
    readOnly: true,
    run: async (args, c) => {
      platform(args, c.note)
      return await tail(root, c.out, c.note)
    },
  },
  {
    name: 'rollback',
    title: 'emergency rollback for a broken build path',
    description:
      'Only for a broken build path. Code corrections use yak revert: main ' +
      'deploys every push. Defaults to the prior deployed version; refuses ' +
      'data boundaries and uncertain commits, then probes the public doors ' +
      'after a rollback.',
    inputSchema: takes({
      version: { type: 'string', description: 'which version to serve' },
    }),
    options: { positional: ['version'] },
    destructive: true,
    run: async (args, c) => {
      platform(args, c.note)
      c.note(
        'Cloudflare rollback is for a broken build path. Code corrections belong on main: yak revert <sha> --admin.',
      )
      return await rollback(root, word(args, 'version'), c.out)
    },
  },
  {
    name: 'revert',
    title: 'revert on fresh main, gate, land/push, and time the live deploy',
    description:
      'Reverts a main commit in a fresh worktree, runs deno task check, then ' +
      'uses task land to publish main. Re-gates after a rebase and waits up ' +
      'to 20m for an annotated version to serve the revert. Failed worktrees ' +
      'are kept. Workers Builds deploy command: ../../bin/build-yak deploy',
    // The sha's SHAPE is the check, below: a word that is not one is the
    // usage error, and no word at all is the same usage error.
    inputSchema: takes({
      sha: { type: 'string', description: 'the main commit to revert' },
    }),
    options: { positional: ['sha'] },
    destructive: true,
    run: async (args, c) => {
      platform(args, c.note)
      let sha = word(args, 'sha') ?? ''
      if (!/^[a-f\d]{7,40}$/i.test(sha)) {
        throw new Usage('yak revert <sha> --admin|--owner')
      }
      return await revert(root, sha, c.out, c.note)
    },
  },
  {
    name: 'whoami',
    title: 'the account this box acts as, its spaces, and its role in each',
    description:
      'The account, the kind it is, the person its session names, and every ' +
      'space it can reach with its role in each.',
    inputSchema: takes(),
    readOnly: true,
    run: async (args, c) => {
      let at = acting(whose(args), c)
      let claims = claimsOf(at.session)
      c.out(`account   ${at.address}`)
      c.out(
        `kind      ${
          isAdmin(at)
            ? 'ADMIN — the platform’s own'
            : isTest(at)
            ? 'test — a throwaway'
            : 'OWNER — somebody’s own'
        }`,
      )
      c.out(`person    ${claims?.person ?? '(session unreadable)'}`)
      c.out(
        `session   ${
          claims
            ? `good until ${new Date(claims.exp * 1000).toISOString()}`
            : '(unreadable)'
        }`,
      )
      c.out(`zone      ${zone()}`)
      let listing = await listingOf(at)
      if (!listing) {
        c.out('spaces    (none)')
        return 0
      }
      c.out('spaces')
      for (let line of listing.split('\n')) c.out(`  ${line}`)
      return 0
    },
  },

  {
    name: 'accounts',
    title: 'every account signed in on this box (never their sessions)',
    description: 'Every account this box holds a session for, current first.',
    inputSchema: takes(),
    readOnly: true,
    run: (_args, c) => {
      c.out(render(accounts(c), current()))
      return 0
    },
  },

  {
    name: 'test',
    title: 'mint a throwaway <name>@bot.yak.sh account, signed in and current',
    description:
      'A throwaway account, signed in and made current.\n\n  yak test\n' +
      '  yak test cookbook',
    inputSchema: takes({
      name: { type: 'string', description: 'the local part to mint' },
    }),
    options: { positional: ['name'] },
    run: async (args, c) => {
      let name = word(args, 'name')
      let address = name ? `${name}@bot.yak.sh` : throwaway()
      await signIn(address, c)
      c.out(`signed in as ${address} — current`)
      return 0
    },
  },

  {
    name: 'login',
    title: 'sign in as an address — or keep a bearer for this host',
    description:
      'An address signs this box in as that account: a bot code is read from ' +
      'the graph, anyone else’s is typed. A word that is not an address is a ' +
      'connector bearer, kept for this host.\n\n' +
      '  yak login probe@bot.yak.sh\n  yak login you@example.com --owner\n' +
      `  yak login ${ADMIN} --admin`,
    inputSchema: takes({
      word: { type: 'string', description: 'an address, or a bearer token' },
      code: { type: 'string', description: 'the six-digit code' },
    }, ['word']),
    options: { positional: ['word'] },
    run: async (args, c) => {
      let given = String(args.word)
      // A bearer is the package's own verb, and this one still answers to it:
      // one word, one act — sign this box in with whatever it was handed.
      if (!given.includes('@')) {
        c.out(`bearer for ${c.host} kept in ${saveToken(c.host, given)}`)
        return 0
      }
      let address = given.trim().toLowerCase()
      if (address == ADMIN && args.admin !== true) {
        throw new Refused(
          `${address} is the platform’s admin. Signing in as it is a named ` +
            'act: add --admin. A throwaway is `yak test`.',
        )
      }
      if (
        !isTestAddress(address) && address != ADMIN && args.owner !== true
      ) {
        throw new Refused(
          `${address} is not a test address. Signing in as somebody is a ` +
            'named act: add --owner. A throwaway is `yak test`.',
        )
      }
      await signIn(address, c, word(args, 'code'))
      c.out(`signed in as ${address}`)
      return 0
    },
  },

  {
    name: 'use',
    title: 'remember a TEST account as the default; an owner one is refused',
    description: 'The account every later command runs as, unless it says.',
    inputSchema: takes({
      account: { type: 'string', description: 'which account' },
    }, ['account']),
    options: { positional: ['account'] },
    run: (args, c) => {
      let at = one(accounts(c), String(args.account))
      choose(usable(at).address)
      c.out(`current: ${at.address}`)
      return 0
    },
  },

  {
    name: 'logout',
    title: 'forget one account’s session — or this host’s bearer',
    description:
      'Named, it forgets that account’s session; bare, it forgets the bearer ' +
      'this host keeps.',
    inputSchema: takes({
      account: { type: 'string', description: 'which account' },
    }),
    options: { positional: ['account'] },
    destructive: true,
    run: async (args, c) => {
      let want = word(args, 'account')
      // No account named is the package's own act: forget the bearer.
      if (!want) {
        forgetToken(c.host)
        c.out(`forgot the bearer for ${c.host}`)
        return 0
      }
      let at = one(accounts(c), want)
      await wrote(c, [unsealed(sessionName(at.address))])
      if (current() == at.address) choose(null)
      c.out(`forgot ${at.address}`)
      return 0
    },
  },

  {
    name: 'link',
    title: 'a standing sign-in link for this account',
    description: 'One URL that signs its holder in until it expires.\n\n' +
      '  yak test reviewer && yak link --days=90\n  yak link --revoke=3f2a',
    inputSchema: takes({
      days: { type: 'number', description: 'how long it stands' },
      revoke: { type: 'string', description: 'a link id to revoke instead' },
    }),
    run: async (args, c) => {
      let at = acting(whose(args), c)
      let gone = word(args, 'revoke')
      if (gone) {
        let ids = await unlink(at.session, gone)
        c.out(
          ids.length
            ? `revoked ${ids.join(' ')}`
            : `no link starts with ${gone}`,
        )
        return 0
      }
      let got = await linkFor(
        at.session,
        typeof args.days == 'number' ? args.days : undefined,
      )
      c.out(got.url)
      c.out(`id        ${got.id}`)
      c.out(`expires   ${got.expires}`)
      if (got.links.length > 1) c.out(`standing  ${got.links.join(' ')}`)
      return 0
    },
  },

  {
    name: 'fee',
    title: 'what the platform takes from a sale, in basis points',
    description:
      'The platform’s own rate — read it, or move it.\n\n  yak fee --admin\n' +
      '  yak fee 250 --owner',
    // The rate is the PLATFORM's, so it is read and moved by a seat in `yak`
    // (workers/yak/sell.ts `fees`) — never a throwaway's, and never a
    // default's. The flag is what says so out loud, the same named act `login`
    // asks for.
    inputSchema: takes({
      bps: { type: 'string', description: 'the new rate, in basis points' },
    }),
    options: { positional: ['bps'] },
    run: async (args, c) => {
      if (args.owner !== true && args.admin !== true) {
        throw new Refused(
          'the fee is the platform’s: add --admin (an agent) or --owner ' +
            '(Jeff). A test account cannot read it or set it.',
        )
      }
      // Read before the account is: a typo is a typo whoever is signed in.
      let bps = word(args, 'bps')
      if (bps != null && !/^\d+$/.test(bps)) {
        throw new Usage(`not a whole number of basis points: ${bps}`)
      }
      let at = acting(whose(args), c)
      let now = bps == null
        ? await feeNow(at.session)
        : await setFee(at.session, Number(bps))
      c.out(`${now.bps} bps — ${now.rate} of each sale`)
      return 0
    },
  },

  {
    name: 'delete',
    title: 'close a space for good — its apps, their data, and the address',
    description:
      'What would go is named first, the same list the letter carries to a ' +
      'person whose agent asked.',
    inputSchema: takes({
      space: { type: 'string', description: 'the space slug' },
    }, ['space']),
    options: { positional: ['space'] },
    destructive: true,
    run: async (args, c) => {
      let slug = String(args.space)
      let at = acting(whose(args), c)
      // The naming first, and it is the page's own (workers/yak/erase.ts):
      // whoever runs this reads what would go before it goes, the same list
      // the letter carries to a person whose agent asked.
      for (let line of await doomedIn(at.session, slug)) c.out(`  - ${line}`)
      c.out(await close(at.session, slug))
      return 0
    },
  },

  {
    name: 'query',
    title: 'an app’s store through the filter grammar',
    description:
      'The store as this account reads it.\n\n  yak query jeff/recipes .doc!\n' +
      '  yak query jeff .kind=note',
    inputSchema: takes({
      where: { type: 'string', description: 'a space, or space/app' },
      filters: {
        type: 'array',
        items: { type: 'string' },
        description: 'dot-params',
      },
    }, ['where']),
    options: { positional: ['where'], rest: 'filters' },
    readOnly: true,
    run: async (args, c) => {
      let at = acting(whose(args), c)
      c.out(json(
        await storeQuery(
          at.session,
          String(args.where),
          (args.filters ?? []) as string[],
        ),
      ))
      return 0
    },
  },

  {
    name: 'tool',
    title: 'call one connector tool AS this account, not as the bearer',
    description:
      'The same tools `yak <tool>` calls, run as the signed-in account rather ' +
      'than the bearer — which is what a probe needs.\n\n  yak tool app_list\n' +
      "  yak tool app_new slug=notes title='Notes'",
    inputSchema: takes({
      name: { type: 'string', description: 'the tool to call' },
      args: { type: 'object', description: 'its own arguments' },
    }, ['name']),
    options: { positional: ['name'], rest: 'args' },
    run: async (args, c) => {
      let at = acting(whose(args), c)
      let out = await rpc(at.session)('tools/call', {
        name: String(args.name),
        arguments: (args.args ?? {}) as Record<string, unknown>,
      })
      c.out(c.json ? json(out) : saidBy(out))
      return 0
    },
  },
]

// Every verb waits for the renewals it caused (`acting`) before it returns,
// so a renewed session is in the graph before the command closes it.
let settled = (v: Command): Command => ({
  ...v,
  run: async (args, c) => {
    try {
      return await v.run(args, c)
    } finally {
      await Promise.all(renewals.splice(0))
    }
  },
})

export let verbs = said.map(settled)

if (import.meta.main) {
  // `--timing` is @yaks/cli's own global — it lifts the flag off the line and
  // says the line for the connector door. These verbs go somewhere else (the
  // apex, through yaks_api.ts `sent`), so the same flag arms the same line
  // here, read rather than consumed.
  watching(Deno.args.includes('--timing'), Deno.env.get('YAKS_TIMING'))
  Deno.exit(await main(Deno.args, verbs))
}
