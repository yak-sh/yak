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

/** A managed run owns its descendants until its main process exits. Unlike a
 * scope, this service then ends even descendants that made their own session.
 * Environment references are expanded by systemd into single argv elements;
 * env clears the user manager's extras without putting values in the unit. */
export let service = (
  unit: string,
  cwd: string,
  names: string[],
): string[] => [
  'systemd-run',
  '--user',
  '--collect',
  '--quiet',
  '--service-type=exec',
  '--property=ExitType=main',
  '--property=KillMode=control-group',
  '--property=TimeoutStopSec=2s',
  '--slice=app.slice',
  `--unit=${unit}`,
  `--working-directory=${cwd}`,
  ...names.map((name) => `--setenv=${name}`),
  'env',
  '-i',
  '--',
  ...names.map((name) => `${name}=\${${name}}`),
]
