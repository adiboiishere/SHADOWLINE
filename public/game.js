import * as THREE from "three";

const socket = io();
const menu=document.querySelector("#menu"), game=document.querySelector("#game");
const nameInput=document.querySelector("#name"), roomInput=document.querySelector("#room");
const errorEl=document.querySelector("#error"), canvas=document.querySelector("#view");
const hpEl=document.querySelector("#hp"), hpText=document.querySelector("#hpText");
const scoreboard=document.querySelector("#scoreboard"), message=document.querySelector("#message");
const connection=document.querySelector("#connection"), roomLabel=document.querySelector("#roomLabel");
const mobile=document.querySelector("#mobileControls");

let me=null, world={players:[],roomCode:"",winner:null};
let scene,camera,renderer,clock,remoteMeshes=new Map(), gun;
let yaw=0,pitch=0, keys={}, lastSend=0, lastShot=0, locked=false;
let stick={x:0,y:0}, dragging=false;

function name(){return nameInput.value.trim()||"Operator"}
function err(t){errorEl.textContent=t||""}
function enter(res){
  if(!res.ok) return err(res.error);
  me=res.id; roomLabel.textContent=res.roomCode; menu.classList.add("hidden"); game.classList.remove("hidden");
  init3D(); if(matchMedia("(pointer:fine)").matches) canvas.requestPointerLock?.();
}
document.querySelector("#create").onclick=()=>socket.emit("createRoom",{name:name()},enter);
document.querySelector("#join").onclick=()=>{
  const c=roomInput.value.trim().toUpperCase();
  if(c.length!==5)return err("Enter the 5-character room code.");
  socket.emit("joinRoom",{roomCode:c,name:name()},enter);
};
roomInput.addEventListener("input",()=>roomInput.value=roomInput.value.toUpperCase());

function init3D(){
  document.body.style.touchAction="none";
  canvas.style.touchAction="none";
  document.querySelector(".hud").style.touchAction="none";
  scene=new THREE.Scene();
  scene.background=new THREE.Color(0x080b10);
  scene.fog=new THREE.Fog(0x080b10,25,95);
  camera=new THREE.PerspectiveCamera(75,innerWidth/innerHeight,.05,120);
  camera.position.set(0,1.6,0);
  renderer=new THREE.WebGLRenderer({canvas,antialias:true});
  renderer.setPixelRatio(Math.min(devicePixelRatio,2)); renderer.setSize(innerWidth,innerHeight);
  renderer.shadowMap.enabled=true;
  clock=new THREE.Clock();

  scene.add(new THREE.HemisphereLight(0xb9d3ff,0x20240f,1.5));
  const sun=new THREE.DirectionalLight(0xffffff,2.1); sun.position.set(15,35,10); sun.castShadow=true; scene.add(sun);

  const ground=new THREE.Mesh(new THREE.PlaneGeometry(56,44),new THREE.MeshStandardMaterial({color:0x252b2b,roughness:.92}));
  ground.rotation.x=-Math.PI/2; ground.receiveShadow=true; scene.add(ground);

  const grid=new THREE.GridHelper(56,28,0x455052,0x303738); grid.position.y=.01; scene.add(grid);

  const wallMat=new THREE.MeshStandardMaterial({color:0x161c20});
  [[0,3,-22,56,6,1],[0,3,22,56,6,1],[-28,3,0,1,6,44],[28,3,0,1,6,44]].forEach(a=>{
    const m=new THREE.Mesh(new THREE.BoxGeometry(a[3],a[4],a[5]),wallMat);m.position.set(a[0],a[1],a[2]);m.castShadow=true;m.receiveShadow=true;scene.add(m);
  });
  // Cover blocks
  [[-10,1.5,-7,5,3,3],[9,1.5,-4,7,3,3],[-5,1.5,7,4,3,4],[13,1.5,10,5,3,3],[0,2,0,3,4,3]].forEach(a=>{
    const m=new THREE.Mesh(new THREE.BoxGeometry(a[3],a[4],a[5]),new THREE.MeshStandardMaterial({color:0x31383a}));m.position.set(a[0],a[1],a[2]);m.castShadow=true;m.receiveShadow=true;scene.add(m);
  });

  gun=new THREE.Group();
  const body=new THREE.Mesh(new THREE.BoxGeometry(.22,.18,.8),new THREE.MeshStandardMaterial({color:0x17191b,metalness:.7,roughness:.35}));
  body.position.set(.34,-.27,-.65); gun.add(body);
  const barrel=new THREE.Mesh(new THREE.CylinderGeometry(.035,.045,.9,12),new THREE.MeshStandardMaterial({color:0x070809,metalness:.9}));
  barrel.rotation.x=Math.PI/2; barrel.position.set(.34,-.25,-1.1); gun.add(barrel);
  const scope=new THREE.Mesh(new THREE.CylinderGeometry(.055,.055,.28,16),new THREE.MeshStandardMaterial({color:0x24292b,metalness:.8}));
  scope.rotation.x=Math.PI/2;scope.position.set(.34,-.12,-.7);gun.add(scope);
  camera.add(gun); scene.add(camera);

  addEventListener("resize",resize);
  addEventListener("keydown",e=>keys[e.code]=true);
  addEventListener("keyup",e=>keys[e.code]=false);
  document.addEventListener("pointerlockchange",()=>locked=document.pointerLockElement===canvas);
  document.addEventListener("mousemove",e=>{if(locked){yaw-=e.movementX*.0022;pitch-=e.movementY*.0022;pitch=Math.max(-1.35,Math.min(1.35,pitch))}});
  canvas.addEventListener("click",()=>{if(matchMedia("(pointer:fine)").matches)canvas.requestPointerLock?.(); shoot()});
  setupMobile();
  animate();
}

