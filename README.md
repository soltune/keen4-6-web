# Commander Keen 4–6 — ブラウザ移植版

K1n9_Duk3 による再構築ソース（16-bit DOS / id Engine）を **Emscripten で WebAssembly に
ネイティブ移植**し、ブラウザで動作させたものです。表示・入力・音声・セーブは TypeScript の
Web シェル（Vite）が担います。**サーバ不要**（静的ホスティングで動作）。

対応エピソード: **CK4 (Secret of the Oracle) / CK5 (The Armageddon Machine) / CK6 (Aliens Ate My Babysitter)**

> **データについて**: グラフィック・マップ・音声などのゲームデータは**同梱しません**。
> 各自が**正規に所有する**ものだけを使用してください（再配布不可）。ソースは GPLv2+ です。

---

## 必要なもの

- **Node.js 18 以上**（`npm`）
- **モダンブラウザ**（Chrome / Edge / Firefox / Safari の現行版。WebAssembly と Web Audio が必須）
- 各エピソードの**ゲームデータ**（あなたが正規に所有するもの）
- （任意）**Emscripten / emsdk**（emcc 6.0.0）— **WASM エンジンを再ビルドする場合のみ**必要。
  ビルド済みエンジンがある場合は不要です。

---

## ディレクトリ構成（抜粋）

```
keen4-6/
├── dos/ck4|ck5|ck6/      ← ゲームデータの置き場所（あなたのファイル）
├── tools/extract.mjs     ← データ抽出スクリプト
├── engine/               ← 移植エンジン（C → WASM）
│   ├── game/  platform/  ← 移植ソース／Web 用 I/O 実装
│   └── port/             ← ビルド・リンクスクリプト（build.sh / link.sh）
├── web/                  ← Web アプリ（Vite + TypeScript）
│   ├── public/engine/    ← ビルド済みエンジン keen{4,5,6}.{js,wasm,data}
│   └── test/             ← 動作検証ハーネス
└── README.md
```

---

## いちばん簡単な起動（ビルド済みエンジンがある場合）

`web/public/engine/keen{4,5,6}.*` が既に用意されているなら、Web アプリを動かすだけです。

```bash
cd web
npm install
npm run dev          # → http://localhost:5173/
```

ブラウザで開き、**CK4 / CK5 / CK6 を選択** → タイトル画面で **Space** でゲーム開始。

---

## 自分のゲームデータでビルドする

エンジンにはデータが同梱（プリロード）されるため、**データを差し替えるにはエンジンの
再リンクが必要**です（＝ここだけ Emscripten が要ります）。

### 1. データを配置

各エピソードの DOS 版ファイルを `dos/ck4`, `dos/ck5`, `dos/ck6` に置きます。

```
dos/ck4/
├── KEEN4E.EXE      ← EGA 版 EXE（ヘッダ/辞書の抽出に使用。CK5=KEEN5E.EXE / CK6=Keen6.exe）
├── EGAGRAPH.CK4    ← グラフィック
├── GAMEMAPS.CK4    ← マップ
└── AUDIO.CK4       ← 音声
```

### 2. データを抽出する

EXE は LZEXE 圧縮されており、エンジンが必要とするヘッダ／辞書（`EGADICT` / `EGAHEAD` /
`MAPHEAD`）が中に埋め込まれています。抽出スクリプトが UNLZEXE 伸長して切り出し、
`EGAGRAPH` / `GAMEMAPS` / `AUDIO` とともに `web/public/data/<id>/` へ書き出します。

```bash
cd web && npm install
npm run extract                      # CK4/5/6 すべて
# 個別に行う場合:  node ../tools/extract.mjs ck4
```

### 3. エンジン（WASM）をビルドする

```bash
source ~/emsdk/emsdk_env.sh          # emsdk を有効化（emcc 6.0.0）
bash engine/port/build.sh            # 全エピソードをコンパイル（各 TU の OK/ERR を表示）
bash engine/port/link.sh 4           # CK4 をリンク → web/public/engine/keen4.{js,wasm,data}
bash engine/port/link.sh 5           # CK5
bash engine/port/link.sh 6           # CK6
```

> `link.sh` はゲームデータをエンジンに同梱します（`engine/build/data_v14/ck<ep>/` があれば
> それを、無ければ手順 2 の `web/public/data/ck<ep>/` を使用）。

