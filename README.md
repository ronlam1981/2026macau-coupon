# 2026 社區消費連環賞小幫手

靜態網頁版個人記錄工具。資料只保存在瀏覽器 localStorage，不與電子錢包同步。

## 本機檢查

在專案目錄啟動任何靜態檔案伺服器，再開啟 `index.html`。核心計算測試位於 `tests/coupon-core.test.js`，使用 Node.js 內建 test runner：

```sh
node --test
```

## 券資料模型

- `government`：政府電子優惠；保留舊資料的 `amount/platform/expiryDate/status` 欄位相容性。
- `merchant_discount`：商戶滿減券；記錄商戶、門檻、優惠內容、有效期、條款及狀態。
- `merchant_gift`：消費禮遇券；贈品不計入現金節省。

商戶券疊加規則未知時會標示為未知，並排除自動最優計算。規劃方案不會自動核銷或改動記錄。
