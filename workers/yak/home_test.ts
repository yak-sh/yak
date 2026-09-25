// A space's dashboard and front door, drawn straight: pages.ts `desk` and
// `spaceIndex` are pure, so every state a person passes through is one call
// here. The address itself, served in workerd, is home_workerd_test.ts's.
import { assert, assertEquals, assertStringIncludes } from '@std/assert'
import { parseHTML } from 'linkedom'
import { desk, spaceIndex } from './pages.ts'
import { managePath } from './route.ts'

// The dashboard itself, drawn straight (pages.ts `desk` is pure): the order
// it puts its blocks in, and what stands where the connect steps were. Every
// state a person passes through is one call here — landed, connected,
// something built — where reaching each through workerd is a sign-in, an
// OAuth grant and an app apiece (identity_workerd_test.ts holds those ends).
let block = (
  at: Partial<Parameters<typeof desk>[0]> = {},
  env: Parameters<typeof desk>[1] = {},
) => desk({ space: 'dana', apps: [], name: 'dana', ...at }, env).text()

// The space's front door, which anybody may be shown.
let face = (at: Partial<Parameters<typeof spaceIndex>[0]> = {}) =>
  spaceIndex({
    space: 'dana',
    title: 'dana',
    apps: [],
    hidden: 0,
    role: null,
    person: false,
    signIn: 'https://yaks.app/login',
    ...at,
  }).text()

Deno.test('the app library has navigation, not account forms', async () => {
  let page = await block({
    apps: [{ eid: 'recipes', slug: 'recipes', title: 'Recipes' }],
  })
  assertStringIncludes(page, 'href="https://dana.yaks.app/recipes/"')
  for (let view of ['connect', 'new', 'settings', 'visits', 'trash'] as const) {
    assertStringIncludes(page, `href="${managePath(view)}"`)
  }
  let { document } = parseHTML(page)
  assertEquals(
    document.querySelector(`nav a[href="${managePath('connect')}"]`)
      ?.textContent?.trim(),
    'Agents',
  )
  assertStringIncludes(page, 'Connect your agent')
  assert(!page.includes('<form'), page)
  assert(!page.includes('name="agent"'), page)
  assert(!page.includes('src="/api/build.js"'), page)
})

Deno.test('profile and address save independently in settings', async () => {
  let page = await block({ view: 'settings' })
  let forms = page.match(/<form[\s\S]*?<\/form>/g) ?? []
  assertEquals(forms.length, 2)
  assert(forms[0] && forms[1])
  assert(forms[0].includes('name="name"'), forms[0])
  assert(!forms[0].includes('name="space"'), forms[0])
  assert(forms[1].includes('name="space"'), forms[1])
  assert(!forms[1].includes('name="name"'), forms[1])
  for (let form of forms) {
    assertStringIncludes(form, `action="${managePath('settings')}"`)
  }
})

Deno.test('new app exposes separate build and upload forms below the agent route', async () => {
  let page = await block({ view: 'new' })
  let { document } = parseHTML(page)
  let build = document.querySelector('textarea')!
  let upload = document.querySelector('input[type=file]')!
  for (let field of [build, upload]) {
    assert(!field.closest('details, [hidden]'))
    assert(field.hasAttribute('required'))
    assert(field.closest('section')?.querySelector('h2'))
  }
  assertEquals(
    build.closest('form')?.getAttribute('action'),
    'https://dana.yaks.app/api/build',
  )
  assertEquals(
    upload.closest('form')?.getAttribute('action'),
    'https://dana.yaks.app/deploy',
  )
  assertEquals(
    upload.closest('form')?.getAttribute('enctype'),
    'multipart/form-data',
  )
  assert(
    page.indexOf(`href="${managePath('connect')}"`) < page.indexOf('<textarea'),
    page,
  )
})

