# Migration and Recovery Runbook

## D1状態を更新する前

1. Sandboxを停止またはread-onlyにする。
2. GETで対象stateを取得し、ETagとstateVersionを保存する。
3. ローカルのJSONをSandboxEngineのimport検査へ通す。
4. 画像本体が含まれていないこと、draftOwnersとdraftsの対応があることを確認する。
5. walletsにopeningBalanceがない旧状態はbuyer=200,000円、それ以外=0円として移行されることを確認する。
6. profilesのavatarRefがmedia参照形式で、Data URL/Blob URLを含まないことを確認する。
7. If-Match-State-Versionを付けてPUTする。

## 409競合

競合時に上書き再送しない。最新状態を取得し、ドメイン操作を再計算し、ユーザーの未保存変更を確認してから再送します。

## 復旧

1. 直近のバックアップのstateVersionとETagを確認する。
2. D1の対象IDをread-onlyにする。
3. importStateとassertInvariantsを実行する。
4. 管理者scopeでIf-Match-State-Versionを付けて復元する。
5. 出品、在庫、購入予約、取引の代表シナリオを実行する。
6. 監査イベントとstateVersionをリリース記録へ残す。

## ウォレット不整合

利用可能残高を直接修正しない。openingBalanceから台帳を再計算し、入出金・保留・確定・返金・売上・手数料の各イベントと照合する。heldBalanceが残っている場合は出金させず、取引状態を先に復旧する。

## プロフィール画像欠落

avatarRefのBlobが見つからない場合はfallback画像を表示し、プロフィール本文とactor identityは保持する。再アップロードで新しいmedia参照を作成し、旧参照を状態から外してから不要なBlobを削除する。

## 画像復旧

画像参照が欠落した場合は、出品を自動公開しない。該当media IDをerror状態にして再アップロードを要求し、既存の出品のテキストと在庫状態は別トランザクションで保護します。
