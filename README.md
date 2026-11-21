# stu-blog

stupienius 的個人部落格（React + Vite + TypeScript）。

## 首頁動畫

首頁是一個 WebGL2 流體模擬（stable fluids）：

1. 白底，一滴墨落下成為一團黑色墨團，慢慢翻攪
2. 墨團先往內收，再猛烈爆開、墨汁炸滿整個畫面，接著被吸回中間，濃縮成 **stupienius**
3. 字停留一下後被釋放，像墨水滴進水裡一樣下沉、捲動、慢慢化開
4. 字開始融化後才開放滑鼠（或手指）攪動水流

首頁頂端中間的「文章」按鈕會進到文章列表。

主要檔案：

- `src/ink/InkFluid.ts`：模擬、時間軸、滑鼠互動
- `src/ink/shaders.ts`：所有 GLSL shader
- `src/components/InkHero.tsx`：React 元件（不支援 WebGL2 時會顯示純文字標題）

可調參數集中在 `InkFluid.ts` 開頭的 `T`（時間軸）與 `CONFIG`（解析度、渦度、墨水濃度、攪動力道等）。

## 開發

```bash
npm install
npm run dev
```

網址加上 `?manual` 時動畫不會自己播放，可在 console 用 `__ink.advance(秒數)` 一格一格前進，方便截圖。

## 部落格與後台（Supabase）

| 網址 | 內容 |
|---|---|
| `/posts` | 文章列表，依張貼日期新到舊，可點標籤篩選（`/posts?tag=標籤`） |
| `/posts/:slug` | 文章內頁（Markdown） |
| `/admin` | 後台：登入、新增／編輯／刪除文章、管理標籤、上傳圖片 |

### 第一次設定

1. 到 [supabase.com](https://supabase.com) 建立專案
2. SQL Editor → 貼上 `supabase/schema.sql` 全部內容 → Run
3. Authentication → Sign In / Providers → 關閉「Allow new users to sign up」（只有你一個人用）
4. Authentication → Users → Add user，建立你的 email + 密碼
5. 回 SQL Editor 執行（換成你的 email），把自己設為管理員：
   ```sql
   insert into public.admins (user_id) select id from auth.users where email = 'you@example.com';
   ```
6. 複製 `.env.example` 成 `.env.local`，填入 Project Settings → API 裡的 Project URL 和 anon key
7. `npm run dev`，打開 `/admin` 登入

權限由資料庫的 RLS 控制：任何人只能讀「已發布」的文章；新增、修改、刪除文章與標籤、上傳圖片都只有 `admins` 表裡的帳號可以做。anon key 本來就是公開的，放在前端沒問題。

### 寫文章

- 內文用 Markdown（支援表格、程式碼高亮等 GFM 語法），寬螢幕左右同時顯示原文與預覽
- 圖片：按「上傳圖片」，或直接貼上／拖進編輯區，會存到 Supabase Storage 的 `post-images` 並自動插入 Markdown
- 張貼日期預設為建立當下，可以手動改；取消勾選「已發布」就是草稿，只有登入後看得到
- 標籤只能從後台「標籤」頁建立的清單中挑

### 部署

這是單頁應用，所有路徑都要回到 `index.html`：已附上 `vercel.json`（Vercel）和 `public/_redirects`（Netlify）。部署時記得在平台的環境變數設定 `VITE_SUPABASE_URL` 和 `VITE_SUPABASE_ANON_KEY`。
