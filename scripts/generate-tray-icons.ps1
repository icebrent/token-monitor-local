# Run with PowerShell 7 on Windows. Generates a local UI asset, without downloads.
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing
$size = 64
$bitmap = [System.Drawing.Bitmap]::new(102 * $size, 2 * $size)
$graphics = [System.Drawing.Graphics]::FromImage($bitmap)
$graphics.SmoothingMode = 'AntiAlias'
$graphics.TextRenderingHint = 'AntiAliasGridFit'
$format = [System.Drawing.StringFormat]::GenericTypographic.Clone()
$format.FormatFlags = [System.Drawing.StringFormatFlags]::NoWrap
$format.Alignment = 'Center'
$format.LineAlignment = 'Center'
$font = [System.Drawing.Font]::new('Consolas', 46, [System.Drawing.FontStyle]::Bold, [System.Drawing.GraphicsUnit]::Pixel)
$smallFont = [System.Drawing.Font]::new('Consolas', 33, [System.Drawing.FontStyle]::Bold, [System.Drawing.GraphicsUnit]::Pixel)
$outputDirectory = Join-Path $PSScriptRoot '../assets/tray-quotas'
[System.IO.Directory]::CreateDirectory($outputDirectory) | Out-Null

function Write-QuotaIco($source, $column, $row) {
    $sizes = @(16, 20, 24, 32, 40, 48, 64)
    $images = [System.Collections.Generic.List[byte[]]]::new()
    foreach ($dimension in $sizes) {
        $frame = [System.Drawing.Bitmap]::new($dimension, $dimension)
        $drawing = [System.Drawing.Graphics]::FromImage($frame)
        $stream = [System.IO.MemoryStream]::new()
        try {
            $drawing.InterpolationMode = 'HighQualityBicubic'
            $drawing.PixelOffsetMode = 'HighQuality'
            $drawing.DrawImage($source, [System.Drawing.Rectangle]::new(0, 0, $dimension, $dimension), [System.Drawing.Rectangle]::new($column * 64, $row * 64, 64, 64), [System.Drawing.GraphicsUnit]::Pixel)
            $frame.Save($stream, [System.Drawing.Imaging.ImageFormat]::Png)
            $images.Add($stream.ToArray())
        } finally { $stream.Dispose(); $drawing.Dispose(); $frame.Dispose() }
    }
    $name = if ($column -eq 101) { 'unknown' } else { [string]$column }
    if ($row -eq 1) { $name += '-stale' }
    $file = [System.IO.File]::Create((Join-Path $outputDirectory "$name.ico"))
    $writer = [System.IO.BinaryWriter]::new($file)
    try {
        $writer.Write([uint16]0); $writer.Write([uint16]1); $writer.Write([uint16]$sizes.Count)
        $offset = 6 + 16 * $sizes.Count
        for ($index = 0; $index -lt $sizes.Count; $index++) {
            $writer.Write([byte]$sizes[$index]); $writer.Write([byte]$sizes[$index])
            $writer.Write([byte]0); $writer.Write([byte]0)
            $writer.Write([uint16]1); $writer.Write([uint16]32)
            $writer.Write([uint32]$images[$index].Length); $writer.Write([uint32]$offset)
            $offset += $images[$index].Length
        }
        foreach ($bytes in $images) { $writer.Write([byte[]]$bytes) }
    } finally { $writer.Dispose(); $file.Dispose() }
}
try {
    for ($row = 0; $row -lt 2; $row++) {
        for ($value = 0; $value -le 101; $value++) {
            $x = $value * $size
            $y = $row * $size
            $unknown = $value -eq 101
            $hex = if ($row -eq 1 -or $unknown) { '#9ca6b8' } elseif ($value -gt 30) { '#88e0bf' } elseif ($value -gt 10) { '#f2c16d' } else { '#ff9292' }
            $foreground = [System.Drawing.SolidBrush]::new([System.Drawing.ColorTranslator]::FromHtml($hex))
            $background = [System.Drawing.SolidBrush]::new([System.Drawing.ColorTranslator]::FromHtml('#111318'))
            $track = [System.Drawing.SolidBrush]::new([System.Drawing.ColorTranslator]::FromHtml('#343840'))
            $outline = [System.Drawing.Drawing2D.GraphicsPath]::new()
            try {
                $outline.AddArc($x + 1, $y + 1, 18, 18, 180, 90)
                $outline.AddArc($x + 45, $y + 1, 18, 18, 270, 90)
                $outline.AddArc($x + 45, $y + 45, 18, 18, 0, 90)
                $outline.AddArc($x + 1, $y + 45, 18, 18, 90, 90)
                $outline.CloseFigure()
                $graphics.FillPath($background, $outline)
                $text = if ($unknown) { [string][char]0x2014 } else { [string]$value }
                $numberFont = if ($value -eq 100) { $smallFont } else { $font }
                $graphics.DrawString($text, $numberFont, $foreground, [System.Drawing.RectangleF]::new($x, $y - 1, 64, 57), $format)
                $graphics.FillRectangle($track, $x + 9, $y + 57, 46, 3)
                if (!$unknown -and $value -gt 0) { $graphics.FillRectangle($foreground, [single]($x + 9), [single]($y + 57), [single](46 * $value / 100), [single]3) }
                # A small dot distinguishes the last known value from fresh data.
                if ($row -eq 1 -and !$unknown) { $graphics.FillEllipse($foreground, $x + 53, $y + 7, 4, 4) }
            } finally { $foreground.Dispose(); $background.Dispose(); $track.Dispose(); $outline.Dispose() }
        }
    }
    for ($row = 0; $row -lt 2; $row++) {
        for ($value = 0; $value -le 101; $value++) { Write-QuotaIco $bitmap $value $row }
    }
} finally { $font.Dispose(); $smallFont.Dispose(); $format.Dispose(); $graphics.Dispose(); $bitmap.Dispose() }
