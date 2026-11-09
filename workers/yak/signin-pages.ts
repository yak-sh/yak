// The identity door's pages (identity.ts): asking for an address and its
// code, an invitation's one click, connecting an agent, linking and handing
// off a sign-in, allowing an agent in and closing a space. Apart from pages.ts,
// so a page that only serves a space never compiles the sign-in's phone
// numbers or the connector's words (T-148886).
import {
  Button,
  Card,
  Cards,
  Copy,
  Field,
  Form,
  Group,
  More,
  TabSet,
} from '@yaks/ui/parts'
import { h } from 'preact'
import type { Agent } from './connected.ts'
import type { Face, Shown } from './connections.ts'
import { agentList, agentLive } from './connected_ui.ts'
import { tile } from './render/mod.ts'
import { shown } from '@yaks/phone'
import { CODE_NOTE, texted } from './signin.ts'
import { MANAGE, managePath, OAUTH } from './route.ts'
import { CONNECTOR } from './seo.ts'
import { AGENT } from './docs.ts'
import { apex, type Host, spaceHost, url } from './host.ts'

import {
  about,
  at,
  b,
  billing,
  code,
  copyable,
  copying,
  field,
  fields,
  firstAsk,
  heading,
  held,
  home,
  howTo,
  keyBox,
  type Kids,
  logo,
  mine,
  type Offer,
  page,
  plan,
  run,
  said,
  send,
  state,
  status,
  tabbing,
  type Yours,
} from './pages.ts'

// The path of an address, whole or bare; nothing, for one that is neither.
let pathOf = (href: string) => {
  try {
    return new URL(href, 'https://x').pathname
  } catch {
    return ''
  }
}

// What each card carries forward: the authorize request's own query string,
// so the code form lands back where it started, and the page the person was
// on before they were asked to sign in, so the code hands them back to it
// (T-32593). Whether that address is one to follow is the login door's to
// decide, never this page's.
let carried = (q: string | null, back?: string | null) => [
  held('q', q),
  held('return', back),
  back &&
    ['/connect', '/manage/connect', managePath('agents')].includes(
      pathOf(back),
    )
    ? run(
      'if (location.hash) document.currentScript.previousElementSibling.value += location.hash',
    )
    : null,
]

// The sign-in card's first line. When `back` is a page on a space, it names
// that address: somebody who tapped "sign in" on a friend's app reads where
// they are going, not a pitch for building apps. Only a host under the apex is
// named; any other address is the door's to judge, and the card says nothing.
let welcome = (back: string | null, env: Host) => {
  let to = back && URL.canParse(back) ? new URL(back) : null
  return to?.hostname.endsWith(`.${apex(env)}`)
    ? `Sign in to continue to ${to.hostname + to.pathname.replace(/\/$/, '')}.`
    : 'Get an Operator that does things for you.'
}

