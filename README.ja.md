# 3Y ツールボックス（YYPDFTools）

<p align="center">
  <strong>ブラウザだけで動作する、プライバシー重視の PDF・画像ツール</strong>
</p>

<p align="center">
  <a href="README.md">繁體中文</a> ｜ <a href="README.en.md">English</a> ｜ 日本語
</p>

<p align="center">
  <img alt="フロントエンドのみ" src="https://img.shields.io/badge/構成-フロントエンドのみ-2563eb">
  <img alt="ファイルをアップロードしない" src="https://img.shields.io/badge/プライバシー-アップロードなし-16803c">
  <img alt="3言語対応" src="https://img.shields.io/badge/UI-中・英・日-7c3aed">
</p>

![3Y ツールボックスの繁体字中国語ホーム画面](docs/images/yyypdftools-home.jpg)

## 概要

3Y ツールボックスは、PDF と画像を扱うシングルページのユーティリティ集です。選択したファイルはユーザーの端末内に残り、変換・結合・出力はすべてブラウザ内の JavaScript で実行されます。文書をバックエンドサーバーへアップロードする必要はありません。

日常的な文書処理にすぐ使えるほか、静的サイトとしてそのまま公開できます。繁体字中国語、英語、日本語に対応し、OS の設定に合わせてライト／ダークテーマを自動で切り替えます。

## 機能

| ツール | 内容 | 出力 |
| --- | --- | --- |
| PDF 画像変換 | PDF の各ページを JPG または PNG に変換 | 画像または ZIP |
| 画像 PDF 変換 | 複数の JPG／PNG を 1 つの文書に結合 | PDF |
| PDF 結合 | 複数の PDF を結合し、ドラッグで順序を変更 | PDF |
| PDF 分割 | 指定ページの後で 2 分割、または指定範囲を 1 ページずつ分割 | PDF または ZIP |
| PDF 圧縮 | ページをラスタライズし、選択した画質で PDF を再構築 | PDF |
| PDF 解除 | 既知のパスワードを使って、保護されていない PDF を再構築 | PDF |
| PDF 回転 | 全ページを時計回りに 90°、180°、270° 回転 | PDF |
| HEIC JPG 変換 | 1 枚または複数の HEIC／HEIF 写真を JPG に変換 | JPG |

インターフェースの特徴：

- 繁体字中国語、English、日本語を即時切り替え
- ドラッグ＆ドロップとファイル選択の両方に対応
- ライト／ダークテーマを自動適用
- 進行状況、完了通知、対処方法が分かるエラーメッセージ
- キーボードフォーカス、セマンティックなタブ、動的ステータス通知
- デスクトップとモバイルに対応したレスポンシブレイアウト

## プライバシーと処理方式

ファイルの内容はすべて、現在開いているブラウザタブ内で処理されます。アップロード API はなく、アカウント登録も不要です。

初回表示では CDN からフロントエンドライブラリを取得するため、ページの読み込みにはインターネット接続が必要です。リソースの読み込み後、文書処理そのものはローカルで行われます。完全オフライン版にする場合は、下記の CDN 依存ライブラリをダウンロードし、参照先をローカルパスに置き換えてください。

> [!IMPORTANT]
> 「PDF 圧縮」と「PDF 解除」は、各ページを画像化してから PDF を再構築します。ブラウザだけで処理できますが、出力文書の文字は選択・検索できなくなります。解除機能は、元のパスワードが分かっていて、ブラウザの PDF エンジンがその文書を読み取れる場合に限り利用できます。

## 使い方

1. ツールボックスを開き、ナビゲーションから使用する機能を選びます。
2. アップロード領域をクリックするか、ファイルをドラッグ＆ドロップします。
3. 必要に応じて形式、ページ範囲、画質、パスワード、回転角度を設定します。
4. 処理を開始すると、完了後にブラウザから結果がダウンロードされます。

すべての操作は現在の端末で完結します。大容量または高解像度の文書では、端末性能、ページ数、画像サイズに応じて時間とメモリを多く使用する場合があります。

## ローカルで実行

ビルドや npm のインストールが不要な静的サイトです。リポジトリを取得し、簡易 HTTP サーバーを起動します。

```bash
git clone https://github.com/YenYuY/YYPDFTools.git
cd YYPDFTools
python3 -m http.server 8000
```

その後、[http://localhost:8000](http://localhost:8000) を開いてください。VS Code Live Server、Caddy、Nginx などの静的サーバーも利用できます。

`file://` で `index.html` を直接開く方法は、ブラウザによって Worker、ダウンロード、クロスオリジンリソースが制限されるため推奨しません。

## 技術構成

- HTML、CSS、Vanilla JavaScript
- [Tailwind CSS](https://tailwindcss.com/)（CDN）
- [PDF.js](https://mozilla.github.io/pdf.js/)：PDF ページの読み込みと描画
- [pdf-lib](https://pdf-lib.js.org/)：PDF の作成、結合、分割、回転
- [JSZip](https://stuk.github.io/jszip/)：複数ファイルの ZIP 化
- [FileSaver.js](https://github.com/eligrey/FileSaver.js/)：生成ファイルの保存
- [heic-to](https://github.com/hoppergee/heic-to)：HEIC／HEIF 変換

## プロジェクト構成

```text
YYPDFTools/
├── index.html                 # メインアプリケーション／既定の入口
├── index-layout-v2.html       # 別レイアウトの試作版
├── inden-1.html               # 以前のレイアウトのバックアップ
├── PRODUCT.md                 # 製品方針とデザイン原則
├── README.md                  # 繁体字中国語（GitHub の既定表示）
├── README.en.md               # 英語
├── README.ja.md               # 日本語
└── docs/images/
    └── yyypdftools-home.jpg   # README 用画面キャプチャ
```

## ブラウザ要件と制限

- 最新版の Chrome、Edge、Firefox、Safari を推奨します。
- 大きな PDF は多くのメモリを使用します。タブが強制終了する場合は、ページ数を減らすか分割して処理してください。
- 暗号化 PDF の対応範囲は PDF.js に依存し、一部の暗号化方式はブラウザで解除できません。
- ラスタライズ圧縮はスキャン PDF に向いており、テキスト中心の PDF では小さくならない場合があります。
- HEIC の対応状況は、ブラウザの WebAssembly と画像デコード機能に依存します。

## コントリビューション

Issue と Pull Request を歓迎します。機能を変更する際は、3 言語、ライト／ダークテーマ、キーボード操作、デスクトップ／モバイルの各レイアウトを確認してください。

---

このプロジェクトが役立ったら、GitHub で ⭐ を付けていただけるとうれしいです。
