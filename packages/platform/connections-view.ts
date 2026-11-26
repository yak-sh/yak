/**
 * A space's Connections page (`/manage/<space>/connections`), drawn from its
 * `connectionsPage` row (./connections-page.ts): the connections agents asked
 * for, the person's own, the space's and what its apps borrow, the person's
 * MCP servers, and the catalog of services to connect. One dialog shows the
 * connection, loan, server or service opened (`opened`, the address's hash in
 * the browser, `?detail=` on the server). What the page says beside the row,
 * which changes only by leaving the page, is its `ConnectionsView`. The server
 * draws it for the first paint, and the browser draws it again as the row
 * moves (./connections-browser.ts).
 *
 * @module
 */
import {
  cloneElement,
  type ComponentChildren as Kids,
  h,
  type VNode,
} from 'preact'
// @ts-types="@yaks/ui/lucide"
import X from 'lucide/dist/esm/icons/x.mjs'
import { Button } from '@yaks/ui/Button'
import { Card } from '@yaks/ui/Card'
import { Cards } from '@yaks/ui/Cards'
import { Check } from '@yaks/ui/Check'
import { Chip } from '@yaks/ui/Chip'
import { Chips } from '@yaks/ui/Chips'
import { Field } from '@yaks/ui/Field'
import { Form } from '@yaks/ui/Form'
import { Group } from '@yaks/ui/Group'
import { Icon } from '@yaks/ui/Icon'
import { Logo } from '@yaks/ui/Logo'
import { Modal } from '@yaks/ui/Modal'
import { More } from '@yaks/ui/More'
import { Notice } from '@yaks/ui/Notice'
import { Rows } from '@yaks/ui/Rows'
import { Time } from '@yaks/ui/Time'
import { type Host, spaceHost, url } from './host.ts'
import { FRIENDS_ACCESS } from './app-friends.ts'
import { enabling, managePath } from './routes.ts'
import { count } from './standing.ts'
import { choice } from './side-parts.ts'
import type { Picked } from './side-rows.ts'
import {
  empty,
  fieldsOf,
  heading,
  held,
  labeled,
  said as told,
  sentence,
  status,
} from './page-parts.ts'
import {
  about,
  connects,
  detail,
  howTo,
  keyBox,
  links,
  logo,
  raw,
  signingIn,
} from './connect-parts.ts'
import type {
  Borrowed,
  Connections,
  Face,
  Grantee,
  McpPage,
  Offered,
  Shown,
  Using,
} from './connections-page.ts'

/** What the page says beside its row: whose and which space's it is, where
 * yaks.app answers, and the spaces the person owns, which a service opened
 * may be connected to instead. */
export type ConnectionsView = {
  person: string
  space: { eid: string; slug: string }
  /** where yaks.app answers (./host.ts `Host`) */
  env: Host
  spaces: Picked[]
  /** what its address asks the read (./connections-page.ts `askOf`) */
  ask: string
}

// The integration directory, which lists services others added.
let DIRECTORY = '/integrations'

// A label for what may be left empty.
let optional = (label: Kids) => [
  label,
  ' ',
  h(Form.Optional, null, '(optional)'),
]

// What the page says of something, as a notice; a refusal where `no`.
let noticed = (say?: string, no?: boolean) =>
  say ? h(Notice, { mod: no && 'negative', role: 'status' }, say) : null

// How a connection stands, as its head says it.
let STATUS = {
  needed: 'Needs connecting',
  connected: 'Connected',
  broken: 'Needs reconnecting',
}

// Where a key may be sent, said once beside wherever it is pasted.
// Addresses, each as code, a comma apart.
let codes = (hosts: string[]) =>
  hosts.flatMap((x, i) => [i ? ', ' : null, h('code', null, x)])

let reach = (hosts: string[]) =>
  hosts.length
    ? ['yaks.app keeps it and only ever sends it to ', codes(hosts), '.']
    : null

// A button a connection's form sends: quiet unless it is the card's one
// next step.
let press = (value: string, label: string, quiet = true) =>
  h(Button, { mod: !quiet && 'go', type: 'submit', name: 'do', value }, label)

let callsOf = (n: number) => `${n} ${n == 1 ? 'call' : 'calls'}`

// Who may call out through an app's link, and the button that changes it:
// the app's space's to say, a copy's borrowed link included.
let callers = (a: Using) =>
  a.anyone ? 'Anyone may call out' : 'Only members call out'

let opening = (a: Using) =>
  press(
    a.anyone ? 'close' : 'open',
    a.anyone ? 'Members only' : 'Open to anyone',
  )

// The calls an app made through a connection this month, against its cap.
let calls = (a: { calls: number; cap: number | null }) =>
  a.cap == null
    ? `${callsOf(a.calls)} this month`
    : `${a.calls} of ${callsOf(a.cap)} this month`

// What a row's line says, each part a dot apart.
let dotted = (parts: Kids[]) =>
  parts.filter(Boolean).flatMap((p, i) => i ? [' · ', p] : [p])

// The kids given, or nothing where none of them is anything.
let any = (...kids: Kids[]) => kids.some(Boolean) ? kids : null

// What a connection lacking scopes its integration now asks for says.
let FULLER = 'Reconnect to give it full access.'

// A connection signed in to, rather than given a key, that is connected or
// was refused, signs in again in place: the same connection, the apps using
// it, and a new grant.
let reconnects = (c: Shown) =>
  !c.keyed && !c.failed && !(c.each && !c.own) &&
  (c.status == 'connected' || c.status == 'broken')

// The button that signs a connection in again, the card's next step when
// it lacks scopes or was refused.
let reconnect = (c: Shown) =>
  signingIn(
    c.face,
    'Reconnect',
    'reconnect',
    !c.lacking.length && c.status == 'connected',
  )