Deno.test('the fixed app address links to the displayed host and emphasizes its space name', async () => {
  for (let env of [{}, { APEX: 'example.test' }]) {
    let { document } = parseHTML(
      await block({ view: 'settings', fixed: true }, env),
    )
    let address = document.querySelector('a.Address')!
    assertEquals(
      address.getAttribute('href'),
      `https://${address.textContent}/`,
    )
    assertEquals(address.querySelector('.Address_Name')?.textContent, 'dana')
    assertEquals(address.getAttribute('target'), '_blank')
    assertEquals(address.querySelector('input'), null)
  }
  let { document } = parseHTML(await block({ view: 'settings', fixed: false }))
  assertEquals(document.querySelector('a.Address'), null)
  assert(document.querySelector('input[name=space]'))
})

Deno.test('connected empty library offers a copyable request', async () => {
  let page = await block({
    agents: [{
      id: 'chatgpt',
      brand: 'chatgpt',
      name: 'ChatGPT',
      connectedAt: 1,
    }],
  })
  assert(/class="[^"]*\bCopy_Go\b/.test(page), page)
  assert(!page.includes('<textarea'), page)
  let built = await block({
    agents: [{
      id: 'chatgpt',
      brand: 'chatgpt',
      name: 'ChatGPT',
      connectedAt: 1,
    }],
    apps: [{ eid: 'recipes', slug: 'recipes', title: 'Recipes' }],
  })
  assert(!/class="[^"]*\bCopy_Go\b/.test(built), built)
  for (let html of [page, built]) {
    let { document } = parseHTML(html)
    assertEquals(document.querySelector('.Agents'), null)
    assertEquals(document.querySelector('[data-agent-row]'), null)
    assertEquals(document.querySelector('[data-agent-name]'), null)
    assert(
      document.querySelector('[data-disconnected]')!.hasAttribute('hidden'),
    )
  }
})

Deno.test('connected pages show the named client and put setup behind a disclosure', async () => {
  let agents = [{
    id: 'chatgpt',
    brand: 'chatgpt' as const,
    name: 'ChatGPT',
    connectedAt: 1,
  }]
  for (let view of ['new', 'connect'] as const) {
    let { document } = parseHTML(await block({ view, agents }))
    let list = document.querySelector('.Agents')!
    assertStringIncludes(list.textContent!, 'ChatGPT')
    assertEquals(
      list.querySelector('a')?.getAttribute('href'),
      'https://chatgpt.com/',
    )
    assert(!list.querySelector('a[href*="claude.ai"]'))
    for (let el of document.querySelectorAll('[data-disconnected]')) {
      assert(el.hasAttribute('hidden'))
    }
    if (view == 'connect') {
      assert(
        !document.querySelector('[data-agent-setup]')!.hasAttribute(
          'open',
        ),
      )
    }
  }
  let { document } = parseHTML(await block({ view: 'connect' }))
  assert(
    document.querySelector('[data-agent-setup]')!.hasAttribute('open'),
  )
})

// Who visited (views.ts, T-34497): the owner's block, drawn straight. What
// matters here is that it is the owner's, that it draws itself without a
// script, and that a platform with no analytics token says one sentence rather
// than an empty chart.
let VISITS = {
  slug: 'recipes',
  title: 'Recipes',
  stats: {
    days: 3,
    total: 9,
    daily: [
      { day: '2026-09-04', views: 2 },
      { day: '2026-09-05', views: 0 },
      { day: '2026-09-06', views: 7 },
    ],
    pages: [{ name: '/dinner', views: 6 }],
    from: [{ name: 'news.example.com', views: 4 }],
    countries: [{ name: 'US', views: 9 }],
  },
}

