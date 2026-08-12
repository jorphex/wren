import { z } from 'zod'
import { v4 as generateUuid } from 'uuid'

import { createDesktopAuthIdentity, DesktopAuthIdentitySchema } from '../../../../api/desktopAuthIdentity'

const StateSchema = z.object({ main: z.object({}).passthrough() }).passthrough()

const migrate = (initial: unknown) => {
  const parsed = StateSchema.safeParse(initial)
  if (!parsed.success) return initial
  const existing = DesktopAuthIdentitySchema.safeParse(parsed.data.main['desktopAuthIdentity'])
  return {
    ...parsed.data,
    main: {
      ...parsed.data.main,
      desktopAuthIdentity: existing.success ? existing.data : createDesktopAuthIdentity(generateUuid()),
      nativePeerCredentials: {}
    }
  }
}

export default { version: 62, migrate }
