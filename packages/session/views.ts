// The `/views` facet: how a transcript is drawn wherever this package's views
// are asked for. `views`, the portable lines every interface prints, and
// `joined`, which entries make a line of a conversation (./lines.ts, ./joined.ts);
// `conversationKinds`, a conversation's lines drawn with the kit
// (./conversation.ts, also `@yaks/session/conversation`); and
// `inspectViews`, the inspector's pages and parts for an entry and a session
// (./inspect.ts). The two the kit draws load when asked for, so a host that
// prints text loads no kit.
import type { View } from '@yaks/inspect'
import type { Kind } from './conversation.ts'
import type { Registry } from '@yaks/render'

export { sessionViews as views } from './lines.ts'
export { type Joined, joined } from './joined.ts'
export let conversationKinds = (): Promise<Registry<Kind>> =>
  import('./conversation.ts').then((m) => m.kinds)
export let inspectViews = (): Promise<View[]> =>
  import('./inspect.ts').then((m) => m.inspectViews)
