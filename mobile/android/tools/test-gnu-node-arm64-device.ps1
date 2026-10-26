# Requires PowerShell 7/Windows PowerShell, Python 3 and Android SDK adb.
# Diagnostic only: Android GNU/glibc runtime is NOT a production release.
param(
    [Parameter(Mandatory = $true)][string]$ApkPath,
    [ValidateRange(30, 900)][int]$TimeoutSeconds = 420
)
$ErrorActionPreference = 'Stop'
$package = 'dev.seven.code.gnu'
$apk = (Resolve-Path -LiteralPath $ApkPath).Path
if (!(Test-Path -LiteralPath '.seven/android/verify-gnu-apk.py')) {
    throw 'Execute a partir da raiz do repositório Seven-code.'
}
foreach ($tool in @('adb', 'python')) {
    if (!(Get-Command $tool -ErrorAction SilentlyContinue)) {
        throw "Ferramenta necessária ausente no PATH: $tool"
    }
}
& python .seven/android/verify-gnu-apk.py $apk
if ($LASTEXITCODE -ne 0) { throw 'APK GNU original não passou na verificação de integridade.' }
$lines = @(& adb devices -l)
$devices = @($lines | Where-Object { $_ -match '^([^\s]+)\s+device\s' })
if ($devices.Count -ne 1) {
    throw "Conecte exatamente UM Android ARM64 físico com depuração USB autorizada. ADB: $($devices.Count) dispositivos."
}
$serial = ([regex]::Match($devices[0], '^([^\s]+)')).Groups[1].Value
function Device([string[]]$Parts) {
    $result = @(& adb -s $serial @Parts 2>$null)
    if ($LASTEXITCODE -ne 0) { throw "ADB falhou ao executar: $($Parts[0])" }
    return ($result -join [Environment]::NewLine).Trim()
}
$abi = Device @('shell', 'getprop', 'ro.product.cpu.abi')
$qemu = Device @('shell', 'getprop', 'ro.kernel.qemu')
$sdk = Device @('shell', 'getprop', 'ro.build.version.sdk')
Write-Host "Android ABI: $abi; API: $sdk; qemu: $qemu"
if ($abi -ne 'arm64-v8a' -or $qemu -eq '1') {
    throw 'Exige Android ARM64 físico; tradução x86_64 e emulador NÃO qualificam o GNU Node.'
}
if ([int]$sdk -lt 26) { throw 'Este APK requer Android API 26+.' }
$existing = @(& adb -s $serial shell pm path $package 2>$null)
if ($existing -match 'package:') {
    throw "O pacote de teste $package já está instalado. Remova APENAS esse pacote manualmente se desejar substituí-lo; o script não apaga dados."
}
Write-Host "Instalando o GNU APK de teste com ID independente: $package"
& adb -s $serial install -t $apk
if ($LASTEXITCODE -ne 0) { throw 'Falha na instalação do APK GNU isolado.' }
& adb -s $serial shell monkey -p $package -c android.intent.category.LAUNCHER 1 | Out-Null
if ($LASTEXITCODE -ne 0) { throw 'Falha ao iniciar o aplicativo GNU de teste.' }

function Read-Probe([string]$Name) {
    $value = @(& adb -s $serial shell run-as $package cat "files/seven-code-oss-local/$Name" 2>$null)
    return ($value -join [Environment]::NewLine).Trim()
}
$deadline = (Get-Date).AddSeconds($TimeoutSeconds)
$phase = ''
while ((Get-Date) -lt $deadline) {
    Start-Sleep -Seconds 2
    $phase = Read-Probe 'startup-phase.txt'
    $version = Read-Probe 'gnu-node-version-probe.log'
    $ipc = Read-Probe 'gnu-node-fork-probe.log'
    if ($version -match '^v[0-9]+\.' -and $ipc -match 'SEVEN_GNU_FORK_IPC_OK') {
        $nodeVersion = ($version -split '\s+')[0]
        Write-Host "APROVADO NO DISPOSITIVO: GNU Node $nodeVersion e IPC real child_process.fork."
        Write-Host "ABI e proveniência: $(Read-Probe 'gnu-platform-probe.txt')"
        Write-Host 'Isso NÃO homologa o Copilot Agent nem o workbench completo.'
        exit 0
    }
    if ($phase.StartsWith('failed-at:')) { break }
}
$platform = Read-Probe 'gnu-platform-probe.txt'
$version = Read-Probe 'gnu-node-version-probe.log'
$ipc = Read-Probe 'gnu-node-fork-probe.log'
function Redact([string]$Value) {
    $clean = [regex]::Replace($Value, '[a-fA-F0-9]{64}', '[redacted-token]')
    return $clean.Substring(0, [Math]::Min(700, $clean.Length))
}
Write-Warning "GNU Node não passou no ARM64 físico. Fase: $(Redact $phase)"
Write-Host "Plataforma: $(Redact $platform)"
Write-Host "Node --version: $(Redact $version)"
Write-Host "Fork/IPC: $(Redact $ipc)"
Write-Host 'Para SIGSYS use: adb logcat -d -b crash (evite compartilhar dados privados).'
throw 'GNU Node ARM64 não homologado: verifique os logs acima.'
