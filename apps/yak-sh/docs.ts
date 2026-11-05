// yak.sh for an agent: `llms.txt` (the llmstxt.org convention), the page as
// Markdown (`index.md`), and `setup.md`, the steps that set yak and yaks.app
// up. Each is drawn from the sections the page draws (site.ts) when it is
// asked for (worker.ts), so an agent reads what the page says, and what the
// guides on yaks.app and the READMEs in the repository say is linked, not
// copied.
import { ANCHORS, SECTIONS } from './site.ts'

type Section = (typeof SECTIONS)[number]

/** A page an agent reads: its content type and its text. */
export type Doc = { type: string; text: string }

// The blocks only the page acts on: what a beat shows, its letters and the
// session it starts. The commands and calls around them stay.
const STAGED = /\n*```(declared|outbox|reply|session)\n[\s\S]*?\n```/g

/** A section's body as Markdown: a part's rule between its heading's words
 * and what it holds is dropped, and so are the page's own blocks. */
let body = (s: Section) =>
  s.body.replace('\n\n---\n\n', '\n\n').replace(STAGED, '').trim()

let section = (s: Section, depth = 2) =>
  `${'#'.repeat(depth)} ${s.title}\n\n${body(s)}`

/** The part linked from the page as `#anchor`. */
let part = (anchor: string) => SECTIONS.find((s) => ANCHORS[s.eid] == anchor)!

/** A part's heading, then what it says beside it. */
let said = (anchor: string) =>
  `${part(anchor).title}. ${body(part(anchor)).split('\n\n')[0]}`

let [hero, ...rest] = SECTIONS

/** A link as llms.txt lists one: a name, where, and a line on what is there. */
let link = ([url, name, line]: string[]) => `- [${name}](${url}): ${line}`

let more = (base: string) =>
  [
    [
      `${base}index.md`,
      'yak.sh as Markdown',
      'the home page: tasks, edges, queries, rules, effects and memories, each with the commands it runs',
    ],
    [
      'https://yaks.app/agent.md',
      'Connect your AI agent to yaks.app',
      'the steps for Claude, ChatGPT, Claude Code, Codex, Cursor and other assistants',
    ],
    [
      'https://yaks.app/llms.txt',
      'yaks.app for agents',
      'the guide to everything a yaks app can do, a page per subject',
    ],
    [
      'https://github.com/yak-sh/yak/blob/main/packages/cli/README.md',
      'The yak command',
      'configs, plugins, `yak serve`, `--host` and signing in',
    ],
    [
      'https://github.com/yak-sh/yak/blob/main/packages/README.md',
      'The @yaks packages',
      'what each package is for, with a README each',
    ],
  ].map(link)

let llms = (base: string) =>
  [
    '# yak.sh',
    '',
    `> ${hero.body}`,
    '',
    said('yak'),
    '',
    said('yaks-app'),
    '',
    '## Set up',
    '',
    link([
      `${base}setup.md`,
      'Set up yak and yaks.app',
      'install yak, start a graph, sign in to yaks.app, connect Claude or ChatGPT and put a first app online, with a command for each step',
    ]),
    '',
    '## Read more',
    '',
    ...more(base),
    '',
    '## Optional',
    '',
    link([
      'https://github.com/yak-sh/yak',
      'Source',
      'the repository, Apache-2.0',
    ]),
    link(['https://jsr.io/@yaks', 'Packages on JSR', 'every @yaks package']),
    '',
  ].join('\n')

let setup = (base: string) =>
  [
    '# Set up yak and yaks.app',
    `> ${hero.body}`,
    'This page is for an agent setting up yak and yaks.app, for itself or for the person it works for. Run each command as written, in order; `yak serve` keeps running, so start it in the background. Two steps need the person: signing in to yaks.app opens a page in their browser, and adding a connector to Claude or ChatGPT on the web is done in their settings. For those, tell them the one thing to open, click or paste.',
    "yak runs on [Deno](https://deno.com). If `deno --version` fails, install Deno first, then put it on this shell's PATH, where the installer below puts `yak` too:",
    '```sh\ncurl -fsSL https://deno.land/install.sh | sh -s -- -y\nexport PATH="$HOME/.deno/bin:$PATH"\n```',
    section(part('yak')),
    section(part('yaks-app')),
    section(part('install')),
    '## Read more',
    more(base).join('\n'),
    '',
  ].join('\n\n')

let page = () =>
  [section(hero, 1), ...rest.map((s) => section(s)), ''].join('\n\n')

/** Every page an agent reads, by its file name, with `base` the address the
 * site is served under. */
export let pages = (base: string): Record<string, Doc> => ({
  'llms.txt': { type: 'text/plain', text: llms(base) },
  'setup.md': { type: 'text/markdown', text: setup(base) },
  'index.md': { type: 'text/markdown', text: page() },
})