// One connection, as a card: its head says what it is and how it stands and
// holds what acts on all of it (connecting, disconnecting); under it the key
// it still wants, how to get one, the apps using it and the copies borrowing
// it, a box to let one more use it, and folded away what few people need:
// lending it to the copies people install, the name its code reads, a new
// key, and for a service this space added, what it says and whether it is
// listed. The space's side of an app that asks each person to connect
// their own is only the ask: nothing here connects it, and it stays while
// the app asks. Its forms post to the page it is on, `action`.
let connection = (
  c: Shown,
  on: boolean,
  action: string,
  close: Kids,
  context: Kids,
  env: Host,
) => {
  let ask = c.each && !c.own
  let id = (what: string) => `${what}-${c.eid}`
  let form = (kids: Kids, at: Record<string, unknown> = {}) =>
    h(
      'form',
      {
        method: 'post',
        action,
        ...at,
        class: ['Page_Form', at.class].filter(Boolean).join(' '),
      },
      held('connection', c.eid),
      kids,
    )
  let editing = (do_: string, kids: Kids) =>
    form([held('do', do_), kids], { 'data-save': id(do_) })
  let open = c.status != 'connected' || !!c.failed
  // A key is pasted here for a keyed connection this deploy can keep one for.
  let keying = !ask && on && c.keyed
  // A connection an app shares and is waiting on is connected, not removed:
  // removing it would only leave the app a new one waiting. A person's own,
  // for an app that asks each person, is theirs to remove.
  let waiting = c.status == 'needed' && c.apps.length && !c.each
  let actions = any(
    !ask && !c.keyed && open && !reconnects(c)
      ? form(signingIn(c.face, 'Connect', 'signin'), { class: 'Card_Form' })
      : null,
    reconnects(c) ? form(reconnect(c), { class: 'Card_Form' }) : null,
    ask || waiting ? null : form(
      press('disconnect', c.status == 'needed' ? 'Remove' : 'Disconnect'),
      { class: 'Card_Form' },
    ),
    ...links(c.face),
  )
  let stands = ask ? status('Each person connects their own') : status(
    STATUS[c.status],
    c.status == 'connected' ? 'positive' : 'negative',
  )
  let notice = c.failed
    ? noticed(sentence(c.failed), true)
    : c.saving
    ? noticed(sentence(c.saving))
    : c.lacking.length && reconnects(c)
    ? noticed(FULLER)
    : null
  let paste = keying && open
    ? editing(
      'key',
      keyBox(
        id('key'),
        'Paste the key',
        null,
        reach(c.hosts),
        c.face.fields,
      ),
    )
    : null
  let forApp = (a: Using, kids: Kids, at: Record<string, unknown> = {}) =>
    form([held('app', a.app), kids], at)
  // An app that uses it: what its code reads and, for one it shares, who may
  // call out through it there, which the person opens to anyone or closes to
  // members, and the calls it made through it this month against any cap. A
  // person's own is only ever theirs to call out through. A copy another
  // space borrows it for is that space, its calls against the cap it was lent
  // under, and the button that takes the loan back.
  let using = (a: Using) =>
    h(
      Rows.Item,
      { as: 'li' },
      h(
        Rows.Main,
        null,
        h(Rows.Name, null, a.borrower ?? a.title),
        h(
          Rows.Meta,
          null,
          dotted(
            a.borrower != null ? [`Their copy of ${a.title}`, calls(a)] : [
              [
                h('code', null, `env.${a.binding}`),
                a.direct ? ', the key itself' : '',
              ],
              c.each ? '' : callers(a),
              calls(a),
              a.lends == null
                ? ''
                : `Lent to installed copies, ${callsOf(a.lends)} a month each`,
            ],
          ),
        ),
      ),
      c.each ? null : h(
        Rows.Actions,
        null,
        forApp(
          a,
          a.borrower != null ? press('recall', 'Recall') : opening(a),
          { class: 'Rows_Form' },
        ),
      ),
    )
  // The space's own apps first, then the copies borrowing it.
  let rows = [...c.apps].sort((a, b) =>
    Number(a.borrower != null) - Number(b.borrower != null)
  )
  let apps = ask
    ? c.apps.length
      ? h(
        Card.Sub,
        null,
        `Each person who uses ${
          c.apps.map((a) => a.title).join(', ')
        } connects their own account, from the app.`,
      )
      : null
    : c.apps.length
    ? h(Rows, { as: 'ul' }, rows.map(using))
    : h(Card.Sub, null, 'No app uses it yet.')
  // Letting one more app use it: the app, and, folded under the advanced
  // options, the name its code reads it by, which most never change.
  let attaching = c.status == 'connected' && !c.own && c.available.length > 0
  let attach = attaching
    ? form(
      labeled(
        id('attach'),
        'Let an app use it',
        h(
          Form.Line,
          null,
          h(
            Field,
            { choose: true, id: id('attach'), name: 'app', required: true },
            h('option', { value: '' }, 'Choose an app'),
            c.available.map((a) => h('option', { value: a.app }, a.title)),
          ),
          press('attach', 'Attach', false),
        ),
        'Only its members can call out through it, and its code is handed a sentinel, never the key.',
      ),
      { id: id('attaching') },
    )
    : null
  let named = attaching
    ? labeled(
      id('bind'),
      'Name its code reads it by',
      h(Field, {
        id: id('bind'),
        form: id('attaching'),
        name: 'binding',
        autocomplete: 'off',
        spellcheck: 'false',
        pattern: '[A-Za-z_][A-Za-z0-9_]*',
        placeholder: c.binding,
      }),
      [
        'Left empty, its code reads ',
        h('code', null, `env.${c.binding}`),
        '. An agent can rename it later.',
      ],
    )
    : null
  let replace = keying && !open
    ? editing(
      'key',
      keyBox(
        id('key'),
        'Replace the key',
        null,
        reach(c.hosts),
        c.face.fields,
      ),
    )
    : null
  // Where a key nobody pastes here goes, and what a sign-in granted.
  let reached = !keying && c.hosts.length
    ? h(Form.Hint, null, 'Its key is only ever sent to ', codes(c.hosts), '.')
    : null
  // Whether a service this space added is in the integration directory, for
  // anyone to add with their own key: its owner lists it or takes it out.
  let listing = c.about
    ? h(
      Form.Field,
      null,
      h(Form.Label, { as: 'span' }, 'Integration directory'),
      h(
        Form.Hint,
        null,
        c.listed
          ? [
            'Listed in the ',
            h('a', {
              href: `${DIRECTORY}#${encodeURIComponent(c.integration)}`,
            }, 'integration directory'),
            ', for anyone to add with their own key.',
          ]
          : 'Once listed, anyone could add it to a space of theirs, with their own key.',
      ),
      form(
        h(
          Form.Actions,
          null,
          c.listed
            ? press('unlist', 'Take it out')
            : press('list', 'List in the integration directory'),
        ),
      ),
    )
    : null
  // What is said about a service this space added, its owner's to change.
  let told = c.about
    ? h(
      More,
      null,
      h(More.Summary, null, `Change what ${c.face.title} says`),
      editing(
        'about',
        h(
          Form,
          { as: More.Body },
          (
            [
              ['title', 'Its name', 'What people call it'],
              ['tagline', 'One line about it', 'What it is, in a line'],
              ['site', 'Its site', 'https://…'],
              ['example', 'What its key looks like', 'rk_live_••••••••'],
            ] as const
          ).map(([k, label, hint]) =>
            labeled(
              id(k),
              label,
              h(Field, {
                id: id(k),
                name: k,
                value: c.about![k] ?? '',
                placeholder: hint,
                ...k == 'site' && { type: 'url', pattern: 'https://.*' },
              }),
            )
          ),
          labeled(
            id('instructions'),
            'How to get the key',
            h(Field, {
              lines: true,
              id: id('instructions'),
              name: 'instructions',
              rows: 6,
              placeholder:
                'Where to sign up, which page gives the key, and what to paste',
              value: c.about.instructions ?? '',
            }),
            'Written for whoever connects it and the agent helping them, in markdown. Where its key may be sent stays as it is.',
          ),
        ),
      ),
    )
    : null
  // Lending it to the copies people install of an app here: the calls a
  // month each copy may make, saved again to change it, and the button that
  // stops lending and takes every loan back. Only a shared sentinel the app
  // holds is lent, never the key itself.
  let lendable = c.status == 'connected' && !c.own && !c.each
  let lend = (a: Using) => {
    let field = `${id('lend')}-${a.app}`
    let stop = `${field}-stop`
    return [
      forApp(
        a,
        [
          a.lends == null ? null : held('do', 'lend'),
          labeled(
            field,
            `Lend to copies of ${a.title}`,
            h(
              Form.Line,
              null,
              h(Field, {
                id: field,
                name: 'cap',
                type: 'number',
                min: 1,
                step: 1,
                inputmode: 'numeric',
                value: a.lends ?? 100,
                placeholder: 'e.g. 100',
                required: true,
              }),
              a.lends == null ? press('lend', 'Lend') : null,
              a.lends == null ? null : h(
                Button,
                { type: 'submit', form: stop, name: 'do', value: 'lend' },
                'Stop lending',
              ),
            ),
            'The calls a month each copy someone installs may make through it. A copy keeps its own data, never sees the key, and can connect its own instead.',
          ),
        ],
        a.lends == null ? {} : { 'data-save': field },
      ),
      a.lends == null ? null : forApp(a, null, { id: stop, hidden: true }),
    ]
  }
  let lent = lendable
    ? c.apps.filter((a) => a.borrower == null && !a.direct).map(lend)
    : []
  let folded = any(
    h(Form.Hint, null, connects(c.face, c.keyed)),
    ...lent,
    named,
    replace,
    reached,
    listing,
    told,
  )
  let as = c.title || c.account
  // What this connection is here: whom it is for, the account it signed in
  // as, what uses it and what it may do; then, quieter, the service itself.
  let here = h(
    'section',
    { class: 'Connection_Here', 'aria-labelledby': id('here') },
    h('h3', { id: id('here') }, 'This connection'),
    context,
    as && c.status == 'connected'
      ? h(Card.Sub, null, 'Connected as ', h('strong', null, as))
      : null,
    howTo(c.face, open && !ask),
    paste,
    apps,
    attach,
    c.scopes.length && !c.keyed
      ? h(Card.Sub, null, `May use: ${c.scopes.join(', ')}.`)
      : null,
  )
  let service = about(c.face)
  return h(
    Modal.Body,
    { 'data-connection': c.eid },
    heading(c.face.title, {
      mark: logo(c.face, env),
      status: stands,
      actions: close,
    }),
    h(
      Modal.Main,
      null,
      actions ? h(Modal.Actions, { 'aria-label': 'Actions' }, actions) : null,
      notice,
      here,
      service.length
        ? h(
          'section',
          { class: 'Connection_About', 'aria-labelledby': id('about') },
          h('h3', { id: id('about') }, `About ${c.face.title}`),
          service,
        )
        : null,
      h(
        More,
        null,
        h(More.Summary, null, 'Advanced'),
        h(More.Body, null, folded),
      ),
    ),
  )
}

