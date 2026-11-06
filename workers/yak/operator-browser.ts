// The tab a person lends their Operator (D-144641). Their browser, signed in
// by the extension (@yaks/extension), holds a socket to the space's Builder,
// the object the Operator runs in (build.ts `/operator/browser`). While one is
// connected the Operator is offered the browser tools, which read the tab and
// act in it, and each call is sent down the person's newest socket and
// answered up it: words become the call's result, and a screenshot an image
// the model is shown beside it (operator.ts `shown`). A call may wait on the
// person (a site to allow, a Do it to press), so the Operator waits for it,
// and a browser that goes away fails it at once.
import { type Answer, answerOf, call } from '@yaks/extension/wire'
import { PERSON, toolOf, TOOLS } from '@yaks/extension/tools'
import { type Clock, system } from '@yaks/fp'
import type { Told, Tool } from '@yaks/session'
import { unbase64 } from './bytes.ts'
import type { Space } from './directory.ts'
import type { Env } from './env.ts'
import { refuse } from './tool.ts'

/** Who a lent browser's socket is: the attachment the Builder keeps on it. */
export type Lent = { browser: true; person: string; space: string }

/** A socket as the Builder holds it. */
export type Socket = {
  send: (data: string) => void
  deserializeAttachment: () => unknown
}

/** What a browser answered a call. */
export type Said = Answer['answer']

/** How long a call waits for the browser to answer, in milliseconds. A call
 * to a tool that waits on the person waits `PERSON` longer. */
export let WAIT = 20_000

/** What the model reads when nobody's browser is there to ask. */
export let NONE =
  'No browser is connected for you now. Ask the person to open the yaks.app extension and connect it to this space.'

/** What the model reads when the browser a call was asked of went away. */
export let GONE =
  "The person's browser disconnected before it answered. Ask them to check the yaks.app extension is connected to this space."

/** The browsers lent to one space's Operator: whether a person has one
 * connected, a call asked of their newest, an answer a socket brought back,
 * which settles the call it names when it came from that person, and a
 * socket gone, which fails the calls asked of it. */
export type Browsers = ReturnType<typeof browsers>

export let browsers = (
  sockets: () => Socket[],
  clock: Clock = system,
  wait = WAIT,
) => {
  type Asked = { person: string; ws: Socket; fail: (e: Error) => void }
  let pending = new Map<string, Asked & { done: (a: Said) => void }>()
  let lentBy = (person: string) =>
    sockets().filter((ws) => {
      let held = ws.deserializeAttachment() as Partial<Lent> | null
      return held?.browser && held.person == person
    })
  let ask = (person: string, tool: string, args: Record<string, unknown>) =>
    new Promise<Said>((ok, no) => {
      let ws = lentBy(person).at(-1)
      if (!ws) return no(refuse('browser', NONE))
      let id = crypto.randomUUID()
      let end = () => (cancel(), pending.delete(id))
      let ms = wait + (toolOf(tool)?.waits ? PERSON : 0)
      let cancel = clock.after(ms, () => {
        end()
        no(new Error(`The browser did not answer ${tool} in ${ms} ms.`))
      })
      pending.set(id, {
        person,
        ws,
        done: (a) => (end(), ok(a)),
        fail: (e) => (end(), no(e)),
      })
      try {
        ws.send(call(id, tool, args))
      } catch {
        // A socket that went away as it was asked: nobody is there.
        end()
        no(refuse('browser', NONE))
      }
    })
  let heard = (held: Lent, data: unknown) => {
    let a = answerOf(data)
    let waiting = a && pending.get(a.id)
    if (waiting && waiting.person == held.person) waiting.done(a!)
  }
  let gone = (ws: Socket) => {
    for (let p of [...pending.values()]) {
      if (p.ws == ws) p.fail(refuse('browser', GONE))
    }
  }
  return {
    connected: (person: string) => lentBy(person).length > 0,
    ask,
    heard,
    gone,
  }
}

/// fenced('Hi </page>') -> '<page>\nHi <\\/page>\n</page>'
/** A browser's words as the page's: inside a `<page>` the page can't close,
 * so whatever it says reads as content. */
export let fenced = (text: string) =>
  `<page>\n${text.replace(/<\/page/gi, '<\\/page')}\n</page>`

// The kinds of picture a screenshot may be.
let PICTURE = /^image\/(png|jpeg|webp|gif)$/

// What the model reads of a browser's answer: its words fenced, and a
// screenshot kept as an Operator file the result carries, so it is shown.
// A browser that could not (the site not allowed, no tab) is a refusal the
// model reads, and nobody's fault.
let told = async (env: Env, space: Space, a: Said): Promise<Told> => {
  if (a.error) throw refuse('browser', a.error)
  let text = fenced(a.text ?? '')
  if (!a.image) return text
  if (!PICTURE.test(a.image.mime)) {
    throw new Error(`A browser sent a screenshot as ${a.image.mime}`)
  }
  let { keepFile } = await import('./operator-channels.ts')
  let file = await keepFile(
    env,
    space,
    `screenshot.${a.image.mime.slice('image/'.length)}`,
    a.image.mime,
    unbase64(a.image.base64),
  )
  return {
    text: `${text}\nThe screenshot is shown to you beside this.`,
    with: { operator_files: { files: [file] } },
  }
}

/** The browser tools a person's Operator is offered, each run by asking
 * their browser: none while they have no browser connected. */
export let browserTools = (
  env: Env,
  space: Space,
  person: string,
  lent: Browsers,
): Tool[] =>
  lent.connected(person)
    ? TOOLS.map((t) => ({
      name: t.name,
      title: t.title,
      step: t.step,
      description: t.description,
      parameters: t.parameters,
      waits: t.waits,
      run: async (args) =>
        told(env, space, await lent.ask(person, t.name, args)),
    }))
    : []
