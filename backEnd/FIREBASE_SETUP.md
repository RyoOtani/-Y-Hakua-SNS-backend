# Firebase Cloud Messaging セットアップ（BackEnd）

## 1. Firebase サービスアカウントを作成
1. Firebase Console で対象プロジェクトを開く
2. 「プロジェクトの設定」→「サービスアカウント」
3. 新しい秘密鍵（JSON）を生成

## 2. 環境変数を設定
`backEnd` の実行環境に以下を設定してください。

- `FIREBASE_PROJECT_ID`
- `FIREBASE_CLIENT_EMAIL`
- `FIREBASE_PRIVATE_KEY`

`FIREBASE_PRIVATE_KEY` は改行を `\n` でエスケープした文字列を使ってください。

例:

```env
FIREBASE_PROJECT_ID=your-project-id
FIREBASE_CLIENT_EMAIL=firebase-adminsdk-xxxx@your-project-id.iam.gserviceaccount.com
FIREBASE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----\n"
```

## 3. 動作
- `POST` へのいいね・コメント通知作成時に FCM 送信を実行
- 無効なトークン（`registration-token-not-registered`）は自動でDBから削除

## 4. 注意
- Firebase未設定でもサーバーは起動します（FCM送信のみ自動無効）
- 既存のSocket通知はそのまま残しているため、段階的移行が可能です
