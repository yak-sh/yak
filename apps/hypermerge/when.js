// How long ago something happened, in the few words a list shows.

/// ago(0, 30e3) -> 'just now'
/// ago(0, 5 * 60e3) -> '5 min ago'
/// ago(0, 3 * 3600e3) -> '3 h ago'
/// ago(0, 50 * 3600e3) -> '2 days ago'
export let ago = (at, now = Date.now()) => {
  let m = (now - new Date(at)) / 60e3
  return m < 1
    ? 'just now'
    : m < 60
    ? `${Math.floor(m)} min ago`
    : m < 48 * 60
    ? `${Math.floor(m / 60)} h ago`
    : `${Math.floor(m / 1440)} days ago`
}
