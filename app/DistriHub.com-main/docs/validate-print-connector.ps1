$ErrorActionPreference = 'Stop'
$source = Get-Content -Raw -LiteralPath (Join-Path $PSScriptRoot '../tools/print-connector/Conector.ps1')
$match = [regex]::Match($source, "(?s)-TypeDefinition @'\r?\n(.*?)\r?\n'@")
if (-not $match.Success) { throw 'Embedded C# not found' }
Add-Type -ReferencedAssemblies System.Drawing -TypeDefinition $match.Groups[1].Value
# Only compile the connector. Never start its listener or call Print / PrintImage.
foreach ($file in @('Conector.ps1','Instalar.ps1')) {
 $parseErrors = $null
 $tokens = $null
 [System.Management.Automation.Language.Parser]::ParseFile((Join-Path $PSScriptRoot "../tools/print-connector/$file"), [ref]$tokens, [ref]$parseErrors) | Out-Null
 if ($parseErrors.Count) { throw ($parseErrors | Out-String) }
}
Add-Type -AssemblyName System.Drawing
$bitmap = New-Object System.Drawing.Bitmap(640, 120)
$graphics = [System.Drawing.Graphics]::FromImage($bitmap)
try {
 $graphics.Clear([System.Drawing.Color]::White)
 # Two-pixel strokes inside the browser's 32-pixel side margins.
 for ($x = 32; $x -lt 608; $x += 4) { $graphics.FillRectangle([System.Drawing.Brushes]::Black, $x, 10, 2, 100) }
 $bounds = [DistriHubPrinter]::ReceiptBounds($bitmap, 576)
 if ($bounds.X -ne 32 -or $bounds.Width -ne 576) { throw 'Blank paper margins must fit 640 pixels into 576 without shrinking text.' }
 $output = New-Object System.Drawing.Bitmap(576, 120)
 $outputGraphics = [System.Drawing.Graphics]::FromImage($output)
 try {
  [DistriHubPrinter]::DrawReceiptSlice($outputGraphics, $bitmap, [System.Drawing.RectangleF]::new(0, 0, 576, 120), $bounds)
  for ($x = 0; $x -lt 576; $x++) {
   if ($output.GetPixel($x, 50).ToArgb() -ne $bitmap.GetPixel($x + 32, 50).ToArgb()) { throw 'Thermal text strokes changed or acquired gray edges.' }
  }
 } finally { $outputGraphics.Dispose(); $output.Dispose() }
 # Occupied margins must never be cropped, even if fitting then requires scaling.
 $bitmap.SetPixel(0, 0, [System.Drawing.Color]::Black)
 $bitmap.SetPixel(639, 0, [System.Drawing.Color]::Black)
 $bounds = [DistriHubPrinter]::ReceiptBounds($bitmap, 576)
 if ($bounds.X -ne 0 -or $bounds.Width -ne 640) { throw 'Receipt content was cropped.' }
 $bounds = [DistriHubPrinter]::ReceiptBounds($bitmap, 800)
 if ($bounds.Width -ne 640) { throw 'Wider printers must retain the full image.' }
} finally { $graphics.Dispose(); $bitmap.Dispose() }
Write-Output 'Connector compiled; raster strokes preserved without gray edges; occupied margins preserved; no printer accessed.'
