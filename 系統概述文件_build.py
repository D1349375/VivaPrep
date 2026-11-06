"""VivaPrep 系統概述文件 — official-template build.

Follows 參考_2026第31屆競賽須知0831.docx: mandatory header fields, the 8 prescribed
section headings verbatim, A4 with 2/2/2/2cm margins + 1cm gutter, uniform 標楷體14
(table cells and captions included), single line spacing, 3pt before/after on every
paragraph, at most 5 pages. Tables and figures are allowed by the rules as long as
their text keeps the same font, size and spacing.

Usage: python 系統概述文件_build.py <output.docx>
Figures are read from 送件/圖表素材/ (architecture.png from diagram.py,
interview-room.jpg from screens.py).
"""
import sys
from pathlib import Path

from docx import Document
from docx.enum.table import WD_CELL_VERTICAL_ALIGNMENT, WD_TABLE_ALIGNMENT
from docx.enum.text import WD_ALIGN_PARAGRAPH, WD_LINE_SPACING
from docx.oxml import OxmlElement
from docx.oxml.ns import qn
from docx.shared import Cm, Pt, RGBColor

OUT = sys.argv[1] if len(sys.argv) > 1 else "VivaPrep.docx"
ASSETS = Path(__file__).resolve().parent / "送件" / "圖表素材"
FONT = "標楷體"
SIZE = 14
ACCENT = RGBColor(0xB5, 0x55, 0x36)
GBLUE = RGBColor(0x1A, 0x5F, 0xC8)
INK = RGBColor(0x3A, 0x2C, 0x25)  # warm dark brown, not pure black
MUTED = RGBColor(0x6B, 0x5A, 0x4E)
RULE = "A89488"  # table rule colour

doc = Document()
sec = doc.sections[0]
sec.page_height, sec.page_width = Cm(29.7), Cm(21.0)
sec.top_margin = sec.bottom_margin = Cm(2.0)
sec.left_margin = sec.right_margin = Cm(2.0)
sec.gutter = Cm(1.0)
sec.footer_distance = Cm(1.0)

normal = doc.styles["Normal"]
normal.font.name = FONT
normal.font.size = Pt(SIZE)
normal.font.color.rgb = INK
normal.element.rPr.rFonts.set(qn("w:eastAsia"), FONT)
pf = normal.paragraph_format
pf.space_before = Pt(3)
pf.space_after = Pt(3)
pf.line_spacing_rule = WD_LINE_SPACING.SINGLE


def set_font(run, bold=False, color=None):
    run.font.name = FONT
    run._element.get_or_add_rPr().get_or_add_rFonts().set(qn("w:eastAsia"), FONT)
    run.font.size = Pt(SIZE)
    run.bold = bold
    run.font.color.rgb = color if color is not None else INK


def rich(p, text, color=None):
    """**bold** segments inside text."""
    for i, part in enumerate(text.split("**")):
        if part:
            set_font(p.add_run(part), bold=(i % 2 == 1), color=color)
    return p


def spaced(p):
    p.paragraph_format.space_before = Pt(3)
    p.paragraph_format.space_after = Pt(3)
    p.paragraph_format.line_spacing_rule = WD_LINE_SPACING.SINGLE
    return p


def para(text, align=WD_ALIGN_PARAGRAPH.JUSTIFY, color=None):
    p = spaced(doc.add_paragraph())
    p.alignment = align
    return rich(p, text, color)


def heading(text):
    p = spaced(doc.add_paragraph())
    p.paragraph_format.keep_with_next = True
    set_font(p.add_run(text), bold=True, color=ACCENT)
    return p


def caption(text, keep_with_next=False):
    p = spaced(doc.add_paragraph())
    p.alignment = WD_ALIGN_PARAGRAPH.CENTER
    p.paragraph_format.keep_with_next = keep_with_next
    return rich(p, text, color=MUTED)


def figure(name, width_cm, text):
    doc.add_picture(str(ASSETS / name), width=Cm(width_cm))
    p = spaced(doc.paragraphs[-1])
    p.alignment = WD_ALIGN_PARAGRAPH.CENTER
    p.paragraph_format.keep_with_next = True
    caption(text)