// Ask for an address. `who` names the app asking, when one is (the OAuth
// consent page is this page — signing in is the consent), and `why` is the
// soft refusal, when there was one: a sign-in link that had already been used
// lands here, carrying whatever it was going to finish (identity.ts, T-34351).
//
// `texts` is whether a code can go by text (identity.ts `textable`): then the
// one box takes an email address or a US mobile number (T-136826), and what
// giving a number agrees to sits under it, where it is read before sending.
// The note stands aside once the box holds an address, so a person typing
// their email reads nothing about texts; without script it stays.
export let askEmail = (at: {
  q?: string | null
  back?: string | null
  who?: string
  why?: string
  status?: number
  texts?: boolean
}, env: Host = {}) =>
  page(
    env,
    {
      title: 'Sign in or sign up',
      lead: at.why ?? welcome(at.back ?? null, env),
      status: at.status ?? 200,
    },
    h(
      'form',
      { class: 'Page_Form', method: 'post', action: '/login' },
      carried(at.q ?? null, at.back),
      h(
        'p',
        null,
        at.who ? `${at.who} would like to use your apps. ` : '',
        `Enter your ${
          at.texts ? 'email or mobile number' : 'email'
        } to get a sign-in code.`,
      ),
      at.texts
        ? [
          h(Field, {
            name: 'address',
            type: 'text',
            required: true,
            autofocus: true,
            autocomplete: 'email',
            autocapitalize: 'off',
            spellcheck: 'false',
            placeholder: 'you@example.com or 269-555-0142',
            'aria-label': 'Your email or mobile number',
            'aria-describedby': 'by-text',
          }),
          h(
            'p',
            { class: 'Note', id: 'by-text' },
            `${CODE_NOTE} Terms: `,
            h('a', { href: url(env, '/terms') }, 'yaks.app/terms'),
            ' Privacy: ',
            h('a', { href: url(env, '/privacy') }, 'yaks.app/privacy'),
          ),
          run(
            "{let n=document.currentScript.previousElementSibling,f=n.previousElementSibling,s=()=>n.hidden=f.value.includes('@');f.addEventListener('input',s);s()}",
          ),
        ]
        : h(Field, {
          name: 'address',
          type: 'email',
          required: true,
          autofocus: true,
          autocomplete: 'email',
          placeholder: 'you@example.com',
          'aria-label': 'Your email',
        }),
      send('Send me a code'),
    ),
    home(env),
  )

// Ask for the code just sent, and nothing else (T-34236). Signing up is two
// steps and both are the address: give it, then prove it. What a person is
// called and where their apps live are theirs to set on their own space page,
// once they are standing on it — a question in front of the door is a step
// somebody has to get past to see anything at all. `why` is the soft refusal,
// when there was one. A code that expired while they looked for the letter, or
// one that never came, is answered by a second door to the same address: the
// first step again, without typing it again. A number was texted, and the
// card says so.
//
// `letter` is what became of the letter this card says was sent: why it
// never left, or null (M-16612). The card is answered before its letter goes
// (T-149702), so it is said at the card's end once known, everything above it
// shown and pressable meanwhile (pages.ts `later`): nobody waits on it, and no
// later card has to ask (T-150301).
export let askCode = (at: {
  address: string
  q?: string | null
  back?: string | null
  why?: string
  status?: number
  letter?: Promise<string | null>
}, env: Host = {}) => {
  let { address } = at
  let q = at.q ?? null, back = at.back ?? null
  let text = texted(address)
  let to = text ? shown(address) : address
  let failed = (why: string | null) =>
    why
      ? h(
        'p',
        { role: 'alert' },
        `The ${text ? 'text' : 'letter'} with your code to ${to} ` +
          `never left: ${why.replace(/\.?$/, '.')} We have been told.`,
      )
      : null
  return page(
    env,
    {
      title: text ? 'Check your texts' : 'Check your email',
      lead: at.why ??
        `We ${text ? 'texted' : 'sent'} a six-digit code to ${to}. ` +
          'It lasts ten minutes.',
      status: at.status ?? 200,
      later: at.letter?.then(failed),
    },
    h(
      'form',
      { class: 'Page_Form', method: 'post', action: '/login/code' },
      carried(q, back),
      h(
        'p',
        null,
        q
          ? 'Enter it to finish connecting your assistant.'
          : back
          ? 'Enter it to sign in and continue.'
          : 'Enter it to land on your own space.',
      ),
      held('address', address),
      h(Field, {
        class: 'Code',
        name: 'code',
        inputmode: 'numeric',
        pattern: '[0-9]{6}',
        maxlength: 6,
        required: true,
        autofocus: true,
        autocomplete: 'one-time-code',
        'aria-label': 'Your six-digit code',
      }),
      send('Sign in'),
    ),
    h(
      'form',
      { class: 'Again Page_Form', method: 'post', action: '/login' },
      carried(q, back),
      held('address', address),
      h(Button, { type: 'submit' }, 'Send a new code'),
    ),
    home(env),
  )
}

