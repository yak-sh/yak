// The rule this CLI exists to hold: a test account is the default and the
// owner's takes a named flag. Everything below is that rule, plus where the
// accounts are read from: the sessions a vault keeps, and the remembered
// default beside the bearer.
import { assertEquals, assertStringIncludes, assertThrows } from '@std/assert'
import { ramVault, secretEid } from '@yaks/secrets'
import { ADMIN } from '../../workers/yak/lib/bots.ts'
import {
  type Account,
  accountsIn,
  banner,
  choose,
  current,
  isAdmin,
  isTest,
  pick,
  Refused,
  render,
  sessionName,
  throwaway,
  usable,
} from './accounts.ts'

let bot = (name: string, session = 'tok'): Account => ({
  address: `${name}@bot.yak.sh`,
  session,
  name,
})
let jeff: Account = { address: 'jeff@yak.sh', session: 'tok', name: 'jeff' }
let admin: Account = { address: ADMIN, session: 'tok', name: 'admin' }

Deno.test('an address is what makes an account a throwaway', () => {
  assertEquals(isTest(bot('probe')), true)
  assertEquals(isTest(jeff), false)
  assertStringIncludes(throwaway(), '@bot.yak.sh')
})

Deno.test('no chain of defaults reaches an owner account', () => {
  let all = [bot('probe'), jeff]
  // current names the owner's? still the throwaway.
  assertEquals(pick(all, { current: 'jeff' }).address, 'probe@bot.yak.sh')
  // asked for by name without the flag: refused, and the refusal teaches.
  let no = assertThrows(() => pick(all, { as: 'jeff' }), Refused)
  assertStringIncludes((no as Error).message, '--owner')
  assertStringIncludes((no as Error).message, 'yak admin throwaway')
  // with the flag, either spelling reaches it.
  assertEquals(pick(all, { as: 'jeff', owner: true }).address, 'jeff@yak.sh')
  assertEquals(pick(all, { owner: true }).address, 'jeff@yak.sh')
})

Deno.test('with no throwaway signed in, the answer is how to mint one', () => {
  let no = assertThrows(() => pick([jeff], {}), Refused)
  assertStringIncludes((no as Error).message, 'yak admin throwaway')
  let many = assertThrows(
    () => pick([bot('a'), bot('b')], {}),
    Refused,
  )
  assertStringIncludes((many as Error).message, 'yak admin use')
  assertEquals(pick([bot('a'), bot('b')], { current: 'b' }).name, 'b')
})

// The platform's admin wears a bot address so its sign-in codes land in the
// graph, and is a throwaway in nobody's eyes: its own flag reaches it, no
// default does, and `--owner` never lands on it either (D-35373).
Deno.test('the admin is neither a throwaway nor anybody’s own', () => {
  assertEquals(isAdmin(admin), true)
  assertEquals(isTest(admin), false)
  assertEquals(isAdmin(bot('probe')), false)
  let all = [admin, bot('probe'), jeff]
  assertEquals(pick(all, {}).address, 'probe@bot.yak.sh')
  assertEquals(pick(all, { current: 'admin' }).address, 'probe@bot.yak.sh')
  assertEquals(pick(all, { owner: true }).address, 'jeff@yak.sh')
  // Asked for by name without the flag: refused, and the refusal teaches.
  let no = assertThrows(() => pick(all, { as: 'admin' }), Refused)
  assertStringIncludes((no as Error).message, '--admin')
  // With the flag, by name or by itself.
  assertEquals(pick(all, { as: 'admin', admin: true }).address, ADMIN)
  assertEquals(pick(all, { admin: true }).address, ADMIN)
  // The owner's flag is not the admin's, either way round.
  assertThrows(() => pick(all, { as: 'admin', owner: true }), Refused)
  assertThrows(() => pick(all, { as: 'jeff', admin: true }), Refused)
  let both = assertThrows(
    () => pick(all, { owner: true, admin: true }),
    Refused,
  )
  assertStringIncludes((both as Error).message, 'pick one')
  let none = assertThrows(() => pick([bot('p')], { admin: true }), Refused)
  assertStringIncludes((none as Error).message, 'yak admin login')
})

Deno.test('an owner account is never made the remembered default', () => {
  assertEquals(usable(bot('probe')).name, 'probe')
  assertThrows(() => usable(jeff), Refused)
  assertStringIncludes(
    (assertThrows(() => usable(admin), Refused) as Error).message,
    '--admin',
  )
})

Deno.test('acting as the owner is marked, and no session is ever printed', () => {
  assertStringIncludes(banner(jeff), 'OWNER ACCOUNT')
  assertStringIncludes(banner(jeff), 'jeff@yak.sh')
  assertStringIncludes(banner(admin), 'ADMIN ACCOUNT')
  assertStringIncludes(banner(admin), ADMIN)
  let out = render([bot('probe', 'sekret'), jeff, admin], 'probe@bot.yak.sh')
  assertStringIncludes(out, 'OWNER')
  assertStringIncludes(out, 'ADMIN')
  assertStringIncludes(out, 'current')
  assertEquals(out.includes('sekret'), false)
  assertEquals(out.includes('tok'), false)
})

// What the vault keeps under a session's name is an account. Any other secret
// beside it is not, and neither is a session bound to 1Password rather than
// held: nothing here can read one on the spot.
Deno.test('the vault’s sessions read back as accounts', () => {
  let vault = ramVault()
  let keep = (name: string, value?: string) =>
    vault.seal(secretEid(name), { name, handle: 'h', value })
  keep(sessionName('probe@bot.yak.sh'), 'fresh.token')
  keep(sessionName('jeff@yak.sh'), 'owner.token')
  keep('CLOUDFLARE_EMAIL_TOKEN', 'not.a.session')
  keep(sessionName('op@bot.yak.sh'))
  assertEquals(accountsIn(vault).map((a) => [a.name, a.address, a.session]), [
    ['jeff', 'jeff@yak.sh', 'owner.token'],
    ['probe', 'probe@bot.yak.sh', 'fresh.token'],
  ])
})

Deno.test('the remembered default is written, read and forgotten', () => {
  let home = Deno.makeTempDirSync()
  let dir = `${home}/yaks`
  try {
    assertEquals(current(dir), '')
    choose('probe@bot.yak.sh', dir)
    assertEquals(current(dir), 'probe@bot.yak.sh')
    choose(null, dir)
    choose(null, dir)
    assertEquals(current(dir), '')
  } finally {
    Deno.removeSync(home, { recursive: true })
  }
})
