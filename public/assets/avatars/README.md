# Archived 3D interviewer assets

The three portrait PNGs in `../interviewer-technical.png`, `../interviewer-portfolio.png`, and `../interviewer-logic.png` are still used in profile and roster UI. The current live room uses transparent interviewer pose sprite sheets and a 2D scene; these archived GLB specifications are not part of the live rendering path.

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

These clips describe the former 3D prototype direction. They are not loaded by the current live interview room.

The GLB files in this folder are exploratory prototypes from the earlier 3D direction. They are not loaded in the live room and have not been approved as production interviewer likenesses or animations. Keep them as review artifacts; the current 2D pose-sheet room is the supported rendering path.