// Closing a space (T-33166, erase.ts): the page that stands in front of it.
// It names what goes — every app, every domain, everyone who loses their way
// in, and the address — because a person about to lose all of it should read
// the list rather than remember it.
//
// Two acts, and the page says which one this is (T-34431). By default the
// space goes to the trash, and then each line names something that stops
// rather than something destroyed; `forever` is the letter's other link, and
// only then does the page speak of no undo. The lines themselves are the
// caller's (erase.ts `keeping` and `naming`), so the page never has to know
// which act it is drawing except to title it.
//
// Two ways to say yes, and the page shows whichever the visitor arrived with.
// Off the letter, with its ticket in hand, one button: opening the letter and
// following the link is the deliberate act, and the ticket is what carries it
// (it expires, and the act it opens can only happen once). Straight off the
// web, with no ticket, they type the name back — the guard that makes this
// hard to do by accident when nothing was mailed at all.
//
// The form POSTs to its own address and needs no script, like every other
// card here. Whoever may not delete this space never sees this page: the door
// answers them exactly what it answers for a space that does not exist.
export let askDelete = (at: {
  slug: string
  lines: string[]
  token?: string | null
  // Whether this link erases the space instead of trashing it (erase.ts
  // `Ticket`). Only a ticket the platform signed can say so.
  forever?: boolean
  // Why this cannot happen at all — a space that is still paying, or one
  // already in the trash (erase.ts `refused`, identity.ts `closing`). The page
  // then names the reason and offers no form.
  stop?: string
  why?: string
  status?: number
}, env: Host = {}) => {
  let host = spaceHost(env, at.slug)
  return page(
    env,
    {
      title: `Delete ${host}?`,
      lead: at.stop ?? at.why ??
        (at.forever
          ? 'This cannot be undone, and nothing is kept.'
          : 'It goes to the trash for 30 days. Nothing is erased, and you ' +
            'can bring it back any time before then.'),
      status: at.status ?? 200,
    },
    at.lines.length
      ? h(
        Card,
        null,
        heading(
          at.forever
            ? 'What goes, for good'
            : 'What stops until you restore it',
        ),
        h(
          'ol',
          { class: 'Card_List' },
          at.lines.map((l) => h('li', { class: 'Card_Item' }, l)),
        ),
      )
      : null,
    at.stop ? null : [
      h(
        'form',
        {
          class: 'Page_Form',
          method: 'post',
          action: `/space/${at.slug}/delete`,
        },
        held('t', at.token),
        at.token ? null : [
          h(
            Form.Label,
            { for: 'confirm' },
            'Type ',
            h('b', null, at.slug),
            ' to confirm',
          ),
          h(Field, {
            id: 'confirm',
            name: 'confirm',
            autocomplete: 'off',
            spellcheck: 'false',
            autofocus: true,
          }),
        ],
        send(
          at.forever ? `Delete ${host} forever` : `Put ${host} in the trash`,
        ),
      ),
      h(
        'p',
        { class: 'Note' },
        'Changed your mind? Close this page — nothing has happened.',
      ),
    ],
    home(env),
  )
}

// And after: what went, and the one thing worth knowing next — the address
// belongs to nobody now, theirs to take again or somebody else's to take
// later. A space that went to the trash has the opposite next thing: the
// address is still theirs, and so is everything under it.
export let deleted = (said: string, forever = true, env: Host = {}) =>
  page(
    env,
    { title: "That's done.", lead: said },
    h(
      'p',
      { class: 'Note' },
      forever
        ? 'The address is free again. Ask your assistant for a new space whenever you want one.'
        : 'Nothing was erased. The address is held for you, and restoring it puts everything back exactly as it was.',
    ),
    home(env),
  )

