# Render デプロイ手順

## 症状: `Exited with status 1` / `npm ci` で 4 packages しか入らない

**原因:** Render の **Root Directory** がバックエンドではなくリポジトリルートになっている。  
ルートの `package.json` は依存がほぼなく、`express` 等がインストールされず起動直後に落ちます。

## 正しい Render 設定（ダッシュボード）

| 項目 | 値 |
|------|-----|
| **Root Directory** | `backEnd`（モノレポの場合）または空欄（バックエンド単体リポジトリで `server.js` がルートにある場合） |
| **Build Command** | `npm ci` |
| **Start Command** | `npm start` |
| **Node バージョン** | `20`（環境変数 `NODE_VERSION=20` 推奨） |

ビルドログで **`audited 200+ packages`** 程度になれば OK。`audited 4 packages` のままなら Root Directory が誤りです。

## 必須環境変数

| 変数名 | 説明 |
|--------|------|
| `JWT_SECRET` | 認証用（未設定だと起動時に即終了） |
| `SESSION_SECRET` | セッション用（未設定だと即終了） |
| `MONGO_URL` | MongoDB 接続文字列（`MONGO_URI` / `MONGODB_URI` でも可） |

## リポジトリ `Y-Hakua-SNS-backend` の場合

1. リポジトリルートに `backEnd/` と同じ内容があるか確認（`server.js`, `package.json`, `package-lock.json` がルート直下）
2. ルートの `package.json` が `cloudinary` だけになっていないか確認
3. 最新の `backEnd` を push したうえで Render で **Manual Deploy → Clear build cache & deploy**
