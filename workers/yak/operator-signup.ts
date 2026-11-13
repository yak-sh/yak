import type { Tool } from '@yaks/session'
import type { Arrival } from '@yaks/phone'
import { Blocked, keyword } from '@yaks/phone'
import { formKeyword } from '@yaks/forms/text'
import { type Bundle, derivedEid, type Graph } from '@yaks/graph'
import {
  appStore,
  directoryOf,
  type Role,
  type Space,
  url as urlOf,
} from './directory.ts'
import type { Env } from './env.ts'
import { KERNEL } from './meta.ts'
import { refuse } from './tool.ts'
import { builderOf, SPACE } from './build-door.ts'
import { requestId } from './operator-channels.ts'
import { phonedIn, textedOperator } from './operator-texts.ts'
import { reachOf } from './operator-reach.ts'

let consentAt = (arrival: Pick<Arrival, 'from' | 'to'>) =>
  derivedEid(JSON.stringify(['text-consent', arrival.from, arrival.to]))

/** STOP survives without granting a first-time texter any announcement consent. */
export let textControl = (arrival: Arrival): Bundle[] => {
  let word = keyword(arrival.text)
  return word == 'stop' || word == 'start'
    ? [{
      entity: { eid: consentAt(arrival) },
      cancelled: word == 'stop' ? {} : null,
    }]
    : []
}

export let textStopped = async (
  g: Pick<Graph, 'get'>,
  arrival: Pick<Arrival, 'from' | 'to'>,
) => !!(await g.get([consentAt(arrival)], ['cancelled']))[0]?.cancelled

export let SIGNUP =
  'You are helping this person sign up by text. Only use the sign-up tools, directly. List the open forms and their own registrations to find what they want or resume where they stopped. The registration is the whole progress of the conversation: read it each turn, even if the transcript says something different. Ask only the question returned by next, in its own words, with its choices and hint. Required questions come first. Tell them each optional question can be skipped by replying skip, and record that as null. Record an answer only when the person gave it; never infer agreement to announcements or other text consent. Repeat groups take arrays of answer objects; ask how many entries, then their questions as next returns them. After required answers are complete, explain that they are signed up and offer the remaining optional questions. Once next is null, give the form’s thanks. Reply briefly in plain text. You only answer the text you received; never start a text, delegate, set a wake-up, subscribe, or change anything outside their own registrations and private calendar link.'

let linked = (value: unknown, root: string): unknown => {
  if (Array.isArray(value)) return value.map((row) => linked(row, root))
  return value && typeof value == 'object' && 'calendar' in value &&
      typeof value.calendar == 'string'
    ? { ...value, calendar: new URL(value.calendar, root).href }
    : value
}

/** Form operations, bound to the vouched person's identity. */
export let signupTools = (
  env: Env,
  space: Space,
  person: string,
  phone: string,
): Tool[] => {
  let apps = () => directoryOf(env.STORE).apps(space)
  let ask = async (op: string, args: Record<string, unknown>) => {
    let all = (await apps()).filter((a) => !a.trashed && a.version != null)
    let selected = args.app
      ? all.filter((a) => a.eid == args.app || a.slug == args.app)
      : all
    if (args.app && !selected.length) {
      throw refuse('missing', 'No such sign-up app.')
    }
    let out = await Promise.all(selected.map(async (app) => {
      let value = await appStore(env.STORE, space, app, env).consume(
        '/signup',
        async (response) => {
          let result = await response.json() as { message?: string }
          if (!response.ok) {
            throw refuse('arguments', result.message ?? 'Sign-up failed.')
          }
          return result
        },
        {
          method: 'POST',
          body: JSON.stringify({
            ...args,
            op,
            person,
            phone,
            space: space.eid,
          }),
        },
        KERNEL,
      )
      return { app: app.slug, result: linked(value, urlOf(space, app, env)) }
    }))
    return JSON.stringify(
      out.filter(({ result }) => !Array.isArray(result) || result.length > 0),
    )
  }
  let string = { type: 'string' }
  let tool = (
    name: string,
    description: string,
    properties = {},
    required: string[] = [],
  ): Tool => ({
    name: 'signup_' + name,
    description,
    parameters: { type: 'object', properties, required },
    // A sign-up turn is about these, so they are sent whole.
    deferred: false,
    run: (args) => ask(name, args),
  })
  return [
    tool(
      'forms',
      'List the open forms in this space; only public form descriptions are returned.',
    ),
    tool(
      'start',
      'Start or resume your registration for this form. Returns next, the only question to ask now.',
      { app: string, form: string },
      ['app', 'form'],
    ),
    tool(
      'answer',
      'Record the person’s answer to next and return the next question still owed. Use null only when they skip an optional question. Supply the exact path returned by next.',
      {
        app: string,
        registration: string,
        path: { type: 'array', items: { type: ['string', 'number'] } },
        value: {},
      },
      ['app', 'registration', 'path', 'value'],
    ),
    tool(
      'mine',
      'Show only this person’s registrations, their private calendar link and the next question each still owes.',
    ),
    tool(
      'calendar',
      'Get the person’s private calendar link for their registrations, including website sign-ups matched by their verified phone. A registration id is optional. Set replace to true only when they ask for a new link; the previous link then stops working.',
      { app: string, registration: string, replace: { type: 'boolean' } },
      ['app'],
    ),
  ]
}

