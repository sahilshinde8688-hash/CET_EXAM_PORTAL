const test = require('node:test')
const assert = require('node:assert/strict')
const { isSupportedQuestionImage } = require('../utils/questionImageValidation')

test('accepts JPEG, PNG, and WebP file signatures for their declared MIME types', () => {
  const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0x00])
  const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
  const webp = Buffer.from('RIFF0000WEBP', 'ascii')

  assert.equal(isSupportedQuestionImage(jpeg, 'image/jpeg'), true)
  assert.equal(isSupportedQuestionImage(png, 'image/png'), true)
  assert.equal(isSupportedQuestionImage(webp, 'image/webp'), true)
})

test('rejects spoofed, mismatched, empty, and non-buffer uploads', () => {
  assert.equal(isSupportedQuestionImage(Buffer.from('<svg/>'), 'image/png'), false)
  assert.equal(isSupportedQuestionImage(Buffer.from([0xff, 0xd8, 0xff]), 'image/png'), false)
  assert.equal(isSupportedQuestionImage(Buffer.alloc(0), 'image/jpeg'), false)
  assert.equal(isSupportedQuestionImage(null, 'image/jpeg'), false)
})
