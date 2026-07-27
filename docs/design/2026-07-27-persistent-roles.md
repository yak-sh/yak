# Persistent roles

A role is desired fleet capacity, not a Holdco operator. Tasks owns the provider
process and session reconciliation; a project supplies the persona and decides
which roles it wants.

## Graph shape

A role entity carries:

- `doc`: its name and role-specific instructions.
- `role`: `state` (`running` or `stopped`), `surface` (`native` or `managed`),
  and project `scope_eid`.
- `spawn`: provider, model, optional effort, and optional persona.

Every session launched for a role carries `session.role_eid`. That reference is
the only role-to-session membership fact. The current session is derived as the
newest matching session, so `/clear`, provider restarts, and history do not
rewrite the role.

Server-stamped role fields record the last applied configuration hash, apply
time, stop time, and launch error. The hash covers the launch configuration,
role instructions, materialized persona, and repo. It detects configuration
drift without a second list of fields or update-specific restart rules.

## Native surface

One deterministic tmux session belongs to each role. The reconciler:

1. Validates the provider, model, persona, project, and repo.
2. Materializes the role's system instructions under `~/.tasks/roles/`.
3. Starts `task claude --operator` or `task codex --operator` in the project's
   checkout with `TASKS_ROLE` in the invocation environment.
4. Lets the normal provider lifecycle hook mint the session and attach
   `role_eid`.

Claude receives its instruction file through `--append-system-prompt-file`;
Codex receives the same file through the invocation-scoped
`model_instructions_file` override. Both receive one bootstrap prompt that calls
`task_context`; neither uses `/loop`.

The deterministic tmux name is the pre-hook duplicate guard. A daemon restart
finds the existing tmux session and does nothing. A dead TUI is relaunched. A
configuration-hash change rolls that one role's tmux session. Desired `stopped`
kills only that exact tmux session and clears the applied hash, so a later
`running` transition starts a fresh provider session.

## Managed surface

A managed role uses the existing detached session runner and worktree
discipline. Its initial run calls `task_context`, performs the role, and
settles. The provider thread and session entity remain the role's durable idle
door.

When project attention is pending, the reconciler resumes that same managed
thread with a fixed content-free instruction to call `task_context`. Graph
content remains in the atomic inbox call. A busy managed turn is allowed to
finish before this resume; pending graph state is durable.

Changing configuration starts a new managed session after the current turn
settles. Stopping a running managed role mints the ordinary graph
`stop_request`, so one stop mechanism and audit trail remain authoritative.

## Reconciliation

One debounced sweep runs after graph changes, on boot, and on a short interval.
A per-role flight lock prevents duplicate launches within one process;
deterministic tmux names and graph session state provide the durable guards
across restarts.

Invalid configuration and failed launches are stamped on the role, not hidden in
daemon logs. Native and managed roles use the same role entity and session
relationship, while their process adapters remain separate.

## UI

The role view shows desired state, surface, launch configuration, errors, and
all sessions whose `role_eid` points back to it. Start and stop are ordinary
`role.state` patches. The generic schema editors remain the creation and
configuration surface until a dedicated role form earns its place.

## Boundaries

- Pacing is not a role concern. Tasks records usage; Holdco may turn that into
  its own pacing signal.
- Roles do not encode a meta-operator topology or assume one role per project.
- Native keystroke delivery remains best effort and guarded; a future Tasks
  harness implements the same logical attention door without tmux.
