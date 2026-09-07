// The prompts this door offers (T-32981): the protocol's USER-invoked door,
// where a tool is the model's. A client shows these as things a person picks
// by name — a slash command, a menu — and what comes back is one message in
// THEIR voice, which is why each `say` below is written as the person talking
// rather than as an instruction to the model. The agent already carries the
// door's instructions (guide.ts INSTRUCTIONS); a prompt's job is to start the
// work at the right place and carry the one or two judgements the agent
// otherwise skips.
//
// Few of them on purpose: a prompt that duplicates what the agent would do
// unprompted is noise on a menu a person reads. Each is a sentence somebody
// would otherwise have to compose, and each has the tools behind it already —
// make (app_new/app_files/app_deploy), fix (app_errors), share
// (app_set/member_add), publish (app_publish), and app-ideas, the one that
// asks for nothing to be built yet.
//
// Shape: MCP 2025-06-18 §Server/Prompts — `prompts/list` answers `{prompts}`
// (no cursor; the list is short and whole), `prompts/get` answers
// `{description, messages}` with one text message, and a bad name or a
// missing required argument is -32602. The door declares
// `prompts: {listChanged: true}` beside tools, so an app that deploys prompts
// of its own (T-32983) can move this list and say so on the stream.

export type Arg = {
  name: string
  description: string
  required?: boolean
}

/** An app the person already has, as a message names it. */
export type Made = { title: string; url: string }

export type Prompt = {
  name: string
  title: string
  description: string
  arguments: Arg[]
  // The person's own message, out of what they filled in — and out of what
  // they already have, for a message that is about that: the apps in reach
  // (mcp.ts `extend`), or null when nobody has signed in (preauth.ts).
  say: (a: Record<string, string>, made: Made[] | null) => string
}

// What the person named, or the phrase that stands in when they named
// nothing — a prompt picked bare still has to read as a sentence.
let or = (a: Record<string, string>, name: string, fallback: string) =>
  (a[name] ?? '').trim() || fallback

// Where the person stands, as the ideas message says it: the apps they have
// by name and address, so an idea lands on something of theirs; the line for
// somebody whose first app this would be; and, signed out, where signing in
// is — an idea costs no account, and an app does.
let having = (made: Made[] | null) =>
  !made
    ? `I have not signed in there yet. Signing in at https://yaks.app/login —
an email address and a six-digit code — is what turns one of these into an
app, so tell me the ideas first and say that at the end.`
    : made.length
    ? `The apps I already have:

${made.map((m) => `- ${m.title} — ${m.url}`).join('\n')}

Where an idea belongs in one of those, say so rather than making it a second
app.`
    : `I have not made anything there yet, so one of these would be my first.`

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
// is named here as well as listed below. Nothing in it is built, so nothing in
// it needs an account — and the message says where the account is for the
// moment one of the ideas is wanted.
export let IDEAS: Prompt = {
  name: 'app-ideas',
  title: 'Ideas for what to make',
  description:
    'A handful of apps worth making on yaks.app for this particular person ' +
    '— out of what they have said and what they have already made — each a ' +
    'line or two, with an offer to build one.',
  arguments: [],
  say: (_a, made) =>
    `Any yaks.app ideas you think I'd like, based on our chat history?

What gets made there: an app is an index.html and whatever files sit beside
it, served live at an address of my own — it opens on my phone, it keeps what
it saves in a store of its own rather than in one browser, and it is a link I
can send to somebody. It can be mine alone, readable by anyone with the link,
or open for anyone to add to, and I can invite people into it by email
address. It can carry commands of its own for you to call, keep what I have
told it about how I want things done, and take money through Stripe. Read the
guide before you decide what is possible — the guide tool, or
https://yaks.app/guide.md.

${having(made)}

Give me five or so, each a line or two: what it is, and why me. Tie every one
to something I have actually said or done rather than to apps in general.
Then offer to build whichever I pick.`,
}

export let PROMPTS: Prompt[] = [
  {
    name: 'make',
    title: 'Make something new',
    description:
      'Build what the person asks for as an app on yaks.app — its own ' +
      'address, its own store — and hand them the link.',
    arguments: [{
      name: 'what',
      description:
        'What they want: "somewhere to keep recipes", "a chore board for ' +
        'the house", "a page where my friends vote on a date".',
      required: true,
    }],
    say: (a) =>
      `Make me something on yaks.app: ${a.what}

Build it as an app there — its own address, its own store — and give me the
link once it works. Keep whatever it saves in the app's own store, so it is
the same on my phone. If other people are meant to use it, or it needs to be
more than one page, ask me before you deploy.`,
  },
  {
    name: 'fix',
    title: 'Fix what is broken',
    description:
      "Find what has broken in the person's apps — the breaks nobody has " +
      'looked at yet — fix it, and deploy the fix.',
    arguments: [{
      name: 'app',
      description:
        'The app to look at, by its slug. Leave it out for everything they ' +
        'have.',
    }],
    say: (a) =>
      `Something is broken in ${
        or(a, 'app', 'my apps')
      } on yaks.app. Find out what
— start with app_errors, and read the breaks nobody has looked at yet — then
fix it and deploy the fix. Tell me what was wrong in one line, and say so
plainly if the fix is something only I can do.`,
  },
  {
    name: 'share',
    title: 'Share an app with someone',
    description:
      'Let a particular person into an app: settle its access, invite them ' +
      'by email address, and hand back the link to send.',
    arguments: [
      {
        name: 'app',
        description: 'The app to share, by its slug.',
      },
      {
        name: 'who',
        description: "The person's email address.",
      },
    ],
    say: (a) =>
      `I want to share ${or(a, 'app', 'one of my apps')} on yaks.app with ${
        or(a, 'who', 'someone')
      }.

Work out what its access should be first — whether they have to sign in,
and whether anyone else with the link could write — and tell me what you
picked. Then invite them and give me the link to send.`,
  },
  {
    name: 'publish',
    title: 'Publish an app for anyone here',
    description:
      'Offer an app to every other space on the platform under a shared ' +
      'name, so somebody can install a copy of their own.',
    arguments: [
      {
        name: 'app',
        description: 'The app to publish, by its slug.',
      },
      {
        name: 'about',
        description: 'The line someone browsing reads, if they have one.',
      },
    ],
    say: (a) =>
      `Publish ${or(a, 'app', 'one of my apps')} on yaks.app so anyone here can
install their own copy.${
        a.about ? `\n\nThe line to offer it under: ${a.about}` : ''
      }

Before you do: tell me what a copy carries and what it does not, and check
the version that is serving now is the one I want other people taking. Then
pick the name it installs under and publish it.`,
  },
  IDEAS,
]

export let promptOf = (name: unknown) =>
  PROMPTS.find((p) => p.name == name) ?? null

// The arguments a prompt was asked for without: the spec's -32602 case, said
// as a sentence rather than a code.
export let missing = (p: Prompt, args: Record<string, unknown>) =>
  p.arguments
    .filter((a) => a.required && !String(args[a.name] ?? '').trim())
    .map((a) => a.name)
