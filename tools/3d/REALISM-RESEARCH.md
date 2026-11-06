# VivaPrep：從概念圖到寫實遊戲角色

調研日期：2026-09-26。製作決策：先做周教授單人樣板，讓使用者在 Blender 驗收外觀與實際網格，通過後才做林教授與陳教授。

## 目前「假」的來源

這是檢視現有模型與原概念圖後的判斷：現有臉部形體是通用人物，顴骨、眼瞼、口周和年齡感未對齊；髮型輪廓也不同。皮膚只有平滑的色彩層，缺少不同尺度的表面細節；眼睛、衣料與頭髮對光的反應過於一致。坐姿問題可以靠正確關節與座位尺寸修正，但不能改善相貌。六段動作共用規律的正弦節奏，身體、手和頭幾乎同步起落，因而像機器。

提高面數、提高動畫幀率或加強磨皮都不會自動解決上述問題。應以「形體相似 → 材質可信 → 綁定可變形 → 表演自然 → 瀏覽器保真」逐關驗收。

## 建模流程

1. **建立一致的參考。** 正面、側面、背面須對齊眼高、肩、骨盆和腳底，並使用相同尺度。單張原圖的透視、頭部傾斜和表情要先解開，不能直接把它當正交正面。現有概念圖沒有真實側面與後腦資料，這些部位必須推定並接受設計驗收；無法證明與未提供的角度完全一致。
2. **先完成臉部形體。** 用 FaceBuilder 對齊原圖的眼角、鼻翼、唇線、下顎等，再在 Blender 修整。先用灰模、多角度和剪影判斷像不像，避免用照片貼圖掩蓋錯誤形體。FaceBuilder 能從單張或多張照片擬合頭部，並提供表情形態；它不是自動產出髮型、服裝與完整遊戲角色的工具。[官方功能](https://keentools.io/products/facebuilder-for-blender)
3. **做可變形的角色網格。** 頭部保留眼瞼、口周環線；肩腋、手肘、手指和髖膝保留足夠環線。服裝是獨立曲面，領口、袖口、翻領、接縫和坐下後的受力皺褶要有實際形體。以高解析雕刻製作中尺度細節，再烘焙到可即時運行的低模。
4. **分層製作皮膚。** 色彩、粗糙度、法線各司其職；毛孔、細紋、較深皺褶不應全部畫在同一張顏色貼圖。鼻、額頭、臉頰和嘴唇需要不同反光。適量皮下散射讓光穿過皮膚，過量會像蠟。眼睛需要合理的角膜、虹膜深度與眼瞼遮蔽；頭髮要有髮束方向與散落髮絲。Epic 的數位人範例將皮膚貼圖、微細法線、區域反光、眼睛和毛髮作為不同問題處理。[Epic Digital Humans](https://dev.epicgames.com/documentation/unreal-engine/digital-humans?application_version=4.27)
5. **建立近景與網頁版本。** Blender 可保留高解析網格、完整頭髮和材質；GLB 則需要烘焙與簡化。程序材質、毛髮系統或特定引擎皮膚著色器不能假定會自動一比一匯出。先在 Three.js 測試皮膚、眼睛與髮絲，再決定額外著色器或貼圖策略。[Blender glTF 匯出說明](https://docs.blender.org/manual/en/4.1/addons/import_export/scene_gltf2.html)

## 流暢動作的製作方法

先以真人坐姿表演或動捕取得不完全規律的節奏，再做重定向和人工清理。重要的是重心、停頓、動作先後與接觸點，不只是曲線看起來平滑。

| 動作 | 可辨識的表演 | 必修接觸與細節 |
|---|---|---|
| Idle | 呼吸、一次小幅重心調整，左右不完全對稱 | 臀部留在椅面，腳底穩定 |
| Listening | 先凝視，再點頭，短暫停頓 | 頭、頸、胸有先後，不整塊一起晃 |
| ReadingNotes | 眼睛先看下方，頭跟隨，翻頁或書寫 | 手指握筆、筆尖貼紙、手腕不穿桌 |
| SpeakingGesture | 手離桌、開掌說明、停住、收回 | 肩／肘／腕不同步，避免揮手節奏 |
| FollowUp | 身體前傾，接著開掌或指向，保持等待 | 骨盆不漂移，不能靠手臂拉伸補距離 |
| Thinking | 視線轉移、停頓、輕微轉頭或托頰 | 手與臉有接觸時鎖定接觸點 |

採集動作後，用 IK 固定需要接觸桌面或地面的手腳，保留自然肩部運動；清掉突跳、穿模、腳滑，再逐段調整曲線與轉場。Epic 的重定向文件也把腳滑和接觸固定列為需要額外處理的問題。[官方 IK 範例](https://dev.epicgames.com/documentation/unreal-engine/fix-foot-sliding-with-ik-retargeter-in-unreal-engine)

Rokoko Vision 可由影片取得身體動作，仍需清理坐姿與手部；不能假定影片動捕已完成手指、握筆與翻頁。Mixamo 可作為免費基礎動作來源，但特定面試表演仍需編修。[Rokoko Vision](https://www.rokoko.com/products/vision)、[Adobe Mixamo FAQ](https://helpx.adobe.com/creative-cloud/faq/mixamo-faq.html)

## 工具選擇

| 工具 | 本案用途 | 限制／決策 |
|---|---|---|
| Blender | 雕刻、服裝、綁定、動畫修整、渲染、GLB | 保留為主要可編輯原始檔 |
| KeenTools FaceBuilder | 原圖頭部相似度校準 | 官方 15 天試用；之後進階擬合需授權，完成的網格仍可開啟及匯出 |
| Character Creator／Headshot | 成熟的全身、服裝、皮膚與表情流程 | 付費路線；沒有授權不視為已可使用 |
| MetaHuman | 高品質臉部、皮膚與表情參考／Unreal 工作流 | Conform 可由網格建立角色，但本案 Three.js／GLB 仍需要移植與材質適配 |
| MakeHuman／MPFB | 過渡版本的人體拓撲與骨架基礎 | 通用外觀不足以作為高相似度最終角色 |

來源：[FaceBuilder 試用與下載](https://keentools.io/download/facebuilder-for-blender)、[CC 掃描角色流程](https://www.reallusion.com/character-creator/3d-scan.html)、[CC Blender 整合](https://www.reallusion.com/character-creator/blender.html)、[MetaHuman From Mesh](https://dev.epicgames.com/documentation/metahuman/from-mesh)。

## 周教授的驗收關卡

- 第一關：同角度比對五官位置、下顎、年齡感、髮線與髮型輪廓；另看無貼圖灰模的正／側／三分之四視角。照片投影可以幫助比對，但不能把原圖中的光影當作已完成的 PBR 皮膚。
- 第二關：固定中性光源檢查毛孔、皺紋、眼睛、髮絲、衣料和領帶，確認換光後沒有照片式固定陰影。
- 第三關：坐姿正／側視圖，檢查臀部、膝蓋、鞋底、肘腕，並播放 SpeakingGesture、FollowUp 及 ReadingNotes。
- 第四關：在網頁與 Blender 比較，檢查材質落差、轉場、三人同場效能，以及每人獨立載入。

目前過渡版本只通過檔案結構、骨架、座位對齊與動作名稱檢查；沒有宣稱已通過上述寫實外觀驗收。後兩位的新外觀製作須等周教授通過使用者驗收。
