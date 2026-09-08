// The component updates its own rows and connection-dependent visibility,
// preserves form state, and never trusts names or remote link destinations.
import { assert, assertEquals } from '@std/assert'
import { parseHTML } from 'linkedom'
import type { Connection } from './connections.ts'
import { connectionList, connectionLive } from './connection_ui.ts'

let chatgpt: Connection = {
  id: 'chatgpt',
  provider: 'chatgpt',
  name: 'ChatGPT',
  connectedAt: 1,
}

let mount = (
  initial: Connection[] = [],
  view: 'rows' | 'links' | false = 'rows',
) => {
  let { document } = parseHTML(`<html><body>
<p data-disconnected${initial.length ? ' hidden' : ''}>Connect your chatbot</p>
<p data-connected${initial.length ? '' : ' hidden'}>Your chatbots</p>
<details data-connection-setup${
    initial.length ? '' : ' open'
  }><input value="draft"></details>
${view ? connectionList(initial, view) : ''}${
    connectionLive('/oauth/connections')
  }
</body></html>`)
  let events: Record<string, () => Promise<void>> = {}
  let listen = (name: string, run: () => Promise<void>) => {
    events[name] = run
  }
  Object.assign(document, { addEventListener: listen })
  Object.defineProperty(document, 'hidden', { value: false, writable: true })
  let calls: { url: string; options: RequestInit }[] = []
  let next = () => Promise.resolve(Response.json({ connections: initial }))
  new Function(
    'window',
    'document',
    'fetch',
    document.querySelector('script')!.textContent!,
  )(
    { addEventListener: listen },
    document,
    (url: string, options: RequestInit) => {
      calls.push({ url, options })
      return next()
    },
  )
  return {
    document,
    calls,
    run: (name = 'focus') => events[name](),
    reply: (respond: typeof next) => {
      next = respond
    },
    show: (connections: Connection[]) => {
      next = () => Promise.resolve(Response.json({ connections }))
    },
    list: document.querySelector<HTMLElement>('.Connections')!,
    setup: document.querySelector('details')!,
  }
}

Deno.test('connection rows show names and only known web chatbot destinations', () => {
  let hostile = '<img src=x onerror=alert(1)>'
  let m = mount([
    chatgpt,
    { id: 'claude', provider: 'claude', name: 'Claude', connectedAt: 2 },
    { id: 'local', provider: 'claude-code', name: hostile, connectedAt: 3 },
  ])
  assertEquals(m.calls.length, 0, 'the server state stays intact on load')
  assertEquals(m.list.hidden, false)
  assertEquals(m.list.querySelector('img'), null)
  assertEquals(
    m.list.lastElementChild!.querySelector('strong')!.textContent,
    hostile,
  )
  assertEquals(
    [...m.list.querySelectorAll('a[href]')].map((a) => a.getAttribute('href')),
    [
      'https://chatgpt.com/',
      'https://claude.ai/new',
    ],
  )
  assert(m.list.querySelector('a')!.textContent!.includes('Open ChatGPT'))
  assertEquals(m.list.getAttribute('aria-label'), 'Connected chatbots')
})

Deno.test('compact connections render launch links and refresh without replacing drafts or stable links', async () => {
  let claude: Connection = {
    id: 'claude',
    provider: 'claude',
    name: 'Claude',
    connectedAt: 2,
  }
  let local: Connection = {
    id: 'local',
    provider: 'claude-code',
    name: '<img src=x onerror=alert(1)>',
    connectedAt: 3,
  }
  let m = mount([chatgpt, local], 'links')
  let draft = m.document.querySelector('input')!
  assertEquals(m.list.children.length, 1)
  assertEquals(m.list.querySelector('.Connections_Info'), null)
  assertEquals(m.list.querySelector('.Connections_State'), null)
  assertEquals(m.list.querySelector('img'), null)
  assertEquals(m.list.querySelector('a')?.getAttribute('target'), '_blank')
  await m.run()
  let first = m.list.firstElementChild
  await m.run()
  assert(m.list.firstElementChild === first, 'unchanged links retain focus')
  for (let connections of [[chatgpt, claude, local], [claude], []]) {
    m.show(connections)
    await m.run('visibilitychange')
    assert(m.document.querySelector('input') === draft)
    assertEquals(draft.value, 'draft')
    assertEquals(
      [...m.list.querySelectorAll('a[href]')].map((a) =>
        a.getAttribute('href')
      ),
      connections.filter((c) => c != local).map((c) =>
        c == chatgpt ? 'https://chatgpt.com/' : 'https://claude.ai/new'
      ),
    )
    assertEquals(m.list.hidden, !connections.length)
  }
})