// A connection an app here borrows from the space that lent it with the app,
// as a card: its head says whose it is, its row what the app has spent of the
// cap it was lent under and who may call out through it, which is this space's
// to say, and what replaces it is the space's own: a
// connection it holds already, a sign-in, or a key pasted under the fold.
let borrowing = (
  b: Borrowed,
  env: Host,
  on: boolean,
  action: string,
  close: Kids,
  mine?: Shown,
) => {
  let form = (kids: Kids, connection = b.eid, edit = false, part = '') =>
    h(
      'form',
      {
        class: ['Page_Form', part].filter(Boolean).join(' '),
        method: 'post',
        action,
        ...edit ? { 'data-save': `own-${b.eid}-${b.app.app}` } : {},
      },
      edit ? held('do', 'own') : null,
      held('connection', connection),
      held('app', b.app.app),
      kids,
    )
  let actions = mine
    ? form(press('attach', 'Use your own'), mine.eid, false, 'Card_Form')
    : on && !b.keyed
    ? form(
      signingIn(b.face, 'Connect your own', 'own'),
      b.eid,
      false,
      'Card_Form',
    )
    : null
  let id = `own-${b.eid}-${b.app.app}`
  let own = on && b.keyed && !mine
    ? h(
      More,
      null,
      h(More.Summary, null, 'Use your own key'),
      h(
        More.Body,
        null,
        b.face.instructions ? raw(b.face.instructions) : null,
        form(
          keyBox(
            id,
            'Paste your key',
            null,
            reach(b.hosts),
            b.face.fields,
          ),
          b.eid,
          true,
        ),
      ),
    )
    : null
  return h(
    Modal.Body,
    { 'data-borrowed': b.eid },
    heading(b.face.title, {
      mark: logo(b.face, env),
      status: status(`Borrowed from ${b.lender}`, 'positive'),
      actions: [actions, close],
    }),
    detail(b.face, b.keyed),
    h(
      Card.Sub,
      null,
      `${b.app.title} calls out with ${b.lender}’s key until you use your own. The key stays hidden, and neither of you sees the other’s data.`,
    ),
    h(
      Rows,
      { as: 'ul' },
      h(
        Rows.Item,
        { as: 'li' },
        h(
          Rows.Main,
          null,
          h(Rows.Name, null, b.app.title),
          h(
            Rows.Meta,
            null,
            dotted([
              h('code', null, `env.${b.app.binding}`),
              callers(b.app),
              calls(b.app),
            ]),
          ),
        ),
        h(Rows.Actions, null, form(opening(b.app), b.eid, false, 'Rows_Form')),
      ),
    ),
    own,
  )
}

