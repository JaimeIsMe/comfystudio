const fs = require('fs').promises

const ISO_BOX_HEADER_BYTES = 8
const ISO_EXTENDED_BOX_HEADER_BYTES = 16
const MAX_TOP_LEVEL_BOXES = 10000
const DEFAULT_RENDERER_HEADER_LIMIT_BYTES = 64 * 1024 * 1024

const readBoxSize = (header, fileSize, offset) => {
  const size32 = header.readUInt32BE(0)
  if (size32 === 0) {
    return { boxSize: fileSize - offset, headerSize: ISO_BOX_HEADER_BYTES }
  }
  if (size32 !== 1) {
    return { boxSize: size32, headerSize: ISO_BOX_HEADER_BYTES }
  }
  if (header.length < ISO_EXTENDED_BOX_HEADER_BYTES) return null
  const size64 = header.readBigUInt64BE(8)
  if (size64 > BigInt(Number.MAX_SAFE_INTEGER)) return null
  return { boxSize: Number(size64), headerSize: ISO_EXTENDED_BOX_HEADER_BYTES }
}

/**
 * Read only ISO-BMFF top-level headers so very large media files never enter
 * the Electron renderer just to discover where their movie index lives.
 */
async function inspectIsoBmffLayout(filePath, { maxHeaderBytes = DEFAULT_RENDERER_HEADER_LIMIT_BYTES } = {}) {
  const handle = await fs.open(filePath, 'r')
  try {
    const stat = await handle.stat()
    const fileSize = Number(stat.size)
    if (!Number.isFinite(fileSize) || fileSize < ISO_BOX_HEADER_BYTES) {
      return { recognized: false, streamable: false, fileSize }
    }

    let offset = 0
    let boxCount = 0
    let moovOffset = null
    let moovEndOffset = null
    let mdatOffset = null
    let sawFtyp = false

    while (offset + ISO_BOX_HEADER_BYTES <= fileSize && boxCount < MAX_TOP_LEVEL_BOXES) {
      const header = Buffer.alloc(ISO_EXTENDED_BOX_HEADER_BYTES)
      const { bytesRead } = await handle.read(header, 0, header.length, offset)
      if (bytesRead < ISO_BOX_HEADER_BYTES) break

      const type = header.toString('ascii', 4, 8)
      const sizeInfo = readBoxSize(header.subarray(0, bytesRead), fileSize, offset)
      if (!sizeInfo) break
      const { boxSize, headerSize } = sizeInfo
      if (!Number.isFinite(boxSize) || boxSize < headerSize || offset + boxSize > fileSize) break

      if (type === 'ftyp') sawFtyp = true
      if (type === 'moov' && moovOffset == null) {
        moovOffset = offset
        moovEndOffset = offset + boxSize
      }
      if (type === 'mdat' && mdatOffset == null) mdatOffset = offset

      boxCount += 1
      if (moovOffset != null && mdatOffset != null) break
      offset += boxSize
    }

    const recognized = sawFtyp || moovOffset != null || mdatOffset != null
    const indexPrecedesMedia = recognized && moovOffset != null && (mdatOffset == null || moovOffset < mdatOffset)
    const indexFitsRendererLimit = moovEndOffset != null && moovEndOffset <= maxHeaderBytes
    return {
      recognized,
      streamable: indexPrecedesMedia && indexFitsRendererLimit,
      fileSize,
      moovOffset,
      moovEndOffset,
      mdatOffset,
      boxCount,
    }
  } finally {
    await handle.close()
  }
}

module.exports = {
  inspectIsoBmffLayout,
}
