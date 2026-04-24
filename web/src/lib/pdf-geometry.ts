import { Util } from "pdfjs-dist"

type PdfTextItem = {
  width?: number
  height?: number
  transform: number[]
}

type PdfTextStyle = {
  ascent?: number
  descent?: number
  vertical?: boolean
}

type PdfViewportRawDims = {
  pageWidth: number
  pageHeight: number
  pageX: number
  pageY: number
}

type PdfViewport = {
  rawDims: object
  convertToPdfPoint(x: number, y: number): number[]
}

export type PdfRect = {
  x: number
  y: number
  width: number
  height: number
}

export function getTextItemPdfRect(
  item: PdfTextItem,
  style: PdfTextStyle,
  viewport: PdfViewport,
): PdfRect | null {
  const { pageHeight, pageWidth, pageX, pageY } = viewport.rawDims as PdfViewportRawDims
  const flipTransform = [1, 0, 0, -1, -pageX, pageY + pageHeight]
  const tx = Util.transform(flipTransform, item.transform)

  let angle = Math.atan2(tx[1], tx[0])
  if (style.vertical) {
    angle += Math.PI / 2
  }

  const fontHeight = Math.hypot(tx[2], tx[3])
  const ascentRatio = style.ascent ?? (style.descent ? 1 + style.descent : 0.8)
  const fontAscent = fontHeight * ascentRatio
  const advance = style.vertical ? item.height ?? 0 : item.width ?? 0

  if (fontHeight <= 0 || advance <= 0 || pageWidth <= 0 || pageHeight <= 0) {
    return null
  }

  const left = angle === 0 ? tx[4] : tx[4] + fontAscent * Math.sin(angle)
  const top = angle === 0 ? tx[5] - fontAscent : tx[5] - fontAscent * Math.cos(angle)

  const widthVectorX = Math.cos(angle) * advance
  const widthVectorY = Math.sin(angle) * advance
  const heightVectorX = -Math.sin(angle) * fontHeight
  const heightVectorY = Math.cos(angle) * fontHeight

  const corners = [
    viewport.convertToPdfPoint(left, top),
    viewport.convertToPdfPoint(left + widthVectorX, top + widthVectorY),
    viewport.convertToPdfPoint(left + heightVectorX, top + heightVectorY),
    viewport.convertToPdfPoint(
      left + widthVectorX + heightVectorX,
      top + widthVectorY + heightVectorY,
    ),
  ]

  const xs = corners.map(([x]) => x)
  const ys = corners.map(([, y]) => y)
  const minX = Math.min(...xs)
  const maxX = Math.max(...xs)
  const minY = Math.min(...ys)
  const maxY = Math.max(...ys)

  if (!Number.isFinite(minX) || !Number.isFinite(minY) || !Number.isFinite(maxX) || !Number.isFinite(maxY)) {
    return null
  }

  return {
    x: minX,
    y: minY,
    width: maxX - minX,
    height: maxY - minY,
  }
}
