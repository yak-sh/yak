// Pure UI boundaries: remembered project selection, submission, and cancellable polling.
export type Project = { id: string; title: string }
export type Conversation = {
  id: string
  status: string
  before: boolean
  nextBefore: number | null
  messages: Array<{ id: string; role: 'user' | 'assistant'; text: string }>
}

export function selectedProject(
  projects: Project[],
  remembered?: string,
): string {
  return (
    projects.find((project) => project.id === remembered)?.id ??
      projects[0]?.id ??
      ''
  )
}

/** A synchronous latch protects even before React renders a loading state. */
export function submissionGate() {
  let pending = false
  return async (submit: () => Promise<void>) => {
    if (pending) return
    pending = true
    try {
      await submit()
    } finally {
      pending = false
    }
  }
}

/** Serial polling never overlaps reads; disposal ignores an already-running read. */
export function poll<T>(
  read: () => Promise<T>,
  receive: (value: T) => void,
  fail: (error: unknown) => void,
  schedule: (next: () => void) => () => void = (next) => {
    const timer = setTimeout(next, 1500)
    return () => clearTimeout(timer)
  },
): () => void {
  let disposed = false
  let cancel: (() => void) | undefined
  async function next() {
    try {
      const value = await read()
      if (!disposed) receive(value)
    } catch (error) {
      if (!disposed) fail(error)
    } finally {
      if (!disposed) cancel = schedule(() => void next())
    }
  }
  void next()
  return () => {
    disposed = true
    cancel?.()
  }
}

export function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

// Preserve markdown replies while keeping the user's words literal.
function literal(text: string): string {
  return text.replace(/([\\`*_{}[\]()#+\-.!>|])/g, '\\$1')
}

export function transcript(value: Conversation): string {
  const messages = value.messages.map(
    (message) =>
      `### ${message.role === 'user' ? 'You' : 'Yak'}\n\n${
        message.role === 'user' ? literal(message.text) : message.text
      }`,
  )
  return [
    `**${literal(value.status || 'Waiting for reply')}**`,
    ...messages,
    ...(messages.length ? [] : ['Waiting for the conversation…']),
  ].join('\n\n---\n\n')
}

/** Tail revisions replace matching messages without throwing away older pages. */
export function mergeConversation(
  current: Conversation | undefined,
  page: Conversation,
  direction: 'tail' | 'older',
): Conversation {
  if (!current) return page
  const messages = new Map<string, Conversation['messages'][number]>()
  const ordered = direction === 'older'
    ? [...page.messages, ...current.messages]
    : [...current.messages, ...page.messages]
  for (const message of ordered) messages.set(message.id, message)
  return {
    ...(direction === 'older' ? current : page),
    messages: [...messages.values()],
    before: direction === 'older' ? page.before : current.before,
    nextBefore: direction === 'older' ? page.nextBefore : current.nextBefore,
  }
}
