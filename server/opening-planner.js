import { randomInt } from "node:crypto";

// Choose a conversational angle before generation. Animation seeds do not control questions.
const introduction = { id: "introduction", role: "portfolio", instruction: "自然邀請學生用約一分鐘簡單自我介紹，讓他自行挑重點；只問自介，不再附加專題分工或動機任務。" };
const angles = [
  introduction,
  { id: "learning_trigger", role: "portfolio", instruction: "從指定經驗的起點切入：學生當初為什麼想做或學這件事。不要改問個人分工。" },
  { id: "challenge", role: "technical", instruction: "從指定經驗最先遇到的困難切入，邀請學生選一個具體障礙。不要改問個人分工。" },
  { id: "verification", role: "technical", instruction: "從指定經驗如何判斷成果有效切入，只問一種驗證方式。不要改問個人分工。" },
  { id: "reflection", role: "motivation", instruction: "從指定經驗帶來的一個想法或改變切入。不要改問個人分工。" },
  { id: "personal_contribution", role: "portfolio", instruction: "從指定經驗中學生親手完成的一項工作切入。" },
  { id: "learning_next", role: "motivation", instruction: "從指定經驗接下來想深入學習的一個問題切入。不要改問個人分工。" },
];
const withoutClaims = [
  introduction,
  { id: "study_interest", role: "motivation", instruction: "問學生對這個學系哪個學習方向最有興趣，請他選一個即可。" },
  { id: "learning_experience", role: "portfolio", instruction: "邀請學生選一段最想談的學習經驗作為起點，不預設他做過任何專題。" },
  { id: "curiosity", role: "technical", instruction: "問學生最近對哪個與學系相關的問題感到好奇，不預設他懂特定技術。" },
];

export class OpeningPlanner {
  constructor(pick = randomInt) { this.pick = pick; this.recent = new Map(); }
  choose({ ownerKey, profileId, claims, eligibleRoles }) {
    const key = `${ownerKey || "anonymous"}:${profileId}`;
    const previous = this.recent.get(key);
    const pool = claims.length ? angles : withoutClaims;
    const available = pool.filter((angle) => angle.id !== previous?.id || Date.now() - previous.at > 1800000);
    const angle = available[this.pick(available.length)];
    const roleId = eligibleRoles.includes(angle.role) ? angle.role : eligibleRoles[this.pick(eligibleRoles.length)];
    const claimIndex = claims.length && angle.id !== "introduction" ? this.pick(claims.length) : null;
    this.recent.delete(key);
    this.recent.set(key, { id: angle.id, at: Date.now() });
    if (this.recent.size > 1000) this.recent.delete(this.recent.keys().next().value);
    return { id: angle.id, roleId, instruction: angle.instruction, claimIndex, claim: claimIndex === null ? null : claims[claimIndex] };
  }
}
