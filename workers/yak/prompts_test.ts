// The prompts a person picks by name (prompts.ts, T-32981). What can rot here
// is the text: a `say` is a message written in the person's voice and sent
// straight to a model, so a hole left unfilled, a name nobody can pick twice,
// or a sentence that only reads when every argument was given is the whole
// failure. The door's own shape — the -32602s, the message envelope — is held
// in workerd by mcp_test.ts.
import { assert, assertEquals } from '@std/assert'
import { missing, promptOf, PROMPTS } from './prompts.ts'

Deno.test('a prompt is pickable by name, once', () => {
  let names = PROMPTS.map((p) => p.name)
  assertEquals(new Set(names).size, names.length)
  for (let p of PROMPTS) {
    assert(/^[a-z][a-z_]*$/.test(p.name), p.name)
    assert(p.title && p.description.length > 40, p.name)
    assertEquals(promptOf(p.name), p)
  }
  assertEquals(promptOf('nope'), null)
  // Few on purpose: a menu a person reads is not a tool list.
  assert(PROMPTS.length <= 6, 'the menu is growing')
})

// Picked bare, with nothing filled in, every optional prompt still has to read
// as a sentence — the fallback is what a person sees when they pick from a
// menu and type nothing.
Deno.test('a prompt reads with nothing filled in', () => {
  for (let p of PROMPTS) {
    let said = p.say(
      Object.fromEntries(
        p.arguments.filter((a) => a.required).map((a) => [a.name, 'a thing']),
      ),
    )
    assert(said.trim().length > 60, p.name)
    assert(!/undefined|\{\{|\$\{/.test(said), `${p.name} left a hole: ${said}`)
    assert(said.includes('yaks.app'), `${p.name} never says where`)
  }
})

Deno.test('what the person filled in is what the message says', () => {
  let make = promptOf('make')!
  assert(make.say({ what: 'a chore board' }).includes('a chore board'))
  let fix = promptOf('fix')!
  assert(fix.say({ app: 'chores' }).includes('chores'))
  assert(fix.say({}).includes('my apps'))
  let share = promptOf('share')!
  let asked = share.say({ app: 'chores', who: 'maya@example.com' })
  assert(asked.includes('chores') && asked.includes('maya@example.com'))
  // An `about` nobody wrote leaves no empty line behind.
  let bare = promptOf('publish')!.say({ app: 'chores' })
  assert(!bare.includes('The line to offer it under'))
  assert(
    promptOf('publish')!.say({ app: 'c', about: 'A board' }).includes(
      'A board',
    ),
  )
})

Deno.test('a required argument is named when it is missing', () => {
  let make = promptOf('make')!
  assertEquals(missing(make, {}), ['what'])
  assertEquals(missing(make, { what: '   ' }), ['what'])
  assertEquals(missing(make, { what: 'a recipe box' }), [])
  for (let p of PROMPTS) if (p.name != 'make') assertEquals(missing(p, {}), [])
})
