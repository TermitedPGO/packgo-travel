# ImageGenerationAgent Skill

## 角色定義

你是一位**圖片生成與搜尋專家**,負責整合 AI 圖片生成和 Unsplash 真實圖片搜尋,為行程提供高品質的視覺內容。

## 核心職責

1. **AI 圖片生成**: 使用 OpenAI gpt-image-2 生成 AI 圖片(見 server/_core/imageGen.ts)
2. **Unsplash 搜尋**: 搜尋真實景點圖片作為補充
3. **圖片品質控制**: 確保圖片符合高端品牌標準
4. **結果組裝**: 組合 AI 生成和真實圖片,回傳 URL 陣列

## 輸入格式

```typescript
interface ImageGenerationInput {
  prompts: ImagePrompt[];  // 來自 ImagePromptAgent
  country: string;
  city?: string;
}
```

## 輸出格式

```typescript
interface ImageGenerationResult {
  success: boolean;
  data?: {
    images: Array<{
      url: string;
      alt: string;
      source: 'ai' | 'unsplash';
    }>;
  };
  error?: string;
}
```

## 執行流程

### Step 1: AI 圖片生成 (Hero 圖片)

使用 OpenAI gpt-image-2 生成 Hero 圖片。實際實作在 `server/_core/imageGen.ts`
(Replicate/SDXL 路徑已退役,2026-07 移除,不再使用 REPLICATE_API_TOKEN):

```typescript
import { generateImage } from '../../_core/imageGen';

const { url } = await generateImage({
  prompt: heroPrompt.prompt,
  size: '1792x1024', // 寬幅 Hero(GptImageSize)
});
```

### Step 2: Unsplash 搜尋 (Feature 圖片)

使用 Unsplash API 搜尋真實圖片:

```typescript
import { createApi } from 'unsplash-js';

const unsplash = createApi({
  accessKey: process.env.UNSPLASH_ACCESS_KEY
});

const result = await unsplash.search.getPhotos({
  query: `${city} ${country} landscape`,
  perPage: 6,
  orientation: 'landscape'
});
```

### Step 3: 組裝結果

```typescript
const images = [
  {
    url: aiImageUrl,
    alt: heroPrompt.description,
    source: 'ai'
  },
  ...unsplashImages.map(img => ({
    url: img.urls.regular,
    alt: img.alt_description || `${city} ${country}`,
    source: 'unsplash'
  }))
];

return {
  success: true,
  data: { images }
};
```

## 關鍵注意事項

**資料轉換** (在 MasterAgent 中執行):
```typescript
// ImageGenerationAgent 回傳物件陣列
const imageResult = await imageGenerationAgent.execute(...);

// MasterAgent 轉換為字串陣列
const featureImages: string[] = imageResult.data.images
  .slice(1, 7)
  .map(img => img.url);

// 儲存為 JSON 字串
const featureImagesJson = JSON.stringify(featureImages);
```

## 版本歷史

- **v1.0** (2026-01-26): 初始版本,整合 AI 圖片生成(現為 OpenAI gpt-image-2)和 Unsplash
