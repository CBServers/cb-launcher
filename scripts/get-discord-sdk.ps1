if ($args.Count -lt 1) {
    Write-Output "Usage: <sdk-version>"
    exit 1
}

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

Expand-Archive -Path $destination -DestinationPath $sdkPath -Force

#-------------------------------------------------
Write-Output 'Doing cleanup...'
#-------------------------------------------------

Remove-Item $destination

#-------------------------------------------------
Write-Output 'Done!'
