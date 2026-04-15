#!/usr/bin/env python3
"""
Single test runner: trigger one tour generation and extract metrics.
Usage: python3 run_single_test.py <group> <label> <url>
"""
import sys
import time
import re
import json
import os
import urllib.request
import urllib.parse
import urllib.error
import http.cookiejar

group = sys.argv[1]
label = sys.argv[2]
url = sys.argv[3]

BASE_URL = "http://localhost:3000"
LOG_FILE = "/home/ubuntu/packgo-travel/.manus-logs/devserver.log"
RESULTS_FILE = "/home/ubuntu/packgo-travel/test_logs/results.json"

URL_NAMES = {'A': '關西', 'B': '花蓮', 'C': '歐洲'}
url_name = URL_NAMES.get(label, label)

print(f"\n{'='*60}")
print(f"[TEST] Group {group}-{label} ({url_name})")
print(f"[TEST] URL: {url[:80]}")
print(f"[TEST] Start: {time.strftime('%H:%M:%S')}")
print(f"{'='*60}")

# Setup cookie jar
cookie_jar = http.cookiejar.CookieJar()
opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(cookie_jar))

def post_json(path, data):
    body = json.dumps(data).encode('utf-8')
    req = urllib.request.Request(f"{BASE_URL}{path}", data=body,
        headers={'Content-Type': 'application/json'})
    try:
        with opener.open(req, timeout=20) as resp:
            return json.loads(resp.read().decode('utf-8'))
    except urllib.error.HTTPError as e:
        return json.loads(e.read().decode('utf-8'))

def get_json(path):
    req = urllib.request.Request(f"{BASE_URL}{path}")
    try:
        with opener.open(req, timeout=15) as resp:
            return json.loads(resp.read().decode('utf-8'))
    except urllib.error.HTTPError as e:
        return json.loads(e.read().decode('utf-8'))

# Step 1: Login
login_resp = post_json("/api/trpc/auth.login",
    {"json": {"email": "admin@packgo.test", "password": "admin123", "rememberMe": False}})
if not login_resp.get('result', {}).get('data', {}).get('json', {}).get('success'):
    print(f"[ERROR] Login failed: {login_resp}")
    sys.exit(1)
print("[OK] Login successful")

# Step 2: Record start time and log position
start_ts = int(time.time())
try:
    log_start_pos = os.path.getsize(LOG_FILE)
except:
    log_start_pos = 0

# Step 3: Submit generation
gen_resp = post_json("/api/trpc/tours.submitAsyncGeneration",
    {"json": {"url": url, "forceRegenerate": True, "isPdf": False}})
try:
    job_id = gen_resp['result']['data']['json']['jobId']
    print(f"[OK] Job submitted: {job_id}")
except Exception as e:
    print(f"[ERROR] Submit failed: {e}")
    print(f"Response: {json.dumps(gen_resp)[:300]}")
    sys.exit(1)

# Step 4: Poll for completion
max_wait = 600  # 10 minutes
elapsed = 0
status = "pending"
last_status = ""

while elapsed < max_wait:
    time.sleep(10)
    elapsed += 10
    
    try:
        encoded = urllib.parse.quote(json.dumps({"json": {"jobId": job_id}}))
        status_resp = get_json(f"/api/trpc/tours.getGenerationStatus?input={encoded}")
        status_data = status_resp.get('result', {}).get('data', {}).get('json', {})
        status = status_data.get('status', 'unknown')
        progress = status_data.get('progress', '')
        
        if status != last_status:
            print(f"[{elapsed:3d}s] Status: {status} {f'| {progress}%' if progress else ''}")
            last_status = status
        
        if status in ('completed', 'failed', 'error'):
            break
    except Exception as e:
        print(f"[{elapsed:3d}s] Poll error: {e}")

end_ts = int(time.time())
total_time = end_ts - start_ts

print(f"\n[DONE] Status={status} | Total={total_time}s")

# Step 5: Extract metrics from log
try:
    with open(LOG_FILE, 'r', encoding='utf-8', errors='replace') as f:
        f.seek(log_start_pos)
        log_section = f.read()
except Exception as e:
    log_section = ""
    print(f"[WARN] Could not read log: {e}")

print(f"[LOG] Captured {len(log_section)} chars from log")

