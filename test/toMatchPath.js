jest.mock('@trezor/connect-web/lib/impl/core-in-suite-desktop.js', () => ({
  CoreInSuiteDesktop: jest.fn(() => ({
    init: jest.fn(async () => {}),
    dispose: jest.fn(async () => {}),
    call: jest.fn(async () => ({
      success: false,
      error: { code: 'Device_NotFound', message: 'No test device' }
    }))
  }))
}))

import { expect } from '@jest/globals'
import path from 'path'

const normalizePath = (value) => {
  return path
    .normalize(value || '')
    .split('\\')
    .join('/')
}

const toMatchPath = (actual, expected) => {
  return normalizePath(actual) === normalizePath(expected)
    ? {
        pass: true,
        message: () => `expected ${normalizePath(actual)} to be ${normalizePath(expected)}`
      }
    : {
        pass: false,
        message: () => `expected ${normalizePath(actual)} to be ${normalizePath(expected)}`
      }
}

expect.extend({
  toMatchPath
})
