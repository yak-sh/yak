import { equal, test } from '@yaks/testing'
import { connector, fresh, signIn } from './probe.ts'
import type { Env } from './env.ts'
import { signupTools } from './operator-signup.ts'

let env!: Env
let k = await fresh({}, (value) => {
  env = value
})
let owner = await signIn(k), agent = connector(k, owner.cookie)
let made = await agent.answer('app_new', {
  slug: 'forms',
  title: 'Forms',
  access: 'private',
})
await agent.tool('app_files', {
  app: 'forms',
  files: [{ path: 'index.html', content: '<h1>Forms</h1>' }],
})
await agent.tool('app_deploy', { app: 'forms' })
await agent.tool('app_new', { slug: 'draft', title: 'Unpublished' })
let form = crypto.randomUUID(), question = crypto.randomUUID()
await agent.tool('graph_apply', {
  app: 'forms',
  entities: [
    { entity: { eid: form }, form: {}, doc: { title: 'Sign up' } },
    {
      entity: { eid: question },
      question: { form, label: 'Your name', kind: 'line', required: true },
    },
  ],
})
let space = (await k.dir.seats(owner.person))[0].space
let person = crypto.randomUUID()
let run = async (name: string, args = {}) =>
  JSON.parse(
    await signupTools(env, space, person, '+12695550142').find((t) =>
      t.name == 'signup_' + name
    )!.run(args) as string,
  )
let forms = await run('forms')
let started = (await run('start', { app: 'forms', form }))[0].result
let answered = (await run('answer', {
  app: 'forms',
  registration: started.registration,
  path: [question],
  value: 'Ann',
}))[0].result
let mine = await run('mine')
let stored = (await agent.answer('graph_query', {
  app: 'forms',
  query: '.registration&*',
})).rows
let other = JSON.parse(
  await signupTools(env, space, crypto.randomUUID(), '+12695550143').find((t) =>
    t.name == 'signup_mine'
  )!.run({}) as string,
)

test('a private app’s kernel form door serves a vouched stranger without app read access', () => {
  equal(forms, [{
    app: 'forms',
    result: [{ entity: { eid: form }, doc: { title: 'Sign up' } }],
  }])
  equal((stored[0].completed as { by: string }).by, made.value!.eid)
  equal(started.next.path, [question])
  equal(answered.completed, true)
  equal(answered.next, null)
  equal(mine[0].result[0].registration, started.registration)
  equal(other, [])
})
