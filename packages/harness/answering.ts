/** Inbox replies are native work, not operator injections. A person's message,
 * its routing receipt and any new transcript are committed together. Retries
 * find that receipt; model output only publishes a reply and never routes work. */
import {
  type Bundle,
  type Comp,
  derivedEid,
  type Graph,
  identityEid,
  Stale,
  token,
} from '@yaks/graph'
import { type Handlers, holding } from '@yaks/effects'
import { link } from '@yaks/edge'
import { readerAt, type Row, threads } from '@yaks/inbox'
import { promptEntry, type Snapshot } from '@yaks/context'
import {
  kindOf,
  newestAsk,
  seqOf,
  statusOf,
  transcript,
  usingBefore,
} from '@yaks/session'
import type { Host } from '@yaks/cli/host'
import { seed } from './agent.ts'
import { cachedPrefixExpires } from '@yaks/model'

export type InboxOptions = {
  person: string
  model?: string
  provider?: string
  effort?: string
  reuseAt?: number
}
export type AnsweringOptions = InboxOptions & {
  holder: string
  gone?: (holder: string) => Promise<boolean>
  stopping?: AbortSignal
  opening?: () => Promise<{ home?: Comp; files?: Snapshot[] }>
  now?: () => number
}
let comp = (b: Bundle | undefined, name: string): Comp =>
  b?.[name] as Comp ?? {}
let row = (b: Bundle): Row => ({ eid: b.entity.eid, comps: b as Row['comps'] })
let working = (status: string) =>
  ['pending', 'running', 'queued'].includes(status)

/** Authorship is the loop boundary, independent of which outside authors are
 * eligible. Addressing and a person's identity cannot turn system prose into
 * external input. Mail envelopes preserve incoming authors through conversion. */
export let externalWords = async (
  g: Pick<Graph, 'get'>,
  b: Bundle,
  stamp: Comp = comp(b, 'created'),
): Promise<boolean> => {
  if (
    [
      'output',
      'result',
      'notice',
      'prompt',
      'ask',
      'call',
      'inbox_input',
      'mail_notice',
      'signal',
    ].some((name) => b[name])
  ) return false
  let ids = [stamp.by, stamp.via].filter((id): id is string =>
    typeof id == 'string' && !!id
  )
  let writers = ids.length ? await g.get(ids) : []
  if (
    writers.some((writer) =>
      ['session', 'effect', 'builder', 'process', 'call', 'tool'].some((name) =>
        writer[name]
      )
    )
  ) return false
  if (b.mail) {
    let mail = comp(b, 'mail')
    return !!mail.message_id && mail.verified === true && !!mail.from &&
      !b.deliver && !b.delivered
  }
  return typeof stamp.by == 'string' && !!stamp.by
}

/** Unknown retention, counts or window fail closed: there is no fixed age or
 * token ceiling standing in for the provider and model's actual observations. */
export let reusable = async (
  g: Graph,
  session: string,
  share = .25,
  now = Date.now(),
): Promise<boolean> => {
  let entries = await transcript(g, session)
  if (working(statusOf(entries))) return true
  if (statusOf(entries) != 'settled') return false
  let ask = newestAsk(entries)
  if (!ask) return false
  let expiry = cachedPrefixExpires(ask)
  let input = comp(ask, 'usage').input_tokens
  let output = comp(ask, 'usage').output_tokens
  let [model] = await g.get([String(comp(ask, 'ask').to)], ['model'])
  let window = comp(model, 'model').context
  return typeof expiry == 'string' && Date.parse(expiry) > now &&
    typeof input == 'number' && input >= 0 &&
    typeof output == 'number' && output >= 0 &&
    typeof window == 'number' && window > 0 && share > 0 && share <= 1 &&
    input + output < window * share
}

/** Read the same ordered thread as the inbox. Root data remains data, never
 * an instruction snapshot; provenance distinguishes each speaker's words. */
