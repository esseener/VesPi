# 捆绑版 Laya 初始化（Windows）
# 把随包的 vendor 源码装进应用本地 venv，不写全局 PATH。
# 用法: bootstrap.cmd   （VesPi 首次汉化对账时自动调用）

$ErrorActionPreference = 'Stop'
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$vendor = Join-Path $here 'vendor'
$venv = Join-Path $here 'venv'

if (Test-Path (Join-Path $venv 'Scripts\python.exe')) {
  Write-Host '[laya] venv already exists'
  exit 0
}

Write-Host '[laya] creating local venv...'
python -m venv $venv
$pip = Join-Path $venv 'Scripts\python.exe'
& $pip -m pip install -U pip setuptools wheel
& $pip -m pip install -e $vendor
Write-Host '[laya] ready:' $venv
