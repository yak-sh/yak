export let actionKinds = [
  'choose',
  'dismiss',
  'friend',
  'transfer',
] as const

export type ActionKind = typeof actionKinds[number]

/** A card action and the answer its host has committed. */
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
  }
}

/** The answer control a choice form submits. */
export let answerField = (kind: ActionKind) =>
  kind == 'choose' ? 'choice' : 'answer'
