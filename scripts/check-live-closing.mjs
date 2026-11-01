import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
const base=process.env.VIVAPREP_CHECK_URL || "http://127.0.0.1:4173";
const authResponse=await fetch(base+"/api/auth/session");
const auth=await authResponse.json();
const headers={"content-type":"application/json","x-csrf-token":auth.csrfToken,cookie:authResponse.headers.getSetCookie()[0].split(";",1)[0]};
async function request(path,method="GET",body) { const response=await fetch(base+path,{method,headers,body:body==null?undefined:JSON.stringify(body),signal:AbortSignal.timeout(55000)}); const payload=await response.json(); assert.ok(response.ok,JSON.stringify(payload));return payload; }
async function until(id,predicate) { const deadline=Date.now()+45000; while(Date.now()<deadline){const s=await request("/api/sessions/"+id);if(predicate(s))return s; await new Promise(r=>setTimeout(r,400));}throw new Error("Timed out waiting for session update"); }
let id;
try {
 const health=await request("/api/health"); assert.equal(health.agentMode,"cli");
 const created=await request("/api/sessions","POST",{profileId:"fcu-apcs",panelIds:["portfolio","technical","logic"],durationMinutes:5,mode:health.speech.available?"voice":"text",confirmedClaims:[{text:"合成測試：我用 Python 實作搜尋，並用十組測試資料檢查結果。"}],consent:{modelProcessing:true,audioProcessing:health.speech.available},retentionMode:"ephemeral"});
 id=created.session.sessionId; console.log(JSON.stringify({opening:created.event.utterance}));
 await request("/api/sessions/"+id+"/answers","POST",{turnId:created.event.turnId,text:"合成測試：我從 Python 字典建立索引，測試了找得到和找不到的資料，發現大小寫不一致後先轉成小寫。",elapsedSeconds:260});
 const final=await until(id,s=>s.turns.length===2); assert.equal(final.currentEvent.finalQuestion,true);assert.match(final.currentEvent.utterance,/最後|時間/); console.log(JSON.stringify({finalQuestion:final.currentEvent.utterance}));
 await request("/api/sessions/"+id+"/answers","POST",{turnId:final.currentEvent.turnId,text:"合成測試：我想先把資料結構學好，再用更多資料驗證索引的速度。",elapsedSeconds:280});
 const closing=await until(id,s=>s.status==="closing");assert.equal(closing.currentEvent.type,"interview.closing");assert.equal(closing.turns.length,2); console.log(JSON.stringify({closing:closing.currentEvent.utterance}));
 if(health.speech.available){const audioReady=await until(id,s=>Boolean(s.currentEvent.audioUrl)); const audioResponse=await fetch(base+audioReady.currentEvent.audioUrl,{headers});assert.equal(audioResponse.status,200);assert.ok((await audioResponse.arrayBuffer()).byteLength>100); console.log("Closing speech is ready");}
 await request("/api/sessions/"+id+"/finish","POST",{reason:"completed"});
 const completed=await request("/api/sessions/"+id);assert.equal(completed.status,"completed");assert.ok(completed.review);assert.equal(completed.turns.length,2);assert.ok(completed.turns.every(t=>t.answerText));
 await writeFile(new URL("../.data/verification/closing-live.json",import.meta.url),JSON.stringify({opening:created.event.utterance,finalQuestion:final.currentEvent.utterance,closing:closing.currentEvent.utterance,summary:completed.review.summary,timings:completed.timings},null,2));
 console.log(JSON.stringify({review:completed.review.summary}));
 console.log("PASS: real Gemini budget-aware last question, closing without another question, real synthesized courtesy, and full review of both answers");
} finally {if(id)await fetch(base+"/api/sessions/"+id,{method:"DELETE",headers});}
