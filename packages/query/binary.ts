// A text operand for a binary property names bytes in standard base64. This
// is interpretation of an existing scalar token, not another query grammar.

import { fromBase64, toBase64 } from '@yaks/fp'

/** Decode a binary property's operand. Padded and unpadded standard base64
 * name the same bytes; malformed input, whitespace and nonzero unused bits
 * are refused rather than silently naming different bytes. */
export let binaryOperand = (text: string): Uint8Array => {
  if (
    !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}(?:==)?|[A-Za-z0-9+/]{3}=?|)$/
      .test(text)
  ) {
    throw new Error('binary operand must be base64')
  }
  let value = fromBase64(text)
  if (toBase64(value).replace(/=+$/, '') != text.replace(/=+$/, '')) {
    throw new Error('binary operand must be base64')
  }
  return value
}