export let threadPrompt = async (
  g: Graph,
  root: string,
  person: string,
  extra: Bundle[] = [],
): Promise<string> => {
  let roots = await g.get([root, person])
  let messages = await g.read(`.comment.target=${root}&*`)
  let all = [...roots, ...messages]
  let thread = threads(all.map(row), readerAt(all.map(row), person), {
    all: true,
  })
    .find((t) => t.eid == root)
  let subject = roots.find((b) => b.entity.eid == root)
  let authors = [
    ...new Set(
      [...all, ...extra].map((b) => String(comp(b, 'created').by ?? '')).filter(
        Boolean,
      ),
    ),
  ]
  let names = new Map(
    (await g.get(authors)).map((
      b,
    ) => [
      b.entity.eid,
      String(comp(b, 'doc').title ?? comp(b, 'session').id ?? b.entity.eid),
    ]),
  )
  let words = (b: Bundle) => {
    let author = String(comp(b, 'created').by ?? '')
    return `From ${names.get(author) ?? author}${
      author == person ? ' (person)' : ''
    }\n` +
      String(comp(b, 'doc').body ?? comp(b, 'content').body ?? '')
  }
  return [
    'Answer the person’s newest words in this thread. Handle what they ask, including work and delegation when needed. Your final reply will be posted here automatically. Do not post a duplicate final comment yourself.',
    'Thread root (current data):\n' + JSON.stringify(subject),
    ...thread?.messages.map((r) => words(r.comps as unknown as Bundle)) ??
      messages.map(words),
    ...extra.map(words),
  ].join('\n\n')
}

/** Functions exposed separately for an isolated probe with a fake model. No
 * model or tool is called by routing; only the native runner spends. */
