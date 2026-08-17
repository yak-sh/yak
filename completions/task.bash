# bash completion for the `task` CLI. Every candidate comes from `task
# complete`, which reads the one declaration table (src/tabcomplete.ts), so the
# completion tracks the verbs, options and enums that actually run. Install:
# `source` this file from ~/.bashrc (or drop it in /etc/bash_completion.d/).
#
# bash word-splits on COMP_WORDBREAKS, which includes '=', so `--model=opus`
# arrives as three words (`--model` `=` `opus`). We glue those back into one
# token to match complete()'s contract, then strip the `name=` prefix off the
# candidates so bash substitutes only the part after the '=' it split on.
_task_complete() {
  local IFS=$'\n' w cur pre c
  local -a src merged cands out
  src=("${COMP_WORDS[@]:1:COMP_CWORD}") # after 'task', including the current word
  for w in "${src[@]}"; do
    if ((${#merged[@]} == 0)); then
      merged+=("$w")
    elif [[ "$w" == "=" || "${merged[${#merged[@]}-1]}" == *= ]]; then
      merged[${#merged[@]}-1]+="$w"
    else
      merged+=("$w")
    fi
  done

  cands=($(task complete -- "${merged[@]}" 2>/dev/null))
  cur="${COMP_WORDS[COMP_CWORD]}"

  # Candidates are whole tokens; drop the `name=` bash already split away.
  pre=""
  [[ "${merged[${#merged[@]}-1]}" == *=* ]] && pre="${merged[${#merged[@]}-1]%=*}="
  for c in "${cands[@]}"; do out+=("${c#"$pre"}"); done

  COMPREPLY=($(compgen -W "${out[*]}" -- "$cur"))
}
complete -F _task_complete task
