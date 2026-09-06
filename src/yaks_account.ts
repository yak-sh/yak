// The yaks.app accounts this box is signed in as, and the rule that keeps an
// agent out of the owner's. A session lives in the MAIN checkout's gitignored
// `.env` beside STRIPE_OPERATOR_KEY — never in ~/.tasks, which is a git repo
// with a remote — so one sign-in serves every worktree and nothing follows the
// data repo out.
//
// The rule, and the reason this file exists at all: an ACCOUNT IS AN ADDRESS,
// and an address ending `@bot.yak.sh` is a test account. Everything else —
// including a session whose address was never recorded — is somebody's own,
// and reaching it takes `--owner` in the argv. There is deliberately no
// ambient path to an owner account: `current` refuses to hold one, so the
// pull toward the warm default lands on a throwaway every time (M-31946, and
// three corrections in one session before this existed).
//
// Nothing here ever renders a session value. `render` shows addresses and
// kinds; the token crosses only between the file and an http header — and the
// cookie's own name comes from token.ts rather than retyped, because a session
// pasted in by hand arrives as the whole `yak_session=…` pair a browser shows.
import { COOKIE } from './token.ts'

export let BOT = '@bot.yak.sh'

export type Account = {
  // The address it signed in as, '' when the session was pasted in by hand.
  address: string
  // The `yak_session` cookie value. Never printed.
  session: string
  // What to type for it: the address's local part, or 'owner' for an
  // address nobody recorded.
  name: string
}

// A test account is provably a throwaway: the bot domain and nothing else.
// An address we cannot see is NOT proof, so it reads as the owner's — the
// safe direction to be wrong in.
export let isTest = (a: Account) => a.address.endsWith(BOT)

// The storage key for an address. Uppercase, non-alphanumerics folded, so
// `probe-1a2b@bot.yak.sh` is one legal env name.
export let keyOf = (address: string) =>
  address.toUpperCase().replace(/[^A-Z0-9]+/g, '_')

let SESSION = /^YAKS_SESSION_(.+)$/
export let CURRENT = 'YAKS_CURRENT'
// The hand-rolled session that predates this file: an address nobody wrote
// down, so it answers to `owner` and takes `--owner` like any other.
export let LEGACY = 'YAKS_SESSION'

let line = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/

