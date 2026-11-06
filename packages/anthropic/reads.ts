// What Claude reads as it is, beside text, importable without the model
// (./mod.ts): a host that loads the model lazily still knows what to hand it.

/** The media types Claude reads as they are, each with the most bytes the
 * Messages API takes of one: an image 5 MB, a PDF within the request's 32 MB
 * once its base64 and the rest of the conversation are counted. */
export let READS: Record<string, number> = {
  'image/png': 5 * 1024 * 1024,
  'image/jpeg': 5 * 1024 * 1024,
  'image/gif': 5 * 1024 * 1024,
  'image/webp': 5 * 1024 * 1024,
  'application/pdf': 16 * 1024 * 1024,
}
