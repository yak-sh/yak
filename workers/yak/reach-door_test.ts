// The page graph's door (reach-door.ts): a signed-in tab reads and writes
// across every store its person reaches, as its own session, and a tab drawn
// for someone else writes nothing.
import { clock, equal, test, until } from '@yaks/testing'
import type { Frame } from '@yaks/api'
import type { Bundle } from '@yaks/graph'
import { PLATFORM_STORE } from '@yaks/platform/names'
import { REACH, TAB_PERSON } from '@yaks/platform/routes'
import {
  UPDATE_WAITING,
  waitingCounts,
  waitingWords,
} from '@yaks/platform/update-waiting'
import { bindSide } from '@yaks/platform/side-browser'
import { section, sideParts, type SideView } from '@yaks/platform/side-parts'
import {
  pickedOf,
  SIDE_SPACES,
  sideApps,
  sideWords,
} from '@yaks/platform/side-rows'
import { h } from 'preact'
import { renderToString } from 'preact-render-to-string'
import { friendSide } from '@yaks/platform/friends'
import {
  ACCOUNT,
  accountEid,
  accountOf,
  accountWords,
  FRIENDS,
  friendsOf,
  INVITE_PAGE,
  inviteOf,
  SHARED_APPS,
  sharedOf,
  SIGNED_IN,
  signedInOf,
} from '@yaks/platform/account-rows'
import {
  updateCards,
  updateOffers,
  updatesIn,
} from '@yaks/platform/update-rows'
import type { UpdatesView } from '@yaks/platform/updates-view'
import { draftRows } from '@yaks/platform/operator-drafts'
import {
  ALERTING,
  alertingEid,
  alertingOf,
  operatorSettings,
  settingsEid,
  settingsOf,
} from '@yaks/platform/operator-settings'
import { appCanvasWords, appMaking, makingOf } from '@yaks/platform/app-canvas'
import { TOOLS } from './tools.ts'
import { draftEid } from '@yaks/draft'
import {
  countRows,
  countsOf,
  visitCounts,
  visitWords,
} from '@yaks/platform/visit-counts'
import { brokenApps, listedOf, spaceApps } from '@yaks/platform/space-apps'
import { AGENTS, agentsOf, agentsWords } from '@yaks/platform/agents'
import {
  allowancesLine,
  allowancesOf,
  planLine,
  planOf,
} from '@yaks/platform/payment-rows'
import type { AppsView } from '@yaks/platform/space-apps-view'
import { managePath } from '@yaks/platform/routes'
import {
  binnedOf,
  domainOffers,
  settingsEid as spaceEid,
  settingsOf as spaceOf,
  spaceDomains,
  spacePagesWords,
  spaceSettings,
  spaceTrash,
} from '@yaks/platform/space-pages'
import {
  actedOf,
  connectionsPage,
  connectionsWords,
  pageOf,
} from '@yaks/platform/connections-page'
import {
  matchesOf,
  matchesPage,
  matchesRow,
} from '@yaks/platform/operator-matches'
import { ALL } from './updates.ts'
import { sessionRow } from './browser-sessions.ts'
import { referralEid } from './referral.ts'
import { client } from '@yaks/client'
import { loadVocab } from '@yaks/vocab'
import { installPair, made, type Pair } from '../../packages/workerd/testing.ts'
import { parseHTML } from 'linkedom'
import { PAGE } from '@yaks/ui/navigate'
import { ADA, ADA_OWNS, as, platform, seeded } from './serving-probe.ts'
import { manage } from './manage.ts'
import { PLATFORM_OBJECT } from './door.ts'
import { KERNEL } from './meta.ts'
import { SPACE } from './build-door.ts'
import { connector, kernel, meta, pressPeople, seed, signIn } from './probe.ts'
import {
  admitted,
  admittedOf,
  holders,
  holdersOf,
  INVITABLE,
  type PeopleAct,
} from '@yaks/platform/people-rows'

let k = await kernel()
let ada = await seed(k, [{ slug: 'adas', apps: ['notes', 'lists'] }])
let bea = await signIn(k)

type Tab = { cookie: string; person: string }
let door = (
  who: Tab,
  path: string,
  init: RequestInit = {},
) =>
  k.at(k.host, `${REACH}${path}`, {
    ...init,
    headers: {
      cookie: who.cookie,
      [TAB_PERSON]: who.person,
      'content-type': 'application/json',
      ...init.headers,
    },
  })
let query = async (who: Tab, q: string) => {
  let res = await door(who, `/query?q=${encodeURIComponent(q)}`)
  equal(res.status, 200, await res.clone().text())
  return (await res.json() as Bundle[]).map((b) => b.doc)
}

test('a tab reads and writes across its person’s stores, and only theirs', async () => {
  let eid = crypto.randomUUID()
  let wrote = await door(ada, '/apply', {
    method: 'POST',
    body: JSON.stringify([{
      entity: { eid },
      doc: { title: 'Soup' },
      $app: 'adas/notes',
    }]),
  })
  equal(wrote.status, 200, await wrote.clone().text())
  equal(await query(ada, `.entity.eid=${eid}`), [{ title: 'Soup' }])
  equal(await query(bea, `.entity.eid=${eid}`), [])
})

test('a tab drawn for someone else, or nobody signed in, is told to sign in again', async () => {
  let other = await door({ ...ada, person: bea.person }, '/query?q=.doc')
  equal(other.status, 401)
  let nobody = await k.at(k.host, `${REACH}/query?q=.doc`)
  equal(nobody.status, 401)
})

