// Private media bytes use one base64 encoding across prompts and receipts.
export let encoded = (bytes: Uint8Array) => {
  let chunks: string[] = []
  for (let at = 0; at < bytes.length; at += 8192) {
    chunks.push(String.fromCharCode(...bytes.subarray(at, at + 8192)))
  }
  return btoa(chunks.join(''))
}
