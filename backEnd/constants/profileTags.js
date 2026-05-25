const PROFILE_TAG_CATEGORIES = [
  {
    id: 'animals',
    label: 'ペット・動物',
    tags: ['猫好き', '犬好き'],
  },
  {
    id: 'tech',
    label: 'テクノロジー',
    tags: ['プログラミング', 'ゲーム'],
  },
  {
    id: 'culture',
    label: 'エンタメ・文化',
    tags: ['アニメ・漫画', '音楽', '映画', '読書'],
  },
  {
    id: 'life',
    label: 'ライフスタイル',
    tags: ['スポーツ', '料理', '旅行', '写真', 'ファッション', 'カフェ巡り'],
  },
  {
    id: 'study',
    label: '学び',
    tags: ['勉強'],
  },
];

const ALL_PROFILE_TAGS = PROFILE_TAG_CATEGORIES.flatMap((c) => c.tags);

const MAX_PROFILE_TAGS = 12;

const normalizeProfileTag = (tag) => String(tag || '').trim();

const isValidProfileTag = (tag) => ALL_PROFILE_TAGS.includes(normalizeProfileTag(tag));

module.exports = {
  PROFILE_TAG_CATEGORIES,
  ALL_PROFILE_TAGS,
  MAX_PROFILE_TAGS,
  normalizeProfileTag,
  isValidProfileTag,
};
