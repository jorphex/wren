const signingModes = new Set(['skip', 'required'])
const macSigningModes = new Set(['skip', 'adhoc', 'required'])

const readMode = (name, modes, description, env) => {
  const mode = env[name]
  if (!modes.has(mode)) throw new Error(`${name} must be explicitly set to ${description}`)
  return mode
}

const readSigningMode = (name, env = process.env) => readMode(name, signingModes, '"skip" or "required"', env)

const readMacSigningMode = (name, env = process.env) =>
  readMode(name, macSigningModes, '"skip", "adhoc", or "required"', env)

const requireEnvironment = (names, env = process.env) => {
  const missing = names.filter((name) => !env[name])
  if (missing.length > 0) {
    throw new Error(`Missing required release environment: ${missing.join(', ')}`)
  }
}

module.exports = { readMacSigningMode, readSigningMode, requireEnvironment }