// An invitation opened by somebody who is not signed in as the person it is
// for (invite.ts): who invited them to what, the app drawn as the dashboard
// draws it, the address it went to, and the one button that mails that
// address a code and brings them back to accept it.
export let invited = (o: Offer, env: Host = {}) => {
  let host = spaceHost(env, o.space.slug)
  let what = o.app ? o.app.title || o.app.slug : `${o.space.title} at ${host}`
  return page(
    env,
    {
      title: 'You have an invitation',
      lead: `${o.by || 'Someone'} invited you to ${
        o.see ? 'see' : 'use'
      } ${what}.`,
    },
    o.app
      ? h(
        Cards,
        { class: 'Identity_Cards' },
        tile(o.app, {
          at: `https://${host}`,
          host,
          icon: o.app.open ? undefined : url(env, '/connector-512.png'),
        }),
      )
      : null,
    h(
      'form',
      { class: 'Page_Form', method: 'post', action: '/login' },
      held('address', o.email),
      held('return', o.back),
      h(
        'p',
        null,
        `It was sent to ${o.email}. Sign in with that address to accept it.`,
      ),
      send('Email me a sign-in code'),
    ),
    home(env),
  )
}

// The Connect button an app that asks each person to connect their own
// account is given (connections.ts `own`): which app, which service and how it
// looks, whether this person's is connected, and the one form that connects
// it — a key pasted, or a sign-in at the service. The form posts back to this
// page.
export let askConnect = (at: {
  app: string
  face: Face
  keyed: boolean
  /** whether a key can be kept here at all */
  on: boolean
  status: Shown['status']
  /** the app's own address, to go back to */
  back: string
  say?: string
  no?: boolean
}, env: Host = {}) =>
  page(
    env,
    {
      title: `Connect ${at.face.title}`,
      lead:
        `${at.app} asks each person who uses it to connect their own ${at.face.title} account. Yours is used only when you use the app, and you can disconnect it from your own connections page.`,
    },
    h(
      Card,
      null,
      heading(at.face.title, {
        mark: logo(at.face),
        status: at.status == 'needed'
          ? null
          : at.status == 'broken'
          ? status('Yours needs reconnecting', 'negative')
          : status('Yours is connected', 'positive'),
        actions: at.on && !at.keyed
          ? h(
            'form',
            { class: 'Page_Form', method: 'post' },
            send(at.status == 'needed' ? 'Connect' : 'Connect again'),
          )
          : null,
      }),
      about(at.face),
      howTo(at.face, at.status != 'connected'),
      said(at.say, at.no),
      !at.on ? h(Card.Sub, null, "Keys can't be saved here yet.") : at.keyed
        ? h(
          'form',
          { class: 'Page_Form', method: 'post' },
          keyBox('key', 'Paste your key', send('Save key'), '', at.face.fields),
        )
        : null,
    ),
    h('p', { class: 'Note' }, h('a', { href: at.back }, `Back to ${at.app}`)),
  )

// A one-click link, opened (identity.ts LINK). Opening it spends nothing: a
// messaging app or mail scanner that fetches the address to draw a preview
// would otherwise sign itself in and leave the person a dead link. The button
// carries the pass on, and pressing it is what spends the code.
export let askLink = (t: string, env: Host = {}) =>
  page(
    env,
    {
      title: 'Sign in to yaks.app',
      lead: 'This link signs you in once, for ten minutes.',
      headers: {
        'cache-control': 'private, no-store',
        'referrer-policy': 'no-referrer',
      },
    },
    h(
      'form',
      { class: 'Page_Form', method: 'post', action: '/login/link' },
      held('t', t),
      send('Sign in'),
    ),
    home(env),
  )

// A custom domain asking to sign in: consent names its host and its space.
export let askHandoff = (
  host: string,
  back: string,
  consent: string,
  env: Host = {},
) =>
  page(
    env,
    {
      title: `Sign in to ${host}`,
      lead: 'This signs you in to this space only.',
      headers: {
        'cache-control': 'private, no-store',
        'referrer-policy': 'no-referrer',
      },
    },
    h(
      'form',
      { class: 'Page_Form', method: 'post', action: '/login/handoff' },
      held('return', back),
      held('consent', consent),
      send(`Continue to ${host}`),
    ),
    home(env),
  )

