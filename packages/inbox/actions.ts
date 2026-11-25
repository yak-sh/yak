export let actionKinds = [
  'choose',
  'dismiss',
  'friend',
  'transfer',
  'seen',
] as const

export type ActionKind = typeof actionKinds[number]

/** A card action and the answer its host has committed. `seen` is the
 * person opening a space's Updates where no page was asked for (a view
 * shown in place): what it shows is read, as opening the page reads it. Its
 * target is the space. */
export type InboxAction = {
  space: string
  kind: ActionKind
  target: string
  answer: string
}

export type InboxReceipt = { label: string }

export let actionLabel = ({ kind, answer }: InboxAction): string => {
  switch (kind) {
    case 'friend':
      return answer == 'approved' ? 'Request sent' : 'Dismissed'
    case 'choose':
      return 'Answer sent'
    case 'dismiss':
      return 'Dismissed'
    case 'transfer':
      return answer == 'decline' ? 'Declining…' : 'Accepting…'
    case 'seen':
      return 'Read'
  }
}

/** The answer control a choice form submits. */
export let answerField = (kind: ActionKind) =>
  kind == 'choose' ? 'choice' : 'answer'