let unquoted = (v: string) =>
  /^(['"]).*\1$/.test(v.trim()) ? v.trim().slice(1, -1) : v.trim()

// The file as a map. Blank lines and comments are somebody else's business.
export let envOf = (text: string): Record<string, string> => {
  let out: Record<string, string> = {}
  for (let raw of text.split('\n')) {
    let m = line.exec(raw)
    if (m && !raw.trimStart().startsWith('#')) out[m[1]] = unquoted(m[2])
  }
  return out
}

// One key rewritten in place, appended when absent, dropped when the value is
// null — every other line of the file, including STRIPE_OPERATOR_KEY and the
// comments around it, comes back byte for byte.
export let setEnv = (
  text: string,
  key: string,
  value: string | null,
): string => {
  let lines = text.split('\n')
  let at = lines.findIndex((raw) =>
    !raw.trimStart().startsWith('#') && line.exec(raw)?.[1] == key
  )
  if (value == null) {
    if (at < 0) return text
    lines.splice(at, 1)
    return lines.join('\n')
  }
  if (at >= 0) {
    lines[at] = `${key}=${value}`
    return lines.join('\n')
  }
  // Append onto the last line rather than after a trailing blank, so the file
  // does not grow a blank line per sign-in.
  let end = lines.length && lines.at(-1) == '' ? lines.length - 1 : lines.length
  lines.splice(end, 0, `${key}=${value}`)
  return lines.join('\n')
}

export let localPart = (address: string) => address.split('@')[0]

// A stored session, however it was written down: the bare value, or the whole
// cookie pair somebody copied out of devtools.
export let sessionOf = (raw: string) =>
  raw.startsWith(`${COOKIE}=`) ? raw.slice(COOKIE.length + 1) : raw

export let accountsIn = (env: Record<string, string>): Account[] => {
  let out: Account[] = []
  for (let [key, session] of Object.entries(env)) {
    let m = SESSION.exec(key)
    if (!m || !session) continue
    let address = env[`YAKS_ADDRESS_${m[1]}`] ?? ''
    out.push({ address, session: sessionOf(session), name: localPart(address) })
  }
  if (env[LEGACY]) {
    out.push({ address: '', session: sessionOf(env[LEGACY]), name: 'owner' })
  }
  return out.sort((a, b) => a.name.localeCompare(b.name))
}

// The lines that store one account, and the one that forgets it.
export let saved = (
  text: string,
  address: string,
  session: string,
): string => {
  let key = keyOf(address)
  return setEnv(
    setEnv(text, `YAKS_SESSION_${key}`, session),
    `YAKS_ADDRESS_${key}`,
    address,
  )
}

export let forgotten = (text: string, a: Account): string => {
  if (!a.address) return setEnv(text, LEGACY, null)
  let key = keyOf(a.address)
  let out = setEnv(
    setEnv(text, `YAKS_SESSION_${key}`, null),
    `YAKS_ADDRESS_${key}`,
    null,
  )
  return envOf(out)[CURRENT] == a.address ? setEnv(out, CURRENT, null) : out
}

// What `--as` accepts: the whole address, or the local part when it names
// exactly one account. `owner` reaches the unrecorded session.
export let named = (all: Account[], want: string): Account[] =>
  all.filter((a) => a.address == want || a.name == want)

export class Refused extends Error {}

let say = (all: Account[]) =>
  all.length
    ? all.map((a) => `  ${a.name} — ${a.address || '?'}`).join('\n')
    : '  (none)'

// WHICH account a command runs as. `owner` is the argv flag, `current` the
// remembered test account. The whole point of the function: an owner-grade
// account is reachable only when `owner` is set, and `current` can never
// name one (see `usable`), so no chain of defaults arrives there.
export let pick = (
  all: Account[],
  want: { as?: string; owner?: boolean; current?: string },
): Account => {
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
    if (!isTest(hit[0]) && !want.owner) throw ownerRefusal(hit[0])
    return hit[0]
  }
  if (want.owner) {
    let theirs = all.filter((a) => !isTest(a))
    if (!theirs.length) {
      throw new Refused(
        'no owner account signed in — `yak login <address> --owner`',
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
    throw new Refused('no test account — `yak test` mints one and signs in')
  }
  throw new Refused(
    `${tests.length} test accounts and none current — \`yak use <name>\`, ` +
      `or --as:\n${say(tests)}`,
  )
}

let ownerRefusal = (a: Account) =>
  new Refused(
    `${a.address || a.name} is not a test account. Acting as its owner is a ` +
      'named act: add --owner. A throwaway is `yak test`.',
  )

// `use` remembers a test account and REFUSES an owner one, so the remembered
// default can never be the owner's — the flag is the only door.
export let usable = (a: Account): Account => {
  if (!isTest(a)) {
    throw new Refused(
      `${a.address || a.name} is an owner account and is never made current. ` +
        'Reach it per command with --owner.',
    )
  }
  return a
}

// The mark on every command run as somebody's own account. stderr, so a piped
// stdout stays the answer the caller asked for.
export let banner = (a: Account) =>
  `!! OWNER ACCOUNT — ${a.address || 'address unrecorded'} — ` +
  'every act below is theirs, not a test !!'

// The accounts as a person reads them. No session value appears here, or
// anywhere else this module prints.
export let render = (all: Account[], current: string, at?: Account) =>
  all.length
    ? all.map((a) =>
      `${a == at ? '*' : ' '} ${a.name.padEnd(16)} ${
        (a.address || '(address unrecorded)').padEnd(28)
      } ${isTest(a) ? 'test' : 'OWNER'}${
        a.address && a.address == current ? ' · current' : ''
      }`
    ).join('\n')
    : 'no accounts — `yak test` mints a throwaway and signs in'

// Where the `.env` is: the MAIN checkout's, so every worktree shares one
// sign-in and a throwaway worktree does not carry a session away with it.
// YAKS_ENV overrides for a probe.
export let envPath = (env = (k: string) => Deno.env.get(k)): string => {
  let said = env('YAKS_ENV')
  if (said) return said
  let out = new Deno.Command('git', {
    args: ['worktree', 'list', '--porcelain'],
    cwd: new URL('../', import.meta.url).pathname,
    stdout: 'piped',
    stderr: 'null',
  }).outputSync()
  let main = new TextDecoder().decode(out.stdout).split('\n')[0]
  if (!out.success || !main.startsWith('worktree ')) {
    throw new Refused('not in a git checkout — set YAKS_ENV to the .env path')
  }
  return `${main.slice('worktree '.length)}/.env`
}

export let readEnv = (path: string) => {
  try {
    return Deno.readTextFileSync(path)
  } catch {
    return ''
  }
}

// A session file is a credential: the owner's shell reads it, nobody else.
export let writeEnv = (path: string, text: string) => {
  Deno.writeTextFileSync(path, text, { mode: 0o600 })
}

// A fresh throwaway address. Short enough to type, random enough that two
// probes never land in one space.
export let throwaway = () => `probe-${crypto.randomUUID().slice(0, 6)}${BOT}`
