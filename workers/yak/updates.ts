import { Empty } from '@yaks/ui/parts'
// Updates from the Operator (T-140508): what happened in a space, as messages
// from its Operator a person can reply to, at `/manage/<space>/updates`
// (@yaks/platform/routes `managePath('updates', …)`), beside the chat app's side
// (operator-page.ts `updatesPage`). They are @yaks/inbox's, read in the
// Operator's store (operator-updates.ts): what needs the person first, with a
// button for each choice, then what happened, newest first. A choice, or
// words about one, go into their conversation, and the chat they went to
// opens.
import { Time } from '@yaks/ui/parts'
import type { Env } from './env.ts'
import type { Space } from './directory.ts'
import type { Who } from './session.ts'
import { type ComponentChildren, Fragment, h } from 'preact'
import { Button, Card, Field, More, Preview, State } from '@yaks/ui/parts'
import { operatorDoor } from './build-door.ts'
import { chatPath, managePath } from '@yaks/platform/routes'
import { spaceHost } from '@yaks/platform/host'
import type { Shown, Update } from './operator-updates.ts'
import { lastDay } from './views.ts'
import { markdown } from '@yaks/session/conversation'
import { caught } from './defects.ts'
import type { List } from './talk-beside.ts'
import type { Choice } from '@yaks/task'
import { attachmentKey } from './attachments.ts'
import { directoryOf } from './directory.ts'
import { PICTURES } from './operator-draw.ts'
import { inApp } from './tool.ts'
import { linkOf } from './preview.ts'
import { draftsOf, theirs } from './written.ts'
import { CallError } from '@yaks/tools/errors'

/** A person's Updates in a space, and how many wait on them: what needs
 * them, and what they have not read, which the side counts beside "Updates
 * from <Operator>". `seen` marks what they read now as read. */
export type Updates = { updates: Update[]; waiting: number }
export let updatesOf = (
  env: Env,
  space: Space,
  who: Who,
  seen = false,
): Promise<Updates> =>
  operatorDoor(env, space, who, 'updates', seen ? { seen } : {}) as Promise<
    Updates
  >

/** The apps an update can be about, by eid, where they open. */
export type Apps = { eid: string; slug: string; title: string }[]

// Where an update leads: the chat its work was done in, or the app it is
// about.
let leads = (env: Env, space: Space, u: Update, apps: Apps) => {
  if (u.work) {
    return h('a', { href: chatPath(space.slug, u.work) }, 'See the chat')
  }
  let app = apps.find((a) => a.eid == u.about)
  return app
    ? h('a', {
      href: `https://${spaceHost(env, space.slug)}/${app.slug}/`,
      target: '_blank',
      rel: 'noopener',
    }, `Open ${app.title || app.slug}`)
    : null
}

// Every form here goes to the Updates page as a new request to the
// Operator, whose id it carries so sending twice sends once.
let form = (
  space: Space,
  fields: [string, string][],
  ...inner: ComponentChildren[]
) =>
  h(
    'form',
    {
      class: 'Update_Form Page_Form',
      method: 'post',
      action: managePath('updates', space.slug),
    },
    [...fields, ['id', crypto.randomUUID()]].map(([name, value]) =>
      h('input', { type: 'hidden', name, value })
    ),
    ...inner,
  )

// What an update says, in the Markdown the Operator writes it in.
let words = (text: string) =>
  h('div', { class: 'Update_Words' }, markdown(text))

// When it happened, said the human way.
let stamp = (u: Update) => h(Time, { at: u.at, class: 'Update_When' })

// Where what a choice shows is read: a file kept in the space, through the
// question that shows it, or an app's draft, at the reader's own preview
// link (`shownAnswer`).
let shownAt = (space: Space, u: Update, s: Shown) =>
  `${managePath('updates', space.slug)}?${
    s.artifact
      ? `shown=${encodeURIComponent(u.eid)}&eid=${encodeURIComponent(s.eid)}`
      : `draft=${encodeURIComponent(s.eid)}`
  }`

// What a choice shows, drawn by its components: a picture, a file to open,
// prose, or else an app, its draft in a frame.
let showing = (space: Space, u: Update, s: Shown) => {
  let at = shownAt(space, u, s)
  if (s.artifact) {
    return s.artifact.media_type.startsWith('image/')
      ? h('img', { class: 'Update_Picture', src: at, alt: s.choice })
      : h('a', { href: at, target: '_blank', rel: 'noopener' }, 'Open file')
  }
  if (s.doc) {
    return h(
      'div',
      { class: 'Update_Prose' },
      s.doc.title ? h('b', null, s.doc.title) : null,
      s.doc.body ? markdown(s.doc.body) : null,
    )
  }
  return h(
    Preview,
    { class: 'Update_Draft' },
    h(
      Preview.Address,
      { href: at, target: '_blank', rel: 'noopener' },
      'Open the draft',
    ),
    h(Preview.Frame, {
      mod: 'flat',
      src: at,
      loading: 'lazy',
      title: `${s.choice}, the draft`,
    }),
  )
}

