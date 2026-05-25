/**
 * 事前定義コミュニティを投入するスクリプト
 * 使い方: node scripts/seedCommunities.js
 * 環境変数 MONGO_URI または .env の接続文字列を使用
 */
const path = require('path');
const mongoose = require('mongoose');
const dotenv = require('dotenv');

dotenv.config({ path: path.join(__dirname, '..', '.env') });

const Community = require('../models/Community');
const User = require('../models/User');
const { ALL_PROFILE_TAGS } = require('../constants/profileTags');

const PRESET_COMMUNITIES = [
  { name: '猫好きの部屋', tagFilter: '猫好き', description: '猫が好きな人がゆるく集まるコミュニティです。' },
  { name: '犬好きの部屋', tagFilter: '犬好き', description: '犬が好きな人がゆるく集まるコミュニティです。' },
  { name: 'プログラミング仲間', tagFilter: 'プログラミング', description: 'コード・開発の話題を共有する場所です。' },
  { name: 'ゲーマー広場', tagFilter: 'ゲーム', description: 'ゲーム好きが集まるコミュニティです。' },
  { name: 'アニメ・漫画トーク', tagFilter: 'アニメ・漫画', description: '作品の感想やおすすめを共有しましょう。' },
  { name: '音楽好きの集い', tagFilter: '音楽', description: '好きなアーティストや曲の話題を歓迎します。' },
  { name: '勉強モチベ部屋', tagFilter: '勉強', description: '学習の記録や励まし合いをするコミュニティです。' },
];

const buildSlug = (tagFilter) => (
  `preset-${String(tagFilter)
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9\u3040-\u30ff\u4e00-\u9faf]+/g, '-')}`
);

async function resolveOwnerId() {
  const elevated = await User.findOne({ hasElevatedAccess: true }).select('_id');
  if (elevated) return elevated._id;

  const anyUser = await User.findOne().sort({ createdAt: 1 }).select('_id');
  if (anyUser) return anyUser._id;

  throw new Error('コミュニティのオーナーとなるユーザーが見つかりません。先にユーザーを作成してください。');
}

async function seed() {
  const mongoUri = process.env.MONGO_URI || process.env.MONGODB_URI;
  if (!mongoUri) {
    throw new Error('MONGO_URI または MONGODB_URI を設定してください');
  }

  await mongoose.connect(mongoUri);
  const ownerId = await resolveOwnerId();

  let created = 0;
  let updated = 0;

  for (const preset of PRESET_COMMUNITIES) {
    if (!ALL_PROFILE_TAGS.includes(preset.tagFilter)) {
      console.warn(`スキップ: 未定義タグ ${preset.tagFilter}`);
      continue;
    }

    const slug = buildSlug(preset.tagFilter);
    const existing = await Community.findOne({ slug });

    if (existing) {
      existing.name = preset.name;
      existing.description = preset.description;
      existing.tagFilter = preset.tagFilter;
      existing.tags = [preset.tagFilter];
      existing.isPrivate = true;
      existing.allowAnonymousPosts = true;
      if (!existing.members.some((m) => m.toString() === ownerId.toString())) {
        existing.members.push(ownerId);
      }
      await existing.save();
      updated += 1;
      continue;
    }

    await Community.create({
      name: preset.name,
      slug,
      description: preset.description,
      ownerId,
      members: [ownerId],
      tags: [preset.tagFilter],
      tagFilter: preset.tagFilter,
      isPrivate: true,
      allowAnonymousPosts: true,
    });
    created += 1;
  }

  console.log(`コミュニティシード完了: 新規 ${created}件, 更新 ${updated}件`);
  await mongoose.disconnect();
}

seed().catch((err) => {
  console.error('シード失敗:', err);
  process.exit(1);
});