def _el(tag, **attrs):
    el = OxmlElement(tag)
    for k, v in attrs.items():
        el.set(qn("w:" + k), str(v))
    return el


def _borders(tag, sides=("top", "left", "bottom", "right")):
    b = _el(tag)
    for side in sides:
        b.append(_el("w:" + side, val="single", sz="6", space="0", color=RULE))
    return b


def table(headers, rows, widths, header_fill, first_col_fill, first_col_color):
    """Bordered table; every cell paragraph keeps 標楷體14, single spacing, 3pt/3pt.

    Borders are written on every cell (not only at table level) so the rules between
    shaded first-column cells are always drawn. Elements are inserted in schema order.
    """
    t = doc.add_table(rows=1 + len(rows), cols=len(headers))
    t.alignment = WD_TABLE_ALIGNMENT.CENTER
    t.autofit = False
    tblPr = t._tbl.tblPr
    look = tblPr.find(qn("w:tblLook"))
    mar = _el("w:tblCellMar")
    for side, v in (("top", 0), ("left", 70), ("bottom", 0), ("right", 70)):
        mar.append(_el("w:" + side, w=v, type="dxa"))
    tbl_borders = _borders("w:tblBorders", ("top", "left", "bottom", "right", "insideH", "insideV"))
    for el in (tbl_borders, _el("w:tblLayout", type="fixed"), mar):
        if look is not None:
            look.addprevious(el)
        else:
            tblPr.append(el)
    for r, values in enumerate([headers] + rows):
        for c, value in enumerate(values):
            cell = t.cell(r, c)
            cell.width = Cm(widths[c])
            cell.vertical_alignment = WD_CELL_VERTICAL_ALIGNMENT.CENTER
            v_align = cell._tc.tcPr.find(qn("w:vAlign"))
            v_align.addprevious(_borders("w:tcBorders"))
            fill = header_fill if r == 0 else first_col_fill if c == 0 else None
            if fill:
                v_align.addprevious(_el("w:shd", val="clear", color="auto", fill=fill))
            p = spaced(cell.paragraphs[0])
            if r == 0:
                p.alignment = WD_ALIGN_PARAGRAPH.CENTER
                set_font(p.add_run(value), bold=True)
            elif c == 0:
                set_font(p.add_run(value), bold=True, color=first_col_color)
            else:
                rich(p, value)
    for row in t.rows:
        row._tr.get_or_add_trPr().append(_el("w:cantSplit"))
    t.rows[0]._tr.get_or_add_trPr().append(_el("w:tblHeader", val="true"))
    return t


# ---------------- footer: page number ----------------
fp = sec.footer.paragraphs[0]
fp.alignment = WD_ALIGN_PARAGRAPH.CENTER
for kind, text in (("begin", None), (None, "PAGE"), ("end", None)):
    run = fp.add_run()
    set_font(run)
    if kind:
        fc = OxmlElement("w:fldChar")
        fc.set(qn("w:fldCharType"), kind)
        run._r.append(fc)
    else:
        it = OxmlElement("w:instrText")
        it.set(qn("xml:space"), "preserve")
        it.text = text
        run._r.append(it)

# ================= 標頭（必須之部分） =================
para("附件1-1：系統概述文件", align=WD_ALIGN_PARAGRAPH.LEFT).runs[0].bold = True
para("編號：（由主辦單位填寫）", align=WD_ALIGN_PARAGRAPH.LEFT)
para("中文專題名稱：VivaPrep 大學申請面試模擬系統", align=WD_ALIGN_PARAGRAPH.LEFT)
para("英文專題名稱：VivaPrep — AI Mock Interview System for University Admissions", align=WD_ALIGN_PARAGRAPH.LEFT)

# ================= 一、前言 =================
heading("一、前言")
para("根據大學甄選入學委員會統計，115 學年度大學個人申請共 78,280 人報名、招生名額 50,450 名，多數校系第二階段以書面審查搭配面試，"
     "面試題目又常從學生自己寫下的備審內容出發、被連續追問。考生能取得的準備資源多半只有零散的學長姐心得與同學互練；通用 AI 聊天雖能出題，"
     "卻可能編造校系流程、沒有時間管理，也可能把單一心得說成固定考題；練完也常只剩「表達可以更有條理」這類無法連回答案內容、也接不到下一次練習的籠統回饋。")
