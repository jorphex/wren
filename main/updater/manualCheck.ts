import log from 'electron-log'
import https from 'https'
import semver from 'semver'

import type { VersionUpdate } from '.'

import packageInfo from '../../package.json'

const repo = packageInfo.repository.split(':')[1]
const version = packageInfo.version

const httpOptions = {
  host: 'api.github.com',
  path: `/repos/${repo}/releases`,
  headers: { 'User-Agent': 'request' }
}

interface GithubRelease {
  prerelease: boolean
  tag_name: string
  html_url: string
}

interface CheckOptions {
  prereleaseTrack?: boolean
}

function parseResponse(rawData: string) {
  try {
    const releases: unknown = JSON.parse(rawData)
    if (!Array.isArray(releases)) {
      log.warn('Manual check for update returned an unexpected JSON shape')
      return undefined
    }
    return releases.filter(
      (release): release is GithubRelease =>
        typeof release === 'object' &&
        release !== null &&
        typeof release.prerelease === 'boolean' &&
        typeof release.tag_name === 'string' &&
        typeof release.html_url === 'string'
    )
  } catch (e) {
    log.warn('Manual check for update returned invalid JSON response', e)
    return undefined
  }
}

function compareVersions(a: string, b: string) {
  if (semver.gt(a, b)) return 1
  if (semver.lt(a, b)) return -1
  return 0
}

function extractVersion(tag: string) {
  const direct = semver.valid(tag)
  if (direct) return direct

  const withoutV = tag.startsWith('v') ? semver.valid(tag.slice(1)) : null
  if (withoutV) return withoutV

  const match = tag.match(/v?(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)/)
  return match ? semver.valid(match[1]) : null
}

export default function (opts?: CheckOptions) {
  log.verbose('Performing manual check for updates', { prereleaseTrack: opts?.prereleaseTrack })

  return new Promise<VersionUpdate | undefined>((resolve, reject) => {
    https
      .get(httpOptions, (res) => {
        let rawData = ''

        res.on('error', (e) => {
          log.warn('Manual check for update encountered HTTP error', e)
          reject(e)
        })

        res.on('data', (chunk) => {
          rawData += chunk
        })
        res.on('end', () => {
          const contentType = res.headers['content-type'] || ''

          log.debug('Manual check response', { status: res.statusCode, contentType })
          if (res.statusCode != 200 || !contentType.includes('json')) {
            log.warn('Manual check for update returned invalid response', {
              status: res.statusCode,
              contentType,
              data: rawData
            })
            return reject(
              new Error(`invalid response, status: ${res.statusCode} contentType: ${contentType}`)
            )
          }

          const parsedReleases = parseResponse(rawData)
          if (!parsedReleases) return reject(new Error('invalid release response'))

          const releases = parsedReleases.filter((r) => !r.prerelease || opts?.prereleaseTrack)
          const latestRelease = releases[0]

          if (latestRelease?.tag_name) {
            const latestVersion = extractVersion(latestRelease.tag_name)
            if (!latestVersion) {
              log.warn('Manual check found release with unparseable version tag', {
                tag: latestRelease.tag_name
              })
              return resolve(undefined)
            }
            const isNewerVersion = compareVersions(latestVersion, version) === 1

            log.verbose('Manual check found release', {
              currentVersion: version,
              latestVersion,
              isNewerVersion
            })

            resolve(
              isNewerVersion
                ? { version: latestRelease.tag_name, location: latestRelease.html_url }
                : undefined
            )
          } else {
            log.verbose('Manual check did not find any releases')
            resolve(undefined)
          }
        })
      })
      .on('error', reject)
  })
}
