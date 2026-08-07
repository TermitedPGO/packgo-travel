// migrate.test.mjs — scripts/migrate.mjs 的 redact() regression 測試。
//
// 由 node --test 跑(同 canary 兩支的做法)。migrate.mjs 只有被直接執行時才連資料庫,
// 被 import 時只提供純函式,所以這裡可以安全 import redact 而不會觸發任何 migration。
//
// 為什麼是子行程:跟 canary 測試一樣,真的 spawn 一個 node 去 import 真正的 redact,
// 而不是在測試進程裡假造一份 —— 測到的是部署時真正會跑的那個函式。
//
// 焦點(Codex DB 加固返工單第 5 條):舊版 redact 的正規式對【含裸 @ 的密碼】只遮到
// 第一個 @,後半段外洩(mysql://user:p@ssXXXX@host 會變成 mysql://***:***@ssXXXX@host)。
// 新版先試 new URL() 把整條 URL 的帳密清成 ***(URL 解析器認得 userinfo 的邊界,幾個
// @ 都吃得下),失敗才退回放寬正規式(同一行貪婪吃到最後一個 @)。
import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const SENTINEL = "ZQX9SENTINEL";
const SCRIPT_PATH = fileURLToPath(new URL("./migrate.mjs", import.meta.url));

/** 在子行程裡 import 真正的 redact,對每一條 input 各印一行 redact 後的結果。 */
function redactInSubprocess(inputs) {
  const src = [
    `import { redact } from ${JSON.stringify(SCRIPT_PATH)};`,
    `const inputs = ${JSON.stringify(inputs)};`,
    `for (const s of inputs) console.log(redact(s));`,
  ].join("\n");
  const r = spawnSync(process.execPath, ["--input-type=module", "-e", src], {
    encoding: "utf8",
    timeout: 60_000,
  });
  return { status: r.status, out: `${r.stdout ?? ""}${r.stderr ?? ""}` };
}

test("redact:含裸 @ 的密碼(連線字串形狀)整段遮蔽 — 子行程實跑,無哨兵外洩", () => {
  const inputs = [
    // 整條就是一條 URL,密碼含裸 @(舊版就是在這裡只遮到第一個 @、後半外洩)
    `mysql://migrator:p@ss${SENTINEL}@gw.example.com:4000/test`,
    // URL 夾在錯誤訊息中間,密碼含裸 @
    `connect ETIMEDOUT for mysql://migrator:p@ss${SENTINEL}@gw.example.com:4000/test now`,
    // 密碼含兩個裸 @
    `mysql://migrator:a@b@c${SENTINEL}@gw.example.com:4000/test`,
    // 一般密碼(無 @)的 URL 也要遮
    `mysql://migrator:${SENTINEL}@gw.example.com:4000/test`,
    // 沒有 @ 的 bare userinfo 形狀(少一條斜線時漏出來的那種)也要遮
    `getaddrinfo failed for migrator:${SENTINEL}@gw.example.com`,
  ];
  const { status, out } = redactInSubprocess(inputs);
  assert.equal(status, 0, out);
  assert.ok(
    !out.includes(SENTINEL),
    `含 @ 密碼沒有被完整遮蔽,哨兵外洩:\n${out}`,
  );
  // 每一行都應該出現遮蔽記號,確認 redact 真的動了手(不是原樣輸出)。
  assert.equal(
    (out.match(/\*\*\*:\*\*\*@/g) ?? []).length,
    inputs.length,
    `應有 ${inputs.length} 行被遮成 ***:***@,實際:\n${out}`,
  );
});

test("redact:不含憑證的普通訊息原樣通過(不誤遮)", () => {
  const inputs = [
    "getaddrinfo ENOTFOUND gw.example.com",
    "code=ETIMEDOUT errno=-60",
    "[migrate] Running migrations from ./drizzle ...",
  ];
  const { status, out } = redactInSubprocess(inputs);
  assert.equal(status, 0, out);
  assert.ok(!out.includes("***:***@"), `普通訊息被誤遮:\n${out}`);
});
