import { verifyNativePackage } from './package-verification.mjs'

const target = process.argv[2]
if (!target) throw new Error('Usage: node scripts/verify-native-package.mjs <target>')

const verified = await verifyNativePackage(target)
console.log(
  `Verified native ${target} package runtime and archive payloads for ${verified.artifacts.join(', ')}`
)
