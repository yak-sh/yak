/**
 * How a person connects their AI agent to yaks.app, said for each app it
 * might be (Claude, ChatGPT, Claude Code, Cursor, Grok, anything else that
 * speaks MCP), as the Agents page shows it (./agents-view.ts): each app's
 * steps on a tab of its own, with what to copy and where, and the first app
 * to ask for once it is done.
 *
 * @module
 */
import { type ComponentChildren as Kids, h } from 'preact'
import { Card } from '@yaks/ui/Card'
import { More } from '@yaks/ui/More'
import { TabSet } from '@yaks/ui/Tabs'
import { apex, type Host, url } from './host.ts'
import { PITCH, PLATFORM, REPO as PUBLIC } from './names.ts'
import { copyable, firstAsk } from './page-parts.ts'
import { OAUTH } from './routes.ts'

/** The connector's face, as each form that adds it asks: its name and its
 * line (yaks.app's seo.ts `connector`). */
export let CONNECTOR = {
  title: PLATFORM,
  description: PITCH,
}

// Connector forms do not ask the same questions. Keep each answer beside the
// provider step that asks for it, so a person never has to work out whether a
// field belongs to the form they are looking at: its label, and what is
// typed, to copy (named to a screen reader as `what`) or as it is.
let field = (label: string, value: Kids, what?: string) =>
  h(
    'div',
    { class: 'Fields_Row' },
    h('dt', { class: 'Fields_Label' }, label),
    what == null
      ? value
      : h('dd', { class: 'Fields_Value' }, copyable(value, what)),
  )

let fields = (...rows: Kids[]) => h('dl', { class: 'Fields' }, rows)

let b = (words: string) => h('b', null, words)

let code = (words: string) => h('code', null, words)

// An address on this platform, written out for somebody to type or paste.
let at = (path: string, env: Host) => code(url(env, path))

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
// Every value is the authorization server's own — @yaks/platform/routes `OAUTH` is what
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
// is a third route to the same server, not a different product, named as
// the marketplace field reads it: `owner/name`.
let REPO = new URL(PUBLIC).pathname.slice(1)

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
      ', and then you click ',
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
    // connects with read and fetch only; Free and Personal go unnamed; and MCP
    // apps are web only.
    intro: 'On ChatGPT Business, Enterprise or Edu, you can add yaks.app ' +
      'and build with it once an admin turns it on. On Pro it connects but ' +
      'can only read, so it can’t build. Free and Personal can’t add it this ' +
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
        ', click the ',
        b('+'),
        ' button, then ',
        b('Add custom MCP server'),
        '.',
      ],
      ['Add the name and description:', chatgptFields(env)],
      ['Under ', b('Connection'), ', paste the URL you copied.'],
      [
        'Read the warning, click ',
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
        copyable(
          `claude mcp add --transport http yaks ${url(env, '/mcp')}`,
          'the command',
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
        ' and click ',
        b('New MCP Server'),
        '. It opens ',
        code('~/.cursor/mcp.json'),
        '.',
      ],
      [
        'Add the server, with the URL as its one field: ',
        copyable(
          `{ "mcpServers": { "yaks": { "url": "${url(env, '/mcp')}" } } }`,
          'the server',
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
