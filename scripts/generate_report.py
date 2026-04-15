#!/usr/bin/env python3
"""
Generate final performance report table from results.json
"""
import json
import os

RESULTS_FILE = "/home/ubuntu/packgo-travel/test_logs/results.json"

URL_NAMES = {
    'A': '關西',
    'B': '花蓮',
    'C': '歐洲',
}

def fmt(v, unit=''):
    if v is None:
        return '—'
    if isinstance(v, float):
        return f"{v:.1f}{unit}"
    return f"{v}{unit}"

def get_timing(timings, key):
    """Get timing value, trying multiple key variants."""
    variants = [key, key.replace('_', '.'), key.replace('.', '_')]
    for k in timings:
        for v in variants:
            if k.lower() == v.lower() or k.lower().startswith(v.lower()):
                return timings[k]
    return None

if not os.path.exists(RESULTS_FILE):
    print("No results file found. Run tests first.")
    exit(1)

with open(RESULTS_FILE) as f:
    results = json.load(f)

# Index by group-label
indexed = {}
for r in results:
    key = f"{r['group']}-{r['label']}"
    indexed[key] = r

print("\n" + "="*120)
print("PIPELINE A/B PERFORMANCE TEST RESULTS")
print("="*120)

header = "| Group | URL  | 總時間(s) | P1(s) | P1.5(s) | P2(s) | P3(s) | P4(s) | P6(s) | P6b(s) | QA分 | Verdict  | SR輪數 | LLM calls |"
sep    = "|-------|------|----------|-------|---------|-------|-------|-------|-------|--------|------|----------|--------|-----------|"
print(header)
print(sep)

groups = ['0', '1', '2', '3', '4']
labels = ['A', 'B', 'C']

for g in groups:
    for l in labels:
        key = f"{g}-{l}"
        url_name = URL_NAMES.get(l, l)
        
        if key not in indexed:
            row = f"| {key:<5} | {url_name:<4} | {'—':>8} | {'—':>5} | {'—':>7} | {'—':>5} | {'—':>5} | {'—':>5} | {'—':>5} | {'—':>6} | {'—':>4} | {'—':>8} | {'—':>6} | {'—':>9} |"
        else:
            r = indexed[key]
            t = r.get('timings', {})
            
            p1 = get_timing(t, 'P1_scrape') or get_timing(t, 'P1')
            p15 = get_timing(t, 'P1.5_dateExtract') or get_timing(t, 'P1.5') or get_timing(t, 'P15')
            p2 = get_timing(t, 'P2_contentAnalyzer') or get_timing(t, 'P2')
            p3 = get_timing(t, 'P3_colorTheme') or get_timing(t, 'P3')
            p4 = get_timing(t, 'P4_details') or get_timing(t, 'P4') or get_timing(t, 'P4_itinerary')
            p6 = get_timing(t, 'P6_calibration') or get_timing(t, 'P6')
            p6b = get_timing(t, 'P6b_selfRepair') or get_timing(t, 'P6b')
            
            total = r.get('total_time', None)
            qa = r.get('qa_score', None)
            verdict = r.get('verdict', '—') or '—'
            sr = r.get('sr_rounds', '—')
            llm = r.get('llm_calls', '—')
            status = r.get('status', '?')
            
            if status == 'failed':
                url_name = f"{url_name}❌"
            
            row = f"| {key:<5} | {url_name:<4} | {fmt(total,'s'):>8} | {fmt(p1,'s'):>5} | {fmt(p15,'s'):>7} | {fmt(p2,'s'):>5} | {fmt(p3,'s'):>5} | {fmt(p4,'s'):>5} | {fmt(p6,'s'):>5} | {fmt(p6b,'s'):>6} | {fmt(qa):>4} | {verdict:<8} | {fmt(sr):>6} | {fmt(llm):>9} |"
        
        print(row)

print("\n")
print("ANALYSIS SUMMARY")
print("-"*80)

# Compare Group 1 vs 0 (parallelization benefit)
for l in labels:
    g0 = indexed.get(f"0-{l}")
    g1 = indexed.get(f"1-{l}")
    if g0 and g1:
        t0 = g0.get('total_time', 0)
        t1 = g1.get('total_time', 0)
        diff = t0 - t1
        print(f"Group 1 vs 0 ({URL_NAMES[l]}): {diff:+.0f}s ({'faster' if diff > 0 else 'slower'})")

print()
# Compare Group 2 vs 0 (Haiku quality)
for l in labels:
    g0 = indexed.get(f"0-{l}")
    g2 = indexed.get(f"2-{l}")
    if g0 and g2:
        qa0 = g0.get('qa_score', 0) or 0
        qa2 = g2.get('qa_score', 0) or 0
        diff = qa2 - qa0
        print(f"Group 2 vs 0 QA ({URL_NAMES[l]}): {diff:+d} pts ({'acceptable' if diff >= -10 else 'TOO LOW'})")

print()
# Compare Group 3 vs 0 (self-repair rounds)
for l in labels:
    g0 = indexed.get(f"0-{l}")
    g3 = indexed.get(f"3-{l}")
    if g0 and g3:
        v0 = g0.get('verdict', '—')
        v3 = g3.get('verdict', '—')
        t0 = g0.get('total_time', 0)
        t3 = g3.get('total_time', 0)
        print(f"Group 3 vs 0 ({URL_NAMES[l]}): verdict {v0}→{v3}, time {t0-t3:+.0f}s")

print()
# Compare Group 4 vs 0 (all combined)
for l in labels:
    g0 = indexed.get(f"0-{l}")
    g4 = indexed.get(f"4-{l}")
    if g0 and g4:
        t0 = g0.get('total_time', 0)
        t4 = g4.get('total_time', 0)
        diff = t0 - t4
        pct = (diff / t0 * 100) if t0 > 0 else 0
        print(f"Group 4 vs 0 ({URL_NAMES[l]}): {diff:+.0f}s ({pct:+.1f}%)")
