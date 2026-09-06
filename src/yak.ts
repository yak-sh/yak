// The `yak` CLI: operate the live yaks.app platform as a signed-in account,
// without hand-rolling curl (T-33385). A CLIENT and nothing more — every verb
// here is something a person could do in a browser, and the server-side
// operator tier (T-33164) is deliberately absent.
//
//   yak test                    mint a throwaway @bot.yak.sh account, signed in
//   yak whoami                  the account, its spaces, and its role in each
//   yak link                    a standing sign-in link for that account
//   yak tool app_list           any connector tool, its reply printed plainly
//   yak query jeff/recipes .doc!    an app's store, through the filter grammar
//   yak apply jeff/recipes @batch.json
//
// The one rule the whole program is shaped around: A TEST ACCOUNT IS THE
// DEFAULT AND THE OWNER'S IS A NAMED ACT. No chain of defaults arrives at an
// owner account — reaching one takes `--owner` on that command line, and every
// command that runs as one wears a banner on stderr (yaks_account.ts).
//
// Verbs are declared data in the shape src/manual.ts uses, so usage renders
// through the shared `usageOf` and a verb's arguments are checked before it
// runs. The table is small enough to read top to bottom.
import {
  type Account,
  accountsIn,
  banner,
  BOT,
  CURRENT,
  envOf,
  envPath,
  forgotten,
  isTest,
  named,
  pick,
  readEnv,
  Refused,
  render,
  saved,
  setEnv,
  throwaway,
  usable,
  writeEnv,
} from './yaks_account.ts'
import {
  argsOf,
  askCode,
  claimsOf,
  close,
  codeFor,
  doomedIn,
  feeNow,
  linkFor,
  meAt,
  rpc,
  saidBy,
  setFee,
  spendCode,
  storeApply,
  storeQuery,
  tools,
  unlink,
  zone,
} from './yaks_api.ts'
import { safe } from './terminal.ts'
import { type Arg, type Decl, num, type Opt, text, usageOf } from './verb.ts'

let print = (line: string) => console.log(safe(line))
let warn = (line: string) => console.error(safe(line))

let json = (v: unknown) => JSON.stringify(v, null, 2)

// What a verb was told: the positional words it kept, its options, its flags.
// Narrower than the task CLI's `Got` because nothing here speaks dot-params.
type Said = {
  words: string[]
  opts: Record<string, string>
  flags: Set<string>
}

type Verb = Decl & { run: (said: Said) => unknown }

class Usage extends Error {}

// Every verb takes these, because every verb acts AS somebody.
let GLOBAL: Opt[] = [
  { name: '--as', kind: text },
  { name: '--owner' },
]

let arg = (name: string, need = true, rest = false): Arg => ({
  name,
  kind: text,
  need,
  rest,
})

let parse = (name: string, verb: Verb, argv: string[]): Said => {
  let words: string[] = []
  let opts: Record<string, string> = {}
  let flags = new Set<string>()
  let declared = new Map(
    [...(verb.opts ?? []), ...GLOBAL].map((o) => [o.name, o]),
  )
  for (let a of argv) {
    if (!a.startsWith('--')) {
      words.push(a)
      continue
    }
    let eq = a.indexOf('=')
    let flag = eq < 0 ? a : a.slice(0, eq)
    let opt = declared.get(flag)
    if (!opt) throw new Usage(`${name} does not take ${flag}`)
    if (!opt.kind) {
      if (eq >= 0) throw new Usage(`${flag} is a flag and takes no value`)
      flags.add(flag)
      continue
    }
    if (eq < 0) throw new Usage(`${flag} needs a value — ${flag}=…`)
    opts[flag] = a.slice(eq + 1)
  }
  let slots = verb.args ?? []
  let least = slots.filter((s) => s.need !== false).length
  let most = slots.at(-1)?.rest ? Infinity : slots.length
  if (words.length < least || words.length > most) {
    let count = most == Infinity
      ? `at least ${least}`
      : least == most
      ? `${least}`
      : `${least}–${most}`
    throw new Usage(
      `${name} wants ${count} argument${count.endsWith('1') ? '' : 's'}, ` +
        `got ${words.length}`,
    )
  }
  return { words, opts, flags }
}