para("VivaPrep 是一套面向大學個人申請的模擬面試與復盤系統：學生上傳自己的學習歷程 PDF，由 Gemini 整理成附頁碼與原文摘錄的「經歷主張」；"
     "學生確認後，三位分工不同的 AI 考官依當年度校系官方指引與這些主張，進行有時間限制、會承接回答連續追問的語音或文字面試；結束後復盤 Agent "
     "逐題引用學生原話指出優點與待改善處，並產生下一輪練習題。在以團隊成員申請資工系時的真實學習歷程實測中，系統承接學生「用虛擬環境解決套件版本"
     "不相容」的回答後，接連追問驗證方法、個人貢獻與技術取捨，形成完整的連續追問鏈（詳見「四、系統特色」）。")
para("**定位聲明**：VivaPrep 是練習用的模擬工具，不預測錄取結果、不保證題目命中真實面試、不代表任何校系的官方規則，也不以真實教授姓名或人格"
     "作仿冒。現階段為競賽原型，核心追問與復盤機制已以團隊成員真實備審實測，尚未經大規模學生或升學輔導老師驗證，成效以「原型展示」而非「已驗證"
     "成效」呈現。")

# ================= 二、創意描述 =================
heading("二、創意描述")
para("**現況問題**：通用聊天 AI 能生成面試題，但沒有校系依據、沒有時間管理，也不會針對備審主張做連續追問，練完的回饋也連不回答案本身，形成"
     "「有工具、沒有練習閉環」的問題。")
para("**與既有工具的差異**：台灣升學面試練習已有 MIND Education、Pallas Interview 等產品，也都能讀學習歷程並產生個人化題目；本作品不以取代"
     "它們為目標。本團隊於 2026 年 9 月比較公開頁面後，判斷可以做得更清楚的是「每個情境的來源與信心層級」與「每題追問回連到哪一則已確認主張」，"
     "並把這條追溯路徑做成 demo 可展示的介面，而非只在企劃書列出欄位。")
para("**創新構想**：把單次出題改成「校系來源 → 學生確認主張 → 連續追問 → 逐題復盤 → 再練習」的閉環，創新放在**可追溯、可追問、可重練**三件事上，"
     "與通用 AI 聊天的差異整理如表1。")
caption("表1　通用 AI 聊天與 VivaPrep 的做法比較", keep_with_next=True)
table(
    ["面向", "通用 AI 聊天", "VivaPrep 的做法"],
    [
        ["校系依據", "憑模型印象回答，可能編造流程與固定考題",
         "每個情境標註學年度、招生組別、來源類型與信心；資料不足時明示為模擬設定"],
        ["追問依據", "依對話即興發問，說不出為何問這題",
         "每題綁定學生確認過的主張與頁碼，復盤時可回查「這題為什麼被問」"],
        ["面試節奏", "不限時、可無限聊",
         "只計入有效練習時間（等待模型不計時）；最後階段只留一題，時間到先保存回答再收尾"],
        ["沉默處理", "等待使用者輸入",
         "模仿教授接話：先降低難度換個問法，仍無回應就換話題，不把沉默直接判為失敗"],
        ["回饋", "籠統評語或單一分數",
         "逐題引用原話，區分內容與表達，產生可立即重練的題目"],
    ],
    [2.5, 4.7, 8.8],
    header_fill="F4E3DC", first_col_fill="FBF3EF", first_col_color=ACCENT,
)
para("**預期效益**：讓學生練習的不是背誦考古題，而是把自己備審裡寫下的經驗說清楚、並且經得起教授追問；對城鄉與資源落差較大的學校，也能提供接近"
     "真實的免費練習管道。")

