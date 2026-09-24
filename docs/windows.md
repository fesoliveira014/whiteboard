# Whiteboard on Windows

Windows support targets **native Windows x64**. The package is an unsigned ZIP containing `Whiteboard.exe` and its dependencies. Extract the whole archive into a writable directory, then open `Whiteboard.exe`. Keep the accompanying files beside the executable. Windows ARM64 builds and a Windows installer are not provided.

The **Whiteboard Windows** GitHub Actions workflow builds the ZIP, tests Windows runtime behavior, and launches the extracted application to check that a renderer and the embedded server become ready. Successful runs provide a `whiteboard-windows-x64` artifact. This workflow is the native Windows validation gate; Linux tests cannot establish that the Windows package launches.

The packaged app includes its server, CLI, language extensions, Electron runtime, and `diffr.exe`. Node.js, Rust, and Visual Studio are build dependencies; they are not needed to launch the extracted app.

## Build from source

Install:

- Git for Windows, available on `Path`.
- x64 Node.js at the exact version in `apps/review-desktop/code-oss/.nvmrc` and pnpm at the version in the root `package.json`.
- Visual Studio 2022 or Build Tools 2022 with **Desktop development with C++**, the MSVC x64/x86 compiler, its Spectre-mitigated libraries, and a Windows SDK.
- Python 3, available to `node-gyp`.
- Rust with the `stable-x86_64-pc-windows-msvc` toolchain.

Use **Developer PowerShell for VS 2022** with x64 build tools. `cl.exe`, `signtool.exe`, `python.exe`, and `cargo.exe` must be available. Packaging uses the Windows SDK's `signtool.exe` to process upstream native dependencies; this does not sign the Whiteboard release.

Use a machine with sufficient free memory for compilation; 16 GB RAM is recommended. Workspace compilation can exceed Node's default heap limit, and Code OSS build tasks allow an 8 GiB heap.

From the repository root:

```powershell
$env:NODE_OPTIONS = '--max-old-space-size=6144'
pnpm install --frozen-lockfile
pnpm desktop:build
pnpm desktop:run
```

`pnpm dev` builds and launches the development application. `pnpm dev:background` launches it without keeping the terminal attached. The initial build installs the vendored Code OSS dependencies and downloads Electron and the pinned extension packages.

The first launch builds the pinned `diffr` 0.1.3 source revision with Cargo because upstream publishes no Windows binary for that version. Later launches reuse the verified executable in `packages/review/bin/diffr.exe`. Packaging also ensures this executable exists and embeds it in the app. Build downloads require access to the dependency registries, GitHub, Electron's download host, and Open VSX.

Create the Windows package:

```powershell
pnpm desktop:package:windows
```

Outputs:

| Path | Contents |
| --- | --- |
| `apps/review-desktop/VSCode-win32-x64/` | Runnable application directory |
| `dist/Whiteboard-win32-x64-<version>.zip` | Distributable archive |

These commands run natively from PowerShell or Command Prompt. Git Bash and WSL are not required. A development launch uses checkout files; the packaged application uses its embedded runtime.

## Install the command

Open the command palette in Whiteboard and run **Whiteboard: Install CLI in PATH**. This creates `whiteboard.cmd` and its managed PowerShell launcher in `%USERPROFILE%\.local\bin`. If prompted, add that directory to your user `Path` through **Edit environment variables for your account**, then reopen the terminal and Whiteboard.

For the current PowerShell session only:

```powershell
$env:Path = "$env:USERPROFILE\.local\bin;$env:Path"
whiteboard --help
```

The installed command uses the packaged Electron runtime. If you move the extracted app, open it at the new location and reinstall the command. To select an executable explicitly for a launch from a separate CLI installation:

```powershell
$env:DEV_FAST_REVIEW_DESKTOP_COMMAND = 'C:\Tools\Whiteboard\Whiteboard.exe'
whiteboard app launch
```

Use the Windows connection commands shown by the app, including `whiteboard connect claude`, `whiteboard connect codex`, and `whiteboard connect opencode`. Windows MCP configurations start the native runtime and bundled CLI directly, with `ELECTRON_RUN_AS_NODE=1`; they do not require a POSIX shell. The terminal command uses a managed PowerShell launcher so Unicode installation paths work independently of the console code page. Its execution-policy setting applies only to that process.

The default Whiteboard data root is `%USERPROFILE%\.dev`; `DEV_REVIEW_HOME` can override it. Development desktop profiles are stored under `review-desktop\state` within that root. Extracting the ZIP does not make user data local to the application directory.
