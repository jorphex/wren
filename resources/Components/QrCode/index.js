import React from 'react'
import { encode } from 'uqr'

export const QR_QUIET_ZONE_MODULES = 4
const QR_MODULE_SIZE = 5

export const createQrMatrix = (value) =>
  encode(value, {
    border: QR_QUIET_ZONE_MODULES,
    boostEcc: true,
    ecc: 'M'
  })

const matrixPath = (data) =>
  data
    .flatMap((row, y) => {
      const runs = []
      let start = -1

      row.forEach((dark, x) => {
        if (dark && start === -1) start = x
        if (start !== -1 && (!dark || x === row.length - 1)) {
          const end = dark && x === row.length - 1 ? x + 1 : x
          const width = end - start
          runs.push(`M${start} ${y}h${width}v1h-${width}z`)
          start = -1
        }
      })

      return runs
    })
    .join('')

const QrCode = ({ className, id, label, value }) => {
  const qr = React.useMemo(() => createQrMatrix(value), [value])
  const pixelSize = qr.size * QR_MODULE_SIZE

  return (
    <svg
      aria-label={label}
      className={className}
      id={id}
      data-qr-payload={value}
      data-qr-quiet-zone={QR_QUIET_ZONE_MODULES}
      height={pixelSize}
      role='img'
      shapeRendering='crispEdges'
      viewBox={`0 0 ${qr.size} ${qr.size}`}
      width={pixelSize}
    >
      <rect width={qr.size} height={qr.size} fill='#fff' />
      <path d={matrixPath(qr.data)} fill='#000' />
    </svg>
  )
}

export default QrCode