export let answering = (g: Graph, o: AnsweringOptions) => {
  let route = async (message: string, root: string, extra: Bundle[] = []) => {
    await holding(g, `@yaks/harness/inbox/${root}`, {
      holder: crypto.randomUUID(),
      signal: o.stopping ?? new AbortController().signal,
      wait: true,
    }, async (signal) => {
      if (signal.aborted) return
      if (
        (await g.read(
          `.inbox_input.message=${message}&.inbox_input.root=${root}&.limit=1`,
        )).length
      ) return
      let [subject] = await g.get([root])
      let claim = String(comp(subject, 'claim').session ?? '')
      let session: string | undefined
      if (claim) {
        let [owner] = await g.get([claim])
        if (
          owner?.process ||
          !(await g.read(`.entry.session=${claim}&.using&.limit=1`)).length
        ) return // the claim's outside listener owns this exception
        if (owner?.session && working(statusOf(await transcript(g, claim)))) {
          session = claim
        }
      }
      if (!session) {
        let prior = await g.read(
          `.answers&.edge.to=${root}&?edge&.order=-created.at`,
        )
        for (let edge of prior) {
          let id = String(comp(edge, 'edge').from)
          if (await reusable(g, id, o.reuseAt, (o.now ?? Date.now)())) {
            session = id
            break
          }
        }
      }
      let fresh = !session
      session ??= derivedEid(`inbox session ${root} ${message}`)
      let entry = derivedEid(`inbox input ${root} ${message}`)
      let using = fresh
        ? {
          provider: identityEid('provider', [o.provider ?? 'openai']),
          model: identityEid('model', [o.model ?? 'gpt-6.1-sol']),
          effort: o.effort ?? 'high',
        }
        : usingBefore(await transcript(g, session))
      if (!using?.model) {
        throw new Error('The answering session has no native model')
      }
      let opening = fresh ? await o.opening?.() : undefined
      let body = await threadPrompt(g, root, o.person, extra)
      let files = (opening?.files ?? []).map((f, i) => ({
        ...promptEntry(session!, i + 1, f.body, f.source, 'shared', f.revision),
        entity: { eid: derivedEid(`inbox prompt ${session} ${i}`) },
        $actor: { by: session, via: session },
      }))
      try {
        await g.apply([
          ...fresh
            ? seed({
              provider: o.provider ?? 'openai',
              model: o.model ?? 'gpt-6.1-sol',
            })
            : [],
          ...fresh
            ? [{
              entity: { eid: session },
              session: { id: session.slice(0, 8), operator: false },
              ...opening?.home ? { home: opening.home } : {},
              $actor: { by: session, via: session },
            }, ...files]
            : [],
          {
            ...link(session, 'answers', root),
            $actor: { by: session, via: session },
          },
          {
            entity: { eid: entry },
            entry: { session },
            content: { body },
            using,
            inbox_input: { message, root },
            $was: { inbox_input: { message: token(null), root: token(null) } },
            $actor: { by: o.person, via: session },
          },
        ], { trusted: true })
      } catch (error) {
        if (!(error instanceof Stale)) throw error
      }
    })
  }
  let accept = async (id: string) => {
    let [b] = await g.get([id])
    if (!b) return
    let decided = b.decision && b.decided
    let stamp = comp(b, decided ? 'decided' : 'created')
    if (!await externalWords(g, b, stamp)) return
    // Eligibility is deliberately separate: widening who may write here does
    // not weaken the system-authorship boundary above.
    if (stamp.by != o.person) return
    if (b.comment) {
      await route(id, String(comp(b, 'comment').target))
    } else if (b.conversation) {
      await route(id, id)
    } else if (decided) {
      let dependencies = await g.read(`.requires&.edge.to=${id}&?edge`)
      let answer: Bundle = {
        ...b,
        doc: { body: `Decision answer: ${String(stamp.choice)}` },
        created: stamp,
      }
      for (let dependency of dependencies) {
        await route(id, String(comp(dependency, 'edge').from), [b, answer])
      }
    }
  }
  let publish = async (session: string) => {
    let entries = await transcript(g, session)
    if (statusOf(entries) != 'settled') return
    let ask = newestAsk(entries)
    let boundary = entries.find((b) => b.entity.eid == comp(ask, 'ask').through)
    if (!ask || !boundary) return
    let final = entries.filter((b) =>
      kindOf(b) == 'output' &&
      comp(b, 'output').source == ask.entity.eid && !b.notice && !b.reasoning
    )
      .map((b) => String(comp(b, 'content').body ?? '')).filter(Boolean).join(
        '\n\n',
      )
    if (!final) return
    for (
      let input of entries.filter((b) =>
        b.inbox_input && seqOf(b) <= seqOf(boundary)
      )
    ) {
      let reply = derivedEid(`inbox reply ${input.entity.eid}`)
      if (comp(input, 'inbox_input').reply) continue
      let receipt = comp(input, 'inbox_input')
      let [message] = await g.get([String(receipt.message)])
      try {
        await g.apply([{
          entity: input.entity,
          inbox_input: { reply },
          $was: { inbox_input: { reply: token(null) } },
        }, {
          entity: { eid: reply },
          comment: {
            target: receipt.root,
            ...message?.comment ? { reply_to: receipt.message } : {},
          },
          doc: { body: final },
          $actor: { by: session, via: session },
        }], { trusted: true })
      } catch (error) {
        if (!(error instanceof Stale)) throw error
      }
    }
  }
  return { accept, publish }
}

export let inboxHandlers = (
  host: Host,
  options: AnsweringOptions,
): Handlers => {
  let api = answering(host.graph, options)
  return {
    inbox_answer: async (event) => await api.accept(event.entity.eid),
    inbox_publish: async (event) => {
      let [entry] = await host.graph.get([event.entity.eid])
      if (entry?.entry) await api.publish(String(comp(entry, 'entry').session))
      else if (entry?.session) await api.publish(entry.entity.eid)
      else if (entry?.answers) {
        await api.publish(String(comp(entry, 'edge').from))
      }
    },
  }
}
