# Docker 原 per-user 安裝修復＋資料工作複本方案

起點 `1ba0482a3d73ebd315dfd2e7f905e211b8d2e22c`。本輪只準備方案、唯讀檢查與查閱官方文件；**沒有執行 Installer（包括 --help）、啟動 Docker、建立資料工作複本、修改 Registry／WSL 註冊或資料位置**。原始磁碟與已驗證備份保留，等待 ChatGPT Review。前次備份範圍及限制見 [保全報告](2026-10-30-docker-preservation-repair-review.md)。個人絕對路徑、ACL、設定內容及原始日誌不進 Git。

## 官方支援範圍與尚缺的確認

| 問題 | 已確認 | 本機適用結論 |
| --- | --- | --- |
| 維持 per-user 安裝 | 官方 EXE 支援 per-user／WSL2；通常不需管理員 | 維持同一使用者、EXE、WSL2；不轉 all-users／MSI |
| 官方 Repair 命令 | 查閱的 Windows 安裝文件未列出通用 repair 旗標 | 不猜測參數、不執行 installer 來試探；未確認可無損修復 |
| 就地 install／update 能否修復缺失登錄 | 官方文件沒有保證缺失 HKCU、無 uninstall registration 時會辨識為既有安裝，或不重設 WSL | **仍未確認**；不能當作可安全執行的已驗證方案 |
| `uninstall --keep-data` | 官方企業部署 FAQ 記載 EXE 可保留底層 VM，作為轉 MSI 的程序之一 | 這是 uninstall，不是 Repair；不採用、不執行。不能保證本機跨 namespace 及缺失登錄案例適用 |
| 資料 root／還原 | 官方提供預設 WSL data-root 選項與停機 VM disk 備份／還原說明 | 沒有保證它會採用 package-private 磁碟；不能據此改原始路徑或覆寫新檔 |
| 本機可用 Installer | 既有 Installer EXE 與 InstallerCli 為 4.90.0.238679、Authenticode Valid | 僅 metadata 檢查，沒有執行。尚未確認本機 Installer 包含完整安裝 payload，也未與官方完整下載包 checksum 比對 |

本輪重新核對私人備份 manifest：12 筆 verified，manifest SHA-256 與前次一致；兩個原始 VHDX 的大小／LastWrite 與前次一致。沒有重算 10.88 GB 全部內容的 hash，也沒有重作備份或還原認證；前次逐檔 hash 證據仍保留。WSL BasePath 指向 package-private main 的證據來自前次外部唯讀 inventory，本輪沒有改動它。

