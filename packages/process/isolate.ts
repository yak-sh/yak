// A Linux managed run belongs to its own user scope, never its launcher's
// service cgroup. Both local supervisors and filesystem receipts use this door.

/** The user manager's address, available while user@<uid> is active. */
export let bus = (uid: number): Record<string, string> => ({
  XDG_RUNTIME_DIR: `/run/user/${uid}`,
  DBUS_SESSION_BUS_ADDRESS: `unix:path=/run/user/${uid}/bus`,
})

/** Lift the following command out of the launcher's systemd unit. Failure to
 * reach that manager must fail the launch, never fall back inside its unit. */
export let scope = (unit: string): string[] => [
  'systemd-run',
  '--user',
  '--scope',
  '--collect',
  '--quiet',
  `--unit=${unit}`,
]
