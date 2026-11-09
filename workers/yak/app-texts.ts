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
import {
  type Arrival,
  Blocked,
  kept,
  type Keyword,
  type Sender,
} from '@yaks/phone'
import { type App, appStore, directoryOf, type Space } from './directory.ts'
import type { Env } from './env.ts'
import { KERNEL, metaOf } from './meta.ts'
import { phoneOf } from './phones.ts'
import { countedTexts } from './meter.ts'
import { charged, costOf } from './text-spend.ts'

/** Why a text from an app without a number of its own did not go. */
export let PILOT =
  'This app has no number of its own yet, so it texts only people who agreed to texts from yaks.app. It texts everyone else once its number is registered.'

/** The words an app's number answers a keyword in, in its space's name. */
export let answers = (
  name: string,
): Record<Keyword, string> => ({
  stop:
    `${name}: You are unsubscribed and will get no more texts. Reply START to subscribe again.`,
  start:
    `${name}: You're subscribed to texts again. Msg & data rates may apply. Reply STOP to opt out.`,
  help:
    `${name}: Reply here to reach us. Msg & data rates may apply. Reply STOP to opt out.`,
})

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
    let receipt = await charged(env, at, await phoneOf(env, at.sender)).send({
      to: text.to,
      text: text.text,
      ...(from ? { from } : {}),
    })
    return { ...receipt, ...(from ? { from } : {}) }
  },
})

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
  let graph = metaOf(appStore(env.STORE, line.space, line.app, env))
  let people = await graph.query(
    `.phone.number=${JSON.stringify(arrival.from)}`,
  )
  let { controlText, formKeyword, textControl, textStopped } = await import(
    './operator-signup.ts'
  )
  if (textControl(arrival).length) await controlText(env, line.space, arrival)
  let word = formKeyword(arrival.text)
  await graph.apply([
    ...kept(arrival, word ? people.map((p) => p.entity.eid) : []),
    ...textControl(arrival),
  ], KERNEL)
  if (!word) {
    if (
      await textStopped({
        get: (ids) => graph.query(`.entity.eid=${ids.join(',')}&?cancelled`),
      }, arrival)
    ) return
    let { signupArrived } = await import('./operator-signup.ts')
    if (
      await signupArrived(
        env,
        line.space,
        { ...arrival, via: arrival.via! },
        line.app.eid,
      )
    ) {
      await countedTexts(env, line.space, costOf(arrival.text))
    }
    return
  }
  let said = answers(line.space.title || line.space.slug)[word]
  let answer: Bundle = {
    entity: { eid: crypto.randomUUID() },
    doc: { body: said },
    text: { from: arrival.to, to: arrival.from },
  }
  // The answer a carrier requires goes whatever the budget says, and is
  // counted all the same.
  try {
    let phone = await phoneOf(
      env,
      arrival.via
        ? { ...line.space.sender, via: arrival.via }
        : line.space.sender,
    )
    let { id } = await phone.send({
      to: arrival.from,
      text: said,
      from: arrival.to,
    })
    await countedTexts(env, line.space, costOf(said))
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
