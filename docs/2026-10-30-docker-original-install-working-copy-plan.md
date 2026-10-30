# Docker 原 per-user 安裝修復＋資料工作複本方案

起點 `1ba0482a3d73ebd315dfd2e7f905e211b8d2e22c`。本輪只準備方案、唯讀檢查與查閱官方文件；**沒有執行 Installer（包括 --help）、啟動 Docker、建立資料工作複本、修改 Registry／WSL 註冊或資料位置**。原始磁碟與已驗證備份保留，等待 ChatGPT Review。前次備份範圍及限制見 [保全報告](2026-10-30-docker-preservation-repair-review.md)。個人絕對路徑、ACL、設定內容及原始日誌不進 Git。

2026-10-30 Review 補強自 `ec96a2c8500ebd3bd1c729cb0ed509032be904af` 接續。**文件規劃有條件通過，所有實際執行 NO-GO。** 本版補足 P0 原始 WSL 隔離、四步恢復與 P1 Installer 證據；後文替代前版未定義的隔離／採用細節，不構成執行授權。Budget B-7 維持 BLOCKED。

## 官方支援範圍與尚缺的確認

| 問題 | 已確認 | 本機適用結論 |
| --- | --- | --- |
| 維持 per-user 安裝 | 官方 EXE 支援 per-user／WSL2；通常不需管理員 | 維持同一使用者、EXE、WSL2；不轉 all-users／MSI |
| 官方 Repair 命令 | 查閱的 Windows 安裝文件未列出通用 repair 旗標 | 不猜測參數、不執行 installer 來試探；未確認可無損修復 |
| 就地 install／update 能否修復缺失登錄 | 官方文件沒有保證缺失 HKCU、無 uninstall registration 時會辨識為既有安裝，或不重設 WSL | **仍未確認**；不能當作可安全執行的已驗證方案 |
| `uninstall --keep-data` | 官方企業部署 FAQ 記載 EXE 可保留底層 VM，作為轉 MSI 的程序之一 | 這是 uninstall，不是 Repair；不採用、不執行。不能保證本機跨 namespace 及缺失登錄案例適用 |
| 資料 root／還原 | 官方提供預設 WSL data-root 選項與停機 VM disk 備份／還原說明 | 沒有保證它會採用 package-private 磁碟；不能據此改原始路徑或覆寫新檔 |
| 本機可用 Installer | 既有 Installer EXE 與 InstallerCli 為 4.90.0.238679、Authenticode Valid | 本輪已比較同名本機 EXE 與官方完整包的 hash，兩者不同；完整安裝媒體仍未下載／驗證，也沒有執行任何元件 |

### P1：版本、完整性及自動啟動的查證

