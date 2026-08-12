interface GetOsInfo {
  os: string
  dist?: string
  codename?: string
  release?: string
}

declare function getos(callback: (error: Error | null, osInfo?: GetOsInfo) => void): void

export = getos