function resize(){if(!renderer)return;camera.aspect=innerWidth/innerHeight;camera.updateProjectionMatrix();renderer.setSize(innerWidth,innerHeight)}
function shoot(){
  const now=performance.now(); if(now-lastShot<550)return;
  const p=world.players.find(p=>p.id===me); if(!p||!p.alive)return;
  lastShot=now; socket.emit("shoot",{yaw,pitch});
  gun.rotation.z=-.06; setTimeout(()=>gun.rotation.z=0,80);
}
function setupMobile() {
  const stickEl = document.querySelector("#stick");
  const knob = document.querySelector("#knob");
  const fire = document.querySelector("#fire");
  const hud = document.querySelector(".hud");

  // =========================
  // MOVEMENT JOYSTICK
  // =========================
  let stickPointer = null;

  function resetStick() {
    stick.x = 0;
    stick.y = 0;
    knob.style.transform = "translate(0px, 0px)";
  }

  function updateStick(e) {
    const rect = stickEl.getBoundingClientRect();

    let dx = e.clientX - (rect.left + rect.width / 2);
    let dy = e.clientY - (rect.top + rect.height / 2);

    const max = 42;
    const distance = Math.hypot(dx, dy);

    if (distance > max) {
      dx = (dx / distance) * max;
      dy = (dy / distance) * max;
    }

    stick.x = dx / max;
    stick.y = dy / max;

    knob.style.transform = `translate(${dx}px, ${dy}px)`;
  }

  stickEl.addEventListener("pointerdown", (e) => {
    e.preventDefault();

    stickPointer = e.pointerId;
    stickEl.setPointerCapture(e.pointerId);

    updateStick(e);
  });

  stickEl.addEventListener("pointermove", (e) => {
    if (e.pointerId !== stickPointer) return;

    e.preventDefault();
    updateStick(e);
  });

  stickEl.addEventListener("pointerup", (e) => {
    if (e.pointerId !== stickPointer) return;

    stickPointer = null;
    resetStick();
  });

  stickEl.addEventListener("pointercancel", () => {
    stickPointer = null;
    resetStick();
  });

  // =========================
  // MOBILE AIM / CURSOR
  // =========================
  let aimPointer = null;
  let lastX = 0;
  let lastY = 0;

  hud.addEventListener(
    "pointerdown",
    (e) => {
      // Don't start aiming when touching controls
      if (
        e.target.closest("#stick") ||
        e.target.closest("#fire")
      ) {
        return;
      }

      // Desktop mouse uses Pointer Lock instead
      if (e.pointerType === "mouse") return;

      e.preventDefault();

      aimPointer = e.pointerId;
      lastX = e.clientX;
      lastY = e.clientY;

      hud.setPointerCapture?.(e.pointerId);
    },
    { passive: false }
  );

  hud.addEventListener(
    "pointermove",
    (e) => {
      if (e.pointerId !== aimPointer) return;

      e.preventDefault();

      const dx = e.clientX - lastX;
      const dy = e.clientY - lastY;

      lastX = e.clientX;
      lastY = e.clientY;

      // Horizontal camera rotation
      yaw -= dx * 0.006;

      // Vertical camera rotation
      pitch -= dy * 0.006;

      pitch = Math.max(
        -1.35,
        Math.min(1.35, pitch)
      );
    },
    { passive: false }
  );

  function stopAim(e) {
    if (e.pointerId === aimPointer) {
      aimPointer = null;
    }
  }

  hud.addEventListener("pointerup", stopAim);
  hud.addEventListener("pointercancel", stopAim);

  // =========================
  // FIRE BUTTON
  // =========================
  let fireTimer = null;

  function startFire(e) {
    e.preventDefault();

    shoot();

    clearInterval(fireTimer);

    fireTimer = setInterval(() => {
      shoot();
    }, 120);
  }

  function stopFire(e) {
    if (e) e.preventDefault();

    clearInterval(fireTimer);
    fireTimer = null;
  }

  fire.addEventListener("pointerdown", startFire);
  fire.addEventListener("pointerup", stopFire);
  fire.addEventListener("pointercancel", stopFire);
  fire.addEventListener("pointerleave", stopFire);
}