Deno.test('connection refresh preserves drafts and changes setup only when connection state changes', async () => {
  let m = mount()
  let draft = m.document.querySelector('input')!
  assertEquals(m.list.hidden, true)
  m.show([chatgpt])
  await m.run()
  assertEquals(m.list.hidden, false)
  assertEquals(
    m.document.querySelector<HTMLElement>('[data-disconnected]')!.hidden,
    true,
  )
  assertEquals(m.setup.hasAttribute('open'), false)
  assertEquals(m.document.querySelector('input'), draft)
  assertEquals(draft.value, 'draft')
  let row = m.list.firstElementChild
  m.setup.setAttribute('open', '')
  await m.run('visibilitychange')
  assertEquals(m.list.firstElementChild, row, 'unchanged rows retain focus')
  assertEquals(
    m.setup.hasAttribute('open'),
    true,
    'manual disclosure stays open',
  )
  m.setup.removeAttribute('open')
  m.show([])
  await m.run()
  assertEquals(m.list.hidden, true)
  assertEquals(
    m.document.querySelector<HTMLElement>('[data-disconnected]')!.hidden,
    false,
  )
  assertEquals(m.setup.hasAttribute('open'), true)
  assertEquals(m.calls[0], {
    url: '/oauth/connections',
    options: {
      credentials: 'same-origin',
      cache: 'no-store',
      headers: { accept: 'application/json' },
    },
  })
})

Deno.test('connection refresh coalesces events and preserves state on failures', async () => {
  let m = mount([chatgpt])
  let finish!: (response: Response) => void
  m.reply(() =>
    new Promise((resolve) => {
      finish = resolve
    })
  )
  let first = m.run()
  await m.run('visibilitychange')
  assertEquals(m.calls.length, 1)
  finish(new Response('Unavailable', { status: 503 }))
  await first
  assertEquals(m.list.children.length, 1)
  m.reply(() => Promise.resolve(Response.json({ error: 'not_signed_in' })))
  await m.run()
  assertEquals(m.list.hidden, false)
  m.show([{
    id: 'unknown',
    name: '<script>bad()</script>',
    connectedAt: 1,
    provider: '__proto__' as Connection['provider'],
  }])
  await m.run()
  assertEquals(m.list.querySelector('script'), null)
  assertEquals(m.list.querySelector('a[href]'), null)
  assertEquals(
    m.list.querySelector('strong')!.textContent,
    '<script>bad()</script>',
  )
  Object.defineProperty(m.document, 'hidden', { value: true })
  let count = m.calls.length
  await m.run('visibilitychange')
  assertEquals(m.calls.length, count)
})

Deno.test('connection state refreshes without a chatbot list or row template', async () => {
  for (let initial of [[], [chatgpt]]) {
    let m = mount(initial, false)
    let prompt = m.document.querySelector<HTMLElement>('[data-disconnected]')!
    let draft = m.document.querySelector('input')!
    assertEquals(prompt.hidden, !!initial.length)
    assertEquals(m.calls.length, 0)
    for (let connections of [[chatgpt], []]) {
      m.show(connections)
      await m.run()
      assertEquals(prompt.hidden, !!connections.length)
      assertEquals(m.document.querySelector('.Connections'), null)
      assertEquals(m.document.querySelector('[data-connection-row]'), null)
      assert(m.document.querySelector('input') === draft)
    }
  }
})
