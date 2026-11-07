// The data editor through the whole kernel (probe.ts `kernel`): its door, then
// public/data.js driven on a linkedom document over the served client, as a
// clerk would use it on a township's notices, meetings and links.
import { test, until } from '@yaks/testing'
import { assert, assertEquals, assertStringIncludes } from '@std/assert'
import { parseHTML } from 'linkedom'
import {
  accepted,
  browser,
  connector,
  kernel,
  seed,
  signIn,
  unique,
} from './probe.ts'
import { fields, kinds, open, patch, title } from './public/data.js'

let k = await kernel()
let space = unique('township')
let them = await seed(k, [{ slug: space, apps: ['site', 'recipes'] }])
let host = `${space}.yaks.app`
let agent = connector(k, them.cookie)

let file = { type: 'string', ref: 'blob', death: 'keep' }
let words = {
  $defs: {
    announcement: {
      description: 'What the township tells its residents.',
      properties: {
        posted: { type: 'string', format: 'date-time' },
        pinned: { type: 'boolean' },
      },
    },
    meeting: {
      properties: {
        held: { type: 'string', format: 'date-time' },
        agenda: file,
        minutes: file,
        attendance: { type: 'number' },
      },
    },
    link: {
      properties: {
        url: { type: 'string', format: 'uri' },
        meeting: { type: 'string', ref: 'meeting', death: 'detach' },
        tags: { type: 'array', items: { type: 'string' } },
      },
    },
    tap: { edge: true, properties: {} },
  },
}
let at = { space, app: 'site' }
await agent.tool('app_files', {
  ...at,
  files: [
    { path: 'index.html', content: '<!doctype html><h1>Township</h1>' },
    { path: 'vocab.json', content: JSON.stringify(words) },
  ],
})
await agent.tool('app_deploy', at)

let dir = Deno.makeTempDirSync({ prefix: 'tasks-data-editor-' })
Deno.writeTextFileSync(
  `${dir}/client.js`,
  await (await k.at(host, '/site/api/client.js')).text(),
)
let served = await import(`file://${dir}/client.js`)
Deno.removeSync(dir, { recursive: true })

// One person's page: the editor on a document of its own, and what a person
// does to it. The drafts are a desk in memory; @yaks/draft has its own tests.
let page = (cookie: string) => {
  let door = browser(k, host, cookie)
  let store = served.store(`${door.origin}/site/api/`)
  let typed = new Map<string, string>()
  // The page's work is its calls to the store: it has settled when none is
  // in flight. A handler starts its call as it is dispatched, and the next
  // call of a chain starts in the microtasks before `until` looks again.
  let busy = 0
  let held =
    <A extends unknown[], T>(f: (...a: A) => Promise<T>) => (...a: A) => {
      busy++
      return f(...a).finally(() => busy--)
    }
  let settled = () => until(() => busy == 0, { label: 'the page’s calls' })
  let { document } = parseHTML(
    '<!doctype html><html><body><div id="data"></div></body></html>',
  )
  let root = document.getElementById('data')!
  let hear: () => unknown = () => {}
  let view = {
    location: { hash: '' },
    addEventListener: (_: string, fn: () => unknown) => hear = fn,
  }
  let client = {
    me: held(store.me),
    query: held(store.query),
    apply: held(store.apply),
    upload: held(store.upload),
    draftEid: served.draftEid,
    drafts: () => ({
      text: (p: string) => typed.get(p) ?? '',
      type: (p: string, text: string) => typed.set(p, text),
      spend: held(async (p: string, also: unknown[] = []) => {
        if (also.length) await store.apply(also)
        typed.delete(p)
        return true
      }),
    }),
  }
  let go = async (hash: string) => {
    view.location.hash = hash
    await hear()
    await settled()
  }
  let field = (name: string) =>
    root.querySelector(`[name="${name}"]`) as HTMLInputElement
  let press = async (text: string) => {
    let was = view.location.hash
    let b = [...root.querySelectorAll('button')]
      .find((b) => b.textContent == text)!
    if (b.type == 'submit') {
      root.querySelector('form')!.dispatchEvent(
        new document.defaultView!.Event('submit', { cancelable: true }),
      )
    } else b.dispatchEvent(new document.defaultView!.Event('click'))
    await settled()
    if (view.location.hash != was) await hear()
    await settled()
  }
  return {
    root,
    typed,
    go,
    field,
    press,
    fill: (name: string, value: string) => {
      field(name).value = value
      root.querySelector('form')!.dispatchEvent(
        new document.defaultView!.Event('input'),
      )
    },
    start: () => open({ root, client, words, view, files: '/site/api/blob/' }),
    rows: () =>
      [...root.querySelectorAll('.Rows_Name')].map((r) => r.textContent),
    text: () => root.textContent,
    stop: () => door.stop(),
  }
}

