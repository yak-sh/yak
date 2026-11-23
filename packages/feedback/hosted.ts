/** Submission and reply workflow over the platform's support store. @module */
import { CallError } from '@yaks/tools/errors'

/** The number of replies a signed-in person can add in an hour. */
export let SAYS: number = 12

/** The prefix for a private receipt, distinct from a thread ID. */
export let RECEIPT: string = 'yak_feedback_'

type Thread = { eid: string; person: string | null }
type Reply = { text: string; value: Record<string, unknown> }
type Receipt = {
  seal: (eid: string) => Promise<string>
  open: (receipt: string) => Promise<string | null>
}

/** The feedback workflow's storage, credentials, and notification boundary. */
export type Support<T extends Thread> = {
  signedIn: boolean
  login: string
  email: string
  receipt?: Receipt
  read: (eid: string) => Promise<T | null>
  opens: (thread: T) => Promise<boolean>
  open: (words: string, yak?: string) => Promise<{ thread: T; where: string }>
  add: (thread: T, words: string) => Promise<T>
  recent: (adding: boolean) => Promise<number>
  within: () => Promise<boolean>
  answer: (thread: T, lead: string, receipt?: string) => Reply
}

let text = (value: unknown, name: string): string => {
  if (typeof value != 'string' || !value) {
    throw new CallError('arguments', `${name} is required`)
  }
  return value
}

let yakVersion = (value: unknown): string | undefined => {
  if (value == null) return
  if (
    typeof value != 'string' || value.length > 64 ||
    !/^\d+\.\d+\.\d+(?:-[\w.-]+)?(?:\+[\w.-]+)?$/.test(value)
  ) {
    throw new CallError(
      'arguments',
      'yak_version must be a yak release version',
    )
  }
  return value
}

let admitted = async <T extends Thread>(
  support: Support<T>,
  adding: boolean,
) => {
  let pause = 'every one of them is kept and will be read. Save the rest ' +
    `for later, or write to ${support.email} directly if it cannot wait.`
  if (!support.signedIn) {
    if (!await support.within()) {
      throw new CallError(
        'limit',
        `That is one already this minute from here, and ${pause} Signing in at ${support.login} raises it.`,
      )
    }
    return
  }
  let held = await support.recent(adding)
  if (held >= (adding ? SAYS : 3)) {
    throw new CallError(
      'limit',
      `That is ${held} already this hour, and ${pause}`,
    )
  }
}

let reading = async <T extends Thread>(support: Support<T>, id: string) => {
  let receipt = id.startsWith(RECEIPT)
  if (!receipt && !support.signedIn) {
    throw new CallError(
      'access',
      'An account thread is read signed in by its opener or a member of its space. ' +
        `Sign in at ${support.login}, or use the private receipt for a thread opened signed out.`,
    )
  }
  let eid = receipt ? await support.receipt?.open(id) : id
  let thread = eid ? await support.read(eid) : null
  if (!thread || !(receipt ? !thread.person : await support.opens(thread))) {
    throw new CallError(
      'missing',
      receipt
        ? 'no thread you can read with that receipt'
        : `no thread ${id} that you can read`,
    )
  }
  return thread
}

/** Open, read, or add to a thread at the same feedback door. */
export let submit = async <T extends Thread>(
  support: Support<T>,
  args: Record<string, unknown>,
): Promise<Reply> => {
  let words = args.text == null ? '' : text(args.text, 'text').trim()
  if (args.thread != null) {
    let thread = await reading(support, text(args.thread, 'thread'))
    if (!words) return support.answer(thread, 'The thread as it stands:')
    await admitted(support, true)
    return support.answer(
      await support.add(thread, words),
      'Added to the thread. The people who run yaks.app are told.',
    )
  }
  if (!words) {
    throw new CallError(
      'arguments',
      'Send a feature request or bug report, or name a thread to read it.',
    )
  }
  let yak = yakVersion(args.yak_version)
  await admitted(support, false)
  let { thread, where } = await support.open(words, yak)
  let receipt = !support.signedIn && yak
    ? await support.receipt?.seal(thread.eid)
    : undefined
  let reply = 'Kept as a thread for the people who run yaks.app' +
    (where ? `, with ${where} and the versions` : '') +
    '. They are told by mail and answer in the thread.'
  if (!support.signedIn && !receipt) {
    reply +=
      ' It was said signed out. Include an email address in the text if a reply is wanted.'
  }
  return support.answer(thread, reply, receipt)
}
