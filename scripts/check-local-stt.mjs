import {readFile,writeFile} from "node:fs/promises";
import {SpeechAdapter} from "../server/speech-adapter.js";
import {config} from "../server/config.js";
import assert from "node:assert/strict";
const speech=new SpeechAdapter({...config,mode:"whisper-local",maxAudioBytes:config.maxAudioBytes,pythonPath:config.speechPythonPath,whisperModelPath:config.whisperModelPath});
const started=performance.now();await speech.initialize();console.log("warmupMs="+Math.round(performance.now()-started));
const results=[];
try {for(let i=0;i<2;i++) {const audio=await readFile(new URL(`../.data/performance/synthetic-${i}.webm`,import.meta.url));const started=performance.now();const transcript=await speech.transcribe(audio,"audio/webm",{claims:["使用 Python"]});const result={sample:i,durationMs:Math.round(performance.now()-started),transcript};results.push(result);console.log(JSON.stringify(result));}
const silence=Buffer.alloc(44+16000*2*2);silence.write("RIFF",0);silence.writeUInt32LE(silence.length-8,4);silence.write("WAVEfmt ",8);silence.writeUInt32LE(16,16);silence.writeUInt16LE(1,20);silence.writeUInt16LE(1,22);silence.writeUInt32LE(16000,24);silence.writeUInt32LE(32000,28);silence.writeUInt16LE(2,32);silence.writeUInt16LE(16,34);silence.write("data",36);silence.writeUInt32LE(silence.length-44,40);
await assert.rejects(speech.transcribe(silence,"audio/wav",{claims:["Python"]}),{code:"TRANSCRIPTION_FAILED"});console.log("PASS: silent audio produces no invented answer");}
catch(error) {console.log("localSTT failure="+speech.whisper.lastFailure);throw error;}
finally {speech.close();await writeFile(new URL("../.data/performance/whisper.json",import.meta.url),JSON.stringify(results,null,2));}