// A write to the door as `who`'s tab: its answer and status.
let wrote = async (who: Tab, bundles: unknown[]) => {
  let res = await door(who, '/apply', {
    method: 'POST',
    body: JSON.stringify(bundles),
  })
  return { status: res.status, body: await res.json() }
}
let rowsOf = async (who: Tab, q: string) =>
  await (await door(who, `/query?q=${encodeURIComponent(q)}`))
    .json() as Bundle[]

test('a tab reads its person’s account and friends, and a friend who says yes or leaves is on it', async () => {
  let cy = await signIn(k)
  let [me] = await rowsOf(ada, ACCOUNT)
  equal(accountOf([me])?.hidden, false)
  equal(me.entity.eid, accountEid(ada.person))
  equal(await rowsOf(ada, FRIENDS), [])
  let yes = { decided: { verdict: 'approved' } }
  await k.dir.stamp({
    entities: [
      friendSide(ada.person, cy.person, yes),
      friendSide(cy.person, ada.person, yes),
    ],
  })
  equal(friendsOf(await rowsOf(ada, FRIENDS)).map((f) => f.person), [cy.person])
  await k.dir.stamp({
    entities: [{
      entity: { eid: friendSide(cy.person, ada.person).entity.eid },
      $delete: true,
    }],
  })
  equal(await rowsOf(ada, FRIENDS), [])
})

// The Operator of the space `space` tells `to` of something, in their
// Updates.
let tellIn = async (space: string, to: string) => {
  let res = await k.builder(space).fetch(
    new Request('https://builder/operator/tell', {
      method: 'POST',
      headers: {
        ...KERNEL,
        [SPACE]: space,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ to, words: 'An update' }),
    }),
  )
  equal(res.ok, true, await res.text())
}

test('a tab reads its person’s Updates in a space: a friend’s request from the directory, and the Operator’s, in nobody else’s', async () => {
  let cy = await signIn(k)
  let own = (await k.dir.seated(ada.person)).find((s) => s.own)!.space.eid
  let offered = async (who: Tab) =>
    updatesIn(await rowsOf(who, updateOffers(own)), own)
      .map((u) => u.friend?.person)
  equal(await offered(ada), [])
  // Cy asks Ada: their side is yes, Ada's not yet written.
  await k.dir.stamp({
    entities: [
      friendSide(cy.person, ada.person, { decided: { verdict: 'approved' } }),
    ],
  })
  equal(await offered(ada), [cy.person])
  equal(await offered(bea), [], 'a space they hold no seat in')
  await tellIn(own, ada.person)
  let told = updatesIn(await rowsOf(ada, updateCards(own)), own)
  equal(told.map((u) => u.words), ['An update'])
  equal(await rowsOf(bea, updateCards(own)), [])
  await k.dir.stamp({
    entities: [{
      entity: { eid: friendSide(cy.person, ada.person).entity.eid },
      $delete: true,
    }],
  })
})

test('a tab writes its person’s draft to their space’s Operator, and to no space they do not write in', async () => {
  let own = (await k.dir.seated(ada.person)).find((s) => s.own)!.space.eid
  let typed = (who: Tab) =>
    draftRows(own, [{
      entity: { eid: draftEid(who.person, 'operator') },
      draft: { by: who.person, place: 'operator', text: 'Remind me' },
      typed: { over: '' },
    }])
  let mine = await wrote(ada, typed(ada))
  equal(mine.status, 200, JSON.stringify(mine.body))
  equal(
    (mine.body as Bundle[]).map((b) => [
      (b.draft as { text: string }).text,
      b.operatorDraft,
    ]),
    [['Remind me', undefined]],
  )
  equal((await wrote(bea, typed(bea))).status, 403)
})

test('a tab renames its space’s Operator and picks its voice through the door, as offered, and in no space it does not write in', async () => {
  let own = (await k.dir.seated(ada.person)).find((s) => s.own)!.space.eid
  let set = (who: Tab, settings: Record<string, string>) =>
    wrote(who, [{
      entity: { eid: settingsEid(own) },
      operatorSettings: { space: own, ...settings },
    }])
  let named = await set(ada, { name: 'Caleb' })
  equal(named.status, 200, JSON.stringify(named.body))
  equal(settingsOf(named.body)?.name, 'Caleb')
  equal(settingsOf(await rowsOf(ada, operatorSettings(own)))?.name, 'Caleb')
  let unheard = await set(ada, { voice: 'nobody' })
  equal(
    [
      unheard.status,
      JSON.stringify(unheard.body).includes('Pick one of the voices listed.'),
    ],
    [400, true],
  )
  equal((await set(bea, { name: 'Mallory' })).status, 403)
  equal(await rowsOf(bea, operatorSettings(own)), [])
})

test('a tab reads its space’s Matches and picks through the door, and in no space it does not write in', async () => {
  let own = (await k.dir.seated(ada.person)).find((s) => s.own)!.space.eid
  equal(await rowsOf(ada, matchesPage(own)), [
    matchesRow(own, '', { rounds: [] }),
  ])
  equal(matchesOf(await rowsOf(bea, matchesPage(own))), undefined)
  let pick = (who: Tab) =>
    wrote(who, [{
      entity: { eid: crypto.randomUUID() },
      pickMatch: { space: own, round: 'covers', pair: 1, chose: 'first' },
    }])
  let none = await pick(ada)
  equal([none.status, none.body.message], [400, 'no round is named covers'])
  equal((await pick(bea)).status, 403)
})

test('a tab reads its space’s visits, which no store holds, and none of a space it does not write in', async () => {
  let adas = (await k.dir.seated(ada.person))
    .find((s) => s.space.slug == 'adas')!.space.eid
  // This platform has no analytics token: the page says it cannot count.
  equal(await rowsOf(ada, visitCounts(adas)), countRows(adas, null))
  equal(await rowsOf(bea, visitCounts(adas)), [])
})

