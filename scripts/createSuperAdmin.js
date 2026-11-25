require('dotenv').config({ path: require('path').join(__dirname, '..', 'cet-api', '.env') })

const readline = require('node:readline/promises')
const path = require('node:path')
const { createRequire } = require('node:module')
const { stdin, stdout } = require('node:process')
const requireApi = createRequire(path.join(__dirname, '..', 'cet-api', 'package.json'))
const bcrypt = requireApi('bcryptjs')
const supabase = requireApi('./config/supabase')
const { isStrongAdminPassword } = requireApi('./utils/adminMfa')
const { SUPER_ADMIN_EMAIL } = requireApi('./utils/adminRoles')

const readHiddenPassword = (prompt) => new Promise((resolve, reject) => {
  if (!stdin.isTTY || typeof stdin.setRawMode !== 'function') {
    reject(new Error('Run this command in an interactive terminal so the password can be entered without echo.'))
    return
  }

  let value = ''
  const onData = (chunk) => {
    for (const byte of chunk) {
      if (byte === 3) {
        stdin.off('data', onData)
        stdin.setRawMode(false)
        stdin.pause()
        stdout.write('\n')
        reject(new Error('Admin setup cancelled.'))
        return
      }
      if (byte === 13 || byte === 10) {
        stdin.off('data', onData)
        stdin.setRawMode(false)
        stdin.pause()
        stdout.write('\n')
        resolve(value)
        return
      }
      if (byte === 8 || byte === 127) {
        value = value.slice(0, -1)
        continue
      }
      if (byte >= 32) value += Buffer.from([byte]).toString('utf8')
    }
  }

  stdout.write(prompt)
  stdin.setRawMode(true)
  stdin.resume()
  stdin.on('data', onData)
})

const createFirstAdmin = async () => {
  const prompt = readline.createInterface({ input: stdin, output: stdout })
  try {
    const resetEmailArg = process.argv.find((arg) => arg.startsWith('--reset-email='))
    const resetEmail = resetEmailArg ? resetEmailArg.slice('--reset-email='.length).trim().toLowerCase() : null
    if (resetEmail) {
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(resetEmail)) {
        throw new Error('Enter a valid administrator email address.')
      }
      const password = await readHiddenPassword('New strong password: ')
      const confirmation = await readHiddenPassword('Confirm password: ')
      if (password !== confirmation || !isStrongAdminPassword(password)) {
        throw new Error('Passwords must match and contain at least 12 characters with uppercase, lowercase, a number, and a symbol (maximum 72 UTF-8 bytes).')
      }

      const { data: existing, error: existingError } = await supabase
        .from('users')
        .select('id,email,status')
        .eq('email', resetEmail)
        .eq('role', 'admin')
        .maybeSingle()
      if (existingError) throw existingError
      if (!existing) throw new Error('No administrator account exists for that email.')

      const passwordHash = await bcrypt.hash(password, 12)
      const { error: resetError } = await supabase
        .from('users')
        .update({
          password: passwordHash,
          must_reset_password: false,
          mhcet_password: null,
          updated_at: new Date().toISOString(),
        })
        .eq('id', existing.id)
        .eq('role', 'admin')
      if (resetError) throw resetError

      const db = requireApi('./services/dbService')
      await db.deleteUserSessions(existing.id)
      await db.revokeUserRefreshTokens(existing.id)
      stdout.write(`Strong password set for ${existing.email}. Existing sessions were revoked. Sign in and complete authenticator setup.\n`)
      return
    }

    const name = (await prompt.question('Admin display name: ')).trim().slice(0, 100)
    const email = (await prompt.question('Admin email: ')).trim().toLowerCase()
    if (!name || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      throw new Error('Enter a name and a valid email address.')
    }

    const password = await readHiddenPassword('Strong password: ')
    const confirmation = await readHiddenPassword('Confirm password: ')
    if (password !== confirmation || !isStrongAdminPassword(password)) {
      throw new Error('Passwords must match and contain at least 12 characters with uppercase, lowercase, a number, and a symbol (maximum 72 UTF-8 bytes).')
    }

    const { count, error: countError } = await supabase
      .from('users')
      .select('id', { count: 'exact', head: true })
      .eq('role', 'admin')
    if (countError) throw countError
    if (count > 0) {
      throw new Error('An administrator already exists. Use the existing administrator provisioning flow instead.')
    }

    const passwordHash = await bcrypt.hash(password, 12)
    const { data, error } = await supabase
      .from('users')
      .insert({
        name,
        email,
        password: passwordHash,
        branch: 'Byculla',
        batch: 1,
        role: 'admin',
        admin_role: email === SUPER_ADMIN_EMAIL ? 'Super Admin' : 'ADMIN',
        status: 'approved',
        is_locked: false,
        must_reset_password: false,
      })
      .select('id,email')
      .single()
    if (error) throw error
    stdout.write(`Administrator account created for ${data.email}. Sign in to complete required authenticator setup.\n`)
  } finally {
    prompt.close()
  }
}

createFirstAdmin().catch(error => {
  console.error(error.message || 'Unable to create the administrator account.')
  process.exitCode = 1
})
