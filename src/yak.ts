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
// It stays HERE rather than in the package because it cannot be anywhere else:
// the sessions live in the main checkout's `.env` (yaks_account.ts `envPath`),
// and a bot's sign-in code is read out of the tasks graph (yaks_api.ts
// `codeFor`). Both are this repo, and neither is something a `deno install`
// off jsr could reach.
import {
  forgetToken,
  main,
  pairsIn,
  type Plugin,
  PLUGINS,
  saidIn,
  saveToken,
  Usage,
  type Verb,
} from '@yaks/cli'
import {
  type Account,
  accountsIn,
  ADMIN,
  banner,
  BOT,
  CURRENT,
  envOf,
  envPath,
  forgotten,
  isAdmin,
  isTest,
  isTestAddress,
  LEGACY,
  localPart,
  named,
  pick,
  readEnv,
  recorded,
  Refused,
  render,
  saved,
  setEnv,
  throwaway,
  usable,
  writeEnv,
} from './yaks_account.ts'
import {
  addressOf,
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

// What a verb was told. The options are the package's own grammar (`--as x`
// and `--as=x` both), and the bare words are this verb's arguments.
type Said = {
  words: string[]
  opts: Record<string, string>
  flags: Set<string>
}

let said = (argv: string[]): Said => {
  let { opts, words } = saidIn(argv)
  return {
    words,
    opts: Object.fromEntries(
      opts.filter(([, v]) => v !== true) as [string, string][],
    ),
    flags: new Set(opts.filter(([, v]) => v === true).map(([n]) => n)),
  }
}

let json = (v: unknown) => JSON.stringify(v, null, 2)

// The `.env` this box keeps its sessions in, read fresh each command so two
// shells never fight over a cached copy.
let store = () => {
  let path = envPath()
  let text = readEnv(path)
  let env = envOf(text)
  return { path, text, env, all: accountsIn(env) }
}

let write = (path: string, text: string) => (writeEnv(path, text), text)

// A session the platform renewed, written back under the same account
// (yaks_api.ts `renewing`, workers/yak/session.ts `slid`): the platform
// re-mints a cookie past half its life, and a box that kept the old value
// would sign out ninety days after its first sign-in however often it called.
// The file is re-read here rather than reused from `acting`, so a renewal
// never carries away a line another shell wrote in the meantime.
let keep = (at: Account, fresh: string) => {
  let { path, text } = store()
  write(
    path,
    at.address ? saved(text, at.address, fresh) : setEnv(text, LEGACY, fresh),
  )
}

// WHO this command runs as, and the mark it wears when the answer is somebody
// else's own account. Every verb that touches the platform goes through here.
let acting = (s: Said, note: (line: string) => void): Account => {
  let { env, all } = store()
  let at = pick(all, {
    as: s.opts.as,
    owner: s.flags.has('owner'),
    admin: s.flags.has('admin'),
    current: env[CURRENT],
  })
  if (!isTest(at)) note(banner(at))
  renewing((fresh) => keep(at, fresh))
  return at
}

// The account whose address nobody wrote down — the hand-pasted session that
// predates this file (yaks_account.ts LEGACY) — asked about ONCE. The platform
// is the only one who knows it (yaks_api.ts `addressOf`), and the answer is
// written into the file (`recorded`), so every later command reads it there. A
// platform that cannot say leaves both the file and the account as they were:
// an unknown address goes on reading as the owner's, which is what it did
// before this asked at all.
export let known = async (
  at: Account,
  ask: (session: string) => Promise<string> = addressOf,
): Promise<Account> => {
  if (at.address) return at
  let address = await ask(at.session).catch(() => '')
  if (!address) return at
  let { path, text } = store()
  write(path, recorded(text, at, address))
  return { ...at, address, name: localPart(address) }
}

// Sign in end to end. A `@bot.yak.sh` code comes back through the tasks graph
// (the fleet sweep files the letter); anyone else's is in their own mail, so
// it is asked for rather than guessed at.
let signIn = async (
  address: string,
  note: (line: string) => void,
  given?: string,
) => {
  let since = Date.now()
  await askCode(address)
  let bot = address.endsWith(BOT)
  let code = given ?? (bot ? await waited(address, since, note) : await asked(
    address,
    note,
  ))
  let session = await spendCode(address, code)
  let { path, text } = store()
  let next = saved(text, address, session)
  // Only a throwaway is ever remembered as the default (yaks_account.ts) — the
  // admin wears a bot address and is still not one.
  write(path, isTestAddress(address) ? setEnv(next, CURRENT, address) : next)
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

type Space = {
  slug: string
  title: string
  url: string
  tier: string
  // The caller's own role here, which the listing answers because membership
  // is the DIRECTORY's fact and it read that row already (workers/yak
  // tools.ts `app_list`). One question, every space.
  role: string | null
  apps: { slug: string }[]
}

let spacesOf = async (at: Account): Promise<Space[]> => {
  let out = await rpc(at.session)('tools/call', {
    name: 'app_list',
    arguments: {},
  })
  saidBy(out)
  return (out.structuredContent?.spaces ?? []) as Space[]
}

// One account, named the way `--as` names one.
let one = (all: Account[], want: string): Account => {
  let hit = named(all, want)
  if (hit.length != 1) throw new Refused(`${want} names ${hit.length} accounts`)
  return hit[0]
}

// Infrastructure belongs to the platform owner. Its credentials are the
// box's Wrangler/GitHub logins, independent of a yaks.app account session.
let root = new URL('../', import.meta.url).pathname.replace(/\/$/, '')
let platform = (args: string[], note: (line: string) => void): Said => {
  // --admin and --owner are booleans here, wherever they stand; the general
  // key/value grammar otherwise consumes a following version or sha as a value.
  // The act is named either way; the flag says WHOSE it is — an agent's
  // (`--admin`) or Jeff's (`--owner`) — and the banner says that out loud. The
  // credentials below are this box's Cloudflare/GitHub login for both, until
  // the admin path has a token of its own (T-35375).
  let flag = args.find((a) => a == '--admin' || a == '--owner')
  if (!flag) {
    throw new Refused(
      'yaks.app operations are a named act: add --admin (an agent) or ' +
        '--owner (Jeff)',
    )
  }
  let s = said(args.filter((a) => a != flag))
  note(
    flag == '--admin'
      ? banner({ name: 'admin', address: ADMIN, session: '' })
      : banner({
        name: 'platform',
        address: 'yaks.app (this box’s Cloudflare/GitHub login)',
        session: '',
      }),
  )
  return s
}

let operation = (
  s: Said,
  words: number,
  usage: string,
  opts: string[] = [],
) => {
  if (
    s.words.length > words || s.flags.size ||
    Object.keys(s.opts).some((k) => !opts.includes(k))
  ) {
    throw new Usage(usage)
  }
}

let verbs: Verb[] = [
  {
    name: 'deploys',
    args: '--admin|--owner',
    about: 'yaks.app versions, commits, live times, and data boundaries',
    help: () =>
      'yak deploys --admin\n\n  Recent uploads and deployments; ~ marks a commit inferred by time.\n  Migration boundaries survive code rollbacks. Unknown history refuses rollback.',
    run: async (c) => {
      let s = platform(c.args, c.note)
      operation(s, 0, 'yak deploys --admin|--owner')
      c.out(table(await deploys(root)))
      return 0
    },
  },
  {
    name: 'errors',
    args: '[--since 10m] --admin|--owner',
    about: 'yaks.app exceptions and error logs grouped by signature',
    help: () =>
      'yak errors [--since 10m] --admin\n\n  Count, first/last seen, entrypoint and version for each error signature.\n  Uses Workers Logs when available; otherwise observes the NEXT window by tail.',
    run: async (c) => {
      let s = platform(c.args, c.note)
      operation(s, 0, 'yak errors [--since 10m] --admin|--owner', ['since'])
      return await errors(root, s.opts.since ?? '10m', c.out, c.note)
    },
  },
  {
    name: 'tail',
    args: '--admin|--owner',
    about: 'yaks.app live events: outcome, entrypoint, request and errors',
    help: () =>
      'yak tail --admin\n\n  One line per live event. Ctrl-C stops the tail.',
    run: async (c) => {
      let s = platform(c.args, c.note)
      operation(s, 0, 'yak tail --admin|--owner')
      return await tail(root, c.out, c.note)
    },
  },
  {
    name: 'rollback',
    args: '[version] --admin|--owner',
    about:
      'emergency rollback for a broken build path; refuses data boundaries',
    help: () =>
      'yak rollback [version] --admin\n\n  Only for a broken build path. Code corrections use yak revert: main deploys\n  every push. Defaults to the prior deployed version; refuses data boundaries\n  and uncertain commits, then probes the public doors after a rollback.',
    run: async (c) => {
      let s = platform(c.args, c.note)
      operation(s, 1, 'yak rollback [version] --admin|--owner')
      c.note(
        'Cloudflare rollback is for a broken build path. Code corrections belong on main: yak revert <sha> --admin.',
      )
      return await rollback(root, s.words[0], c.out)
    },
  },
  {
    name: 'revert',
    args: '<sha> --admin|--owner',
    about: 'revert on fresh main, gate, land/push, and time the live deploy',
    help: () =>
      'yak revert <sha> --admin\n\n  Reverts a main commit in a fresh worktree, runs deno task check, then uses\n  task land to publish main. Re-gates after a rebase and waits up to 20m for\n  an annotated version to serve the revert. Failed worktrees are kept.\n  Workers Builds deploy command: ../../bin/build-yak deploy',
    run: async (c) => {
      let s = platform(c.args, c.note)
      operation(s, 1, 'yak revert <sha> --admin|--owner')
      if (!/^[a-f\d]{7,40}$/i.test(s.words[0] ?? '')) {
        throw new Usage('yak revert <sha> --admin|--owner')
      }
      return await revert(root, s.words[0], c.out, c.note)
    },
  },
  {
    name: 'whoami',
    about: 'the account this box acts as, its spaces, and its role in each',
    run: async (c) => {
      let at = await known(acting(said(c.args), c.note))
      let claims = claimsOf(at.session)
      c.out(`account   ${at.address || '(address unrecorded)'}`)
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
      let spaces = await spacesOf(at)
      if (!spaces.length) {
        c.out('spaces    (none)')
        return 0
      }
      c.out('spaces')
      for (let s of spaces) {
        c.out(
          `  ${s.slug.padEnd(16)} ${(s.role ?? '?').padEnd(8)} ` +
            `${String(s.apps.length).padStart(2)} apps  ${
              (s.tier ?? 'free').padEnd(5)
            }  ${s.url}`,
        )
      }
      return 0
    },
  },

  {
    name: 'accounts',
    about: 'every account signed in on this box (never their sessions)',
    run: (c) => {
      let { env, all } = store()
      c.out(render(all, env[CURRENT] ?? ''))
      return 0
    },
  },

  {
    name: 'test',
    args: '[name]',
    about: 'mint a throwaway <name>@bot.yak.sh account, signed in and current',
    help: () =>
      'yak test [name]\n\n  A throwaway account, signed in and made current.' +
      '\n\n  yak test\n  yak test cookbook',
    run: async (c) => {
      let s = said(c.args)
      let address = s.words[0] ? `${s.words[0]}@bot.yak.sh` : throwaway()
      await signIn(address, c.note)
      c.out(`signed in as ${address} — current`)
      return 0
    },
  },

  {
    name: 'login',
    args: '<address|token>',
    about: 'sign in as an address — or keep a bearer for this host',
    help: () =>
      'yak login <address> [--admin|--owner] [--code=NNNNNN]\n' +
      'yak login <token>\n\n' +
      '  An address signs this box in as that account: a bot code is read ' +
      'from\n  the graph, anyone else’s is typed. A word that is not an ' +
      'address is a\n  connector bearer, kept for this host.\n\n' +
      '  yak login probe@bot.yak.sh\n  yak login you@example.com --owner\n' +
      `  yak login ${ADMIN} --admin`,
    run: async (c) => {
      let s = said(c.args)
      let word = s.words[0]
      if (!word) throw new Usage('yak login <address|token>')
      // A bearer is the package's own verb, and this one still answers to it:
      // one word, one act — sign this box in with whatever it was handed.
      if (!word.includes('@')) {
        c.out(`bearer for ${c.host} kept in ${saveToken(c.host, word)}`)
        return 0
      }
      let address = word.trim().toLowerCase()
      if (address == ADMIN && !s.flags.has('admin')) {
        throw new Refused(
          `${address} is the platform’s admin. Signing in as it is a named ` +
            'act: add --admin. A throwaway is `yak test`.',
        )
      }
      if (
        !isTestAddress(address) && address != ADMIN && !s.flags.has('owner')
      ) {
        throw new Refused(
          `${address} is not a test address. Signing in as somebody is a ` +
            'named act: add --owner. A throwaway is `yak test`.',
        )
      }
      await signIn(address, c.note, s.opts.code)
      c.out(`signed in as ${address}`)
      return 0
    },
  },

  {
    name: 'use',
    args: '<account>',
    about: 'remember a TEST account as the default; an owner one is refused',
    run: (c) => {
      let { path, text, all } = store()
      let want = said(c.args).words[0]
      if (!want) throw new Usage('yak use <account>')
      let at = one(all, want)
      write(path, setEnv(text, CURRENT, usable(at).address))
      c.out(`current: ${at.address}`)
      return 0
    },
  },

  {
    name: 'logout',
    args: '[account]',
    about: 'forget one account’s session — or this host’s bearer',
    run: (c) => {
      let want = said(c.args).words[0]
      // No account named is the package's own act: forget the bearer.
      if (!want) {
        forgetToken(c.host)
        c.out(`forgot the bearer for ${c.host}`)
        return 0
      }
      let { path, text, all } = store()
      let at = one(all, want)
      write(path, forgotten(text, at))
      c.out(`forgot ${at.address || at.name}`)
      return 0
    },
  },

  {
    name: 'link',
    about: 'a standing sign-in link for this account',
    help: () =>
      'yak link [--days=N] [--revoke=ID]\n\n  One URL that signs its holder ' +
      'in until it expires.\n\n  yak test reviewer && yak link --days=90\n' +
      '  yak link --revoke=3f2a',
    run: async (c) => {
      let s = said(c.args)
      let at = acting(s, c.note)
      let gone = s.opts.revoke
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
        s.opts.days ? Number(s.opts.days) : undefined,
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
    args: '[bps]',
    about: 'what the platform takes from a sale, in basis points',
    help: () =>
      'yak fee [bps] --admin|--owner\n\n  The platform’s own rate — read it, ' +
      'or move it.\n\n  yak fee --admin\n  yak fee 250 --owner',
    // The rate is the PLATFORM's, so it is read and moved by a seat in `yak`
    // (workers/yak/sell.ts `fees`) — never a throwaway's, and never a
    // default's. The flag is what says so out loud, the same named act `login`
    // asks for.
    run: async (c) => {
      let s = said(c.args)
      if (!s.flags.has('owner') && !s.flags.has('admin')) {
        throw new Refused(
          'the fee is the platform’s: add --admin (an agent) or --owner ' +
            '(Jeff). A test account cannot read it or set it.',
        )
      }
      // Read before the account is: a typo is a typo whoever is signed in.
      let bps = s.words[0]
      if (bps != null && !/^\d+$/.test(bps)) {
        throw new Usage(`not a whole number of basis points: ${bps}`)
      }
      let at = acting(s, c.note)
      let now = bps == null
        ? await feeNow(at.session)
        : await setFee(at.session, Number(bps))
      c.out(`${now.bps} bps — ${now.rate} of each sale`)
      return 0
    },
  },

  {
    name: 'delete',
    args: '<space>',
    about: 'close a space for good — its apps, their data, and the address',
    run: async (c) => {
      let s = said(c.args)
      let slug = s.words[0]
      if (!slug) throw new Usage('yak delete <space>')
      let at = acting(s, c.note)
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
    args: '<space/app> [filter ...]',
    about: 'an app’s store through the filter grammar',
    help: () =>
      'yak query <space/app> [filter ...]\n\n  The store as this account ' +
      'reads it.\n\n  yak query jeff/recipes .doc!\n  yak query jeff ' +
      '.kind=note',
    run: async (c) => {
      let s = said(c.args)
      let [where, ...filters] = s.words
      if (!where) throw new Usage('yak query <space/app> [filter ...]')
      let at = acting(s, c.note)
      c.out(json(await storeQuery(at.session, where, filters)))
      return 0
    },
  },

  {
    name: 'tool',
    args: '<name> [key=value ...]',
    about: 'call one connector tool AS this account, not as the bearer',
    help: () =>
      'yak tool <name> [key=value ...]\n\n  The same tools `yak <tool>` ' +
      'calls, run as the signed-in account\n  rather than the bearer — which ' +
      'is what a probe needs.\n\n  yak tool app_list\n  yak tool app_new ' +
      "slug=notes title='Notes'",
    run: async (c) => {
      let s = said(c.args)
      let [name, ...rest] = s.words
      if (!name) throw new Usage('yak tool <name> [key=value ...]')
      let at = acting(s, c.note)
      let out = await rpc(at.session)('tools/call', {
        name,
        arguments: await pairsIn(rest, c.reads),
      })
      c.out(c.json ? json(out) : saidBy(out))
      return 0
    },
  },
]

/** The accounts this box is signed in as, and what they may do. */
export let owner: Plugin = {
  name: 'owner',
  about: 'this box’s accounts  [--as=ACCOUNT] [--admin] [--owner]',
  verbs: () => verbs,
}

export { verbs }

if (import.meta.main) {
  // `--timing` is @yaks/cli's own global — it lifts the flag off the line and
  // says the line for the connector door. These verbs go somewhere else (the
  // apex, through yaks_api.ts `sent`), so the same flag arms the same line
  // here, read rather than consumed.
  watching(Deno.args.includes('--timing'), Deno.env.get('YAK_TIMING'))
  Deno.exit(await main(Deno.args, [owner, ...PLUGINS]))
}