// One navigable card, its mark above its name and one short line. A card
// holding a control of its own, `act`, is navigated by its title's link,
// which covers the card, so the control stays its own button.
let card = (
  env: Host,
  face: Face,
  line: Kids,
  href?: string,
  stands: Kids = null,
  act: Kids = null,
) =>
  h(
    Card,
    act
      ? { mod: href && 'button' }
      : { mod: href ? 'button' : undefined, href },
    logo(face, env),
    h(
      Card.Title,
      null,
      act && href ? h(Card.Link, { href }, face.title) : face.title,
    ),
    face.tagline ? h(Card.Sub, null, face.tagline) : null,
    line && line != face.tagline ? h(Card.Sub, null, line) : null,
    stands,
    act,
  )

// The link a card's button follows: this page, opened on one thing.
let openedOn = (action: string, value: string) =>
  `${action}#${encodeURIComponent(value)}`

// What each of a server's states says, beside its name.
let MCP_STATE: Record<string, [string, 'positive' | 'negative' | undefined]> = {
  open: ['Connected', 'positive'],
  machine: ['On your machine', 'positive'],
  connected: ['Connected', 'positive'],
  needed: ['Waiting for a key or sign-in', 'negative'],
  broken: ['Its key or sign-in was refused', 'negative'],
}

// One grant's button on the connections page: the app, the source and the
// act, `source-grant` or `source-revoke`.
let granting = (
  action: string,
  a: Grantee,
  at: string,
  act: string,
  label: string,
) =>
  h(
    'form',
    { method: 'post', action, class: 'Card_Form' },
    held('app', a.eid),
    held('at', at),
    press(act, label, act == 'source-revoke'),
  )

// An app asking the person for what they connected (`./api/allow`), at the
// top of their connections page: each source it asks for, allowed or not.
let sourceAsk = (
  ask: NonNullable<McpPage['ask']>,
  action: string,
  env: Host,
) => {
  let friends = ask.at == FRIENDS_ACCESS
  return h(
    Card,
    { id: 'grant' },
    h(
      Card.Title,
      null,
      friends
        ? `Let ${ask.app.title} see your friends?`
        : `${ask.app.title} asks to use what you connected`,
    ),
    h(
      Card.Sub,
      null,
      friends
        ? `${ask.app.title} can read your confirmed friends and their visible online status, and send play invitations on your behalf. You can remove access in Connections.`
        : `Whenever you use ${ask.app.title}, its code may call the tools of what you allow here, as you. Nobody else who uses it reaches them.`,
    ),
    ask.sources.length
      ? ask.sources.map((src) =>
        h(
          Card.Sub,
          null,
          h('strong', null, h(Logo, null, src.title)),
          ` ${src.about} `,
          src.granted
            ? granting(action, ask.app, src.at, 'source-revoke', 'Stop')
            : granting(action, ask.app, src.at, 'source-grant', 'Allow'),
        )
      )
      : h(
        Card.Sub,
        null,
        'You have nothing of that kind connected yet: add it below, then allow it here.',
      ),
    h(
      Card.Sub,
      null,
      h(
        'a',
        { href: `https://${spaceHost(env, ask.app.space)}/${ask.app.slug}/` },
        `Back to ${ask.app.title}`,
      ),
    ),
  )
}

let friendsAccess = (apps: Grantee[], action: string) =>
  h(
    Card,
    null,
    heading('Friends access'),
    apps.map((app) =>
      h(
        Card.Sub,
        { key: app.eid },
        app.title,
        granting(action, app, FRIENDS_ACCESS, 'source-revoke', 'Remove access'),
      )
    ),
  )

// What a server waiting on its credential offers: a box for its key, or a
// button that starts its sign-in (`signin` on its connection).
let mcpCredential = (
  s: McpPage['servers'][number],
  on: boolean,
  action: string,
  redirect?: string,
) => {
  if (s.status != 'needed' && s.status != 'broken') return null
  if (s.keyed) {
    return on
      ? h(
        'form',
        { method: 'post', action, class: 'Page_Form' },
        held('server', s.id),
        labeled(
          `mcp-header-${s.id}`,
          'Header',
          h(Field, {
            id: `mcp-header-${s.id}`,
            name: 'header',
            value: s.header ?? '',
            placeholder: 'Authorization',
          }),
          'The header its key goes in, such as X-API-Key. Left empty, it is sent as a bearer token.',
        ),
        keyBox(`mcp-key-${s.id}`, 'Its key', press('mcp-key', 'Save', false)),
      )
      : h(Card.Sub, null, "Its key can't be saved here yet.")
  }
  return s.connection
    ? [
      h(
        'form',
        { method: 'post', action, class: 'Page_Form' },
        held('connection', s.connection),
        h(Form.Actions, null, press('signin', `Sign in to ${s.name}`, false)),
      ),
      on ? mcpClient(s, action, redirect) : null,
    ]
    : null
}

