# R9/R10 addendum(r8-manifest.md 保持外錨 bytes,不再追加)

> Codex R9 裁定 P2-5:r8-manifest.md 整檔必須維持外部錨定的 SHA(ee357cec…f89)。
> R9 起的補充一律寫本檔,本檔自身 SHA 另行外部錨定(見交流資料夾)。

## R9 補充:registryWhitelist.ts 的 R7 基準(R8 裁定 P2-5)
- server/_core/sqlRehearsal/registryWhitelist.ts(R7 時點未改動,基準=committed HEAD 855d175d 版本)
- SHA-256(由 git 物件推導,任何人可用 `git show HEAD:server/_core/sqlRehearsal/registryWhitelist.ts | shasum -a 256` 重現):d3603f40b6a13d82194fe68f6b68c08e5bf21c2ee13aea48b65b600a5fb136f1
- 誠實聲明:本 manifest 的 R7 基準區塊為 R8 完工後回溯建立(當時無 checkpoint),tracked 檔可由 git 物件獨立驗真(如本條),untracked 檔無法回溯驗真 —— R8 之後的差額(R8 區塊經 Codex 錨定 SHA ee357cec…f89 外存)起才具完整內容級證明力。

## 證明力聲明(R10-4 縮窄)

Git object 只直接證明「committed HEAD 的 bytes」。因此:
- 可獨立驗真:R7 時點**未曾改動**的 tracked 檔(其 R7 內容=HEAD 內容,如上節 registryWhitelist.ts,附可重現指令)。
- 不可回溯驗真:R7 時點已有未 commit 修改的 tracked 檔與 untracked 檔(r8-manifest.md 的 R7 區塊為 R8 完工後回溯建立)。
- 完整內容級證明力自 R8 起成立:R8 區塊經外部錨定(ee357cec…f89),R9 起差額以「外錨 R8 SHA + 現檔對照」機械核對。
