// The owner plugin's verbs at their pure seam: what one refuses before it
// touches an account or the network. The rest of a verb is the wire
// (yaks_api_test.ts) and the account rule (yaks_account_test.ts); what is left
// here is the argv a person actually types, and that the rule survived the
// move onto the `yak` plugin seam.
import { assert, assertRejects } from '@std/assert'
import type { Ctx } from '@yaks/cli'
import { owner, verbs } from './yak.ts'
import { Refused } from './yaks_account.ts'

let verb = (name: string) => verbs.find((v) => v.name == name)!

let ctx = (args: string[]): Ctx => ({
  host: 'yaks.test',
  word: '',
  args,
  json: false,
  help: false,
  ask: () => Promise.resolve({}),
  reads: { file: () => '', stdin: () => '' },
  out: () => {},
  note: () => {},
  plugins: [owner],
})

let ran = (name: string, args: string[]) =>
  Promise.resolve(verb(name).run(ctx(args)))

// The fee is the PLATFORM's (workers/yak/sell.ts `fees`), so reading it or
// moving it is a named act — never something a default or a throwaway arrives
// at. Both refusals land before any account is read, so a typo costs nothing.
Deno.test('the fee verb refuses a rate nobody named as the owner', async () => {
  await assertRejects(() => ran('fee', ['250']), Refused, '--owner')
  await assertRejects(() => ran('fee', []), Refused)
})

Deno.test('the fee verb refuses anything but whole basis points', async () => {
  for (let no of ['2.5', '-5', 'lots', '2,50']) {
    await assertRejects(
      () => ran('fee', [no, '--owner']),
      Error,
      'basis points',
    )
  }
})

// Signing in AS somebody is the same named act, and it is refused before a
// letter goes anywhere.
Deno.test('login refuses a non-test address that nobody named as the owner', async () => {
  await assertRejects(
    () => ran('login', ['you@example.com']),
    Refused,
    '--owner',
  )
})

// The plugin sits first, so these two words mean what this box means by them
// — and the bearer half of each is still reachable, by what it is handed.
Deno.test('the account verbs are the ones this box adds', () => {
  let names = verbs.map((v) => v.name)
  for (let want of ['test', 'whoami', 'accounts', 'login', 'use', 'logout']) {
    assert(names.includes(want), `${want} is missing from ${names.join(' ')}`)
  }
  for (let want of ['link', 'delete', 'fee', 'query', 'tool']) {
    assert(names.includes(want), `${want} is missing from ${names.join(' ')}`)
  }
})