// An app asking, for a browser that is already signed in: one click is the
// whole consent. `consent` is the form's own token (identity.ts `consenting`).
export let askAllow = (
  email: string,
  q: string,
  who: string,
  consent: string,
  env: Host = {},
) =>
  page(
    env,
    {
      title: 'Allow access to your apps on yaks.app',
      lead: `${who} would like to use your apps on yaks.app as ${email}.`,
    },
    h(
      'form',
      { class: 'Page_Form', method: 'post', action: '/oauth/allow' },
      carried(q),
      held('consent', consent),
      send('Allow'),
    ),
    home(env),
  )

export let chatgptFields = (env: Host) =>
  fields(
    field('Name', CONNECTOR.title, 'the name'),
    field('Description', CONNECTOR.description, 'the description'),
    field(
      'Icon',
      h(
        'dd',
        { class: 'Connect_Icon Fields_Value' },
        h(
          'a',
          {
            href: url(env, '/yaks-app.png'),
            download: 'yaks-app.png',
            'aria-label': 'Download the yaks.app icon',
          },
          h('img', {
            class: 'Connect_Image',
            src: url(env, '/yaks-app.png'),
            width: 56,
            height: 56,
            alt: 'The yaks.app icon',
          }),
        ),
        h(
          'a',
          { href: url(env, '/yaks-app.png'), download: 'yaks-app.png' },
          'Download icon',
        ),
      ),
    ),
  )

let external = (href: string, label: string) =>
  h('a', { href, target: '_blank', rel: 'noopener' }, label)

// What to write in an OAuth box, for the forms that have boxes (T-34414).
// Every value is the authorization server's own — route.ts `OAUTH` is what
// identity.ts configures the provider with and what both `/.well-known`
// documents serve — so this page cannot come to teach an address the door
// does not answer.
let oauthHelp = (env: Host) => [
  'For clients that need manual setup: Leave ',
  b('OAuth Client ID'),
  ' and ',
  b('OAuth Client Secret'),
  ' empty. ',
  b('Authorization URL'),
  ' ',
  at(OAUTH.authorize, env),
  ', ',
  b('Token URL'),
  ' ',
  at(OAUTH.token, env),
  ', ',
  b('Registration URL'),
  ' ',
  at(OAUTH.register, env),
  ', ',
  b('Scope'),
  ' ',
  code(OAUTH.scope),
  '.',
]

// This repository is itself a plugin marketplace (T-34666): `.agents/plugins/
// marketplace.json` offers `plugins/yaks.app/`, whose `.mcp.json` names the
// same MCP address every other door on this page hands out. So the shorthand
// is a third route to the same server, not a different product.
let REPO = 'yak-sh/yak'

// Claude's Add custom connector dialog, opened with the name and URL filled in
// (claude.com/docs/connectors/building/directory-vs-custom).
export let claudeAdd = (env: Host) =>
  'https://claude.ai/customize/connectors?modal=add-custom-connector' +
  `&connectorName=${encodeURIComponent(CONNECTOR.title)}` +
  `&connectorUrl=${encodeURIComponent(url(env, '/mcp'))}`

// One client's way to connect: its steps (or, where it has more than one
// interface, its paths of steps), what to know before and after, and the
// chat to open once it is done.
type Client = {
  key: string
  tab: string
  title: string
  intro?: Kids
  paths?: { title: string; steps: Kids[] }[]
  steps?: Kids[]
  note?: Kids
  details?: { summary: string; text: Kids }
  finish: Kids
}

