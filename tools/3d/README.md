# VivaPrep 3D 面試官

VivaPrep 使用 Blender 與 MPFB 製作三個獨立、可替換的面試官角色。每位角色各自輸出為自包含的 glTF Binary（GLB），內含骨架、材質與下列動作片段：

- `Idle`：自然待機
- `Listening`：聆聽與點頭
- `ReadingNotes`：低頭查看筆記
- `SpeakingGesture`：提問時手勢
- `FollowUp`：前傾追問
- `Thinking`：思考

模型位於 `public/assets/avatars/`，可編輯的 Blender 場景位於 `tools/3d/source/VivaPrep-interviewers.blend`，合成預覽位於 `tools/3d/preview/interviewers-lineup.png`。面試房間、椅子與桌子由前端場景另外建立，面試官模型本身不會烘焙進場景背景。

## 重新產生模型

建置腳本使用 Blender 5.2、MPFB 2 與本機安裝的 MakeHuman 資產。將以下環境變數指向對應資料夾後執行：

```powershell
$env:MPFB_ADDON_PATH = "<Blender profile>\scripts\addons\mpfb"
$env:MPFB_ASSET_ROOT = "<MakeHuman assets>"
$env:MPFB_USER_DATA = "<local MPFB data>"
blender --background --python tools/3d/build_interviewers.py
```

可設定 `VIVAPREP_SKIP_PREVIEW_RENDER=1` 只重建角色與 Blender 原始場景，略過耗時的合成預覽渲染。

`MPFB_ASSET_ROOT` 需要包含 `skins/`、`clothes/`、`hair/`、`eyes/`、`eyebrows/`、`eyelashes/` 與 `teeth/` 資料夾。建置流程不會上傳模型、備審資料或其他檔案。

## 資產來源與授權

- MakeHuman system assets：MakeHuman Community，CC0。包含角色基礎網格、皮膚、頭髮、眼睛與五官素材。
- `suits01` 正式服裝：Margaret Toigo，CC0。包含本專案使用的三套西裝。
- MPFB 與 Blender 是建置工具，不會複製進本專案；請依其各自的發佈方式安裝。

來源：

- <https://static.makehumancommunity.org/assets/assetpacks/makehuman_system_assets.html>
- <https://static.makehumancommunity.org/assets/assetpacks/suits01.html>
- <https://static.makehumancommunity.org/about/license.html>
