const express = require('express');
const router = express.Router();
const Note = require('../models/Note');
const User = require('../models/User');
const { authenticate: authMiddleware } = require('../middleware/auth');

// ノートを作成（既存のノートがあれば上書き）
router.post('/', authMiddleware, async (req, res) => {
  try {
    const { text } = req.body;
    if (!text || !text.trim()) {
      return res.status(400).json({ error: 'テキストは必須です' });
    }
    if (text.length > 60) {
      return res.status(400).json({ error: '60文字以内で入力してください' });
    }

    // 既存のノートを削除して新しいノートを作成（1ユーザー1ノート）
    await Note.deleteMany({ userId: req.user.id });

    const note = new Note({
      userId: req.user.id,
      text: text.trim(),
      expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
    });

    const saved = await note.save();
    const populated = await saved.populate('userId', 'username profilePicture');
    res.status(201).json(populated);
  } catch (err) {
    console.error('Note create error:', err);
    res.status(500).json({ error: 'ノートの作成に失敗しました' });
  }
});

// 自分のフォロワー/フォロー中のノートを取得（タイムライン）
router.get('/timeline', authMiddleware, async (req, res) => {
  try {
    const currentUser = await User.findById(req.user.id);
    if (!currentUser) {
      return res.status(404).json({ error: 'ユーザーが見つかりません' });
    }

    // 自分 + フォロー中のユーザーのノートを取得
    const userIds = [currentUser._id, ...currentUser.following];

    const notes = await Note.find({
      userId: { $in: userIds },
      expiresAt: { $gt: new Date() },
    })
      .populate('userId', 'username profilePicture')
      .sort({ createdAt: -1 });

    // 自分のノートを先頭に
    const myNotes = notes.filter(n => n.userId._id.toString() === req.user.id);
    const otherNotes = notes.filter(n => n.userId._id.toString() !== req.user.id);

    res.json([...myNotes, ...otherNotes]);
  } catch (err) {
    console.error('Note timeline error:', err);
    res.status(500).json({ error: 'ノートの取得に失敗しました' });
  }
});

// 自分のノートを削除
router.delete('/:id', authMiddleware, async (req, res) => {
  try {
    const note = await Note.findById(req.params.id);
    if (!note) {
      return res.status(404).json({ error: 'ノートが見つかりません' });
    }
    if (note.userId.toString() !== req.user.id) {
      return res.status(403).json({ error: '権限がありません' });
    }
    await Note.findByIdAndDelete(req.params.id);
    res.json({ message: '削除しました' });
  } catch (err) {
    console.error('Note delete error:', err);
    res.status(500).json({ error: 'ノートの削除に失敗しました' });
  }
});

module.exports = router;
