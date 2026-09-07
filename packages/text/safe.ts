/**
 * The text host's content boundary. Every text leaf and link destination loses
 * C0, DEL and C1 bytes before the host supplies formatting. Unlike the older
 * terminal helper, this retains no FTS markers, tabs or literal newlines;
 * structural elements are the only source of output line breaks.
 */

// deno-lint-ignore no-control-regex -- the full control class is the boundary
let controls = /[\x00-\x1f\x7f-\x9f]/g

/** Strip every C0/DEL/C1 byte from content, including tabs and newlines. */
export let safe = (text: string): string => text.replace(controls, '')

/** Strip the same bytes from a destination before it enters link syntax. */
export let safeHref = (href: string): string => safe(href)
