#!/usr/bin/env node
/**
 * check-no-mock —— 1A0a CI grep gate(plan v4.3 §1.1/§3.2)。
 *
 * 非 /preview/ 路徑的 client 原始碼出現 `MOCK_` 識別字即 fail —— 防止假財務
 * 數字(AdminHome MOCK_FINANCE 事故型)再次進入正式 UI 與真值頁並列。
 * 掛在 .husky/pre-push 與 `pnpm check:no-mock`。
 */
import { execSync } from "node:child_process";

let out = "";
try {
  out = execSync(
    "git grep -n 'MOCK_' -- 'client/src' ':(exclude)client/src/**/preview/**'",
    { encoding: "utf8" },
  );
} catch (err) {
  // git grep exit 1 = 零命中(通過);其他 = 真錯誤
  if (err.status === 1) {
    console.log("[check-no-mock] OK — no MOCK_ identifiers outside /preview/");
    process.exit(0);
  }
  console.error("[check-no-mock] git grep failed:", err.message);
  process.exit(2);
}

console.error("[check-no-mock] FAIL — MOCK_ identifiers found outside /preview/:");
console.error(out.trim());
process.exit(1);
