import { type ComponentChildren } from 'preact'

// The task list — a plain column the Task cards drop into.
export let Tasks = ({ children }: { children: ComponentChildren }) => (
  <ul class='Tasks'>{children}</ul>
)
