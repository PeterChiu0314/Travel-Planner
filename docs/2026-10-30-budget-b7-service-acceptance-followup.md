# Issue #15 B-7 — 真服務補驗與 Docker 診斷交接

補驗起點／確認 HEAD：`a28232ebc051c40c0741907d4e1c44a55f1df701`，原分支 `codex/budget-collaboration-redesign`。本文件延續 B-7，不另設階段。僅修改本機 QA runner／新增安全查核；沒有產品、migration、UI 或預設旗標變更。歷史已通過功能沒有重跑。

**結論仍為 Blocked／NO-GO。** 本機 CLI Advisor 的 TLS 阻擋已排除；Docker Desktop 仍不能提供 Engine，因此不能開始真 Supabase Auth／PostgREST／Realtime／Storage 或 Worker 排程驗收。沒有以 SQL fixture、Mock 或 Service Role 代替它們。即使日後本機全部通過，也先提交 ChatGPT Review，再取得明確上線授權。

## Docker／WSL 診斷結果

| 項目 | 實測結果 |
| --- | --- |
| Docker | CLI 29.7.2；Desktop 4.90.0.238679；執行檔 Docker Inc. Authenticode 有效 |
| WSL | 2.7.13.0、kernel 6.18.33.2-microsoft-standard-WSL2；唯一發行版 docker-desktop 為 WSL2 |
| WSL kernel 啟動 | `wsl -d docker-desktop -- uname -r` 成功；不能據此說 Docker Engine 正常 |
| Desktop 在原環境啟動 | 2026-10-30 14:40:52 UTC backend 仍因 sailor-ingest.sock rename 的 Windows error 1920 結束 |
| 一般桌面啟動 | 使用 Explorer 啟動既有簽署執行檔後，另出現 `getting backend binary path: cannot find registry key SOFTWARE\Docker Inc.\Docker Desktop`；使用者截圖與本機檢查相符 |
| 登錄檢查 | 一般外部 PowerShell 的 HKCU／HKLM `Software\Docker Inc.\Docker Desktop` 均不存在；沒有寫入登錄或猜測 backend path |
| Engine | Linux Engine named pipe 不存在；無法盤點現存 containers／volumes，因此不能假設沒有其他專案資料 |
| 收尾 | Docker processes 未見仍在執行；docker-desktop 回到 Stopped。沒有 global WSL shutdown、reset、prune、unregister、volume/socket 刪除或 VHDX 移動 |

### 已證明的路徑差異

透過 WMI 建立非互動、隱藏的外部 PowerShell，僅讀取指定路徑、reparse tag、ACL、檔案 metadata 與登錄存在性；報告寫回本機 ignored 目錄。一般直接子程序不足以證明已脫離原有路徑視圖，故以兩個外部讀取 probe 對照：

- Codex 啟動鏈看到 `%LOCALAPPDATA%\Docker\run\sailor-ingest.sock`，存取其 reparse／ACL 失敗，error 1920。
- 外部程序看到一般 `%LOCALAPPDATA%\Docker\run`、`Docker\wsl`、`Docker\wsl\disk` **不存在**。
- 外部程序可讀取明確實體路徑 `%LOCALAPPDATA%\Packages\OpenAI.Codex_2p2nqsd0c76g0\LocalCache\Local\Docker\run\sailor-ingest.sock`，`fsutil reparsepoint query` 成功，tag=`0x80000023`（Windows AF_UNIX）。不能把它當作已證明損毀的 socket 而刪除。
- 同一 package 私有路徑的 `Docker\wsl\disk\docker_data.vhdx` 為 **10,782,507,008 bytes**，最後寫入時間 **2026-09-09T16:27:55.8524530Z**；診斷期間觀察值未變。`Docker\wsl\main\ext4.vhdx` 為 100,663,296 bytes，WSL kernel 測試啟動後寫入時間更新。這不是資料磁碟內容／完整性或可恢復性驗證。

