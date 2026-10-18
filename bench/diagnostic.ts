/** Preserve the cause of a failed collector rather than its last stack frames. */
export let diagnostic = (text: string, code: number): string => {
  let esc = String.fromCharCode(27)
  let clean = text.replace(new RegExp(esc + '\\[[0-9;]*[A-Za-z]', 'g'), '')
  let lines = clean.split('\n').map((line) => line.trimEnd()).filter(Boolean)
  let start = lines.findIndex((line) =>
    /(?:error:|Error:|Refused:|failed \(|did not paint)/i.test(line)
  )
  return (start < 0 ? lines.slice(-12) : lines.slice(start, start + 18)).join(
    '\n',
  ) || `exit ${code}`
}
