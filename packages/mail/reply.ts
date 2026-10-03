/** An authenticated email reply is the same comment and choice as other doors. */
import type { Bundle, Comp } from '@yaks/graph'
import type { Book } from './arrive.ts'
import { answer, type Decision } from '@yaks/task'

let comp = (b: Bundle | undefined, name: string): Comp =>
  b?.[name] as Comp ?? {}
let str = (v: unknown) => String(v ?? '')

/** The new words, without the quoted conversation or a conventional signature. */
export let unquoted = (body: string): string =>
  body.split(/\r?\n(?:On .+wrote:|>.*|--\s*$)/m)[0].trim()

/** The number shown in the letter, or a custom answer. Out-of-range numbers
 * remain comments rather than silently becoming custom decision answers. */
export let choice = (body: string, decision: Decision): string => {
  let text = unquoted(body)
  return /^\d+$/.test(text)
    ? decision.choices[Number(text) - 1]?.label ?? ''
    : text
}

/** Keep the received envelope even when its author cannot act on the thread.
 * DKIM is the receiving edge's verdict, never an assertion in the body. */
export let replied = async (
  graph: Book,
  letter: Bundle,
  parent: Bundle | undefined,
  by: string | null,
  owner?: string,
): Promise<Bundle[]> => {
  if (!parent?.mail_notice && !owner) return [letter]
  let mail = comp(letter, 'mail')
  let prior = comp(parent, 'mail')
  if (parent?.mail_notice && !prior.target) return [letter]
  let target = parent?.conversation
    ? parent.entity.eid
    : str(prior.target || mail.target)
  if (!by || mail.verified != true || !target) return [letter]
  let recipient = str(comp(parent, 'deliver').to)
  // A stored outgoing envelope proves whom we asked. Without it, only an
  // explicitly enabled inbox recipient can act via a thread's email address.
  if (parent?.deliver ? recipient != by : owner != by) return [letter]
  let addressed = (await graph.read(`.entity.eid=${JSON.stringify(target)}`))[0]
  let ancestor = str(comp(addressed, 'comment').target)
  let root = ancestor
    ? (await graph.read(`.entity.eid=${JSON.stringify(ancestor)}`))[0]
    : addressed
  if (ancestor) target = ancestor
  if (
    !root || (root.mail && !root.conversation) ||
    !(root.task || root.design || root.session ||
      root.bug || root.project || root.doc)
  ) return [letter]
  let replyTo =
    (parent?.comment
      ? parent.entity.eid
      : str(comp(parent, 'mail_notice').comment)) ||
    (ancestor ? addressed!.entity.eid : '')
  let out: Bundle = {
    ...letter,
    mail: { ...mail, target },
    comment: { target, ...(replyTo ? { reply_to: replyTo } : {}) },
  }
  let decision = root.decision as Decision | undefined
  let picked = decision ? choice(str(comp(letter, 'doc').body), decision) : ''
  let assigned = str(comp(root, 'filed').assignee)
  let canAnswer = !assigned || assigned == by
  return [
    out,
    ...(picked && canAnswer && !root.decided && !root.cancelled &&
        !root.completed
      ? answer(target, picked).map((b) => ({ ...b, $actor: { by } }))
      : []),
  ]
}
