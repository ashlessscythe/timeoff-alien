import path from 'path'
import { fileURLToPath } from 'url'
import dotenv from 'dotenv'
import { createRequire } from 'module'

const require = createRequire(import.meta.url)
const __dirname = path.dirname(fileURLToPath(import.meta.url))
const root = path.join(__dirname, '..', '..')

dotenv.config({ path: path.join(root, '.env.test'), override: true })

if (!process.env.OPTION_ALLOW_NEW_REGISTRATIONS) {
  process.env.OPTION_ALLOW_NEW_REGISTRATIONS = 'true'
}

process.env.TURNSTILE_SITE_KEY = process.env.TURNSTILE_SITE_KEY || ''
process.env.TURNSTILE_SECRET_KEY = process.env.TURNSTILE_SECRET_KEY || ''

const app = require(path.join(root, 'app.js'))
export default app
