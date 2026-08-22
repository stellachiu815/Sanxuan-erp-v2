# 讓 ERP 不睡著（保持清醒）設定說明

## 問題
免費方案的網站，**閒置 15 分鐘就會「睡著」**，下次打開要等大約 50 秒才會醒。
解法：每隔約 12 分鐘「戳」它一下，讓它在你會用的時段保持清醒、隨開隨用。

> 重點：只在**工作時段（台灣早上 6 點～晚上 10 點）**戳，其他時間讓它睡，
> 這樣既好用，又**不會用光免費方案的每月時數**（避免超額被暫停）。

---

## 第一步：先確認你的 GitHub repo 是「公開」還是「私人」

打開這個網址（需要先登入 GitHub）：

**https://github.com/stellachiu815/Sanxuan-erp-v2**

看最上面 repo 名稱「Sanxuan-erp-v2」**右邊的灰色小標籤**：
- 寫 **Public** ＝ 公開 → 用【方法 A】
- 寫 **Private** ＝ 私人 → 用【方法 B】（比較省事、零風險）

---

## 方法 A：公開 repo → 用 GitHub 自動排程（免費、無限）

我已經幫你寫好程式檔了：`.github/workflows/keep-awake.yml`

你只要照平常一樣操作：

1. 打開 **GitHub Desktop**。
2. 它會看到多了 `keep-awake.yml` 這個檔。
3. 填 commit 訊息（例如：`加入自動保持清醒排程`）→ 按 **Commit**。
4. 按 **Push**。

完成！GitHub 會自動在工作時段每 12 分鐘戳一次網站，讓它不睡。

> 想手動測試：到 GitHub repo → 上面「Actions」分頁 → 選「Keep ERP awake」→ 按「Run workflow」。

---

## 方法 B：私人 repo（或想完全零風險）→ 用免費監測服務 UptimeRobot

不吃 GitHub 分鐘、更穩、免寫程式。步驟：

1. 到 **https://uptimerobot.com** → 按 **Register**（用 Email 免費註冊）。
2. 登入後按 **+ Add New Monitor**。
3. 設定：
   - Monitor Type：選 **HTTP(s)**
   - Friendly Name：打 `三玄宮ERP`
   - URL：貼 `https://sanxuan-erp-v2.onrender.com`
   - Monitoring Interval：選 **5 minutes**（免費最短就是 5 分鐘，足夠讓它不睡）
4. 按 **Create Monitor**。完成！

> 它會每 5 分鐘戳一次、24 小時都戳。這樣網站幾乎不會睡。
> （若擔心 24 小時戳會吃 Render 免費時數，可只在需要時開啟監測；一般用量通常還在免費額度內。）

---

## 費用說明（不會被偷收錢）

| 項目 | 會不會多收 | 說明 |
|---|---|---|
| Render 網站 | **不會** | 工作時段戳，月用量遠低於免費 750 小時；頻寬也只用一點點 |
| GitHub Actions（方法 A） | 公開 repo **免費無限**；私人 repo 免費 2000 分鐘 | 私人 repo 若用完，GitHub 預設消費上限 $0，**自動停、不會偷收費**（頂多叫醒功能停、網站又會睡） |
| UptimeRobot（方法 B） | **不會** | 免費方案就夠用，不碰 GitHub 分鐘 |

**結論：不會有人偷偷多收你錢。** 最壞情況只是「叫醒功能停掉、網站又開始睡」，不是收費。

---

## 如果想「永遠不睡、一開就秒開」（要花錢的選項）
把網站升級成 Render 付費方案 **Starter（約 US$7／月）**，它會 24 小時開著、永遠不用等 50 秒。
不急的話，上面的免費方法就夠用。
