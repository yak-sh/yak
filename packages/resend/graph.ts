// The `@yaks/resend/graph` facet: the sender this plugin lends its host, named
// `resend`, which @yaks/mail selects with `sender: {"via": "resend"}`.
import { afresh, type Sender } from '@yaks/host/senders'
import type { Options } from './options.ts'
import { configured } from './sender.ts'

/** The `resend` sender, built from these options at every letter. */
export let senders = (
  _host: unknown,
  options: Options = {},
): Record<string, Sender> => ({ resend: afresh(() => configured(options)) })
