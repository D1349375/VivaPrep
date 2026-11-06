"""Validate delivered character data, embedded assets and animation endpoints."""
import json, struct
from pathlib import Path
import numpy as np

ROOT = Path(__file__).resolve().parents[2]
CLIPS = ['Idle', 'Listening', 'ReadingNotes', 'SpeakingGesture', 'FollowUp', 'Thinking']
DTYPES = {5120:'i1',5121:'u1',5122:'<i2',5123:'<u2',5125:'<u4',5126:'<f4'}
WIDTH = {'SCALAR':1,'VEC2':2,'VEC3':3,'VEC4':4,'MAT4':16}

def inspect(path):
    data = path.read_bytes()
    magic,version,length = struct.unpack_from('<4sII',data)
    assert magic == b'glTF' and version == 2 and length == len(data)
    size,kind = struct.unpack_from('<II',data,12)
    gltf = json.loads(data[20:20+size])
    start = 20+size
    binary = data[start+8:]
    def values(index):
        a = gltf['accessors'][index]; v = gltf['bufferViews'][a['bufferView']]
        dtype=np.dtype(DTYPES[a['componentType']]); width=WIDTH[a['type']]
        offset=v.get('byteOffset',0)+a.get('byteOffset',0)
        return np.ndarray((a['count'],width),dtype=dtype,buffer=binary,offset=offset,
            strides=(v.get('byteStride',width*dtype.itemsize),dtype.itemsize)).copy()
    assert all('uri' not in b for b in gltf['buffers']), 'External buffer'
    assert all('bufferView' in i and 'uri' not in i for i in gltf['images']), 'External texture'
    assert not any(n.get('name','').startswith('QA_') for n in gltf['nodes']), 'Furniture exported'
    assert sorted(a['name'] for a in gltf['animations']) == sorted(CLIPS)
    skin=gltf['skins'][0]
    assert len(skin['joints']) == 53
    bone_names=[gltf['nodes'][i].get('name','') for i in skin['joints']]
    assert all(n in bone_names for n in ['pelvis','head','hand_l','hand_r','index_01_l','index_01_r'])
    clips=[]
    for a in gltf['animations']:
        max_seam=0.; max_motion=0.; end=0.; max_step=0.; step_bone=''
        for c in a['channels']:
            s=a['samplers'][c['sampler']]; t=values(s['input']); v=values(s['output'])
            assert np.isfinite(v).all() and np.isfinite(t).all()
            assert np.all(np.diff(t[:,0])>0)
            end=max(end,float(t[-1,0]))
            if c['target']['path']=='rotation':
                assert np.max(abs(np.linalg.norm(v,axis=1)-1)) < .001
                seam=min(np.linalg.norm(v[-1]-v[0]),np.linalg.norm(v[-1]+v[0]))
                dots=np.clip(np.abs(v@v[0]),0,1)
                max_motion=max(max_motion,float(np.max(2*np.arccos(dots))))
                steps=2*np.arccos(np.clip(np.abs(np.sum(v[:-1]*v[1:],axis=1)),0,1))
                if float(steps.max())>max_step:
                    max_step=float(steps.max());step_bone=gltf['nodes'][c['target']['node']]['name']
            else:
                seam=np.linalg.norm(v[-1]-v[0])
            max_seam=max(max_seam,float(seam))
        assert max_seam < .002, (a['name'],max_seam)
        assert max_motion > .005, (a['name'],'No visible joint motion')
        assert max_step < np.deg2rad(15), (a['name'],step_bone,'Abrupt joint rotation',max_step)
        clips.append(dict(name=a['name'],seconds=round(end,3),maxLoopSeam=round(max_seam,7),maxJointMotionRadians=round(max_motion,4),maxAdjacentRotationDegrees=round(max_step*180/np.pi,3),fastestJoint=step_bone))
    return dict(file=path.name,bytes=len(data),bones=len(skin['joints']),
        embeddedImages=len(gltf['images']),meshes=len(gltf['meshes']),clips=clips)

if __name__=='__main__':
    results=[inspect(ROOT/'public/assets/avatars'/f'{role}.glb') for role in ['technical','portfolio','logic']]
    output=Path(__file__).parent/'preview/v2/glb-validation.json'
    output.write_text(json.dumps(results,indent=2),encoding='utf8')
    print(json.dumps(results,indent=2))
