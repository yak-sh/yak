// The yaks.app accounts this box is signed in as, and the rule that keeps an
// agent out of the owner's. A session is a secret (@yaks/secrets) named for
// the zone and the address it signed in as, `yaks.app session <address>` (or
// `yaks.fyi session <address>` on staging), so one address holds a session on
// each platform without either overwriting the other. It is written through
// the graph this box's `yak` opens: the graph holds the name and a handle,
// and the vault beside its database holds the session — never a checkout,
// and never the data repo a backup pushes.
//
// The rule, and the reason this file exists at all: an ACCOUNT IS AN ADDRESS,
// and an address ending `@bot.yak.sh` is a test account. Everything else is
// somebody's own, and reaching it takes `--owner` in the argv. One address on
// that domain is not a throwaway either: `admin@bot.yak.sh` is the platform's
// own admin person, whom an agent runs a platform act as, and reaching it
// takes `--admin`. There is deliberately no ambient path to either: `current`
// refuses to hold one, so the pull toward the warm default lands on a
// throwaway every time (M-31946, and three corrections in one session before
// this existed).
//
// Nothing here ever renders a session value. `render` shows addresses and
// kinds; the token crosses only between the vault and an http header.
import { stateDir } from '@yaks/cli'
import type { Local } from '@yaks/secrets'
import { CallError } from '@yaks/tools'
import { ADMIN, BOT, isTestAddress } from '../../workers/yak/lib/bots.ts'
import { zone } from './api.ts'

export type Account = {
  // The address it signed in as.
  address: string
  // The `yak_session` cookie value. Never printed.
  session: string
  // What to type for it: the address's local part.
  name: string
}

// A test account is provably a throwaway (workers/yak/lib/bots.ts).
export let isTest = (a: Account) => isTestAddress(a.address)
export let isAdmin = (a: Account) => a.address == ADMIN

export let localPart = (address: string) => address.split('@')[0]

// The secret one account's session on one zone is kept under.
let session = (at: string) => `${at} session `
export let sessionName = (address: string, at = zone()) => session(at) + address

// Every account whose session on this zone the vault keeps.
export let accountsIn = (vault: Local, at = zone()): Account[] =>
  vault.all().flatMap(([, kept]) => {
    let address = kept.name?.startsWith(session(at))
      ? kept.name.slice(session(at).length)
      : ''
    return address && kept.value
      ? [{ address, session: kept.value, name: localPart(address) }]
      : []
  }).sort((a, b) => a.name.localeCompare(b.name))

// The remembered test account a bare command runs as, one per zone. It is not
// a secret, so it is not kept with the sessions: it is one more thing this
// machine remembers between commands, beside the bearer `yak login` keeps
// (@yaks/cli `stateDir`), in the directory the caller names, this machine's
// own by default.
let currentFile = (dir: string, at: string) => `${dir}/current.${at}`

export let current = (dir: string = stateDir(), at = zone()): string => {
  try {
    return Deno.readTextFileSync(currentFile(dir, at)).trim()
  } catch {
    return ''
  }
}

// Remember one, or forget it with null.
export let choose = (
  address: string | null,
  dir: string = stateDir(),
  at = zone(),
): void => {
  if (address == null) {
    try {
      Deno.removeSync(currentFile(dir, at))
    } catch { /* nothing remembered */ }
    return
  }
  Deno.mkdirSync(dir, { recursive: true, mode: 0o700 })
  Deno.writeTextFileSync(currentFile(dir, at), address + '\n')
}

// What `--as` accepts: the whole address, or the local part when it names
// exactly one account.
export let named = (all: Account[], want: string): Account[] =>
  all.filter((a) => a.address == want || a.name == want)

// What reaching an account the argv did not name is: the caller's own
// mistake, answered in words, never a fault of the tool.
export class Refused extends CallError {
  constructor(message: string) {
    super('refused', message)
  }
}

let say = (all: Account[]) =>
  all.length
    ? all.map((a) => `  ${a.name} — ${a.address}`).join('\n')
    : '  (none)'

