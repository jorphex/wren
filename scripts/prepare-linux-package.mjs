import { preparePackageOutput } from './prepare-package.mjs'

const sourceIdentity = await preparePackageOutput()

console.log(`Prepared clean Linux package output for ${sourceIdentity.commit}`)
