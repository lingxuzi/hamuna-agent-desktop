param(
  [string]$Key = "1",
  [string]$Out = "tauri-launcher.png"
)
Add-Type -AssemblyName System.Drawing
Add-Type -AssemblyName System.Windows.Forms
Add-Type @"
using System;
using System.Runtime.InteropServices;
public class W32 {
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr hWnd, out RECT r);
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr hWnd, int n);
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left,Top,Right,Bottom; }
}
"@
$h = (Get-Process -Id 17016).MainWindowHandle
[W32]::ShowWindow($h, 9) | Out-Null
[W32]::SetForegroundWindow($h) | Out-Null
Start-Sleep -Milliseconds 800
# Click once on titlebar center to ensure WebView2 has focus before SendKeys
Add-Type @"
using System;
using System.Runtime.InteropServices;
public class In {
  [DllImport("user32.dll")] public static extern void mouse_event(uint flags, uint dx, uint dy, uint data, IntPtr extra);
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr hWnd, out RECT r);
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left,Top,Right,Bottom; }
}
"@
$r2 = New-Object In+RECT
[In]::GetWindowRect($h, [ref]$r2) | Out-Null
$cx = $r2.Left + [int](($r2.Right - $r2.Left) / 2)
$cy = $r2.Top + 12   # titlebar area
[In]::mouse_event(0x0002, [uint32]$cx, [uint32]$cy, 0, [IntPtr]::Zero)   # LEFTDOWN
[In]::mouse_event(0x0004, [uint32]$cx, [uint32]$cy, 0, [IntPtr]::Zero)   # LEFTUP
Start-Sleep -Milliseconds 600
# Re-foreground window after click (click might shift z-order)
[W32]::SetForegroundWindow($h) | Out-Null
Start-Sleep -Milliseconds 300
# Send Ctrl+<key> to switch surface (same shortcut as the Playwright snapshot script)
[System.Windows.Forms.SendKeys]::SendWait("^{$Key}")
Start-Sleep -Milliseconds 900
$r = New-Object W32+RECT
[W32]::GetWindowRect($h, [ref]$r) | Out-Null
$w = $r.Right - $r.Left
$ht = $r.Bottom - $r.Top
$bmp = New-Object System.Drawing.Bitmap $w, $ht
$g = [System.Drawing.Graphics]::FromImage($bmp)
$g.CopyFromScreen($r.Left, $r.Top, 0, 0, $bmp.Size)
$dir = "D:\Coding\hamuna-agent-desktop\v2-shots"
New-Item -ItemType Directory -Force -Path $dir | Out-Null
$out = Join-Path $dir $Out
$bmp.Save($out, [System.Drawing.Imaging.ImageFormat]::Png)
Write-Host "saved $out"
