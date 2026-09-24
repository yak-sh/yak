// The component updates its own rows and what shows while any agent is
// connected, preserves form state, and never trusts names or remote link
// destinations.
import { assert, assertEquals } from '@std/assert'
import { parseHTML } from 'linkedom'
import type { Agent } from './connected.ts'
import { agentList, agentLive } from './connected_ui.ts'

let chatgpt: Agent = {
  id: 'chatgpt',
  provider: 'chatgpt',
  name: 'ChatGPT',
  connectedAt: 1,
}

let mount = (
  initial: Agent[] = [],
  view: 'rows' | 'links' | false = 'rows',
) => {
  let { document } = parseHTML(`<html><body>
<p data-disconnected${initial.length ? ' hidden' : ''}>Connect your agent</p>
<p data-connected${initial.length ? '' : ' hidden'}>Your agents</p>
<details data-agent-setup${
    initial.length ? '' : ' open'
  }><input value="draft"></details>
${view ? agentList(initial, view) : ''}${agentLive('/oauth/agents')}
</body></html>`)
  let events: Record<string, () => Promise<void>> = {}
  let listen = (name: string, run: () => Promise<void>) => {
    events[name] = run
  }
  Object.assign(document, { addEventListener: listen })
  Object.defineProperty(document, 'hidden', { value: false, writable: true })
  let calls: { url: string; options: RequestInit }[] = []
  let next = () => Promise.resolve(Response.json({ agents: initial }))
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
    show: (agents: Agent[]) => {
      next = () => Promise.resolve(Response.json({ agents }))
    },
    list: document.querySelector<HTMLElement>('.Agents')!,
    setup: document.querySelector('details')!,
  }
}

Deno.test('agent rows show names and only known web agent destinations', () => {
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
  assertEquals(m.list.getAttribute('aria-label'), 'Connected agents')
})

Deno.test('compact agents render launch links and refresh without replacing drafts or stable links', async () => {
  let claude: Agent = {
    id: 'claude',
    provider: 'claude',
    name: 'Claude',
    connectedAt: 2,
  }
  let local: Agent = {
    id: 'local',
    provider: 'claude-code',
    name: '<img src=x onerror=alert(1)>',
    connectedAt: 3,
  }
  let m = mount([chatgpt, local], 'links')
  let draft = m.document.querySelector('input')!
  assertEquals(m.list.children.length, 1)
  assertEquals(m.list.querySelector('.Agents_Info'), null)
  assertEquals(m.list.querySelector('.Agents_State'), null)
  assertEquals(m.list.querySelector('img'), null)
  assertEquals(m.list.querySelector('a')?.getAttribute('target'), '_blank')
  await m.run()
  let first = m.list.firstElementChild
  await m.run()
  assert(m.list.firstElementChild === first, 'unchanged links retain focus')
  for (let agents of [[chatgpt, claude, local], [claude], []]) {
    m.show(agents)
    await m.run('visibilitychange')
    assert(m.document.querySelector('input') === draft)
    assertEquals(draft.value, 'draft')
    assertEquals(
      [...m.list.querySelectorAll('a[href]')].map((a) =>
        a.getAttribute('href')
      ),
      agents.filter((c) => c != local).map((c) =>
        c == chatgpt ? 'https://chatgpt.com/' : 'https://claude.ai/new'
      ),
    )
    assertEquals(m.list.hidden, !agents.length)
  }
})

Deno.test('agent refresh preserves drafts and changes setup only when an agent connects or leaves', async () => {
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
    url: '/oauth/agents',
    options: {
      credentials: 'same-origin',
      cache: 'no-store',
      headers: { accept: 'application/json' },
    },
  })
})

Deno.test('agent refresh coalesces events and preserves state on failures', async () => {
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
    provider: '__proto__' as Agent['provider'],
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

Deno.test('connected state refreshes without an agent list or row template', async () => {
  for (let initial of [[], [chatgpt]]) {
    let m = mount(initial, false)
    let prompt = m.document.querySelector<HTMLElement>('[data-disconnected]')!
    let draft = m.document.querySelector('input')!
    assertEquals(prompt.hidden, !!initial.length)
    assertEquals(m.calls.length, 0)
    for (let agents of [[chatgpt], []]) {
      m.show(agents)
      await m.run()
      assertEquals(prompt.hidden, !!agents.length)
      assertEquals(m.document.querySelector('.Agents'), null)
      assertEquals(m.document.querySelector('[data-agent-row]'), null)
      assert(m.document.querySelector('input') === draft)
    }
  }
})
