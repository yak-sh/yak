// The rule this CLI exists to hold: a test account is the default and the
// owner's takes a named flag. Everything below is that rule, plus the promise
// that editing `.env` never disturbs a line that isn't ours.
import { assertEquals, assertStringIncludes, assertThrows } from '@std/assert'
import {
  type Account,
  accountsIn,
  ADMIN,
  banner,
  envOf,
  forgotten,
  isAdmin,
  isTest,
  keyOf,
  pick,
  recorded,
  Refused,
  render,
  saved,
  sessionOf,
  setEnv,
  throwaway,
  usable,
} from './yaks_account.ts'

let bot = (name: string, session = 'tok'): Account => ({
  address: `${name}@bot.yak.sh`,
  session,
  name,
})
let jeff: Account = { address: 'jeff@yak.sh', session: 'tok', name: 'jeff' }
let legacy: Account = { address: '', session: 'tok', name: 'owner' }
let admin: Account = { address: ADMIN, session: 'tok', name: 'admin' }

let ENV = `# dotenv
STRIPE_OPERATOR_KEY=sk_live_keepme
YAKS_SESSION=legacy.token
`

Deno.test('an address is what makes an account a throwaway', () => {
  assertEquals(isTest(bot('probe')), true)
  assertEquals(isTest(jeff), false)
  // An address nobody recorded is NOT proof of a throwaway.
  assertEquals(isTest(legacy), false)
  assertEquals(keyOf('probe-1a2b@bot.yak.sh'), 'PROBE_1A2B_BOT_YAK_SH')
  assertStringIncludes(throwaway(), '@bot.yak.sh')
})

Deno.test('no chain of defaults reaches an owner account', () => {
  let all = [bot('probe'), jeff]
  // current names the owner's? still the throwaway.
  assertEquals(pick(all, { current: 'jeff' }).address, 'probe@bot.yak.sh')
  // asked for by name without the flag: refused, and the refusal teaches.
  let no = assertThrows(() => pick(all, { as: 'jeff' }), Refused)
  assertStringIncludes((no as Error).message, '--owner')
  assertStringIncludes((no as Error).message, 'yak test')
  // with the flag, either spelling reaches it.
  assertEquals(pick(all, { as: 'jeff', owner: true }).address, 'jeff@yak.sh')
  assertEquals(pick(all, { owner: true }).address, 'jeff@yak.sh')
  // the legacy hand-rolled session is owner-grade too.
  assertThrows(() => pick([bot('p'), legacy], { as: 'owner' }), Refused)
  assertEquals(pick([bot('p'), legacy], { owner: true }).name, 'owner')
})

Deno.test('with no throwaway signed in, the answer is how to mint one', () => {
  let no = assertThrows(() => pick([jeff], {}), Refused)
  assertStringIncludes((no as Error).message, 'yak test')
  let many = assertThrows(
    () => pick([bot('a'), bot('b')], {}),
    Refused,
  )
  assertStringIncludes((many as Error).message, 'yak use')
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
  assertStringIncludes((none as Error).message, 'yak login')
})

Deno.test('an owner account is never made the remembered default', () => {
  assertEquals(usable(bot('probe')).name, 'probe')
  assertThrows(() => usable(jeff), Refused)
  assertThrows(() => usable(legacy), Refused)
  assertStringIncludes(
    (assertThrows(() => usable(admin), Refused) as Error).message,
    '--admin',
  )
})

Deno.test('acting as the owner is marked, and no session is ever printed', () => {
  assertStringIncludes(banner(jeff), 'OWNER ACCOUNT')
  assertStringIncludes(banner(jeff), 'jeff@yak.sh')
  assertStringIncludes(banner(legacy), 'address unrecorded')
  assertStringIncludes(banner(admin), 'ADMIN ACCOUNT')
  assertStringIncludes(banner(admin), ADMIN)
  let out = render(
    [bot('probe', 'sekret'), jeff, legacy, admin],
    'probe@bot.yak.sh',
  )
  assertStringIncludes(out, 'OWNER')
  assertStringIncludes(out, 'ADMIN')
  assertStringIncludes(out, 'current')
  assertEquals(out.includes('sekret'), false)
  assertEquals(out.includes('tok'), false)
})

