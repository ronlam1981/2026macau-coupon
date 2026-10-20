# 2026 社區消費連環賞小幫手

靜態網頁版個人記錄工具。資料只保存在瀏覽器 localStorage，不與電子錢包同步。

## 本機檢查

在專案目錄啟動任何靜態檔案伺服器，再開啟 `index.html`。核心計算測試位於 `tests/coupon-core.test.js`，使用 Node.js 內建 test runner：

```sh
node --test
```

## 券資料模型

- `government`：政府電子優惠；保留舊資料的 `amount/platform/expiryDate/status` 欄位相容性。
- `merchant_discount`：商戶滿減券；按批次記錄張數 `quantity`、已用張數 `usedCount`、自動有效期及狀態，毋須輸入商戶名稱。
- `merchant_gift`：消費禮遇券；贈品不計入現金節省。

商戶券疊加規則未知時會標示為未知，並排除自動最優計算。規劃方案不會自動核銷或改動記錄。

舊商戶紀錄沒有 `quantity` 時視為 1 張；原有商戶、門檻、優惠、條款、期限及使用狀態保留。毋須搬移或重設 localStorage。新批次只填兩類張數，沿用政府券實際領券日期及補記確認流程，使用同一個 getExpiryISOString 計算下周四澳門時間 23:59:59.999 到期。舊紀錄原有期限（包括未填）不會被猜測或重寫。記錄已用／撤回每次只處理 1 張，並保留操作日誌。

主頁與登記表提供[官方商戶清單及優惠詳情](https://rewards.dsedt.gov.mo/#/website/merchant/index?g=915550)。2026-10-20 已在瀏覽器核實清單可用，列有商戶優惠及「查看更多」完整內容；本工具不複製或推測各商戶優惠。