Deno.test('who visited: a bar per day and three lists, no script', async () => {
  let page = await block({
    view: 'visits',
    apps: [{ eid: 'recipes', slug: 'recipes', title: 'Recipes' }],
    views: [VISITS],
    viewDays: 3,
  })
  assertStringIncludes(page, '9 visits')
  // One rect per day, the tallest full height and the empty day absent.
  let bars = page.match(/class="Stats_Bar"/g)
  assertEquals(bars?.length, 3)
  assertStringIncludes(page, 'height="40.00"')
  assertStringIncludes(page, 'height="0.00"')
  // The three lists, and the ends of the axis.
  assertStringIncludes(page, '/dinner')
  assertStringIncludes(page, 'news.example.com')
  assertStringIncludes(page, '>US<')
  assertStringIncludes(page, '4 Sep')
  assertStringIncludes(page, '6 Sep')
  // Nothing here runs: the chart is markup, not a canvas somebody paints.
  assertStringIncludes(page, '<svg class="Stats_Chart"')

  // Not the owner's, not their business: the front door has no such block.
  let theirs = await face({
    apps: [{ eid: 'recipes', slug: 'recipes', title: 'Recipes' }],
  })
  assert(!parseHTML(theirs).document.querySelector('.Stats'))
})

Deno.test('who visited: no token is one sentence, no chart', async () => {
  let page = await block({
    view: 'visits',
    apps: [{ eid: 'recipes', slug: 'recipes', title: 'Recipes' }],
    views: null,
    viewsOff: 'Visitor counts are not switched on for this platform yet.',
  })
  assertStringIncludes(page, 'not switched on')
  assert(
    !page.includes('<svg class="Stats_Chart"'),
    'an empty chart is worse than a line',
  )
})

Deno.test('who visited: an app nobody opened says so', async () => {
  let page = await block({
    view: 'visits',
    apps: [{ eid: 'recipes', slug: 'recipes', title: 'Recipes' }],
    views: [{
      ...VISITS,
      stats: {
        ...VISITS.stats,
        total: 0,
        daily: [],
        pages: [],
        from: [],
        countries: [],
      },
    }],
  })
  let { document } = parseHTML(page)
  assertEquals(document.querySelector('.Stats_Total')?.textContent, '0 visits')
  assert(!page.includes('<svg class="Stats_Chart"'), page)
})

Deno.test('trash has restore forms only on its own page', async () => {
  let trash = [{ slug: 'notes', title: 'Notes', days: 12 }]
  let page = await block({ view: 'trash', trash })
  assertStringIncludes(page, `action="${managePath('trash')}"`)
  assertStringIncludes(page, 'name="restore" value="notes"')
  assertStringIncludes(page, '12 days left')
  let other = await block({ trash })
  assert(!other.includes('name="restore"'), other)
  assert(!other.includes('Notes'), other)
})

Deno.test("none of the dashboard is anybody else's", async () => {
  for (let role of [null, 'editor', 'owner']) {
    let page = await face({ role, person: !!role })
    assert(!page.includes('name="name"'), page)
    assert(!/class="[^"]*\bCopy_Go\b/.test(page), page)
    assert(!page.includes('class="SideNav"'), page)
  }
})

Deno.test('Billing is a management page beside Settings with space checkout and portal', async () => {
  let settings = await block({ view: 'settings' })
  assertStringIncludes(settings, `href="${managePath('billing')}"`)
  let { document: profile } = parseHTML(settings)
  assertEquals(profile.querySelector('.Settings_Tabs'), null)
  assertEquals(
    profile.querySelector('.SideNav [aria-current]')?.getAttribute('href'),
    managePath('settings'),
  )
  for (let plus of [false, true]) {
    let page = await block({
      view: 'billing',
      plan: { plus, known: true, ends: '2026-10-01T00:00:00Z' },
    })
    let { document } = parseHTML(page)
    assertEquals(!!document.querySelector('[data-door="checkout"]'), !plus)
    assertEquals(
      document.querySelector('[data-door="portal"]')?.getAttribute(
        'data-target',
      ),
      managePath('billing'),
    )
    assertEquals(
      document.querySelector('.SideNav [aria-current]')?.getAttribute('href'),
      managePath('billing'),
    )
    assertEquals(document.querySelector('.Settings_Tabs'), null)
    assertEquals(
      [...document.querySelectorAll('.SideNav a')].map((a) =>
        a.getAttribute('href')
      ).slice(-4),
      (['visits', 'billing', 'settings', 'trash'] as const).map((view) =>
        managePath(view)
      ),
    )
    if (plus) assertStringIncludes(page, 'stops renewing')
  }
})
