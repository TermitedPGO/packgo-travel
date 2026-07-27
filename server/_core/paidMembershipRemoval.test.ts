/**
 * 付費會員機制移除的負向守門(2026-07-26 R2,Codex 返工單第 6 項)。
 *
 * Jeff 裁定「不應該有付費的會員機制」。第 1 回合終驗證實拆除不完整:
 * Gmail 出信仍推銷 Plus 試用(P0-1)、公開 preview 仍有付費牆(P1-1)。
 * 本檔把「不得回頭」鎖成測試。每一條的鎖定對象都是 runtime 面,
 * 不是註解;掃描前一律剝除註解,理由同 docs/adr/0005(檢查不得逼人刪說明)。
 *
 * 要恢復任何付費機制,必須先完成 §17550.27(10 萬保證金、年費上限、
 * 續約授權時窗)與 AB 2863 法遵,經 Jeff 明示裁定,再更新本檔。
 */
import { describe, it, expect } from "vitest";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const strip = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "").replace(/^\s*#.*$/gm, "");
const read = (rel: string) => strip(readFileSync(join(ROOT, rel), "utf8"));

describe("付費會員機制移除守門(Jeff 2026-07-26 裁定)", () => {
  it("公開路由不得掛付費牆 mockup(P1-1)", () => {
    const app = read("client/src/App.tsx");
    expect(app).not.toMatch(/ai-advisor-mockup/);
    expect(app).not.toMatch(/AIAdvisorMockup/);
    expect(existsSync(join(ROOT, "client/src/pages/preview/AIAdvisorMockup.tsx"))).toBe(false);
  });

  it("Gmail 出信路徑不得存在付費推銷(P0-1)", () => {
    expect(existsSync(join(ROOT, "server/_core/repurchaseCta.ts"))).toBe(false);
    const pipeline = read("server/agents/autonomous/gmailPipeline.ts");
    expect(pipeline).not.toMatch(/PACK&GO Plus|免費試用|free trial|UpgradeCta/i);
    // CRM 計數側效必須還在(拆推銷不得順手弄丟計數)
    expect(pipeline).toMatch(/recordInquiry/);
  });

  it("webhook 不得恢復訂閱事件處理", () => {
    const hook = read("server/_core/stripeWebhook.ts");
    expect(hook).not.toMatch(/customer\.subscription\./);
    expect(hook).not.toMatch(/handleSubscriptionUpserted|handleTrialWillEnd/);
  });

  it("runtime 不得殘留付費價格與試用文案(P1-5:含 39.99)", () => {
    const offenders: string[] = [];
    const PRICE = /\$\s?(89|349|99|399|9\.99|39\.99)\b|10[ -]?(天|day)[^\n]{0,12}(試用|trial)|free trial|免費試用/i;
    const walk = (dir: string) => {
      for (const name of readdirSync(join(ROOT, dir))) {
        const rel = join(dir, name);
        const full = join(ROOT, rel);
        if (statSync(full).isDirectory()) {
          if (/node_modules|dist|\.git|preview/.test(rel)) continue;
          walk(rel);
        } else if (/\.(ts|tsx)$/.test(name) && !/\.test\./.test(name)) {
          if (PRICE.test(strip(readFileSync(full, "utf8")))) offenders.push(rel);
        }
      }
    };
    walk("client/src");
    walk("server");
    expect(offenders).toEqual([]);
  });
});