// Keep setup paths and field labels matched to each client's form, including
// differences between its desktop and mobile interfaces.
export let clients = (env: Host): Client[] => [
  {
    key: 'claude',
    tab: 'Claude',
    title: 'Claude',
    paths: [
      {
        title: 'Web + Desktop',
        steps: [
          [
            'Open ',
            external(claudeAdd(env), 'Customize → Connectors → Add'),
            '.',
          ],
          [
            'Check it has these values:',
            fields(
              field('Name', CONNECTOR.title, 'the name'),
              field(
                'Remote MCP server URL',
                url(env, '/mcp'),
                'the connection URL',
              ),
            ),
          ],
          ['Click ', b('Continue'), '.'],
        ],
      },
      {
        title: 'Mobile App',
        steps: [
          [
            'Claude’s help pages only describe adding a connector on ' +
            'claude.ai or the desktop app, so add yaks.app there first, ' +
            'using the ',
            b('Web + Desktop'),
            ' steps.',
          ],
          [
            'Then open the Claude app on your phone. Your connector works ' +
            'there too: in a chat, tap ',
            b('+'),
            ' in the message box, then ',
            b('Connectors'),
            ', and make sure yaks.app is switched on.',
          ],
        ],
      },
    ],
    // Claude's own limits on custom connectors, from its documentation
    // (claude.com/docs/connectors/custom/remote-mcp): the two that stop
    // somebody partway through these steps.
    note: [
      'Claude’s free plan allows one custom connector. On a Team or ' +
      'Enterprise plan, an owner adds it under ',
      b('Organization settings'),
      ' → ',
      b('Connectors'),
      ', and then you press ',
      b('Connect'),
      ' beside it in ',
      b('Customize'),
      ' → ',
      b('Connectors'),
      '.',
    ],
    finish: ['Open ', external('https://claude.ai/new', 'a new Claude chat')],
  },
  {
    key: 'chatgpt',
    tab: 'ChatGPT',
    title: 'ChatGPT — on the web',
    // Who can, before anyone starts: OpenAI's help page on developer mode
    // (help.openai.com/en/articles/12584461) puts full MCP, writes included,
    // in beta for Business, Enterprise and Edu, turned on by an admin; Pro
    // connects with read and fetch only; Free and Plus go unnamed; and MCP
    // apps are web only.
    intro: 'On ChatGPT Business, Enterprise or Edu, you can add yaks.app ' +
      'and build with it once an admin turns it on. On Pro it connects but ' +
      'can only read, so it can’t build. Free and Plus can’t add it this ' +
      'way today, but Claude works on any plan. It works on the web, not in ' +
      'the phone app.',
    steps: [
      [
        'Copy this URL:',
        fields(field('Connection', url(env, '/mcp'), 'the connection URL')),
      ],
      [
        'Open ',
        external('https://chatgpt.com/plugins', 'ChatGPT Plugins'),
        ', tap the ',
        b('+'),
        ' button, then ',
        b('Add custom MCP server'),
        '.',
      ],
      ['Add the name and description:', chatgptFields(env)],
      ['Under ', b('Connection'), ', paste the URL you copied.'],
      [
        'Read the warning, tap ',
        b('I understand and want to continue'),
        ', then ',
        b('Create as a plugin'),
        '.',
      ],
      'Sign in with your email when ChatGPT asks.',
    ],
    // The repository's plugin names production; a staging visitor needs the
    // manual setup above to stay with this deployment.
    details: apex(env) == apex()
      ? {
        summary: 'Connect from the ChatGPT desktop app',
        text: [
          'This way, yaks.app stays up to date without waiting for a review. ' +
          'In the ChatGPT desktop app, choose ',
          b('Add plugin marketplace'),
          ', then copy and paste this:',
          fields(field('Repository', REPO, 'the repository')),
          'You can also add it in your workspace’s plugin settings.',
        ],
      }
      : undefined,
    finish: ['Open ', external('https://chatgpt.com/', 'a new ChatGPT chat')],
  },
  {
    key: 'claude-code',
    tab: 'Claude Code',
    title: 'Claude Code',
    steps: [
      [
        'In your terminal: ',
        h(
          Copy.Text,
          { as: 'code' },
          `claude mcp add --transport http yaks ${url(env, '/mcp')}`,
        ),
      ],
      [
        'Start Claude Code, run ',
        code('/mcp'),
        ', pick ',
        b('yaks'),
        ' and choose ',
        b('Authenticate'),
        '. It opens your browser to sign in.',
      ],
    ],
    note: [
      'Add ',
      code('--scope user'),
      ' to that first line to have it in every project, not just this one.',
    ],
    finish: 'Start a new Claude Code chat',
  },
  {
    key: 'cursor',
    tab: 'Cursor',
    title: 'Cursor',
    steps: [
      [
        'Open ',
        b('Cursor Settings'),
        ' → ',
        b('Tools & Integrations'),
        ' and press ',
        b('New MCP Server'),
        '. It opens ',
        code('~/.cursor/mcp.json'),
        '.',
      ],
      [
        'Add the server, with the URL as its one field: ',
        h(
          Copy.Text,
          { as: 'code' },
          `{ "mcpServers": { "yaks": { "url": "${url(env, '/mcp')}" } } }`,
        ),
      ],
      [
        'Back in ',
        b('Tools & Integrations'),
        ', click ',
        b('yaks'),
        ' and sign in.',
      ],
    ],
    note: [
      'A ',
      code('.cursor/mcp.json'),
      ' in a project folder does the same thing for that project alone.',
    ],
    finish: 'Open a new Agent chat in Cursor',
  },
  {
    key: 'grok',
    tab: 'Grok',
    title: 'Grok',
    steps: [
      [
        'Open ',
        external('https://grok.com/connectors', 'Grok Connectors'),
        ' and choose ',
        b('New Connector'),
        ', then ',
        b('Custom'),
        '.',
      ],
      [
        'Enter this server URL:',
        fields(field('URL', url(env, '/mcp?auth=required'), 'the MCP URL')),
      ],
      'Connect and follow the prompt to sign in to yaks.app.',
    ],
    finish: 'Start a new Grok chat',
  },
  {
    key: 'other',
    tab: 'Other',
    title: 'Anything else that speaks MCP',
    steps: [
      [
        'Add a streamable HTTP connection with this URL:',
        fields(field('URL', url(env, '/mcp'), 'the MCP URL')),
      ],
      [
        'If it asks for a name, use ',
        b('yaks.app'),
        '. Then follow its sign-in prompt.',
      ],
    ],
    details: {
      summary: 'More about authentication',
      text: [
        ...oauthHelp(env),
        ' Sign-in is required when connecting. To use the signed-out tools in ' +
        'a client that supports mixed authentication, use ',
        code(url(env, '/mcp?auth=mixed')),
        '. ',
        code(url(env, '/mcp?auth=required')),
        ' also requires sign-in.',
      ],
    },
    finish: 'Start a new chat in your MCP client',
  },
]

