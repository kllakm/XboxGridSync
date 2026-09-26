Add-Type -AssemblyName System.Drawing

function Create-XboxGridSyncIcon {
    param (
        [string]$PngPath,
        [string]$IcoPath
    )

    $masterSize = 256
    $masterBmp = New-Object System.Drawing.Bitmap $masterSize, $masterSize, ([System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
    $g = [System.Drawing.Graphics]::FromImage($masterBmp)
    $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
    $g.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
    $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
    $g.Clear([System.Drawing.Color]::Transparent)

    function Create-RoundedRectPath {
        param ($x, $y, $w, $h, $r)
        $path = New-Object System.Drawing.Drawing2D.GraphicsPath
        $d = $r * 2
        $path.AddArc($x, $y, $d, $d, 180, 90)
        $path.AddArc($x + $w - $d, $y, $d, $d, 270, 90)
        $path.AddArc($x + $w - $d, $y + $h - $d, $d, $d, 0, 90)
        $path.AddArc($x, $y + $h - $d, $d, $d, 90, 90)
        $path.CloseFigure()
        return $path
    }

    $sqSize = 132
    $rad = 32
    $gap = 12
    $backX, $backY = 92, 32
    $frontX, $frontY = 32, 92

    # 1. Back Square: Rich deep Xbox emerald gradient
    $backPath = Create-RoundedRectPath $backX $backY $sqSize $sqSize $rad
    $backGrad = New-Object System.Drawing.Drawing2D.LinearGradientBrush (
        (New-Object System.Drawing.PointF $backX, $backY),
        (New-Object System.Drawing.PointF ($backX + $sqSize), ($backY + $sqSize)),
        ([System.Drawing.Color]::FromArgb(255, 0, 168, 70)),
        ([System.Drawing.Color]::FromArgb(255, 0, 92, 36))
    )
    $g.FillPath($backGrad, $backPath)

    # 2. Transparent negative space cutout for crisp separation
    $cutoutPath = Create-RoundedRectPath ($frontX - $gap) ($frontY - $gap) ($sqSize + ($gap * 2)) ($sqSize + ($gap * 2)) ($rad + ($gap / 2))
    $g.CompositingMode = [System.Drawing.Drawing2D.CompositingMode]::SourceCopy
    $clearBrush = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::Transparent)
    $g.FillPath($clearBrush, $cutoutPath)

    # 3. Front Square: Luminous vivid Xbox neon gradient
    $g.CompositingMode = [System.Drawing.Drawing2D.CompositingMode]::SourceOver
    $frontPath = Create-RoundedRectPath $frontX $frontY $sqSize $sqSize $rad
    $frontGrad = New-Object System.Drawing.Drawing2D.LinearGradientBrush (
        (New-Object System.Drawing.PointF $frontX, $frontY),
        (New-Object System.Drawing.PointF ($frontX + $sqSize), ($frontY + $sqSize)),
        ([System.Drawing.Color]::FromArgb(255, 0, 255, 135)),
        ([System.Drawing.Color]::FromArgb(255, 0, 204, 82))
    )
    $g.FillPath($frontGrad, $frontPath)

    # Save 256x256 master PNG
    $masterBmp.Save($PngPath, [System.Drawing.Imaging.ImageFormat]::Png)

    # Multi-resolution ICO builder (256, 128, 64, 48, 32, 24, 16)
    $targetSizes = @(256, 128, 64, 48, 32, 24, 16)
    $pngByteArrays = @()

    foreach ($s in $targetSizes) {
        if ($s -eq 256) {
            $ms = New-Object System.IO.MemoryStream
            $masterBmp.Save($ms, [System.Drawing.Imaging.ImageFormat]::Png)
            $pngByteArrays += ,($ms.ToArray())
            $ms.Dispose()
        } else {
            $resized = New-Object System.Drawing.Bitmap $s, $s, ([System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
            $rg = [System.Drawing.Graphics]::FromImage($resized)
            $rg.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
            $rg.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
            $rg.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
            $rg.DrawImage($masterBmp, 0, 0, $s, $s)

            $ms = New-Object System.IO.MemoryStream
            $resized.Save($ms, [System.Drawing.Imaging.ImageFormat]::Png)
            $pngByteArrays += ,($ms.ToArray())
            $ms.Dispose()
            $rg.Dispose()
            $resized.Dispose()
        }
    }

    # Write multi-res ICO binary structure
    $fs = New-Object System.IO.FileStream $IcoPath, ([System.IO.FileMode]::Create)
    $bw = New-Object System.IO.BinaryWriter $fs

    $imageCount = $targetSizes.Count
    # Header: Reserved (0), Type (1 = ICO), Count
    $bw.Write([uint16]0)
    $bw.Write([uint16]1)
    $bw.Write([uint16]$imageCount)

    # Calculate offset for first image: 6 bytes header + (16 bytes * count)
    $offset = 6 + (16 * $imageCount)

    for ($i = 0; $i -lt $imageCount; $i++) {
        $s = $targetSizes[$i]
        $w = if ($s -ge 256) { [byte]0 } else { [byte]$s }
        $h = if ($s -ge 256) { [byte]0 } else { [byte]$s }
        $length = $pngByteArrays[$i].Length

        $bw.Write($w)             # Width
        $bw.Write($h)             # Height
        $bw.Write([byte]0)        # ColorCount
        $bw.Write([byte]0)        # Reserved
        $bw.Write([uint16]1)      # Planes
        $bw.Write([uint16]32)     # BitCount (32bpp ARGB)
        $bw.Write([uint32]$length) # Bytes in resource
        $bw.Write([uint32]$offset) # Offset

        $offset += $length
    }

    # Write each image payload
    for ($i = 0; $i -lt $imageCount; $i++) {
        $bw.Write($pngByteArrays[$i])
    }

    $bw.Flush()
    $bw.Close()
    $fs.Close()

    $g.Dispose()
    $masterBmp.Dispose()
    Write-Output "Successfully generated pristine multi-resolution Xbox icon at $PngPath and $IcoPath"
}

# Ensure destination folders exist
$assetsDir = "src\assets"
$buildDir = "build"
if (!(Test-Path $assetsDir)) { New-Item -ItemType Directory -Path $assetsDir | Out-Null }
if (!(Test-Path $buildDir)) { New-Item -ItemType Directory -Path $buildDir | Out-Null }

Create-XboxGridSyncIcon -PngPath "$assetsDir\icon.png" -IcoPath "$assetsDir\icon.ico"
Copy-Item "$assetsDir\icon.png" "$buildDir\icon.png" -Force
Copy-Item "$assetsDir\icon.ico" "$buildDir\icon.ico" -Force
