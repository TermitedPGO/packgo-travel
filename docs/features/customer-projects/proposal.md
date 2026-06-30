# 客人專案分層(repeat customer)— Stage 1 提案

> 來源:2026-06-29 Jeff 提出。常客(如 Emerald Young)會反覆下單,每次訂機票都是新單。
> 若所有對話/文件/報價都堆進同一條客人記錄,跑幾單就變一坨、翻不到也理不清(chat 塞爆)。
> 狀態:方向 + 兩題設計已由 Jeff 拍板鎖定。本檔不寫 code。實作建議開新 session 用本檔交接。

## 一、問題

- 客人頁目前是「一個客人 = 一條 AI 工作台對話 + 一條真實對話 thread」,扁平。
- 常客場景:Emerald 常跟我們訂機票,每次是獨立的一單。十次訂票 = 十坨混在一起的對話/文件/報價。
- 未來客人不會只訂一次,扁平結構一定會把 chat history 塞爆。

## 二、鎖定的決策(Jeff 2026-06-29)

1. 單位:**專案 = 一筆訂單**。用「**訂單號 + 日期 + 一句註釋(這單是幹嘛的)**」標。
   - 例:`PG-2026-0142 · 2026-07-04 · Emerald 太太+2 孩 北京↔鳳凰城來回`
2. 對話:**每個專案各自的對話 + AI 上下文**。換專案 → 換對話線,AI 只看這個專案的脈絡。這是「不塞爆」的根本解。
3. **最高原則:最精簡優先**。能複用就複用,不另開平行系統,不過度設計。

## 三、最精簡設計方向(待 design 階段細化)

核心:**長在既有 custom orders 系統上**,不要造新的平行概念。

- 「專案」≈ 既有 custom order(已有訂單號、日期、狀態機)。design 階段先核對 customOrders schema:
  - 訂單號、日期:多半已有 → 直接用。
  - 「一句註釋(這單是幹嘛的)」:確認有沒有合適欄位,沒有就加一個短 label 欄(精簡,一行字)。
- 客人頁加一個「專案切換」:客人底下列出他的專案(按日期),選一個就進那個專案的脈絡。
  - 既有「訂單」tab 是這件事的起點 → 把它升級成客人底下的主要組織單位(專案列表 by 日期),而不是另開。
- 對話綁專案(關鍵資料模型改動):
  - 目前 `customerChatMessages`(Jeff↔AI 工作台)與 `customerConversationThread`(真實往來)是 keyed on 客人(userId / profileId)。
  - 要做到「每專案各自對話」,這兩條要再多一個維度:`orderId`(或 projectId)。選了專案 → 對話/AI 上下文 scope 到該專案。
  - AI chat 端點 `/api/agent/ask-ops-stream` 已收 customerId / customerProfileId → 再加一個可選 `orderId` 把專案脈絡釘進 system prompt(跟現有 draftProfileId 同模式)。
- 沒有專案的舊客人:預設一個「未分類 / 一般」籃子,不強迫每個客人都先建專案(精簡、向後相容)。

## 四、開放問題(design 階段要答)

- customOrders 現有 schema 到底有哪些欄位?「專案」要不要 = customOrder 本身,還是 customOrder 之上再包一層?(先驗證再決定,別假設)
- 「對話綁專案」對既有的對話收齊引擎(Gmail filed thread)有什麼影響?一封客人的信怎麼歸到正確的專案?(可能需要人工指派 or 預設落「未分類」)
- 客人頁 UI:專案切換放哪、長怎樣(維持 A+B 高密度極簡)。

## 五、下一步

- 兩題設計已拍板,可進 design(細化資料模型 + UI + 收齊引擎影響)→ tasks → code。
- 實作建議開新 session,以本檔交接(本 session 已很長)。
- 部署照規矩:分支開發 → 測試 → 給 Jeff 看 → 他同意才 `pnpm ship`(CLAUDE.md §4.3)。
