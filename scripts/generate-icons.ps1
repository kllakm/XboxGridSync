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

    # 1. Main sphere with vibrant modern Xbox green gradient (#00D05E to #00FF87)
    $sphereBrush = New-Object System.Drawing.Drawing2D.LinearGradientBrush (
        (New-Object System.Drawing.PointF 24, 16),
        (New-Object System.Drawing.PointF 232, 240),
        ([System.Drawing.Color]::FromArgb(255, 0, 208, 94)),
        ([System.Drawing.Color]::FromArgb(255, 0, 255, 135))
    )
    $g.FillEllipse($sphereBrush, 12, 12, 232, 232)

    # 2. Cutouts matching titlebar SVG exactly (#0d0f12)
    # No white rim, no grey reflection crescent!
    $cutoutBrush = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(255, 13, 15, 18))

    # Top Cutout
    $topPath = New-Object System.Drawing.Drawing2D.GraphicsPath
    $topPath.StartFigure()
    $topPath.AddBezier([float]71.1, [float]71.1, [float]92.4, [float]99.6, [float]128.0, [float]135.1, [float]128.0, [float]170.7)
    $topPath.AddBezier([float]128.0, [float]170.7, [float]128.0, [float]135.1, [float]163.6, [float]99.6, [float]184.9, [float]71.1)
    $topPath.AddBezier([float]184.9, [float]71.1, [float]149.3, [float]56.9, [float]106.7, [float]56.9, [float]71.1, [float]71.1)
    $topPath.CloseFigure()
    $g.FillPath($cutoutBrush, $topPath)

    # Left Cutout
    $leftPath = New-Object System.Drawing.Drawing2D.GraphicsPath
    $leftPath.StartFigure()
    $leftPath.AddBezier([float]49.8, [float]92.4, [float]71.1, [float]113.8, [float]99.6, [float]149.3, [float]85.3, [float]199.1)
    $leftPath.AddBezier([float]85.3, [float]199.1, [float]56.9, [float]170.7, [float]42.7, [float]128.0, [float]49.8, [float]92.4)
    $leftPath.CloseFigure()
    $g.FillPath($cutoutBrush, $leftPath)

    # Right Cutout
    $rightPath = New-Object System.Drawing.Drawing2D.GraphicsPath
    $rightPath.StartFigure()
    $rightPath.AddBezier([float]206.2, [float]92.4, [float]184.9, [float]113.8, [float]156.4, [float]149.3, [float]170.7, [float]199.1)
    $rightPath.AddBezier([float]170.7, [float]199.1, [float]199.1, [float]170.7, [float]213.3, [float]128.0, [float]206.2, [float]92.4)
    $rightPath.CloseFigure()
    $g.FillPath($cutoutBrush, $rightPath)

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