test('a tab reads what an app it may open is made of, and nothing of one it may not', async () => {
  let space =
    (await k.dir.seated(ada.person)).find((s) => s.space.slug == 'adas')!
      .space
  let notes = (await k.dir.apps(space)).find((a) => a.slug == 'notes')!
  let line = appMaking(notes.eid)
  let made = makingOf(await rowsOf(ada, line), notes.eid)
  equal([made?.made.kinds, made?.steps, made?.draft], [[], [], null])
  equal(await rowsOf(bea, line), [])
  equal(await rowsOf(ada, appMaking(crypto.randomUUID())), [])
})

test('a tab reads and changes its space’s Settings, Trash and Domains through the door, and a stranger nothing', async () => {
  let space = ada.eids.adas
  let now = async (who: Tab) => spaceOf(await rowsOf(who, spaceSettings(space)))
  equal((await now(ada))?.slug, 'adas')
  equal(await rowsOf(bea, spaceSettings(space)), [])
  let set = (who: Tab, change: Record<string, unknown>) =>
    wrote(who, [{
      entity: { eid: spaceEid(space) },
      spaceSettings: { space, ...change },
    }])
  let renamed = await set(ada, { title: 'Ada’s place', home: 'notes' })
  equal(renamed.status, 200, JSON.stringify(renamed.body))
  equal(
    [spaceOf(renamed.body)?.title, spaceOf(renamed.body)?.home],
    ['Ada’s place', 'notes'],
  )
  equal((await now(ada))?.home, 'notes')
  equal((await set(bea, { title: 'Mallory' })).status, 403)
  // An app in the trash comes back, saying where.
  await connector(k, ada.cookie).answer('app_delete', {
    space: 'adas',
    app: 'lists',
  })
  let binned = binnedOf(await rowsOf(ada, spaceTrash(space)))
  equal(binned.map((b) => [b.kind, b.name]), [['app', 'lists']])
  equal(await rowsOf(bea, spaceTrash(space)), [])
  let back = await wrote(ada, [{
    entity: { eid: crypto.randomUUID() },
    restoreBinned: { space, item: binned[0].item },
  }])
  equal(back.status, 200, JSON.stringify(back.body))
  equal(back.body[0].restoreBinned.said, 'Restored at /lists/.')
  equal(binnedOf(await rowsOf(ada, spaceTrash(space))), [])
  let gone = await wrote(ada, [{
    entity: { eid: crypto.randomUUID() },
    restoreBinned: { space, item: binned[0].item },
  }])
  equal(gone.status, 404, JSON.stringify(gone.body))
  // No domains yet, and a domain this space does not hold is refused.
  equal(await rowsOf(ada, spaceDomains(space)), [])
  let pointed = await wrote(ada, [{
    entity: { eid: crypto.randomUUID() },
    pointDomain: { space, name: 'nowhere.test', destination: '' },
  }])
  equal(
    [pointed.status, pointed.body.message],
    [400, 'This space does not hold that domain.'],
  )
})

test('a tab’s domain search is answered once, by the registrar, with what it came to', async () => {
  let [found] = await rowsOf(ada, domainOffers('oak meadow'))
  equal(
    (found.domainSearch as { query: string; error?: string }).query,
    'oak meadow',
  )
})

test('a tab chooses how its person is told things away from the page', async () => {
  let chose = await wrote(ada, [{
    entity: { eid: alertingEid(ada.person) },
    alerting: { channel: 'updates' },
  }])
  equal(chose.status, 200, JSON.stringify(chose.body))
  equal(alertingOf(chose.body), {
    channel: 'updates',
    by: 'updates',
    browsers: 0,
  })
  equal(alertingOf(await rowsOf(ada, ALERTING))?.channel, 'updates')
  equal(alertingOf(await rowsOf(bea, ALERTING))?.channel, null)
})

test('a tab reads its space’s plan and month, and only its owner acts on them', async () => {
  let own = (await k.dir.seated(ada.person))
    .find((s) => s.space.slug == 'adas')!.space
  let plan = planOf(await rowsOf(ada, planLine(own.eid)))
  equal([plan?.tier, plan?.known], ['free', false])
  let month = allowancesOf(await rowsOf(ada, allowancesLine(own.eid)))
  equal(month?.limits.apps?.used, 2)
  for (let line of [planLine(own.eid), allowancesLine(own.eid)]) {
    equal(await rowsOf(bea, line), [], line)
  }
  let act = (who: Tab, comp: Record<string, unknown>) =>
    wrote(who, [{ entity: { eid: crypto.randomUUID() }, ...comp }])
  // A seller account connected, and disconnected from its page.
  await k.dir.stamp({
    entities: [{
      entity: { eid: own.eid },
      seller: { via: 'stripe', account: 'acct_ada', ready: true },
    }],
  })
  equal((await act(bea, { sellStop: { space: own.eid } })).status, 403)
  equal((await act(ada, { sellStop: { space: own.eid } })).status, 200)
  equal((await k.dir.space(own.slug))?.seller, null)
  // What the free plan cannot do is refused in words the page says.
  let capped = await act(ada, { creditCap: { space: own.eid, cap: 25 } })
  equal(
    [capped.status, capped.body.message],
    [400, 'AI credit comes with the Pro plan.'],
  )
  let left = await act(ada, {
    leave: { space: own.eid, door: 'portal' },
  })
  equal(
    [left.status, left.body.message],
    [400, 'The paid tier is not switched on here.'],
  )
})