test('the door sends a stranger to sign in and hides from who holds nothing', async () => {
  let out = await k.at(host, '/site/_web/data', { redirect: 'manual' })
  assertEquals(out.status, 303)
  assertStringIncludes(out.headers.get('location') ?? '', '/login')
  let stranger = await signIn(k)
  let none = await k.at(host, '/site/_web/data', {
    headers: { cookie: stranger.cookie },
  })
  assertEquals(none.status, 404)
})

test('the page carries the app’s words, escaped, and the script is served', async () => {
  let res = await k.at(host, '/site/_web/data', {
    headers: { cookie: them.cookie },
  })
  assertEquals(res.status, 200)
  let html = await res.text()
  assertStringIncludes(html, '"announcement"')
  assertStringIncludes(html, '/site/api/client.js')
  assert(html.includes('class="Data"'))
  let script = await k.at(host, '/site/_web/data.js', {
    headers: { cookie: them.cookie },
  })
  assertEquals(script.status, 200)
  await script.body?.cancel()
})

test('a row is added, listed, edited, linked, given a file and removed', async () => {
  let p = page(them.cookie)
  await p.start()
  // Everything the app keeps, without its link words.
  assertEquals(p.rows(), ['Announcement', 'Meeting', 'Link'])

  await p.go('#announcement/new')
  p.fill('doc.title', 'Road closed')
  p.fill('doc.body', 'Until Friday.\nUse Elm St.')
  assert(p.typed.size == 1, 'what is typed is kept before it is saved')
  await p.press('Save')
  assertEquals(p.rows(), ['Road closed'])
  assertEquals(p.typed.size, 0)

  // A meeting with its agenda, uploaded through the door.
  await p.go('#meeting/new')
  p.fill('doc.title', 'October meeting')
  p.fill('meeting.attendance', '12')
  p.fill('meeting.held', '2026-10-05T19:00')
  await p.press('Save')
  assertEquals(p.rows(), ['October meeting'])

  // A link picks the meeting from its rows.
  await p.go('#link/new')
  let choices = [...p.field('link.meeting').querySelectorAll('option')]
    .map((o) => o.textContent)
  assertEquals(choices, ['None', 'October meeting'])
  p.fill('doc.title', 'Minutes archive')
  p.fill('link.url', 'https://example.com/minutes')
  p.fill('link.tags', 'records\narchive')
  p.field('link.meeting').querySelectorAll('option')[1]
    .setAttribute('selected', '')
  await p.press('Save')

  let reader = served.store(`${browser(k, host, them.cookie).origin}/site/api/`)
  let [link] = await reader.query('.link&?doc')
  assertEquals(link.link.tags, ['records', 'archive'])
  assertEquals(link.link.url, 'https://example.com/minutes')
  let [meeting] = await reader.query('.meeting&?doc')
  assertEquals(meeting.meeting.attendance, 12)
  assertEquals(new Date(meeting.meeting.held).getMinutes(), 0)

  // An edit writes what changed and nothing else.
  await p.go(`#meeting/${meeting.entity.eid}`)
  assertEquals(p.field('meeting.attendance').value, '12')
  let up = await k.at(host, '/site/api/blob', {
    method: 'POST',
    headers: {
      cookie: them.cookie,
      'content-type': 'application/pdf',
      'x-yak-name': 'agenda.pdf',
    },
    body: new TextEncoder().encode('%PDF-1.4 agenda'),
  })
  let { eid: sha } = await up.json()
  p.fill('meeting.agenda', sha)
  await p.press('Save')
  await p.go(`#meeting/${meeting.entity.eid}`)
  assertStringIncludes(p.text(), 'agenda.pdf')
  assertEquals(
    p.root.querySelector('.Form_Line a')?.getAttribute('href'),
    `/site/api/blob/${sha}`,
  )
  let [again] = await reader.query('.meeting')
  assertEquals(again.meeting.agenda, sha)
  assertEquals(again.meeting.held, meeting.meeting.held)

  await p.go('')
  assertStringIncludes(p.text(), 'Announcement1 row')
  await p.go('#announcement')
  let eid = p.root.querySelector('.Rows_Name')!.getAttribute('href')!
  await p.go(eid)
  await p.press('Delete')
  assertEquals(
    [...p.root.querySelectorAll('button')].map((b) => b.textContent).at(-1),
    'Press again to delete',
  )
  await p.press('Press again to delete')
  await p.go('#announcement')
  assertStringIncludes(p.text(), 'Nothing here yet')
  p.stop()
})

