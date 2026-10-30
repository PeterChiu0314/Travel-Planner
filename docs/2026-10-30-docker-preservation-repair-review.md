# Docker Desktop 資料保全與修復評估

起點 `87bdca5e26c12886c93260b96651a918aaebc099`，原 feature branch。範圍限 Docker 唯讀盤點、使用者指定獨立磁碟的備份及修復評估；**沒有啟動 Docker、執行安裝／資料位置修復或任何 Budget／Supabase 測試**。承接 [B-7 真服務交接](2026-10-30-budget-b7-service-acceptance-followup.md)。本摘要去除帳號、絕對私有路徑、ACL SID、原始診斷內容與憑證；完整 inventory／manifest 僅留本機私有備份。

## 唯讀確認

| 項目 | 結果 |
| --- | --- |
| Desktop／WSL | Desktop 4.90.0.238679，簽章 Valid；WSL 2.7.13.0，kernel 6.18.33.2-microsoft-standard-WSL2 |
| 停機狀態 | Docker 程序／Engine pipes 未見；唯一已註冊 docker-desktop 為 Stopped。WSL 管理服務與 vmcompute 仍 Running，不代表 distro／Engine 正在運作，未停止這些共享服務 |
| 實際資料位置 | package-private Local/Docker/wsl/disk/docker_data.vhdx；10,782,507,008 bytes；LastWrite UTC 2026-09-09 16:27:55.852453 |
| 必要 WSL 磁碟 | 同 package 的 Local/Docker/wsl/main/ext4.vhdx；100,663,296 bytes；LastWrite UTC 2026-10-30 14:40:16.8134583。**WSL Lxss BasePath 明確指向此位置** |
| 設定 | package-private Roaming/Docker 的 settings-store、install-settings、features-overrides；使用者 Docker CLI／daemon／contexts／buildx／models 設定。原始擁有者、建立／修改時間、大小、ACL SDDL 已記錄於私有 inventory／manifest |
| ACL／讀取 | 原始 ACL 可讀；備份時以 read-only／FileShare.None 開啟 VHDX，確認可獨占讀取，來源 ACL／大小／LastWrite 在操作後再核對。未修改來源權限、未掛載磁碟 |
| 其他位置 | 正常 Windows 視圖的 Local/Docker 資料目錄、Roaming/Docker、ProgramData/Docker、ProgramData/DockerDesktop 未找到對應資料；沒有其他已註冊 distro。另有 package-private Electron UI cache/session，未視為必要 engine 還原資料 |

使用隱藏外部 PowerShell 讀取正常 Windows 路徑視圖，與 Codex 啟動鏈比較：相同 LocalAppData 拼字不能代表相同實體檔案。外部程序能查明確 package socket 的 AF_UNIX tag `0x80000023`，正常路徑不存在；Codex 視圖仍回 error 1920。**socket 損毀並未證實**。Docker vendor registration 在 HKCU／HKLM、32／64-bit 視圖皆缺失；解除安裝登錄也未找到 Docker 項目。這不證明安裝檔缺失，既有簽署執行檔仍在。

範圍限制：只盤點已註冊 distro、已知 Docker 目錄與設定指向，沒有掃描全機所有磁碟或掛載 VHDX。因此不能保證沒有離線／自訂資料磁碟；Engine 無法啟動，container、volume 與外部 bind-mount 的清單／完整性仍未知，不能宣稱已完成所有工作負載的應用層備份。

## 備份方法與限制

使用者明確指定獨立磁碟並授權新建備份資料夾。確認該目的地 NTFS、可用 459,546,611,712 bytes，與來源為不同實體磁碟，預計檔案總量 10,883,171,513 bytes。目的地固定為全新資料夾、拒絕覆寫既有資料；備份 ACL 僅允許目前使用者、SYSTEM 與 Administrators。

由外部程序處理明確實體來源；每檔先檢查停機、使用唯讀獨占 handle 計算來源 SHA-256，再複製到 CreateNew 目的檔、flush、重新讀取備份計算 SHA-256，核對大小及 hash；原始 VHDX／設定保持原地。保存必要設定、WSL BasePath／版本、原始 ACL 與檔案時間，敏感內容不進 Git。狀態結果以本機 private manifest 為準。

**完成：12/12 檔案來源／備份大小與 SHA-256 相同，總計 10,883,171,513 bytes。** 兩個 VHDX 與每檔來源 LastWrite／大小／ACL 核對未變；完成時 Docker／相關 WSL 仍停止。另保存兩份私有 metadata inventory。沒有掛載、覆寫或修改原始檔案。完整檔案清單、SHA-256 與備份路徑只在本機 `backup-manifest.private.json`；不將私有絕對路徑或 ACL 提交 GitHub。

未備份：可重裝的 CLI plugin binaries、暫存 socket／lock／cache、Electron 瀏覽／登入工作階段及 telemetry／診斷日誌；Windows Credential Manager 等 OS 憑證儲存未匯出，日後可能需重新登入。未註冊或外部 bind-mount 資料無法在此保證涵蓋。備份應保留為 master，後續工作使用另一份複本，不能拿唯一備份直接當活動磁碟。