// The `.env` this box keeps its sessions in, read fresh each command so two
// shells never fight over a cached copy.
let store = () => {
  let path = envPath()
  let text = readEnv(path)
  let env = envOf(text)
  return { path, text, env, all: accountsIn(env) }
}

let write = (path: string, text: string) => {
  writeEnv(path, text)
  return text
}

// WHO this command runs as, and the mark it wears when the answer is somebody
// else's own account. Every verb that touches the platform goes through here.
let acting = (said: Said): Account => {
  let { env, all } = store()
  let at = pick(all, {
    as: said.opts['--as'],
    owner: said.flags.has('--owner'),
    current: env[CURRENT],
  })
  if (!isTest(at)) warn(banner(at))
  return at
}

// Sign in end to end. A `@bot.yak.sh` code comes back through the tasks graph
// (the fleet sweep files the letter); anyone else's is in their own mail, so
// it is asked for rather than guessed at.
let signIn = async (address: string, given?: string) => {
  let since = Date.now()
  await askCode(address)
  let bot = address.endsWith(BOT)
  let code = given ??
    (bot ? await waited(address, since) : await asked(address))
  let session = await spendCode(address, code)
  let { path, text } = store()
  let next = saved(text, address, session)
  // Only a throwaway is ever remembered as the default (yaks_account.ts).
  write(path, bot ? setEnv(next, CURRENT, address) : next)
  return session
}

let waited = (address: string, since: number) => {
  warn(`waiting for the code to reach the graph for ${address}…`)
  return codeFor(address, since)
}

let asked = async (address: string) => {
  warn(`a code was mailed to ${address}. paste it here:`)
  let buf = new Uint8Array(64)
  let n = await Deno.stdin.read(buf)
  let said = new TextDecoder().decode(buf.subarray(0, n ?? 0)).trim()
  if (!/^\d{6}$/.test(said)) throw new Error(`not a six-digit code: ${said}`)
  return said
}

type Space = {
  slug: string
  title: string
  url: string
  tier: string
  apps: { slug: string; home: boolean }[]
}

let spacesOf = async (at: Account): Promise<Space[]> => {
  let out = await rpc(at.session)('tools/call', {
    name: 'app_list',
    arguments: {},
  })
  saidBy(out)
  return (out.structuredContent?.spaces ?? []) as Space[]
}

let whoami = async (said: Said) => {
  let at = acting(said)
  let claims = claimsOf(at.session)
  print(`account   ${at.address || '(address unrecorded)'}`)
  print(
    `kind      ${isTest(at) ? 'test — a throwaway' : 'OWNER — somebody’s own'}`,
  )
  print(`person    ${claims?.person ?? '(session unreadable)'}`)
  print(
    `session   ${
      claims
        ? `good until ${new Date(claims.exp * 1000).toISOString()}`
        : '(unreadable)'
    }`,
  )
  print(`zone      ${zone()}`)
  let spaces = await spacesOf(at)
  if (!spaces.length) return print('spaces    (none)')
  print('spaces')
  for (let s of spaces) {
    let front = s.apps.find((a) => a.home) ?? s.apps[0]
    // The role door is an APP's (`/<app>/api/me`); a space with nothing in it
    // has none, and no client door answers a role without one — say `?`
    // rather than assume owner.
    let me = front ? await meAt(at.session, `${s.slug}/${front.slug}`) : null
    print(
      `  ${s.slug.padEnd(16)} ${(me?.role ?? '?').padEnd(8)} ` +
        `${String(s.apps.length).padStart(2)} apps  ${
          (s.tier ?? 'free').padEnd(5)
        }  ${s.url}`,
    )
  }
}

