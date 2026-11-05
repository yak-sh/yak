/** A query string of the values given, leaving out what is unset. */
export let query = (
  o: Record<string, string | number | undefined>,
): URLSearchParams =>
  new URLSearchParams(
    Object.entries(o).flatMap(([k, v]) => v == null ? [] : [[k, String(v)]]),
  )