// A box for the OAuth client a server signs in as, for a server that takes
// only clients it knows: one made in its developer portal.
let mcpClient = (
  s: McpPage['servers'][number],
  action: string,
  redirect?: string,
) =>
  h(
    More,
    null,
    h(More.Summary, null, 'Sign in with your own OAuth client'),
    h(
      More.Body,
      null,
      h(
        'form',
        { method: 'post', action, class: 'Page_Form' },
        held('server', s.id),
        labeled(
          `mcp-client-${s.id}`,
          'Client id',
          h(Field, {
            id: `mcp-client-${s.id}`,
            placeholder: 'Paste the ID from your provider',
            name: 'client_id',
            required: true,
          }),
        ),
        labeled(
          `mcp-client-secret-${s.id}`,
          'Client secret',
          h(Field, {
            id: `mcp-client-secret-${s.id}`,
            placeholder: 'Paste the secret from your provider',
            name: 'client_secret',
            type: 'password',
            autocomplete: 'off',
          }),
          `Its redirect URI is ${redirect}. The secret is kept in the vault and never shown again.`,
        ),
        h(Form.Actions, null, press('mcp-client', 'Save', false)),
      ),
    ),
  )

// The MCP servers a person connected in this space (@yaks/connections/mcp):
// each as a card saying how it stands, with its key, which of its tools are
// offered, the apps it is granted to, turning it off and removing it; then a
// form adding one, and those in the trash. Its forms post to `action`.
let mcpServers = (m: McpPage, on: boolean, action: string) => {
  let form = (id: string, kids: Kids, at: Record<string, unknown> = {}) =>
    h(
      'form',
      { method: 'post', action, class: 'Page_Form', ...at },
      held('server', id),
      kids,
    )
  let opened = (id: string) =>
    `${action}${action.includes('?') ? '&' : '?'}mcp=${
      encodeURIComponent(id)
    }#mcp-${id}`
  let tools = (id: string) => {
    let t = m.tools?.server == id ? m.tools : undefined
    if (!t) {
      return h(Button, { href: opened(id), mod: 'quiet' }, 'Choose its tools')
    }
    if (t.failed) {
      return h(Notice, null, `Its tools could not be listed: ${t.failed}`)
    }
    return form(id, [
      h(Card.Sub, null, 'The tools your agents and apps may use:'),
      t.list!.map((tool) =>
        h(
          Check,
          null,
          h(Check.Input, {
            type: 'checkbox',
            name: 'tool',
            value: tool.name,
            checked: tool.allowed,
          }),
          tool.title,
          tool.description ? h(Check.Note, null, ` ${tool.description}`) : null,
        )
      ),
      h(Form.Actions, null, press('mcp-tools', 'Save tools', false)),
    ])
  }
  let card = (s: McpPage['servers'][number]) => {
    let [word, tone] = s.enabled ? MCP_STATE[s.status] : ['Off', undefined]
    return h(
      Card,
      { id: `mcp-${s.id}` },
      heading(s.name, {
        mark: logo(s),
        status: status(word, tone),
        actions: form(s.id, [
          press(
            s.enabled ? 'mcp-off' : 'mcp-on',
            s.enabled ? 'Turn off' : 'Turn on',
          ),
          press('mcp-remove', 'Remove'),
        ], { class: 'Card_Form' }),
      }),
      h(Card.Sub, null, s.machine ? `${s.url} on your machine` : s.url),
      s.machine ? null : h(
        Card.Sub,
        null,
        s.everyone
          ? "This space's Operator uses it with everyone it works with, through your sign-in or key. "
          : "This space's Operator uses it only with you. ",
        form(
          s.id,
          press(
            s.everyone ? 'mcp-mine' : 'mcp-everyone',
            s.everyone ? 'Keep it to me' : 'Share with everyone',
          ),
          { class: 'Card_Form' },
        ),
      ),
      s.header
        ? h(Card.Sub, null, `Its key goes in the ${s.header} header.`)
        : null,
      mcpCredential(s, on, action, m.redirect),
      s.enabled ? tools(s.id) : null,
      h(
        More,
        null,
        h(More.Summary, null, 'Rename'),
        h(
          More.Body,
          null,
          form(
            s.id,
            h(
              Form.Line,
              null,
              h(Field, {
                name: 'name',
                value: s.name,
                required: true,
                'aria-label': 'Name',
                placeholder: 'e.g. Calendar tools',
              }),
              press('mcp-name', 'Rename', false),
            ),
          ),
        ),
      ),
      s.apps.map((a) =>
        h(
          Card.Sub,
          null,
          `Used by ${a.title} `,
          granting(action, a, `mcp:${s.id}`, 'source-revoke', 'Stop'),
        )
      ),
    )
  }
  let live = m.servers.filter((s) => !s.trashed)
  let trashed = m.servers.filter((s) => s.trashed)
  return [
    h(Group, { id: 'mcp' }, 'MCP servers'),
    live.length ? h(Cards, null, live.map(card)) : h(
      Card.Sub,
      null,
      "An MCP server you add here offers its tools to this space's Operator, with you alone or with everyone it works with, and to the apps you allow.",
    ),
    h(
      More,
      null,
      h(More.Summary, null, 'Add an MCP server'),
      h(
        More.Body,
        null,
        h(
          Form,
          { class: 'Page_Form', method: 'post', action },
          held('do', 'mcp-add'),
          labeled(
            'mcp-url',
            'Address',
            h(Field, {
              id: 'mcp-url',
              name: 'url',
              inputmode: 'url',
              autocomplete: 'off',
              spellcheck: 'false',
              required: true,
              placeholder: 'https://example.com/mcp',
            }),
            'Adding it finds out whether it takes a sign-in, a key or nothing, and names it.',
          ),
          labeled(
            'mcp-for-everyone',
            "Who this space's Operator uses it with",
            [
              [
                'everyone',
                'Everyone it works with, through your sign-in or key',
              ],
              ['me', 'Only me'],
            ].map(([value, label]) =>
              h(
                Check,
                null,
                h(Check.Input, {
                  type: 'radio',
                  name: 'for',
                  id: `mcp-for-${value}`,
                  value,
                }),
                label,
              )
            ),
            'Left unchosen: only you for a server you sign in to, everyone for one that takes a key or nothing.',
          ),
          h(
            More,
            null,
            h(More.Summary, null, 'Advanced'),
            h(
              More.Body,
              null,
              labeled(
                'mcp-name',
                'Name',
                h(Field, {
                  id: 'mcp-name',
                  name: 'name',
                  placeholder: 'e.g. Calendar tools',
                }),
                'Left empty, it is called what it calls itself, or by its host.',
              ),
              labeled(
                'mcp-client',
                'OAuth client id',
                h(Field, {
                  id: 'mcp-client',
                  name: 'client_id',
                  placeholder: 'Paste the ID from your provider',
                }),
                `For a server you sign in to that registers no client for yaks.app: one made in its developer portal, with the redirect URI ${m.redirect}.`,
              ),
              on
                ? labeled(
                  'mcp-client-secret',
                  'OAuth client secret',
                  h(Field, {
                    id: 'mcp-client-secret',
                    placeholder: 'Paste the secret from your provider',
                    name: 'client_secret',
                    type: 'password',
                    autocomplete: 'off',
                  }),
                  'Kept in the vault and never shown again.',
                )
                : null,
              on
                ? labeled(
                  'mcp-key',
                  'Key',
                  h(Field, {
                    id: 'mcp-key',
                    placeholder: 'Paste the server’s access key',
                    name: 'key',
                    type: 'password',
                    autocomplete: 'off',
                  }),
                  'For a server that takes a key. Left empty, it is asked for if the server wants one.',
                )
                : null,
              labeled(
                'mcp-header',
                'Header',
                h(Field, {
                  id: 'mcp-header',
                  name: 'header',
                  placeholder: 'Authorization',
                }),
                'The header its key goes in, such as X-API-Key. Left empty, a key is sent as a bearer token.',
              ),
              h(
                Check,
                null,
                h(Check.Input, {
                  type: 'checkbox',
                  name: 'machine',
                  id: 'mcp-machine',
                  value: 'here',
                }),
                "On this space's machine, through its tunnel: the address is then its path there, such as /mcp. It is for you alone and takes no key.",
              ),
            ),
          ),
          h(
            Form.Actions,
            null,
            h(Button, { type: 'submit', mod: 'go' }, 'Add'),
          ),
        ),
      ),
    ),
    trashed.length
      ? h(
        More,
        null,
        h(More.Summary, null, 'MCP servers in the trash'),
        h(
          More.Body,
          null,
          trashed.map((s) =>
            h(
              Card,
              null,
              h(Card.Head, null, logo(s), h(Card.Title, null, s.name)),
              h(Card.Sub, null, s.url),
              form(
                s.id,
                h(Form.Actions, null, press('mcp-restore', 'Restore', false)),
              ),
            )
          ),
        ),
      )
      : null,
  ]
}