function animate(){
  requestAnimationFrame(animate); if(!renderer)return;
  const dt=Math.min(clock.getDelta(),.05);
  const speed=7;
  let f=(keys.KeyW?1:0)-(keys.KeyS?1:0)-stick.y;
  let s=(keys.KeyD?1:0)-(keys.KeyA?1:0)+stick.x;
  if(Math.abs(f)+Math.abs(s)>0){
    const len=Math.hypot(f,s);f/=len;s/=len;
    camera.position.x+=(-Math.sin(yaw)*f+Math.cos(yaw)*s)*speed*dt;
    camera.position.z+=(-Math.cos(yaw)*f-Math.sin(yaw)*s)*speed*dt;
    camera.position.x=Math.max(-26.5,Math.min(26.5,camera.position.x));
    camera.position.z=Math.max(-20.5,Math.min(20.5,camera.position.z));
  }
  camera.position.y=1.6;
  camera.rotation.order="YXZ";camera.rotation.y=yaw;camera.rotation.x=pitch;

  const now=performance.now();
  if(now-lastSend>80){
    socket.emit("state",{x:camera.position.x,y:1.6,z:camera.position.z,yaw,pitch});
    lastSend=now;
  }
  renderPlayers();
  renderer.render(scene,camera);
}

function renderPlayers(){
  for(const p of world.players){
    if(p.id===me)continue;
    let mesh=remoteMeshes.get(p.id);
    if(!mesh){
      mesh=new THREE.Group();
      const mat=new THREE.MeshStandardMaterial({color:0x9fb3bd,roughness:.8});
      const body=new THREE.Mesh(new THREE.CapsuleGeometry(.38,.8,5,10),mat);body.position.y=.95;body.castShadow=true;
      const head=new THREE.Mesh(new THREE.SphereGeometry(.26,12,10),new THREE.MeshStandardMaterial({color:0xc6a58c}));head.position.y=1.65;head.castShadow=true;
      mesh.add(body,head);scene.add(mesh);remoteMeshes.set(p.id,mesh);
    }
    mesh.visible=p.alive;
    mesh.position.set(p.x,p.y-1.6,p.z);
    mesh.rotation.y=p.yaw;
  }
}

socket.on("world",s=>{
  world=s;
  const meP=s.players.find(p=>p.id===me);
  if(meP){
    hpEl.style.width=meP.hp+"%";hpText.textContent=meP.hp;
    if(!meP.alive)message.textContent="RESPAWNING…";
    else if(!s.winner)message.textContent="";
  }
  scoreboard.innerHTML=s.players.map(p=>`<div class="score ${p.id===me?"me":""}"><span>${escapeHtml(p.name)}</span><b>${p.score}</b></div>`).join("");
  if(s.winner){
    const w=s.players.find(p=>p.id===s.winner);message.textContent=(s.winner===me?"MISSION COMPLETE":"MATCH LOST")+" — "+(w?.name||"winner");
  }
});
socket.on("hitConfirm",d=>showFeed(d.head?"HEADSHOT  +100":"HIT  +"+d.damage));
socket.on("elimination",d=>{
  const k=world.players.find(p=>p.id===d.killer),v=world.players.find(p=>p.id===d.victim);
  showFeed(`${k?.name||"Operator"}  >  ${v?.name||"Target"}${d.head?"  HEADSHOT":""}`);
});
socket.on("matchOver",d=>{const p=world.players.find(x=>x.id===d.winner);message.textContent=(d.winner===me?"YOU WIN":"YOU LOSE")+" — "+(p?.name||"operator")});
socket.on("connect",()=>connection.textContent="● ONLINE");
socket.on("disconnect",()=>connection.textContent="● RECONNECTING");

function showFeed(t){
  const el=document.createElement("div");el.className="kill";el.textContent=t;
  document.querySelector("#killfeed").appendChild(el);setTimeout(()=>el.remove(),2200);
}
function escapeHtml(s){return String(s).replace(/[&<>"']/g,m=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"}[m]))}