Deno.test('.env keeps every line that is not ours', () => {
  let text = saved(ENV, 'probe@bot.yak.sh', 'fresh.token')
  let env = envOf(text)
  assertEquals(env.STRIPE_OPERATOR_KEY, 'sk_live_keepme')
  assertEquals(env.YAKS_SESSION, 'legacy.token')
  assertEquals(env.YAKS_SESSION_PROBE_BOT_YAK_SH, 'fresh.token')
  assertEquals(env.YAKS_ADDRESS_PROBE_BOT_YAK_SH, 'probe@bot.yak.sh')
  assertStringIncludes(text, '# dotenv')
  // A second sign-in rewrites in place rather than appending a twin.
  let again = envOf(saved(text, 'probe@bot.yak.sh', 'newer.token'))
  assertEquals(again.YAKS_SESSION_PROBE_BOT_YAK_SH, 'newer.token')
  assertEquals(
    saved(text, 'probe@bot.yak.sh', 'newer.token').split('YAKS_SESSION_')
      .length - 1,
    1,
  )
})

Deno.test('a session written down as a whole cookie pair still reads', () => {
  assertEquals(sessionOf('yak_session=body.mac'), 'body.mac')
  assertEquals(sessionOf('body.mac'), 'body.mac')
  let all = accountsIn(envOf('YAKS_SESSION=yak_session=body.mac\n'))
  assertEquals(all[0].session, 'body.mac')
})

Deno.test('.env reads back as accounts, legacy included', () => {
  let text = saved(ENV, 'probe@bot.yak.sh', 'fresh.token')
  let all = accountsIn(envOf(text))
  assertEquals(all.map((a) => a.name), ['owner', 'probe'])
  assertEquals(all.map((a) => a.address), ['', 'probe@bot.yak.sh'])
  // Forgetting takes both lines and the current mark with it.
  let gone = envOf(
    forgotten(
      setEnv(text, 'YAKS_CURRENT', 'probe@bot.yak.sh'),
      all[1],
    ),
  )
  assertEquals(gone.YAKS_SESSION_PROBE_BOT_YAK_SH, undefined)
  assertEquals(gone.YAKS_ADDRESS_PROBE_BOT_YAK_SH, undefined)
  assertEquals(gone.YAKS_CURRENT, undefined)
  assertEquals(gone.STRIPE_OPERATOR_KEY, 'sk_live_keepme')
  // Forgetting the legacy one takes the bare key.
  assertEquals(envOf(forgotten(text, all[0])).YAKS_SESSION, undefined)
})

Deno.test('an address learned for the legacy session re-keys it and drops the legacy line', () => {
  let all = accountsIn(envOf(ENV))
  let text = recorded(ENV, all[0], 'jeff@yak.sh')
  let env = envOf(text)
  assertEquals(env.YAKS_SESSION_JEFF_YAK_SH, 'legacy.token')
  assertEquals(env.YAKS_ADDRESS_JEFF_YAK_SH, 'jeff@yak.sh')
  assertEquals(env.YAKS_SESSION, undefined)
  assertEquals(env.STRIPE_OPERATOR_KEY, 'sk_live_keepme')
  // A keyed session whose address line went missing keeps the key it has:
  // only the line this session came in on is dropped.
  let other = accountsIn(envOf('YAKS_SESSION_OLD=other.token\n'))[0]
  let kept = envOf(recorded(ENV, other, 'her@example.com'))
  assertEquals(kept.YAKS_SESSION, 'legacy.token')
  assertEquals(kept.YAKS_SESSION_HER_EXAMPLE_COM, 'other.token')
})
