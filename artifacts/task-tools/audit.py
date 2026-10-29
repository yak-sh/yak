#!/usr/bin/env python3
"""Read historical transcripts; verify the audit's source references and counts.

Run from the repository root: python3 artifacts/task-tools/audit.py
No graph writes, network requests, or subprocesses are performed.
"""
import collections
import hashlib
import json
import pathlib
import re

ROOT = pathlib.Path(__file__).parent
CUTOFF = '2026-10-29T13:48:00'
ROOTS = [pathlib.Path.home() / '.claude/projects/-home-yaks-code-tasks',
         pathlib.Path.home() / '.codex/sessions']
PATTERN = re.compile(r'\b(?:python[23]?|jq|sed)\b|<<[-~]?\s*[\'\"]?(?:JSON|EOF|PY|BUNDLE)|graph[ _]apply', re.I)


def calls(row):
    """The two transcript formats' assistant tool invocations, never results."""
    if row.get('type') == 'assistant':
        for part in row.get('message', {}).get('content', []):
            if isinstance(part, dict) and part.get('type') == 'tool_use':
                yield part.get('name', ''), part.get('input', {}), part.get('id', '')
    if row.get('type') == 'response_item':
        part = row.get('payload', {})
        if part.get('type') in ('function_call', 'custom_tool_call'):
            arg = part.get('arguments', part.get('input', ''))
            if isinstance(arg, str):
                try:
                    arg = json.loads(arg)
                except ValueError:
                    pass
            yield part.get('name', ''), arg, part.get('call_id', '')


def command(arg):
    if isinstance(arg, dict):
        return arg.get('command', arg.get('cmd', '')) or json.dumps(arg, ensure_ascii=False)
    return str(arg)


def audit():
    evidence = [json.loads(line) for line in (ROOT / 'evidence.jsonl').open()]
    wanted = {(row['path'], row['line'], row['call_id']): row for row in evidence}
    seen = set()
    found = set()
    stats = collections.Counter()
    for root in ROOTS:
        for path in root.rglob('*.jsonl'):
            stats['files'] += 1
            with path.open(errors='replace') as stream:
                for number, line in enumerate(stream, 1):
                    stats['lines'] += 1
                    if not any(tag in line for tag in ('"tool_use"', '"function_call"', '"custom_tool_call"')):
                        continue
                    try:
                        row = json.loads(line)
                    except ValueError:
                        continue
                    at = row.get('timestamp', '')
                    if at and at[:19] > CUTOFF:
                        continue
                    stats['historical_tool_records'] += 1
                    for name, arg, call_id in calls(row):
                        text = command(arg)
                        key = (str(path), number, call_id)
                        if key in wanted:
                            digest = hashlib.sha256(text.encode()).hexdigest()
                            assert digest == wanted[key]['command_sha256'], key
                            found.add(key)
                        if call_id in seen or not PATTERN.search(name + ' ' + text):
                            continue
                        seen.add(call_id)
                        stats['broad_candidates'] += 1
    assert found == set(wanted), f'{len(set(wanted) - found)} missing evidence references'
    acts = collections.Counter(act for row in evidence for act in set(row['acts']))
    expected = json.loads((ROOT / 'audit-counts.json').read_text())
    assert len(evidence) == expected['invocations']
    assert dict(acts) == expected['acts']
    print(json.dumps({'scan': dict(stats), 'verified_invocations': len(found),
                      'acts': dict(acts)}, indent=2))


if __name__ == '__main__':
    audit()
