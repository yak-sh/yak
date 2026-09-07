// The prompts this door offers (T-32981): the protocol's USER-invoked door,
// where a tool is the model's. A client shows these as things a person picks
// by name — a slash command, a menu — and what comes back is one message in
// THEIR voice, which is why each body is written as the person talking rather
// than as an instruction to the model. The agent already carries the door's
// instructions (guide.ts INSTRUCTIONS); a prompt's job is to start the work at
// the right place and carry the one or two judgements the agent otherwise
// skips.
//
// Few of them on purpose: a prompt that duplicates what the agent would do
// unprompted is noise on a menu a person reads. Each is a sentence somebody
// would otherwise have to compose, and each has the tools behind it already —
// make (app_new/app_files/app_deploy), fix (app_errors), share
// (app_set/member_add), publish (app_publish), and app-ideas, the one that
// asks for nothing to be built yet.
//
// EACH IS A FILE (T-34606, M-34605): `prompts/<name>.md`, whose frontmatter is
// the bundle saying the row — name, title, description, arguments — and whose
// body is the message, with `{{slot}}` holes. This module is what fills them:
// the order they are listed in, the phrase that stands in for an argument the
// person left out (the file's own `or`), and the two BLOCKS below that are a
// choice among sentences rather than a sentence.
//
// Shape: MCP 2025-06-18 §Server/Prompts — `prompts/list` answers `{prompts}`
// (no cursor; the list is short and whole), `prompts/get` answers
// `{description, messages}` with one text message, and a bad name or a
// missing required argument is -32602. The door declares
// `prompts: {listChanged: true}` beside tools, so an app that deploys prompts
// of its own (T-32983) can move this list and say so on the stream.
import { fill } from '@yaks/yaml'
import { SAYS } from './content.ts'
import { type Host, url } from './host.ts'

/** An argument as a client is offered it (MCP §Prompts). */
export type Arg = {
  name: string
  description: string
  required?: boolean
}

/** An argument as its FILE says it: the same row, plus the phrase that stands
 * in when the person named nothing — a prompt picked bare still has to read as
 * a sentence. That phrase is a word, so it lives beside the argument it stands
 * for and never reaches the wire. */
export type Held = Arg & { or?: string }

/** An app the person already has, as a message names it. */
export type Made = { title: string; url: string }

/** A prompt as its file says it: the row in the frontmatter, and the message
 * under it with its holes still in it. */
export type Said = {
  name: string
  title: string
  description: string
  arguments: Held[]
  body: string
}

export type Prompt = {
  name: string
  title: string
  description: string
  arguments: Arg[]
  // The person's own message, out of what they filled in — and out of what
  // they already have, for a message that is about that: the apps in reach
  // (mcp.ts `extend`), or null when nobody has signed in (preauth.ts).
  say: (a: Record<string, string>, made: Made[] | null, env?: Host) => string
}

// What the person filled in, and the file's own stand-in for what they left
// out. A hole with neither is left standing rather than emptied: the only
// argument without an `or` is a required one, which the door refuses before
// any of this (`missing` below).
let filled = (p: Said, a: Record<string, string>) => {
  let out: Record<string, string> = {}
  for (let arg of p.arguments) {
    let said = (a[arg.name] ?? '').trim()
    if (said) out[arg.name] = said
    else if (arg.or != null) out[arg.name] = arg.or
  }
  return out
}

// Where the person stands, as the ideas message says it: the apps they have
// by name and address, so an idea lands on something of theirs; the line for
// somebody whose first app this would be; and, signed out, where signing in
// is — an idea costs no account, and an app does.
let having = (made: Made[] | null, env: Host = {}) =>
  !made
    ? `I have not signed in there yet. Signing in at ${url(env, '/login')} —
an email address and a six-digit code — is what turns one of these into an
app, so tell me the ideas first and say that at the end.`
    : made.length
    ? `The apps I already have:

${made.map((m) => `- ${m.title} — ${m.url}`).join('\n')}

Where an idea belongs in one of those, say so rather than making it a second
app.`
    : `I have not made anything there yet, so one of these would be my first.`

// The holes a file cannot fill for itself, because each is a CHOICE among
// sentences rather than a sentence: a line an app is offered under only
// appears when there is one, and where the person stands is three different
// paragraphs with their own apps listed in the middle of one of them.
let BLOCKS: Record<
  string,
  (
    a: Record<string, string>,
    made: Made[] | null,
    env: Host,
  ) => Record<string, string>
> = {
  publish: (a) => ({
    about: a.about?.trim() ? `\n\nThe line to offer it under: ${a.about}` : '',
  }),
  'app-ideas': (_a, made, env) => ({ having: having(made, env) }),
}

// The menu, in the order a person reads it. The list is code and the words are
// files: which prompts there are is a decision, and a file dropped into the
// directory is not one.
let ORDER = ['make', 'fix', 'share', 'publish', 'app-ideas']

let prompt = (name: string): Prompt => {
  let said = SAYS[name]
  if (!said) throw new Error(`prompts/${name}.md says nothing`)
  return {
    name: said.name,
    title: said.title,
    description: said.description,
    // The file's own stand-in phrases stay in the file: a client is offered
    // the argument, not what we would say for it.
    arguments: said.arguments.map(({ or: _or, ...arg }) => arg),
    say: (a, made, env = {}) =>
      fill(said.body, {
        ...filled(said, a),
        ...BLOCKS[name]?.(a, made, env),
      }),
  }
}

export let PROMPTS: Prompt[] = ORDER.map(prompt)

// The ideas door (T-34557). Owner, 2026-09-06: "This prompt to my agent was
// awesome: 'Any yaks.app ideas you think I'd like based on our chat history?'
// Can we offer that as a /app-ideas command or similar? With guidance, etc too
// as context."
//
// The question is the whole of what a person says; the guidance is what an
// agent proposes badly without — what an app here IS, so the ideas are things
// this place can actually hold, and what this person already made, so they
// land on their own address rather than in the abstract. The guide is pointed
// at rather than copied: it moves, and this does not.
//
// It is also the one prompt a stranger may pick (preauth.ts), which is why it
// is named here as well as listed above. Nothing in it is built, so nothing in
// it needs an account — and the message says where the account is for the
// moment one of the ideas is wanted.
export let IDEAS: Prompt = prompt('app-ideas')

export let promptOf = (name: unknown) =>
  PROMPTS.find((p) => p.name == name) ?? null

// The arguments a prompt was asked for without: the spec's -32602 case, said
// as a sentence rather than a code.
export let missing = (p: Prompt, args: Record<string, unknown>) =>
  p.arguments
    .filter((a) => a.required && !String(args[a.name] ?? '').trim())
    .map((a) => a.name)
