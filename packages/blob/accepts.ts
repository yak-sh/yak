// What an application takes as a blob, said in JSON Schema's own words for a
// string of bytes: `maxLength`, the most bytes one may hold, and
// `contentMediaType`, the media types it may be. A host checks a blob's size
// against the first and the type read off its bytes (`contentType`) against
// the second, so a name or a declared type never gets a file past it.
//
// `contentMediaType` takes one type or a list, and a type may be a range
// (`image/*`, `*/*`), the way an `<input accept>` does. Nothing declared takes
// everything: the limits are the application author's to set.

/** What an application takes as a blob. */
export type Accepts = {
  maxLength?: number
  contentMediaType?: string | string[]
}

let RANGE = /^(\*\/\*|[a-z0-9.+-]+\/([a-z0-9.+-]+|\*))$/i
let WORDS = ['maxLength', 'contentMediaType']

let ranges = (a: Accepts | undefined) =>
  a?.contentMediaType == null
    ? []
    : [a.contentMediaType].flat().map((r) => r.toLowerCase())

/**
 * What is wrong with a declaration, a sentence each; none when it is one.
 *
 * ```ts
 * import { assertEquals } from '@std/assert'
 * import { acceptsErrors } from '@yaks/blob'
 *
 * assertEquals(acceptsErrors({ maxLength: 1048576, contentMediaType: 'image/*' }), [])
 * assertEquals(acceptsErrors({ maxLength: -1 }), [
 *   'maxLength is a whole number of bytes, more than none',
 * ])
 * assertEquals(acceptsErrors({ contentMediaType: ['image'] }), [
 *   'contentMediaType "image" is a media type like image/png, or a range like image/*',
 * ])
 * ```
 */
export let acceptsErrors = (said: unknown): string[] => {
  if (!said || typeof said != 'object' || Array.isArray(said)) {
    return ['an object: {"maxLength": bytes, "contentMediaType": "image/*"}']
  }
  let a = said as Record<string, unknown>
  let types = a.contentMediaType
  let list = Array.isArray(types) ? types : types == null ? [] : [types]
  return [
    ...Object.keys(a).filter((k) => !WORDS.includes(k)).map((k) =>
      `${k} is not one of its words, which are ${WORDS.join(' and ')}`
    ),
    ...(a.maxLength == null ||
        (Number.isSafeInteger(a.maxLength) && Number(a.maxLength) > 0)
      ? []
      : ['maxLength is a whole number of bytes, more than none']),
    ...(Array.isArray(types) && !types.length
      ? ['contentMediaType lists at least one type']
      : []),
    ...list.filter((t) => typeof t != 'string' || !RANGE.test(t)).map((t) =>
      `contentMediaType ${
        JSON.stringify(t)
      } is a media type like image/png, or a range like image/*`
    ),
  ]
}

/** Whether a blob of `bytes` bytes is not too big. */
export let fits = (a: Accepts | undefined, bytes: number): boolean =>
  a?.maxLength == null || bytes <= a.maxLength

/**
 * Whether a blob of media type `type` is one of the types taken.
 *
 * ```ts
 * import { assertEquals } from '@std/assert'
 * import { takes } from '@yaks/blob'
 *
 * let photos = { contentMediaType: ['image/*', 'application/pdf'] }
 * assertEquals(takes(photos, 'image/png'), true)
 * assertEquals(takes(photos, 'application/pdf'), true)
 * assertEquals(takes(photos, 'video/mp4'), false)
 * assertEquals(takes({ contentMediaType: '*' + '/*' }, 'video/mp4'), true)
 * assertEquals(takes({}, 'video/mp4'), true)
 * ```
 */
export let takes = (a: Accepts | undefined, type: string): boolean => {
  let said = ranges(a)
  let [top] = type.split('/')
  return !said.length ||
    said.some((r) => r == type || r == '*/*' || r == `${top}/*`)
}

/** The types taken, as a sentence names them: `image/* or application/pdf`. */
export let taken = (a: Accepts | undefined): string =>
  ranges(a).join(' or ') || '*/*'
