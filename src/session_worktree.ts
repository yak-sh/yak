// Display ids (S#…) are not filesystem or git-ref names. A checkout's identity
// is eid-derived and stays put even when the session later acquires a num.
export let sessionHandle = (eid: string) =>
  eid.replaceAll('-', '').slice(0, 10).toLowerCase()

// Recognize trees we already cut under older conventions, but never mint those
// spellings again. Attached branches belong to the caller, not the runner.
export let ownsSessionBranch = (
  eid: string,
  branch: unknown,
  num?: number | null,
) =>
  !branch || branch == `session/${sessionHandle(eid)}` ||
  branch == `session/${eid}` ||
  branch == `session/S#${sessionHandle(eid)}` ||
  (num != null && branch == `session/S-${num}`)
