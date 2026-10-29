#!/usr/bin/env python3
"""Discover tool failures, subsequent CLI invocations and fallback narratives.

Read-only streaming discovery. Usage: python3 artifacts/task-tools/fallback-audit.py /tmp/task-fallback-scan.json
The output is scratch review material and can contain transcript text.
"""
import collections
import hashlib
import json
import pathlib
import re
import sys
import time

CUTOFF = '2026-10-29T13:48:00'
ROOTS = [pathlib.Path.home() / '.claude/projects/-home-yaks-code-tasks',
         pathlib.Path.home() / '.codex/sessions']
TASK = re.compile(r'(?:mcp[_:/].*tasks(?:[_:/]|$)|mcp__tasks__)', re.I)
CLI = re.compile(r'\byak(?:\s+--[^\s]+(?:\s+[^\s]+)?)*\s+(?:task|graph|memory|comment|topic|decision|design|claim|search|history)\b')
CONTEXT = re.compile(r'MCP|tool|schema|connection|server', re.I)
WORD = re.compile(r'\bCLI\b|\byak\b', re.I)
FAIL = re.compile(r'isError[\\"\s:]+true|CallError|MCP.*(?:error|failed|refused|unavailable)|ECONNREFUSED|not returned by tools/list', re.I)


def arguments(value):
    if isinstance(value, str):
        try:
            return json.loads(value)
        except ValueError:
            pass
    return value


def command(value):
    if isinstance(value, dict):
        return value.get('command', value.get('cmd', '')) or json.dumps(value, ensure_ascii=False)
    return str(value)


def scan():
    started = time.monotonic()
    stats = collections.Counter()
    events = collections.defaultdict(list)
    calls = {}
    errors = []
    narratives = []
    seen_calls = set()
    seen_text = set()
    seen_results = set()
    invalid_sources = []
    for root in ROOTS:
        for path in sorted(root.rglob('*.jsonl')):
            stats['files'] += 1
            session = str(path)
            byte_offset = 0
            with path.open('rb') as stream:
                for line_no, raw in enumerate(stream, 1):
                    offset = byte_offset
                    byte_offset += len(raw)
                    line = raw.decode(errors='replace')
                    stats['lines'] += 1
                    # Tool results dominate the bytes. Only failures need decoding;
                    # all assistant messages and tool invocations remain eligible.
                    call_tag = any(tag in line for tag in ('"tool_use"', '"function_call"', '"custom_tool_call"'))
                    error_tag = any(tag in line for tag in ('"is_error":true', '"is_error": true', 'isError', 'CallError', 'ECONNREFUSED', 'not returned by tools/list'))
                    prose_tag = WORD.search(line) and CONTEXT.search(line)
                    if not (call_tag or error_tag or prose_tag):
                        continue
                    try:
                        row = json.loads(line)
                    except ValueError:
                        stats['invalid_json'] += 1
                        timestamp = re.search(r'"timestamp"\s*:\s*"([^"\n]*)', line)
                        invalid_sources.append({'path': session, 'line': line_no,
                                                'byte_offset': offset, 'bytes': len(raw),
                                                'timestamp': timestamp.group(1) if timestamp else None,
                                                'terminated': raw.endswith(b'\n'),
                                                'raw_sha256': hashlib.sha256(raw).hexdigest(),
                                                'prefix': line[:500]})
                        continue
                    stats['decoded_records'] += 1
                    at = row.get('timestamp', '')
                    if at and at[:19] > CUTOFF:
                        continue
                    source = {'path': session, 'line': line_no, 'timestamp': at}
                    content = []
                    tool_calls = []
                    results = []
                    kind = row.get('type')
                    if kind == 'assistant':
                        content = row.get('message', {}).get('content', [])
                        if isinstance(content, list):
                            for part in content:
                                if not isinstance(part, dict):
                                    continue
                                if part.get('type') == 'tool_use':
                                    tool_calls.append((part.get('name', ''), part.get('input', {}), part.get('id', '')))
                    elif kind == 'user':
                        parts = row.get('message', {}).get('content', [])
                        if isinstance(parts, list):
                            results.extend(p for p in parts if isinstance(p, dict) and p.get('type') == 'tool_result')
                    elif kind == 'response_item':
                        part = row.get('payload', {})
                        if part.get('type') in ('function_call', 'custom_tool_call'):
                            tool_calls.append((part.get('name', ''), arguments(part.get('arguments', part.get('input', ''))), part.get('call_id', '')))
                        elif part.get('type') in ('function_call_output', 'custom_tool_call_output'):
                            results.append({'tool_use_id': part.get('call_id', ''), 'content': part.get('output', ''), 'is_error': False})
                        elif part.get('type') == 'message' and part.get('role') == 'assistant':
                            content = part.get('content', [])
                    for part in content if isinstance(content, list) else []:
                        if not isinstance(part, dict) or part.get('type') not in ('text', 'thinking', 'output_text'):
                            continue
                        text = part.get('text', part.get('thinking', ''))
                        if not isinstance(text, str) or not (WORD.search(text) and CONTEXT.search(text)):
                            continue
                        digest = hashlib.sha256(text.encode()).hexdigest()
                        if digest in seen_text:
                            continue
                        seen_text.add(digest)
                        narratives.append({**source, 'text': text})
                    for name, arg, call_id in tool_calls:
                        if not call_id or call_id in seen_calls:
                            continue
                        seen_calls.add(call_id)
                        stats['unique_tool_calls'] += 1
                        text = command(arg)
                        event = {**source, 'id': call_id, 'name': name, 'command': text}
                        events[session].append(event)
                        if TASK.search(name):
                            calls[call_id] = event
                            stats['task_mcp_calls'] += 1
                        elif name in ('exec', 'functions.exec') and TASK.search(text):
                            calls[call_id] = event
                            stats['wrapped_task_mcp_calls'] += 1
                        if CLI.search(text) and name in ('Bash', 'exec', 'functions.exec', 'exec_command', 'functions.exec_command'):
                            event['cli'] = True
                            stats['yak_invocations'] += 1
                    for part in results:
                        call_id = part.get('tool_use_id', '')
                        if call_id not in calls or call_id in seen_results:
                            continue
                        seen_results.add(call_id)
                        text = part.get('content', '')
                        text = text if isinstance(text, str) else json.dumps(text, ensure_ascii=False)
                        if part.get('is_error') or FAIL.search(text):
                            errors.append({**source, 'call': calls[call_id], 'error': text[:1600]})
    transitions = []
    for failure in errors:
        call = failure['call']
        following = [e for e in events[call['path']] if e['line'] > failure['line']]
        candidates = []
        for distance, event in enumerate(following[:30], 1):
            if event.get('cli'):
                candidates.append({**event, 'tool_distance': distance})
        transitions.append({**failure, 'following_cli': candidates})
    stats['task_mcp_failure_candidates'] = len(errors)
    stats['narrative_candidates'] = len(narratives)
    stats['error_with_following_cli_candidates'] = sum(bool(t['following_cli']) for t in transitions)
    return {'cutoff': CUTOFF + 'Z', 'stats': dict(stats), 'elapsed_seconds': time.monotonic() - started,
            'transitions': transitions, 'narratives': narratives,
            'invalid_sources': invalid_sources}


if __name__ == '__main__':
    output = pathlib.Path(sys.argv[1] if len(sys.argv) > 1 else '/tmp/task-fallback-scan.json')
    data = scan()
    output.write_text(json.dumps(data, ensure_ascii=False))
    print(json.dumps({k: v for k, v in data.items() if k not in ('transitions', 'narratives')}, indent=2))
