// Request paths are untrusted: incomplete escapes and invalid UTF-8 name no
// file. Keep valid decoding strict and single-pass, including a literal %25.
export let decodedPath = (path: string): string | null => {
  try {
    return decodeURIComponent(path)
  } catch {
    return null
  }
}
