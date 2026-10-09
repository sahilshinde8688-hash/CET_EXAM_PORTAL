/**
 * duplicateDetection.js
 * ---------------------
 * Duplicate detection for question imports (PDF today, reusable by Excel).
 *
 * Two-tier strategy:
 * 1. EXACT duplicates — identical fingerprints after aggressive normalisation
 *    (case, punctuation and math notation folded away).
 * 2. SIMILAR duplicates — Dice coefficient over character bigrams of the
 *    normalised text, catching questions with minor wording/value tweaks.
 *
 * Incoming questions are compared both against the existing question bank and
 * against each other (batch-internal duplicates).
 */

const { normalizeForMatching } = require('../services/mathText')

const SIMILARITY_THRESHOLD = 0.9
const LENGTH_GATE = 0.35 // skip comparisons when lengths differ by >35%

/** Build a quick lookup table of bigrams -> count for Dice scoring. */
const bigramSet = (text) => {
  const grams = new Map()
  for (let i = 0; i < text.length - 1; i += 1) {
    const gram = text.slice(i, i + 2)
    grams.set(gram, (grams.get(gram) || 0) + 1)
  }
  return grams
}

/** Dice coefficient (0..1) over character bigrams. */
const similarity = (a, b) => {
  if (!a || !b) return 0
  if (a === b) return 1
  const lenDiff = Math.abs(a.length - b.length) / Math.max(a.length, b.length)
  if (lenDiff > LENGTH_GATE) return 0
  const gramsA = bigramSet(a)
  const gramsB = bigramSet(b)
  let overlap = 0
  for (const [gram, count] of gramsA.entries()) {
    const other = gramsB.get(gram)
    if (other) overlap += Math.min(count, other)
  }
  const total = (a.length - 1) + (b.length - 1)
  return total > 0 ? (2 * overlap) / total : 0
}

/** Find the best match for a normalised question inside an index of candidates. */
const findBestMatch = (fingerprint, candidates) => {
  let best = { id: null, text: '', type: null, score: 0 }

  const exact = candidates.byFingerprint.get(fingerprint)
  if (exact) {
    return { id: exact.id, text: exact.text, type: 'exact', score: 1 }
  }

  for (const candidate of candidates.list) {
    if (!candidate.fingerprint) continue
    const score = similarity(fingerprint, candidate.fingerprint)
    if (score > best.score) {
      best = { id: candidate.id, text: candidate.text, type: 'similar', score }
    }
    if (best.score >= 0.999) break
  }
  return best.score >= SIMILARITY_THRESHOLD ? best : { id: null, text: '', type: null, score: best.score }
}

/**
 * Flag duplicates on a list of extracted questions (mutates copies and returns
 * them alongside summary stats).
 *
 * @param {Array<{question:string}>} extracted payload questions
 * @param {Array<{id?:string, text:string}>} existingBank current DB questions
 * @returns {Array} the same questions decorated with duplicate fields
 */
const flagDuplicates = (extracted, existingBank = []) => {
  const bank = {
    list: existingBank
      .map((q) => ({ id: q.id || null, text: String(q.text || ''), fingerprint: normalizeForMatching(q.text) }))
      .filter((q) => q.fingerprint),
    byFingerprint: new Map(),
  }
  bank.list.forEach((q) => {
    if (!bank.byFingerprint.has(q.fingerprint)) bank.byFingerprint.set(q.fingerprint, q)
  })

  const seenInBatch = new Map()

  return extracted.map((q) => {
    const fingerprint = normalizeForMatching(q.question)
    const match = fingerprint ? findBestMatch(fingerprint, bank) : { id: null, text: '', type: null, score: 0 }

    const decorated = {
      ...q,
      duplicate: Boolean(match.type),
      duplicateType: match.type,
      duplicateOfId: match.id || null,
      duplicateOfText: match.type ? match.text : '',
      duplicateScore: Math.round(match.score * 100) / 100,
      // Admin action for duplicates; defaults to skipping safe duplicates
      duplicateAction: match.type === 'exact' ? 'skip' : match.type === 'similar' ? 'skip' : 'import',
    }

    if (fingerprint) {
      if (seenInBatch.has(fingerprint)) {
        decorated.duplicate = true
        decorated.duplicateType = 'exact'
        decorated.duplicateInBatch = true
        decorated.duplicateAction = 'skip'
      } else {
        seenInBatch.set(fingerprint, true)
      }
    }
    return decorated
  })
}

module.exports = {
  flagDuplicates,
  similarity,
  normalizeForMatching,
  SIMILARITY_THRESHOLD,
}
