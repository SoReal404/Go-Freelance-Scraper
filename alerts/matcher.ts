import { STRONG, MEDIUM, WEAK, EXCLUDE } from './keywords.ts';
import type { NormalizedProject } from '../adapters/types.ts';

export interface MatchResult {
  matched: boolean;
  score: number;
  strongMatches: string[];
  mediumMatches: string[];
  weakMatches: string[];
  excludedBy?: string;
  budgetSkipped?: boolean;
}

export interface MatcherOptions {
  minScore?: number;
  minBudgetUsd?: number;
}

/**
 * Normalizes Arabic and English text for accurate matching:
 * - Lowercase English
 * - Remove Arabic diacritics (tashkeel)
 * - Remove tatweel (ـ)
 * - Normalize Alef variants (أ, إ, آ, ٱ -> ا)
 * - Normalize Taa Marbuta (ة -> ه)
 * - Normalize Yaa (ى -> ي)
 * - Normalize whitespace
 */
export function normalizeText(text: string): string {
  if (!text) return '';
  return text
    .toLowerCase()
    .replace(/[\u064B-\u065F\u0670]/g, '') // remove tashkeel
    .replace(/\u0640/g, '')               // remove tatweel
    .replace(/[أإآٱ]/g, 'ا')
    .replace(/ة/g, 'ه')
    .replace(/ى/g, 'ي')
    .replace(/\s+/g, ' ')
    .trim();
}

function escapeRegExp(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Checks if a keyword matches inside normalized text.
 * For terms of 4 letters or fewer (e.g. 'api', 'rag', 'llm', 'بوت'),
 * requires word boundaries using Unicode letter/number boundaries
 * to avoid substring collisions ('api' in 'capital', 'rag' in 'storage').
 */
export function containsKeyword(normalizedText: string, rawKeyword: string): boolean {
  const normKw = normalizeText(rawKeyword);
  if (!normKw) return false;

  // Short term (<= 4 chars): match with Unicode word boundaries
  if (normKw.length <= 4 && !normKw.includes(' ')) {
    const pattern = new RegExp(`(^|[^\\p{L}\\p{N}])${escapeRegExp(normKw)}([^\\p{L}\\p{N}]|$)`, 'u');
    return pattern.test(normalizedText);
  }

  // Multi-word phrase or longer word: substring check on normalized text
  return normalizedText.includes(normKw);
}

/**
 * Evaluates a project against user keywords and budget criteria.
 */
export function evaluateProject(
  project: NormalizedProject,
  options: MatcherOptions = {},
): MatchResult {
  const minScore = options.minScore ?? 4;
  const minBudgetUsd = options.minBudgetUsd ?? 15;

  // Combine title, description, and skills into one searchable body
  const combined = [
    project.title || '',
    project.listingDescription || '',
    project.description || '',
    ...(project.skills || []),
  ].join(' ');

  const normalized = normalizeText(combined);

  // 1. Check EXCLUDE list (any match = instant rejection)
  for (const kw of EXCLUDE) {
    if (containsKeyword(normalized, kw)) {
      return {
        matched: false,
        score: 0,
        strongMatches: [],
        mediumMatches: [],
        weakMatches: [],
        excludedBy: kw,
      };
    }
  }

  // 2. Check Budget: skip low-budget noise (< $15) if budgetMax is defined
  const isUsdOrGeneral = !project.currency || project.currency === '$' || project.currency.toUpperCase() === 'USD';
  if (isUsdOrGeneral && project.budgetMax != null && project.budgetMax > 0 && project.budgetMax < minBudgetUsd) {
    return {
      matched: false,
      score: 0,
      strongMatches: [],
      mediumMatches: [],
      weakMatches: [],
      budgetSkipped: true,
    };
  }

  // 3. Match and score keywords
  const strongMatches: string[] = [];
  const mediumMatches: string[] = [];
  const weakMatches: string[] = [];
  let score = 0;

  for (const kw of STRONG) {
    if (containsKeyword(normalized, kw)) {
      strongMatches.push(kw);
      score += 3;
    }
  }

  for (const kw of MEDIUM) {
    if (containsKeyword(normalized, kw)) {
      mediumMatches.push(kw);
      score += 2;
    }
  }

  for (const kw of WEAK) {
    if (containsKeyword(normalized, kw)) {
      weakMatches.push(kw);
      score += 1;
    }
  }

  return {
    matched: score >= minScore,
    score,
    strongMatches,
    mediumMatches,
    weakMatches,
  };
}
