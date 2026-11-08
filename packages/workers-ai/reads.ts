// Cloudflare's model pages advertise Vision per model; the chat input schema
// accepts image_url data URLs. The binding has no native PDF/office document
// input: toMarkdown is a separate conversion endpoint.
// https://developers.cloudflare.com/workers-ai/models/llama-3.2-11b-vision-instruct/
// https://developers.cloudflare.com/workers-ai/models/llama-4-scout-17b-16e-instruct/
// https://github.com/cloudflare/workerd/blob/main/types/generated-snapshot/experimental/index.ts
// No common image-byte ceiling is published; individual model limits remain
// the binding's. Infinity represents that absence, not a verified unlimited API.
/** Formats accepted by vision chat models, selected from their published page. */
export let READS: Record<string, number> = {
  'image/png': Infinity,
  'image/jpeg': Infinity,
}

/** A model's documented image formats and raw per-image bound. */
export let pageReads = (body: string): Record<string, number> => {
  if (!/\|\s*Vision\s*\|\s*Yes\s*\|/i.test(body)) return {}
  let formats = body.match(/embedded (?:PNG|JPEG|WebP|GIF)[^\n]+/i)?.[0]
  if (!formats) return READS
  let bound = formats.match(/(\d+(?:\.\d+)?)\s*MiB[^;\n]{0,50}?\beach\b/i)
  let bytes = bound ? Number(bound[1]) * 1024 * 1024 : Infinity
  return Object.fromEntries(
    ['png', 'jpeg', 'webp', 'gif'].filter((type) =>
      new RegExp(`\\b${type}\\b`, 'i').test(formats)
    ).map((type) => [`image/${type}`, bytes]),
  )
}
