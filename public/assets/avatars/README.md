# Replaceable 3D interviewer assets

The three portrait PNGs in `../interviewer-technical.png`, `../interviewer-portfolio.png`, and `../interviewer-logic.png` are the visual references for the final interviewer models. They are still used in profile and roster UI; the live room prefers a rigged 3D model when one is present and otherwise keeps its procedural fallback.

## Model files

Add these files to this folder to replace the fallback characters:

- `technical.glb`
- `portfolio.glb`
- `logic.glb`

Use glTF binary (`.glb`) with an embedded texture set. Export one seated interviewer per file, facing the camera (+Z), with the hips aligned near the chair and hands able to reach the tabletop. The viewer scales the model to about 2.18 scene units high and centers its bounding box; keep the model's seated pose and proportions consistent across the three files so the panelists read as peers.

## Animation clips

Include separately named loopable clips where possible. Clip names are matched by intent, case-insensitively:

- `Idle` or `Breathing`
- `Listening` (a restrained nod or attentive posture)
- `ReadingNotes` or `WritingNotes`
- `Speaking` or `SpeakingGesture` (clear mouth and hand movement)
- `FollowUp` or `Point` (a slight forward lean and emphasis gesture)
- `Thinking` (brief gaze shift or reflective posture)

The live room cross-fades between matching clips when the mock interview changes state. If a matching rigged model is absent, fails to load, or has no matching clip, the independent procedural character remains available.

The current model files are intentionally not fabricated from the portrait PNGs. Those images do not contain the unseen sides, body geometry, rig, or animation data needed for a production 3D character; the rigged GLB assets need to be authored from the portraits as likeness references.