test('a form says what the store refused and keeps what was typed', async () => {
  let p = page(them.cookie)
  await p.start()
  await p.go('#meeting/new')
  p.fill('meeting.attendance', 'twelve')
  await p.press('Save')
  assertStringIncludes(p.text(), 'Attendance should be a number')
  assertEquals(p.field('meeting.attendance').value, 'twelve')
  p.stop()
})

test('what was typed and not saved comes back, and can be discarded', async () => {
  let p = page(them.cookie)
  await p.start()
  await p.go('#announcement/new')
  p.fill('doc.title', 'Half a thought')
  await p.go('#announcement')
  await p.go('#announcement/new')
  assertEquals(p.field('doc.title').value, 'Half a thought')
  assertStringIncludes(p.text(), 'unsaved changes are back')
  await p.press('Discard changes')
  assertEquals(p.field('doc.title').value, '')
  p.stop()
})

test('someone who may only read sees the rows and no way to change them', async () => {
  let viewer = await signIn(k)
  await agent.tool('member_add', {
    ...at,
    email: viewer.email,
    role: 'viewer',
  })
  await accepted(k, viewer.email, viewer.cookie)
  let res = await k.at(host, '/site/_web/data', {
    headers: { cookie: viewer.cookie },
  })
  assertEquals(res.status, 200)
  await res.body?.cancel()
  let p = page(viewer.cookie)
  await p.start()
  await p.go('#meeting')
  assertEquals(p.rows(), ['October meeting'])
  assert(!p.text().includes('Add'))
  await p.go(p.root.querySelector('.Rows_Name')!.getAttribute('href')!)
  assertEquals(p.root.querySelectorAll('button').length, 0)
  assert(p.field('meeting.attendance').disabled)
  p.stop()
})

test('words become controls, and the rest is left out', () => {
  let of = (s: object) => fields('x', { properties: { p: s } }).at(-1)!.control
  assertEquals(of({ type: 'string' }), 'text')
  assertEquals(of({ type: 'number' }), 'number')
  assertEquals(of({ type: 'boolean' }), 'bool')
  assertEquals(of({ type: 'string', format: 'date-time' }), 'time')
  assertEquals(of({ type: 'string', format: 'uri' }), 'url')
  assertEquals(of({ type: 'array', items: { type: 'string' } }), 'lines')
  assertEquals(of({ type: 'object' }), 'json')
  assertEquals(of({ type: 'string', ref: 'recipe' }), 'pick')
  assertEquals(of({ type: 'string', ref: 'blob' }), 'file')
  assertEquals(
    fields('x', { properties: { blob: { type: 'string' } } }).at(-1)!.control,
    'file',
  )
  // The recipe box's own shapes: a person's saved session is still a row;
  // what is private to a person, a link and a moment are not.
  assertEquals(
    kinds({
      recipe: { properties: {} },
      mine: { personal: 'by', properties: {} },
      link: { edge: true, properties: {} },
      gone: { durable: '0s', properties: {} },
      local: { sync: 'none', properties: {} },
    }).map((x) => x.name),
    ['recipe', 'doc'],
  )
  assertEquals(kinds({}).map((x) => x.label), ['Rows'])
  assertEquals(title({ doc: { title: '' }, m: { a: 'x\ny' } }, 'm'), 'x')
  let kind = kinds({ m: { properties: { on: { type: 'boolean' } } } })[0]
  assertEquals(
    patch(kind, { entity: { eid: 'a' }, m: { on: false } }, { 'm.on': '' }),
    null,
  )
})
