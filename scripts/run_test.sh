#!/bin/bash
# A/B Performance Test Runner
# Usage: ./scripts/run_test.sh <GROUP> <URL_LABEL> <URL>
# Example: ./scripts/run_test.sh 0 A "https://travel.liontravel.com/detail?GroupID=26JX502JX3-T"

GROUP="$1"
LABEL="$2"
URL="$3"
LOG_DIR="/home/ubuntu/packgo-travel/test_logs"
mkdir -p "$LOG_DIR"

echo "[TEST] Group=$GROUP URL=$LABEL Starting at $(date)"

# Clear old dev server log section marker
DEV_LOG="/home/ubuntu/packgo-travel/.manus-logs/devserver.log"

# Record start timestamp
START_TS=$(date +%s)
START_MARK="TEST_START_${GROUP}_${LABEL}_${START_TS}"
echo "[TESTMARK] $START_MARK" >> "$DEV_LOG" 2>/dev/null || true

# Trigger generation via local dev server API
# First login
LOGIN=$(curl -s -c /tmp/test_cookies.txt -X POST "http://localhost:3000/api/trpc/auth.login" \
  -H "Content-Type: application/json" \
  -d '{"json":{"email":"admin@packgo.test","password":"admin123","rememberMe":false}}' \
  --max-time 15 2>&1)

if ! echo "$LOGIN" | grep -q '"success":true'; then
  echo "[ERROR] Login failed: $LOGIN"
  exit 1
fi

echo "[TEST] Login OK, submitting generation..."

# Submit generation job
GEN=$(curl -s -b /tmp/test_cookies.txt -X POST "http://localhost:3000/api/trpc/tours.submitAsyncGeneration" \
  -H "Content-Type: application/json" \
  -d "{\"json\":{\"url\":\"$URL\",\"forceRegenerate\":true,\"isPdf\":false}}" \
  --max-time 20 2>&1)

JOB_ID=$(echo "$GEN" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d['result']['data']['json']['jobId'])" 2>/dev/null)

if [ -z "$JOB_ID" ]; then
  echo "[ERROR] Failed to get jobId. Response: $GEN"
  exit 1
fi

echo "[TEST] Job submitted: $JOB_ID"

# Poll for completion (max 10 minutes)
MAX_WAIT=600
ELAPSED=0
STATUS=""
while [ $ELAPSED -lt $MAX_WAIT ]; do
  sleep 10
  ELAPSED=$((ELAPSED + 10))
  
  STATUS_RESP=$(curl -s -b /tmp/test_cookies.txt -X POST "http://localhost:3000/api/trpc/tours.getGenerationStatus" \
    -H "Content-Type: application/json" \
    -d "{\"json\":{\"jobId\":\"$JOB_ID\"}}" \
    --max-time 10 2>&1)
  
  STATUS=$(echo "$STATUS_RESP" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d['result']['data']['json']['status'])" 2>/dev/null)
  echo "[TEST] ${ELAPSED}s - Status: $STATUS"
  
  if [ "$STATUS" = "completed" ] || [ "$STATUS" = "failed" ]; then
    break
  fi
done

END_TS=$(date +%s)
TOTAL_TIME=$((END_TS - START_TS))
END_MARK="TEST_END_${GROUP}_${LABEL}_${END_TS}"
echo "[TESTMARK] $END_MARK status=$STATUS total=${TOTAL_TIME}s" >> "$DEV_LOG" 2>/dev/null || true

echo "[TEST] Group=$GROUP URL=$LABEL DONE. Status=$STATUS Total=${TOTAL_TIME}s"

# Extract metrics from log
echo "[TEST] Extracting metrics from log..."
python3 /home/ubuntu/packgo-travel/scripts/extract_metrics.py "$GROUP" "$LABEL" "$START_TS" "$END_TS" "$STATUS" "$TOTAL_TIME"
