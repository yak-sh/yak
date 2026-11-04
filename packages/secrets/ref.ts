// What a kept 1Password reference looks like. Pure, so every reader of a
// secret can tell a reference from a value without loading the `op` reader.

/** Whether a written value is a reference rather than a value: `op://` and at
 * least vault, item and field. Spaces are fine — it is an argument, never a
 * shell word — but a control character is not. */
export let isOpRef = (value: string): boolean =>
  value.startsWith('op://') &&
  // deno-lint-ignore no-control-regex
  !/[\u0000-\u001f\u007f]/.test(value) &&
  value.slice(5).split('/').filter((s) => s.length > 0).length >= 3
