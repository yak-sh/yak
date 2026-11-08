// What Claude reads as it is, beside text, importable without the model
// (./mod.ts): a host that loads the model lazily still knows what to hand it.

// https://platform.claude.com/docs/en/build-with-claude/vision
// https://platform.claude.com/docs/en/build-with-claude/pdf-support
// https://platform.claude.com/docs/en/build-with-claude/files
// First-party API: images are at most 10 MB base64; whole requests 128 MB.
// PDFs also have a request-wide page cap: 600, or 100 below 1M context tokens.
// Plain text is the only other native document type; office formats require
// conversion or code execution and are not document inputs.
/** Native MIME types and raw-byte ceilings, before other request content. */
export let READS: Record<string, number> = {
  'image/png': 7.5 * 1024 * 1024,
  'image/jpeg': 7.5 * 1024 * 1024,
  'image/gif': 7.5 * 1024 * 1024,
  'image/webp': 7.5 * 1024 * 1024,
  'application/pdf': 96 * 1024 * 1024,
  'text/plain': 128 * 1024 * 1024,
}
