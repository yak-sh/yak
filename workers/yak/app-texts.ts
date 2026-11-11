// An app's texts (T-138037), the way its mail goes (post.ts, inbox.ts): a
// text is a row the app writes, `text{}` + `doc{body}` + `deliver{to}`, and
// @yaks/phone's `text_post` hands it to the texter here; a text that arrives
// at the app's number is a row it reads, written at the kernel's door with
// nobody on it.
//
// The app's number is its directory row's `phone{number}`, which an admin
// writes once the number is registered to text for whoever owns the app (a
// 10DLC brand and campaign of their own). Until then the app is in its pilot:
// its texts leave from the platform's toll-free number (operator-texts.ts
// `texter`), and only to someone who agreed to the platform's own texts. So
// nothing reaches the people an app keeps before its owner's registration
// stands, and nothing needs a flag to say so.
//
// Every text that leaves spends from the space's one budget (text-spend.ts).
import type { Bundle } from '@yaks/graph'
import type { Texter } from '@yaks/host/senders'
import {
  type Arrival,
  Blocked,
  kept,
  type Keyword,
  keyword,
  type Sender,
} from '@yaks/phone'
import { type App, appStore, directoryOf, type Space } from './directory.ts'
import type { Env } from './env.ts'
import { KERNEL, type Meta, metaOf } from './meta.ts'
import { phoneOf } from './phones.ts'
import { countedTexts } from './meter.ts'
import { charged, costOf } from './text-spend.ts'

/** Why a text from an app without a number of its own did not go. */
export let PILOT =
  'This app has no number of its own yet, so it texts only people who agreed to texts from yaks.app. It texts everyone else once its number is registered.'

/** The words an app's number answers a keyword in, in its space's name, and
 * HELP with the office number the space gives, where it gives one. */
export let answers = (
  name: string,
  office = '',
): Record<Keyword, string> => ({
  stop:
    `${name}: You are unsubscribed and will get no more texts. Reply START to subscribe again.`,
  start:
    `${name}: You're subscribed to texts again. Msg & data rates may apply. Reply STOP to opt out.`,
  help: `${name}: Reply here to reach us${
    office ? ` or call ${office}` : ''
  }. Msg & data rates may apply. Reply STOP to opt out.`,
})

/**
 * The account that texts for `space` from `from`: a number its owners
 * connected from their own provider (operator-line.ts), which they pay, else
 * the platform's phone, paid from the space's budget (text-spend.ts).
 */
let lineFor = async (
  env: Env,
  space: Space,
  from: string,
  via?: string,
): Promise<Line> => {
  let { accountFor } = await import('./operator-line.ts')
  let held = from ? await accountFor(env, from, space) : null
  return held ? { phone: held, paid: false } : {
    phone: await phoneOf(env, via ? { ...space.sender, via } : space.sender),
    paid: true,
  }
}
type Line = { phone: Texter; paid: boolean }

/**
 * The texter an app's store sends through: from the app's own number, as
 * the store last heard it from the directory (`number`, empty for none), or
 * in its pilot from the platform's; counted against the space it stands in
 * (`space`, its eid).
 */
export let appTexter = (
  env: Env,
  number: () => string | null,
  space: () => string | null,
): Sender => ({
  send: async (text) => {
    let dir = directoryOf(env.STORE)
    let at = await dir.at(space() ?? '')
    if (!at) throw new Error('this store cannot name its space')
    let from = number() || null
    if (!from) {
      let person = await dir.phoned(text.to)
      let agreed = person ? await dir.texting(person) : null
      if (agreed?.number != text.to) throw new Blocked(PILOT)
    }
    let { phone, paid } = await lineFor(env, at, from ?? '')
    let receipt = await (paid ? charged(env, at, phone) : phone).send({
      to: text.to,
      text: text.text,
      ...(from ? { from } : {}),
    })
    return { ...receipt, ...(from ? { from } : {}) }
  },
})

/**
 * Who to call or write to for help, as the app keeps it in its own store:
 * `help{contact}` on any row. An app that declares no such word has none to
 * give.
 */
let contactOf = async (graph: Meta) => {
  try {
    let [row] = await graph.query('.help&*')
    return String(
      (row?.help as { contact?: string } | undefined)?.contact ?? '',
    )
  } catch (error) {
    if ((error as Error).name == 'Unknown') return ''
    throw error
  }
}

/**
 * A text that arrived at an app's own number, kept in its store: the text,
 * the end of consent for everyone there with the sender's number when it
 * says STOP and consent again when it says START, and the answer a keyword
 * is owed, sent from the app's number and kept beside it.
 */
export let appArrived = async (
  env: Env,
  line: { space: Space; app: App },
  arrival: Arrival,
) => {
  let graph = metaOf(appStore(env.STORE, line.space, line.app, env), KERNEL)
  let people = await graph.query(
    `.phone.number=${JSON.stringify(arrival.from)}`,
  )
  // A provider posts a text again until it is answered; the keyword's answer
  // goes once, with the first.
  let again = (await graph.query(
    `.text.message_id=${JSON.stringify(arrival.id)}&.text.from=${
      JSON.stringify(arrival.from)
    }`,
    { trusted: true },
  )).length > 0
  await graph.apply(kept(arrival, people.map((p) => p.entity.eid)), KERNEL)
  let word = keyword(arrival.text)
  if (!word || again) return
  let said = answers(
    line.space.title || line.space.slug,
    await contactOf(graph),
  )[word]
  let answer: Bundle = {
    entity: { eid: crypto.randomUUID() },
    doc: { body: said },
    text: { from: arrival.to, to: arrival.from },
  }
  // The answer a carrier requires goes whatever the budget says, and is
  // counted all the same.
  try {
    let { phone, paid } = await lineFor(
      env,
      line.space,
      arrival.to,
      arrival.via,
    )
    let { id } = await phone.send({
      to: arrival.from,
      text: said,
      from: arrival.to,
    })
    if (paid) await countedTexts(env, line.space, costOf(said))
    answer.text = {
      ...answer.text as object,
      ...(id ? { message_id: id } : {}),
      ...(arrival.via ? { via: arrival.via } : {}),
    }
    answer.delivered = { at: new Date().toISOString() }
  } catch (error) {
    answer.bounced = {
      at: new Date().toISOString(),
      reason: (error instanceof Error ? error.message : String(error))
        .slice(0, 500),
    }
    if (!(error instanceof Blocked)) {
      await graph.apply([answer], KERNEL)
      throw error
    }
  }
  await graph.apply([answer], KERNEL)
}
