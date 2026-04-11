#!/usr/bin/env python3
import re

with open('server/routers.ts', 'r') as f:
    content = f.read()

# Add import at top
old_import = 'import { COOKIE_NAME } from "@shared/const";'
new_import = 'import { COOKIE_NAME } from "@shared/const";\nimport { tourMonitorRouter } from "./routers/tourMonitorRouter";'
if old_import in content and 'tourMonitorRouter' not in content:
    content = content.replace(old_import, new_import, 1)
    print('Added import')
else:
    print('Import already exists or not found')

# Find and replace the tourMonitor block using regex
pattern = r'\n  // ── Tour Monitor ─+\n  tourMonitor: router\(\{.*?\}\),\n\n\}\);\nexport type AppRouter = typeof appRouter;'
replacement = '\n  // ── Tour Monitor ──────────────────────────────────────────────────────────\n  tourMonitor: tourMonitorRouter,\n\n});\nexport type AppRouter = typeof appRouter;'

match = re.search(pattern, content, re.DOTALL)
if match:
    content = re.sub(pattern, replacement, content, flags=re.DOTALL)
    with open('server/routers.ts', 'w') as f:
        f.write(content)
    print('SUCCESS: tourMonitor replaced with tourMonitorRouter')
else:
    print('ERROR: pattern not found')
    # Show the end of the file for debugging
    lines = content.split('\n')
    print('Last 20 lines:')
    for line in lines[-20:]:
        print(repr(line))
