import { InterviewScene, AVATAR_CLIPS } from "/src/interview-scene.js";

const room = new InterviewScene();
const query = new URLSearchParams(location.search);
let state = Object.hasOwn(AVATAR_CLIPS, query.get("state")) ? query.get("state") : "idle";
let view = ["front", "side", "back"].includes(query.get("view")) ? query.get("view") : "front";
const character = document.querySelector("#character");
if (["technical", "portfolio", "logic", "all"].includes(query.get("character"))) character.value = query.get("character");
document.querySelectorAll("[data-state]").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.state === state)));
const roster = () => (character.value === "all" ? ["technical", "portfolio", "logic"] : [character.value]).map((id) => ({ id }));
function update() {
  const people = roster();
  room.updateActors(people, people[0].id, state, Object.fromEntries(people.map((person) => [person.id, state])));
  const all = people.length > 1;
  room.camera.fov = all ? 36 : 31;
  const targetY = all ? 1.75 : 1.35;
  if (view === "front") room.camera.position.set(0, targetY, all ? 11 : 5.9);
  else if (view === "side") room.camera.position.set(all ? 11 : 6, targetY, -0.7);
  else room.camera.position.set(0, targetY, all ? -11 : -6.9);
  room.camera.lookAt(0, targetY, -0.4);
  room.camera.updateProjectionMatrix();
  room.positionActors();
  room.scene.traverse((node) => {
    if (/table|interviewer-notes/.test(node.name)) node.visible = document.querySelector("#table").checked;
    if (/room-floor/.test(node.name)) node.visible = true;
  });
  // Hide unnamed room decorations for an unobstructed full-body inspection.
  for (const node of room.scene.children) {
    if (!node.isLight && node.type !== "Group" && node.name !== "room-floor" && !/table|interviewer-notes/.test(node.name)) node.visible = false;
  }
  room.renderer.render(room.scene, room.camera);
}
const resizeRoom = room.resize.bind(room);
room.resize = () => { resizeRoom(); update(); };
room.mount(document.querySelector("#viewport"), roster(), roster()[0].id, state);
update();
character.addEventListener("change", update);
document.querySelectorAll("[data-state]").forEach((button) => button.addEventListener("click", () => {
  state = button.dataset.state;
  document.querySelectorAll("[data-state]").forEach((b) => b.setAttribute("aria-pressed", String(b === button)));
  update();
}));
document.querySelectorAll("[data-view]").forEach((button) => button.addEventListener("click", () => { view = button.dataset.view; update(); }));
document.querySelector("#table").addEventListener("change", update);
document.querySelector("#pause").addEventListener("change", (event) => {
  for (const actor of room.characters.values()) if (actor.userData.mixer) actor.userData.mixer.timeScale = event.target.checked ? 0 : 1;
});
const loading = setInterval(() => {
  const statuses = [...room.avatarLoadStatus];
  document.querySelector("#status").textContent = statuses.map(([id, status]) => `${({ technical: "林教授", portfolio: "陳教授", logic: "周教授" })[id]}：${({ pending: "載入中", loaded: "已載入 6 個動作", failed: "載入失敗" })[status]}`).join("／");
  if (statuses.every(([, status]) => status !== "pending")) { clearInterval(loading); update(); }
}, 500);