這些觀察證明 Codex／一般桌面的 AppData 視圖不同，強烈支持 MSIX 重新導向參與 socket 啟動故障；一般桌面另有安裝登錄缺失。尚未確定登錄缺失的安裝歷史原因，也沒有證明升級單一軟體即可修好。不要直接複製網路上的 registry 值、改 Codex manifest 或把 VHDX 搬到一般目錄後重試。

### 已嘗試的安全步驟與停止原因

1. 檢查版本、簽章、WSL／Engine、精確 socket 與 backend 日誌；使用官方支援的 WSL kernel 診斷。
2. `docker desktop diagnose` 完整成功（142 gatherers），**沒有 `--upload`**。bundle 與原始日誌僅留本機，不提交／上傳。
3. Shell COM 啟動仍重現 socket 故障，停止該失敗 Desktop；Explorer 啟動遇到缺少登錄的另一阻擋。沒有反覆強啟動。
4. 外部 read-only probes 確認 namespace／VHDX／registry 差異。結束時 Desktop／WSL stopped，未修改既有資料。

下一步涉及安裝修復與資料 namespace 的一致化，可能產生另一個空白資料磁碟或讓原資料失聯，因此依使用者「可能造成資料遺失時停止並回報」限制停下。尚未備份／修復／重裝，不宣稱已修好。建議先依 [Docker 官方無法啟動時的備份程序](https://docs.docker.com/desktop/settings-and-maintenance/backup-and-restore/)：在 Desktop 完全停止後，規劃足夠空間、可驗證 hash 的獨立備份，來源必須是上述**實際 package 路徑**的 VHDX 與相關設定；確認備份可讀、還原位置與保留策略後，再審閱官方安裝修復方案並另取授權。不得先刪原檔、reset 或 uninstall 來嘗試解決。

官方診斷參考：[Docker troubleshooting](https://docs.docker.com/desktop/troubleshoot-and-support/troubleshoot/)、[WSL diagnostics](https://docs.docker.com/desktop/troubleshoot-and-support/troubleshoot/topics/)。[Codex issue #52698](https://github.com/openai/codex/issues/52698) 為相符的使用者回報，僅供線索，不視為官方已確認本機原因或修復保證。

## 本次安全查核與 TLS 修正

新增重現命令：

```powershell
node scripts/qa/run-budget-metadata-parallel.mjs --security-audit --tls --advisors
```

使用既有 PG17.11 runtime／node-postgres／Supabase CLI 2.106.0；`BUDGET_TEST_OPENSSL` 可指定 OpenSSL（Windows 預設 Git for Windows 的 OpenSSL）。每次新建 loopback-only cluster，產生一天有效、含 localhost／127.0.0.1 SAN 的自簽 TLS certificate。node-postgres 以該 CA、`rejectUnauthorized=true` 驗證，CLI URL 使用 `sslmode=verify-full`／專用 `sslrootcert`。不關閉 TLS 驗證、不安裝系統 CA、不使用 Hosted URL；證書／私鑰只在 ignored runtime，cluster 最後停止。

**新增 9/9 通過**：實際 connection 的 TLS／CA 身分、七組 protocol 與 content attestation 預設關閉、private RLS／grants／publication、財務資料表 trip-bound RLS、public RPC invoker／anon execute、private definer search_path／PUBLIC execute、專用 Worker 角色／精確 Storage catalog policies、Preflight／Readback、protocol／effect／parent triggers。只做這九項新查核，沒有重跑歷史 race／UI 功能套件。完整 chain 是新 cluster bootstrap 的必要依賴，不是宣稱所有歷史案例又通過。

CLI `db advisors --type all --fail-on none` **實際成功**，64 WARN、0 ERROR：

| 分類 | 數量 | 分級／處置 |
| --- | --- | --- |
| auth_rls_initplan | 48 | P2 既有效能建議；與目前授權漏洞或資料遺失無等價關係，沒有為本輪改寫無關 RLS |
| multiple_permissive_policies | 12 | P2 既有效能建議；實際權限仍由政策／trigger 契約查核，不因 WARN 自動判定安全 |
| extension_in_public | 1 | P2 既有 pgcrypto 位置；完整 Supabase extensions schema／權限部署仍須真服務比較，不在此搬動既有 extension |
| function_search_path_mutable | 3 | budget_test.await_gate／hold_result／revoke_member，僅原生 QA bootstrap fixture 的 invoker helpers，沒有在產品 migration 建立；與產品 private definers 分開記錄 |

沒有新的已重現產品 P0/P1；**P1-GATE 環境／真 HTTP 未驗收仍阻擋上線**。Advisor 的零 ERROR 不是安全零風險宣告。CLI `migration list` 成功連線，但 native runner 逐檔直接套 SQL，沒有 Supabase managed migration ledger，輸出 Remote 欄為空；因此只證明 CLI TLS／列示可執行，**不能當作 remote history 對齊**。

實際 Supabase 的 managed auth/storage schema、HTTP RLS、JWT custom-role/header forwarding、Realtime publication／Auth 撤權與 Storage bytes 仍不在此查核範圍。Preflight／Readback 為本輪實跑；Activation／Pause 的舊原生 gate 證據保留且不重跑，真服務 Activation／Readback／Pause 仍 Blocked，所有新旗標／protocol 保持 default off。

## 補驗矩陣與證據

| 項目 | 狀態 | 本輪證據／限制 |
| --- | --- | --- |
| Docker 非破壞性診斷 | Passed（診斷），Blocked（修復） | 外部路徑 probe、官方本機 bundle、WSL uname；安裝／資料位置修復未執行 |
| 新增 TLS／catalog 安全查核 | Passed | 9/9，新 loopback TLS cluster，實際 CLI Advisor 成功 |
| 完整 Supabase Security Advisor／migration ledger 對齊 | Blocked | 只完成原生 catalog／CLI adapter，無實際服務 |
| 真雙帳號九情境／獨立 Auth Session／Playwright | Blocked | 未建立 Supabase，零真實服務案例執行；不重跑 Mock 當補驗 |
| Receipt upload／replace／delete／signed URL／RLS／bytes | Blocked | 無隔離 Storage HTTP endpoint，零 HTTP 驗收 |
| 專用 Worker JWT／headers／兩輪排程／restart／timeout | Blocked | 無真 Storage／PostgREST，未啟動 Worker 排程；沒有 Service Role 替代 |
| 真服務 Preflight／Activation／Readback／Pause | Blocked | 僅原生 Preflight／Readback 新實跑；不偽造 attestation 啟用 |
| Production build／必要 syntax／diff | Passed | 見本輪 QA JSON；只修改 QA／文件 |

選定且去敏的證據：[service follow-up JSON](qa/2026-10-30-budget-b7-service-followup.json)。原始 probe／bundle／runtime／keys 不進 Git。[原驗收矩陣](2026-10-30-budget-b7-integration-acceptance.md) 保留舊證據範圍，這份補驗不把 DB／受控 UI 更名為真服務。

## 下一步與授權邊界

1. 先審閱本機 Docker 資料備份／安裝修復計畫、風險與備份目的地；涉及資料 namespace／重裝的操作另取明確授權。現有非破壞性授權不延伸為自動 reset／registry hack／搬移資料。
2. Docker 安全恢復後，在現有本機隔離授權內啟動專用 Supabase，再補原矩陣 H01–H03 與真服務操作程序；只建隔離帳號／bucket／檔案，使用專用 Worker JWT，觀察兩輪排程與故障恢復。
3. **本輪不得改用 Hosted 繞過阻擋**。不建立收費專案、不碰既有正式資料／Storage／RLS／排程，也不申請把正式服務當測試用。
4. 本機全部通過後先回報 ChatGPT Review，再列出待授權 Hosted migration／Storage／JWT secrets與排程／flags／部署操作及風險；main merge、Production 部署／啟用仍需另外明確同意。