官方來源：[Windows 安裝](https://docs.docker.com/desktop/setup/install/windows-install/)、[企業部署 FAQ](https://docs.docker.com/desktop/enterprise/enterprise-deployment/faq/)、[備份／還原](https://docs.docker.com/desktop/settings-and-maintenance/backup-and-restore/)。FAQ 的 keep-data 補充不改變前次對一般 uninstall 的禁止與資料損失警示。

## 保留三份不同用途的資料

| 身分 | 位置／內容 | 後續使用規則 |
| --- | --- | --- |
| 原始資料 | 既有 package-private data VHDX、main VHDX、設定與 WSL 註冊 | 保留原地；不 mount、搬移、改 ACL、覆寫、壓縮或拿來啟動／升級 |
| 備份 master | 已核對的獨立磁碟專用備份資料夾，12 檔約 10.88 GB，含私人 manifest／ACL inventory | 保持完整；不交給 Docker、不作 data-root、不覆寫、不從中執行程式。可唯讀用於比對，不能變成活動磁碟 |
| 額外工作複本 | **擬議**在已指定備份磁碟建立另一個同層專用資料夾，與 master／原始路徑無包含關係；完整複製兩個 VHDX 與必要設定 | 尚未建立；只有它可在後續明確授權後被採用或遷移。啟動後可能改格式／內容，須另存變更紀錄，不能再假稱與 master 相同 |

工作複本準備規格：在一般 Windows 視圖、確認 Docker／相關 distro 停止，以明確實體路徑**唯讀複製原始資料**；每檔使用新檔建立、拒絕覆寫，以 SHA-256／大小比對前次 master manifest。來源不一致或無法獨占讀取就停止，不更新 master 來掩蓋差異。保存各路徑映射、原始 ACL／時間戳及新目的地 ACL，限制敏感設定存取；不盲目套回原磁碟的 VM／package SID 到新位置。

至少需額外容納約 10.88 GB 完整工作複本，另預留安裝包、還原 staging 與磁碟增長空間；執行前重查實際容量，不能沿用前次 free-space 數字作通行證。若必須另有活動副本，還需再一份磁碟容量。備份與工作複本若放同一實體磁碟，只能隔離操作失誤，不能防範該磁碟本身故障。

## 建議的執行順序與停止條件

| 順序 | 未來動作（本輪未執行） | 必要證據／停止條件 |
| --- | --- | --- |
| 1 | 取得版本專屬的官方處理說明 | 必須明確說明「登錄不存在時」的識別、WSL 操作、是否自動啟動／初始化，以及保留資料的條件；一般安裝成功說明不足 |
| 2 | ChatGPT Review 確認目標版本、EXE/per-user/WSL2 及完整操作清單 | 同版本重裝也不能假定無損；較新版本須審閱 migration／已知問題。不要因有新版就自動升級 |
| 3 | 另行授權後，建立／驗證額外工作複本 | 全部檔案比對 manifest 通過；原始及 master 維持保留；工作複本不是 symbolic link／junction 指回原始檔 |
| 4 | 明定 installer 與既有 WSL BasePath 的隔離方法 | 目前註冊仍指原始 main；只做好複本並不能防 installer 改原始資料。若官方流程可能寫原始磁碟、unregister 或 initialize，本方案不得直接執行，須另提隔離還原／註冊計畫和授權 |
| 5 | 普通 Windows 桌面執行經核對的官方安裝修復程序 | 從原使用者桌面／非 MSIX PowerShell 執行；Codex 只提供步驟，不透過其子程序或 WMI 啟動 Installer／Docker。per-user 不使用 SYSTEM；異常要求切換模式、刪資料、reset 或 replace 就停止 |
| 6 | 安裝後先唯讀檢查，不立即啟動 | installer 重建的登錄位置、安裝身分、設定、data-root、WSL BasePath 必須與核准映射一致。若 installer 自動啟動無法避免，必須事前把風險及隔離方法納入授權，不能靠事後停止保護原始資料 |
| 7 | 以官方支援方法採用工作複本，再另行授權首次啟動 | 不能手改 Registry；不能使用 master；不能盲目 import-in-place 代替 Docker 正式註冊，也不能隨意同名註冊覆蓋現有 distro。若需額外 WSL 變動，另出 before/after 與回復方案 |
| 8 | 首次只驗證 Docker 資料恢復 | 核對原有 containers／volumes／images 與關鍵資料；遇到空白列表不能宣稱恢復，不執行 prune／cleanup。首次寫入只能落到工作複本；本次不延伸到 Budget／Supabase |

**重要風險：** 原始 WSL 註冊仍指 package-private main。安裝修復與資料採用的先後順序不是可以任意交換的兩個步驟；必須先證實 installer 不會透過舊註冊寫入原始磁碟，否則停在規劃階段。備份本身不等於已達成這項隔離。

官方 [release notes](https://docs.docker.com/desktop/release-notes/#4950) 記載曾修正 data-root 位於安裝目錄時的升級刪磁碟問題；因此未來工作／活動資料位置須在安裝目錄與 Codex package 之外。這個特定修正不能證明本機 socket／登錄故障已被解決。撤回二進位版本也不能自動回復改過的 WSL 註冊或升級過的磁碟。

## 可直接交給官方的去敏詢問草稿

尚未傳送；不附日誌、個人路徑、磁碟內容或密鑰。

> Windows per-user Docker Desktop 4.90.0.238679 的 signed EXE／Installer 仍存在，但一般桌面 HKCU Docker vendor registration 與 uninstall registration 均缺失。先前啟動遇到 missing backend registry；從 packaged development app 啟動則遇到 AF_UNIX ingest socket rename/access error。資料與既有 docker-desktop WSL2 BasePath 位於 packaged app 的 private AppData。Docker／distro 已停止，data VHDX、main VHDX 及設定已做獨立且 hash 一致的備份。
>
> 1. 哪個受支援的 EXE 版本／程序可以修復這種缺失登錄的既有 per-user 安裝，而不先 uninstall？是否確實存在 Repair 選項？
> 2. 安裝程式在 registration 缺失時如何辨識既有安裝？是否會 unregister、重建、格式化、改動 WSL 或自動啟動 backend？能否確保不接觸原始兩個磁碟？
> 3. 如何在原資料及備份保留的前提下，正式採用額外工作複本？data-root 選項是否只設定新磁碟，如何安全處理現有 BasePath？
> 4. 是否有不會自動啟動／初始化資料的受支援安裝方式，以及實際變更範圍與恢復步驟？
> 5. `uninstall --keep-data` 是否支援此缺失登錄／跨 package-path 案例？僅詢問相容性，並未授權執行 uninstall。

## 目前決策

**方案已準備；Installer 的本機無損修復適用性仍待確認，執行 NO-GO。** 首選維持原 per-user／WSL2，以官方可證明保留資料的修復程序處理安裝資訊；有需要才採用另建工作複本，不直接操作唯一備份。若官方無法保證現有 WSL 註冊不觸及原始磁碟，改提獨立隔離還原方案，不能現場試 installer／Registry workaround。

下一筆授權需具體涵蓋：工作複本確切目的地與複製、指定 installer 版本／hash／執行方式、是否容許 installer 寫入既有註冊、資料採用／WSL 變動、首次啟動。這些目前都未執行；沒有發出官方支援訊息或重跑功能測試。