test('a tab reads its space’s Connections and presses its buttons through the door, its owner alone', async () => {
  let own = (await k.dir.seated(ada.person)).find((s) => s.own)!.space.eid
  let line = connectionsPage(own, '')
  let [row] = await rowsOf(ada, line)
  equal(pageOf([row])?.list, [])
  equal(await rowsOf(bea, line), [])
  let press = (who: Tab, form: Record<string, string>) =>
    wrote(who, [{
      entity: { eid: crypto.randomUUID() },
      connectionAct: { space: own, page: '/manage/adas/connections', form },
    }])
  let weather = crypto.randomUUID()
  await meta(k).apply([{
    entity: { eid: weather },
    connection: { owner: own, integration: 'weather', status: 'connected' },
  }])
  equal(
    pageOf(await rowsOf(ada, line))?.list.map((c) => [c.eid, c.status]),
    [[weather, 'connected']],
  )
  let ended = await press(ada, { do: 'disconnect', connection: weather })
  equal(ended.status, 200, JSON.stringify(ended.body))
  equal(actedOf(ended.body), { say: 'Disconnected.' })
  equal(pageOf(ended.body)?.list, [])
  let gone = await press(ada, {
    do: 'disconnect',
    connection: crypto.randomUUID(),
  })
  equal([gone.status, gone.body.message], [
    400,
    'That connection is not here any more.',
  ])
  equal((await press(bea, { do: 'disconnect' })).status, 403)
})

test('a tab writes its person’s account, messages and asks through the door, and only theirs', async () => {
  let hidden = await wrote(ada, [{
    entity: { eid: accountEid(ada.person) },
    account: { hidden: true },
  }])
  equal(hidden.status, 200, JSON.stringify(hidden.body))
  equal(accountOf(hidden.body)?.hidden, true)
  equal(accountOf(await rowsOf(ada, ACCOUNT))?.hidden, true)
  await wrote(ada, [{
    entity: { eid: accountEid(ada.person) },
    account: { hidden: false },
  }])

  let theirs = await wrote(ada, [{
    entity: { eid: accountEid(bea.person) },
    account: { name: 'Mallory' },
  }])
  equal(theirs.status, 403)

  let unknown = await wrote(ada, [{
    entity: { eid: crypto.randomUUID() },
    friendAsk: { email: 'nobody-here@example.com' },
  }])
  equal(
    unknown.status >= 400 && unknown.status < 500,
    true,
    JSON.stringify(unknown.body),
  )

  let stranger = await wrote(ada, [{
    entity: { eid: crypto.randomUUID() },
    friendMessage: { to: bea.person, words: 'Hello' },
  }])
  equal(
    stranger.status >= 400 && stranger.status < 500,
    true,
    JSON.stringify(stranger.body),
  )
})

test('a tab opens first only a space its person owns, and signs out only their browsers', async () => {
  let owned = async (who: Tab) =>
    pickedOf(await rowsOf(who, SIDE_SPACES)).filter((s) => s.owner)
  let first = async (who: Tab) => (await owned(who)).find((s) => s.own)?.slug
  let open = (slug: string) =>
    wrote(ada, [{
      entity: { eid: accountEid(ada.person) },
      account: { first: slug },
    }])
  let was = await first(ada)
  equal((await open((await first(bea))!)).status, 200)
  equal(await first(ada), was)
  let other = (await owned(ada)).find((s) => !s.own)!.slug
  equal((await open(other)).status, 200)
  equal(await first(ada), other)
  await open(was!)

  let again = await signIn(k, ada.email)
  let tab = { cookie: again.cookie, person: ada.person }
  let browsers = async (who: Tab) =>
    signedInOf(await rowsOf(who, SIGNED_IN)).map((b) => b.eid)
  let theirs = (await browsers(bea))[0]
  let mine = await browsers(ada)
  let out = (session: string) =>
    wrote(ada, [{ entity: { eid: crypto.randomUUID() }, signOut: { session } }])
  equal((await out(theirs)).status, 200)
  equal(await browsers(bea), [theirs])
  equal(mine.length, 2)
  // One of her two browsers, whichever: it is off the list, and signed out.
  let gone = mine[1]
  equal((await out(gone)).status, 200)
  equal((await browsers(ada)).includes(gone), false)
  equal(
    [
      (await door(ada, '/query?q=.doc')).status,
      (await door(tab, '/query?q=.doc')).status,
    ]
      .filter((s) => s == 401).length,
    1,
  )
})

// Ada pressing a button of her People page in `slug`: the act, answered
// with what it came to, or refused.
let pressIn = (who: Tab, slug: string, act: PeopleAct, args = {}) =>
  pressPeople(k, who, slug, act, args)

test('a tab reads who is in a space its person owns, and invites and takes people off through the door, in no space they do not own', async () => {
  let adas = (await k.dir.space('adas'))!
  let people = async (who: Tab) =>
    holdersOf(await rowsOf(who, holders(adas.eid)))
      .map((p) => `${p.email} ${p.held} ${p.role}`)
  equal(await people(ada), [`${ada.email} seat owner`])
  equal(await people(bea), [])
  equal(await rowsOf(bea, admitted(adas.eid)), [])

  let cy = await signIn(k)
  equal(await pressIn(ada, 'adas', 'memberAdd', { email: cy.email }), {
    status: 200,
    said: 'Invitation sent.',
  })
  equal(await people(ada), [
    `${ada.email} seat owner`,
    `${cy.email} invite editor`,
  ])
  let invite = holdersOf(await rowsOf(ada, holders(adas.eid)))[1].place
  equal(
    await pressIn(ada, 'adas', 'inviteAgain', { invite }),
    { status: 200, said: 'Sent again.' },
  )
  // Bea owns nothing here: she invites no one, and takes no one off.
  equal(
    (await pressIn(bea, 'adas', 'memberAdd', { email: bea.email })).status,
    403,
  )
  equal(
    (await pressIn(bea, 'adas', 'memberRemove', { email: cy.email })).status,
    403,
  )
  equal(
    await pressIn(ada, 'adas', 'memberRemove', { email: cy.email }),
    { status: 200, said: 'Removed.' },
  )
  equal(await people(ada), [`${ada.email} seat owner`])

  // Her own space's Operator let in to work here, and taken back out.
  let own = await k.dir.own(ada.person)
  let operators = async () =>
    admittedOf(await rowsOf(ada, admitted(adas.eid)))
      .map((o) => `${o.slug} ${o.role}`)
  equal(
    await pressIn(ada, 'adas', 'operatorAdmit', {
      operator: own.eid,
      role: 'viewer',
    }),
    { status: 200, said: 'Saved.' },
  )
  equal(await operators(), [`${own.slug} viewer`])
  equal(
    await pressIn(ada, 'adas', 'operatorOut', { operator: own.eid }),
    { status: 200, said: 'Removed.' },
  )
  equal(await operators(), [])
  equal(await rowsOf(ada, INVITABLE), [])
})

