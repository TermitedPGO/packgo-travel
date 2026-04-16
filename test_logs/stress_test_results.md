# LLM Stress Test Results - Production (packgo-d3xjbq67.manus.space)
## 2026-04-15 19:21-19:23 UTC

| Prompt Size | Chars | Elapsed (ms) | Model | Success |
|-------------|-------|-------------|-------|---------|
| small | 60 | 62 | gemini-2.5-flash | ✅ |
| medium | 395 | 31,105 | gemini-2.5-flash | ✅ |
| large | 3,589 | 30,972 | gemini-2.5-flash | ✅ |

## Key Findings
- All 3 tests PASSED on production
- LLM responds in ~31s for medium/large prompts (well within 120s timeout)
- Model: gemini-2.5-flash (provisioned_throughput)
- Medium prompt: 8,502 total tokens (310 prompt + 8,192 completion)

## Conclusion
Production LLM is working correctly. The earlier timeout issue was likely caused by:
1. Old deployment with forge.manus.im DNS failure
2. Retry mechanism amplifying 120s timeouts to 480s
3. Both issues are now fixed

## Next: Run Group 0 baseline A/B tests
