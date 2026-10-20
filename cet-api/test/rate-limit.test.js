const test = require('node:test')
const assert = require('node:assert/strict')
const express = require('express')

const redisUrl = process.env.REDIS_URL
delete process.env.REDIS_URL
const { createLimiter } = require('../middleware/rateLimit')
if (redisUrl !== undefined) process.env.REDIS_URL = redisUrl

test('rate-limited API responses include a retry delay', async t => {
  const app = express()
  const limiter = createLimiter({
    windowMs: 60_000,
    max: 1,
    keyGenerator: () => 'rate-limit-test',
    message: 'API rate limit exceeded. Please slow down.',
  })
  app.get('/limited', limiter, (req, res) => res.sendStatus(204))

  const server = app.listen(0, '127.0.0.1')
  await new Promise((resolve, reject) => {
    server.once('listening', resolve)
    server.once('error', reject)
  })
  t.after(() => new Promise(resolve => server.close(resolve)))

  const address = server.address()
  assert.ok(address && typeof address === 'object')
  const url = `http://127.0.0.1:${address.port}/limited`

  assert.equal((await fetch(url)).status, 204)
  const limitedResponse = await fetch(url)
  assert.equal(limitedResponse.status, 429)
  assert.ok(Number(limitedResponse.headers.get('Retry-After')) > 0)
  assert.equal((await limitedResponse.json()).message, 'API rate limit exceeded. Please slow down.')
})
