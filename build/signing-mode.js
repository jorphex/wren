const signingModes = new Set(['skip', 'required'])

const readSigningMode = (name, env = process.env) => {
  const mode = env[name]
  if (!signingModes.has(mode)) {
    throw new Error(`${name} must be explicitly set to "skip" or "required"`)
  }
  return mode
}

const requireEnvironment = (names, env = process.env) => {
  const missing = names.filter((name) => !env[name])
  if (missing.length > 0) {
    throw new Error(`Missing required release environment: ${missing.join(', ')}`)
  }
}

module.exports = { readSigningMode, requireEnvironment }