// Choices that show something: each a column with what it shows, its words
// and its button under them, side by side where there is room and one above
// the next on a phone.
let shownChoices = (space: Space, u: Update, choices: Choice[]) =>
  form(
    space,
    [['choose', u.eid]],
    h(
      'ul',
      { class: 'Update_Choices Update_Choices-shown' },
      choices.map((c, i) =>
        h(
          'li',
          { class: 'Update_Choice' },
          (u.shown ?? []).filter((s) => s.choice == c.label)
            .map((s) => showing(space, u, s)),
          h('p', null, h('b', null, c.label), `: ${c.description}`),
          h(
            Button,
            { mod: !i && 'go', name: 'choice', value: c.label },
            c.label,
          ),
        )
      ),
    ),
  )

// What needs a person: the Operator's question, its choices, a button for
// each (the one it recommends first and filled), and below them a way to ask
// about it, opened in place. Choices that show something are drawn with it.
let needsCard = (space: Space, u: Update) => {
  let choices = [...u.choices ?? []].sort((a, b) =>
    +(b.label == u.recommended) - +(a.label == u.recommended)
  )
  if (u.shown?.length) {
    return h(
      Card,
      { class: 'Update Update-needs', id: `u-${u.eid}` },
      h(Card.Head, null, h(State, { mod: 'negative' }, 'Needs you'), stamp(u)),
      words(u.words),
      shownChoices(space, u, choices),
      replying(space, u),
    )
  }
  return h(
    Card,
    { class: 'Update Update-needs', id: `u-${u.eid}` },
    h(Card.Head, null, h(State, { mod: 'negative' }, 'Needs you'), stamp(u)),
    words(u.words),
    choices.length
      ? h(
        Fragment,
        null,
        h(
          'ul',
          { class: 'Update_Choices' },
          choices.map((c) =>
            h('li', null, h('b', null, c.label), `: ${c.description}`)
          ),
        ),
        form(
          space,
          [['choose', u.eid]],
          h(
            Card.Actions,
            null,
            choices.map((c, i) =>
              h(
                Button,
                { mod: !i && 'go', name: 'choice', value: c.label },
                c.label,
              )
            ),
          ),
        ),
      )
      : null,
    replying(space, u),
  )
}

/** What needs the person among their Updates, newest first, as the list
 * beside their conversation (talk-beside.ts), each answered where it is. */
export let needsList = (space: Space, { updates }: Updates): List => {
  let needs = updates.filter((u) => u.needs)
  return {
    count: needs.length,
    node: needs.length ? needs.map((u) => needsCard(space, u)) : null,
  }
}

// A way to send the Operator words about an update, opened in place.
let replying = (space: Space, u: Update) =>
  h(
    More,
    { mod: 'quiet', class: 'Update_Reply' },
    h(More.Summary, {}, `Ask ${space.operator} about it`),
    h(
      More.Body,
      {},
      form(
        space,
        [['reply', u.eid]],
        h(Field, {
          class: 'Update_Input',
          lines: true,
          name: 'say',
          required: true,
          'aria-label': `Your words to ${space.operator}`,
        }),
        h(Button, { mod: 'go', type: 'submit' }, 'Send'),
      ),
    ),
  )

let card = (env: Env, space: Space, u: Update, apps: Apps) => {
  if (u.needs) return needsCard(space, u)
  let lead = leads(env, space, u, apps)
  return h(
    Card,
    { class: u.unread ? 'Update Update-new' : 'Update', id: `u-${u.eid}` },
    words(u.words),
    h(
      'p',
      { class: 'Update_Meta' },
      stamp(u),
      lead ? [' · ', lead] : null,
      u.unread ? [' · ', h(State, { mod: 'positive' }, 'New')] : null,
    ),
    replying(space, u),
  )
}

/** How long the Updates page waits on the last day's visits before it is
 * drawn without them: they are a curiosity, never worth a slow page. */
export let VISITS_WAIT = 1500

/** Each app's visits in the last day, or none where they are not switched on
 * or not answered within `wait`. */
export let visitsOf = async (
  env: Env,
  apps: Apps,
  wait = VISITS_WAIT,
): Promise<Map<string, number> | undefined> => {
  let asked = apps.length ? lastDay(env, apps.map((a) => a.eid)) : null
  if (!asked) return undefined
  let timer: number | undefined
  try {
    return await Promise.race([
      asked,
      new Promise<undefined>((done) => timer = setTimeout(done, wait)),
    ])
  } catch (e) {
    caught(e, { request: 'updates visits' })
    return undefined
  } finally {
    clearTimeout(timer)
  }
}

let COUNT = new Intl.NumberFormat('en')
let SMALL = ['No', 'One', 'Two', 'Three', 'Four', 'Five']

/** The Operator's word on the last day, said when the page is drawn: the
 * visits across the apps and the busiest of them, when there are any to
 * count, and what needs the person. The server knows no one's clock, so it
 * is the last day and not today. */