**Hash 相同只證明已選檔案位元一致，沒有證明檔案系統健康、container 可啟動或 Docker 可還原。** 未做 mount、fsck、啟動或 restore 演練。

## 原因：確認與推測分開

- 已確認：先前 Desktop 日誌／截圖有 socket rename error 1920；本輪可重現兩種 AppData 視圖差異。一般桌面先前顯示缺 Docker 登錄，本輪正常視圖仍缺此登錄。WSL 自己的 BasePath 也已落在 package-private 路徑。
- 合理推測：MSIX 虛擬化／啟動邊界參與 socket 存取故障；Microsoft 的 [packaged app 行為](https://learn.microsoft.com/en-us/windows/msix/desktop/desktop-to-uwp-behind-the-scenes) 說明這類 AppData／HKCU 寫入可被重新導向。但未證明這是唯一 Windows socket 原因。
- 尚未證實：原安裝如何失去正常桌面登錄、資料是否都在所選 VHDX、哪個 Docker／Codex 更新必然修好；沒有證據支持刪 socket、重建 registry 或換空白磁碟。

## 修復方案比較（僅評估）

| 方案 | 安全性／資料風險 | 可逆性／權限 | 建議 |
| --- | --- | --- | --- |
| 保留備份，向官方確認既有 per-user 安裝的保留資料修復／升級與跨 namespace 採用流程 | 不動現況風險最低；支援回覆不能自行假設 | 本輪無系統變更；詢問／下載不需管理員，實際執行另定 | **首選準備路徑**；未傳送報告或日誌 |
| 普通桌面使用官方簽署 installer，維持 per-user／WSL2，經確認後就地修復／更新 | 可由 installer 正式重建安裝資訊；但缺失登錄可能令其誤判全新安裝並產生另一磁碟／改 schema。沒有可確認的通用 `repair` 旗標，不能聲稱無損 | per-user 通常不需 admin；WSL／系統設定可能需要。二進位降版不等於磁碟／WSL 狀態可回退 | **有條件推薦**，須先有版本專屬明確方案與授權 |
| 正式安裝後，以官方支援的資料位置／還原流程採用工作複本 | 能避免繼續依賴 Codex package；但目前 WSL BasePath 仍在原位置，單指向 data-root 不代表會採用既有磁碟。新建空白資料庫不能視為資料恢復 | 需完整映射、停機與 rollback；WSL 註冊／遷移可能需 admin，涉及修改須另授權 | 只能是經審閱的後續還原方案；不掛接 master、不覆寫原檔 |
| Uninstall／reinstall 或轉 all-users／MSI | 官方警示 uninstall 會毀損本機 Docker 資料；模式切換需解除安裝，風險較高 | all-users 要 admin；撤回安裝也不能恢復既有狀態 | 非首選；另備份／還原演練與單獨授權後才討論 |
| Registry hack、刪 socket、改 MSIX manifest、WSL unregister／reset | 不保證解決 namespace；可能丟資料／權限／註冊 | 難逆轉，有些需 admin | 不採用，不提供試探命令 |

依據 [官方 Windows 安裝文件](https://docs.docker.com/desktop/setup/install/windows-install/)，per-user 使用 HKCU、all-users 使用 HKLM，兩種安裝權限不同；官方有 data-root 選項，但它僅定義預設位置，**沒有保證會匯入這個 package-private 既有磁碟**。不要把第一次乾淨啟動當作已還原，也不要在 UI 選取 Replace existing image。

## ChatGPT Review 前的下一步

1. 審閱本機備份 manifest、兩個 VHDX hash、必要設定與未涵蓋項目；保留原始資料及唯一備份，重要資料可另規劃第二份離線備份。
2. 確定修復版本／官方簽章與 checksum、原 per-user 模式，向官方確認缺失登錄時的非破壞性處理；不要用未記載 repair command 或直接跑 installer 測試。
3. 先明定工作複本的使用位置、WSL BasePath／data-root 如何一致、禁止覆寫原檔／master／replace、安裝後首啟動停損條件及復原方案。**本輪尚未證實可零移動直接採用原磁碟**。
4. 取得安裝修復／工作複本／WSL 註冊或資料位置變動的逐項授權後才執行。本次到資料備份與方案評估為止，停止等待 ChatGPT Review；不延伸為 Budget 驗收或 Hosted 操作。

參考：[無法啟動時備份](https://docs.docker.com/desktop/settings-and-maintenance/backup-and-restore/)、[解除安裝的資料損失警示](https://docs.docker.com/desktop/uninstall/)。官方要求停機後保存實際位置的 VM disk；不是只照抄預設 LocalAppData 路徑。官方文件沒有直接涵蓋本機這種 package namespace＋缺失安裝登錄的完整恢復案例。