/** A reply-only form request, with a stable provider receipt for redelivery. */
export let signupArrived = async (
  env: Env,
  space: Space,
  arrival: Arrival & { via: string },
  person?: string,
) => {
  if (formKeyword(arrival.text) || !arrival.text.trim()) return false
  person ??= await phonedIn(env, arrival.from)
  let response = await builderOf(env, space.eid)(() =>
    new Request('https://builder/operator/signup', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-yak-person': person,
        'x-yak-kernel': '1',
        [SPACE]: space.eid,
      },
      body: JSON.stringify({
        say: arrival.text,
        request: {
          channel: 'signup',
          address: arrival.from,
          reply_to: arrival.to,
          via: arrival.via,
        },
        options: { id: requestId(space.eid, `${arrival.via}:${arrival.id}`) },
      }),
    })
  )
  if (!response.ok) {
    throw new Error('Operator sign-up intake failed: ' + await response.text())
  }
  await response.body?.cancel()
  return response.status == 202
}

/** Keep the line's opt-out where queued Operator answers can see it. */
export let controlText = async (
  env: Env,
  space: Space,
  arrival: Arrival,
) => {
  let person = await phonedIn(env, arrival.from)
  let response = await builderOf(env, space.eid)(() =>
    new Request('https://builder/operator/control', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-yak-kernel': '1',
        'x-yak-person': person,
        [SPACE]: space.eid,
      },
      body: JSON.stringify({ arrival }),
    })
  )
  if (!response.ok) {
    throw new Error('Operator text control: ' + await response.text())
  }
  return await response.json() as { stopped: boolean }
}

/**
 * Who a text to a space's own number or inbound line is for (D-151808). A
 * text to an app's own number never gets here: it is that app's
 * (operator-texts.ts `arrived`, app-texts.ts). Here a carrier keyword (STOP,
 * START, HELP) is answered in the campaign's words, from anyone; nothing else
 * from a number that said STOP reaches a model; someone with a seat in the
 * space, viewer or writer, writes in their own conversation with its
 * Operator, which has their reach (a viewer's with the sign-up tools beside
 * it, operator.ts `roster`); anyone else signs up, with only the form tools.
 */
export let textRoute = (
  word: string | null,
  stopped: boolean,
  role: Role | null,
): 'control' | 'quiet' | 'own' | 'signup' =>
  word ? 'control' : stopped ? 'quiet' : role ? 'own' : 'signup'

/** A text to a space's own number or inbound line, sent where `textRoute`
 * says. */
export let spaceArrived = async (
  env: Env,
  space: Space,
  arrival: Arrival & { via: string },
) => {
  let word = formKeyword(arrival.text)
  let { stopped } = await controlText(env, space, arrival)
  let person = word || stopped ? '' : await phonedIn(env, arrival.from)
  let { role } = person
    ? await reachOf(directoryOf(env.STORE), space, person)
    : { role: null }
  let route = textRoute(word, stopped, role)
  if (route == 'quiet') return
  if (route == 'own') return await textedOperator(env, space, person, arrival)
  if (route == 'signup') {
    if (await signupArrived(env, space, arrival, person)) {
      let { countedTexts } = await import('./meter.ts')
      let { costOf } = await import('./text-spend.ts')
      await countedTexts(env, space, costOf(arrival.text))
    }
    return
  }
  let { answers } = await import('./app-texts.ts')
  let { answerText } = await import('./operator-line.ts')
  try {
    await answerText(env, space, {
      address: arrival.from,
      reply_to: arrival.to,
      via: arrival.via,
      channel: 'control',
    }, answers(space.title || space.slug)[word!])
  } catch (error) {
    if (!(error instanceof Blocked)) throw error
  }
}
