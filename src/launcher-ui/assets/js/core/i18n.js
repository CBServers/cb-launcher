(function() {
    const translations = {
        en: {
            app: {
                title: 'CB Servers Launcher'
            },
            window: {
                minimize: 'Minimize',
                close: 'Close'
            },
            brand: {
                launcher: 'Launcher'
            },
            nav: {
                home: 'Home',
                library: 'Library',
                downloads: 'Downloads',
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
                resume: 'Resume'
            },
            toasts: {
                queued: '{{game}} added to queue',
                queuedVerify: '{{game}} queued for verification/update',
                queuedInstall: '{{game}} queued for download',
                queuedUninstall: '{{game}} queued for uninstall',
                cancelledVerify: '{{game}} verification/update cancelled',
                cancelledInstall: '{{game}} download cancelled',
                cancelledUninstall: '{{game}} uninstall cancelled',
                cancelled: '{{game}} cancelled'
            },
            common: {
                ok: 'OK',
                cancel: 'Cancel',
                confirm: 'Confirm',
                save: 'Save',
                play: 'Play',
                verify: 'Verify Files',
                install: 'Install',
                manage: 'Manage',
                manageInstall: 'Manage Install',
                setup: 'Setup',
                finishSetup: 'Finish Setup',
                stop: 'Stop',
                unlockAll: 'Unlock All',
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
                error: 'Error'
            },
            home: {
                installedClients: 'Ready to Play',
                readyToPlay: 'Ready to Play',
                notInstalled: 'Not Installed',
                showInstalled: 'Show installed',
                welcomeTitle: 'Welcome to CB Launcher',
                welcomeBody: 'Welcome to CB Servers Launcher! Your one-stop launcher for Call of Duty community clients. Install, update, and play supported clients all from one place. Head to the <strong>Library</strong> tab to browse every available client and start playing. Need a hand? Head over to the <strong>Support</strong> tab or check out our <a href="https://docs.cbservers.xyz/launcher" target="_blank">docs</a>.',
                disclaimer: 'This launcher is not affiliated with or endorsed by IW4x, Plutonium, AlterWare, Aurora, or HorizonMW. Please do not contact the original client maintainers with support requests regarding this launcher.'
            },
            library: {
                title: 'Library',
                subtitle: 'Call of Duty clients available through CB Launcher.',
                filterAll: 'All',
                filterInstalled: 'Installed',
                filterNotInstalled: 'Not installed',
                filterPlutonium: 'Plutonium',
                filterAlterWare: 'AlterWare',
                filterAurora: 'Aurora',
                filterHorizonMW: 'HorizonMW',
                filterOthers: 'Others',
                searchPlaceholder: 'Search clients...',
                noMatches: 'No clients match this filter.'
            },
            support: {
                title: 'Support',
                subtitle: 'Troubleshooting, redistributables and community help.',
                communityTitle: 'Community support',
                communityBody: 'Browse the FAQ for quick answers, or hop into the Discord — the fastest place to get help with launcher setup, client installs and server access.',
                faq: 'FAQ',
                discordServer: 'Discord Server',
                redistTitle: 'Redistributables',
                redistBody: 'Install the Visual C++ and DirectX runtimes needed by older Call of Duty clients. Tool created by <a href="https://chse.sh" target="_blank">Chase</a>.',
                installRedist: 'Install Redistributables',
                noteTitle: 'Important note',
                noteBody: 'This launcher is not affiliated with IW4x, Plutonium, AlterWare, Aurora, or HorizonMW. Please use CB Servers support channels for this launcher and its forks.',
                github: 'CB Servers GitHub'
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
                languageBody: 'Choose the interface language used by the launcher.',
                languageEnglish: 'English',
                languageFrench: 'French',
                skipHashVerification: 'Skip hash verification',
                skipHashVerificationBody: 'When enabled, game file verification will skip hash checks for much faster validation at the cost of file integrity.',
                closeLauncherAfterLaunch: 'Close launcher after game launch',
                closeLauncherAfterLaunchBody: 'When enabled, the launcher will automatically close after launching a game.',
                skipClientUpdate: 'Skip client update on launch',
                skipClientUpdateBody: 'When enabled, client updates will be skipped on launch. Useful when troubleshooting, but you may run an outdated client.',
                player: 'Player',
                globalPlayerName: 'Global in-game name',
                globalPlayerNameBody: 'Used as your in-game name in any game that supports custom names. Can be overridden per-game.',
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
                designBy: 'Design by <a href="https://github.com/Riiyua" target="_blank">Riyu</a> &amp; <a href="https://github.com/BradsTV" target="_blank">Brad</a>',
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
                uninstallComplete: 'Uninstall complete!',
                unlockAll: 'Unlocking all for {{game}}...',
                unlockAllComplete: 'Unlock all complete!'
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
                noteBody: 'Do not contact original client maintainers for support requests related to this launcher. Use the CB Servers Discord instead.',
                verifySteamFiles: 'Verify Steam files',
                client: 'Client',
                provider: 'Provider',
                customClient: 'Custom client'
            },
            componentLibrary: {
                title: 'Component Library',
                subtitle: 'Reusable UI states for buttons, cards, fields and badges.',
                buttons: 'Buttons',
                inputs: 'Inputs',
                badges: 'Badges',
                card: 'Card'
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
                    player: 'Player',
                    playerNameOverride: 'In-game name override',
                    playerNameOverrideHelp: 'Overrides the global in-game name for this game.',
                    playerNameOverridePlaceholder: 'Leave empty to use global',
                    playerNameOverrideError: 'Name must be 3-16 characters or empty.',
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
                    confirmUninstallBody: 'Are you sure you want to uninstall {{game}}?\n\nThis will permanently DELETE all game files.\nYour install path and preferences will be preserved.',
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
                unlockAllTitle: 'Unlock All',
                unlockAllBody: 'Unlocking all will reset all of your current classes.\nAre you sure you want to continue?',
                unlockAllFailedTitle: 'Unlock All Failed',
                unlockAllFailedBody: 'Failed to unlock all for {{game}}. Please try again.',
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
                    description: 'Call of Duty: Black Ops 2 enhanced with Plutonium T6 modifications. Experience multiplayer and zombies modes with improved stability and additional features.',
                    descriptionNote: 'Plutonium requires an account. You can create one at: <a href="https://forum.plutonium.pw/register" target="_blank">https://forum.plutonium.pw/register</a>.',
                    credits: 'Multiplayer and Zombies are provided by the T6 Client and developed by <a href="https://plutonium.pw/" target="_blank">Plutonium</a>.'
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
                    credits: 'Online and offline play are provided by the <a href="https://github.com/NotNierPea/shield-launcher" target="_blank">Project BO4 Launcher</a> and developed by <a href="https://github.com/NotNierPea" target="_blank">NotNierPea</a>.'
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
                close: 'Fermer'
            },
            brand: {
                launcher: 'Lanceur'
            },
            nav: {
                home: 'Accueil',
                library: 'Bibliotheque',
                downloads: 'Telechargements',
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
                resume: 'Reprendre'
            },
            toasts: {
                queued: '{{game}} ajoute a la file',
                queuedVerify: '{{game}} en file pour verification/mise a jour',
                queuedInstall: '{{game}} en file pour telechargement',
                queuedUninstall: '{{game}} en file pour desinstallation',
                cancelledVerify: 'Verification/mise a jour de {{game}} annulee',
                cancelledInstall: 'Telechargement de {{game}} annule',
                cancelledUninstall: 'Desinstallation de {{game}} annulee',
                cancelled: '{{game}} annule'
            },
            common: {
                ok: 'OK',
                cancel: 'Annuler',
                confirm: 'Confirmer',
                save: 'Enregistrer',
                play: 'Jouer',
                verify: 'Verifier les fichiers',
                install: 'Installer',
                manage: 'Gerer',
                manageInstall: "Gerer l'installation",
                setup: 'Configurer',
                finishSetup: 'Terminer la configuration',
                stop: 'Arreter',
                unlockAll: 'Tout debloquer',
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
                error: 'Erreur'
            },
            home: {
                installedClients: 'Pret a jouer',
                readyToPlay: 'Pret a jouer',
                notInstalled: 'Non installes',
                showInstalled: 'Voir les installes',
                welcomeTitle: 'Bienvenue sur CB Launcher',
                welcomeBody: 'Bienvenue sur CB Servers Launcher&nbsp;! Votre launcher tout-en-un pour les clients communautaires Call of Duty. Installez, mettez a jour et jouez aux clients pris en charge depuis un seul endroit. Rendez-vous dans l\'onglet <strong>Bibliotheque</strong> pour parcourir tous les clients disponibles et commencer a jouer. Besoin d\'aide&nbsp;? Rendez-vous dans l\'onglet <strong>Support</strong> ou consultez notre <a href="https://docs.cbservers.xyz/launcher" target="_blank">documentation</a>.',
                disclaimer: 'Ce launcher n\'est ni affilie ni approuve par IW4x, Plutonium, AlterWare, Aurora ou HorizonMW. Merci de ne pas contacter les developpeurs des clients d\'origine pour des questions concernant ce launcher.'
            },
            library: {
                title: 'Bibliotheque',
                subtitle: 'Clients Call of Duty disponibles dans CB Launcher.',
                filterAll: 'Tous',
                filterInstalled: 'Installes',
                filterNotInstalled: 'Non installes',
                filterPlutonium: 'Plutonium',
                filterAlterWare: 'AlterWare',
                filterAurora: 'Aurora',
                filterHorizonMW: 'HorizonMW',
                filterOthers: 'Autres',
                searchPlaceholder: 'Rechercher un client...',
                noMatches: 'Aucun client ne correspond a ce filtre.'
            },
            support: {
                title: 'Support',
                subtitle: 'Depannage, redistribuables et aide communautaire.',
                communityTitle: 'Support communautaire',
                communityBody: "Consultez la FAQ pour des reponses rapides, ou rejoignez le Discord — l'endroit le plus rapide pour obtenir de l'aide sur le launcher, l'installation des clients et l'acces aux serveurs.",
                faq: 'FAQ',
                discordServer: 'Serveur Discord',
                redistTitle: 'Redistribuables',
                redistBody: 'Installez les runtimes Visual C++ et DirectX requis par les anciens clients Call of Duty. Outil cree par <a href="https://chse.sh" target="_blank">Chase</a>.',
                installRedist: 'Installer les redistribuables',
                noteTitle: 'Note importante',
                noteBody: "Ce launcher n'est pas affilie a IW4x, Plutonium, AlterWare, Aurora ou HorizonMW. Utilisez les canaux de support CB Servers pour ce launcher et ses forks.",
                github: 'GitHub CB Servers'
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
                languageBody: "Choisissez la langue de l'interface du launcher.",
                languageEnglish: 'Anglais',
                languageFrench: 'Francais',
                skipHashVerification: 'Ignorer la verification des hash',
                skipHashVerificationBody: "Lorsqu'active, la verification des fichiers du jeu ignorera les controles de hash pour une validation beaucoup plus rapide au prix de l'integrite des fichiers.",
                closeLauncherAfterLaunch: 'Fermer le launcher apres le lancement du jeu',
                closeLauncherAfterLaunchBody: "Lorsqu'active, le launcher se fermera automatiquement apres le lancement d'un jeu.",
                skipClientUpdate: 'Ignorer la mise a jour du client au lancement',
                skipClientUpdateBody: "Lorsqu'active, les mises a jour du client seront ignorees au lancement. Utile pour le depannage, mais le client peut etre obsolete.",
                player: 'Joueur',
                globalPlayerName: 'Nom de joueur global',
                globalPlayerNameBody: 'Utilise comme votre nom dans tout jeu qui prend en charge les noms personnalises. Peut etre remplace par jeu.',
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
                designBy: 'Design par <a href="https://github.com/Riiyua" target="_blank">Riyu</a> &amp; <a href="https://github.com/BradsTV" target="_blank">Brad</a>',
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
                uninstallComplete: 'Desinstallation terminee !',
                unlockAll: 'Deblocage complet pour {{game}}...',
                unlockAllComplete: 'Deblocage termine !'
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
                noteBody: "Ne contactez pas les mainteneurs originaux du client pour des demandes de support liees a ce launcher. Utilisez plutot le Discord CB Servers.",
                verifySteamFiles: 'Verifier les fichiers Steam',
                client: 'Client',
                provider: 'Fournisseur',
                customClient: 'Client personnalise'
            },
            componentLibrary: {
                title: 'Bibliotheque de composants',
                subtitle: 'Etats reutilisables pour les boutons, cartes, champs et badges.',
                buttons: 'Boutons',
                inputs: 'Champs',
                badges: 'Badges',
                card: 'Carte'
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
                    player: 'Joueur',
                    playerNameOverride: 'Nom personnalise pour ce jeu',
                    playerNameOverrideHelp: 'Remplace le nom global pour ce jeu.',
                    playerNameOverridePlaceholder: 'Laissez vide pour le nom global',
                    playerNameOverrideError: 'Le nom doit contenir entre 3 et 16 caracteres, ou etre vide.',
                    advanced: 'Avance',
                    launchOptions: 'Options de lancement :',
                    invalidGamePathTitle: 'Chemin de jeu invalide',
                    invalidGamePathBody: 'Le dossier selectionne ne contient pas de fichiers valides pour {{game}}. Selectionnez le bon dossier du jeu.',
                    saveFailedTitle: "Echec de l'enregistrement",
                    saveFailedBody: "Impossible d'enregistrer les parametres. Reessayez.",
                    resetTitle: 'Reinitialiser les parametres du jeu',
                    resetBody: 'Voulez-vous vraiment reinitialiser tous les parametres de {{game}} ? Le chemin d installation et les preferences seront effaces, mais les fichiers du jeu ne seront PAS supprimes.',
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
                    confirmUninstallBody: 'Voulez-vous vraiment desinstaller {{game}} ?\n\nTous les fichiers du jeu seront supprimes definitivement.\nLe chemin d installation et les preferences seront conserves.',
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
                resetAllSettingsBody: 'Voulez-vous vraiment reinitialiser tous les parametres du launcher et des jeux ? Cela effacera aussi les chemins d installation des jeux.',
                resetDoneTitle: 'Parametres reinitialises',
                resetDoneBody: 'Tous les parametres ont ete reinitialises.',
                resetFailedTitle: 'Echec de la reinitialisation',
                resetFailedBody: 'Impossible de reinitialiser les parametres. Reessayez.',
                updateTitle: 'Mise a jour du launcher',
                updateChecking: 'Verification...',
                updateLatest: 'Le launcher est deja a jour !',
                updateCancelled: 'La mise a jour a ete annulee ou une erreur est survenue.',
                updateFailed: 'Impossible de verifier les mises a jour. Reessayez plus tard.',
                unlockAllTitle: 'Tout debloquer',
                unlockAllBody: 'Tout debloquer reinitialisera toutes vos classes actuelles.\nVoulez-vous continuer ?',
                unlockAllFailedTitle: 'Echec du deblocage',
                unlockAllFailedBody: 'Impossible de tout debloquer pour {{game}}. Reessayez.',
                stopGameFailedTitle: "Erreur lors de l'arret du jeu",
                stopGameFailedBody: 'Impossible d arreter {{game}}. Le jeu est peut-etre deja ferme.'
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
                    description: 'Call of Duty: Black Ops 2 ameliore avec les modifications de Plutonium T6. Profitez du multijoueur et des zombies avec une meilleure stabilite et des fonctionnalites supplementaires.',
                    descriptionNote: 'Plutonium necessite un compte. Vous pouvez en creer un sur : <a href="https://forum.plutonium.pw/register" target="_blank">https://forum.plutonium.pw/register</a>.',
                    credits: 'Le multijoueur et les zombies sont fournis par le client T6 et developpes par <a href="https://plutonium.pw/" target="_blank">Plutonium</a>.'
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
                    description: "HorizonMW. Un remaster communautaire fideale du multijoueur de Modern Warfare 2 avec du contenu supplementaire de MW3.",
                    credits: 'Ceci est un <a href="https://github.com/CBServers/HorizonMW-Client" target="_blank">fork</a> du client HMW-Mod original developpe par <a href="https://horizonmw.org/" target="_blank">HorizonMW</a> avec des correctifs CB.'
                }
            }
        }
    };

    const installStateKeys = {
        'Ready to play': 'status.readyToPlay',
        'Update client': 'status.updateClient',
        'Base game missing': 'status.baseGameMissing',
        'Update available': 'status.updateAvailable'
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

    function translateInstallStateLabel(label) {
        const key = installStateKeys[label];
        return key ? t(key) : label;
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
        translateInstallStateLabel,
        applyStaticTranslations
    };
})();