let verbs: Record<string, Verb> = {
  whoami: {
    name: 'whoami',
    about: 'the account this box acts as, its spaces, and its role in each',
    door: ['cli'],
    run: whoami,
  },

  accounts: {
    name: 'accounts',
    about: 'every account signed in on this box (never their sessions)',
    door: ['cli'],
    run: () => {
      let { env, all } = store()
      print(render(all, env[CURRENT] ?? ''))
    },
  },

  test: {
    name: 'test',
    about:
      'mint a throwaway <name>@bot.yak.sh account, sign in, make it current',
    args: [arg('name', false)],
    door: ['cli'],
    examples: ['yak test', 'yak test cookbook'],
    run: async (said) => {
      let address = said.words[0] ? `${said.words[0]}@bot.yak.sh` : throwaway()
      await signIn(address)
      print(`signed in as ${address} — current`)
    },
  },

  login: {
    name: 'login',
    about: 'sign in as an address; a bot code is read from the graph, ' +
      'anyone else’s is typed',
    args: [arg('address')],
    opts: [{ name: '--code', kind: text }],
    door: ['cli'],
    examples: [
      'yak login probe@bot.yak.sh',
      'yak login you@example.com --owner',
    ],
    run: async (said) => {
      let address = said.words[0].trim().toLowerCase()
      if (!address.includes('@')) throw new Usage(`not an address: ${address}`)
      if (!address.endsWith(BOT) && !said.flags.has('--owner')) {
        throw new Refused(
          `${address} is not a test address. Signing in as somebody is a ` +
            'named act: add --owner. A throwaway is `yak test`.',
        )
      }
      await signIn(address, said.opts['--code'])
      print(`signed in as ${address}`)
    },
  },

  use: {
    name: 'use',
    about:
      'remember a TEST account as the default; an owner account is refused',
    args: [arg('account')],
    door: ['cli'],
    run: (said) => {
      let { path, text, all } = store()
      let hit = named(all, said.words[0])
      if (hit.length != 1) {
        throw new Refused(`${said.words[0]} names ${hit.length} accounts`)
      }
      write(path, setEnv(text, CURRENT, usable(hit[0]).address))
      print(`current: ${hit[0].address}`)
    },
  },

  logout: {
    name: 'logout',
    about: 'forget one account’s session',
    args: [arg('account')],
    door: ['cli'],
    run: (said) => {
      let { path, text, all } = store()
      let hit = named(all, said.words[0])
      if (hit.length != 1) {
        throw new Refused(`${said.words[0]} names ${hit.length} accounts`)
      }
      write(path, forgotten(text, hit[0]))
      print(`forgot ${hit[0].address || hit[0].name}`)
    },
  },

  tools: {
    name: 'tools',
    about: 'the connector tools this account can call',
    door: ['cli'],
    run: async (said) => {
      let at = acting(said)
      for (let t of await tools(at.session)) {
        print(`${t.name.padEnd(18)} ${t.description.split('. ')[0]}`)
      }
    },
  },

  tool: {
    name: 'tool',
    about: 'call one connector tool; its reply is printed plainly',
    args: [arg('name'), arg('key=value', false, true)],
    opts: [{ name: '--json' }],
    door: ['cli'],
    examples: [
      'yak tool app_list',
      "yak tool app_new slug=notes title='Notes'",
    ],
    run: async (said) => {
      let at = acting(said)
      let [name, ...rest] = said.words
      let out = await rpc(at.session)('tools/call', {
        name,
        arguments: argsOf(rest),
      })
      print(said.flags.has('--json') ? json(out) : saidBy(out))
    },
  },

  link: {
    name: 'link',
    about:
      'a standing sign-in link for this account — one URL that signs its ' +
      'holder in until it expires',
    opts: [{ name: '--days', kind: num }, { name: '--revoke', kind: text }],
    door: ['cli'],
    examples: [
      'yak test reviewer && yak link --days=90',
      'yak link --revoke=3f2a',
    ],
    run: async (said) => {
      let at = acting(said)
      let gone = said.opts['--revoke']
      if (gone) {
        let ids = await unlink(at.session, gone)
        return print(
          ids.length
            ? `revoked ${ids.join(' ')}`
            : `no link starts with ${gone}`,
        )
      }
      let days = said.opts['--days']
      let got = await linkFor(at.session, days ? Number(days) : undefined)
      print(got.url)
      print(`id        ${got.id}`)
      print(`expires   ${got.expires}`)
      if (got.links.length > 1) print(`standing  ${got.links.join(' ')}`)
    },
  },

  fee: {
    name: 'fee',
    about:
      'what the platform takes from a sale, in basis points — read it, or ' +
      'set it',
    args: [arg('bps', false)],
    door: ['cli'],
    examples: ['yak fee --owner', 'yak fee 250 --owner'],
    // The rate is the PLATFORM's, so it is the platform owner's to read and to
    // move — never a throwaway's, and never a default's. `--owner` is what
    // says so out loud, the same named act `login` asks for.
    run: async (said) => {
      if (!said.flags.has('--owner')) {
        throw new Refused(
          'the fee is the platform owner’s: add --owner. A test account ' +
            'cannot read it or set it.',
        )
      }
      // Read before the account is: a typo is a typo whoever is signed in.
      let bps = said.words[0]
      if (bps != null && !/^\d+$/.test(bps)) {
        throw new Usage(`not a whole number of basis points: ${bps}`)
      }
      let at = acting(said)
      let now = bps == null
        ? await feeNow(at.session)
        : await setFee(at.session, Number(bps))
      print(`${now.bps} bps — ${now.rate} of each sale`)
    },
  },

  delete: {
    name: 'delete',
    about:
      'close a space for good \u2014 its apps, their data and files, its ' +
      'domains, and the address',
    args: [arg('space')],
    door: ['cli'],
    examples: ['yak delete probe-1a2b', 'yak delete shoplab --owner'],
    run: async (said) => {
      let at = acting(said)
      let slug = said.words[0]
      // The naming first, and it is the page\u2019s own (workers/yak/erase.ts):
      // whoever runs this reads what would go before it goes, the same list
      // the letter carries to a person whose agent asked.
      for (let line of await doomedIn(at.session, slug)) print(`  - ${line}`)
      print(await close(at.session, slug))
    },
  },

  query: {
    name: 'query',
    about: 'an app’s store through the filter grammar',
    args: [arg('space/app'), arg('filter', false, true)],
    door: ['cli'],
    examples: ['yak query jeff/recipes .doc!', 'yak query jeff .kind=note'],
    run: async (said) => {
      let at = acting(said)
      let [where, ...filters] = said.words
      print(json(await storeQuery(at.session, where, filters)))
    },
  },

  apply: {
    name: 'apply',
    about: 'a batch into an app’s store; @file and - read it from elsewhere',
    args: [arg('space/app'), arg('batch')],
    door: ['cli'],
    examples: [
      'yak apply jeff/recipes \'{"entities":[…]}\'',
      'yak apply jeff/recipes @batch.json',
    ],
    run: async (said) => {
      let at = acting(said)
      let [where, batch] = said.words
      let body = JSON.parse(await read(batch))
      print(json(await storeApply(at.session, where, body)))
    },
  },
}

