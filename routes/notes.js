const express = require('express');
const router = express.Router();
const Note = require('../models/Note');
const User = require('../models/User');
const { authenticate: authMiddleware } = require('../middleware/auth');

// ノートを作成（既存のノートがあれば上書き）
router.post('/', authMiddleware, async (req, res) => {
  try {
    const { text, visibility } = req.body;
    if (!text || !text.trim()) {
      return res.status(400).json({ error: 'テキストは必須です' });
    }
    if (text.length > 60) {
      return res.status(400).json({ error: '60文字以内で入力してください' });
    }

    const normalizedVisibility = visibility === 'close_friends' ? 'close_friends' : 'followers';
    if (!['followers', 'close_friends'].includes(normalizedVisibility)) {
      return res.status(400).json({ error: '公開範囲が不正です' });
    }

    if (normalizedVisibility === 'close_friends') {
      const me = await User.findById(req.user.id).select('closeFriends');
      if (!me || !Array.isArray(me.closeFriends) || me.closeFriends.length === 0) {
        return res.status(400).json({ error: '親友リストが空です。先に親友を追加してください' });
      }
    }

    // 既存のノートを削除して新しいノートを作成（1ユーザー1ノート）
    await Note.deleteMany({ userId: req.user.id });

    const note = new Note({
      userId: req.user.id,
      text: text.trim(),
      visibility: normalizedVisibility,
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

    const closeFriendOwnerIds = await User.find({
      _id: { $in: userIds },
      closeFriends: currentUser._id,
    }).select('_id');
    const allowedCloseFriendOwnerSet = new Set(
      closeFriendOwnerIds.map((owner) => owner._id.toString())
    );

    const visibleNotes = notes.filter((note) => {
      const ownerId = note.userId?._id?.toString?.();
      if (!ownerId) return false;
      if (ownerId === req.user.id) return true;

      const noteVisibility = note.visibility || 'followers';
      if (noteVisibility === 'close_friends') {
        return allowedCloseFriendOwnerSet.has(ownerId);
      }
      return true;
    });

    // 自分のノートを先頭に
    const myNotes = visibleNotes.filter(n => n.userId._id.toString() === req.user.id);
    const otherNotes = visibleNotes.filter(n => n.userId._id.toString() !== req.user.id);

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