- 已讀取官方 [4.90.0 release notes](https://docs.docker.com/desktop/release-notes/#4900) 與其指向的 [Windows amd64 build 238679 checksum](https://desktop.docker.com/win/main/amd64/238679/checksums.txt)。完整下載包 `Docker Desktop Installer.exe` 的 SHA-256 為 `2ecc54255702ffbf2e2779cb35ebecde535a0b31e4223171be2195dc318ebd3d`。
- 本輪唯讀重查已安裝目錄內同名 EXE：4.90.0.238679、6,892,976 bytes、Authenticode Valid／Docker Inc.；SHA-256 為 `36a5b4c8aeef75a5a75acdb3d478667e71d96d8cc599c6139d2b31994d68885a`。**它不等於上述完整下載包**；不能只因同名／簽章有效，就把它當作已驗證完整安裝媒體。不同 artifact 的 hash 差異本身也不證明損毀或惡意。
- 未下載完整 installer。未來若授權取得媒體，須從選定版本的官方 release link 取得對應架構完整檔、比對該版本官方 SHA-256、檢查 Authenticode／Docker Inc. 與版本，再保存媒體身分。自算 SHA-256 只提供指紋，沒有官方對應值就不能證明來源；上述下載包 hash 也不能套到任意新版／ARM／安裝目錄元件。
- 最新 [Windows 安裝說明](https://docs.docker.com/desktop/setup/install/windows-install/#start-docker-desktop) 表示一般安裝後需手動啟動 Desktop；這是**已確認的一般文件行為**，不是 4.90 缺失登錄修復／更新的無寫入保證。查閱公開旗標未找到能保證「不啟動、不初始化、不修改既有 WSL」的版本專屬程序；結論為**未確認**，不聲稱此選項絕不存在。`--quiet`、接受授權條款或避免 OS reboot 都不能當成禁止 backend／WSL 的證據。
- HKCU／uninstall registration 缺失時，4.90 EXE 會判成安裝／修復／升級／失敗哪一種，以及是否重建／重註冊 distro、接觸 main/data 磁碟，官方公開文件未說明：**未確認**。不執行 EXE／Uninstaller 或以試裝補證據。

| 候選 | 優點 | 限制／決策 |
| --- | --- | --- |
| 同版本 4.90.0.238679 | 減少跨版本差異，官方仍有該 build 的下載／checksum | 不代表存在 Repair；可能拒絕相同版本、誤判新安裝或沿用舊 WSL；保留資料與識別行為未確認，NO-GO |
| 官方指定較新版本 | 可包含後續安裝與安全修正 | 需選定確切 build／checksum，增加 schema／runtime 遷移差異；不能以更新後可啟動推論舊資料保全，NO-GO |
| MSI／切 all-users | 屬另一部署模式 | 不是本案 per-user 修復；官方 FAQ 指 MSI 不能 per-user，移除／切換另有風險，不採用 |

官方 [4.95.0 修正紀錄](https://docs.docker.com/desktop/release-notes/#4950) 涵蓋 data-root 放在安裝目錄時升級刪除磁碟的問題。這個案例說明需核對實際 installer 寫入範圍，**不能推論本機已遇到同一 bug，或新版保證修好 socket／缺失登錄**。同版本修復及升級都須 Docker 提供此情境的版本專屬答覆。

前次 `ec96a2c` checkpoint 已核對兩個原始 VHDX 的大小／LastWrite；本次 Review 僅重查私人備份 manifest（12 筆 verified、manifest SHA-256 與先前一致）及 Installer 身分／OS metadata，沒有重算 10.88 GB 全部內容 hash，也沒有重作備份或還原認證。原檔內容／WSL BasePath／停機狀態引用前次外部唯讀證據，非本輪新的實際啟動或隔離驗收；本輪沒有改動它們。

官方來源：[Windows 安裝](https://docs.docker.com/desktop/setup/install/windows-install/)、[企業部署 FAQ](https://docs.docker.com/desktop/enterprise/enterprise-deployment/faq/)、[備份／還原](https://docs.docker.com/desktop/settings-and-maintenance/backup-and-restore/)。FAQ 的 keep-data 補充不改變前次對一般 uninstall 的禁止與資料損失警示。

## 保留三份不同用途的資料

| 身分 | 位置／內容 | 後續使用規則 |
| --- | --- | --- |
| 原始資料 | 既有 package-private data VHDX、main VHDX、設定與 WSL 註冊 | 保留原地；不 mount、搬移、改 ACL、覆寫、壓縮或拿來啟動／升級 |
| 備份 master | 已核對的獨立磁碟專用備份資料夾，12 檔約 10.88 GB，含私人 manifest／ACL inventory | 保持完整；不交給 Docker、不作 data-root、不覆寫、不從中執行程式。可唯讀用於比對，不能變成活動磁碟 |
| 額外工作複本 | **擬議**在已指定備份磁碟建立另一個同層專用資料夾，與 master／原始路徑無包含關係；完整複製兩個 VHDX 與必要設定 | 尚未建立；只有它可在後續明確授權後被採用或遷移。啟動後可能改格式／內容，須另存變更紀錄，不能再假稱與 master 相同 |

工作複本準備規格：在一般 Windows 視圖、確認 Docker／相關 distro 停止，以明確實體路徑**唯讀複製原始資料**；每檔使用新檔建立、拒絕覆寫，以 SHA-256／大小比對前次 master manifest。來源不一致或無法獨占讀取就停止，不更新 master 來掩蓋差異。保存各路徑映射、原始 ACL／時間戳及新目的地 ACL，限制敏感設定存取；不盲目套回原磁碟的 VM／package SID 到新位置。

至少需額外容納約 10.88 GB 完整工作複本，另預留安裝包、還原 staging 與磁碟增長空間；執行前重查實際容量，不能沿用前次 free-space 數字作通行證。若必須另有活動副本，還需再一份磁碟容量。備份與工作複本若放同一實體磁碟，只能隔離操作失誤，不能防範該磁碟本身故障。

## P0：原始 WSL 磁碟隔離

既有 `docker-desktop` 註冊仍指 package-private main。**推論風險**是 installer／backend 可沿用目前使用者的註冊接觸原始磁碟；尚未證實 4.90 installer 一定這樣做，也沒有官方保證它不這樣做。因此在原 Windows 帳號中執行 installer 的原始磁碟無寫入條件未成立。

備份是復原材料，不是存取控制。停止 distro、單純換到普通 PowerShell、暫時獨占讀取檔案、檔案唯讀屬性或觀察事後時間戳，都不是此處已驗證的全程隔離。事後 hash 一致亦不能證明 installer 沒有寫入再復原。沒有採用 ACL 改寫、Registry BasePath 修改、rename、unregister、mount／read-only workaround。

| 隔離候選 | 官方依據／證據界線 | 權限、停止條件與回復 |
| --- | --- | --- |
| 同 Windows 帳號，只停止 WSL／改從桌面啟動 | 停止與啟動方式不會移除既有 BasePath；未找到保證原磁碟不可寫的官方 installer 程序 | per-user 執行通常不需 admin，仍有原使用者資料權限；未取得版本專屬保證就停止。若已接觸原始資料，不能把重裝舊版當作回復，須保存證據並另審資料復原 |
| 同主機另一 Windows 使用者 | Microsoft 明載 WSL distro 為 per-user；但共享 Windows／WSL 元件、管理權限與原磁碟仍存在，**不是充分隔離證明** | 建帳號／系統元件可能需 admin；不得為此改原始 ACL。無法證明 installer 不能接觸原位置就停止；回復只針對新帳號資源且需另授權，不動舊帳號／distro |
| 另一台獨立 Windows 實體主機 | Docker 原生 Windows 安裝是官方路徑；**隔離設計推論**：只提供工作複本、原始／master 所在磁碟完全不連接、不設分享／磁碟映射，目標就沒有原始 WSL 註冊與可達路徑 | 新環境需符合 WSL2／Windows 條件，啟用系統功能可能需 admin；設備／授權／資料移交需同意。若目標看得到原始／master 任何磁碟或共享便停止；失敗僅保留／重建目標工作環境，不對來源 rollback。**推薦的隔離評估替代路線，未建置／未驗證採用** |
| 持久 Windows VM／VDI，只有工作複本 | Docker 官方列出 VM 支援範圍，需 nested virtualization；guest 不得有原始/master 的 passthrough disk、shared folder、網路 share 或 host 管理憑證。guest WSL 名稱相同不會讓它變成 host 的註冊 | 需 hypervisor／guest 管理權限及合適授權。官方支援為 Business，列 ESXi／Azure VM／符合條件的 Nutanix VDI；其他 hypervisor 不在官方支援表內，不能把任意本機 VM 宣稱為官方支援。未確認平台／授權／nested virtualization／路徑不可達就停止；回復只能用目標自身可涵蓋工作資料的 checkpoint／複本，不能假定 VM snapshot 含外接磁碟 |

來源：[Microsoft per-user WSL](https://learn.microsoft.com/en-us/windows/wsl/setup/environment)、[Docker VM／VDI 支援範圍](https://docs.docker.com/desktop/setup/vm-vdi/)。本機另開 WSL distro 仍在同一 Windows／WSL 管理範圍，不能等同獨立 Windows 環境。VM 文件提及的雲端 Offload 不是本案的本機 VHDX 還原方式，不採用；不建立雲端或收費環境。

獨立環境須有可審閱的證據：全新目標的 WSL 註冊／磁碟與分享清單、工作複本唯一映射、無來源磁碟或存取憑證、installer 與後續 runtime 寫入範圍。僅換帳號／建立 VM 的名稱不足。這些清單目前未產生，不能提前判定隔離 Passed；也不能因隔離設計合理而跳過 Docker 資料採用的相容性確認。

## P0：四個獨立的恢復步驟與停止條件

前置條件是官方答覆、ChatGPT Review、選定版本／環境／隔離證據與新的明確授權。以下是審閱規格，**不是可直接執行的 runbook**。同機原安裝路線若不能通過隔離門檻，後續只能評估獨立環境，不可在原主機試裝。

| 步驟 | 未來動作（本輪未執行） | 必要證據／停止條件 |
| --- | --- | --- |
| 1. 建立與驗證工作複本 | 在核准目的地複製兩個磁碟與必要設定，原始/master 保留；不註冊、不掛載、不啟動 | 全部 hash／大小與原 manifest 一致、目的地獨立、足夠空間、無 junction／link 回來源。異常即停止，不能更新 master 掩蓋差異。複製完成只代表檔案準備，不代表可被 Docker 採用 |
| 2. 安裝 Desktop 或修復程式安裝 | 核准的普通 Windows 環境、官方 EXE/per-user/WSL2、指定版本；不從 Codex／其 WMI 子程序啟動 | 同機原安裝須先解決原始 BasePath 隔離；獨立環境須證明來源不可達。安裝後先核對登錄／版本／runtime／設定／BasePath；不進行資料採用或啟動。若要求刪除／reset、非預期註冊改動或無法防自動初始化就停止 |
| 3. 讓 Docker 正式採用工作資料 | 只有在 Docker 確認對應版本與儲存格式的受支援程序後，在目標停機狀態下按其程序採用**工作複本** | 本機程序目前 BLOCKED。須明確說明 data VHDX 與 main VHDX 各自的角色、應恢復哪個檔、Docker 自身 runtime 如何建立、是否需先初始化及如何避免格式化工作資料。不能靠設定 data-root、直接改 BasePath 或 import VHDX 自行補齊步驟 |
| 4. 首次啟動與資料驗證 | 另行授權後只啟動核准目標，所有可寫磁碟均為工作環境資源；先盤點、不啟動業務 containers | 核對 Docker 實際使用的 object／磁碟路徑、containers／volumes／images 及關鍵 volume 資料；原清單未知時需由業務所有者確認。空白列表不算恢復，缺資料即停；不 prune、不初始化覆蓋、不以恢復後 hash 變動自動判定失敗或成功 |

### 資料採用的官方證據到底到哪裡

Docker [備份／還原文件](https://docs.docker.com/desktop/settings-and-maintenance/backup-and-restore/) 提供 Windows WSL2 data VHDX 的停機保存，及重新安裝後恢復至相應 backend 位置的一般程序。**這是官方一般路徑，並非沒有還原文件**。但它沒有定義本案「package-private 舊 WSL main＋獨立 data disk＋缺失安裝登錄」應如何轉入另一環境，也沒保證跨版本可直接採用。當目標位置已存在檔案，本方案不允許推導成可直接覆寫；是否需安全 staging／新 runtime，均待官方提供程序。

Microsoft [WSL 基本指令](https://learn.microsoft.com/en-us/windows/wsl/basic-commands) 定義 VHDX 匯入為 WSL distro 註冊；不承諾 Docker 的 managed runtime／獨立 data disk 能因此恢復。main 與 data 不能互換，不能把 data disk 當一般 distro 匯入；不自行寫 import-in-place／修改 BasePath／替換磁碟的 workaround。若官方必須先首次初始化 runtime，再停機採用資料，這是四步順序的實質變更，須先重新 Review，不現場調整。

恢復失敗時保留工作複本／目標日誌，另核准重建目標；master 與原始仍不變。若發現原始可能被寫入，先保全新舊證據，禁止盲目覆回 master 或只回退 installer。首次啟動前應保存**已核准目標**的狀態回復方式；啟動後工作磁碟會改變，後續比對應依資料內容與操作紀錄，不期待其 hash 永遠等於備份。

首次 Engine 啟動本身可能改動工作磁碟，既有 container restart policy 也可能自動啟動工作負載；不能因操作員不手動啟動 container 就稱為純唯讀盤點。須另確認官方支援的恢復／禁止自動重啟方式，以及目標與外部服務／原始共享的隔離；未確認就保持首次啟動 BLOCKED，不離線改寫 Docker 私有 metadata。

**重要風險：** 原始 WSL 註冊仍指 package-private main。安裝修復與資料採用的先後順序不是可以任意交換的兩個步驟；必須先證實 installer 不會透過舊註冊寫入原始磁碟，否則停在規劃階段。備份本身不等於已達成這項隔離。

官方 [release notes](https://docs.docker.com/desktop/release-notes/#4950) 記載曾修正 data-root 位於安裝目錄時的升級刪磁碟問題；因此未來工作／活動資料位置須在安裝目錄與 Codex package 之外。這個特定修正不能證明本機 socket／登錄故障已被解決。撤回二進位版本也不能自動回復改過的 WSL 註冊或升級過的磁碟。

## 英文官方技術詢問草稿

見 [可直接寄送的英文草稿](2026-10-30-docker-support-inquiry-draft.en.md)。**僅準備，未寄送**；不附日誌、個人路徑、磁碟內容、憑證或密鑰。草稿詢問已確認事實與程序，沒有要求官方替我們操作，也不把詢問本身視為日後修復授權。

## 目前決策

| 階段 | 技術／文件決策 | 本輪實際執行決策 | 解鎖條件 |
| --- | --- | --- | --- |
| 文件規劃 | **有條件 GO**，已補 Review 所需證據與限制，不代表實作安全已通過 | GO，僅文件／公開查證／必要唯讀檢查 | 提交 ChatGPT Review，不自動進下一步 |
| 建立工作複本 | 設計可審閱；尚未建立 | **NO-GO（本輪禁止）** | 新授權、確切目的地／容量／停機、hash manifest 與保留原始/master |
| 安裝修復 | **BLOCKED：P0 隔離、P1 缺失登錄／Installer 行為未確認** | NO-GO | 官方版本專屬答覆＋可驗證隔離＋媒體完整性＋Review／新授權 |
| 資料採用 | **BLOCKED：P0 本案採用程序未確認** | NO-GO | Docker 確認 main/data 對應與正式採用流程；不能用 WSL import 或 data-root 推論 |
| 首次啟動 | **BLOCKED：安裝／採用／隔離均未驗證** | NO-GO | 所有前項通過，明確核准目標及資料驗證／停損計畫、新授權 |

本輪檢查不含 Docker／WSL 啟動、安裝試驗或 VHDX 內容操作。備份 manifest 指紋維持一致；這不是重跑所有備份 hash 或新的還原成功證據。**尚未解決的 P0** 是原始 BasePath 的全程寫入隔離，以及 main/data 在 Docker 內正式採用的版本相容程序。原主機修復維持首選待確認路線；若不能取得保證，建議轉向「來源不可達的獨立 Windows 主機」評估，不以其他帳號／任意 VM 假稱已解決。

下一筆授權需具體涵蓋：工作複本確切目的地與複製、指定 installer 版本／hash／執行方式、是否容許 installer 寫入既有註冊、資料採用／WSL 變動、首次啟動。這些目前都未執行；沒有發出官方支援訊息或重跑功能測試。