/** Whether `c` holds what `opened` names, or was read for it: a dialog the
 * page draws without asking the server again. */
export let holds = (c: Connections, opened: string): boolean =>
  c.open == opened ||
  c.list.some((one) => one.eid == opened || one.integration == opened) ||
  c.borrowed.some((b) => b.eid == opened) ||
  !!c.mcp?.servers.some((s) => `mcp:${s.id}` == opened) ||
  [c.asked, ...c.built].some((i) => i?.name == opened)

/** The Connections page of `view`'s space, drawn from `c`, its one dialog
 * showing what `opened` names: a connection by its eid or its service's name,
 * a loan, an MCP server (`mcp:<id>`), or a service to connect; by default
 * what the row was read for (`c.open`, or the service it was asked to add).
 * One the row does not hold yet is drawn loading, unless the row was read for
 * it, which says it is not here. */
export let connectionsView = (
  view: ConnectionsView,
  c: Connections,
  opened: string | null = c.open ?? c.asked?.name ?? null,
) => {
  let { env } = view
  let at = { space: view.space.slug, spaces: view.spaces }
  let host = spaceHost(env, at.space)
  let context = new URL(
    enabling(managePath('connections', at.space), c.enable),
    'https://page.invalid',
  )
  if (c.catalog?.q) context.searchParams.set('q', c.catalog.q)
  if (c.trash) context.searchParams.set('trash', '1')
  let action = `${context.pathname}${context.search}`
  // The service the page was opened to add: a key to paste, or a sign-in to
  // start, and which space it goes to.
  let close = h(Button, {
    href: `${action}#`,
    mod: 'quiet',
    'data-modal-close': '',
    'data-tip': 'Close',
    'aria-label': 'Close connection details',
    autofocus: true,
  }, h(Icon, { of: X }))
  let offer = (i: Offered) =>
    h(Modal.Body, null, [
      heading(`Connect ${i.face.title}`, {
        mark: logo(i.face, env),
        actions: close,
      }),
      detail(i.face, i.keyed),
      to('It will be connected to', addTo(i.name)),
      i.available === false
        ? [
          h(
            Notice,
            null,
            'This service is in the catalog, but connecting through this provider is not available yet.',
          ),
          h(Button, { type: 'button', disabled: true }, 'Connect'),
        ]
        : h(
          Form,
          { class: 'Page_Form', method: 'post', action },
          held('integration', i.name),
          howTo(i.face, true),
          i.keyed
            ? keyBox(
              `add-${i.name}`,
              'Paste the key',
              press('add', 'Connect', false),
              '',
              i.face.fields,
            )
            : h(Form.Actions, null, signingIn(i.face, 'Connect', 'add')),
        ),
    ])
  let add = h(
    Card,
    { as: 'form', method: 'post', action },
    h(
      Card.Sub,
      null,
      "For a service your apps call that isn't listed. Services others have added are in the ",
      h('a', { href: url(env, DIRECTORY) }, 'integration directory'),
      '.',
    ),
    fieldsOf(
      labeled(
        'new-name',
        'Service',
        h(Field, {
          id: 'new-name',
          name: 'integration',
          maxlength: 60,
          placeholder: 'Weather API',
          required: true,
        }),
      ),
      labeled(
        'new-hosts',
        'Where it may be sent',
        h(Field, {
          id: 'new-hosts',
          name: 'hosts',
          autocomplete: 'off',
          spellcheck: 'false',
          placeholder: 'api.example.com',
          required: true,
        }),
        'yaks.app keeps the key and only ever sends it to these addresses.',
      ),
      labeled(
        'new-key',
        'Key',
        h(Field, {
          id: 'new-key',
          placeholder: 'Paste the service’s access key',
          name: 'key',
          type: 'password',
          autocomplete: 'off',
          spellcheck: 'false',
          required: true,
        }),
      ),
      labeled(
        'new-instructions',
        optional('How to get the key'),
        h(Field, {
          lines: true,
          id: 'new-instructions',
          name: 'instructions',
          placeholder:
            'Where to sign up, which page gives the key, and what to paste',
        }),
      ),
      h(Form.Actions, null, press('add', 'Connect', false)),
    ),
  )
  // What the space holds already that could replace a loan: a connected
  // connection through the same service.
  let mine = (b: Borrowed) =>
    c.list.find((one) =>
      !one.own && one.integration == b.integration &&
      one.status == 'connected' && !one.failed && !one.each
    )
  // What agents asked for and nobody connected: an app's ask, never the
  // space's side of an ask each person answers with their own. A service the
  // space began connecting and did not finish, which no app asks for, is
  // nobody's ask, and its card in All services connects it.
  let started = (one: Shown) => one.status == 'needed' && !one.own && !one.each
  let asks = c.list.filter((one) => started(one) && one.apps.length)
  let rest = c.list.filter((one) => !started(one))
  // The one the page was opened on, drawn whole: a connection, a loan, a
  // server, or a service to add.
  let open = opened
    ? c.list.find((one) => one.eid == opened || one.integration == opened)
    : undefined
  let loan = opened ? c.borrowed.find((b) => b.eid == opened) : undefined
  let keyOf = (one: Shown) =>
    c.list.filter((c) => c.integration == one.integration).length > 1
      ? one.eid
      : one.integration
  let manage = (key: string) => openedOn(action, key)
  let shown = (one: Shown) =>
    card(
      env,
      one.face,
      one.each && !one.own
        ? `Each person connects their own, from ${
          one.apps.map((a) => a.title).join(', ') || 'the app'
        }.`
        : one.lacking.length && reconnects(one)
        ? FULLER
        : one.apps.length
        ? `For ${one.apps.map((a) => a.title).join(', ')}`
        : one.face.tagline,
      manage(keyOf(one)),
      one.status == 'needed' ? null : status(
        one.failed ? 'Not saved' : STATUS[one.status],
        one.status == 'connected' && !one.failed ? 'positive' : 'negative',
      ),
      c.on && reconnects(one)
        ? h(
          'form',
          { method: 'post', action, class: 'Card_Form' },
          held('connection', one.eid),
          reconnect(one),
        )
        : null,
    )
  let grid = (cards: Kids[], props: Record<string, string> | null = null) =>
    cards.length ? h(Cards, props, cards) : null
  let finds = { 'data-found': '' }
  let group = (title: Kids, ...kids: Kids[]) =>
    kids.some(Boolean) ? [h(Group, null, title), kids] : null
  let yours = [
    ...rest.filter((one) => one.own).map(shown),
    ...c.services.map((s) =>
      card(
        env,
        { name: s.name, title: s.name, logo: '', image: '' } as Face,
        [
          'Signed in with your yaks.app account ',
          h(Time, { at: new Date(s.connectedAt * 1000).toISOString() }),
          '.',
        ],
        undefined,
        status('Connected', 'positive'),
      )
    ),
  ]
  let here = [
    ...rest.filter((one) => !one.own).map(shown),
    ...c.borrowed.map((b) =>
      card(
        env,
        b.face,
        `${b.app.title} borrows ${b.lender}’s`,
        manage(b.eid),
        status('Borrowed', 'positive'),
      )
    ),
  ]
  // The catalog: a search box over every service, what it found or the
  // featured ones, and the kinds to look through.
  let cat = c.catalog
  let tile = (i: Offered) =>
    card(
      env,
      i.face,
      i.face.tagline,
      openedOn(action, i.name),
    )
  let finding = cat
    ? h(
      Form,
      {
        class: 'Page_Form',
        method: 'get',
        action: managePath('connections', at.space),
        role: 'search',
        'data-find': '',
      },
      c.enable?.length ? held('enable', c.enable.join(',')) : null,
      h(
        Form.Line,
        null,
        h(Field, {
          type: 'search',
          name: 'q',
          value: cat.q,
          placeholder: `Search ${count(cat.total)} services`,
          'aria-label': 'Search services',
          autocomplete: 'off',
        }),
        h(Button, { type: 'submit' }, 'Search'),
      ),
    )
    : null
  let browse = (k: { name: string; label: string }) =>
    h(Chip, {
      as: 'a',
      href: `${managePath('connections', at.space)}?q=${
        encodeURIComponent(k.name)
      }#find`,
    }, k.label)
  let found = cat?.q
    ? [
      h(
        Card.Sub,
        null,
        cat.matched
          ? cat.matched > cat.found.length
            ? `The first ${cat.found.length} of ${
              count(cat.matched)
            } services matching “${cat.q}”.`
            : `${
              cat.matched == 1
                ? 'One service matches'
                : `${cat.matched} services match`
            } “${cat.q}”.`
          : `No service matches “${cat.q}”. Add a key for it below.`,
      ),
      grid(cat.found.map(tile), finds),
    ]
    : cat
    ? [
      grid(cat.featured.map(tile), finds),
      cat.kinds.length
        ? h(Chips, null, cat.kinds.slice(0, 16).map(browse))
        : null,
    ]
    : grid(c.built.map(tile), finds)
  // The selected service says which space it goes to, in the space switcher
  // that offers the others.
  let current = at.spaces?.find((s) => s.slug == at.space)
  let owned = (at.spaces ?? []).filter((s) => s.owner)
  let to = (what: string, other?: (slug: string) => string) => [
    h(Card.Sub, null, `${what} ${host}, for its apps to use.`),
    other && current && owned.length > 1
      ? h(
        'div',
        { class: 'Connect_Space' },
        choice(
          current,
          owned,
          (s) => other(s.slug),
          null,
          undefined,
          'Which space should it be connected to?',
        ),
      )
      : null,
  ]
  let addTo = (name: string) => (slug: string) =>
    openedOn(managePath('connections', slug), name)
  let contents = (one: Shown) =>
    connection(
      one,
      c.on,
      action,
      close,
      one.own ? null : to(
        one.status == 'needed' ? 'It will be connected to' : 'Connected for',
      ),
      env,
    )
  // An MCP server is opened by its integration's name, `mcp:<id>`, the address
  // an agent sends a person to sign in at (@yaks/connections `authorization`).
  let serving = (s: McpPage['servers'][number]) =>
    h(Modal.Body, null, [
      heading(s.name, { mark: logo(s), actions: close }),
      h(Card.Sub, null, s.url),
      mcpCredential(s, c.on, action) ??
        h('p', null, `${s.name} needs no sign-in.`),
    ])
  let server = opened && !open && !loan
    ? c.mcp?.servers.find((s) => `mcp:${s.id}` == opened)
    : undefined
  let offers = [c.asked, ...c.built].filter((i): i is Offered => !!i)
  let offered = opened ? offers.find((i) => i.name == opened) : undefined
  let note = (said: string) =>
    h(Modal.Body, null, [
      heading('Connection details', { actions: close }),
      h('p', { role: 'status' }, said),
    ])
  // What the dialog shows, by the key it is opened on; one the page does not
  // hold is said as not here, or loading while the page asks for it.
  let showing = offered?.name ?? (open && keyOf(open)) ?? loan?.eid ??
    (server && `mcp:${server.id}`) ?? opened
  let bodies: [string, VNode][] = [
    ...offers.map((i): [string, VNode] => [i.name, offer(i)]),
    ...c.list.map((one): [string, VNode] => [keyOf(one), contents(one)]),
    ...c.borrowed.map((b): [string, VNode] => [
      b.eid,
      borrowing(b, env, c.on, action, close, mine(b)),
    ]),
    ...(c.mcp?.servers ?? []).map((s): [string, VNode] => [
      `mcp:${s.id}`,
      serving(s),
    ]),
  ]
  if (showing && !bodies.some(([k]) => k == showing)) {
    bodies.push([
      showing,
      note(
        showing == c.open
          ? 'This connection is not on this page: it was removed, or it belongs to another space.'
          : 'Loading connection…',
      ),
    ])
  }
  // Every body is kept in the page, showing only while opened, so what is
  // typed into one stays when it closes and its drafts are bound at once.
  let modal = h(
    Modal,
    {
      open: !!showing,
      'aria-modal': true,
      id: 'connect',
      'data-modal-key': showing,
      'aria-label': offered
        ? `Connect ${offered.face.title}`
        : 'Manage connection',
    },
    h(Modal.Backdrop, {
      href: `${action}#`,
      'data-modal-close': '',
      tabIndex: -1,
      'aria-label': 'Close connection details',
    }),
    bodies.map(([k, body]) =>
      cloneElement(body, {
        key: k,
        'data-modal-key': k,
        hidden: k != showing,
      })
    ),
    showing ? told() : null,
  )
  let setup = showing
  return [
    h('div', {
      class: 'Desk_Connections',
      inert: setup ? true : undefined,
      'data-connections': '',
    }, [
      told(),
      c.mcp?.ask ? sourceAsk(c.mcp.ask, action, env) : null,
      c.mcp?.friends?.length ? friendsAccess(c.mcp.friends, action) : null,
      c.on ? null : h(
        Card,
        null,
        heading("Keys can't be saved here yet"),
        h(
          Card.Sub,
          null,
          'This server has nowhere safe to keep a key, so connecting is switched off.',
        ),
      ),
      c.trash
        ? h(
          More,
          { open: true },
          h(More.Summary, null, 'Saved credentials in the trash'),
          h(
            More.Body,
            null,
            c.trash.length
              ? c.trash.map((one) =>
                h(
                  Card,
                  { as: 'form', method: 'post', action },
                  h(Card.Title, null, one.integration),
                  h(
                    Card.Sub,
                    null,
                    'Saved ',
                    h(Time, { at: new Date(one.at).toISOString() }),
                    '. Kept privately until restored or permanently erased.',
                  ),
                  held('retained', one.id),
                  h(
                    Form.Actions,
                    null,
                    press('restore-credential', 'Restore credential', false),
                    h(Button, {
                      href:
                        `/space/${at.space}/confirm/credentialerase/${one.id}`,
                      mod: 'quiet',
                    }, 'Erase saved credential…'),
                  ),
                )
              )
              : h(Card.Sub, null, 'No saved credentials in the trash.'),
          ),
        )
        : c.on
        ? h(Button, {
          href: `${action}${action.includes('?') ? '&' : '?'}trash=1`,
          mod: 'quiet',
        }, 'Saved credentials in the trash')
        : null,
      group('Requested by agents', grid(asks.map(shown))),
      group('Yours', grid(yours)),
      c.mcp ? mcpServers(c.mcp, c.on, action) : null,
      group(yours.length ? `Connected for ${host}` : 'Connected', grid(here)),
      asks.length || rest.length || c.services.length || c.borrowed.length
        ? null
        : empty(
          'No connections yet',
          h(
            'p',
            null,
            'Connect a service below, or ask an agent to build an app that uses one: what it asks for shows up here.',
          ),
        ),
      h(Group, { id: 'find' }, 'All services'),
      finding,
      found,
      c.on
        ? h(
          More,
          null,
          h(More.Summary, null, 'Add a key for a service not listed'),
          h(More.Body, null, add),
        )
        : null,
    ]),
    modal,
  ]
}
