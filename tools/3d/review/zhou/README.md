# 周教授：單人外觀樣板 v1

先用 Blender 5.2 開啟 `zhou-review.blend`。所有材質已封裝，不必安裝 FaceBuilder 才能旋轉、雕刻或編輯完成的網格。

這一份用原概念圖重新擬合了立體頭部，替換通用臉部，並新增獨立的短髮網格與幾何髮絲。完整身體、衣服與骨架仍可編輯。這是供相似度判斷的第一版，**尚未達到最終寫實品質**。

原概念圖已封裝為 `REFERENCE_Zhou_OriginalConcept`；可在 Image Editor 選取。檔內有 REVIEW_Front、REVIEW_ThreeQuarter、REVIEW_Side、REVIEW_Back 四台正交檢視相機。頭頸交界使用 head／neck_01 混合權重；六段動作已套用手腕連續旋轉修正。`model-inspection.json` 記錄模型結構。

先確認：

1. 正面臉型、眼鼻口位置和成熟感是否接近原圖。
2. 關掉皮膚色彩、查看灰模時，五官是否仍成立。
3. 側面額頭、鼻尖、嘴唇、下顎與後腦是否自然。
4. 髮線、分線和頭髮輪廓是否需要調整。

現階段的限制：

- 皮膚顏色是 FaceBuilder 烘焙的原圖投影，還有原圖光影。程序式微細表面只是初步材質，不是掃描毛孔，也不是已完成的去光照 PBR 皮膚。
- 只有單角度概念圖；側面、後腦、頭髮背面是推定，無法聲稱未知角度與原圖完全相同。
- 服裝、全身體態與六段動畫沿用坐姿修正版作接合測試，尚未完成寫實服裝雕刻、真人表演或手指接觸精修。
- 已把頸部及原圖未覆蓋的側面改用過渡皮膚材質，避免把衣領、透明背景或黑色缺口投到皮膚上。這些部位尚待真正的皮膚貼圖與色彩接縫精修。

請以這份實際 `.blend` 及同網格渲染預覽驗收。只有你確認這一位的方向後，才開始另外兩位的新外觀製作。

## 製作與來源

- 頭部：KeenTools FaceBuilder 2026.3.1 官方免費試用；使用專案內 interviewer-logic.png 在本機擬合。無購買訂閱。官方外掛與 Core 來自 https://downloads.keentools.io/，版本入口由官方下載頁查得。
- 主檔：Blender 5.2.2，可編輯網格及 53 骨骼。FaceBuilder 擬合工程另存 `../../source/zhou-facebuilder-fit.blend`，那份檔案若要繼續使用 FaceBuilder 專屬擬合功能，需安裝外掛並有有效試用或授權。
- 身體、衣服：既有 MakeHuman／Margaret Toigo CC0 過渡資產；詳見 `../../DELIVERY.md`。
- 幾何髮絲：本次新增。

重建順序：先執行 facebuilder_probe.py 建立擬合頭部，再依序執行 build_zhou_review.py、finalize_zhou_review.py、clean_zhou_review.py；最後用 package_zhou_review.py 整理比對圖及打包。完成模型不需執行這些腳本即可開啟。

下載檔 SHA-256（供檔案追蹤，不代表官方提供的數位簽章或無風險保證）：

| 官方檔案 | SHA-256 |
|---|---|
| keentools-2026.3.1.zip | 2DD4D9FD11BBA69B1C9FFC346CF08E2F109F99FF203E89F6B2BDFC4DF0B9E451 |
| keentools-core-2026.3.1-windows.zip | CA7BB07AB327768AB0D3AD6D8C23FC6E9EF1EE085D755F058A5AC56CB43C783B |