// WHICH account a command runs as. `owner` and `admin` are the argv flags,
// `current` the remembered test account. The whole point of the function: an
// account that is not a throwaway is reachable only when its own flag is set,
// and `current` can never name one (see `usable`), so no chain of defaults
// arrives there.
export let pick = (
  all: Account[],
  want: { as?: string; owner?: boolean; admin?: boolean; current?: string },
): Account => {
  if (want.owner && want.admin) {
    throw new Refused('--owner and --admin name two accounts: pick one')
  }
  if (want.as) {
    let hit = named(all, want.as)
    if (!hit.length) {
      throw new Refused(`no account ${want.as}. signed in:\n${say(all)}`)
    }
    if (hit.length > 1) {
      throw new Refused(
        `${want.as} names ${hit.length} accounts — use the whole address:\n` +
          say(hit),
      )
    }
    let said = isAdmin(hit[0]) ? want.admin : isTest(hit[0]) || want.owner
    if (!said) throw refusal(hit[0])
    return hit[0]
  }
  if (want.admin) {
    let it = all.find(isAdmin)
    if (!it) {
      throw new Refused(
        `no admin account signed in — \`yak admin login ${ADMIN} --admin\``,
      )
    }
    return it
  }
  if (want.owner) {
    // The admin is nobody's own account, so `--owner` never lands on it.
    let theirs = all.filter((a) => !isTest(a) && !isAdmin(a))
    if (!theirs.length) {
      throw new Refused(
        'no owner account signed in — `yak admin login <address> --owner`',
      )
    }
    if (theirs.length > 1) {
      throw new Refused(
        `--owner names ${theirs.length} accounts:\n${say(theirs)}`,
      )
    }
    return theirs[0]
  }
  let tests = all.filter(isTest)
  if (want.current) {
    let hit = named(tests, want.current)
    if (hit.length == 1) return hit[0]
  }
  if (tests.length == 1) return tests[0]
  if (!tests.length) {
    throw new Refused(
      'no test account — `yak admin throwaway` signs in as a new one',
    )
  }
  throw new Refused(
    `${tests.length} test accounts and none current — \`yak admin use <name>\`, ` +
      `or --as:\n${say(tests)}`,
  )
}

// What reaching this account is, said back to whoever did not say it.
let refusal = (a: Account) =>
  new Refused(
    isAdmin(a)
      ? `${a.address} is the platform’s admin. Acting as it is a named act: ` +
        'add --admin. A throwaway is `yak admin throwaway`.'
      : `${a.address} is not a test account. Acting as its owner ` +
        'is a named act: add --owner. A throwaway is `yak admin throwaway`.',
  )

// `use` remembers a test account and REFUSES every other kind, so the
// remembered default can never be the owner's or the admin's — the flag is
// the only door to either.
export let usable = (a: Account): Account => {
  if (isAdmin(a)) {
    throw new Refused(
      `${a.address} is the platform’s admin and is never made current. ` +
        'Reach it per command with --admin.',
    )
  }
  if (!isTest(a)) {
    throw new Refused(
      `${a.address} is an owner account and is never made current. ` +
        'Reach it per command with --owner.',
    )
  }
  return a
}

// The mark on every command that is not a throwaway's: whose acts these are.
// stderr, so a piped stdout stays the answer the caller asked for.
export let banner = (a: Account) =>
  isAdmin(a)
    ? `!! ADMIN ACCOUNT — ${a.address} — every act below is the platform ` +
      'admin’s, not the owner’s and not a test !!'
    : `!! OWNER ACCOUNT — ${a.address} — ` +
      'every act below is theirs, not a test !!'

// The accounts as a person reads them. No session value appears here, or
// anywhere else this module prints.
export let render = (all: Account[], current: string, at?: Account) =>
  all.length
    ? all.map((a) =>
      `${a == at ? '*' : ' '} ${a.name.padEnd(16)} ${a.address.padEnd(28)} ${
        isAdmin(a) ? 'ADMIN' : isTest(a) ? 'test' : 'OWNER'
      }${a.address == current ? ' · current' : ''}`
    ).join('\n')
    : 'no accounts — `yak admin throwaway` signs in as a new one'

// A fresh throwaway address. Short enough to type, random enough that two
// probes never land in one space.
export let throwaway = () => `probe-${crypto.randomUUID().slice(0, 6)}${BOT}`
