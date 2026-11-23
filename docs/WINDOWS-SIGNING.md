# Windows Signing

YES Stems can build unsigned installers for local verification, but a public
Windows release must sign the application, NSIS/MSI installers, and the bundled
Demucs PE binaries. Certificate purchase, identity validation, and secret
provisioning remain owner actions.

The implementation follows Tauri's Windows code-signing configuration:
<https://v2.tauri.app/distribute/sign/windows/>.

## Required environment

Import the code-signing certificate into the current user's Windows certificate
store, then set:

```powershell
$env:YES_STEMS_WINDOWS_CERT_THUMBPRINT = "40_CHARACTER_SHA1_THUMBPRINT"
$env:YES_STEMS_WINDOWS_TIMESTAMP_URL = "https://your-provider.example/timestamp"
```

If the certificate provider uses RFC 3161 timestamping, also set:

```powershell
$env:YES_STEMS_WINDOWS_TIMESTAMP_TSP = "1"
```

If `signtool.exe` is not discoverable from `PATH` or the Windows SDK, set:

```powershell
$env:TAURI_WINDOWS_SIGNTOOL_PATH = "C:\Path\To\signtool.exe"
```

Do not commit certificate files, passwords, hardware-token credentials, or
cloud-signing credentials.

## Signed standalone build

```powershell
npm run build:windows:standalone:signed
```

This command:

1. Rebuilds and verifies the bundled Demucs runtime and model checkpoints.
2. Authenticode-signs every `.exe`, `.dll`, and `.pyd` in that runtime.
3. Generates an ignored Tauri signing overlay under `build/`.
4. Lets Tauri sign the application executable and NSIS/MSI bundles.

The command fails before packaging if signing is required but the certificate
environment is absent. `npm run build:windows` remains available for explicit
unsigned local verification and prints a warning.

## Owner closeout

Before distributing a build, the owner must verify the certificate subject and
timestamp on a clean machine, install the NSIS package, run
`scripts/smoke-installed-demucs.ps1`, and confirm the expected publisher in the
Windows security UI. Agent-side build success is not a substitute for those
identity and clean-machine checks.
