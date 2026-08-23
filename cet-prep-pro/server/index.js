const express = require('express')
const cors = require('cors')
const morgan = require('morgan')
const { createClient } = require('@supabase/supabase-js')
require('dotenv').config()

const supabaseUrl = process.env.SUPABASE_URL
const supabaseAnonKey = process.env.SUPABASE_ANON_KEY

if (!supabaseUrl || !supabaseAnonKey) {
  console.error('Missing SUPABASE_URL or SUPABASE_ANON_KEY in environment')
  process.exit(1)
}

const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: { persistSession: false, autoRefreshToken: false },
})

const app = express()
app.use(cors())
app.use(express.json())
app.use(morgan('dev'))

app.get('/api/status', async (req, res) => {
  try {
    const { error } = await supabase.from('profiles').select('id').limit(1)
    if (error) {
      return res.json({ status: 'ok', provider: 'supabase', detail: error.message, tableReady: false })
    }

    res.json({ status: 'ok', provider: 'supabase', tableReady: true })
  } catch (error) {
    res.status(500).json({ status: 'error', provider: 'supabase', message: error.message })
  }
})

app.get('/api/tests', async (req, res) => {
  try {
    const { data, error } = await supabase.from('tests').select('*').limit(20)
    if (error) {
      return res.status(500).json({ error: error.message, provider: 'supabase' })
    }
    res.json(data || [])
  } catch (error) {
    res.status(500).json({ error: error.message, provider: 'supabase' })
  }
})

app.post('/api/tests', async (req, res) => {
  try {
    const { data, error } = await supabase.from('tests').insert(req.body).select()
    if (error) {
      return res.status(500).json({ error: error.message, provider: 'supabase' })
    }
    res.status(201).json(data)
  } catch (error) {
    res.status(500).json({ error: error.message, provider: 'supabase' })
  }
})

const port = process.env.PORT || 4000
app.listen(port, () => {
  console.log(`Supabase backend listening on http://localhost:${port}`)
})
