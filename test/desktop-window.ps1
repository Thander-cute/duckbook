param([int]$AppProcessId, [string]$Action)
$ErrorActionPreference = 'Stop'
Add-Type -TypeDefinition @'
using System;
using System.Text;
using System.Runtime.InteropServices;
public class DuckbookWindow {
  public delegate bool EnumProc(IntPtr hwnd, IntPtr param);
  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumProc callback, IntPtr param);
  [DllImport("user32.dll")] public static extern bool EnumChildWindows(IntPtr hwnd, EnumProc callback, IntPtr param);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hwnd, out uint pid);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetWindowText(IntPtr hwnd, StringBuilder text, int count);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetClassName(IntPtr hwnd, StringBuilder text, int count);
  [DllImport("user32.dll")] public static extern bool PostMessage(IntPtr hwnd, uint msg, IntPtr wparam, IntPtr lparam);
}
'@
for ($attempt = 0; $attempt -lt 150; $attempt++) {
  $script:clicked = $false
  $script:names = @()
  [DuckbookWindow]::EnumWindows({
    param($handle, $unused)
    $windowProcessId = [uint32]0
    [void][DuckbookWindow]::GetWindowThreadProcessId($handle, [ref]$windowProcessId)
    if ($windowProcessId -ne $AppProcessId) { return $true }
    $text = New-Object System.Text.StringBuilder 1024
    $class = New-Object System.Text.StringBuilder 256
    [void][DuckbookWindow]::GetWindowText($handle, $text, 1024)
    [void][DuckbookWindow]::GetClassName($handle, $class, 256)
    $script:names += "$class : $text"
    [DuckbookWindow]::EnumChildWindows($handle, {
      param($button, $unusedChild)
      $label = New-Object System.Text.StringBuilder 1024
      [void][DuckbookWindow]::GetWindowText($button, $label, 1024)
      $script:names += $label.ToString()
      if ($label.ToString().Replace('&', '') -eq $Action) {
        [void][DuckbookWindow]::PostMessage($button, 0x00F5, [IntPtr]::Zero, [IntPtr]::Zero)
        $script:clicked = $true
      }
      return $true
    }, [IntPtr]::Zero) | Out-Null
    return $true
  }, [IntPtr]::Zero) | Out-Null
  if ($script:clicked) { exit 0 }
  Start-Sleep -Milliseconds 100
}
throw "Dialog button '$Action' not found. Windows: $($script:names -join ' | ')"
