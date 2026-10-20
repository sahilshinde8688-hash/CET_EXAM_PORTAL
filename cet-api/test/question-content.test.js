const test = require('node:test')
const assert = require('node:assert/strict')
const { sanitizeQuestionContent } = require('../utils/questionContent')

test('retains supported question formatting while removing executable HTML', () => {
  const clean = sanitizeQuestionContent(
    '<p onclick="alert(1)">ax<sup>2</sup> + x<sub>1</sub></p><script>alert(1)</script>',
  )

  assert.match(clean, /<sup>2<\/sup>/)
  assert.match(clean, /<sub>1<\/sub>/)
  assert.doesNotMatch(clean, /onclick|script|alert/)
})

test('retains matrix tables, paragraph breaks, and safe emphasis styles', () => {
  const clean = sanitizeQuestionContent(
    '<p><strong>Given:</strong></p><table><tbody><tr><td style="text-align:center">1</td><td>2</td></tr></tbody></table>',
  )

  assert.match(clean, /<strong>Given:<\/strong>/)
  assert.match(clean, /<table>/)
  assert.match(clean, /<td style="text-align:center">1<\/td>/)
})

test('leaves plain mathematical comparisons unchanged', () => {
  assert.equal(sanitizeQuestionContent('If x < y, then y > z.'), 'If x < y, then y > z.')
})

test('retains standard MathML fraction and matrix structures', () => {
  const clean = sanitizeQuestionContent(
    '<math><mfrac><mi>a</mi><mi>b</mi></mfrac><mtable><mtr><mtd><mn>1</mn></mtd></mtr></mtable></math>',
  )

  assert.match(clean, /<mfrac>/)
  assert.match(clean, /<mtable>/)
  assert.match(clean, /<mtd>/)
})

test('retains safe pasted images and strips unsafe image sources', () => {
  const clean = sanitizeQuestionContent(
    '<img src="https://cdn.example.com/solution.png" alt="Matrix"><img src="javascript:alert(1)" onerror="alert(1)">',
  )

  assert.match(clean, /src="https:\/\/cdn\.example\.com\/solution\.png"/)
  assert.doesNotMatch(clean, /javascript:|onerror|alert/)
})

test('decodes escaped rich formatting before sanitizing it', () => {
  const clean = sanitizeQuestionContent(
    '&lt;p&gt;Solve. &lt;span style=&quot;font-weight:700&quot;&gt;x&lt;sup&gt;2&lt;/sup&gt;&lt;/span&gt;&lt;/p&gt;',
  )

  assert.match(clean, /^<p>/)
  assert.match(clean, /<span style="font-weight:700">x<sup>2<\/sup><\/span>/)
})

test('removes executable tags after decoding escaped markup', () => {
  const clean = sanitizeQuestionContent(
    '&lt;p&gt;Text&lt;/p&gt;&lt;script&gt;alert(1)&lt;/script&gt;',
  )

  assert.match(clean, /<p>Text<\/p>/)
  assert.doesNotMatch(clean, /script|alert/)
})

test('removes leaked Marks presentation attributes from plain and rich pasted text', () => {
  const leaked = '" role="presentation" style="box-sizing: border-box; --tw-ring-offset-color: #fff; font-family: Inter, sans-serif; position: relative;">'
  const plain = sanitizeQuestionContent(`If ${leaked}3 − 2`)
  const rich = sanitizeQuestionContent(`<p>If ${leaked}<strong>3</strong> − 2</p>`)

  assert.equal(plain, 'If 3 − 2')
  assert.doesNotMatch(rich, /role=|--tw-|box-sizing|font-family/)
  assert.match(rich, /<strong>3<\/strong>/)
  assert.match(rich, /If\s*<strong>/)
})

test('preserves math, option markup, and safe images while stripping pasted site chrome', () => {
  const clean = sanitizeQuestionContent(
    '<nav>Marks navigation</nav><p>If A = <math><msup><mi>x</mi><mn>2</mn></msup></math></p>' +
    '<ol><li>A) <img src="https://cdn.example.com/matrix.png" alt="Matrix"></li></ol>' +
    '<script>alert(1)</script><button>Copy</button>',
  )

  assert.match(clean, /<math>/)
  assert.match(clean, /<msup>/)
  assert.match(clean, /<ol><li>/)
  assert.match(clean, /src="https:\/\/cdn\.example\.com\/matrix\.png"/)
  assert.doesNotMatch(clean, /Marks navigation|alert|Copy|<script|<button/)
})