export let lastDayLine = (
  apps: Apps,
  views: Map<string, number> | undefined,
  needs: number,
) => {
  let said: string[] = []
  if (views && apps.length) {
    let counted = apps.map((a) => ({ a, n: views.get(a.eid) ?? 0 }))
      .filter((c) => c.n > 0).sort((x, y) => y.n - x.n)
    let total = counted.reduce((sum, c) => sum + c.n, 0)
    said.push(
      total
        ? `In the last day, your apps had ${COUNT.format(total)} visit${
          total == 1 ? '' : 's'
        }.`
        : 'Nobody visited your apps in the last day.',
    )
    if (counted.length > 1) {
      said.push(`${counted[0].a.title || counted[0].a.slug} was the busiest.`)
    }
  }
  said.push(
    needs
      ? `${SMALL[needs] ?? COUNT.format(needs)} thing${
        needs == 1 ? ' needs' : 's need'
      } you.`
      : 'Nothing needs you.',
  )
  return said.join(' ')
}

/** What the Updates page shows under its bar. */
export let updates = (
  env: Env,
  space: Space,
  { updates }: Updates,
  apps: Apps = [],
  views?: Map<string, number>,
) =>
  h(
    Fragment,
    null,
    h(
      'p',
      { class: 'Note Update_About' },
      `${space.operator} writes here when something happens in your apps, and asks here when something needs you. Ask about any of it, and the chat opens.`,
    ),
    h(
      Card,
      { class: 'Update Update-day' },
      h(
        'p',
        { class: 'Update_Words' },
        lastDayLine(apps, views, updates.filter((u) => u.needs).length),
      ),
    ),
    updates.length ? updates.map((u) => card(env, space, u, apps)) : h(
      'div',
      { class: 'Talk_Hello' },
      h(Empty.Title, { mod: 'welcome' }, 'Nothing yet'),
      h(
        'p',
        null,
        `When ${space.operator} finishes something, fixes an app, or someone joins, it shows here.`,
      ),
    ),
  )

/** What a person sends from their Updates: a choice, or words about one.
 * Either goes into their conversation with the Operator, and the chat it
 * went to opens. */
export let updatesAnswer = async (
  req: Request,
  env: Env,
  space: Space,
  who: Who,
) => {
  let form = await req.formData()
  let field = (name: string) => String(form.get(name) ?? '')
  let { request } = await operatorDoor(
    env,
    space,
    who,
    'updates',
    form.has('choose')
      ? { choose: field('choose'), choice: field('choice'), id: field('id') }
      : { reply: field('reply'), say: field('say'), id: field('id') },
  ) as { request: string }
  return new Response(null, {
    status: 303,
    headers: { location: chatPath(space.slug, request) },
  })
}

/** What a choice of a person's question shows, read from their Updates
 * (`?shown=<question>&eid=<file>`): a file kept in the space, a picture
 * opening in place and anything else saved; or an app's draft
 * (`?draft=<app>`), sent on to the reader's own preview link (preview.ts
 * `linkOf`), which the platform lets the page frame. Undefined for a read
 * that names neither. */
export let shownAnswer = async (
  req: Request,
  env: Env,
  space: Space,
  who: Who,
): Promise<Response | undefined> => {
  let q = new URL(req.url).searchParams
  let missing = (what: string) =>
    new Response(`That ${what} is missing.`, { status: 404 })
  if (q.has('shown')) {
    let file = await operatorDoor(env, space, who, 'updates', {
      shown: q.get('shown'),
      eid: q.get('eid') ?? '',
    }).catch((e) => e?.status == 404 ? null : Promise.reject(e)) as
      | { address: string; media_type: string }
      | null
    if (!file) return missing('file')
    let kept = await env.BLOBS.get(attachmentKey(space, file.address))
    if (!kept) return missing('file')
    let shows = PICTURES.includes(file.media_type)
    return new Response(await kept.arrayBuffer(), {
      headers: {
        'content-type': shows ? file.media_type : 'application/octet-stream',
        'content-disposition': shows ? 'inline' : 'attachment',
        'x-content-type-options': 'nosniff',
        'content-security-policy': "sandbox; default-src 'none'",
        'cache-control': 'private, no-store',
      },
    })
  }
  if (!q.has('draft')) return undefined
  if (!env.SESSION_SECRET) return missing('draft')
  let dir = directoryOf(env.STORE)
  // A draft by its own id, or an app's, whose draft is the reader's own
  // (written.ts `theirs`).
  let shown = q.get('draft')!
  if (!/^[0-9a-f-]{36}$/i.test(shown)) return missing('draft')
  let named = await dir.draftAt(shown)
  let held = await dir.appAt(named?.app ?? shown)
  if (!held || held.app.space != space.eid) return missing('draft')
  let ctx = { env, dir, person: who.person ?? '' }
  let found = await inApp(ctx, { space: space.slug, app: held.app.slug })
    .catch((e) => e instanceof CallError ? null : Promise.reject(e))
  if (!found) return missing('draft')
  let of = named?.draft ??
    theirs(await draftsOf(dir, found.app), found.who)
  if (!of) return missing('draft')
  let { at } = await linkOf(ctx, space, found.app, found.who, of)
  return new Response(null, { status: 302, headers: { location: at } })
}
