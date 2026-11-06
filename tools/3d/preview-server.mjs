// Standalone local character QA; does not start interview agents or a database.
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve, sep, extname } from 'node:path';
const root=fileURLToPath(new URL('../../',import.meta.url));
const mime={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.glb':'model/gltf-binary','.png':'image/png','.jpg':'image/jpeg','.json':'application/json'};
createServer(async(req,res)=>{
  try {
    let path=decodeURIComponent(new URL(req.url,'http://localhost').pathname);
    if(path==='/')path='/avatar-review.html';
    if(path.startsWith('/assets/'))path='/public'+path;
    else if(path.startsWith('/vendor/addons/'))path=path.replace('/vendor/addons/','/node_modules/three/examples/jsm/');
    else if(path.startsWith('/vendor/'))path=path.replace('/vendor/','/node_modules/three/build/');
    const file=resolve(root,'.'+path);
    if(!file.startsWith(resolve(root)+sep)||!['GET','HEAD'].includes(req.method)){res.writeHead(403).end();return;}
    const data=await readFile(file);
    res.writeHead(200,{'Content-Type':mime[extname(file)]||'application/octet-stream','Content-Length':data.length,'Cache-Control':'no-store'});
    res.end(req.method==='HEAD'?undefined:data);
  }catch{res.writeHead(404).end('Not found');}
}).listen(4176,'127.0.0.1',()=>console.log('Character QA: http://127.0.0.1:4176/avatar-review.html'));
