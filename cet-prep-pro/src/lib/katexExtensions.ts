import katex from 'katex'

const katexGlobal = globalThis as typeof globalThis & { katex?: typeof katex }
const previousKaTeX = katexGlobal.katex
katexGlobal.katex = katex
await import('katex/contrib/mhchem/mhchem.js')

if (previousKaTeX) {
  katexGlobal.katex = previousKaTeX
} else {
  delete katexGlobal.katex
}
