export const INTERFACE_SCALES = [1, 1.25, 1.5] as const

export type InterfaceScale = (typeof INTERFACE_SCALES)[number]

export type WorkAreaSize = {
  width: number
  height: number
}

const minimumLogicalWidth = 760
const minimumLogicalHeight = 744

export function normalizeInterfaceScale(value: unknown): InterfaceScale {
  return INTERFACE_SCALES.includes(value as InterfaceScale) ? (value as InterfaceScale) : 1
}

export function getEffectiveInterfaceScale(requested: unknown, workArea: WorkAreaSize): InterfaceScale {
  const normalized = normalizeInterfaceScale(requested)
  const candidates = INTERFACE_SCALES.filter((scale) => scale <= normalized).sort(
    (left, right) => right - left
  )

  return (
    candidates.find(
      (scale) =>
        minimumLogicalWidth * scale <= workArea.width && minimumLogicalHeight * scale <= workArea.height
    ) || 1
  )
}