# Save raw log section
os.makedirs("/home/ubuntu/packgo-travel/test_logs", exist_ok=True)
raw_log_path = f"/home/ubuntu/packgo-travel/test_logs/raw_{group}_{label}.log"
with open(raw_log_path, 'w') as f:
    f.write(log_section)

# Extract phase timings from PHASE TIMING SUMMARY
timings = {}
summary_match = re.search(r'PHASE TIMING SUMMARY\s*=+\s*\n.*?⏱\s*(P1_scrape@[^\n]+)', log_section, re.DOTALL)
if not summary_match:
    # Try inline format
    summary_match = re.search(r'P1_scrape@\+([\d\.]+)s[^\n]*', log_section)

if summary_match:
    timing_line = summary_match.group(0) if 'P1_scrape@' in summary_match.group(0) else summary_match.group(1)
    print(f"[TIMING] Found: {timing_line[:150]}")
    for m in re.finditer(r'(P[\w\.]+)@\+([\d\.]+)s', timing_line):
        timings[m.group(1)] = float(m.group(2))

# Calculate individual phase durations from cumulative times
phase_durations = {}
phase_order = ['P1_scrape', 'P2_contentAnalyzer', 'P3_colorTheme', 'P4_details', 
               'P4_itinerary', 'P5_assembly', 'P6_calibration', 'P6b_selfRepair']
prev_time = 0
for phase in phase_order:
    if phase in timings:
        cum_time = timings[phase]
        phase_durations[phase] = round(cum_time - prev_time, 1)
        prev_time = cum_time

# Also check for P1.5
p15_match = re.search(r'P1\.5[_\w]*@\+([\d\.]+)s', log_section)
if p15_match:
    timings['P1.5_dateExtract'] = float(p15_match.group(1))
    phase_durations['P1.5_dateExtract'] = round(float(p15_match.group(1)) - timings.get('P1_scrape', 0), 1)

# Extract QA metrics
qa_score = None
verdict = None
sr_rounds = 0

for pattern in [
    r'Calibration: score=(\d+), verdict=(\w+)',
]:
    m = re.search(pattern, log_section)
    if m:
        qa_score = int(m.group(1))
        verdict = m.group(2).lower()
        break

if qa_score is None:
    for pattern in [r'score=(\d+)', r'"score"\s*:\s*(\d+)', r'QA.*?(\d+)']:
        m = re.search(pattern, log_section)
        if m:
            qa_score = int(m.group(1))
            break

# Count self-repair rounds
sr_matches = re.findall(r'Self.?Repair.*?[Rr]ound\s*(\d+)', log_section)
if sr_matches:
    sr_rounds = max(int(x) for x in sr_matches)
else:
    sr_count = len(re.findall(r'[Ss]elf.?[Rr]epair.*?start|Starting.*?self.?repair', log_section))
    sr_rounds = sr_count

# Count LLM calls (only within the job, not post-processing)
llm_calls = len(re.findall(r'\[invokeLLM\] →', log_section))

# Print metrics
print(f"\n{'─'*50}")
print(f"METRICS: Group {group}-{label} ({url_name})")
print(f"{'─'*50}")
print(f"Total time    : {total_time}s")
print(f"Status        : {status}")
print(f"Cumulative    : {json.dumps(timings)}")
print(f"Phase durations: {json.dumps(phase_durations)}")
print(f"QA Score      : {qa_score}")
print(f"Verdict       : {verdict}")
print(f"SR Rounds     : {sr_rounds}")
print(f"LLM Calls     : {llm_calls}")

# Save result
result = {
    "group": group,
    "label": label,
    "url_name": url_name,
    "status": status,
    "total_time": total_time,
    "timings_cumulative": timings,
    "timings": phase_durations,
    "qa_score": qa_score,
    "verdict": verdict,
    "sr_rounds": sr_rounds,
    "llm_calls": llm_calls,
}

results = []
if os.path.exists(RESULTS_FILE):
    try:
        with open(RESULTS_FILE) as f:
            results = json.load(f)
    except:
        results = []

results = [r for r in results if not (r['group'] == group and r['label'] == label)]
results.append(result)

with open(RESULTS_FILE, 'w') as f:
    json.dump(results, f, indent=2, ensure_ascii=False)

print(f"\n[SAVED] {RESULTS_FILE}")
print(f"[DONE] Group {group}-{label} complete!")
