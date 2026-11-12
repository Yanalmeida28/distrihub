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
$narrow = New-Object System.Drawing.Bitmap(464, 120)
$narrowGraphics = [System.Drawing.Graphics]::FromImage($narrow)
try {
 $narrowGraphics.Clear([System.Drawing.Color]::White)
 for ($x = 32; $x -lt 432; $x += 4) { $narrowGraphics.FillRectangle([System.Drawing.Brushes]::Black, $x, 10, 2, 100) }
 $narrow.SetPixel(431, 50, [System.Drawing.Color]::Black)
 $bounds = [DistriHubPrinter]::ReceiptBounds($narrow, 384)
 if ($bounds.X -ne 32 -or $bounds.Width -ne 400 -or $bounds.Height -ne 120) { throw '58 mm must retain its safe blank-margin crop when content needs a small reduction.' }
 $output = New-Object System.Drawing.Bitmap(384, 120)
 $outputGraphics = [System.Drawing.Graphics]::FromImage($output)
 try {
  [DistriHubPrinter]::DrawReceiptSlice($outputGraphics, $narrow, [System.Drawing.RectangleF]::new(0, 0, 384, 120), $bounds)
  $black = 0
  for ($x = 0; $x -lt 384; $x++) {
   $pixel = $output.GetPixel($x, 50)
   if ($pixel.R -ne 0 -and $pixel.R -ne 255) { throw '58 mm scaling introduced gray edges.' }
   if ($pixel.R -eq 0) { $black++ }
  }
  if ($black -lt 100) { throw '58 mm text strokes were lost.' }
 } finally { $outputGraphics.Dispose(); $output.Dispose() }
 $narrow.SetPixel(0, 0, [System.Drawing.Color]::Black)
 $narrow.SetPixel(463, 119, [System.Drawing.Color]::Black)
 $bounds = [DistriHubPrinter]::ReceiptBounds($narrow, 384)
 if ($bounds.X -ne 0 -or $bounds.Width -ne 464 -or $bounds.Height -ne 120) { throw '58 mm must preserve content at paper edges.' }
} finally { $narrowGraphics.Dispose(); $narrow.Dispose() }
Write-Output 'Connector compiled; 58/80 mm raster checks passed; strokes have no added gray edges; content preserved; no printer accessed.'