test('an Updates page loads the scripts that take its card actions and draw its cards again, with the rows it was drawn from', async () => {
  let own = await k.dir.own(bea.person)
  await tellIn(own.eid, bea.person)
  let page = await k.at(k.host, `/${own.slug}/updates`, {
    headers: { cookie: bea.cookie },
  })
  let html = await page.text()
  let { document } = parseHTML(html)
  let scripts = [...document.querySelectorAll('script[src]')]
    .map((s) => s.getAttribute('src')!)
  equal(
    ['_inbox-actions', '_updates'].map((name) =>
      scripts.some((src) => src.includes(`/${name}.`))
    ),
    [true, true],
  )
  let view = document.querySelector<HTMLElement>('[data-view=updates]')!
  equal(JSON.parse(view.dataset.updatesView!).person, bea.person)
  let drawn = JSON.parse(
    view.querySelector('script[data-page-graph]')!.textContent!,
  ) as { person: string; rows: Bundle[] }
  equal(drawn.person, bea.person)
  equal(
    updatesIn(drawn.rows, own.eid).map((u) => u.eid),
    [...view.querySelectorAll<HTMLElement>('[data-key]')].map((c) =>
      c.dataset.key
    ),
  )
  equal(view.querySelectorAll('[data-key]').length, 1)

  // Every space's Updates together are the same view, across her seats.
  let all = parseHTML(
    await (await k.at(k.host, ALL, { headers: { cookie: bea.cookie } })).text(),
  ).document.querySelector<HTMLElement>('[data-view=updates]')!
  let across = JSON.parse(all.dataset.updatesView!) as UpdatesView
  equal([across.back, across.spaces.map((s) => s.eid)], [ALL, [own.eid]])
  equal(all.querySelectorAll('[data-key] .Update_Where').length, 1)
})

// Connect only the transport that the in-process platform lacks, including
// how the runtime dispatches frames on a hibernatable Durable Object socket.
let linked = (
  { 0: client, 1: server }: Pair,
  message = (data: string) => server.emit('message', data),
  close = () => server.emit('close'),
) => {
  client.send = (data) => message(data)
  server.send = (data) => client.emit('message', data)
  let end = (_code?: number) => {
    if (client.readyState == 3) return
    client.readyState = 3
    close()
    client.emit('close')
  }
  server.close = end
  return Object.assign(client, { close: end })
}

// The Operator's side of `view` as the server draws it before the page
// graph has said anything: no badges, no Updates across spaces.
let sideOf = (view: SideView) => {
  let parts = sideParts(view, [], [])
  return renderToString(
    h(
      'nav',
      { class: 'Sidebar', 'data-side-view': JSON.stringify(view) },
      h(
        'div',
        { class: 'Sidebar_Space' },
        h('div', { class: 'Sidebar_Whose' }, parts.picker),
        section(parts.apps!, false),
      ),
    ),
  )
}

