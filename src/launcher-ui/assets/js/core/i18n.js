(function() {
    const translations = {
        en: {
            app: {
                title: 'CB Servers Launcher'
            },
            window: {
                minimize: 'Minimize',
                maximize: 'Maximize',
                restore: 'Restore',
                close: 'Close'
            },
            brand: {
                launcher: 'Launcher'
            },
            nav: {
                home: 'Home',
                library: 'Library',
                downloads: 'Downloads',
                friends: 'Friends',
                support: 'Support',
                settings: 'Settings',
                myGames: 'My Games'
            },
            downloads: {
                title: 'Downloads',
                subtitle: 'Active and queued game downloads.',
                empty: 'No downloads in progress.',
                statusVerifying: 'Verifying',
                statusInstalling: 'Installing',
                statusUninstalling: 'Uninstalling',
                statusActive: 'In progress',
                statusQueued: 'Queued — #{{position}}',
                statusPaused: 'Paused',
                statusPausedAt: 'Paused — {{percent}}%',
                pause: 'Pause',
                resume: 'Resume',
                etaLeft: '{{time}}'
            },
            friends: {
                title: 'Friends',
                subtitle: "See who's online and what they're playing.",
                empty: 'No friends to show yet.',
                statusOnline: 'Online',
                statusIdle: 'Idle',
                statusOffline: 'Offline',
                linkBody: 'Link the launcher to your Discord account to play with friends using CB Launcher. Requires a Discord account (13+).',
                linkCta: 'Link launcher to Discord account',
                linking: 'Connecting to Discord...',
                inLauncher: 'In CB Launcher',
                degraded: 'Friends service unreachable - showing friends currently in the launcher only.',
                invite: 'Invite',
                join: 'Join',
                askToJoin: 'Ask to Join',
                inYourMatch: 'In your game',
                inviteTitle: 'Game Invite',
                inviteBody: '{name} invited you to join their game. Join now?',
                inviteBodyGame: '{name} invited you to join their {game} game. Join now?',
                joinRequestTitle: 'Join Request',
                joinRequestBody: '{name} wants to join your game. Let them in?',
                joinRequestBodyGame: '{name} wants to join your {game} game. Let them in?',
                joinRequestOpenBody: '{name} wants to join your match. Approving will open your match to friends.',
                joinRequestOpenBodyGame: '{name} wants to join your {game} match. Approving will open your match to friends.',
                joinAcceptedTitle: 'Request Accepted',
                joinAcceptedBody: '{name} accepted your request to join. Join now?',
                joinAcceptedBodyGame: '{name} accepted your request to join their {game} game. Join now?',
                accept: 'Join',
                approve: 'Approve',
                decline: 'Decline',
                joinLaunchTitle: "Join friend's match?",
                joinLaunchBody: "The game isn't running. Joining will launch it and connect you to your friend's match."
            },
            toasts: {
                discordLinked: 'Discord account linked',
                discordUnlinked: 'Discord account unlinked',
                discordLinkFailed: 'Discord link failed or was cancelled',
                inviteSent: 'Invite sent',
                joinRequestSent: 'Join request sent',
                joining: 'Joining...',
                inviteRateLimited: 'Discord is rate limiting invites, try again in {{seconds}}s',
                inviteFailed: 'Discord request failed',
                queued: '{{game}} added to queue',
                queuedVerify: '{{game}} queued for verification/update',
                queuedInstall: '{{game}} queued for download',
                queuedUninstall: '{{game}} queued for uninstall',
                cancelledVerify: '{{game}} verification/update cancelled',
                cancelledInstall: '{{game}} download cancelled',
                cancelledUninstall: '{{game}} uninstall cancelled',
                cancelled: '{{game}} cancelled',
                shortcutCreated: 'Shortcut created for {{game}}',
                shortcutFailed: 'Could not create shortcut for {{game}}'
            },
            offline: {
                titleSuffix: '(OFFLINE)',
                blockTitle: 'Offline Mode',
                blockBody: 'The launcher is running in offline mode, so downloads, updates and file verification are disabled. Relaunch online to continue?',
                relaunchOnline: 'Relaunch Online'
            },
            deepLink: {
                unknownGame: 'Unknown game in link: {{game}}',
                unknownAction: 'Unknown link action: {{action}}'
            },
            common: {
                ok: 'OK',
                cancel: 'Cancel',
                confirm: 'Confirm',
                save: 'Save',
                play: 'Play',
                verify: 'Verify Files',
                install: 'Install',
                installing: 'Installing',
                verifying: 'Verifying',
                uninstalling: 'Uninstalling',
                queued: 'Queued',
                reinstall: 'Reinstall',
                manage: 'Manage',
                manageInstall: 'Manage Install',
                setup: 'Setup',
                finishSetup: 'Finish Setup',
                stop: 'Stop',
                uninstall: 'Uninstall',
                applyChanges: 'Apply Changes',
                configure: 'Configure',
                browse: 'Browse',
                browseLocalFiles: 'Browse Local Files',
                saveSettings: 'Save Settings',
                resetSettings: 'Reset Settings',
                continue: 'Continue',
                disabled: 'Disabled',
                source: 'Source',
                loading: 'Loading...',
                error: 'Error',
                pinToHome: 'Pin to home',
                unpinFromHome: 'Unpin from home',
                gameDetails: 'Game details',
                createShortcut: 'Create shortcut',
                comingSoon: 'Coming soon'
            },
            home: {
                installedClients: 'Ready to Play',
                readyToPlay: 'Ready to Play',
                pinnedTitle: 'Pinned',
                heroPrev: 'Previous',
                heroNext: 'Next',
                notInstalled: 'Not Installed',
                showInstalled: 'Show installed',
                welcomeTitle: 'Welcome to CB Launcher',
                welcomeBody: 'Welcome to CB Servers Launcher! Your one-stop launcher for Call of Duty community clients. Install, update, and play supported clients all from one place. Head to the <strong>Library</strong> tab to browse every available client and start playing. Need a hand? Head over to the <strong>Support</strong> tab or check out our <a href="https://docs.cbservers.xyz/launcher" target="_blank">docs</a>.',
                disclaimer: 'This launcher is not affiliated with or endorsed by IW4x, Plutonium, AlterWare, Aurora, HorizonMW, CoD4x Project, IW3SP-Mod, T6SP-Mod, H2-Mod, or Project BO4. Please do not contact the original client maintainers with support requests regarding this launcher.'
            },
            library: {
                title: 'Library',
                subtitle: 'Call of Duty clients available through CB Launcher.',
                comingSoonHint: 'Client support is on the way.',
                filterAll: 'All',
                filterInstalled: 'Installed',
                filterNotInstalled: 'Not installed',
                filterPlutonium: 'Plutonium',
                filterAlterWare: 'AlterWare',
                filterAurora: 'Aurora',
                filterHorizonMW: 'HorizonMW',
                filterOthers: 'Others',
                searchPlaceholder: 'Search clients...',
                clearSearch: 'Clear search',
                noMatches: 'No clients match this filter.'
            },
            support: {
                title: 'Support',
                subtitle: 'Troubleshooting, redistributables and community help.',
                communityTitle: 'Community support',
                communityBody: 'Hop into the Discord, the fastest place to get help with launcher setup, client installs and server access.',
                discordServer: 'Discord',
                launcherFaqTitle: 'Launcher FAQ',
                launcherFaqBody: "Stuck or slow downloads, picking a download server, where game files end up, uninstalling and games that won't start.",
                launcherFaqCta: 'Open Launcher FAQ',
                gameFaqTitle: 'Game client FAQ',
                gameFaqBody: 'Per-client help: playing private matches with friends, changing your in-game name, controllers, unlocking items and client-specific crashes.',
                gameFaqCta: 'Open Game Client FAQ',
                reportBug: 'Report a bug',
                openLogs: 'Open log folder',
                redistTitle: 'Redistributables',
                redistBody: 'Install the Visual C++ and DirectX runtimes needed by older Call of Duty clients.',
                manageRedist: 'Manage Redistributables',
                redistSummary: '{{installed}} of {{total}} installed',
                installAllMissing: 'Install all missing',
                redistAllInstalled: 'All installed',
                reinstallAll: 'Reinstall All',
                redistStatusInstalled: 'Installed',
                redistStatusPending: 'Pending',
                redistStatusDownloading: 'Downloading',
                redistStatusInstalling: 'Installing',
                redistStatusFailed: 'Failed',
                popup: {
                    title: 'Manage Redistributables',
                    reinstallAllTitle: 'Reinstall all redistributables?',
                    reinstallAllBody: 'This reinstalls all {{total}} redistributable packages, including ones already installed. You must click <strong>Yes</strong> on every Windows User Account Control (UAC) prompt that appears. There is one for each package. Continue?'
                },
                noteBody: 'This launcher is not affiliated with IW4x, Plutonium, AlterWare, Aurora, HorizonMW, CoD4x Project, IW3SP-Mod, T6SP-Mod, H2-Mod, or Project BO4. Please use CB Servers support channels for this launcher and its forks.',
                github: 'CB Servers GitHub'
            },
            installer: {
                missingRedistTitle: 'Required components missing',
                missingRedistBody: '{{gameName}} needs the following components installed:',
                installAndLaunch: 'Install and launch',
                installingComponents: 'Installing required components…',
                installingNamed: 'Installing {{name}}…',
                redistInstallFailed: 'Failed to install required components. Open the Support page and try the Manage redistributables option.'
            },
            settings: {
                title: 'Settings',
                subtitle: 'Launcher preferences and network settings.',
                gameDirectories: 'Game directories',
                gameDirectoriesBody: 'Link each custom client to its Steam base game directory.',
                notConfiguredPath: 'No folder configured',
                network: 'Network',
                downloadServer: 'Download server',
                downloadServerBody: 'Choose a CDN region or let the launcher pick the fastest one.',
                launcher: 'Launcher',
                language: 'Language',
                languageBody: 'Choose the interface language used by the launcher. This setting only affects the launcher UI, not the in-game language.',
                languageEnglish: 'English',
                languageFrench: 'French',
                languageSpanish: 'Spanish',
                skipHashVerification: 'Skip hash verification',
                skipHashVerificationBody: 'When enabled, game file verification will skip hash checks for much faster validation at the cost of file integrity.',
                desktopNotifications: 'Desktop notifications',
                desktopNotificationsBody: 'When enabled, game invites from friends also appear as Windows notifications with a sound.',
                closeLauncherAfterLaunch: 'Close launcher after game launch',
                closeLauncherAfterLaunchBody: 'When enabled, the launcher will automatically close after launching a game.',
                skipClientUpdate: 'Skip client update on launch',
                skipClientUpdateBody: 'When enabled, client updates will be skipped on launch. Useful when troubleshooting, but you may run an outdated client.',
                player: 'Player',
                globalPlayerName: 'Global in-game name',
                globalPlayerNameBody: 'Used as your in-game name in any game that supports custom names. Can be overridden per-game.',
                discord: 'Discord account',
                discordBody: 'Link your Discord account to use the friends list. While linked, Discord friends see you as playing CB Launcher.',
                discordLink: 'Link',
                discordUnlink: 'Unlink',
                discordLinkedAs: 'Linked as {{name}}',
                discordNotLinked: 'Not linked',
                about: 'About',
                maintenance: 'Maintenance',
                theme: 'Theme',
                themeNavy: 'Navy Dark',
                themeDark: 'Dark',
                themeNavyGradient: 'Navy Gradient',
                resetAllSettings: 'Reset All Settings',
                showConsole: 'Show Console',
                hideConsole: 'Hide Console',
                checkForUpdates: 'Check for Updates',
                source: 'Source',
                designBy: 'Design by <a href="https://github.com/Riyuachi" target="_blank">Riyu</a> &amp; <a href="https://github.com/BradsTV" target="_blank">Brad</a>',
                versionLoading: 'Version: Loading...',
                versionUnknown: 'Version: Unknown',
                versionValue: 'Version: {{version}}',
                themeBody: "Switch between the launcher's available color themes."
            },
            cdn: {
                auto: 'Auto',
                na: 'North America',
                eu: 'Europe',
                custom: 'Custom',
                addCustom: 'Add Custom...',
                addCustomTitle: 'Add or edit custom server',
                retest: 'Re-test server speeds'
            },
            progress: {
                readyToPlay: 'Ready to play',
                launching: 'Launching {{game}}...',
                verifying: 'Verifying {{game}}...',
                launchComplete: 'Launch complete!',
                verificationComplete: 'Verification complete!',
                downloadComplete: 'Download complete!',
                uninstallComplete: 'Uninstall complete!'
            },
            status: {
                readyToPlay: 'Ready to play',
                notInstalled: 'Not installed',
                updateClient: 'Update client',
                baseGameMissing: 'Base game missing',
                updateAvailable: 'Update available'
            },
            detail: {
                overview: 'Overview',
                clientSettings: 'Settings',
                modsScripts: 'Mods/Scripts',
                credits: 'Credits',
                note: 'Note',
                noteBody: 'This launcher is not affiliated with or endorsed by {{provider}}. Please do not contact the original client maintainers with support requests regarding this launcher, use our <a href="https://cbservers.xyz/discord" target="_blank">Discord</a> instead.',
                verifySteamFiles: 'Verify Steam files',
                client: 'Client',
                provider: 'Provider',
                customClient: 'Custom client'
            },
            popup: {
                gameMode: {
                    title: 'Select Game Mode',
                    rememberChoice: 'Remember this choice',
                    playMode: 'Play {{mode}} mode'
                },
                gameSettings: {
                    title: 'Game Settings',
                    titleWithGame: '{{game}} Settings',
                    installationPath: 'Installation Path',
                    installationFolderWithGame: '{{game}} Installation Folder:',
                    installationPlaceholder: 'Select installation folder...',
                    playButtonBehavior: 'Play Button Behavior',
                    playButtonBehaviorLabel: 'When the Play button is clicked, launch:',
                    askEveryTime: 'Ask me every time',
                    gameOptions: 'Game Options',
                    skipIntroCinematic: 'Skip intro cinematic',
                    disableCbExtension: 'Disable CB extension',
                    launchAdmin: 'Launch as administrator',
                    player: 'Player',
                    playerNameOverride: 'In-game name override',
                    playerNameOverrideHelp: 'Overrides the global in-game name for this game.',
                    playerNameOverridePlaceholder: 'Leave empty to use global',
                    playerNameOverrideError: 'Name must be 3-16 characters or empty.',
                    customResolution: 'Custom Resolution',
                    customResolutionPreset: 'Resolution',
                    customResolutionDimensions: 'Width × Height',
                    customResolutionCustomOption: 'Custom',
                    customResolutionError: 'Width and height must be positive numbers.',
                    advanced: 'Advanced',
                    launchOptions: 'Launch Options:',
                    invalidGamePathTitle: 'Invalid Game Path',
                    invalidGamePathBody: 'The selected folder does not contain valid {{game}} game files. Please select the correct game installation folder.',
                    saveFailedTitle: 'Save Failed',
                    saveFailedBody: 'Failed to save settings. Please try again.',
                    resetTitle: 'Reset Game Settings',
                    resetBody: 'Are you sure you want to reset all settings for {{game}}? This will clear the installation path and game preferences but WILL NOT delete game files.',
                    resetDoneTitle: 'Settings Reset',
                    resetDoneBody: '{{game}} settings have been reset to defaults!',
                    resetFailedTitle: 'Reset Failed',
                    resetFailedBody: 'Failed to reset settings. Please try again.'
                },
                componentSelection: {
                    title: 'Manage Installation',
                    titleWithGame: 'Manage Installation - {{game}}',
                    installTitleWithGame: 'Installation - {{game}}',
                    header: 'Manage Install',
                    refreshTitle: 'Refresh component detection',
                    installLocation: 'Install Location',
                    chooseInstallLocation: 'Choose where to install the game...',
                    downloadInfo: 'Download Info',
                    projectedSize: 'Projected Size:',
                    availableSpace: 'Available Space:',
                    calculating: 'Calculating...',
                    detectingInstalled: 'Detecting installed components...',
                    detectionCanTakeMinutes: '(Can take a few minutes)',
                    uninstall: 'Uninstall',
                    loadError: 'Failed to load component information. Please try again.',
                    refreshError: 'Failed to refresh component detection. Please try again.',
                    required: 'Required',
                    installed: 'Installed',
                    confirmChangesTitle: 'Confirm Changes',
                    confirmChangesBody: 'Are you sure you want to apply changes? Selected components will begin to download automatically.',
                    confirmChangesWarning: 'WARNING: Deselected components will be deleted.',
                    installPathRequiredBody: 'Choose an installation location before applying changes.',
                    installPathSaveFailed: 'Failed to save the installation path. Please try again.',
                    saveFailed: 'Failed to save component selection. Please try again.',
                    confirmUninstallTitle: 'Confirm Uninstall',
                    confirmUninstallBody: 'Are you sure you want to uninstall {{game}}?\n\nThis will permanently DELETE all game files.',
                    uninstalling: 'Uninstalling {{game}}...',
                    errorTitle: 'Error'
                },
                setup: {
                    title: 'Setup {{game}}',
                    alreadyInstalledTitle: 'I already have the game installed',
                    alreadyInstalledBody: 'Select the folder where {{game}} is installed on your computer.',
                    downloadTitle: 'Download the game',
                    downloadBody: 'Download and install {{game}} automatically through the launcher.',
                    installTitle: 'Install {{game}}',
                    installLocation: 'Install Location',
                    selectComponents: 'Select Components',
                    loadingComponents: 'Loading components...',
                    downloadInfo: 'Download Info',
                    projectedSize: 'Projected Size:',
                    availableSpace: 'Available Space:',
                    insufficientSpaceTitle: 'Insufficient Space',
                    insufficientSpaceBody: 'Not enough space available. You need {{size}} but only have {{available}} available.',
                    installationErrorTitle: 'Installation Error',
                    installationErrorSetPath: 'Failed to set installation path for {{game}}.',
                    installationErrorStart: 'An error occurred while starting the installation: {{error}}',
                    invalidGamePathTitle: 'Invalid Game Path',
                    invalidGamePathBody: 'The selected folder does not contain valid {{game}} game files. Please select the correct game installation folder.',
                    downloading: 'Downloading {{game}}...'
                },
                customServer: {
                    title: 'Custom Download Server',
                    label: 'Server URL',
                    placeholder: 'https://my-mirror.example.com/',
                    invalidUrl: 'URL must start with http:// or https://',
                    saveFailed: 'Failed to save custom server. Please try again.'
                }
            },
            dialog: {
                resetAllSettingsTitle: 'Reset All Settings',
                resetAllSettingsBody: 'Are you sure you want to reset all launcher and game settings to defaults? This will clear all settings including game installation paths.',
                resetDoneTitle: 'Settings Reset',
                resetDoneBody: 'All settings have been reset to defaults!',
                resetFailedTitle: 'Reset Failed',
                resetFailedBody: 'Failed to reset settings. Please try again.',
                updateTitle: 'Launcher Update',
                updateChecking: 'Checking...',
                updateLatest: 'The launcher is at the latest version!',
                updateCancelled: 'Update was cancelled or an error occurred.',
                updateFailed: 'Failed to check for updates. Please try again later.',
                stopGameFailedTitle: 'Error Stopping Game',
                stopGameFailedBody: 'Failed to stop {{game}}. The game may have already closed.'
            },
            errors: {
                gameNotConfiguredTitle: '{{game}} not configured',
                gameNotConfiguredBody: 'You have not configured your {{game}} installation path.',
                cannotLaunchTitle: 'Cannot launch right now',
                cannotLaunchBody: 'Another game is currently updating. Please wait for it to finish or cancel it before launching a different game.'
            },
            mode: {
                sp: {
                    name: 'Singleplayer',
                    description: 'Play the campaign'
                },
                mp: {
                    name: 'Multiplayer',
                    description: 'Play online with others'
                },
                sv: {
                    name: 'Survival',
                    description: 'Survive against waves of enemies'
                },
                zm: {
                    name: 'Zombies',
                    description: 'Fight hordes of zombies'
                },
                on: {
                    name: 'Online',
                    description: 'Play online with others'
                },
                off: {
                    name: 'Offline',
                    description: 'Play offline against bots or alone'
                }
            },
            game: {
                'cod1': {
                    description: 'Call of Duty (2003) running on the original v1.1 game. Jump straight into the classic World War II campaign and multiplayer from one launcher page.',
                    credits: 'Game files for the base v1.1 game are provided by <a href="https://cod.pm/" target="_blank">cod.pm</a>.'
                },
                'coduo': {
                    description: 'Call of Duty: United Offensive running on the v1.51 game. The classic UO expansion with new campaigns, weapons and vehicle-based multiplayer, ready to play.',
                    credits: 'Game files for the base v1.51 game are provided by <a href="https://cod.pm/" target="_blank">cod.pm</a>.'
                },
                'cod2x': {
                    description: 'Call of Duty 2 enhanced with the CoD2x client on top of the v1.3 game. Modern fixes and quality-of-life improvements for classic COD2 multiplayer.',
                    credits: 'CoD2x is developed by Yctn and eyza. Learn more at <a href="https://cod2x.me/" target="_blank">cod2x.me</a>.'
                },
                'cod4x': {
                    description: 'COD4: Modern Warfare enhanced with COD4x multiplayer and IW3SP-Mod for singleplayer. Experience the classic MW1 campaign and online play with modern client maintenance.',
                    credits: 'Multiplayer is provided by the COD4x Client and developed by the <a href="https://cod4x.ovh/" target="_blank">CoD4x Project</a>.<br>Singleplayer is provided by the IW3SP-Mod Client and developed by <a href="https://gitea.com/JerryALT" target="_blank">JerryALT</a>.'
                },
                't4': {
                    description: 'Call of Duty: World at War enhanced with Plutonium T4 modifications. Experience the campaign, multiplayer, and zombies modes with improved stability and additional features.',
                    descriptionNote: 'Plutonium requires an account. You can create one at: <a href="https://forum.plutonium.pw/register" target="_blank">https://forum.plutonium.pw/register</a>.',
                    credits: 'Campaign, Multiplayer, and Zombies are provided by the T4 Client and developed by <a href="https://plutonium.pw/" target="_blank">Plutonium</a>.'
                },
                't5': {
                    description: 'Call of Duty: Black Ops enhanced with Plutonium T5 modifications. Experience the campaign, multiplayer, and zombies modes with improved stability and additional features.',
                    descriptionNote: 'Plutonium requires an account. You can create one at: <a href="https://forum.plutonium.pw/register" target="_blank">https://forum.plutonium.pw/register</a>.',
                    credits: 'Campaign, Multiplayer, and Zombies are provided by the T5 Client and developed by <a href="https://plutonium.pw/" target="_blank">Plutonium</a>.'
                },
                'iw4x': {
                    description: 'Call of Duty: Modern Warfare 2 enhanced with IW4X and IW4-SP modifications. Experience the classic campaign and multiplayer with improved stability and additional features.',
                    credits: 'Multiplayer is provided by the IW4x Client and developed by the <a href="https://iw4x.io/" target="_blank">IW4x Project</a>.<br>Singleplayer is provided by the IW4-SP Client and developed by <a href="https://alterware.dev/" target="_blank">AlterWare</a>.'
                },
                'iw5': {
                    description: 'Call of Duty: Modern Warfare 3 enhanced with Plutonium and IW5-Mod modifications. Experience the campaign and multiplayer with improved stability and additional features.',
                    descriptionNote: 'Plutonium requires an account. You can create one at: <a href="https://forum.plutonium.pw/register" target="_blank">https://forum.plutonium.pw/register</a>.',
                    credits: 'Multiplayer is provided by the IW5 Client and developed by <a href="https://plutonium.pw/" target="_blank">Plutonium</a>.<br>Singleplayer is provided by the IW5-Mod Client and developed by <a href="https://alterware.dev/" target="_blank">AlterWare</a>.'
                },
                't6': {
                    description: 'Call of Duty: Black Ops 2 enhanced with Plutonium T6 and T6SP-Mod modifications. Experience the campaign, multiplayer, and zombies modes with improved stability and additional features.',
                    descriptionNote: 'Plutonium requires an account. You can create one at: <a href="https://forum.plutonium.pw/register" target="_blank">https://forum.plutonium.pw/register</a>.',
                    credits: 'Multiplayer and Zombies are provided by the T6 Client and developed by <a href="https://plutonium.pw/" target="_blank">Plutonium</a>.<br>Singleplayer is provided by the T6SP-Mod Client and developed by <a href="https://github.com/Rattpak" target="_blank">Rattpak</a>.'
                },
                'boiii': {
                    description: 'Call of Duty: Black Ops 3 enhanced with BOIII modifications. Experience the full campaign, multiplayer, and zombies modes with improved stability and additional features.',
                    credits: 'This is a <a href="https://github.com/CBServers/boiii" target="_blank">fork</a> of the original BOIII/T7x Client developed by <a href="https://github.com/momo5502" target="_blank">momo5502</a> and <a href="https://alterware.dev" target="_blank">AlterWare</a> with added CB patches.'
                },
                'iw6x': {
                    description: 'Call of Duty: Ghosts enhanced with IW6x modifications. Experience the campaign and multiplayer with improved stability and additional features.',
                    credits: 'This is a <a href="https://github.com/CBServers/iw6-mod" target="_blank">fork</a> of the original IW6x/iw6-mod Client developed by <a href="https://alterware.dev" target="_blank">AlterWare</a> and <a href="https://xlabs.dev" target="_blank">X Labs</a> with added CB patches.'
                },
                's1x': {
                    description: 'Call of Duty: Advanced Warfare enhanced with S1x modifications. Experience the futuristic warfare campaign and multiplayer with improved stability and additional features.',
                    credits: 'This is a <a href="https://github.com/CBServers/s1-mod" target="_blank">fork</a> of the original S1x/s1-mod Client developed by <a href="https://alterware.dev" target="_blank">AlterWare</a> and <a href="https://xlabs.dev" target="_blank">X Labs</a> with added CB patches.'
                },
                'h1-mod': {
                    description: 'Call of Duty: Modern Warfare Remastered enhanced with H1-Mod features. Experience the classic campaign and multiplayer with improved stability and additional features.',
                    credits: 'This is a <a href="https://github.com/CBServers/h1-mod" target="_blank">fork</a> of the original H1-Mod Client developed by <a href="https://auroramod.dev" target="_blank">Aurora</a> with added CB patches.'
                },
                'iw7-mod': {
                    description: 'Call of Duty: Infinite Warfare enhanced with IW7-Mod features. Experience the space warfare campaign, multiplayer and zombies with improved stability and additional features.',
                    credits: 'This is a <a href="https://github.com/CBServers/iw7-mod" target="_blank">fork</a> of the original IW7-Mod Client developed by <a href="https://auroramod.dev" target="_blank">Aurora</a> with added CB patches.'
                },
                'bo4': {
                    description: 'Black Ops 4 enhanced with Project BO4 Launcher. Includes online and offline modes for multiplayer and zombies, with improved stability and additional features.',
                    credits: 'Online and offline play are provided by the <a href="https://github.com/NotNierPea/shield-launcher" target="_blank">Project BO4 Launcher</a> and maintained by <a href="https://github.com/NotNierPea" target="_blank">NotNierPea</a>.'
                },
                'mw2r': {
                    description: 'Modern Warfare 2 Campaign Remastered with H2-Mod support. Run the remastered MW2 campaign with stability and quality-of-life patches.',
                    credits: 'MW2 Campaign Remastered support is provided by the <a href="https://github.com/alicealys/h2-mod" target="_blank">H2-Mod</a> Client and developed by <a href="https://github.com/alicealys" target="_blank">Alice</a>.'
                },
                'hmw-mod': {
                    description: "HorizonMW. A faithful community remaster of Modern Warfare 2's Multiplayer with additional content from MW3.",
                    credits: 'This is a <a href="https://github.com/CBServers/HorizonMW-Client" target="_blank">fork</a> of the original HMW-Mod Client developed by <a href="https://horizonmw.org/" target="_blank">HorizonMW</a> with added CB patches.'
                }
            }
        },
        fr: {
            app: {
                title: 'CB Servers Launcher'
            },
            window: {
                minimize: 'Reduire',
                maximize: 'Agrandir',
                restore: 'Restaurer',
                close: 'Fermer'
            },
            brand: {
                launcher: 'Lanceur'
            },
            nav: {
                home: 'Accueil',
                library: 'Bibliotheque',
                downloads: 'Telechargements',
                friends: 'Amis',
                support: 'Support',
                settings: 'Parametres',
                myGames: 'Mes Jeux'
            },
            downloads: {
                title: 'Telechargements',
                subtitle: 'Telechargements de jeux actifs et en file d\'attente.',
                empty: 'Aucun telechargement en cours.',
                statusVerifying: 'Verification',
                statusInstalling: 'Installation',
                statusUninstalling: 'Desinstallation',
                statusActive: 'En cours',
                statusQueued: 'En file - #{{position}}',
                statusPaused: 'En pause',
                statusPausedAt: 'En pause - {{percent}}%',
                pause: 'Mettre en pause',
                resume: 'Reprendre',
                etaLeft: '{{time}}'
            },
            friends: {
                title: 'Amis',
                subtitle: 'Voyez qui est en ligne et a quoi ils jouent.',
                empty: 'Aucun ami a afficher pour le moment.',
                statusOnline: 'En ligne',
                statusIdle: 'Absent',
                statusOffline: 'Hors ligne',
                linkBody: 'Liez le launcher a votre compte Discord pour jouer avec vos amis sur CB Launcher. Necessite un compte Discord (13+).',
                linkCta: 'Lier le launcher au compte Discord',
                linking: 'Connexion a Discord...',
                inLauncher: 'Dans CB Launcher',
                degraded: 'Service amis injoignable - seuls les amis actuellement dans le launcher sont affiches.',
                invite: 'Inviter',
                join: 'Rejoindre',
                askToJoin: 'Demander a rejoindre',
                inYourMatch: 'Dans votre partie',
                inviteTitle: 'Invitation a jouer',
                inviteBody: '{name} vous invite a rejoindre sa partie. Rejoindre maintenant ?',
                inviteBodyGame: '{name} vous invite a rejoindre sa partie de {game}. Rejoindre maintenant ?',
                joinRequestTitle: 'Demande pour rejoindre',
                joinRequestBody: '{name} veut rejoindre votre partie. L\'autoriser ?',
                joinRequestBodyGame: '{name} veut rejoindre votre partie de {game}. L\'autoriser ?',
                joinRequestOpenBody: '{name} veut rejoindre votre partie. Autoriser l\'ouvrira a vos amis.',
                joinRequestOpenBodyGame: '{name} veut rejoindre votre partie de {game}. Autoriser l\'ouvrira a vos amis.',
                joinAcceptedTitle: 'Demande acceptee',
                joinAcceptedBody: '{name} a accepte votre demande pour rejoindre. Rejoindre maintenant ?',
                joinAcceptedBodyGame: '{name} a accepte votre demande pour rejoindre sa partie de {game}. Rejoindre maintenant ?',
                accept: 'Rejoindre',
                approve: 'Autoriser',
                decline: 'Refuser',
                joinLaunchTitle: 'Rejoindre la partie de votre ami ?',
                joinLaunchBody: "Le jeu n'est pas en cours d'execution. Rejoindre le lancera et vous connectera a la partie de votre ami."
            },
            toasts: {
                discordLinked: 'Compte Discord lie',
                discordUnlinked: 'Compte Discord delie',
                inviteSent: 'Invitation envoyee',
                joinRequestSent: 'Demande envoyee',
                joining: 'Connexion en cours...',
                inviteRateLimited: 'Discord limite les invitations, reessayez dans {{seconds}}s',
                inviteFailed: 'Echec de la demande Discord',
                discordLinkFailed: 'Echec ou annulation de la liaison Discord',
                queued: '{{game}} ajoute a la file',
                queuedVerify: '{{game}} en file pour verification/mise a jour',
                queuedInstall: '{{game}} en file pour telechargement',
                queuedUninstall: '{{game}} en file pour desinstallation',
                cancelledVerify: 'Verification/mise a jour de {{game}} annulee',
                cancelledInstall: 'Telechargement de {{game}} annule',
                cancelledUninstall: 'Desinstallation de {{game}} annulee',
                cancelled: '{{game}} annule',
                shortcutCreated: 'Raccourci cree pour {{game}}',
                shortcutFailed: 'Impossible de creer le raccourci pour {{game}}'
            },
            offline: {
                titleSuffix: '(HORS LIGNE)',
                blockTitle: 'Mode hors ligne',
                blockBody: 'Le lanceur est en mode hors ligne ; les telechargements, mises a jour et la verification des fichiers sont desactives. Relancer en ligne pour continuer ?',
                relaunchOnline: 'Relancer en ligne'
            },
            deepLink: {
                unknownGame: 'Jeu inconnu dans le lien : {{game}}',
                unknownAction: 'Action de lien inconnue : {{action}}'
            },
            common: {
                ok: 'OK',
                cancel: 'Annuler',
                confirm: 'Confirmer',
                save: 'Enregistrer',
                play: 'Jouer',
                verify: 'Verifier les fichiers',
                install: 'Installer',
                installing: 'Installation...',
                verifying: 'Verification...',
                uninstalling: 'Desinstallation...',
                queued: 'En file',
                reinstall: 'Reinstaller',
                manage: 'Gerer',
                manageInstall: "Gerer l'installation",
                setup: 'Configurer',
                finishSetup: 'Terminer la configuration',
                stop: 'Arreter',
                uninstall: 'Desinstaller',
                applyChanges: 'Appliquer les modifications',
                configure: 'Configurer',
                browse: 'Parcourir',
                browseLocalFiles: 'Parcourir les fichiers locaux',
                saveSettings: 'Enregistrer',
                resetSettings: 'Reinitialiser',
                continue: 'Continuer',
                disabled: 'Desactive',
                source: 'Source',
                loading: 'Chargement...',
                error: 'Erreur',
                pinToHome: "Epingler a l'accueil",
                unpinFromHome: "Detacher de l'accueil",
                gameDetails: 'Details du jeu',
                createShortcut: 'Creer un raccourci',
                comingSoon: 'Bientot disponible'
            },
            home: {
                installedClients: 'Pret a jouer',
                readyToPlay: 'Pret a jouer',
                pinnedTitle: 'Epingles',
                heroPrev: 'Precedent',
                heroNext: 'Suivant',
                notInstalled: 'Non installes',
                showInstalled: 'Voir les installes',
                welcomeTitle: 'Bienvenue sur CB Launcher',
                welcomeBody: 'Bienvenue sur CB Servers Launcher&nbsp;! Votre launcher tout-en-un pour les clients communautaires Call of Duty. Installez, mettez a jour et jouez aux clients pris en charge depuis un seul endroit. Rendez-vous dans l\'onglet <strong>Bibliotheque</strong> pour parcourir tous les clients disponibles et commencer a jouer. Besoin d\'aide&nbsp;? Rendez-vous dans l\'onglet <strong>Support</strong> ou consultez notre <a href="https://docs.cbservers.xyz/launcher" target="_blank">documentation</a>.',
                disclaimer: 'Ce launcher n\'est ni affilie ni approuve par IW4x, Plutonium, AlterWare, Aurora, HorizonMW, CoD4x Project, IW3SP-Mod, T6SP-Mod, H2-Mod ou Project BO4. Merci de ne pas contacter les developpeurs des clients d\'origine pour des questions concernant ce launcher.'
            },
            library: {
                title: 'Bibliotheque',
                subtitle: 'Clients Call of Duty disponibles dans CB Launcher.',
                comingSoonHint: "Le support du client est en cours d'arrivee.",
                filterAll: 'Tous',
                filterInstalled: 'Installes',
                filterNotInstalled: 'Non installes',
                filterPlutonium: 'Plutonium',
                filterAlterWare: 'AlterWare',
                filterAurora: 'Aurora',
                filterHorizonMW: 'HorizonMW',
                filterOthers: 'Autres',
                searchPlaceholder: 'Rechercher un client...',
                clearSearch: 'Effacer la recherche',
                noMatches: 'Aucun client ne correspond a ce filtre.'
            },
            support: {
                title: 'Support',
                subtitle: 'Depannage, redistribuables et aide communautaire.',
                communityTitle: 'Support communautaire',
                communityBody: "Rejoignez le Discord, l'endroit le plus rapide pour obtenir de l'aide sur le launcher, l'installation des clients et l'acces aux serveurs.",
                discordServer: 'Discord',
                launcherFaqTitle: 'FAQ du launcher',
                launcherFaqBody: "Telechargements bloques ou lents, choix du serveur de telechargement, emplacement des fichiers de jeu, desinstallation et jeux qui ne demarrent pas.",
                launcherFaqCta: 'Ouvrir la FAQ du launcher',
                gameFaqTitle: 'FAQ des clients de jeu',
                gameFaqBody: "Aide par client : parties privees entre amis, changement de pseudo en jeu, manettes, deblocage des objets et crashs propres a chaque client.",
                gameFaqCta: 'Ouvrir la FAQ des clients',
                reportBug: 'Signaler un bug',
                openLogs: 'Ouvrir le dossier des logs',
                redistTitle: 'Redistribuables',
                redistBody: 'Installez les runtimes Visual C++ et DirectX requis par les anciens clients Call of Duty.',
                manageRedist: 'Gerer les redistribuables',
                redistSummary: '{{installed}} sur {{total}} installes',
                installAllMissing: 'Installer tous les manquants',
                redistAllInstalled: 'Tous installes',
                reinstallAll: 'Tout reinstaller',
                redistStatusInstalled: 'Installe',
                redistStatusPending: 'En attente',
                redistStatusDownloading: 'Telechargement',
                redistStatusInstalling: 'Installation',
                redistStatusFailed: 'Echec',
                popup: {
                    title: 'Gerer les redistribuables',
                    reinstallAllTitle: 'Reinstaller tous les redistribuables ?',
                    reinstallAllBody: 'Cela reinstalle les {{total}} paquets redistribuables, y compris ceux deja installes. Vous devez cliquer sur <strong>Oui</strong> a chaque invite de controle de compte utilisateur (UAC) qui apparait. Il y en a une pour chaque paquet. Continuer ?'
                },
                noteBody: "Ce launcher n'est pas affilie a IW4x, Plutonium, AlterWare, Aurora, HorizonMW, CoD4x Project, IW3SP-Mod, T6SP-Mod, H2-Mod ou Project BO4. Utilisez les canaux de support CB Servers pour ce launcher et ses forks.",
                github: 'GitHub CB Servers'
            },
            installer: {
                missingRedistTitle: 'Composants requis manquants',
                missingRedistBody: '{{gameName}} a besoin des composants suivants :',
                installAndLaunch: 'Installer et lancer',
                installingComponents: 'Installation des composants requis…',
                installingNamed: 'Installation de {{name}}…',
                redistInstallFailed: 'Echec de l’installation des composants requis. Ouvrez la page Support et utilisez Gerer les redistribuables.'
            },
            settings: {
                title: 'Parametres',
                subtitle: 'Preferences du launcher et parametres reseau.',
                gameDirectories: 'Repertoires des jeux',
                gameDirectoriesBody: 'Associez chaque client personnalise a son dossier de jeu Steam.',
                notConfiguredPath: 'Aucun dossier configure',
                network: 'Reseau',
                downloadServer: 'Serveur de telechargement',
                downloadServerBody: 'Choisissez une region CDN ou laissez le launcher prendre la plus rapide.',
                launcher: 'Launcher',
                language: 'Langue',
                languageBody: "Choisissez la langue de l'interface du launcher. Ce parametre n'affecte que l'interface du launcher, pas la langue en jeu.",
                languageEnglish: 'Anglais',
                languageFrench: 'Francais',
                languageSpanish: 'Espagnol',
                skipHashVerification: 'Ignorer la verification des hash',
                skipHashVerificationBody: "Lorsqu'active, la verification des fichiers du jeu ignorera les controles de hash pour une validation beaucoup plus rapide au prix de l'integrite des fichiers.",
                desktopNotifications: 'Notifications du bureau',
                desktopNotificationsBody: "Lorsqu'active, les invitations de jeu de vos amis apparaissent aussi comme notifications Windows avec un son.",
                closeLauncherAfterLaunch: 'Fermer le launcher apres le lancement du jeu',
                closeLauncherAfterLaunchBody: "Lorsqu'active, le launcher se fermera automatiquement apres le lancement d'un jeu.",
                skipClientUpdate: 'Ignorer la mise a jour du client au lancement',
                skipClientUpdateBody: "Lorsqu'active, les mises a jour du client seront ignorees au lancement. Utile pour le depannage, mais le client peut etre obsolete.",
                player: 'Joueur',
                globalPlayerName: 'Nom de joueur global',
                globalPlayerNameBody: 'Utilise comme votre nom dans tout jeu qui prend en charge les noms personnalises. Peut etre remplace par jeu.',
                discord: 'Compte Discord',
                discordBody: 'Liez votre compte Discord pour utiliser la liste d\'amis. Une fois lie, vos amis Discord vous voient comme jouant a CB Launcher.',
                discordLink: 'Lier',
                discordUnlink: 'Delier',
                discordLinkedAs: 'Lie en tant que {{name}}',
                discordNotLinked: 'Non lie',
                about: 'A propos',
                maintenance: 'Maintenance',
                theme: 'Theme',
                themeNavy: 'Navy Sombre',
                themeDark: 'Sombre',
                themeNavyGradient: 'Degrade Marine',
                resetAllSettings: 'Reinitialiser tous les parametres',
                showConsole: 'Afficher la console',
                hideConsole: 'Masquer la console',
                checkForUpdates: 'Verifier les mises a jour',
                source: 'Source',
                designBy: 'Design par <a href="https://github.com/Riyuachi" target="_blank">Riyu</a> &amp; <a href="https://github.com/BradsTV" target="_blank">Brad</a>',
                versionLoading: 'Version : Chargement...',
                versionUnknown: 'Version : Inconnue',
                versionValue: 'Version : {{version}}',
                themeBody: 'Changer entre les themes de couleur disponibles du launcher.'
            },
            cdn: {
                auto: 'Auto',
                na: 'Amerique du Nord',
                eu: 'Europe',
                custom: 'Personnalise',
                addCustom: 'Ajouter personnalise...',
                addCustomTitle: 'Ajouter ou modifier un serveur personnalise',
                retest: 'Relancer le test des serveurs'
            },
            progress: {
                readyToPlay: 'Pret a jouer',
                launching: 'Lancement de {{game}}...',
                verifying: 'Verification de {{game}}...',
                launchComplete: 'Lancement termine !',
                verificationComplete: 'Verification terminee !',
                downloadComplete: 'Telechargement termine !',
                uninstallComplete: 'Desinstallation terminee !'
            },
            status: {
                readyToPlay: 'Pret a jouer',
                notInstalled: 'Non installe',
                updateClient: 'Mettre a jour le client',
                baseGameMissing: 'Jeu de base manquant',
                updateAvailable: 'Mise a jour disponible'
            },
            detail: {
                overview: 'Apercu',
                clientSettings: 'Parametres',
                modsScripts: 'Mods/Scripts',
                credits: 'Credits',
                note: 'Note',
                noteBody: "Ce launcher n'est ni affilie ni approuve par {{provider}}. Merci de ne pas contacter les developpeurs des clients d'origine pour des demandes de support concernant ce launcher, utilisez plutot notre <a href=\"https://cbservers.xyz/discord\" target=\"_blank\">Discord</a>.",
                verifySteamFiles: 'Verifier les fichiers Steam',
                client: 'Client',
                provider: 'Fournisseur',
                customClient: 'Client personnalise'
            },
            popup: {
                gameMode: {
                    title: 'Choisir le mode de jeu',
                    rememberChoice: 'Memoriser ce choix',
                    playMode: 'Jouer en mode {{mode}}'
                },
                gameSettings: {
                    title: 'Parametres du jeu',
                    titleWithGame: 'Parametres de {{game}}',
                    installationPath: "Chemin d'installation",
                    installationFolderWithGame: "Dossier d'installation de {{game}} :",
                    installationPlaceholder: "Selectionnez un dossier d'installation...",
                    playButtonBehavior: 'Comportement du bouton Jouer',
                    playButtonBehaviorLabel: "Quand le bouton Jouer est clique, lancer :",
                    askEveryTime: 'Demander a chaque fois',
                    gameOptions: 'Options du jeu',
                    skipIntroCinematic: "Passer l'intro cinematique",
                    disableCbExtension: "Desactiver l'extension CB",
                    launchAdmin: "Lancer en tant qu'administrateur",
                    player: 'Joueur',
                    playerNameOverride: 'Nom personnalise pour ce jeu',
                    playerNameOverrideHelp: 'Remplace le nom global pour ce jeu.',
                    playerNameOverridePlaceholder: 'Laissez vide pour le nom global',
                    playerNameOverrideError: 'Le nom doit contenir entre 3 et 16 caracteres, ou etre vide.',
                    customResolution: 'Resolution personnalisee',
                    customResolutionPreset: 'Resolution',
                    customResolutionDimensions: 'Largeur × Hauteur',
                    customResolutionCustomOption: 'Personnalisee',
                    customResolutionError: 'La largeur et la hauteur doivent etre des nombres positifs.',
                    advanced: 'Avance',
                    launchOptions: 'Options de lancement :',
                    invalidGamePathTitle: 'Chemin de jeu invalide',
                    invalidGamePathBody: 'Le dossier selectionne ne contient pas de fichiers valides pour {{game}}. Selectionnez le bon dossier du jeu.',
                    saveFailedTitle: "Echec de l'enregistrement",
                    saveFailedBody: "Impossible d'enregistrer les parametres. Reessayez.",
                    resetTitle: 'Reinitialiser les parametres du jeu',
                    resetBody: "Voulez-vous vraiment reinitialiser tous les parametres de {{game}} ? Le chemin d'installation et les preferences seront effaces, mais les fichiers du jeu ne seront PAS supprimes.",
                    resetDoneTitle: 'Parametres reinitialises',
                    resetDoneBody: 'Les parametres de {{game}} ont ete reinitialises.',
                    resetFailedTitle: 'Echec de la reinitialisation',
                    resetFailedBody: 'Impossible de reinitialiser les parametres. Reessayez.'
                },
                componentSelection: {
                    title: "Gerer l'installation",
                    titleWithGame: "Gerer l'installation - {{game}}",
                    installTitleWithGame: "Installation - {{game}}",
                    header: "Gerer l'installation",
                    refreshTitle: 'Relancer la detection des composants',
                    installLocation: "Emplacement d'installation",
                    chooseInstallLocation: 'Choisissez ou installer le jeu...',
                    downloadInfo: 'Infos de telechargement',
                    projectedSize: 'Taille projetee :',
                    availableSpace: 'Espace disponible :',
                    calculating: 'Calcul...',
                    detectingInstalled: 'Detection des composants installes...',
                    detectionCanTakeMinutes: '(Cela peut prendre quelques minutes)',
                    uninstall: 'Desinstaller',
                    loadError: 'Impossible de charger les informations des composants. Reessayez.',
                    refreshError: 'Impossible de relancer la detection des composants. Reessayez.',
                    required: 'Requis',
                    installed: 'Installe',
                    confirmChangesTitle: 'Confirmer les modifications',
                    confirmChangesBody: 'Voulez-vous vraiment appliquer ces modifications ? Les composants selectionnes seront telecharges automatiquement.',
                    confirmChangesWarning: 'ATTENTION : les composants deselectionnes seront supprimes.',
                    installPathRequiredBody: "Choisissez un emplacement d'installation avant d'appliquer les modifications.",
                    installPathSaveFailed: "Impossible d'enregistrer le chemin d'installation. Reessayez.",
                    saveFailed: "Impossible d'enregistrer la selection des composants. Reessayez.",
                    confirmUninstallTitle: 'Confirmer la desinstallation',
                    confirmUninstallBody: "Voulez-vous vraiment desinstaller {{game}} ?\n\nTous les fichiers du jeu seront supprimes definitivement.",
                    uninstalling: 'Desinstallation de {{game}}...',
                    errorTitle: 'Erreur'
                },
                setup: {
                    title: 'Configurer {{game}}',
                    alreadyInstalledTitle: 'Le jeu est deja installe',
                    alreadyInstalledBody: 'Selectionnez le dossier ou {{game}} est installe sur votre ordinateur.',
                    downloadTitle: 'Telecharger le jeu',
                    downloadBody: 'Telechargez et installez {{game}} automatiquement via le launcher.',
                    installTitle: 'Installer {{game}}',
                    installLocation: "Emplacement d'installation",
                    selectComponents: 'Selectionner les composants',
                    loadingComponents: 'Chargement des composants...',
                    downloadInfo: 'Infos de telechargement',
                    projectedSize: 'Taille projetee :',
                    availableSpace: 'Espace disponible :',
                    insufficientSpaceTitle: 'Espace insuffisant',
                    insufficientSpaceBody: "Espace insuffisant. Il faut {{size}} mais seulement {{available}} sont disponibles.",
                    installationErrorTitle: "Erreur d'installation",
                    installationErrorSetPath: "Impossible de definir le chemin d'installation pour {{game}}.",
                    installationErrorStart: "Une erreur s'est produite au lancement de l'installation : {{error}}",
                    invalidGamePathTitle: 'Chemin de jeu invalide',
                    invalidGamePathBody: 'Le dossier selectionne ne contient pas de fichiers valides pour {{game}}. Selectionnez le bon dossier du jeu.',
                    downloading: 'Telechargement de {{game}}...'
                },
                customServer: {
                    title: 'Serveur de telechargement personnalise',
                    label: 'URL du serveur',
                    placeholder: 'https://mon-miroir.exemple.com/',
                    invalidUrl: "L'URL doit commencer par http:// ou https://",
                    saveFailed: 'Impossible d\'enregistrer le serveur personnalise. Veuillez reessayer.'
                }
            },
            dialog: {
                resetAllSettingsTitle: 'Reinitialiser tous les parametres',
                resetAllSettingsBody: "Voulez-vous vraiment reinitialiser tous les parametres du launcher et des jeux ? Cela effacera aussi les chemins d'installation des jeux.",
                resetDoneTitle: 'Parametres reinitialises',
                resetDoneBody: 'Tous les parametres ont ete reinitialises.',
                resetFailedTitle: 'Echec de la reinitialisation',
                resetFailedBody: 'Impossible de reinitialiser les parametres. Reessayez.',
                updateTitle: 'Mise a jour du launcher',
                updateChecking: 'Verification...',
                updateLatest: 'Le launcher est deja a jour !',
                updateCancelled: 'La mise a jour a ete annulee ou une erreur est survenue.',
                updateFailed: 'Impossible de verifier les mises a jour. Reessayez plus tard.',
                stopGameFailedTitle: "Erreur lors de l'arret du jeu",
                stopGameFailedBody: "Impossible d'arreter {{game}}. Le jeu est peut-etre deja ferme."
            },
            errors: {
                gameNotConfiguredTitle: '{{game}} non configure',
                gameNotConfiguredBody: "Vous n'avez pas configure le chemin d'installation de {{game}}.",
                cannotLaunchTitle: 'Lancement impossible pour le moment',
                cannotLaunchBody: "Un autre jeu est en cours de mise a jour. Veuillez attendre la fin ou annuler avant de lancer un autre jeu."
            },
            mode: {
                sp: {
                    name: 'Solo',
                    description: 'Jouer la campagne'
                },
                mp: {
                    name: 'Multijoueur',
                    description: 'Jouer en ligne avec les autres'
                },
                sv: {
                    name: 'Survie',
                    description: "Survivre contre des vagues d'ennemis"
                },
                zm: {
                    name: 'Zombies',
                    description: 'Affronter des hordes de zombies'
                },
                on: {
                    name: 'En ligne',
                    description: 'Jouer en ligne avec les autres'
                },
                off: {
                    name: 'Hors ligne',
                    description: 'Jouer hors ligne contre des bots ou seul'
                }
            },
            game: {
                'cod1': {
                    description: "Call of Duty (2003) tourne sur le jeu original en v1.1. Lancez-vous directement dans la campagne et le multijoueur classiques de la Seconde Guerre mondiale depuis une seule page.",
                    credits: 'Les fichiers du jeu de base v1.1 sont fournis par <a href="https://cod.pm/" target="_blank">cod.pm</a>.'
                },
                'coduo': {
                    description: "Call of Duty: United Offensive tourne sur le jeu en v1.51. L'extension UO classique avec de nouvelles campagnes, des armes et du multijoueur en vehicule, prete a jouer.",
                    credits: 'Les fichiers du jeu de base v1.51 sont fournis par <a href="https://cod.pm/" target="_blank">cod.pm</a>.'
                },
                'cod2x': {
                    description: 'Call of Duty 2 ameliore avec le client CoD2x sur le jeu en v1.3. Corrections modernes et ameliorations de confort pour le multijoueur classique de COD2.',
                    credits: 'CoD2x est developpe par Yctn et eyza. En savoir plus sur <a href="https://cod2x.me/" target="_blank">cod2x.me</a>.'
                },
                'cod4x': {
                    description: 'COD4: Modern Warfare ameliore avec le multijoueur COD4x et IW3SP-Mod pour le solo. Profitez de la campagne MW1 classique et du jeu en ligne avec une maintenance moderne.',
                    credits: 'Le multijoueur est fourni par le client COD4x et developpe par le <a href="https://cod4x.ovh/" target="_blank">Projet CoD4x</a>.<br>Le solo est fourni par le client IW3SP-Mod et developpe par <a href="https://gitea.com/JerryALT" target="_blank">JerryALT</a>.'
                },
                't4': {
                    description: 'Call of Duty: World at War ameliore avec les modifications de Plutonium T4. Profitez de la campagne, du multijoueur et des zombies avec une meilleure stabilite et des fonctionnalites supplementaires.',
                    descriptionNote: 'Plutonium necessite un compte. Vous pouvez en creer un sur : <a href="https://forum.plutonium.pw/register" target="_blank">https://forum.plutonium.pw/register</a>.',
                    credits: 'La campagne, le multijoueur et les zombies sont fournis par le client T4 et developpes par <a href="https://plutonium.pw/" target="_blank">Plutonium</a>.'
                },
                't5': {
                    description: 'Call of Duty: Black Ops ameliore avec les modifications de Plutonium T5. Profitez de la campagne, du multijoueur et des zombies avec une meilleure stabilite et des fonctionnalites supplementaires.',
                    descriptionNote: 'Plutonium necessite un compte. Vous pouvez en creer un sur : <a href="https://forum.plutonium.pw/register" target="_blank">https://forum.plutonium.pw/register</a>.',
                    credits: 'La campagne, le multijoueur et les zombies sont fournis par le client T5 et developpes par <a href="https://plutonium.pw/" target="_blank">Plutonium</a>.'
                },
                'iw4x': {
                    description: 'Call of Duty: Modern Warfare 2 ameliore avec les modifications IW4X et IW4-SP. Profitez de la campagne classique et du multijoueur avec une meilleure stabilite et des fonctionnalites supplementaires.',
                    credits: 'Le multijoueur est fourni par le client IW4x et developpe par le <a href="https://iw4x.io/" target="_blank">Projet IW4x</a>.<br>Le solo est fourni par le client IW4-SP et developpe par <a href="https://alterware.dev/" target="_blank">AlterWare</a>.'
                },
                'iw5': {
                    description: 'Call of Duty: Modern Warfare 3 ameliore avec les modifications Plutonium et IW5-Mod. Profitez de la campagne et du multijoueur avec une meilleure stabilite et des fonctionnalites supplementaires.',
                    descriptionNote: 'Plutonium necessite un compte. Vous pouvez en creer un sur : <a href="https://forum.plutonium.pw/register" target="_blank">https://forum.plutonium.pw/register</a>.',
                    credits: 'Le multijoueur est fourni par le client IW5 et developpe par <a href="https://plutonium.pw/" target="_blank">Plutonium</a>.<br>Le solo est fourni par le client IW5-Mod et developpe par <a href="https://alterware.dev/" target="_blank">AlterWare</a>.'
                },
                't6': {
                    description: 'Call of Duty: Black Ops 2 ameliore avec les modifications de Plutonium T6 et T6SP-Mod. Profitez de la campagne, du multijoueur et des zombies avec une meilleure stabilite et des fonctionnalites supplementaires.',
                    descriptionNote: 'Plutonium necessite un compte. Vous pouvez en creer un sur : <a href="https://forum.plutonium.pw/register" target="_blank">https://forum.plutonium.pw/register</a>.',
                    credits: 'Le multijoueur et les zombies sont fournis par le client T6 et developpes par <a href="https://plutonium.pw/" target="_blank">Plutonium</a>.<br>La campagne est fournie par le client T6SP-Mod et developpee par <a href="https://github.com/Rattpak" target="_blank">Rattpak</a>.'
                },
                'boiii': {
                    description: 'Call of Duty: Black Ops 3 ameliore avec les modifications BOIII. Profitez de la campagne complete, du multijoueur et des zombies avec une meilleure stabilite et des fonctionnalites supplementaires.',
                    credits: 'Ceci est un <a href="https://github.com/CBServers/boiii" target="_blank">fork</a> du client BOIII/T7x original developpe par <a href="https://github.com/momo5502" target="_blank">momo5502</a> et <a href="https://alterware.dev" target="_blank">AlterWare</a> avec des correctifs CB.'
                },
                'iw6x': {
                    description: 'Call of Duty: Ghosts ameliore avec les modifications IW6x. Profitez de la campagne et du multijoueur avec une meilleure stabilite et des fonctionnalites supplementaires.',
                    credits: 'Ceci est un <a href="https://github.com/CBServers/iw6-mod" target="_blank">fork</a> du client IW6x/iw6-mod original developpe par <a href="https://alterware.dev" target="_blank">AlterWare</a> et <a href="https://xlabs.dev" target="_blank">X Labs</a> avec des correctifs CB.'
                },
                's1x': {
                    description: 'Call of Duty: Advanced Warfare ameliore avec les modifications S1x. Profitez de la campagne de guerre futuriste et du multijoueur avec une meilleure stabilite et des fonctionnalites supplementaires.',
                    credits: 'Ceci est un <a href="https://github.com/CBServers/s1-mod" target="_blank">fork</a> du client S1x/s1-mod original developpe par <a href="https://alterware.dev" target="_blank">AlterWare</a> et <a href="https://xlabs.dev" target="_blank">X Labs</a> avec des correctifs CB.'
                },
                'h1-mod': {
                    description: 'Call of Duty: Modern Warfare Remastered ameliore avec les fonctionnalites H1-Mod. Profitez de la campagne classique et du multijoueur avec une meilleure stabilite et des fonctionnalites supplementaires.',
                    credits: 'Ceci est un <a href="https://github.com/CBServers/h1-mod" target="_blank">fork</a> du client H1-Mod original developpe par <a href="https://auroramod.dev" target="_blank">Aurora</a> avec des correctifs CB.'
                },
                'iw7-mod': {
                    description: 'Call of Duty: Infinite Warfare ameliore avec les fonctionnalites IW7-Mod. Profitez de la campagne de guerre spatiale, du multijoueur et des zombies avec une meilleure stabilite et des fonctionnalites supplementaires.',
                    credits: 'Ceci est un <a href="https://github.com/CBServers/iw7-mod" target="_blank">fork</a> du client IW7-Mod original developpe par <a href="https://auroramod.dev" target="_blank">Aurora</a> avec des correctifs CB.'
                },
                'bo4': {
                    description: 'Black Ops 4 ameliore avec Project BO4 Launcher. Inclut les modes en ligne et hors ligne pour le multijoueur et les zombies, avec une meilleure stabilite et des fonctionnalites supplementaires.',
                    credits: 'Le jeu en ligne et hors ligne est fourni par <a href="https://github.com/NotNierPea/shield-launcher" target="_blank">Project BO4 Launcher</a> et developpe par <a href="https://github.com/NotNierPea" target="_blank">NotNierPea</a>.'
                },
                'mw2r': {
                    description: "Modern Warfare 2 Campaign Remastered avec le support de H2-Mod. Profitez de la campagne MW2 remasterisee avec des correctifs de stabilite et de confort de jeu.",
                    credits: 'Le support de MW2 Campaign Remastered est fourni par le client <a href="https://github.com/alicealys/h2-mod" target="_blank">H2-Mod</a> et developpe par <a href="https://github.com/alicealys" target="_blank">Alice</a>.'
                },
                'hmw-mod': {
                    description: "HorizonMW. Un remaster communautaire fidele du multijoueur de Modern Warfare 2 avec du contenu supplementaire de MW3.",
                    credits: 'Ceci est un <a href="https://github.com/CBServers/HorizonMW-Client" target="_blank">fork</a> du client HMW-Mod original developpe par <a href="https://horizonmw.org/" target="_blank">HorizonMW</a> avec des correctifs CB.'
                }
            }
        },
        es: {
            app: {
                title: 'CB Servers Launcher'
            },
            window: {
                minimize: 'Minimizar',
                maximize: 'Maximizar',
                restore: 'Restaurar',
                close: 'Cerrar'
            },
            brand: {
                launcher: 'Launcher'
            },
            nav: {
                home: 'Inicio',
                library: 'Biblioteca',
                downloads: 'Descargas',
                friends: 'Amigos',
                support: 'Soporte',
                settings: 'Ajustes',
                myGames: 'Mis Juegos'
            },
            downloads: {
                title: 'Descargas',
                subtitle: 'Descargas de juegos activas y en cola.',
                empty: 'No hay descargas en curso.',
                statusVerifying: 'Verificando',
                statusInstalling: 'Instalando',
                statusUninstalling: 'Desinstalando',
                statusActive: 'En curso',
                statusQueued: 'En cola - #{{position}}',
                statusPaused: 'En pausa',
                statusPausedAt: 'En pausa - {{percent}}%',
                pause: 'Pausar',
                resume: 'Reanudar',
                etaLeft: '{{time}}'
            },
            friends: {
                title: 'Amigos',
                subtitle: 'Mira quien esta en linea y a que estan jugando.',
                empty: 'No hay amigos que mostrar todavia.',
                statusOnline: 'En linea',
                statusIdle: 'Ausente',
                statusOffline: 'Desconectado',
                linkBody: 'Vincula el launcher con tu cuenta de Discord para jugar con tus amigos en CB Launcher. Requiere una cuenta de Discord (13+).',
                linkCta: 'Vincular launcher con Discord',
                linking: 'Conectando con Discord...',
                inLauncher: 'En CB Launcher',
                degraded: 'Servicio de amigos no disponible - solo se muestran los amigos que estan ahora en el launcher.',
                invite: 'Invitar',
                join: 'Unirse',
                askToJoin: 'Pedir unirse',
                inYourMatch: 'En tu partida',
                inviteTitle: 'Invitacion de juego',
                inviteBody: '{name} te invito a unirte a su partida. Unirse ahora?',
                inviteBodyGame: '{name} te invito a unirte a su partida de {game}. Unirse ahora?',
                joinRequestTitle: 'Solicitud para unirse',
                joinRequestBody: '{name} quiere unirse a tu partida. Permitirlo?',
                joinRequestBodyGame: '{name} quiere unirse a tu partida de {game}. Permitirlo?',
                joinRequestOpenBody: '{name} quiere unirse a tu partida. Permitirlo la abrira a tus amigos.',
                joinRequestOpenBodyGame: '{name} quiere unirse a tu partida de {game}. Permitirlo la abrira a tus amigos.',
                joinAcceptedTitle: 'Solicitud aceptada',
                joinAcceptedBody: '{name} acepto tu solicitud para unirte. Unirse ahora?',
                joinAcceptedBodyGame: '{name} acepto tu solicitud para unirte a su partida de {game}. Unirse ahora?',
                accept: 'Unirse',
                approve: 'Aprobar',
                decline: 'Rechazar',
                joinLaunchTitle: 'Unirse a la partida de tu amigo?',
                joinLaunchBody: 'El juego no se esta ejecutando. Unirte lo abrira y te conectara a la partida de tu amigo.'
            },
            toasts: {
                discordLinked: 'Cuenta de Discord vinculada',
                discordUnlinked: 'Cuenta de Discord desvinculada',
                inviteSent: 'Invitacion enviada',
                joinRequestSent: 'Solicitud enviada',
                joining: 'Uniendose...',
                inviteRateLimited: 'Discord esta limitando las invitaciones, intentalo en {{seconds}}s',
                inviteFailed: 'La solicitud de Discord fallo',
                discordLinkFailed: 'La vinculacion con Discord fallo o fue cancelada',
                queued: '{{game}} anadido a la cola',
                queuedVerify: '{{game}} en cola para verificacion/actualizacion',
                queuedInstall: '{{game}} en cola para descarga',
                queuedUninstall: '{{game}} en cola para desinstalacion',
                cancelledVerify: 'Verificacion/actualizacion de {{game}} cancelada',
                cancelledInstall: 'Descarga de {{game}} cancelada',
                cancelledUninstall: 'Desinstalacion de {{game}} cancelada',
                cancelled: '{{game}} cancelado',
                shortcutCreated: 'Acceso directo creado para {{game}}',
                shortcutFailed: 'No se pudo crear el acceso directo para {{game}}'
            },
            offline: {
                titleSuffix: '(SIN CONEXION)',
                blockTitle: 'Modo sin conexion',
                blockBody: 'El lanzador esta en modo sin conexion, por lo que las descargas, actualizaciones y la verificacion de archivos estan desactivadas. Relanzar en linea para continuar?',
                relaunchOnline: 'Relanzar en linea'
            },
            deepLink: {
                unknownGame: 'Juego desconocido en el enlace: {{game}}',
                unknownAction: 'Accion de enlace desconocida: {{action}}'
            },
            common: {
                ok: 'OK',
                cancel: 'Cancelar',
                confirm: 'Confirmar',
                save: 'Guardar',
                play: 'Jugar',
                verify: 'Verificar archivos',
                install: 'Instalar',
                installing: 'Instalando',
                verifying: 'Verificando',
                uninstalling: 'Desinstalando',
                queued: 'En cola',
                reinstall: 'Reinstalar',
                manage: 'Gestionar',
                manageInstall: 'Gestionar instalacion',
                setup: 'Configurar',
                finishSetup: 'Terminar configuracion',
                stop: 'Detener',
                uninstall: 'Desinstalar',
                applyChanges: 'Aplicar cambios',
                configure: 'Configurar',
                browse: 'Explorar',
                browseLocalFiles: 'Explorar archivos locales',
                saveSettings: 'Guardar ajustes',
                resetSettings: 'Restablecer ajustes',
                continue: 'Continuar',
                disabled: 'Desactivado',
                source: 'Codigo fuente',
                loading: 'Cargando...',
                error: 'Error',
                pinToHome: 'Anclar al inicio',
                unpinFromHome: 'Desanclar del inicio',
                gameDetails: 'Detalles del juego',
                createShortcut: 'Crear acceso directo',
                comingSoon: 'Proximamente'
            },
            home: {
                installedClients: 'Listos para jugar',
                readyToPlay: 'Listo para jugar',
                pinnedTitle: 'Anclados',
                heroPrev: 'Anterior',
                heroNext: 'Siguiente',
                notInstalled: 'No instalado',
                showInstalled: 'Mostrar instalados',
                welcomeTitle: 'Bienvenido a CB Launcher',
                welcomeBody: 'Bienvenido a CB Servers Launcher! Tu launcher todo-en-uno para los clientes comunitarios de Call of Duty. Instala, actualiza y juega a los clientes compatibles desde un solo lugar. Ve a la pestana <strong>Biblioteca</strong> para explorar todos los clientes disponibles y empezar a jugar. Necesitas ayuda? Pasa por la pestana <strong>Soporte</strong> o consulta nuestra <a href="https://docs.cbservers.xyz/launcher" target="_blank">documentacion</a>.',
                disclaimer: 'Este launcher no esta afiliado ni respaldado por IW4x, Plutonium, AlterWare, Aurora, HorizonMW, CoD4x Project, IW3SP-Mod, T6SP-Mod, H2-Mod ni Project BO4. Por favor, no contactes a los desarrolladores originales de los clientes con consultas de soporte sobre este launcher.'
            },
            library: {
                title: 'Biblioteca',
                subtitle: 'Clientes de Call of Duty disponibles a traves de CB Launcher.',
                comingSoonHint: 'El soporte del cliente esta en camino.',
                filterAll: 'Todos',
                filterInstalled: 'Instalados',
                filterNotInstalled: 'No instalados',
                filterPlutonium: 'Plutonium',
                filterAlterWare: 'AlterWare',
                filterAurora: 'Aurora',
                filterHorizonMW: 'HorizonMW',
                filterOthers: 'Otros',
                searchPlaceholder: 'Buscar clientes...',
                clearSearch: 'Borrar busqueda',
                noMatches: 'Ningun cliente coincide con este filtro.'
            },
            support: {
                title: 'Soporte',
                subtitle: 'Solucion de problemas, redistribuibles y ayuda comunitaria.',
                communityTitle: 'Soporte comunitario',
                communityBody: 'Entra al Discord, el lugar mas rapido para obtener ayuda con la configuracion del launcher, instalaciones de clientes y acceso a servidores.',
                discordServer: 'Discord',
                launcherFaqTitle: 'Preguntas frecuentes del launcher',
                launcherFaqBody: 'Descargas lentas o atascadas, eleccion del servidor de descarga, donde quedan los archivos de juego, desinstalacion y juegos que no arrancan.',
                launcherFaqCta: 'Abrir preguntas del launcher',
                gameFaqTitle: 'Preguntas frecuentes de los clientes',
                gameFaqBody: 'Ayuda por cliente: partidas privadas con amigos, cambiar tu nombre en el juego, mandos, desbloquear objetos y fallos propios de cada cliente.',
                gameFaqCta: 'Abrir preguntas de los clientes',
                reportBug: 'Reportar un error',
                openLogs: 'Abrir carpeta de registros',
                redistTitle: 'Redistribuibles',
                redistBody: 'Instala los runtimes de Visual C++ y DirectX necesarios para los clientes antiguos de Call of Duty.',
                manageRedist: 'Administrar redistribuibles',
                redistSummary: '{{installed}} de {{total}} instalados',
                installAllMissing: 'Instalar todos los faltantes',
                redistAllInstalled: 'Todos instalados',
                reinstallAll: 'Reinstalar todo',
                redistStatusInstalled: 'Instalado',
                redistStatusPending: 'Pendiente',
                redistStatusDownloading: 'Descargando',
                redistStatusInstalling: 'Instalando',
                redistStatusFailed: 'Fallo',
                popup: {
                    title: 'Administrar redistribuibles',
                    reinstallAllTitle: '¿Reinstalar todos los redistribuibles?',
                    reinstallAllBody: 'Esto reinstala los {{total}} paquetes redistribuibles, incluidos los ya instalados. Debes hacer clic en <strong>Si</strong> en cada ventana de Control de cuentas de usuario (UAC) que aparezca. Hay una por cada paquete. ¿Continuar?'
                },
                noteBody: 'Este launcher no esta afiliado a IW4x, Plutonium, AlterWare, Aurora, HorizonMW, CoD4x Project, IW3SP-Mod, T6SP-Mod, H2-Mod ni Project BO4. Por favor, usa los canales de soporte de CB Servers para este launcher y sus forks.',
                github: 'GitHub de CB Servers'
            },
            installer: {
                missingRedistTitle: 'Faltan componentes requeridos',
                missingRedistBody: '{{gameName}} necesita instalar los siguientes componentes:',
                installAndLaunch: 'Instalar y ejecutar',
                installingComponents: 'Instalando componentes requeridos…',
                installingNamed: 'Instalando {{name}}…',
                redistInstallFailed: 'Fallo al instalar los componentes requeridos. Abre la pagina de Soporte y usa Administrar redistribuibles.'
            },
            settings: {
                title: 'Ajustes',
                subtitle: 'Preferencias del launcher y ajustes de red.',
                gameDirectories: 'Directorios de juegos',
                gameDirectoriesBody: 'Vincula cada cliente personalizado con su directorio base del juego en Steam.',
                notConfiguredPath: 'Carpeta no configurada',
                network: 'Red',
                downloadServer: 'Servidor de descarga',
                downloadServerBody: 'Elige una region CDN o deja que el launcher seleccione la mas rapida.',
                launcher: 'Launcher',
                language: 'Idioma',
                languageBody: 'Elige el idioma de la interfaz del launcher. Esta opcion solo afecta a la interfaz del launcher, no al idioma del juego.',
                languageEnglish: 'Ingles',
                languageFrench: 'Frances',
                languageSpanish: 'Espanol',
                skipHashVerification: 'Omitir verificacion de hash',
                skipHashVerificationBody: 'Cuando esta activado, la verificacion de archivos del juego omitira las comprobaciones de hash para una validacion mucho mas rapida a costa de la integridad de los archivos.',
                desktopNotifications: 'Notificaciones de escritorio',
                desktopNotificationsBody: 'Cuando esta activado, las invitaciones de juego de tus amigos tambien apareceran como notificaciones de Windows con sonido.',
                closeLauncherAfterLaunch: 'Cerrar el launcher al iniciar el juego',
                closeLauncherAfterLaunchBody: 'Cuando esta activado, el launcher se cerrara automaticamente despues de iniciar un juego.',
                skipClientUpdate: 'Omitir actualizacion del cliente al iniciar',
                skipClientUpdateBody: 'Cuando esta activado, las actualizaciones del cliente se omitiran al iniciar. Util para solucionar problemas, pero podrias estar usando un cliente desactualizado.',
                player: 'Jugador',
                globalPlayerName: 'Nombre global en el juego',
                globalPlayerNameBody: 'Se usa como tu nombre dentro de cualquier juego que admita nombres personalizados. Se puede sobrescribir por juego.',
                discord: 'Cuenta de Discord',
                discordBody: 'Vincula tu cuenta de Discord para usar la lista de amigos. Mientras este vinculada, tus amigos de Discord te veran jugando CB Launcher.',
                discordLink: 'Vincular',
                discordUnlink: 'Desvincular',
                discordLinkedAs: 'Vinculado como {{name}}',
                discordNotLinked: 'Sin vincular',
                about: 'Acerca de',
                maintenance: 'Mantenimiento',
                theme: 'Tema',
                themeNavy: 'Navy oscuro',
                themeDark: 'Oscuro',
                themeNavyGradient: 'Degradado Navy',
                resetAllSettings: 'Restablecer todos los ajustes',
                showConsole: 'Mostrar consola',
                hideConsole: 'Ocultar consola',
                checkForUpdates: 'Buscar actualizaciones',
                source: 'Codigo fuente',
                designBy: 'Diseno por <a href="https://github.com/Riyuachi" target="_blank">Riyu</a> &amp; <a href="https://github.com/BradsTV" target="_blank">Brad</a>',
                versionLoading: 'Version: Cargando...',
                versionUnknown: 'Version: Desconocida',
                versionValue: 'Version: {{version}}',
                themeBody: 'Cambia entre los temas de color disponibles del launcher.'
            },
            cdn: {
                auto: 'Auto',
                na: 'Norteamerica',
                eu: 'Europa',
                custom: 'Personalizado',
                addCustom: 'Anadir personalizado...',
                addCustomTitle: 'Anadir o editar servidor personalizado',
                retest: 'Volver a probar la velocidad de los servidores'
            },
            progress: {
                readyToPlay: 'Listo para jugar',
                launching: 'Iniciando {{game}}...',
                verifying: 'Verificando {{game}}...',
                launchComplete: 'Inicio completado!',
                verificationComplete: 'Verificacion completada!',
                downloadComplete: 'Descarga completada!',
                uninstallComplete: 'Desinstalacion completada!'
            },
            status: {
                readyToPlay: 'Listo para jugar',
                notInstalled: 'No instalado',
                updateClient: 'Actualizar cliente',
                baseGameMissing: 'Falta el juego base',
                updateAvailable: 'Actualizacion disponible'
            },
            detail: {
                overview: 'Resumen',
                clientSettings: 'Ajustes',
                modsScripts: 'Mods/Scripts',
                credits: 'Creditos',
                note: 'Nota',
                noteBody: 'Este launcher no esta afiliado ni respaldado por {{provider}}. Por favor, no contactes a los desarrolladores originales de los clientes con consultas de soporte sobre este launcher, usa nuestro <a href="https://cbservers.xyz/discord" target="_blank">Discord</a> en su lugar.',
                verifySteamFiles: 'Verificar archivos de Steam',
                client: 'Cliente',
                provider: 'Proveedor',
                customClient: 'Cliente personalizado'
            },
            popup: {
                gameMode: {
                    title: 'Selecciona modo de juego',
                    rememberChoice: 'Recordar esta eleccion',
                    playMode: 'Jugar en modo {{mode}}'
                },
                gameSettings: {
                    title: 'Ajustes del juego',
                    titleWithGame: 'Ajustes de {{game}}',
                    installationPath: 'Ruta de instalacion',
                    installationFolderWithGame: 'Carpeta de instalacion de {{game}}:',
                    installationPlaceholder: 'Selecciona la carpeta de instalacion...',
                    playButtonBehavior: 'Comportamiento del boton Jugar',
                    playButtonBehaviorLabel: 'Cuando se hace clic en Jugar, iniciar:',
                    askEveryTime: 'Preguntarme cada vez',
                    gameOptions: 'Opciones del juego',
                    skipIntroCinematic: 'Omitir cinematica de introduccion',
                    disableCbExtension: 'Desactivar extension CB',
                    launchAdmin: 'Ejecutar como administrador',
                    player: 'Jugador',
                    playerNameOverride: 'Nombre personalizado en el juego',
                    playerNameOverrideHelp: 'Sobrescribe el nombre global para este juego.',
                    playerNameOverridePlaceholder: 'Dejar vacio para usar el global',
                    playerNameOverrideError: 'El nombre debe tener entre 3 y 16 caracteres, o estar vacio.',
                    customResolution: 'Resolucion personalizada',
                    customResolutionPreset: 'Resolucion',
                    customResolutionDimensions: 'Ancho × Alto',
                    customResolutionCustomOption: 'Personalizada',
                    customResolutionError: 'El ancho y el alto deben ser numeros positivos.',
                    advanced: 'Avanzado',
                    launchOptions: 'Opciones de inicio:',
                    invalidGamePathTitle: 'Ruta de juego invalida',
                    invalidGamePathBody: 'La carpeta seleccionada no contiene archivos validos de {{game}}. Selecciona la carpeta de instalacion correcta del juego.',
                    saveFailedTitle: 'Error al guardar',
                    saveFailedBody: 'No se pudo guardar los ajustes. Intentalo de nuevo.',
                    resetTitle: 'Restablecer ajustes del juego',
                    resetBody: "Seguro que quieres restablecer todos los ajustes de {{game}}? Esto borrara la ruta de instalacion y las preferencias del juego, pero NO eliminara los archivos del juego.",
                    resetDoneTitle: 'Ajustes restablecidos',
                    resetDoneBody: 'Los ajustes de {{game}} se han restablecido a sus valores predeterminados!',
                    resetFailedTitle: 'Error al restablecer',
                    resetFailedBody: 'No se pudo restablecer los ajustes. Intentalo de nuevo.'
                },
                componentSelection: {
                    title: 'Gestionar instalacion',
                    titleWithGame: 'Gestionar instalacion - {{game}}',
                    installTitleWithGame: 'Instalacion - {{game}}',
                    header: 'Gestionar instalacion',
                    refreshTitle: 'Actualizar deteccion de componentes',
                    installLocation: 'Ubicacion de instalacion',
                    chooseInstallLocation: 'Elige donde instalar el juego...',
                    downloadInfo: 'Informacion de descarga',
                    projectedSize: 'Tamano previsto:',
                    availableSpace: 'Espacio disponible:',
                    calculating: 'Calculando...',
                    detectingInstalled: 'Detectando componentes instalados...',
                    detectionCanTakeMinutes: '(Puede tardar unos minutos)',
                    uninstall: 'Desinstalar',
                    loadError: 'No se pudo cargar la informacion de los componentes. Intentalo de nuevo.',
                    refreshError: 'No se pudo actualizar la deteccion de componentes. Intentalo de nuevo.',
                    required: 'Requerido',
                    installed: 'Instalado',
                    confirmChangesTitle: 'Confirmar cambios',
                    confirmChangesBody: 'Seguro que quieres aplicar los cambios? Los componentes seleccionados empezaran a descargarse automaticamente.',
                    confirmChangesWarning: 'AVISO: Los componentes deseleccionados seran eliminados.',
                    installPathRequiredBody: 'Elige una ubicacion de instalacion antes de aplicar los cambios.',
                    installPathSaveFailed: 'No se pudo guardar la ruta de instalacion. Intentalo de nuevo.',
                    saveFailed: 'No se pudo guardar la seleccion de componentes. Intentalo de nuevo.',
                    confirmUninstallTitle: 'Confirmar desinstalacion',
                    confirmUninstallBody: 'Seguro que quieres desinstalar {{game}}?\n\nEsto ELIMINARA permanentemente todos los archivos del juego.',
                    uninstalling: 'Desinstalando {{game}}...',
                    errorTitle: 'Error'
                },
                setup: {
                    title: 'Configurar {{game}}',
                    alreadyInstalledTitle: 'Ya tengo el juego instalado',
                    alreadyInstalledBody: 'Selecciona la carpeta donde {{game}} esta instalado en tu equipo.',
                    downloadTitle: 'Descargar el juego',
                    downloadBody: 'Descarga e instala {{game}} automaticamente desde el launcher.',
                    installTitle: 'Instalar {{game}}',
                    installLocation: 'Ubicacion de instalacion',
                    selectComponents: 'Seleccionar componentes',
                    loadingComponents: 'Cargando componentes...',
                    downloadInfo: 'Informacion de descarga',
                    projectedSize: 'Tamano previsto:',
                    availableSpace: 'Espacio disponible:',
                    insufficientSpaceTitle: 'Espacio insuficiente',
                    insufficientSpaceBody: 'No hay suficiente espacio disponible. Necesitas {{size}} pero solo tienes {{available}} disponibles.',
                    installationErrorTitle: 'Error de instalacion',
                    installationErrorSetPath: 'No se pudo establecer la ruta de instalacion para {{game}}.',
                    installationErrorStart: 'Se produjo un error al iniciar la instalacion: {{error}}',
                    invalidGamePathTitle: 'Ruta de juego invalida',
                    invalidGamePathBody: 'La carpeta seleccionada no contiene archivos validos de {{game}}. Selecciona la carpeta de instalacion correcta del juego.',
                    downloading: 'Descargando {{game}}...'
                },
                customServer: {
                    title: 'Servidor de descarga personalizado',
                    label: 'URL del servidor',
                    placeholder: 'https://mi-mirror.ejemplo.com/',
                    invalidUrl: 'La URL debe empezar por http:// o https://',
                    saveFailed: 'No se pudo guardar el servidor personalizado. Intentalo de nuevo.'
                }
            },
            dialog: {
                resetAllSettingsTitle: 'Restablecer todos los ajustes',
                resetAllSettingsBody: 'Seguro que quieres restablecer todos los ajustes del launcher y de los juegos a sus valores predeterminados? Esto borrara todos los ajustes, incluidas las rutas de instalacion de los juegos.',
                resetDoneTitle: 'Ajustes restablecidos',
                resetDoneBody: 'Todos los ajustes se han restablecido a sus valores predeterminados!',
                resetFailedTitle: 'Error al restablecer',
                resetFailedBody: 'No se pudo restablecer los ajustes. Intentalo de nuevo.',
                updateTitle: 'Actualizacion del launcher',
                updateChecking: 'Comprobando...',
                updateLatest: 'El launcher ya esta en la ultima version!',
                updateCancelled: 'La actualizacion fue cancelada o se produjo un error.',
                updateFailed: 'No se pudo comprobar las actualizaciones. Intentalo mas tarde.',
                stopGameFailedTitle: 'Error al detener el juego',
                stopGameFailedBody: 'No se pudo detener {{game}}. Es posible que el juego ya este cerrado.'
            },
            errors: {
                gameNotConfiguredTitle: '{{game}} no configurado',
                gameNotConfiguredBody: 'No has configurado la ruta de instalacion de {{game}}.',
                cannotLaunchTitle: 'No se puede iniciar ahora',
                cannotLaunchBody: 'Otro juego se esta actualizando. Espera a que termine o cancela la operacion antes de iniciar otro juego.'
            },
            mode: {
                sp: {
                    name: 'Un jugador',
                    description: 'Jugar la campana'
                },
                mp: {
                    name: 'Multijugador',
                    description: 'Jugar en linea con otros'
                },
                sv: {
                    name: 'Supervivencia',
                    description: 'Sobrevivir contra oleadas de enemigos'
                },
                zm: {
                    name: 'Zombis',
                    description: 'Combatir hordas de zombis'
                },
                on: {
                    name: 'En linea',
                    description: 'Jugar en linea con otros'
                },
                off: {
                    name: 'Sin conexion',
                    description: 'Jugar sin conexion contra bots o solo'
                }
            },
            game: {
                'cod1': {
                    description: 'Call of Duty (2003) ejecutandose sobre el juego original en v1.1. Entra directamente a la campana y el multijugador clasicos de la Segunda Guerra Mundial desde una sola pagina.',
                    credits: 'Los archivos del juego base v1.1 los proporciona <a href="https://cod.pm/" target="_blank">cod.pm</a>.'
                },
                'coduo': {
                    description: 'Call of Duty: United Offensive ejecutandose sobre el juego en v1.51. La clasica expansion UO con nuevas campanas, armas y multijugador con vehiculos, lista para jugar.',
                    credits: 'Los archivos del juego base v1.51 los proporciona <a href="https://cod.pm/" target="_blank">cod.pm</a>.'
                },
                'cod2x': {
                    description: 'Call of Duty 2 mejorado con el cliente CoD2x sobre el juego en v1.3. Correcciones modernas y mejoras de calidad de vida para el multijugador clasico de COD2.',
                    credits: 'CoD2x esta desarrollado por Yctn y eyza. Mas informacion en <a href="https://cod2x.me/" target="_blank">cod2x.me</a>.'
                },
                'cod4x': {
                    description: 'COD4: Modern Warfare mejorado con el multijugador de COD4x y IW3SP-Mod para un jugador. Disfruta de la clasica campana de MW1 y del juego en linea con mantenimiento de cliente moderno.',
                    credits: 'El multijugador lo proporciona el cliente COD4x, desarrollado por el <a href="https://cod4x.ovh/" target="_blank">Proyecto CoD4x</a>.<br>El modo un jugador lo proporciona el cliente IW3SP-Mod, desarrollado por <a href="https://gitea.com/JerryALT" target="_blank">JerryALT</a>.'
                },
                't4': {
                    description: 'Call of Duty: World at War mejorado con las modificaciones de Plutonium T4. Disfruta de la campana, el multijugador y el modo zombis con mayor estabilidad y funciones adicionales.',
                    descriptionNote: 'Plutonium requiere una cuenta. Puedes crear una en: <a href="https://forum.plutonium.pw/register" target="_blank">https://forum.plutonium.pw/register</a>.',
                    credits: 'La campana, el multijugador y los zombis los proporciona el cliente T4, desarrollado por <a href="https://plutonium.pw/" target="_blank">Plutonium</a>.'
                },
                't5': {
                    description: 'Call of Duty: Black Ops mejorado con las modificaciones de Plutonium T5. Disfruta de la campana, el multijugador y el modo zombis con mayor estabilidad y funciones adicionales.',
                    descriptionNote: 'Plutonium requiere una cuenta. Puedes crear una en: <a href="https://forum.plutonium.pw/register" target="_blank">https://forum.plutonium.pw/register</a>.',
                    credits: 'La campana, el multijugador y los zombis los proporciona el cliente T5, desarrollado por <a href="https://plutonium.pw/" target="_blank">Plutonium</a>.'
                },
                'iw4x': {
                    description: 'Call of Duty: Modern Warfare 2 mejorado con las modificaciones IW4X y IW4-SP. Disfruta de la campana clasica y del multijugador con mayor estabilidad y funciones adicionales.',
                    credits: 'El multijugador lo proporciona el cliente IW4x, desarrollado por el <a href="https://iw4x.io/" target="_blank">Proyecto IW4x</a>.<br>El modo un jugador lo proporciona el cliente IW4-SP, desarrollado por <a href="https://alterware.dev/" target="_blank">AlterWare</a>.'
                },
                'iw5': {
                    description: 'Call of Duty: Modern Warfare 3 mejorado con las modificaciones de Plutonium e IW5-Mod. Disfruta de la campana y del multijugador con mayor estabilidad y funciones adicionales.',
                    descriptionNote: 'Plutonium requiere una cuenta. Puedes crear una en: <a href="https://forum.plutonium.pw/register" target="_blank">https://forum.plutonium.pw/register</a>.',
                    credits: 'El multijugador lo proporciona el cliente IW5, desarrollado por <a href="https://plutonium.pw/" target="_blank">Plutonium</a>.<br>El modo un jugador lo proporciona el cliente IW5-Mod, desarrollado por <a href="https://alterware.dev/" target="_blank">AlterWare</a>.'
                },
                't6': {
                    description: 'Call of Duty: Black Ops 2 mejorado con las modificaciones de Plutonium T6 y T6SP-Mod. Disfruta de la campaña, el multijugador y el modo zombis con mayor estabilidad y funciones adicionales.',
                    descriptionNote: 'Plutonium requiere una cuenta. Puedes crear una en: <a href="https://forum.plutonium.pw/register" target="_blank">https://forum.plutonium.pw/register</a>.',
                    credits: 'El multijugador y los zombis los proporciona el cliente T6, desarrollado por <a href="https://plutonium.pw/" target="_blank">Plutonium</a>.<br>La campaña la proporciona el cliente T6SP-Mod, desarrollado por <a href="https://github.com/Rattpak" target="_blank">Rattpak</a>.'
                },
                'boiii': {
                    description: 'Call of Duty: Black Ops 3 mejorado con las modificaciones BOIII. Disfruta de la campana completa, el multijugador y el modo zombis con mayor estabilidad y funciones adicionales.',
                    credits: 'Este es un <a href="https://github.com/CBServers/boiii" target="_blank">fork</a> del cliente original BOIII/T7x desarrollado por <a href="https://github.com/momo5502" target="_blank">momo5502</a> y <a href="https://alterware.dev" target="_blank">AlterWare</a> con parches CB anadidos.'
                },
                'iw6x': {
                    description: 'Call of Duty: Ghosts mejorado con las modificaciones IW6x. Disfruta de la campana y del multijugador con mayor estabilidad y funciones adicionales.',
                    credits: 'Este es un <a href="https://github.com/CBServers/iw6-mod" target="_blank">fork</a> del cliente original IW6x/iw6-mod desarrollado por <a href="https://alterware.dev" target="_blank">AlterWare</a> y <a href="https://xlabs.dev" target="_blank">X Labs</a> con parches CB anadidos.'
                },
                's1x': {
                    description: 'Call of Duty: Advanced Warfare mejorado con las modificaciones S1x. Disfruta de la campana de guerra futurista y del multijugador con mayor estabilidad y funciones adicionales.',
                    credits: 'Este es un <a href="https://github.com/CBServers/s1-mod" target="_blank">fork</a> del cliente original S1x/s1-mod desarrollado por <a href="https://alterware.dev" target="_blank">AlterWare</a> y <a href="https://xlabs.dev" target="_blank">X Labs</a> con parches CB anadidos.'
                },
                'h1-mod': {
                    description: 'Call of Duty: Modern Warfare Remastered mejorado con las funciones de H1-Mod. Disfruta de la campana clasica y del multijugador con mayor estabilidad y funciones adicionales.',
                    credits: 'Este es un <a href="https://github.com/CBServers/h1-mod" target="_blank">fork</a> del cliente original H1-Mod desarrollado por <a href="https://auroramod.dev" target="_blank">Aurora</a> con parches CB anadidos.'
                },
                'iw7-mod': {
                    description: 'Call of Duty: Infinite Warfare mejorado con las funciones de IW7-Mod. Disfruta de la campana de guerra espacial, el multijugador y los zombis con mayor estabilidad y funciones adicionales.',
                    credits: 'Este es un <a href="https://github.com/CBServers/iw7-mod" target="_blank">fork</a> del cliente original IW7-Mod desarrollado por <a href="https://auroramod.dev" target="_blank">Aurora</a> con parches CB anadidos.'
                },
                'bo4': {
                    description: 'Black Ops 4 mejorado con Project BO4 Launcher. Incluye modos en linea y sin conexion para multijugador y zombis, con mayor estabilidad y funciones adicionales.',
                    credits: 'El juego en linea y sin conexion lo proporciona <a href="https://github.com/NotNierPea/shield-launcher" target="_blank">Project BO4 Launcher</a>, desarrollado por <a href="https://github.com/NotNierPea" target="_blank">NotNierPea</a>.'
                },
                'mw2r': {
                    description: 'Modern Warfare 2 Campaign Remastered con soporte de H2-Mod. Juega la campana remasterizada de MW2 con parches de estabilidad y mejoras de calidad de vida.',
                    credits: 'El soporte de MW2 Campaign Remastered lo proporciona el cliente <a href="https://github.com/alicealys/h2-mod" target="_blank">H2-Mod</a>, desarrollado por <a href="https://github.com/alicealys" target="_blank">Alice</a>.'
                },
                'hmw-mod': {
                    description: "HorizonMW. Una remasterizacion comunitaria fiel del multijugador de Modern Warfare 2 con contenido adicional de MW3.",
                    credits: 'Este es un <a href="https://github.com/CBServers/HorizonMW-Client" target="_blank">fork</a> del cliente original HMW-Mod desarrollado por <a href="https://horizonmw.org/" target="_blank">HorizonMW</a> con parches CB anadidos.'
                }
            }
        }
    };

    let currentLanguage = 'en';

    function lookup(path, language) {
        return String(path || '')
            .split('.')
            .reduce((value, segment) => (value && value[segment] !== undefined ? value[segment] : undefined), translations[language]);
    }

    function interpolate(template, variables) {
        if (!variables) return template;

        return template.replace(/\{\{(.*?)\}\}/g, (match, key) => {
            const value = variables[key.trim()];
            return value === undefined || value === null ? '' : String(value);
        });
    }

    function t(key, variables) {
        const value = lookup(key, currentLanguage) ?? lookup(key, 'en');
        if (typeof value !== 'string') return key;
        return interpolate(value, variables);
    }

    function setLanguage(language) {
        currentLanguage = translations[language] ? language : 'en';
        document.documentElement.lang = currentLanguage;
        return currentLanguage;
    }

    function getLanguage() {
        return currentLanguage;
    }

    function getGameText(gameId, field, fallback) {
        const value = lookup(`game.${gameId}.${field}`, currentLanguage) ?? lookup(`game.${gameId}.${field}`, 'en');
        return typeof value === 'string' ? value : fallback;
    }

    function applyStaticTranslations() {
        document.title = t('app.title');

        document.querySelectorAll('[data-i18n]').forEach(element => {
            element.textContent = t(element.dataset.i18n);
        });

        document.querySelectorAll('[data-i18n-html]').forEach(element => {
            element.innerHTML = t(element.dataset.i18nHtml);
        });

        document.querySelectorAll('[data-i18n-placeholder]').forEach(element => {
            element.placeholder = t(element.dataset.i18nPlaceholder);
        });

        document.querySelectorAll('[data-i18n-title]').forEach(element => {
            element.title = t(element.dataset.i18nTitle);
        });

        const versionElement = document.getElementById('version-footer');
        if (versionElement && (!versionElement.dataset.versionLoaded || versionElement.dataset.versionLoaded === 'false')) {
            versionElement.textContent = t('settings.versionLoading');
        }
    }

    window.LauncherI18n = {
        t,
        setLanguage,
        getLanguage,
        getGameText,
        applyStaticTranslations
    };
})();
