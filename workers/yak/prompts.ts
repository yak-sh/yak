// The prompts this door offers (T-32981): the protocol's USER-invoked door,
// where a tool is the model's. A client shows these as things a person picks
// by name — a slash command, a menu — and what comes back is one message in
// THEIR voice, which is why each `say` below is written as the person talking
// rather than as an instruction to the model. The agent already carries the
// door's instructions (guide.ts INSTRUCTIONS); a prompt's job is to start the
// work at the right place and carry the one or two judgements the agent
// otherwise skips.
//
// Four of them, and few on purpose: a prompt that duplicates what the agent
// would do unprompted is noise on a menu a person reads. Each is a sentence
// somebody would otherwise have to compose, and each has the tools behind it
// already — make (app_new/app_files/app_deploy), fix (app_errors), share
// (app_set/member_add), publish (app_publish).
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

export type Prompt = {
  name: string
  title: string
  description: string
  arguments: Arg[]
  // The person's own message, out of what they filled in.
  say: (a: Record<string, string>) => string
}

// What the person named, or the phrase that stands in when they named
// nothing — a prompt picked bare still has to read as a sentence.
let or = (a: Record<string, string>, name: string, fallback: string) =>
  (a[name] ?? '').trim() || fallback

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
]

export let promptOf = (name: unknown) =>
  PROMPTS.find((p) => p.name == name) ?? null

// The arguments a prompt was asked for without: the spec's -32602 case, said
// as a sentence rather than a code.
export let missing = (p: Prompt, args: Record<string, unknown>) =>
  p.arguments
    .filter((a) => a.required && !String(args[a.name] ?? '').trim())
    .map((a) => a.name)
