# Runs only on a disposable GitHub-hosted Windows runner, never on a user's PC.
$ErrorActionPreference = 'Stop'
if ($env:GITHUB_ACTIONS -ne 'true' -or $env:RUNNER_OS -ne 'Windows') {
    throw 'Run this installation smoke check only in the Windows GitHub Actions job.'
}

$version = (Get-Content package.json -Raw | ConvertFrom-Json).version
$setup = (Resolve-Path "release/windows-installer/Impromptu-$version-Windows-x64-Setup.exe").Path
$installDir = Join-Path $env:LOCALAPPDATA 'Programs/Impromptu'
$exe = Join-Path $installDir 'Impromptu.exe'
$uninstaller = Join-Path $installDir 'Uninstall Impromptu.exe'
$desktopLink = Join-Path ([Environment]::GetFolderPath('Desktop')) 'Impromptu.lnk'
$startLink = Join-Path ([Environment]::GetFolderPath('Programs')) 'Impromptu.lnk'
$profile = Join-Path $env:APPDATA 'Impromptu'
$sentinel = Join-Path $profile 'installer-smoke-saved-data.txt'
if (Test-Path $installDir) { throw 'Expected a clean installation directory.' }
New-Item -ItemType Directory -Force $profile | Out-Null
Set-Content $sentinel 'Preserve saved user data when uninstalling.'
$env:IMPROMPTU_USER_DATA = $profile

$result = Start-Process -FilePath $setup -ArgumentList "/S /currentuser /D=$installDir" -Wait -PassThru
if ($result.ExitCode -ne 0) { throw "Installer exited with $($result.ExitCode)." }
foreach ($file in @($exe, $uninstaller, (Join-Path $installDir 'resources/app.asar'), $desktopLink, $startLink)) {
    if (!(Test-Path $file)) { throw "Installer did not create $file" }
}
$shell = New-Object -ComObject WScript.Shell
foreach ($link in @($desktopLink, $startLink)) {
    if ($shell.CreateShortcut($link).TargetPath -ne $exe) { throw "Shortcut target is incorrect: $link" }
}
$registryRoot = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall'
$registration = @(Get-ChildItem $registryRoot | Get-ItemProperty | Where-Object { $_.DisplayName -eq 'Impromptu' })
if ($registration.Count -ne 1) { throw 'Expected a per-user Add/Remove Programs registration.' }
if ($registration[0].DisplayVersion -ne $version) { throw 'Installed version registration is incorrect.' }
$originalAsar = Join-Path (Get-Location) "release/v$version/Impromptu-win32-x64/resources/app.asar"
if ((Get-FileHash $originalAsar).Hash -ne (Get-FileHash (Join-Path $installDir 'resources/app.asar')).Hash) {
    throw 'The installed runtime differs from the built application.'
}

$process = Start-Process -FilePath $exe -PassThru
try {
    Start-Sleep -Seconds 8
    $process.Refresh()
    if ($process.HasExited) { throw "The installed app exited during startup ($($process.ExitCode))." }
    if ($process.MainWindowHandle -eq 0) { throw 'The installed app did not open a desktop window.' }
    Write-Output "Installed app opened a native window: $($process.MainWindowTitle)"
} finally {
    if (!$process.HasExited) {
        # Stop only this test's process tree so uninstall can complete unattended.
        & taskkill.exe /PID $process.Id /T /F | Out-Null
        if ($LASTEXITCODE -ne 0) { throw 'Could not close the test application.' }
    }
}

$result = Start-Process -FilePath $uninstaller -ArgumentList '/S /currentuser' -Wait -PassThru
if ($result.ExitCode -ne 0) { throw "Uninstaller exited with $($result.ExitCode)." }
for ($attempt = 0; $attempt -lt 30 -and (Test-Path $exe); $attempt++) { Start-Sleep -Seconds 1 }
foreach ($file in @($exe, $desktopLink, $startLink)) {
    if (Test-Path $file) { throw "Uninstaller left $file behind." }
}
if (Test-Path $registration[0].PSPath) { throw 'Uninstall registration was not removed.' }
if (!(Test-Path $sentinel)) { throw 'Uninstaller removed saved user data.' }
Write-Output 'Verified: installation, desktop/Start Menu shortcuts, registration, runtime payload, app window, uninstall, and user-data preservation.'
