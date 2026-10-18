/** Whether the collector needs the remaining repository/service fixtures. */
export let remainingFixtures = (
  remaining: boolean,
  controls: boolean,
): boolean => remaining && !controls
