# VivaPrep 角色交付與驗收

2026-09-26：v2 是修正坐姿、骨架對齊與獨立匯出的**過渡版本**。它不是已通過外觀驗收的寫實角色；臉型、髮型、皮膚與動作節奏仍需重新製作。後續先做周教授單人樣板，經使用者在 Blender 確認後才製作其餘兩位。

## 檔案

| 角色 | 職責／檔名 | Blender 原始檔 | 骨架 | 站立目標高度 |
|---|---|---|---|---|
| 林教授 | technical | source/technical.blend | VivaPrep_technical_Rig | 1.72 m |
| 陳教授 | portfolio | source/portfolio.blend | VivaPrep_portfolio_Rig | 1.67 m |
| 周教授 | logic | source/logic.blend | VivaPrep_logic_Rig | 1.73 m |

GLB：`../../public/assets/avatars/{technical,portfolio,logic}.glb`。每份均內嵌材質貼圖、53 根骨骼與六段獨立動作：Idle、Listening、ReadingNotes、SpeakingGesture、FollowUp、Thinking。指骨有權重；身體與衣服跟隨同一骨架。沒有拉長手臂補足桌面距離。

`source/VivaPrep-interviewers.blend` 和舊的 `preview/interviewers-lineup.png` 是之前版本，請用上述三份獨立原始檔驗收。

正交參考位於 `preview/v2/`：每人有 standing-front、standing-side、standing-back、seated-front、seated-side PNG；另有三視圖／坐姿拼版與六動作姿勢圖。這些都是交付模型的實際渲染，三視圖使用同一個 2.02 m 正交視幅、720 × 960 畫布。動作姿勢圖只代表中間一幀，不是流暢度證明。

## 比例、方向與座位

Blender 單位為公尺，Z 向上、角色朝 -Y；GLB 匯出轉成 Y 向上、角色朝 +Z。原點位於座位下方的地面，請保留匯出的骨架根節點位移，不能再用人物包圍盒歸零。

| 參數 | Blender／GLB 實體尺寸 | 前端場景（固定乘 2） |
|---|---:|---:|
| 椅面高度 | 0.46 m | 0.92 |
| 桌面高度 | 0.75 m | 1.50 |
| 骨盆關節高度 | 0.555 m | 1.11 |
| 待機手腕高度 | 0.775 m | 1.55 |
| 人物容器地面高度 | 0 | 0 |
| 人物容器前後位置 | — | z = -0.85 |

骨盆關節位於身體內部，因此不能把骨盆關節直接貼在椅面。`src/interview-scene.js` 的 AVATAR_PLACEMENT 使用固定等比縮放，不再用坐姿包圍盒高度推算比例；椅面從舊的 1.335 下修為 0.92，桌面改為 1.50。三位模型皆實際彎腿，鞋底距地面約 0.5–1 mm（Blender 尺度）。細節數值見 preview/v2/geometry-report.json。

Blender 檔內有 QA_Chair、QA_Desk、地面、燈與相機作為驗收工具，都是獨立物件。GLB 只匯出人物、衣服、頭髮、配件與骨架，不包含這些場景物件。

## Blender 檢視方式

開啟任一獨立 .blend，選擇骨架，在 Dope Sheet 的 Action Editor 切換六段動作。場景為每秒 30 幀，動作約 3.2–4.8 秒，原始動作保留可編輯關鍵幀。按小鍵盤 1／3 檢查正／側視圖。材質與貼圖已封裝，不需安裝 MPFB 才能開啟或編輯完成的模型。

本輪六段動作為程序式骨架動畫，有不同手勢與前傾幅度，端點可循環；它們不是真人動捕，不能宣稱已達遊戲角色的自然表演品質。後續需要真人表演參考、非同步動作節奏、接觸修正與手指細修。

已額外修正手掌法線插值穿過零向量及四元數正負號不連續造成的手腕突跳。匯出的每秒 30 幀動畫中，三人所有動作的最大相鄰幀關節旋轉為 3.884°；修正前曾達 179.449°。這是旋轉連續性檢查，不代表已達真人表演品質。

前端驗收：啟動專案後開啟 /avatar-review.html，可選角色、動作、正／側／背面、顯示桌面及暫停。

## 重建與檢查

run-blender.ps1 預設執行 build_interviewers_v2.py；可透過 BLENDER_EXE、MPFB_ADDON_PATH、MPFB_ASSET_ROOT、MPFB_USER_DATA 指定工具位置。舊的 build_interviewers.py 保留作歷史參考。

```powershell
./tools/3d/run-blender.ps1
./tools/3d/run-blender.ps1 -Script tools/3d/render_deliverables.py
python tools/3d/validate_glb.py
```

VIVAPREP_CHARACTER 可設為角色 ID 只重建一人；VIVAPREP_SKIP_PREVIEW_RENDER=1 略過預覽。GLB 使用選取物件、ACTIONS 動畫、蒙皮、材質與 Y-up 匯出，寫入暫存檔完成後才替換正式檔。檢查結果見 preview/v2/glb-validation.json；它驗證檔案結構與循環端點，不代替外觀和動作的人工驗收。

## 過渡版本資產來源

- MakeHuman system assets：MakeHuman Community，CC0；基礎網格、皮膚、頭髮、眼睛等。[授權](https://static.makehumancommunity.org/about/license.html)
- suits01：Margaret Toigo，CC0；三套服裝。[來源](https://static.makehumancommunity.org/assets/assetpacks/suits01.html)
- Blender、MPFB 是製作工具，不隨模型重新散布。

本輪角色不含校名、校徽或學校識別。
