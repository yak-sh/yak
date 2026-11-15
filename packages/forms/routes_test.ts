// A form's door, asked as a page asks it: in JSON, and as a browser's
// native post.
import { type Bundle, graph } from '@yaks/graph'
import { formsDoc } from '@yaks/forms/vocab'
import { kernelDoc } from '@yaks/kernel/vocab'
import { docDoc } from '@yaks/doc'
import { loadVocab } from '@yaks/vocab'
import { ram } from '@yaks/ram'
import { equal, test } from '@yaks/testing'
import { formRules } from './rules.ts'
import { routes } from './routes.ts'

let vocab = loadVocab([kernelDoc, formsDoc, docDoc])
let fixture = async (form: Bundle['form'] = {}) => {
  let g = graph({ vocab, storage: ram(vocab), plugins: [formRules(() => 0)] })
  // The person a request is from and the row of the app's people they are.
  await g.apply([
    { entity: { eid: 'ann' }, doc: { title: 'Ann' } },
    { entity: { eid: 'ann-row' }, doc: { title: 'Ann' } },
    {
      entity: { eid: 'tea' },
      form,
      doc: { title: 'Tea', body: 'Bring a cup.' },
    },
    {
      entity: { eid: 'name' },
      question: { form: 'tea', label: 'Name', kind: 'line', required: true },
    },
  ])
  let [route] = routes({
    graph: g,
    who: (req) => {
      let by = req.headers.get('x-person')
      return by ? { by } : null
    },
  }, {
    now: () => 0,
    known: (person) =>
      Promise.resolve(
        person == 'ann'
          ? { entity: { eid: 'ann-row' }, individual: { first: 'Ann' } }
          : undefined,
      ),
  })
  let ask = (path: string, init: RequestInit = {}) =>
    Promise.resolve(
      route.handle(new Request(`https://a.test/app${path}`, init)),
    )
  let send = (body: unknown, headers: Record<string, string> = {}) =>
    ask('/api/form/tea', {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...headers },
      body: JSON.stringify(body),
    })
  // Each registration as who sent what, and whether it completed or is held.
  let filed = async () =>
    (await g.read('.registration&?completed&?held')).map((r) => {
      let { answers, submitter, person } = r.registration as Bundle
      return [
        answers,
        submitter,
        person,
        !!r.completed,
        (r.held as Bundle)?.why,
      ]
    })
  return { g, ask, send, filed }
}

test('GET shows the form a page draws, and nothing it does not', async () => {
  let { ask } = await fixture({ capacity: 2, notify: ['owner'] })
  let res = await ask('/api/form/tea')
  equal(res.headers.get('cache-control'), 'no-store')
  let shown = await res.json()
  equal([shown.doc, shown.form, shown.open, shown.questions.length], [
    { title: 'Tea', body: 'Bring a cup.' },
    { capacity: 2 },
    true,
    1,
  ])
  equal((await ask('/api/form/none')).status, 404)
  equal((await ask('/api/form/%E0')).status, 404)
  equal((await ask('/api/form/tea', { method: 'PUT' })).status, 405)
})

test('a sign-up is filed once per key, as whoever sent it', async () => {
  let { send, filed } = await fixture()
  let once = { 'idempotency-key': 'k' }
  equal((await send({ answers: { name: 'Sam' } }, once)).status, 204)
  equal((await send({ answers: { name: 'Sam' } }, once)).status, 204)
  equal(await filed(), [[
    { name: 'Sam' },
    undefined,
    undefined,
    true,
    undefined,
  ]])
})

test('what the door refuses it says in a sentence', async () => {
  let { send, filed } = await fixture()
  equal(await (await send({ answers: [] })).text(), 'Submit an answers object.')
  let res = await send({ answers: {} })
  equal([res.status, /required/.test(await res.text())], [400, true])
  equal(await filed(), [])
})

test('a sign-up taken for a bot’s is held, and a known person’s is not screened', async () => {
  let { send, filed } = await fixture()
  let trap = (name: string, headers = {}) =>
    send({ answers: { name }, signs: { trap: 'buy now' } }, headers)
  await trap('Bot')
  await trap('Ann', { 'x-person': 'ann' })
  equal(await filed(), [
    [{ name: 'Bot' }, undefined, undefined, false, 'trap'],
    [{ name: 'Ann' }, 'ann', 'ann-row', true, undefined],
  ])
})

test('a known person’s form comes filled in from their row', async () => {
  let { g, ask } = await fixture()
  await g.apply([{
    entity: { eid: 'name' },
    question: { fills: 'individual.first' },
  }])
  let mine = await ask('/api/form/tea', { headers: { 'x-person': 'ann' } })
  equal((await mine.json()).answers, { name: 'Ann' })
  equal((await (await ask('/api/form/tea')).json()).answers, undefined)
})

test('a native post is sent back to its page, told what the door said', async () => {
  let { ask, filed } = await fixture()
  let post = (body: string, referer: string) =>
    ask('/api/form/tea', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded', referer },
      body,
    })
  let told = (res: Response) => {
    let to = new URL(res.headers.get('location')!)
    return [
      res.status,
      to.pathname,
      JSON.parse(to.searchParams.get('yak-form')!),
    ]
  }
  let at = 'https://a.test/app/api/form/tea'
  equal(told(await post('name=Sam', 'https://a.test/app/join')), [
    303,
    '/app/join',
    {
      at,
      sent: true,
    },
  ])
  equal(told(await post('', 'https://elsewhere.test/')), [303, '/app/', {
    at,
    said: 'Answer every required question.',
  }])
  equal((await filed()).length, 1)
})
