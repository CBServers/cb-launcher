if ($args.Count -lt 1) {
    Write-Output "Usage: <cef-version>"
    exit 1
}

$cefVersion = $args[0]

#-------------------------------------------------
Write-Output 'Deleting old CEF binaries...'
#-------------------------------------------------

$destinationPart = 'cef.tar'
$destination = "$destinationPart.bz2"

$cefPath = 'deps/cef'
Remove-Item $destinationPart -ErrorAction Ignore
Remove-Item $destination -ErrorAction Ignore
Remove-Item -LiteralPath $cefPath -Force -Recurse -ErrorAction Ignore

#-------------------------------------------------
Write-Output 'Locating 7Zip'
#-------------------------------------------------

function Get-SzRegistry {
    $reg = [Microsoft.Win32.RegistryKey]::OpenBaseKey([Microsoft.Win32.RegistryHive]::LocalMachine, [Microsoft.Win32.RegistryView]::Registry64)

    if ($null -eq $reg) {
        return $null
    }

    $szKey = $reg.OpenSubKey('SOFTWARE')
    if ($null -eq $szKey) {
        return $null
    }

    $szKey = $szKey.OpenSubKey('7-Zip')
    if ($null -eq $szKey) {
        return $null
    }

    return $szKey.GetValue('Path') + '7z.exe'
}

function Get-SzDefaultPaths {
    $path = "$env:ProgramFiles\7-Zip\7z.exe"

    if(-Not(Test-Path -Path $path -PathType Leaf)) {
        $path = "$env:ProgramW6432\7-Zip\7z.exe"
    }

    if(-Not(Test-Path -Path $path -PathType Leaf)) {
        $path = "${env:ProgramFiles(x86)}\7-Zip\7z.exe"
    }

    if(-Not(Test-Path -Path $path -PathType Leaf)) {
        return $null
    }

    return $path
}

$sz = Get-SzRegistry

if ($null -eq $sz) {
    $sz = Get-SzDefaultPaths
}

if ($null -eq $sz) {
    Write-Error -Message 'Could not locate 7Zip. Make sure you have 7Zip installed and try again.'
    exit 1
}

#-------------------------------------------------
Write-Output 'Downloading CEF...'
#-------------------------------------------------

Add-Type -AssemblyName System.Web
$cefURLVersion = [System.Web.HttpUtility]::UrlEncode($cefVersion) 

$source = "https://cef-builds.spotifycdn.com/$cefURLVersion.tar.bz2"
(New-Object Net.WebClient).DownloadFile($source, $destination)

#-------------------------------------------------
Write-Output 'Unpacking CEF...'
#-------------------------------------------------

& "$sz" x $destination -aoa
& "$sz" x $destinationPart -aoa

Move-Item -Path $cefVersion -Destination $cefPath

#-------------------------------------------------
Write-Output 'Doing cleanup...'
#-------------------------------------------------

Remove-Item $destinationPart
Remove-Item $destination

#-------------------------------------------------
Write-Output 'Done!'
