// Interview anonymity guard: the student's own school must never reach a
// professor prompt or appear in a generated question. Over-redaction is
// preferred to a leak, so the patterns err on the side of masking.

export const schoolPlaceholder = "［學校名稱］";

// Characters that end a phrase before a school name ("我在建國中學") or show
// that the word before 高中/國中 is not a name ("參加高中", "三年高中").
const stopChars = "我你他她們在於是的了從讀念到和與及跟就也都還很才剛為以對向把被讓給加參考進去回當做整每個年段時前後期間所該本這那某各舊有般普";
const nameChar = `(?:(?![${stopChars}])\\p{Script=Han})`;
const regionPrefix = "(?:(?:國立|私立)?(?:[臺台]?\\p{Script=Han}{1,2}[市縣])(?:立|私立)?|國立|私立|市立|縣立)?";
const fullSuffix = "(?:高級中等學校|高級工業職業學校|高級商業職業學校|高級農工職業學校|高級家事商業職業學校|高級職業學校|附屬高級中學|實驗高級中學|女子高級中學|高級中學|完全中學|實驗中學|國民中學|國民小學)";
const shortSuffix = "(?:高中|中學|高工|高商|高農|高職|工商|家商|女中|女高|附中|國中|國小|[一二三四五六七八九十]中)";
const boundary = "(?<=^|[\\s\\p{P}\\p{S}在於是從讀念自到的和與及跟、])";
const chineseSchool = new RegExp(`${boundary}${regionPrefix}${nameChar}{2,4}${shortSuffix}|${regionPrefix}${nameChar}{2,6}${fullSuffix}`, "gu");
const abbreviations = /建中|北一女|中山女高|景美女中|雄中|雄女|竹中|竹女|嘉中|嘉女|彰中|彰女|南一中|南女中|中一中|中女中|師大附中|武陵高中/gu;
const englishSchool = /\b(?:[A-Z][\w.'-]*\s+){1,6}(?:Senior\s+|Junior\s+|Vocational\s+)?(?:High\s+School|Middle\s+School)\b/g;

export function redactSchoolMentions(value) {
  const text = String(value ?? "");
  let count = 0;
  const mark = () => { count += 1; return schoolPlaceholder; };
  const redacted = text.replace(chineseSchool, mark).replace(abbreviations, mark).replace(englishSchool, mark);
  return { text: redacted, count };
}

export function redactSchool(value) {
  return redactSchoolMentions(value).text;
}

const identityQuestions = [
  /(哪|什麼|哪一)\s*(間|所|個)?\s*(高中|學校|中學|國中|高職)/u,
  /(高中|學校|母校|中學)\s*(的)?\s*(名稱|名字|全名|簡稱)/u,
  /校名|母校/u,
  /(就讀|讀|念|唸)(的)?\s*(是)?\s*哪\s*(間|所|裡|一)/u,
  /在哪(裡|個地方|個縣市|個城市)?\s*(讀|念|唸|就讀|上學|上課)/u,
  /(哪裡|哪)\s*(畢業|人)|來自哪|住在哪|家住|老家|家裡.{0,4}(做什麼|職業)|父母.{0,4}(職業|工作)/u,
  /(你們|妳們|你的|妳的)\s*(學校|高中).{0,6}(特色|有名|名稱|位於|在哪|哪裡|叫什麼|是哪|校風|排名)/u,
  /(你|妳)\s*(的)?\s*(名字|全名)|(你|妳)\s*叫什麼/u,
];

// True when a generated question asks for, guesses or repeats identifying school details.
export function violatesAnonymity(question) {
  const text = String(question || "");
  if (!text) return false;
  if (text.includes(schoolPlaceholder) || text.includes("學校名稱")) return true;
  if (redactSchoolMentions(text).count > 0) return true;
  return identityQuestions.some((pattern) => pattern.test(text));
}
