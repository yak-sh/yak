// What a Store's write log may not keep. The log itself, its receipts and its
// replay are @yaks/api's (log.ts, receipts.ts `door`); this is the platform's
// word on which bodies stay out of it.
import { carries } from '@yaks/secrets'

/** Whether a body carries a secret's value (@yaks/secrets `carries`). The log
 * keeps none: a key is kept nowhere but the vault. A body that mentions a
 * secret and cannot be read is taken to carry one. */
export let keyed = (body: string): boolean => {
  if (!body.includes('secret')) return false
  try {
    let said = JSON.parse(body)
    return carries(Array.isArray(said) ? said : said?.entities)
  } catch {
    return true
  }
}
