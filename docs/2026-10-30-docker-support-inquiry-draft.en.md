# Docker Support inquiry — draft only, not sent

**Subject:** Request for a supported, non-destructive recovery procedure: Docker Desktop 4.90.0 per-user installation, missing registration, existing WSL disks in package-private AppData

Hello Docker Support,

We would like to confirm a supported recovery procedure before executing any installer or starting Docker again. Our priority is to preserve the original WSL disks and retain an independently verified backup. We are not requesting a factory reset or a procedure that overwrites the originals.

Environment and observations:

- Windows 11 Home, x64, version 25H2, OS build 26200.9711.
- Docker Desktop 4.90.0.238679, per-user EXE installation; Docker CLI 29.7.2.
- WSL 2.7.13.0; a previous kernel check reported 6.18.33.2-microsoft-standard-WSL2.
- The Desktop executable and locally installed Installer executable report version 4.90.0.238679 and valid Docker Inc. Authenticode signatures. The installed Installer is 6,892,976 bytes; we have not established that it is a complete distributable installer.
- From a normal Windows desktop launch, Docker previously failed while locating the backend, reporting a missing `SOFTWARE\Docker Inc.\Docker Desktop` registry key. Read-only checks found neither the expected HKCU/HKLM vendor registration nor a Docker uninstall registration in the checked standard views.
- Launching through a packaged development application previously failed while renaming `sailor-ingest.sock`, with Windows error 1920 (“The file cannot be accessed by the system”). No further launches are being attempted.
- Read-only checks from an external Windows process confirmed different AppData views. The socket at the explicit package-private location has the AF_UNIX reparse tag `0x80000023`; the corresponding normal AppData location was absent. We have not established that the socket is corrupt or that virtualization is the sole cause.
- The existing `docker-desktop` WSL registration points to a package-private `main` directory containing `ext4.vhdx` (100,663,296 bytes). A separate `docker_data.vhdx` is present under the package-private `disk` directory (10,782,507,008 bytes).
- At the last external inventory, Docker processes and Engine pipes were absent and the only registered distribution, `docker-desktop`, was stopped. The WSL management service remained running. We have not started the distribution again.
- Both VHDX files and required settings were copied while stopped to a different physical disk. All 12 selected files matched their source SHA-256 and size. This is a byte-consistent backup, not a validated restore. Original disks and backup master remain retained; no operational working copy has been created.

We have not executed the Installer or Uninstaller, changed registry/WSL registration/ACLs/data-root, mounted or relocated the VHDX files, deleted the socket, or reset/pruned/unregistered anything. Container and volume inventory is unavailable while the Engine is down; we are not assuming the disks contain no important data.

Could you please clarify the following for this exact installation and storage layout?

1. **Supported repair and installation detection.** Does 4.90.0.238679 have a supported Repair operation, or is a specific full EXE installer/version required? How does it classify an existing per-user installation when vendor and uninstall registrations are absent? Can it restore installation registration without uninstalling or recreating WSL resources?
2. **Original disk isolation.** Can the installer follow the existing `docker-desktop` registration and open, write, unregister, replace, or format either original disk? Is there a supported, verifiable method to prevent access to those originals throughout installation and recovery? A stopped distribution or a backup alone would not satisfy this requirement.
3. **No automatic backend or initialization.** The general Windows installation guide says Desktop does not start automatically after installation. Does that also apply to this version's repair/update path with missing registration? Is there a supported procedure that guarantees no backend start, WSL launch/registration change, disk initialization, or access to existing disks until a separately approved first start? Please identify the exact version and documented options, if available.
4. **Formal data adoption, separately from WSL import.** What is the supported sequence to adopt an additional working copy of this `docker_data.vhdx`? Should the old `main/ext4.vhdx` be restored, or should Desktop create its own runtime? Please specify required versions, disk format/layout compatibility, destination mapping, and any required initialization. We cannot assume that a data-root option, changing BasePath, or importing a VHDX as a WSL distribution completes Docker recovery. Is there a supported first-start recovery mode that prevents existing container restart policies from automatically starting workloads before we inspect the restored data?
5. **Independent Windows recovery target.** If no safe in-place isolation procedure exists, is recovery of only a working copy on a separate Windows machine supported? How should its new runtime be prepared while the original machine's disks and backup master remain inaccessible? If a VM is required, please identify supported platforms, nested-virtualization requirements, and licensing/support prerequisites.
6. **Installer integrity and version choice.** The official build 238679 amd64 checksum differs from our locally installed Installer component. Which complete installer artifact should be obtained and verified? Would same-version repair be supported, or do you recommend a particular newer build? What irreversible disk/runtime changes and rollback limitations should we expect?
7. **Keep-data scope.** Your enterprise FAQ documents EXE `uninstall --keep-data`. Does that procedure even apply when per-user registration is absent and the WSL BasePath is package-private? We are asking about applicability only; uninstalling is not approved or being attempted.

Please provide a version-specific procedure, its write/registration scope, checks before first start, stop conditions, and a recovery path that preserves both the originals and backup master. If the scenario is unsupported or cannot meet the no-write requirement, please state that explicitly so we can keep execution blocked.

We can provide further redacted metadata after reviewing what is necessary. No diagnostic bundle, personal filesystem path, credentials, or disk contents are attached to this draft.

Thank you.
