# backEnd を GitHub に push する方法

対象リポジトリ: [RyoOtani/-Y-Hakua-SNS-backend](https://github.com/RyoOtani/-Y-Hakua-SNS-backend)

このリポジトリは **ルートに `backEnd/` フォルダがあるモノレポ構成** です。  
`git subtree push` は使わず、**プロジェクト全体（`main` ブランチ）を push** してください。

## 初回設定（済みなら不要）

```bash
cd /path/to/ysnscopy
git remote add backend-source https://github.com/RyoOtani/-Y-Hakua-SNS-backend.git
```

## いつもの手順

```bash
cd /path/to/ysnscopy

# backEnd など変更をコミット
git add backEnd
git commit -m "説明: 変更内容を書く"

# GitHub の master に反映
git push backend-source main:master
```

## よくある間違い

| 間違い | 結果 |
|--------|------|
| `git subtree push --prefix=backEnd ...` | リポジトリ構成と合わず push が rejected される |
| Render の Root Directory を空欄のまま | `npm ci` が 4 packages だけになり起動失敗 |
| ルートだけ push して `backEnd/` を更新しない | GitHub 上の `backEnd/` が古いまま |

## Render との関係

GitHub に push したあと、Render で **Root Directory = `backEnd`** を設定して再デプロイしてください。
