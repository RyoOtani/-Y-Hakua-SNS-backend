const ngWords = require('../config/ngWords');

const MASK_CHAR = '⚪';

const escapeRegExp = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const buildNgWordRegex = () => {
  const normalizedWords = [...new Set((ngWords || [])
    .filter((word) => typeof word === 'string')
    .map((word) => word.trim())
    .filter(Boolean))]
    .sort((a, b) => b.length - a.length);

  if (normalizedWords.length === 0) {
    return null;
  }

  const pattern = normalizedWords.map((word) => escapeRegExp(word)).join('|');
  return new RegExp(pattern, 'gi');
};

const NG_WORD_REGEX = buildNgWordRegex();

const maskMatch = (match) => {
  const charCount = Array.from(match).length;
  return MASK_CHAR.repeat(charCount);
};

const censorText = (text) => {
  if (typeof text !== 'string' || !NG_WORD_REGEX) {
    return text;
  }
  return text.replace(NG_WORD_REGEX, (match) => maskMatch(match));
};

module.exports = {
  censorText,
};