test('one page graph keeps its side live: spaces, apps, and Updates badges across seated Operators and directory requests', async () => {
  await using runtime = platform()
  let { env } = runtime
  let { dir, space: home, app: { eid: book } } = await seeded(env)
  let friend = crypto.randomUUID()
  let seat = crypto.randomUUID()
  let club = crypto.randomUUID()
  await dir.apply({
    entities: [
      { entity: { eid: friend }, person: {} },
      { entity: { eid: club }, space: { slug: 'club', store: 'club' } },
      {
        entity: { eid: crypto.randomUUID() },
        member: { space: club, person: friend, role: 'owner' },
      },
      {
        entity: { eid: seat },
        member: { space: club, person: ADA, role: 'editor' },
      },
    ],
  }, ADA_OWNS)

  let sources: string[] = []
  let opened: ReturnType<typeof linked>[] = []
  let joined = new Set<Pair[1]>()
  let join = (name: string, res: Response, object: {
    webSocketMessage: (ws: Pair[1], data: string) => unknown
    webSocketClose: (
      ws: Pair[1],
      code: number,
      reason: string,
      clean: boolean,
    ) => unknown
  }) => {
    equal(res.status, 101)
    sources.push(name)
    // Several sockets open to one object at once: each takes its own.
    let pair = made.find((pair) =>
      runtime.sockets.get(name)?.includes(pair[1]) && !joined.has(pair[1])
    )!
    joined.add(pair[1])
    let server = pair[1]
    let wire = linked(
      pair,
      (data) => void object.webSocketMessage(server, data),
      () => void object.webSocketClose(server, 1000, '', true),
    )
    opened.push(wire)
    return Object.assign(res, { webSocket: wire })
  }
  let stores = env.STORE, builders = env.BUILDER
  env.STORE = {
    idFromName: stores.idFromName,
    get: (id, options) => ({
      fetch: async (req) => {
        let res = await stores.get(id, options).fetch(req)
        return res.status == 101
          ? join(String(id), res, runtime.object(String(id)))
          : res
      },
    }),
  }
  env.BUILDER = {
    idFromName: builders.idFromName,
    get: (id, options) => ({
      fetch: async (req) => {
        let res = await builders.get(id, options).fetch(req)
        return res.status == 101
          ? join(`builder ${id}`, res, runtime.builder(String(id)))
          : res
      },
    }),
  }
  let door = async (path: string, headers = {}) =>
    manage(
      new Request(`https://yaks.app${REACH}${path}`, {
        headers: { cookie: await as(ADA), ...headers },
      }),
      env,
    )
  let tell = async (space: string, to: string) => {
    let res = await runtime.builder(space).fetch(
      new Request('https://builder/operator/tell', {
        method: 'POST',
        headers: {
          ...KERNEL,
          [SPACE]: space,
          'content-type': 'application/json',
        },
        body: JSON.stringify({ to, words: 'An update' }),
      }),
    )
    equal(res.ok, true, await res.text())
  }
  await tell(club, friend)
  await tell(home.eid, ADA)
  let undo = installPair()
  try {
    equal(
      (await door(`/ws?${TAB_PERSON}=${friend}`, { upgrade: 'websocket' }))
        .status,
      401,
    )
    equal((await door('/ws', { upgrade: 'websocket' })).status, 101)
    let socket = linked(made[0])
    socket.readyState = 0
    let frames: Frame[] = []
    socket.addEventListener('message', ({ data }) => {
      let packet = JSON.parse(String(data)) as Frame | { frames: Frame[] }
      frames.push(...('frames' in packet ? packet.frames : [packet])
        .filter((f) => f.bundles))
    })
    // The Updates badges' frames, which say each member's revision.
    let waits = () => frames.filter((f) => typeof f.revision == 'object')
    let pane = sideOf({
      person: ADA,
      here: { slug: 'ada', title: 'ada', owner: true, own: true },
      talk: {
        space: home.eid,
        open: 'new',
        all: false,
        at: 'https://ada.yaks.app',
      },
    })
    let { document, window } = parseHTML(`<html><body>${pane}</body></html>`)
    let next = socket
    let time = clock(Date.now())
    let page = client(
      loadVocab([
        waitingWords,
        sideWords,
        accountWords,
        visitWords,
        spacePagesWords,
        appCanvasWords,
        agentsWords,
        connectionsWords,
      ]),
      [],
      {
        url: `https://yaks.app${REACH}`,
        connect: () => {
          let current = next
          queueMicrotask(() => {
            current.readyState = 1
            current.emit('open')
          })
          return current
        },
        timer: (fn, ms) => void time.after(ms, fn),
        time: time.now,
        vault: false,
        wireVault: false,
      },
    )
    let stop = bindSide(document, () => page)
    let watch = page.watch(UPDATE_WAITING)
    let spaces = page.watch(SIDE_SPACES)
    let apps = page.watch(sideApps(home.eid))
    let visits = page.watch(visitCounts(home.eid))
    // The space's Trash page, which its owner has open.
    let trash = page.watch(spaceTrash(home.eid))
    let badge = (slug = '') =>
      document.querySelector(`[data-across="${slug}"]`)!
    let counts = () => Object.fromEntries(waitingCounts(watch.value))
    let side = () => ({
      spaces: [...document.querySelectorAll('.Sidebar_Whose .Identity_Name')]
        .map((n) => n.textContent),
      apps: [
        ...document.querySelectorAll(
          '[data-side-part="side-apps"] a .SideNav_Label',
        ),
      ].map((n) => n.textContent),
      across: !!document.querySelector('[data-side-part="side-personal"]'),
    })
    try {
      await until(() => watch.ready || watch.refused !== undefined)
      equal(watch.refused, undefined)
      equal(counts(), { ada: 1, club: 0 })
      await until(() => spaces.ready && apps.ready && visits.ready)
      // Visits, which no store holds, read beside the apps' own socket.
      equal(countsOf(visits.value, home.eid), null)
      visits.close()
      await until(() => side().apps.length == 1)
      equal(side(), {
        spaces: ['ada', 'ada', 'club'],
        apps: ['Cookbook'],
        across: true,
      })

      // An app made, renamed and put in the trash, each on the side as the
      // directory takes it.
      let jots = crypto.randomUUID()
      await dir.apply({
        entities: [{
          entity: { eid: jots },
          doc: { title: 'Jots' },
          app: {
            slug: 'jots',
            space: home.eid,
            version: 1,
            access: 'public',
            store: 'ada/jots',
          },
        }],
      }, ADA_OWNS)
      await until(() => side().apps.length == 2)
      equal(side().apps, ['Cookbook', 'Jots'])
      await dir.apply({
        entities: [{ entity: { eid: jots }, doc: { title: 'Jottings' } }],
      }, ADA_OWNS)
      await until(() => side().apps.includes('Jottings'))
      await dir.apply({
        entities: [{
          entity: { eid: jots },
          trashed: { at: new Date().toISOString(), by: ADA },
        }],
      }, ADA_OWNS)
      await until(() => side().apps.length == 1)
      equal(side().apps, ['Cookbook'])
      await until(() => binnedOf(trash.value).length == 1)
      equal(binnedOf(trash.value).map((b) => b.name), ['Jottings'])
      let initial = waits().at(-1)!.revision as Record<string, number>
      equal(
        Object.keys(initial).sort(),
        [
          PLATFORM_STORE,
          `operator/${home.eid}`,
          `operator/${club}`,
        ].sort(),
      )
      // The directory answers the spaces, the apps and its share of the
      // badges, each on its own socket; each seated Operator its count.
      equal(
        sources.toSorted(),
        [
          PLATFORM_OBJECT,
          PLATFORM_OBJECT,
          PLATFORM_OBJECT,
          PLATFORM_OBJECT,
          PLATFORM_OBJECT,
          `builder ${home.eid}`,
          `builder ${club}`,
        ].sort(),
      )

      await tell(club, ADA)
      await until(() => badge().textContent == '2')
      equal(counts(), { ada: 1, club: 1 })
      equal(waits().at(-1)!.since, initial)

      await dir.stamp({
        entities: [
          friendSide(friend, ADA, { decided: { verdict: 'approved' } }),
        ],
      })
      await until(() => badge().textContent == '3')
      equal(counts(), { ada: 2, club: 1 })

      let app = crypto.randomUUID(), transfer = crypto.randomUUID()
      await dir.apply({
        entities: [{
          entity: { eid: app },
          app: { space: club, slug: 'offered', store: 'club/offered' },
        }],
      })
      let transferTo = (request: Record<string, unknown>) =>
        dir.stamp({
          entities: [{
            entity: { eid: '$appTransfer' },
            $appTransfer: { at: new Date().toISOString(), ...request },
          }],
        })
      await transferTo({
        person: friend,
        eid: transfer,
        offer: { from: club, app, recipient: ADA, editor: false },
      })
      await until(() => badge().textContent == '4')
      equal(counts(), { ada: 3, club: 1 })
      await transferTo({
        person: ADA,
        space: home.eid,
        transfer,
        answer: 'decline',
      })
      await until(() => badge().textContent == '3')

      document.body.innerHTML = pane
      document.dispatchEvent(new window.Event(PAGE))
      equal(badge().textContent, '3')
      equal(side().apps, ['Cookbook'])
      equal(sources.length, 7)

      await dir.apply(
        { entities: [{ entity: { eid: seat }, $delete: true }] },
        ADA_OWNS,
      )
      // A seat taken away takes its space off the side, and Updates across
      // spaces with it, now there is one.
      await until(() => !side().across)
      equal(counts(), { ada: 2 })
      equal(side().spaces, ['ada'])
      equal(badge(), null)
      equal(watch.value.length, 1)
      equal(spaces.value.length, 1)

      socket.close()
      // What changes while the page is away is drawn once it is back.
      await dir.apply({
        entities: [{ entity: { eid: book }, doc: { title: 'Recipes' } }],
      }, ADA_OWNS)
      await dir.stamp({
        entities: [
          friendSide(ADA, friend, { decided: { verdict: 'approved' } }),
        ],
      })
      equal((await door('/ws', { upgrade: 'websocket' })).status, 101)
      next = linked(made.at(-1)!)
      next.readyState = 0
      await time.advance(250)
      await until(() => counts().ada == 1)
      await until(() => side().apps[0] == 'Recipes')
      equal(
        sources.slice(7).sort(),
        [
          PLATFORM_OBJECT,
          PLATFORM_OBJECT,
          PLATFORM_OBJECT,
          PLATFORM_OBJECT,
          `builder ${home.eid}`,
        ]
          .sort(),
      )

      // A browser signing in elsewhere is on Profile's list, and off it once
      // it signs out.
      let browsers = page.watch(SIGNED_IN)
      await until(() => browsers.ready)
      let session = sessionRow({
        eid: crypto.randomUUID(),
        via: crypto.randomUUID(),
        until: new Date(Date.now() + 86_400_000).toISOString(),
        agent: 'Elsewhere',
      }, ADA)
      let listed = () =>
        signedInOf(browsers.value).some((b) => b.eid == session.entity.eid)
      await dir.stamp({ entities: [session] })
      await until(listed)
      await dir.stamp({ entities: [{ ...session, cancelled: {} }] })
      await until(() => !listed())
      browsers.close()

      // An app someone lets her into is on her Shared with you, and a friend
      // who signs up with her invite is counted on it, each as it is written.
      let shared = page.watch(SHARED_APPS)
      let invite = page.watch(INVITE_PAGE)
      await until(() => shared.ready && invite.ready)
      equal(sharedOf(shared.value), [])
      equal(inviteOf(invite.value)?.joined, 0)
      await dir.stamp({
        entities: [{
          entity: { eid: crypto.randomUUID() },
          grant: { app, person: ADA, access: 'editor' },
        }],
      })
      await until(() => sharedOf(shared.value).length == 1)
      equal(sharedOf(shared.value), [
        { eid: app, slug: 'offered', title: 'offered', space: 'club' },
      ])
      await dir.stamp({
        entities: [{
          entity: { eid: referralEid(friend) },
          referral: { inviter: ADA, invitee: friend },
        }],
      })
      await until(() => inviteOf(invite.value)?.joined == 1)
      shared.close()
      invite.close()

      // The agents the person connected, read again as a grant is made and
      // revoked elsewhere.
      await dir.stamp({
        entities: [{
          entity: { eid: ADA },
          grants_listed: { at: new Date().toISOString() },
        }],
      })
      let agents = page.watch(AGENTS)
      await until(() => agentsOf(agents.value) != undefined)
      equal(agentsOf(agents.value), [])
      let grant = {
        entity: { eid: crypto.randomUUID() },
        oauth_grant: {
          person: ADA,
          id: crypto.randomUUID(),
          client: crypto.randomUUID(),
          created: Math.floor(Date.now() / 1000),
          redirect: 'https://claude.ai/callback',
        },
      }
      await dir.stamp({ entities: [grant] })
      await until(() => agentsOf(agents.value)?.length == 1)
      equal(agentsOf(agents.value), [
        { id: 'claude', name: 'Claude', brand: 'claude' },
      ])
      await dir.stamp({ entities: [{ ...grant, cancelled: {} }] })
      await until(() => agentsOf(agents.value)?.length == 0)
      agents.close()

      // The space's Connections page, read again as a connection is made in
      // the directory, which says so on a person's socket it keeps open.
      let connections = page.watch(connectionsPage(home.eid, ''))
      await until(() => pageOf(connections.value)?.list != undefined)
      equal(pageOf(connections.value)?.list, [])
      let weather = crypto.randomUUID()
      await dir.stamp({
        entities: [{
          entity: { eid: weather },
          connection: {
            owner: home.eid,
            integration: 'weather',
            status: 'connected',
          },
        }],
      })
      await until(() => pageOf(connections.value)?.list.length == 1)
      equal(pageOf(connections.value)?.list.map((c) => c.eid), [weather])
      connections.close()

      // What an app beside the chat is made of, read again as its draft is
      // written, on a directory socket that stays admitted.
      let making = page.watch(appMaking(book))
      await until(() => making.ready || making.refused !== undefined)
      equal(makingOf(making.value, book)?.made.kinds, [])
      await TOOLS.find((t) => t.name == 'app_files')!.run(
        { env, dir, person: ADA },
        {
          app: 'cookbook',
          files: [{
            path: 'vocab.json',
            content: JSON.stringify({
              $defs: { recipe: { properties: { serves: { type: 'number' } } } },
            }),
          }],
        },
      )
      await until(() => makingOf(making.value, book)?.made.kinds.length == 1)
      equal(makingOf(making.value, book)?.made.kinds.map((k) => k.name), [
        'Recipe',
      ])
      making.close()

      let updates = await manage(
        new Request('https://yaks.app/ada/updates', {
          headers: { cookie: await as(ADA) },
        }),
        env,
      )
      equal(updates.status, 200)
      await updates.body?.cancel()
      await until(() => counts().ada == 0)
    } finally {
      stop()
      watch.close()
      spaces.close()
      apps.close()
      page.close()
    }
  } finally {
    for (let wire of opened) wire.close?.(1000)
    undo()
  }
})