let steps = (items: Kids[]) =>
  h(
    'ol',
    { class: 'Card_List' },
    items.map((s) => h('li', { class: 'Card_Item' }, s)),
  )

// Native radio tabs share their layout with the working style-guide example.
export let doors = (env: Host) =>
  h(
    TabSet,
    null,
    h(TabSet.Legend, null, 'Which app do you use?'),
    clients(env).map((a, i) =>
      h(
        TabSet.Item,
        null,
        h(TabSet.Input, {
          type: 'radio',
          name: 'agent',
          id: `tab-${a.key}`,
          value: a.key,
          checked: !i,
        }),
        h(TabSet.Tab, { for: `tab-${a.key}` }, a.tab),
        h(
          TabSet.Panel,
          { as: Card, mod: a.key },
          h(Card.Title, null, a.title),
          a.intro ? h('p', null, a.intro) : null,
          a.paths
            ? a.paths.map((p) => [
              h('h3', { class: 'Connect_Path' }, p.title),
              steps(p.steps),
            ])
            : steps(a.steps!),
          a.note ? h('p', { class: 'Note' }, a.note) : null,
          a.details
            ? h(
              More,
              null,
              h(More.Summary, null, a.details.summary),
              h(More.Body, { class: 'Note' }, a.details.text),
            )
            : null,
          h(
            'div',
            { class: 'Connect_Next' },
            h('p', { class: 'Connect_Lead' }, 'Make your first app'),
            a.finish,
            ', then ask:',
            firstAsk(),
            h(
              'span',
              { class: 'Note' },
              'Pick one to build, then ask for changes in the same chat. Keep shaping it as you use it.',
            ),
          ),
        ),
      )
    ),
  )

