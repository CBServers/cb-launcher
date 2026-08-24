[![build](https://img.shields.io/github/actions/workflow/status/CBServers/cb-launcher/build.yml?branch=main&label=Build&logo=github)](https://github.com/CBServers/cb-launcher/actions)
[![bugs](https://img.shields.io/github/issues/CBServers/cb-launcher/bug?label=Bugs)](https://github.com/CBServers/cb-launcher/issues?q=is%3Aissue+is%3Aopen+label%3Abug)
[![website](https://img.shields.io/badge/CBServers-Website-blue)](https://cbservers.xyz)

# CB Servers Launcher

This Launcher provides unified access to all game clients that we host servers on. You can download games straight from the launcher or use your existing installation.

**NOTE:** This launcher is not affiliated with or endorsed by IW4x, Plutonium, AlterWare, Aurora, HorizonMW, CoD4x Project, IW3SP-Mod, T6SP-Mod, H2-Mod, or Project BO4. Please do not contact the original client maintainers with support requests regarding this launcher.

## Download

- **[Click here to get the latest release](https://github.com/CBServers/updater/raw/main/updater/cb-launcher/cb-launcher.exe)**
- Run `cb-launcher.exe` from any folder.
- For more detailed instructions, visit https://docs.cbservers.xyz/launcher/install.

## Command line arguments

The launcher accepts the following optional command line arguments. 

| Argument | Value | Description |
|----------|-------|-------------|
| `-noupdate` | — | Skips the launcher's self-update check on startup. |
| `-offline` | — | Runs the launcher in offline mode. Updates, downloads and online features are disabled. |
| `-portable` | — | Runs the launcher in portable mode. Launcher data (user settings, CEF cache, UI files) is stored in a `cbservers` folder next to the executable instead of `%LOCALAPPDATA%/cbservers`. |
| `-launch` | game id | Auto-launches the given game once the launcher finishes loading. Accepts one of: `cod1`, `coduo`, `cod2`, `cod4`, `waw`, `mw2`, `bo1`, `bo2`, `mw3`, `ghosts`, `aw`, `bo3`, `iw`, `mwr`, `bo4`, `mw2r`, `hmw`. |
| `-mode` | `sp` / `mp` / `zm` / `sv` | Used together with `-launch` to choose which mode to start: singleplayer, multiplayer, zombies, or survival. |
| `-install` | game id | Opens the given game's page and its setup/install flow once the launcher finishes loading. Accepts the same game ids as `-launch`. |

## URL scheme (`cbservers://`)

The launcher registers a `cbservers://` URL protocol on startup (per-user, no admin required), so links from a browser or another app can drive it. If the launcher is already running, the link is handed to the existing instance instead of opening a second one.

| Link | Action |
|------|--------|
| `cbservers://play/<game>[/<mode>]` | Launches the game (optionally in a specific mode). If it isn't installed yet, the setup flow opens instead. |
| `cbservers://game/<game>` | Opens the game's page without launching. |
| `cbservers://install/<game>` | Opens the game's page and starts its setup/install flow. |
| `cbservers://mods/<game>[/<id>]` | Opens the game's Mods tab; with an item id, opens that Workshop/catalog item's detail popup. |

`<game>` accepts the same ids as `-launch` (e.g. `bo2`, `waw`, `mw3`, `cod4`). `<mode>` accepts the same values as `-mode`, validated against what the game supports.

## Compile from source code

- Clone the Git repo via [Git](https://git-scm.com/install/windows) or [GitHub Desktop](https://desktop.github.com/download/). **DO NOT download it as ZIP** as it will not work.
- Run the `generate.bat` script to generate the project solution.
- Build the project via the generated solution file in `build\cb-launcher.sln`.

## Code signing policy

Free code signing on Windows provided by [SignPath.io](https://about.signpath.io/), certificate by [SignPath Foundation](https://signpath.org/).

- Committers and reviewers: [Contributors](https://github.com/CBServers/cb-launcher/graphs/contributors)
- Approvers: [Owner](https://github.com/bradstv)

### Privacy policy

This program will not transfer any information to other networked systems unless specifically requested by the user or the person installing or operating it, with the following exceptions:

- On startup, the launcher checks for launcher and game client updates (hosted on GitHub in our public [updater repository](https://github.com/CBServers/updater)) and downloads game files from our CDN.
- If the user explicitly links their Discord account, the launcher communicates with Discord for rich presence and social features. This is optional and disabled until linked.

See our [Privacy Policy](https://cbservers.xyz/privacy/) and [Terms of Service](https://cbservers.xyz/terms/) for full details.

## Credits

This launcher's foundation is based on the XLabs Launcher, originally developed by [momo5502](https://github.com/momo5502) and the [XLabs Project](https://github.com/XLabsProject). While the original XLabs Launcher repository is no longer available, we're grateful for the foundation their work provided.

Additional thanks to the development teams behind [IW4x](https://iw4x.io/), [Plutonium](https://plutonium.pw/), [AlterWare](https://alterware.dev/), [Aurora](https://auroramod.dev/), [HorizonMW](https://horizonmw.org/), [CoD4x Project](https://cod4x.ovh/), [IW3SP-Mod](https://gitea.com/JerryALT/iw3sp_mod), [T6SP-Mod](https://github.com/Rattpak/T6SP-Mod-Release), [H2-Mod](https://github.com/alicealys/h2-mod), and [Project BO4](https://github.com/project-bo4) for their game clients.

## Disclaimer

Project maintainers are not responsible or liable for misuse of the software. Use responsibly.