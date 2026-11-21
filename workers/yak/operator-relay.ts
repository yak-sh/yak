// A person's own words to their Operator, written on their machine as theirs
// (D-153799, item 4). What they say in a conversation is often about
// something on their machine: a task, a decision. The Operator's model
// chooses which of their messages and which entity; the host reads that
// message's words and its writer from the conversation itself and sends them
// on, so no model retypes them and none says who wrote them.
//
// It goes through the machine's own MCP server, the one the person connected
// through their space's tunnel (connected-mcp.ts), by that server's
// `comment_new`: the same call the Operator makes for its own words, except
// that the platform names the person as the one whose act it is (tunnel.ts
// `Calling.own`). The machine then writes it by its own person and through no
// session (@yaks/tunnel `arrived`), which is how everything there tells a
// person's comment from an agent's.
//
// A decision the Operator asked them itself, kept in its own store, is
// answered there the same way: their message, read from the conversation,
// is the answer, theirs, and the source the answer cites (`decisionRelay`).
import { line, sub } from '@yaks/query'
import {
  type Bundle,
  type Comp,
  mint,
  Stale,
  type Tool as GraphTool,
} from '@yaks/graph'
import { asked, waiting } from '@yaks/task'
import { nameOf } from '@yaks/mcp-client'
import { kindOf, textOf, type Tool } from '@yaks/session'
import type { Calling } from '@yaks/tunnel/hosted'
import { runConnectedCommand } from './connected-mcp.ts'
import type { Listed } from './operator-lists.ts'
import { spoken } from './operator-draw.ts'
import type { OperatorStore } from './operator-store.ts'
import { type Ctx, refuse } from './tool.ts'

let comp = (b: Bundle | undefined, name: string) =>
  b?.[name] as
    | Comp
    | undefined

type Store = OperatorStore

/**
 * The words of a conversation's line as `person` gave them, or undefined for
 * a line that is not their own: the Operator's, a helper's, the platform's,
 * and words another writer is named for (an outside agent's, a letter's, a
 * caller's on the phone, which the platform does not take for the person's).
 * They come as the conversation draws them (operator-draw.ts `spoken`):
 * without the framing the model reads before them and the notes put after.
 *
 * ```ts
 * import { equal } from '@yaks/testing'
 * import { ownWords } from './operator-relay.ts'
 * let line = (b: object) => ({
 *   entity: { eid: 'e' }, entry: { session: 's' }, created: { by: 'ada' },
 *   content: { body: 'Ship it.' }, ...b,
 * })
 * equal(ownWords(line({}), 'ada'), 'Ship it.')
 * equal(ownWords(line({
 *   content: { body: 'By text: Ship it.' },
 *   channel: { name: 'text', framing: 'By text: ' },
 * }), 'ada'), 'Ship it.')
 * equal(ownWords(line({}), 'bob'), undefined)
 * equal(ownWords(line({ system: {} }), 'ada'), undefined)
 * equal(ownWords(line({ output: { source: 'a' } }), 'ada'), undefined)
 * equal(ownWords(line({ entry: { session: 's', from: 'an outside agent' } }), 'ada'), undefined)
 * equal(ownWords(line({ operator_call: { call: 'c', asked: true } }), 'ada'), undefined)
 * ```
 */
export let ownWords = (
  line: Bundle | undefined,
  person: string,
): string | undefined =>
  line && person && comp(line, 'created')?.by == person &&
    kindOf(line) == 'input' &&
    !['system', 'notice', 'operator_call'].some((c) => c in line) &&
    !comp(line, 'entry')?.from
    ? spoken(line, textOf(line)).trim() || undefined
    : undefined

// How far back the newest of their messages is looked for.
let RECENT = 64

// The line of `conversation` the model named: by its id, by the time its
// header says it was sent, or, naming none, the newest one that is the
// person's own.
let lineOf = async (
  work: Store,
  conversation: string,
  person: string,
  said: string,
): Promise<Bundle | undefined> => {
  if (!said) {
    return (await work.g.read(
      line`.entry.session=${conversation}&.order=-entry.seq&.limit=${RECENT}&*`,
    )).find((b: Bundle) => ownWords(b, person))
  }
  let found = Number.isNaN(Date.parse(said)) || !said.includes('T')
    ? await work.g.get([(await work.g.address([said])).get(said) ?? said])
    : await work.g.read(
      line`.entry.session=${conversation}&.created.at=${said}&*`,
    )
  return found.find((b: Bundle) => comp(b, 'entry')?.session == conversation)
}

