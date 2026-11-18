if ($args.Count -lt 1) {
    Write-Output "Usage: <sdk-version>"
    exit 1
}

$ErrorActionPreference = 'Stop'
$sdkVersion = $args[0]

$sdkPath = 'deps/discord_social_sdk'
$destination = 'discord_sdk.zip'

#-------------------------------------------------
Write-Output 'Deleting old Discord Social SDK...'
#-------------------------------------------------

Remove-Item $destination -ErrorAction Ignore
Remove-Item -LiteralPath $sdkPath -Force -Recurse -ErrorAction Ignore

#-------------------------------------------------
Write-Output 'Downloading Discord Social SDK...'
#-------------------------------------------------

$source = "https://cdn-na.cbservers.xyz/sdk/discord_social_sdk-$sdkVersion.zip"
Invoke-WebRequest -Uri $source -OutFile $destination -UserAgent "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"

#-------------------------------------------------
Write-Output 'Unpacking Discord Social SDK...'
#-------------------------------------------------

# Expand-Archive breaks when Windows PowerShell picks up PowerShell 7's Archive module (CI runners)
Add-Type -AssemblyName System.IO.Compression.FileSystem
[System.IO.Compression.ZipFile]::ExtractToDirectory((Join-Path $PWD $destination), (Join-Path $PWD $sdkPath))

#-------------------------------------------------
Write-Output 'Doing cleanup...'
#-------------------------------------------------

Remove-Item $destination

#-------------------------------------------------
Write-Output 'Done!'
