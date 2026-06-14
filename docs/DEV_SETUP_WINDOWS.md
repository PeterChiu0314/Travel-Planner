# Windows 開發環境設定

本文件記錄在 Windows / PowerShell 環境開發本專案時的注意事項。

這不是網站功能規格，也不是所有電腦都必須套用的設定。

如果你的 Windows 環境沒有中文亂碼、PowerShell 執行 npm 正常、Vite dev server 可穩定啟動，可以不用套用全部設定。

---

## 1. 適用情境

當出現以下狀況時，請參考本文件：

- PowerShell / Codex 顯示中文亂碼
- `Get-Content src\App.jsx` 讀到中文亂碼
- Codex 用中文 UI 字串 patch 時找不到位置
- `npm -v` 被 PowerShell Execution Policy 擋住
- Vite dev server 背景啟動不穩定
- `Start-Job` 或背景 process 啟動後退出
- 無法穩定進行自動瀏覽器互動驗證

---

## 2. 中文亂碼原因

本專案檔案主要使用 UTF-8。

在部分繁體中文 Windows / PowerShell 環境中，PowerShell 可能混用：

```text
chcp 950 / Big5
InputEncoding Big5
OutputEncoding UTF-8
$OutputEncoding US-ASCII
```

這會導致 UTF-8 無 BOM 檔案被錯誤解讀，出現中文亂碼。

常見現象：

```powershell
Get-Content src\App.jsx
```

可能顯示中文亂碼。

但指定 UTF-8：

```powershell
Get-Content src\App.jsx -Encoding UTF8
```

則顯示正常。

這代表檔案本身通常沒有壞，只是 PowerShell 讀取時使用了錯誤編碼。

---

## 3. PowerShell UTF-8 Session 設定

每次開新的 PowerShell / Codex terminal 時，建議先執行：

```powershell
chcp 65001
[Console]::InputEncoding = [System.Text.Encoding]::UTF8
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$OutputEncoding = [System.Text.Encoding]::UTF8
```

之後讀中文檔案時，建議明確指定 UTF-8：

```powershell
Get-Content src\App.jsx -Encoding UTF8
```

不要用未指定 encoding 的 `Get-Content` 來判斷中文內容是否正確。

---

## 4. Git UTF-8 設定

建議設定：

```bash
git config --global core.quotepath false
git config --global i18n.commitEncoding utf-8
git config --global i18n.logOutputEncoding utf-8
```

檢查設定：

```bash
git config --global core.quotepath
git config --global i18n.commitEncoding
git config --global i18n.logOutputEncoding
```

期望：

```text
false
utf-8
utf-8
```

---

## 5. npm / PowerShell Execution Policy

在部分 Windows PowerShell 環境中，直接執行：

```powershell
npm -v
```

可能會被 Execution Policy 擋住，因為 PowerShell 會嘗試執行 `npm.ps1`。

本專案在 Windows 上建議使用：

```powershell
npm.cmd
```

例如：

```powershell
npm.cmd install
npm.cmd run build
npm.cmd run dev
```

不要直接使用：

```powershell
npm
```

---

## 6. Vite dev server 啟動方式

本專案在 Windows / PowerShell 環境下，建議以前景方式啟動 Vite dev server。

建議指令：

```powershell
npm.cmd run dev -- --host 127.0.0.1 --port 5174
```

成功後，手動開啟：

```text
http://127.0.0.1:5174/demo/timeline
```

如果 5174 被占用，可改用：

```powershell
npm.cmd run dev -- --host 127.0.0.1 --port 5175
```

---

## 7. 檢查 port 是否被占用

```powershell
netstat -ano | findstr :5174
netstat -ano | findstr :5173
```

若有殘留 process，請先確認 PID 對應的是 Vite / Node dev server，再決定是否終止。

不要在不確定的情況下亂 kill process。

---

## 8. 關於背景啟動 / 自動瀏覽器驗證

部分 Windows / Codex / PowerShell 環境中，背景啟動可能不穩定，例如：

- `Start-Job` 權限或 session 限制
- 背景 process 啟動後退出
- Codex 無法穩定保留 Vite dev server
- 自動瀏覽器互動驗證失敗

如果發生這種情況，不要花太多時間硬繞背景 process。

建議採用：

```text
前景 dev server + 使用者手動瀏覽器驗證
```

流程：

1. 執行 build。
2. 前景啟動 dev server。
3. 回報 local URL。
4. 由使用者手動開啟 `/demo/timeline` 或正式頁面測試。

---

## 9. Codex 修改中文 UI 時的注意事項

在 Windows / PowerShell 中文編碼尚未完全穩定前，Codex 不應依賴中文 UI 字串作為唯一 patch 錨點。

避免只搜尋中文文案，例如：

```text
備案
使用此備案
點擊右下角翻卡建立備案
```

請優先使用：

- function name
- component name
- className
- prop name
- state name
- variable name
- English identifier
- JSX 結構
- line range

若必須確認中文內容，請用：

```powershell
Get-Content path\to\file -Encoding UTF8
```

---

## 10. 建議診斷指令

遇到亂碼或 dev server 問題時，可先回報以下資訊：

```powershell
chcp
[Console]::InputEncoding
[Console]::OutputEncoding
$OutputEncoding
git config --global core.quotepath
git config --global i18n.commitEncoding
git config --global i18n.logOutputEncoding
node -v
npm.cmd -v
```

確認檔案 UTF-8：

```powershell
Get-Content src\App.jsx -Encoding UTF8 -TotalCount 20
```

檢查 build：

```powershell
npm.cmd run build
```

啟動 dev server：

```powershell
npm.cmd run dev -- --host 127.0.0.1 --port 5174
```

---

## 11. 不要放入本文件的內容

本文件不可放入：

- `.env`
- Supabase key
- service role key
- private token
- 本機帳號密碼
- 私人資料
- 不必要的本機絕對路徑

---

## 12. 總結

Windows / PowerShell 開發時，建議固定使用：

```powershell
chcp 65001
[Console]::InputEncoding = [System.Text.Encoding]::UTF8
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$OutputEncoding = [System.Text.Encoding]::UTF8
npm.cmd run build
npm.cmd run dev -- --host 127.0.0.1 --port 5174
```

若自動瀏覽器驗證不穩定，請改採：

```text
build 通過 + 前景 dev server + 使用者手動驗證
```
