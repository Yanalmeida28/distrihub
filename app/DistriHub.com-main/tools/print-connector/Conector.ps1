$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing
Add-Type -AssemblyName System.Windows.Forms
Add-Type -ReferencedAssemblies System.Drawing -TypeDefinition @'
using System;
using System.Collections.Generic;
using System.Drawing;
using System.Drawing.Printing;
using System.Drawing.Drawing2D;
using System.IO;
public static class DistriHubPrinter {
 // Remove only blank side margins to avoid or minimize shrinking the receipt.
 // The browser includes paper margins; the thermal driver reserves them again.
 public static Rectangle ReceiptBounds(Bitmap image, int printablePixels) {
  if(printablePixels < 1) throw new ArgumentOutOfRangeException("printablePixels");
  int excess = image.Width - printablePixels;
  if(excess <= 0) return new Rectangle(0, 0, image.Width, image.Height);
  int left = 0, right = image.Width;
  while(right - left > printablePixels) {
   bool removed = false;
   if(BlankColumn(image, left)) { left++; removed = true; }
   if(right - left > printablePixels && BlankColumn(image, right - 1)) { right--; removed = true; }
   // Narrow 58 mm drivers may still need a small reduction after blank margins
   // are exhausted. Keep the safe crop instead of shrinking those margins too.
   if(!removed) break;
  }
  return new Rectangle(left, 0, right - left, image.Height);
 }
 private static bool BlankColumn(Bitmap image, int x) {
  for(int y = 0; y < image.Height; y++) {
   Color pixel = image.GetPixel(x, y);
   if(pixel.A != 0 && (pixel.R < 255 || pixel.G < 255 || pixel.B < 255)) return false;
  }
  return true;
 }
 public static void DrawReceiptSlice(Graphics graphics, Image image, RectangleF destination, Rectangle source) {
  graphics.InterpolationMode = InterpolationMode.NearestNeighbor;
  graphics.PixelOffsetMode = PixelOffsetMode.Half;
  graphics.SmoothingMode = SmoothingMode.None;
  graphics.DrawImage(image, destination, source, GraphicsUnit.Pixel);
 }
 public static string[] Printers() {
  var names = new List<string>();
  foreach(string name in PrinterSettings.InstalledPrinters) names.Add(name);
  return names.ToArray();
 }
 public static void PrintImage(string name, int width, string png, int pixelWidth, int pixelHeight) {
  var bytes = Convert.FromBase64String(png);
  // Check PNG dimensions before decoding to bound bitmap allocation.
  if(bytes.Length < 24 || bytes.Length > 6000000 || bytes[0] != 137 || bytes[1] != 80 || bytes[2] != 78 || bytes[3] != 71 || bytes[4] != 13 || bytes[5] != 10 || bytes[6] != 26 || bytes[7] != 10 || bytes[12] != 73 || bytes[13] != 72 || bytes[14] != 68 || bytes[15] != 82) throw new Exception("Imagem PNG invalida.");
  long w = ((long)bytes[16]<<24) | ((long)bytes[17]<<16) | ((long)bytes[18]<<8) | bytes[19];
  long h = ((long)bytes[20]<<24) | ((long)bytes[21]<<16) | ((long)bytes[22]<<8) | bytes[23];
  if(w != pixelWidth || h != pixelHeight || w < 1 || w > 1024 || h < 1 || h > 30000 || w*h > 22000000) throw new Exception("Dimensoes do cupom invalidas.");
  using(var stream = new MemoryStream(bytes))
  using(var image = new Bitmap(stream))
  using(var document = new PrintDocument()) {
   document.PrinterSettings.PrinterName = name;
   if(!document.PrinterSettings.IsValid) throw new Exception("Impressora nao encontrada no Windows.");
   document.DocumentName = "Cupom personalizado DistriHub";
   document.PrintController = new StandardPrintController();
   document.DefaultPageSettings.Margins = new Margins(0,0,0,0);
   int paperWidth = (int)Math.Round(width / 25.4 * 100);
   int paperHeight = (int)Math.Min(1100, Math.Max(100, Math.Ceiling((double)image.Height * paperWidth / image.Width + 16)));
   document.DefaultPageSettings.PaperSize = new PaperSize("Cupom", paperWidth, paperHeight);
   int cursor = 0;
   document.PrintPage += (sender, page) => {
    float availableWidth = Math.Min(page.PageBounds.Width - 2 * page.PageSettings.HardMarginX, page.PageSettings.PrintableArea.Width);
    float availableHeight = Math.Min(page.PageBounds.Height - 2 * page.PageSettings.HardMarginY, page.PageSettings.PrintableArea.Height);
    if(availableWidth <= 0 || availableHeight <= 0) throw new Exception("Area de impressao invalida. Confira o driver.");
    int printablePixels = Math.Max(1, (int)Math.Floor(availableWidth * page.Graphics.DpiX / 100f));
    Rectangle bounds = ReceiptBounds(image, printablePixels);
    float drawWidth = Math.Min(availableWidth, printablePixels * 100f / page.Graphics.DpiX);
    float ratio = drawWidth / bounds.Width;
    int slice = Math.Min(image.Height - cursor, (int)Math.Floor(availableHeight / ratio));
    if(slice < 1) throw new Exception("Papel insuficiente para o cupom.");
    DrawReceiptSlice(page.Graphics, image, new RectangleF(0,0,drawWidth,slice*ratio), new Rectangle(bounds.Left,cursor,bounds.Width,slice));
    cursor += slice;
    page.HasMorePages = cursor < image.Height;
   };
   document.Print();
  }
 }
 public static void Print(string name, int width, string text) {
  using(var document = new PrintDocument()) {
   document.PrinterSettings.PrinterName = name;
   if(!document.PrinterSettings.IsValid) throw new Exception("Impressora nao encontrada no Windows.");
   document.DocumentName = "Cupom DistriHub";
   document.PrintController = new StandardPrintController();
   document.DefaultPageSettings.Margins = new Margins(8,8,8,8);
   document.DefaultPageSettings.PaperSize = new PaperSize("Cupom", (int)Math.Round(width / 25.4 * 100), 1100);
   var lines = text.Replace("\r", "").Split('\n');
   int cursor = 0;
   using(var font = new Font("Arial", 9)) {
    using(var measurement = document.PrinterSettings.CreateMeasurementGraphics()) {
     float measuredHeight = 24;
     foreach(var line in lines) measuredHeight += Math.Max(font.GetHeight(measurement), measurement.MeasureString(line, font, document.DefaultPageSettings.PaperSize.Width - 16).Height);
     document.DefaultPageSettings.PaperSize = new PaperSize("Cupom", document.DefaultPageSettings.PaperSize.Width, (int)Math.Min(1100, Math.Max(100, Math.Ceiling(measuredHeight))));
    }
    document.PrintPage += (sender, page) => {
     float top = page.MarginBounds.Top;
     float availableWidth = Math.Min(page.MarginBounds.Width, page.PageSettings.PrintableArea.Width);
     while(cursor < lines.Length) {
      var line = lines[cursor];
      var height = Math.Max(font.GetHeight(page.Graphics), page.Graphics.MeasureString(line, font, (int)availableWidth).Height);
      if(top + height > page.MarginBounds.Bottom && top > page.MarginBounds.Top) break;
      page.Graphics.DrawString(line, font, Brushes.Black, new RectangleF(page.MarginBounds.Left, top, availableWidth, height));
      top += height; cursor++;
     }
     page.HasMorePages = cursor < lines.Length;
    };
    document.Print();
   }
  }
 }
}
'@
# Single listener per computer. It accepts browser requests only from DistriHub.
$listener = New-Object System.Net.HttpListener
$listener.Prefixes.Add('http://localhost:17891/')
try { $listener.Start() } catch { exit 1 }
$jobs = @{}
while ($listener.IsListening) {
 $context = $listener.GetContext()
 $response = $context.Response
 try {
  if (-not [System.Net.IPAddress]::IsLoopback($context.Request.RemoteEndPoint.Address)) { $response.StatusCode = 403; throw 'Apenas conexoes locais.' }
  $origin = $context.Request.Headers['Origin']
  if ($origin -notin @('https://distrihub.com.br', 'https://www.distrihub.com.br')) { $response.StatusCode = 403; throw 'Origem nao autorizada.' }
  $response.Headers.Add('Access-Control-Allow-Origin', $origin)
  $response.Headers.Add('Vary', 'Origin')
  $response.Headers.Add('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
  $response.Headers.Add('Access-Control-Allow-Headers', 'Content-Type')
  $response.Headers.Add('Access-Control-Allow-Private-Network', 'true')
  $response.Headers.Add('Cache-Control', 'no-store')
  if ($context.Request.HttpMethod -eq 'OPTIONS') { $response.StatusCode = 204; continue }
  $path = $context.Request.Url.AbsolutePath
  if ($path -eq '/printers' -and $context.Request.HttpMethod -eq 'GET') {
   $result = @{ printers = @([DistriHubPrinter]::Printers()); version = 2; capabilities = @('receipt-png-v1') }
  } elseif ($path -eq '/print' -and $context.Request.HttpMethod -eq 'POST') {
   if ($context.Request.ContentType -notmatch '^application/json' -or $context.Request.ContentLength64 -lt 1 -or $context.Request.ContentLength64 -gt 8100000) { $response.StatusCode = 400; throw 'Pedido de impressao invalido.' }
   $reader = New-Object System.IO.StreamReader($context.Request.InputStream, [System.Text.Encoding]::UTF8)
   try { $payload = $reader.ReadToEnd() | ConvertFrom-Json } finally { $reader.Dispose() }
   $jobId = [guid]::Empty
   if (-not [guid]::TryParse([string]$payload.id, [ref]$jobId) -or $payload.width -notin @(58,80) -or $payload.printer -notin @([DistriHubPrinter]::Printers())) { $response.StatusCode = 400; throw 'Confira a impressora e o tamanho do cupom.' }
   $imageMode = $payload.format -eq 'receipt-png-v1'
   if ($imageMode) {
    if ($payload.png -isnot [string] -or $payload.png.Length -gt 8000000 -or $payload.pixelWidth -lt 1 -or $payload.pixelWidth -gt 1024 -or $payload.pixelHeight -lt 1 -or $payload.pixelHeight -gt 30000) { $response.StatusCode = 400; throw 'Imagem do cupom invalida.' }
   } elseif ($payload.format -or $payload.text -isnot [string] -or $payload.text.Length -gt 50000) { $response.StatusCode = 400; throw 'Formato de cupom invalido.' }
   if ($jobs.ContainsKey($payload.id)) {
    if ($jobs[$payload.id].status -ne 'queued') { $response.StatusCode = 409; throw 'Impressao anterior sem confirmacao. Confira o cupom antes de reenviar.' }
   } else {
    if ($jobs.Count -ge 10000) { $response.StatusCode = 503; throw 'Reinicie o conector antes de imprimir novos cupons.' }
    $jobs[$payload.id] = @{ status = 'uncertain' }
    if ($imageMode) {
     [DistriHubPrinter]::PrintImage($payload.printer, [int]$payload.width, $payload.png, [int]$payload.pixelWidth, [int]$payload.pixelHeight)
    } else {
     [DistriHubPrinter]::Print($payload.printer, [int]$payload.width, $payload.text)
    }
    $jobs[$payload.id] = @{ status = 'queued' }
   }
   $result = @{ status = 'queued' }
  } else { $response.StatusCode = 404; throw 'Endereco nao encontrado.' }
  $json = $result | ConvertTo-Json -Compress
 } catch {
  if ($response.StatusCode -eq 200) { $response.StatusCode = 500 }
  $json = @{ error = $_.Exception.Message } | ConvertTo-Json -Compress
 } finally {
  if ($response.StatusCode -ne 204) {
   $bytes = [System.Text.Encoding]::UTF8.GetBytes($json)
   $response.ContentType = 'application/json; charset=utf-8'
   $response.ContentLength64 = $bytes.Length
   try { $response.OutputStream.Write($bytes,0,$bytes.Length) } catch {}
  }
  $response.Close()
 }
}
