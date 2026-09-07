// The prompts a person picks by name (prompts.ts, T-32981). What can rot here
// is the text: a `say` is a message written in the person's voice and sent
// straight to a model, so a hole left unfilled, a name nobody can pick twice,
// or a sentence that only reads when every argument was given is the whole
// failure. The door's own shape — the -32602s, the message envelope — is held
// in workerd by mcp_test.ts.
import { assert, assertEquals } from '@std/assert'
import { IDEAS, missing, promptOf, PROMPTS } from './prompts.ts'

Deno.test('a prompt is pickable by name, once', () => {
  let names = PROMPTS.map((p) => p.name)
  assertEquals(new Set(names).size, names.length)
  for (let p of PROMPTS) {
    assert(/^[a-z][a-z_-]*$/.test(p.name), p.name)
    assertEquals(promptOf(p.name), p)
  }
  assertEquals(promptOf('nope'), null)
})

// Picked bare, no optional argument leaves a template hole in the message.
Deno.test('a prompt reads with nothing filled in', () => {
  for (let p of PROMPTS) {
    for (let made of [null, [], [{ title: 'Chores', url: 'https://x/c/' }]]) {
      let said = p.say(
        Object.fromEntries(
          p.arguments.filter((a) => a.required).map((a) => [a.name, 'a thing']),
        ),
        made,
      )
      assert(
        !/undefined|\{\{|\$\{/.test(said),
        `${p.name} left a hole: ${said}`,
      )
    }
  }
})

Deno.test('what the person filled in is what the message says', () => {
  let make = promptOf('make')!
  assert(make.say({ what: 'a chore board' }, []).includes('a chore board'))
  let fix = promptOf('fix')!
  assert(fix.say({ app: 'chores' }, []).includes('chores'))
  assert(fix.say({}, []).includes('my apps'))
  let share = promptOf('share')!
  let asked = share.say({ app: 'chores', who: 'maya@example.com' }, [])
  assert(asked.includes('chores') && asked.includes('maya@example.com'))
  // An `about` nobody wrote leaves no empty line behind.
  let bare = promptOf('publish')!.say({ app: 'chores' }, [])
  assert(!bare.includes('The line to offer it under'))
  assert(
    promptOf('publish')!.say({ app: 'c', about: 'A board' }, []).includes(
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

// The ideas door (T-34557) says where the person stands, three ways: their own
// apps to build on, the first-app line, and — signed out — where signing in is,
// since that is what turns an idea into an app.
Deno.test('the ideas prompt says where the person stands', () => {
  let mine = IDEAS.say({}, [
    { title: 'Recipes', url: 'https://jeff.yaks.app/recipes/' },
    { title: 'Chores', url: 'https://jeff.yaks.app/chores/' },
  ])
  assert(mine.includes('- Recipes — https://jeff.yaks.app/recipes/'))
  assert(mine.includes('- Chores — https://jeff.yaks.app/chores/'))
  assert(!mine.includes('https://yaks.app/login'))
  let first = IDEAS.say({}, [])
  assert(first.includes('I have not made anything there yet'))
  assert(!first.includes('https://yaks.app/login'))
  let stranger = IDEAS.say({}, null)
  assert(stranger.includes('I have not signed in there yet'))
  assert(stranger.includes('https://yaks.app/login'))
  // The question is the same one either way, and the guide is pointed at
  // rather than copied.
  for (let said of [mine, first, stranger]) {
    assert(said.startsWith("Any yaks.app ideas you think I'd like"))
    assert(said.includes('https://yaks.app/guide.md'))
    assert(!said.includes('Yaks '))
  }
})