test('an Apps page carries the rows it was drawn from and the script that draws it again, and a tab reads them through the door', async () => {
  let { space } = (await k.dir.seated(ada.person)).find((s) =>
    s.space.slug == 'adas'
  )!
  let page = await k.at(k.host, managePath('apps', 'adas'), {
    headers: { cookie: ada.cookie },
  })
  let { document } = parseHTML(await page.text())
  let scripts = [...document.querySelectorAll('script[src]')]
    .map((s) => s.getAttribute('src')!)
  equal(scripts.some((src) => src.includes('/_apps.')), true)
  let view = document.querySelector<HTMLElement>('[data-view=apps]')!
  equal(
    (JSON.parse(view.dataset.appsView!) as AppsView).space,
    { eid: space.eid, slug: 'adas' },
  )
  let drawn = JSON.parse(
    view.querySelector('script[data-page-graph]')!.textContent!,
  ) as { person: string; rows: Bundle[] }
  let listed = (rows: Bundle[]) =>
    listedOf(rows, space.eid).map((a) => a.slug).sort()
  equal(listed(drawn.rows), ['lists', 'notes'])
  equal(
    [...view.querySelectorAll('#apps .Rows_Open')].map((a) => a.textContent)
      .sort(),
    ['lists', 'notes'],
  )
  // The tab reads the same, and nothing of a space its person holds no
  // seat in.
  equal(listed(await rowsOf(ada, spaceApps(space.eid))), ['lists', 'notes'])
  equal(await rowsOf(bea, spaceApps(space.eid)), [])
  equal(await rowsOf(ada, brokenApps(space.eid)), [])
  equal(await rowsOf(bea, brokenApps(space.eid)), [])
  equal(agentsOf(await rowsOf(ada, AGENTS)), [])
})