// A body given as text, from a file, or on stdin — the same three spellings
// the task CLI's `--body` takes.
let read = async (word: string) => {
  if (word == '-' || word == '@-') {
    return await new Response(Deno.stdin.readable).text()
  }
  return word.startsWith('@') ? Deno.readTextFileSync(word.slice(1)) : word
}

let helpFor = (name: string) => {
  let verb = verbs[name]
  return [
    `yak ${usageOf(verb)} [--as=ACCOUNT] [--owner]`,
    `  ${verb.about}`,
    ...(verb.examples ?? []).map((e) => `\n  ${e}`),
  ].join('\n')
}

let usage = () =>
  [
    'yak — operate yaks.app as a signed-in account',
    '',
    ...Object.keys(verbs).map((n) =>
      `  ${usageOf(verbs[n]).padEnd(34)} ${verbs[n].about}`
    ),
    '',
    '  --as=ACCOUNT   which signed-in account (address or its local part)',
    '  --owner        act as a NON-test account. Required, never implied.',
    '',
    'A test account is the default and the easy path: `yak test` mints one.',
  ].join('\n')

if (import.meta.main) {
  let [cmd, ...rest] = Deno.args
  try {
    if (!cmd || cmd == '--help' || cmd == '-h') print(usage())
    else if (!verbs[cmd]) {
      warn(`yak: no such verb: ${cmd}`)
      print(usage())
      Deno.exit(2)
    } else if (rest.includes('--help') || rest.includes('-h')) {
      print(helpFor(cmd))
    } else {
      await verbs[cmd].run(parse(cmd, verbs[cmd], rest))
    }
  } catch (e) {
    warn(`yak: ${(e as Error).message}`)
    if (e instanceof Usage && verbs[cmd]) warn(helpFor(cmd))
    Deno.exit(1)
  }
}

export { GLOBAL, parse, usage, verbs }
