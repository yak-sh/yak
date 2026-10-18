// An explicitly armed, short-lived PID-local caller capture. Reading an
// absent sidecar never creates it. Consumption only decrements local memory.
export let getStarts = (db: string, pid = Deno.pid, now = Date.now) => {
  let file = `${db}.get-starts.json`
  let arm = '', left = 0, until = 0, checked = 0
  return () => {
    let at = now()
    if (at >= checked) {
      checked = at + 250
      try {
        let x = JSON.parse(Deno.readTextFileSync(file))
        if (
          x.pid == pid && typeof x.arm == 'string' && x.arm != arm &&
          Number.isInteger(x.next) && x.next > 0 && x.next <= 16 &&
          Number.isFinite(x.until) && x.until > at && x.until <= at + 30_000
        ) {
          arm = x.arm
          left = x.next
          until = x.until
        }
      } catch { /* Missing or malformed controls cannot affect graph reads. */ }
    }
    if (at >= until || left <= 0) return false
    left--
    return true
  }
}