test('Agents and New app carry the agents row and the script that draws them again, and Disconnect goes through the door', async () => {
  let drawn = async (path: string) => {
    let page = await k.at(k.host, path, { headers: { cookie: ada.cookie } })
    equal(page.status, 200)
    let { document } = parseHTML(await page.text())
    let scripts = [...document.querySelectorAll('script[src]')]
      .map((s) => s.getAttribute('src')!)
    equal(scripts.some((src) => src.includes('/_agents.')), true)
    let view = document.querySelector<HTMLElement>('[data-view=agents]')!
    let rows = JSON.parse(
      view.querySelector('script[data-page-graph]')!.textContent!,
    ).rows as Bundle[]
    return { view: JSON.parse(view.dataset.agentsView!), rows, at: view }
  }
  let agents = await drawn(managePath('agents'))
  equal([agents.view.page, agents.view.space], ['agents', undefined])
  equal(agentsOf(agents.rows), [])
  equal(!!agents.at.querySelector('.Tabs_Panel-claude'), true)
  let made = await drawn(managePath('new', 'adas'))
  equal([made.view.page, made.view.space], ['new', 'adas'])
  equal(agentsOf(made.rows), [])
  equal(
    made.at.querySelector('.Card-accent')?.hasAttribute('hidden'),
    false,
  )
  // A press the door does as the person: what it came to, and their agents
  // read again.
  let res = await door(ada, '/apply', {
    method: 'POST',
    body: JSON.stringify([{
      entity: { eid: crypto.randomUUID() },
      disconnectAgent: { agent: 'claude' },
    }]),
  })
  equal(res.status, 200)
  let [said, ...rows] = await res.json() as Bundle[]
  equal(said.disconnectAgent, { agent: 'claude', said: 'Disconnected.' })
  equal(agentsOf(rows), [])
})