// The first words of what was recorded, for the model to tell which message
// it sent on.
let opening = (words: string) =>
  words.length > 80 ? words.slice(0, 80) + '…' : words

// The machine tools a relay is made of, by the names the Task Graph's server
// lists them under.
let COMMENT = 'comment_new', ANSWER = 'decision_answer', SHOW = 'graph_show'

/**
 * A person's own answer to a decision on their machine: the choice they
 * pressed beside it on `space`'s Operator page (operator-lists.ts), sent on
 * through `at`, their server there, as their own act, the way a message of
 * theirs is.
 */
export let answerAsTheirs = async (
  ctx: Ctx,
  space: string,
  at: string,
  decision: string,
  choice: string,
) => {
  let out = await runConnectedCommand(ctx, at, ANSWER, { decision, choice }, {
    caller: 'operator',
    space,
    own: true,
  })
  if (out.value?.isError) throw refuse('mcp_tool', out.text)
}

/**
 * One tool for each of the person's machines whose server takes comments
 * (`remote`, connected-mcp.ts `connectedTools`): one of their own messages in
 * this conversation becomes their comment on an entity there, and for a
 * decision their answer. `conversation` names the conversation a session
 * works for, and `asking` is what each request to the machine says of it.
 */
export let relayTools = (
  ctx: Ctx,
  work: Store,
  remote: GraphTool[],
  conversation: (session: string) => Promise<string>,
  asking: Calling,
): Tool[] => {
  let offered = (server: unknown) =>
    new Set(
      remote.filter((t) => t.meta?.server == server)
        .map((t) => String(t.meta?.remoteName)),
    )
  return remote
    .filter((t) => t.meta?.machine && t.meta.remoteName == COMMENT)
    .map((t): Tool => {
      let at = String(t.meta!.server)
      let has = offered(at)
      let decides = has.has(ANSWER) && has.has(SHOW)
      let own = (name: string, args: Record<string, unknown>) =>
        runConnectedCommand(ctx, at, name, args, { ...asking, own: true })
      // Whatever the machine refused is the call's refusal, in its words.
      let done = (out: Awaited<ReturnType<typeof own>>) => {
        if (out.value?.isError) throw refuse('mcp_tool', out.text)
        return out
      }
      // The label of the listed choice the model named, read from the
      // decision on the machine: a choice that is not listed would be the
      // model's words recorded as the person's answer.
      let listed = async (decision: string, said: string) => {
        let shown = done(
          await runConnectedCommand(ctx, at, SHOW, { ids: [decision] }, asking),
        ).value?.structuredContent as { result?: Bundle[] } | undefined
        let choices = comp(shown?.result?.[0], 'decision')?.choices as
          | { label: string }[]
          | undefined
        if (!choices) throw refuse('arguments', `${decision} is no decision`)
        let label = choices.map((c) => c.label)
          .find((l) => l.trim().toLowerCase() == said.toLowerCase())
        if (!label) {
          throw refuse(
            'arguments',
            `${decision} lists no choice "${said}". Its choices are: ${
              choices.map((c) => JSON.stringify(c.label)).join(', ')
            }. For an answer in their own words, leave choice out and send answered: true.`,
          )
        }
        return label
      }
      let namespace = String(t.meta!.namespace)
      return {
        name: nameOf(namespace, 'message_relay'),
        title: 'Record their words',
        step: {
          doing: 'Recording their words…',
          done: 'Recorded their words',
        },
        description:
          `Record one of the person's own messages in this conversation as their comment on an entity on their machine, word for word and as written by them. Use it whenever what they said is about a task, a decision or anything else there: an instruction, an answer, a correction. You choose only which message and which entity, and supply no words: ${
            nameOf(namespace, COMMENT)
          } is for words of your own.` +
          (decides
            ? ' When their message answers a decision, it is answered as them and closes: name the listed choice it picks, or send answered: true when it answers in their own words, none of the choices, and those words are the answer.'
            : ''),
        parameters: {
          type: 'object',
          properties: {
            entity: {
              type: 'string',
              description:
                'The entity on their machine the message concerns, by its id (T-123).',
            },
            entry: {
              type: 'string',
              description:
                "Which of their messages: its id, or its Sent time exactly as the message's header shows it. Omit for the newest message they sent.",
            },
            ...decides
              ? {
                choice: {
                  type: 'string',
                  description:
                    'For a decision: the label of the listed choice their message picks. Omit when they answered in their own words.',
                },
                answered: {
                  type: 'boolean',
                  description:
                    'For a decision their message answers in their own words, none of its choices: true, and their words are the answer.',
                },
              }
              : {},
          },
          required: ['entity'],
        },
        run: async (args, context) => {
          let entity = String(args.entity ?? '').trim()
          if (!entity) {
            throw refuse('arguments', 'name the entity their message concerns')
          }
          let said = String(args.entry ?? '').trim()
          let line = await lineOf(
            work,
            await conversation(context!.session),
            ctx.person,
            said,
          )
          let words = ownWords(line, ctx.person)
          if (!words) {
            throw refuse(
              'arguments',
              said
                ? `${said} is not a message the person wrote in this conversation. Only their own words are recorded as theirs.`
                : 'The person has written no message in this conversation lately; name one by its id or its Sent time.',
            )
          }
          let choice = String(args.choice ?? '').trim()
          let answered = !decides
            ? undefined
            : choice
            ? await listed(entity, choice)
            : args.answered === true
            ? words
            : undefined
          // The answer first: it closes the decision, so the comment beside
          // it reaches whoever waits on it and starts nobody on a closed task.
          if (answered) {
            done(await own(ANSWER, { decision: entity, choice: answered }))
          }
          let out = done(await own(COMMENT, { target: entity, body: words }))
          let made = (out.value?.structuredContent as
            | { result?: Bundle[] }
            | undefined)?.result?.find((b) => b.comment)?.entity
          return {
            text: `Recorded as their own comment on ${entity}${
              made ? ` (${made.eid})` : ''
            }${
              answered
                ? `, and answered it as them: "${opening(answered)}"`
                : ''
            }. Their words: "${opening(words)}"`,
            with: {
              output: {
                source: context!.call.entity.eid,
                value: {
                  entry: line!.entity.eid,
                  entity,
                  ...made ? { comment: made.eid } : {},
                  ...answered ? { choice: answered } : {},
                },
              },
            },
          }
        },
      }
    })
}

