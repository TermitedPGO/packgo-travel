#!/usr/bin/env python3
"""
Extract performance metrics from dev server log.
Usage: python3 extract_metrics.py <group> <label> <start_ts> <end_ts> <status> <total_time>
"""
import sys
import re
import json
import os

group = sys.argv[1]
label = sys.argv[2]
start_ts = int(sys.argv[3])
end_ts = int(sys.argv[4])
status = sys.argv[5]
total_time = int(sys.argv[6])

LOG_FILE = "/home/ubuntu/packgo-travel/.manus-logs/devserver.log"
RESULTS_FILE = "/home/ubuntu/packgo-travel/test_logs/results.json"

def parse_log_section(log_content, start_ts, end_ts):
    """Extract relevant log lines between start and end timestamps."""
    lines = log_content.split('\n')
    relevant = []
    for line in lines:
        # Match ISO timestamp in log: [2026-01-23T00:03:49.262Z]
        m = re.match(r'\[(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})\.(\d+)Z\]', line)
        if m:
            from datetime import datetime, timezone
            try:
                dt = datetime.fromisoformat(m.group(1) + '+00:00')
                ts = int(dt.timestamp())
                if start_ts <= ts <= end_ts + 60:  # +60s buffer
                    relevant.append(line)
            except:
                pass
        elif relevant:  # continuation lines
            relevant.append(line)
    return '\n'.join(relevant)

def extract_phase_timings(log_section):
    """Extract PHASE TIMING SUMMARY from log."""
    timings = {}
    
    # Look for PHASE TIMING SUMMARY block
    summary_match = re.search(
        r'PHASE TIMING SUMMARY.*?(?=\[20|\Z)',
        log_section, re.DOTALL
    )
    if summary_match:
        summary = summary_match.group(0)
        # Extract individual phase times: P1_scrape: 5.2s
        for m in re.finditer(r'(P[\w\.]+)\s*[:\|@]\s*\+?([\d\.]+)s', summary):
            timings[m.group(1)] = float(m.group(2))
    
    # Also try inline format: P1_scrape@+0.0s | P2_contentAnalyzer@+5.2s
    inline_match = re.search(r'P1_scrape@\+([\d\.]+)s', log_section)
    if inline_match and not timings:
        for m in re.finditer(r'(P[\w\.]+)@\+([\d\.]+)s', log_section):
            timings[m.group(1)] = float(m.group(2))
    
    return timings

def extract_qa_score(log_section):
    """Extract QA score and verdict."""
    qa_score = None
    verdict = None
    sr_rounds = 0
    
    # QA score patterns
    for pattern in [
        r'QA.*?score[:\s]+(\d+)',
        r'總分[:\s]+(\d+)',
        r'"score"\s*:\s*(\d+)',
        r'QA Score[:\s]+(\d+)',
        r'\[QA\].*?(\d+)\s*分',
        r'\[Calibration\].*?score[:\s]+(\d+)',
    ]:
        m = re.search(pattern, log_section, re.IGNORECASE)
        if m:
            qa_score = int(m.group(1))
            break
    
    # Verdict patterns
    for pattern in [
        r'verdict[:\s]+"?(approved|review|rejected)"?',
        r'\[QA\]\s*(approved|review|rejected)',
        r'"verdict"\s*:\s*"(approved|review|rejected)"',
        r'Verdict[:\s]+(approved|review|rejected)',
    ]:
        m = re.search(pattern, log_section, re.IGNORECASE)
        if m:
            verdict = m.group(1).lower()
            break
    
    # Self-repair rounds
    sr_matches = re.findall(r'[Ss]elf.?[Rr]epair.*?[Rr]ound\s*(\d+)', log_section)
    if sr_matches:
        sr_rounds = max(int(x) for x in sr_matches)
    else:
        sr_count = len(re.findall(r'[Ss]elf.?[Rr]epair', log_section))
        sr_rounds = max(0, sr_count - 1) if sr_count > 0 else 0
    
    return qa_score, verdict, sr_rounds

def count_llm_calls(log_section):
    """Count invokeLLM calls in log section."""
    return len(re.findall(r'\[invokeLLM\]|\[LLM\].*?calling|invokeLLM.*?start', log_section, re.IGNORECASE))

# Read log file
try:
    with open(LOG_FILE, 'r', encoding='utf-8', errors='replace') as f:
        log_content = f.read()
except FileNotFoundError:
    log_content = ""

# Extract relevant section
log_section = parse_log_section(log_content, start_ts, end_ts)

# Extract metrics
timings = extract_phase_timings(log_section)
qa_score, verdict, sr_rounds = extract_qa_score(log_section)
llm_calls = count_llm_calls(log_section)

# Build result
result = {
    "group": group,
    "label": label,
    "status": status,
    "total_time": total_time,
    "timings": timings,
    "qa_score": qa_score,
    "verdict": verdict,
    "sr_rounds": sr_rounds,
    "llm_calls": llm_calls,
    "log_chars": len(log_section),
}

print(f"\n=== METRICS: Group {group}-{label} ===")
print(f"Total time: {total_time}s | Status: {status}")
print(f"Phase timings: {timings}")
print(f"QA Score: {qa_score} | Verdict: {verdict} | SR rounds: {sr_rounds}")
print(f"LLM calls: {llm_calls}")
print(f"Log section: {len(log_section)} chars")

# Save to results file
results = []
if os.path.exists(RESULTS_FILE):
    try:
        with open(RESULTS_FILE, 'r') as f:
            results = json.load(f)
    except:
        results = []

results.append(result)
with open(RESULTS_FILE, 'w') as f:
    json.dump(results, f, indent=2, ensure_ascii=False)

print(f"\n[SAVED] Results written to {RESULTS_FILE}")