### 4. 起動 / 本番ビルド

```bash
cd web
npm run dev                          # 開発サーバ（ホットリロード）→ http://localhost:5173/

# 本番ビルド（静的ファイルを dist/ に出力）
npm run build
npm run preview                      # ビルド結果をローカル確認
```

`dist/` を任意の静的ホスティングに置けば配信できます。

---

## 操作方法

> 音声はブラウザの自動再生制限のため、**最初のクリック／キー操作**で有効になります。

### キーボード（DOS 既定）

| 操作 | キー |
|---|---|
| 移動 | `←` `→`（メニュー・見回しは `↑` `↓`） |
| ジャンプ | `Ctrl` |
| ポゴスティック | `Alt` |
| 発射（スタナー）／開始 | `Space` |
| メニュー決定 | `Enter` |
| ポーズ | `P` |
| ヘルプ／ステータス | `F1` |
| フルスクリーン切替 | `F` |

> 文字キー（`A`–`Z`・数字）はそのまま入力でき、セーブ名の入力やメニューの頭文字ショートカット
> （`L`=Load / `S`=Save / `C`=Configure）に使えます。`WASD` で移動したい場合は、ゲーム内の
> **Configure** でキー割り当てを変更してください（設定は保存されます）。

### ゲームパッド（USB / Bluetooth・ホットプラグ対応）

ゲーム開始後に接続しても自動認識されます（標準マッピング）。

| 操作 | ボタン |
|---|---|
| 移動 | 十字キー / 左スティック |
| ジャンプ／決定 | A |
| ポゴ／戻る | B |
| 発射 | X / Y |

### バーチャルパッド（スマホ・タッチ）

画面上の方向パッドとボタンで操作します。画面右上の **🎮** で表示/非表示を切り替えます。

### 画面右上の HUD ボタン

| ボタン | 機能 |
|---|---|
| ⛶ | フルスクリーン切替 |
| ▣ | アスペクト比切替（4:3 ↔ ピクセル等倍） |
| 🎮 | バーチャルパッド 表示/非表示 |

### セーブ

ゲーム内メニューからセーブ／ロードできます。**セーブデータと設定はブラウザに保存され
（IndexedDB）、リロードしても残ります**。

---

## 仕組み（概要）

- エンジン本体は元の DOS ソースをそのまま WASM 化（`engine/game` ＋ Web 用 I/O 実装
  `engine/platform`）。`main()` を ASYNCIFY で動かし、フレーム提示と入力供給を Web シェルが担当。
- 音声は **OPL2（YM3812）FM 音源**を C で内蔵し、ゲーム本来の **IMF 音楽**と効果音を合成。
- 画面は **320×200・16 色 EGA** をフレームバッファ化して Canvas に描画。
- 移植の詳しい方針は [`engine/PORTING.md`](engine/PORTING.md) を参照。

---

## 開発者向け：動作検証

`web/test/` に検証ハーネスがあります。

```bash
# ブラウザ検証（要 `npm run dev` 起動、Playwright を使用）
node web/test/verify-wasm-browser.mjs        # 起動→ワープ→移動/ジャンプ、描画とエラー有無
node web/test/verify-wasm-audio-browser.mjs  # Web Audio で実際に音が鳴るか
node web/test/verify-wasm-persist.mjs        # 設定がリロードをまたいで残るか
node web/test/verify-wasm-savegame.mjs       # セーブ→ロード→リロード保持

# ヘッドレス検証（Node、リンク済みエンジンが必要）
node web/test/verify-wasm.mjs 4              # 起動スモーク
node web/test/warp-test.mjs 4 1,5,9         # 各レベルへワープして物理を確認
node web/test/level-test.mjs 4              # ワールドマップ→レベル進入→物理
node web/test/play-test.mjs 4              # プレイヤー/スクロール状態の確認
```

---

## ライセンス

GPL-2.0-or-later（再構築ソースに準拠）。ゲームデータは各自の**正規所有物のみ**使用してください。

内蔵 FM 音源は [Nuked-OPL3](https://github.com/nukeykt/Nuked-OPL3)（© Nuke.YKT、LGPL-2.1）を `engine/platform/nukedopl/` に同梱しています。