# ================= 三、系統功能簡介 =================
heading("三、系統功能簡介")
para("系統以校系選擇為起點，依序走完五個步驟（圖1、圖2）：學生先選學年度、校系與招生組別，資料卡顯示官方來源與最後核對日；接著拖放最多五份學習歷程 "
     "PDF，由 Gemini 理解內容並輸出附頁碼、原文摘錄的候選主張，經學生逐條確認或修改；設定考官陣容與練習時間後進入面試室，三位教授角色依主張與"
     "校系來源輪流提問，可語音或文字回答；結束後復盤 Agent 逐題引用原話指出優點與待改善處；學生可直接進入針對弱點的再練習，同校系重練時會避開"
     "上一場的開場角度。")
figure("interview-room.jpg", 8.6, "圖1　實際畫面：三位考官面試室，停頓時考官換個方式追問")
figure("architecture.png", 16.0, "圖2　VivaPrep 系統架構與 Google 技術分工（藍框為 Google 技術）")
para("三位教授為功能角色分工：「備審考官」確認作品細節與個人貢獻，「學科考官」追問學生主動提到的程式、演算法與數理概念，「動機考官」詢問選系"
     "理由與反思；三者依同一介面獨立分析，由程式化的面試協調器決定發言權、排除語意重複的問題並管理時間，不仿冒任何真實教授。")

# ================= 四、系統特色 =================
heading("四、系統特色")
para("- **主張級連續追問已實測**：以團隊成員真實學習歷程為測試備審（圖1），考官從「寫 AI 遊戲作業時最卡關的具體錯誤是什麼」開場；學生回答以虛擬"
     "環境解決套件版本不相容後，追問「用什麼方法驗證 AI 的決策邏輯是否正確」；學生停頓時考官先換個問法，仍無回應才改問資安專題的個人貢獻，再由"
     "學生的回答追問到模板注入的防護機制與效能取捨——每一題都承接上一題回答，而非跳題。")
para("- **12 支自動化檢查腳本**：涵蓋播放與收音競態、收尾計時、多 PDF 合併與失敗重試、過期模型輸出攔截與場次恢復，並以合成錄音實測完整語音"
     "流程；開發筆電（i5-7200U）上，開場題約 5～11 秒產生，後續追問等待約 2～4 秒。")
para("- **隱私與資料最小化**：Agent、語音、PDF、鏡頭與歷史保存分開逐項同意；帳號資料與練習內容以 AES-256-GCM 加密，密碼以 scrypt 雜湊；未保存"
     "的場次一小時內清除，使用者可匯出或刪除自己的資料。")
para("- **誠實揭露能力邊界**：目前官方校系資料以資工類為主；鏡頭指標（頭部方向代理值、涵蓋率）尚未經人工標註校準，只作描述性參考，不列入任何"
     "分數，也不用於推斷自信或誠實。")

# ================= 五、系統開發工具與技術 =================
heading("五、系統開發工具與技術")
para("VivaPrep 的核心能力——理解學習歷程、主持連續追問、逐題復盤——由 Google Gemini 生態系承擔，這是本作品的技術核心，而非附加功能；各項技術"
     "負責的工作與選用理由如表2。")