/**
 * The decisions waiting on the person, as a note beside their words: each
 * one their Operator asked them (operator.ts `ASKING`), and each one the
 * lists their machine offers hold (operator-lists.ts), so a message of theirs
 * that answers one is read as its answer (`decisionRelay`, or the machine's
 * `message_relay`). None where nothing waits.
 */
export let waitingOn = async (
  work: Store,
  person: string,
  lists: Listed[] = [],
) => {
  let rows = await work.g.read(line`${sub(waiting(person))}&*`)
  let there = [
    ...new Map(
      lists.flatMap((l) => l.asks).filter((a) => a.choices.length)
        .map((a) => [a.eid, a]),
    ).values(),
  ]
  return [
    rows.length
      ? `The decisions waiting on the person, which their words may answer (record it with decision_relay):\n${
        asked(rows, await work.known(rows.map((b) => b.entity.eid)))
      }`
      : '',
    there.length
      ? `The decisions waiting on the person on their machine, which their words may answer (record it with that machine's message_relay, naming the choice their message picks, or with answered: true when it answers in their own words):\n${
        there.map((a) =>
          `- ${a.eid}: ${a.ask || a.title} ${
            a.choices.map((c) => JSON.stringify(c.label)).join(', ')
          }`
        ).join('\n')
      }`
      : '',
  ].filter(Boolean).join('\n\n')
}

// Why a decision `decision_relay` was named is not the person's to answer,
// and what is: a decision waiting on someone else is answered by their words
// in their own conversation, and the ones waiting on this person are listed.
let notTheirs = async (ctx: Ctx, work: Store, assignee: unknown) => {
  let who = typeof assignee == 'string'
    ? (await ctx.dir.persons([assignee])).get(assignee)?.name || 'someone else'
    : undefined
  let rows = await work.g.read(line`${sub(waiting(ctx.person!))}&*`)
  return (who
    ? `waits on ${who}, not on the person you are talking with: only ${who}'s own words answer it, in their conversation with you. `
    : 'is not a decision. ') +
    (rows.length
      ? `The decisions waiting on the person you are talking with:\n${
        asked(rows, await work.known(rows.map((b) => b.entity.eid)))
      }`
      : 'No decision waits on the person you are talking with.')
}

