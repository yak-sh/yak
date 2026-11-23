/** The feedback tool shared by yak and yaks.app. @module */

/** The tool's name, hints, and arguments, shared by each host. */
export let feedback: {
  name: 'feedback'
  destructive: false
  openWorld: true
  input: {
    type: 'object'
    properties: Record<'text' | 'thread' | 'app' | 'space', {
      type: 'string'
      description: string
    }>
  }
} = {
  name: 'feedback',
  destructive: false,
  openWorld: true,
  input: {
    type: 'object',
    properties: {
      text: {
        type: 'string',
        description:
          'The feature request or bug report in the person’s words, with what they tried and what happened. With thread, what to add. Omit to read replies.',
      },
      thread: {
        type: 'string',
        description: 'The thread ID or private receipt from earlier feedback.',
      },
      app: {
        type: 'string',
        description: 'The slug or <space>/<app> of the app in use, if any.',
      },
      space: { type: 'string', description: 'The space in use, if any.' },
    },
  },
}

/** What both hosts say about the support conversation. */
export let description: string =
  'Send a feature request or bug report to the people who run yaks.app. ' +
  'Use the person’s words and include what they tried and what happened. ' +
  'Returns the support thread. Pass thread to read replies and fixes, or thread with text to add to it.'
