/** A verified person and instrument, or the ownership recorded for a row. */
export type Owner = { by?: string | null; via?: string | null }

/** A bylined row belongs to its person; an unbylined row belongs to its
 * instrument, including after that browser signs in. Instruments never grant
 * access to a row bound to another person.
 *
 * ```ts
 * import { owns } from '@yaks/member'
 * owns({ by: 'ana', via: 'browser' }, { by: 'bo', via: 'browser' }) // false
 * owns({ via: 'browser' }, { by: 'ana', via: 'browser' }) // true
 * owns({}, {}) // false
 * ```
 */
export let owns = (
  owner: Owner,
  who: Owner & { browsers?: readonly string[] },
): boolean =>
  owner.by
    ? owner.by == who.by
    : !!owner.via && (who.by && who.browsers !== undefined
      ? who.browsers.includes(owner.via)
      : owner.via == who.via)