/**
 * The tool that answers one of the person's open decisions with one of their
 * own messages in this conversation: the answer is theirs, the choice their
 * message picks or else their words, and it cites that message as its
 * source. `conversation` names the conversation a session works for.
 */
export let decisionRelay = (
  ctx: Ctx,
  work: Store,
  conversation: (session: string) => Promise<string>,
): Tool => ({
  name: 'decision_relay',
  title: 'Record their answer',
  step: { doing: 'Recording their answer…', done: 'Recorded their answer' },
  description:
    'Answer one of the person\'s open decisions with one of their own messages in this conversation, as theirs: use it whenever what they said to you answers a decision waiting on them ("go with the gothic one"), so it closes and leaves their Updates. You choose only which decision, which message and which listed choice it picks, and supply no words. Only their own words answer: never a decision they did not answer, and never your guess at what they want.',
  parameters: {
    type: 'object',
    properties: {
      decision: {
        type: 'string',
        description: 'The decision their message answers, by its id (T-12).',
      },
      entry: {
        type: 'string',
        description:
          "Which of their messages: its id, or its Sent time exactly as the message's header shows it. Omit for the newest message they sent.",
      },
      choice: {
        type: 'string',
        description:
          'The label of the listed choice their message picks. Omit when they answered in their own words: those words are then the answer.',
      },
    },
    required: ['decision'],
  },
  run: async (args, context) => {
    let named = String(args.decision ?? '').trim()
    if (!named) throw refuse('arguments', 'name the decision they answered')
    let eid = (await work.g.address([named])).get(named) ?? named
    let [row] = await work.g.get([eid])
    let decision = comp(row, 'decision')
    let assignee = comp(row, 'filed')?.assignee
    if (!decision || assignee != ctx.person) {
      throw refuse(
        'arguments',
        `${named} ${await notTheirs(ctx, work, decision && assignee)}`,
      )
    }
    let closed = (row: Bundle | undefined) => {
      let decided = comp(row, 'decided')
      if (decided) {
        let { choice, at } = decided
        return {
          text: `${named} was already answered with ${
            JSON.stringify(choice)
          } at ${at}.`,
          with: {
            output: {
              source: context!.call.entity.eid,
              value: { decision: eid, choice, at },
            },
          },
        }
      }
      if (row?.cancelled) {
        throw refuse('arguments', `${named} was cancelled`)
      }
    }
    let previous = closed(row)
    if (previous) return previous
    let said = String(args.entry ?? '').trim()
    let line = await lineOf(
      work,
      await conversation(context!.session),
      ctx.person,
      said,
    )
    let words = ownWords(line, ctx.person)
    if (!words) {
      throw refuse(
        'arguments',
        said
          ? `${said} is not a message the person wrote in this conversation. Only their own words answer a decision.`
          : 'The person has written no message in this conversation lately; name one by its id or its Sent time.',
      )
    }
    let choices = (decision.choices ?? []) as { label: string }[]
    let picked = String(args.choice ?? '').trim()
    let label = picked
      ? choices.map((c) => c.label)
        .find((l) => l.trim().toLowerCase() == picked.toLowerCase())
      : words
    if (!label) {
      throw refuse(
        'arguments',
        `${named} lists no choice "${picked}". Its choices are: ${
          choices.map((c) => JSON.stringify(c.label)).join(', ')
        }. For an answer in their own words, leave choice out.`,
      )
    }
    let actor = { by: ctx.person, via: context!.session }
    try {
      await work.g.apply([
        {
          entity: { eid },
          decided: { choice: label },
          $was: { decided: { '': null }, cancelled: { '': null } },
          $actor: actor,
        },
        {
          entity: { eid: mint() },
          edge: { from: eid, to: line!.entity.eid },
          cites: {},
          $actor: actor,
        },
      ])
    } catch (e) {
      if (e instanceof Stale && e.eid == eid) {
        let [current] = await work.g.get([eid])
        let previous = closed(current)
        if (previous) return previous
      }
      throw e
    }
    return {
      text: `Answered ${named} as them: "${opening(label)}"`,
      with: {
        output: {
          source: context!.call.entity.eid,
          value: { decision: eid, entry: line!.entity.eid, choice: label },
        },
      },
    }
  },
})