// The one link a person pastes into their own agent, which reads from it how
// to connect itself (docs.ts `AGENT`, public/agent.md).
export let pasteLink = (env: Host) =>
  h(
    Form.Field,
    null,
    h(Form.Label, { as: 'p' }, 'Paste this link into your AI agent'),
    copyable(url(env, AGENT.path), 'the link for your agent'),
    h(
      'span',
      { class: 'Note' },
      'Claude, ChatGPT, Claude Code, Cursor or another agent reads from it how to connect to yaks.app, does what it can itself, and tells you the one step that’s yours.',
    ),
  )

// `back` is where a row's Disconnect returns to: the page it is on.
export let agentSetup = (agents: Agent[], env: Host, back: string) => [
  agentList(agents, 'rows', back),
  h(
    'p',
    state(true, agents),
    'Ask for an app, or keep improving one in the same chat.',
  ),
  h(
    'p',
    state(false, agents),
    'Connect once, then build and keep improving your apps in your usual chats.',
  ),
  h(
    'section',
    { class: 'Connect_Setup' },
    h(Group, state(true, agents), 'Connect another agent'),
    pasteLink(env),
    h('p', null, 'Or connect it yourself, with the steps for your app:'),
    doors(env),
  ),
]

// One listener, no framework: the form answers in place. Constant text, no
// interpolation, and every write to the page is textContent — the page never
// speaks HTML on a person's behalf.
let inline = () =>
  run(`
let f = document.querySelector('.Addr')
if (f) f.addEventListener('submit', async (e) => {
  e.preventDefault()
  let say = f.querySelector('.Notice')
  let go = f.querySelector('button')
  let now = document.querySelector('.Now b')
  go.disabled = true
  say.className = 'Notice'
  say.textContent = 'Saving…'
  try {
    let r = await fetch('/connect', {
      method: 'POST',
      headers: { accept: 'application/json' },
      body: new FormData(f),
    })
    let out = await r.json()
    if (out.address) {
      now.textContent = out.address
      f.querySelector('input').value = out.slug
      say.textContent = 'Saved. Your apps live at ' + out.address + '.'
    } else {
      say.className = 'Notice Notice-negative'
      say.textContent = out.error
    }
  } catch (_) {
    say.className = 'Notice Notice-negative'
    say.textContent = "That didn't go through. Try again?"
  }
  go.disabled = false
})
`)

export let connect = (yours: Yours, status = 200, env: Host = {}) =>
  page(
    env,
    {
      title: 'Connect yaks.app',
      lead: 'Build and manage your apps from your usual chats.',
      status,
    },
    agentSetup(yours.agents ?? [], env, '/connect'),
    h(
      More,
      { class: 'Attach', open: status != 200 || yours.paid },
      h(More.Summary, null, 'Your address and plan'),
      h(More.Body, null, mine(yours, env), plan(yours, env)),
    ),
    h(
      'p',
      { class: 'Note' },
      h('a', { href: url(env, MANAGE) }, 'Your apps and settings'),
    ),
    h(
      'p',
      { class: 'Note' },
      h('a', { href: url(env, '/help') }, 'Need help?'),
    ),
    home(env),
    copying(),
    tabbing(),
    inline(),
    billing(),
    agentLive('/oauth/agents'),
  )