caption("表2　Google 技術在 VivaPrep 的分工與設計理由", keep_with_next=True)
table(
    ["Google 技術", "負責的工作", "選用理由與設計"],
    [
        ["Gemini API（Interactions API）",
         "考官 Agent 產生開場題、承接追問、停頓改問與換題；復盤 Agent 分段分析整場逐字稿後統整。",
         "以 JSON schema 結構化輸出，後端驗證發言者、提問重點與來源引用；不合格即拒收，模型幻覺不會直接進入面試。"],
        ["Gemini 原生 PDF 理解",
         "學習歷程以 inline 文件送入，輸出每份最多八則附頁碼、摘錄與信心標記的主張。",
         "備審多為圖文混排，原生理解可省去 OCR 與文字模型之間的交接；請求設定不保存互動內容，原檔不寫入資料庫。"],
        ["Gemini Transcribe、Gemini 3.8 Flash TTS",
         "學生口語回答轉為文字；考官提問以語音朗讀，播放完才開始收音與計時。",
         "與考官 Agent 同在 Gemini 生態系，形成「語音→推理→語音」回合；辨識完成即要求刪除暫存檔。"],
        ["MediaPipe Tasks Vision（Google AI Edge）",
         "在瀏覽器 Web Worker 計算臉部與肩部入鏡率、頭部方向代理值與上半身位移。",
         "本機推論、原始影格不上傳；只有學生另行同意時，逐題摘要才交給 Gemini 復盤參考。"],
        ["Antigravity CLI（Gemini 3.8 Flash）",
         "開發與離線展示環境的 Gemini 接入，與 API 模式共用同一 Provider 介面。",
         "開發期可快速迭代提示與 schema；兩種模式共用相同驗證，不會在失敗時靜默改用假資料。"],
    ],
    [3.9, 5.6, 6.5],
    header_fill="E3ECFB", first_col_fill="F1F5FD", first_col_color=GBLUE,
)
para("**現況（已測試驗證）**：開發與展示環境使用已登入的 Antigravity CLI 呼叫 Gemini 3.8 Flash 完成備審解析、考官追問與復盤，語音以本機語音"
     "服務辨識與合成。**API 化規劃**：正式決賽版將切換為直接呼叫 Gemini API 與 Gemini 語音模型，與目前的 CLI provider 共用同一介面，不需更動"
     "面試流程；同時導入 Gemini Live API 提供可打斷的即時語音面試，以 Google Drive Picker 讓學生選取雲端硬碟中的學習歷程，並以 Cloud Run 搭配 "
     "Firestore 部署，支援跨裝置保存練習歷程。")
para("**前端與後端**：前端為原生 JavaScript（面試室場景、教授動作切換），後端為 Node.js（REST API 與 SSE 事件串流），以 SQLite 暫存資料。")

# ================= 六、系統使用對象 =================
heading("六、系統使用對象")
para("- **主要使用者**：準備大學個人申請第二階段面試的高三學生，首波以資訊工程、資訊電機相關校系試點。")
para("- **次要使用者**：高中升學輔導老師與導師，可用系統減輕一對一模擬面試的人力負擔，把有限時間留給關鍵輔導。")
para("- **明確排除的使用對象**：本作品不作為校系招生篩選工具，也不對外提供個人練習資料給學校或雇主。")
para("**使用情境（設計）**：學生選定校系與招生組別後匯入備審，確認主張並設定考官陣容與時間，完成一場語音或文字模擬面試；復盤頁顯示逐題原話、"
     "優點與下一步練習，學生可直接開始針對弱點的重練。")

# ================= 七、系統使用環境 =================
heading("七、系統使用環境")
para("- **使用者端**：桌機或筆電的瀏覽器即可使用；語音與鏡頭功能需麥克風與攝影機，逐項同意後才啟用。")
para("- **校系語料現況**：目前依一所大學資訊工程學系的 115 學年度官方面試指引，建檔一般申請與 APCS 兩個招生組別，其餘校系可建立標示為「一般模擬」的情境，不"
     "冒充官方規則。")
para("- **介面現況**：網頁介面已與後端串接，可完整執行「選校系→匯入備審→模擬面試→復盤→再練習」的端到端流程，非錄製重播。")
para("- **部署形態**：現階段為本機單一服務原型（Node.js 搭配 SQLite），尚未接上正式資料庫或多實例部署；雲端部署規劃見第五節。")

# ================= 八、結語 =================
heading("八、結語")
para("VivaPrep 已提供具體可驗證的成果：以團隊成員真實學習歷程實測出完整的主張級連續追問鏈，並以 12 支自動化檢查腳本驗證播放、收音、逐題復盤"
     "等端到端流程。這些是核心機制可行性的證據，而非對整體教學成效的宣稱。")
para("**擴充性路線圖**：")
para("- 初賽後：邀請 5～8 位準備申請或剛完成申請的學生與 1～2 位升學輔導老師試用，比較通用 AI 聊天與 VivaPrep 在追問切題度、回饋可執行性上的"
     "差異。")
para("- 決賽前：導入 Gemini Live 即時語音、Google Drive 匯入與 Cloud Run 部署，現場展示完整練習閉環。")
para("- 後續：擴充到更多校系情境，並建立學生自願回報真實面試心得、經審核後回流題型資料庫的機制。")

doc.save(OUT)
print("saved", OUT)
