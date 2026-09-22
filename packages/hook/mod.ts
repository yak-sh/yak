/**
 * An event another system delivered. The payload is kept as it arrived —
 * body, method, path, headers — beside the result of checking its signature,
 * because an unsigned hook is still something that happened, and whoever reads
 * it decides what to trust.
 *
 * Components only: a vocabulary document, with no code.
 */

export { hookDoc } from './vocab.ts'