test('preserves normalized KaTeX matrices through backend question sanitization', () => {
  const question = '<p>If A + I = \\(\\begin{bmatrix}3 &amp; -2 \\\\ 1 &amp; -1\\end{bmatrix}\\), then find (A - I)^{-1}.</p>'
  const clean = sanitizeQuestionContent(question)

  assert.match(clean, /\\begin\{bmatrix\}/)
  assert.match(clean, /3\s*&amp;\s*-2/)
  assert.match(clean, /1\s*&amp;\s*-1/)
  assert.match(clean, /find \(A - I\)\^\{-1\}/)
  assert.doesNotMatch(clean, /--tw-|role="presentation"|box-sizing/)
})

test('reconstructs disconnected matrix rows copied from Marks clipboard layout', () => {
  const raw = '3      −2\n\nIf A + I = (1      −1), then the inverse of the matrix (A − I) is:'
  const clean = sanitizeQuestionContent(raw)

  assert.match(clean, /If A \+ I = \\\(?\\begin\{pmatrix\}3 & -2 \\\\ 1 & -1\\end\{pmatrix\}\\\)?/)
  assert.match(clean, /then the inverse of the matrix \(A − I\) is:/)
})

test('normalizes bracketed semicolon matrix into proper bmatrix or pmatrix', () => {
  const raw = 'If A + I = [3 −2; 1 −1], then the inverse of the matrix (A − I) is:'
  const clean = sanitizeQuestionContent(raw)

  assert.match(clean, /If A \+ I = \\\(?\\begin\{bmatrix\}3 & -2 \\\\ 1 & -1\\end\{bmatrix\}\\\)?/)
  assert.match(clean, /then the inverse of the matrix \(A − I\) is:/)
})

test('normalizes parentheses matrix with pmatrix', () => {
  const raw = 'If A + I = (3 −2; 1 −1), then find (A − I).'
  const clean = sanitizeQuestionContent(raw)

  assert.match(clean, /If A \+ I = \\\(?\\begin\{pmatrix\}3 & -2 \\\\ 1 & -1\\end\{pmatrix\}\\\)?/)
  assert.match(clean, /then find \(A − I\)\./)
})

test('wraps bare LaTeX matrices with inline math delimiters', () => {
  const raw = '<p>Given A = \\begin{pmatrix}1 &amp; 2 \\\\ 3 &amp; 4\\end{pmatrix}, compute det(A).</p>'
  const clean = sanitizeQuestionContent(raw)

  assert.match(clean, /\\\(\\begin\{pmatrix\}1 &amp; 2 \\\\ 3 &amp; 4\\end\{pmatrix\}\\\)/)
})

test('does not transform non-matrix expressions like (A - I) or (x + 1)', () => {
  const raw = 'If (A - I) is invertible and (x + 1) = 0, then find (A - I)^{-1}.'
  const clean = sanitizeQuestionContent(raw)

  assert.equal(clean, 'If (A - I) is invertible and (x + 1) = 0, then find (A - I)^{-1}.')
})

test('preserves fractions, square roots, and superscripts alongside matrices', () => {
  const raw = '<p>Evaluate \\(\\frac{1}{\\sqrt{2}}\\cdot x^{2}\\) when A = \\(\\begin{pmatrix}3 &amp; -2 \\\\ 1 &amp; -1\\end{pmatrix}\\).</p>'
  const clean = sanitizeQuestionContent(raw)

  assert.match(clean, /\\frac\{1\}\{\\sqrt\{2\}\}/)
  assert.match(clean, /x\^\{2\}/)
  assert.match(clean, /\\begin\{pmatrix\}3 &amp; -2 \\\\ 1 &amp; -1\\end\{pmatrix\}/)
})

test('sanitizes malicious scripts and event handlers while preserving safe math', () => {
  const malicious = '<p>If A = \\(\\begin{pmatrix}3 &amp; -2 \\\\ 1 &amp; -1\\end{pmatrix}\\)<script>alert("hack")</script><img src="x" onerror="alert(1)"></p>'
  const clean = sanitizeQuestionContent(malicious)

  assert.doesNotMatch(clean, /script|onerror|alert/)
  assert.match(clean, /\\begin\{pmatrix\}3 &amp; -2 \\\\ 1 &amp; -1\\end\{pmatrix\}/)
})
