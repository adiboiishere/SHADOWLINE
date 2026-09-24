import * as THREE from "three";

const socket = io();

const menu = document.querySelector("#menu");
const game = document.querySelector("#game");

const nameInput = document.querySelector("#name");
const roomInput = document.querySelector("#room");

const errorEl = document.querySelector("#error");
const canvas = document.querySelector("#view");

const hpEl = document.querySelector("#hp");
const hpText = document.querySelector("#hpText");

const scoreboard = document.querySelector("#scoreboard");
const message = document.querySelector("#message");

const connection = document.querySelector("#connection");
const roomLabel = document.querySelector("#roomLabel");

const mobile = document.querySelector("#mobileControls");

let me = null;

let world = {
  players: [],
  roomCode: "",
  winner: null
};

let scene;
let camera;
let renderer;
let clock;
let gun;

let remoteMeshes = new Map();

let yaw = 0;
let pitch = 0;

let keys = {};

let lastSend = 0;
let lastShot = 0;

let locked = false;

let stick = {
  x: 0,
  y: 0
};


// ============================================================
// BASIC UI
// ============================================================

function name() {
  return nameInput.value.trim() || "Operator";
}

function err(text) {
  errorEl.textContent = text || "";
}

function enter(res) {

  if (!res.ok) {
    return err(res.error);
  }

  me = res.id;

  roomLabel.textContent = res.roomCode;

  menu.classList.add("hidden");
  game.classList.remove("hidden");

  init3D();

  if (matchMedia("(pointer:fine)").matches) {
    canvas.requestPointerLock?.();
  }
}


// ============================================================
// CREATE ROOM
// ============================================================

document.querySelector("#create").onclick = () => {

  socket.emit(
    "createRoom",
    {
      name: name()
    },
    enter
  );
};


// ============================================================
// JOIN ROOM
// ============================================================

document.querySelector("#join").onclick = () => {

  const code =
    roomInput.value.trim().toUpperCase();

  if (code.length !== 5) {
    return err("Enter the 5-character room code.");
  }

  socket.emit(
    "joinRoom",
    {
      roomCode: code,
      name: name()
    },
    enter
  );
};


// ============================================================
// ROOM INPUT
// ============================================================

roomInput.addEventListener(
  "input",
  () => {
    roomInput.value =
      roomInput.value.toUpperCase();
  }
);


// ============================================================
// THREE.JS INITIALIZATION
// ============================================================

function init3D() {

  // IMPORTANT FOR MOBILE
  document.body.style.touchAction = "none";

  canvas.style.touchAction = "none";

  const hud =
    document.querySelector(".hud");

  hud.style.touchAction = "none";

  // The HUD itself must receive touch events.
  hud.style.pointerEvents = "auto";


  // HUD information should not steal
  // touch events from the aiming layer.

  document
    .querySelectorAll(
      ".top, .scoreboard, .bottom, .message, #killfeed, .crosshair"
    )
    .forEach(el => {

      el.style.pointerEvents = "none";

    });


  // ============================================================
  // SCENE
  // ============================================================

  scene = new THREE.Scene();

  scene.background =
    new THREE.Color(0x080b10);

  scene.fog =
    new THREE.Fog(
      0x080b10,
      25,
      95
    );


  // ============================================================
  // CAMERA
  // ============================================================

  camera =
    new THREE.PerspectiveCamera(
      75,
      innerWidth / innerHeight,
      0.05,
      120
    );

  camera.position.set(
    0,
    1.6,
    0
  );


  // ============================================================
  // RENDERER
  // ============================================================

  renderer =
    new THREE.WebGLRenderer({
      canvas,
      antialias: true
    });

  renderer.setPixelRatio(
    Math.min(
      devicePixelRatio,
      2
    )
  );

  renderer.setSize(
    innerWidth,
    innerHeight
  );

  renderer.shadowMap.enabled = true;

  clock = new THREE.Clock();


  // ============================================================
  // LIGHTING
  // ============================================================

  scene.add(
    new THREE.HemisphereLight(
      0xb9d3ff,
      0x20240f,
      1.5
    )
  );

  const sun =
    new THREE.DirectionalLight(
      0xffffff,
      2.1
    );

  sun.position.set(
    15,
    35,
    10
  );

  sun.castShadow = true;

  scene.add(sun);


  // ============================================================
  // GROUND
  // ============================================================

  const ground =
    new THREE.Mesh(
      new THREE.PlaneGeometry(
        56,
        44
      ),
      new THREE.MeshStandardMaterial({
        color: 0x252b2b,
        roughness: 0.92
      })
    );

  ground.rotation.x =
    -Math.PI / 2;

  ground.receiveShadow = true;

  scene.add(ground);


  // ============================================================
  // GRID
  // ============================================================

  const grid =
    new THREE.GridHelper(
      56,
      28,
      0x455052,
      0x303738
    );

  grid.position.y = 0.01;

  scene.add(grid);


  // ============================================================
  // ARENA WALLS
  // ============================================================

  const wallMat =
    new THREE.MeshStandardMaterial({
      color: 0x161c20
    });

  [
    [0, 3, -22, 56, 6, 1],
    [0, 3, 22, 56, 6, 1],
    [-28, 3, 0, 1, 6, 44],
    [28, 3, 0, 1, 6, 44]
  ].forEach(a => {

    const wall =
      new THREE.Mesh(
        new THREE.BoxGeometry(
          a[3],
          a[4],
          a[5]
        ),
        wallMat
      );

    wall.position.set(
      a[0],
      a[1],
      a[2]
    );

    wall.castShadow = true;
    wall.receiveShadow = true;

    scene.add(wall);

  });


  // ============================================================
  // COVER BLOCKS
  // ============================================================

  [
    [-10, 1.5, -7, 5, 3, 3],
    [9, 1.5, -4, 7, 3, 3],
    [-5, 1.5, 7, 4, 3, 4],
    [13, 1.5, 10, 5, 3, 3],
    [0, 2, 0, 3, 4, 3]
  ].forEach(a => {

    const cover =
      new THREE.Mesh(
        new THREE.BoxGeometry(
          a[3],
          a[4],
          a[5]
        ),
        new THREE.MeshStandardMaterial({
          color: 0x31383a
        })
      );

    cover.position.set(
      a[0],
      a[1],
      a[2]
    );

    cover.castShadow = true;
    cover.receiveShadow = true;

    scene.add(cover);

  });


  // ============================================================
  // WEAPON
  // ============================================================

  gun = new THREE.Group();


  // Weapon body

  const body =
    new THREE.Mesh(
      new THREE.BoxGeometry(
        0.22,
        0.18,
        0.8
      ),
      new THREE.MeshStandardMaterial({
        color: 0x17191b,
        metalness: 0.7,
        roughness: 0.35
      })
    );

  body.position.set(
    0.34,
    -0.27,
    -0.65
  );

  gun.add(body);


  // Barrel

  const barrel =
    new THREE.Mesh(
      new THREE.CylinderGeometry(
        0.035,
        0.045,
        0.9,
        12
      ),
      new THREE.MeshStandardMaterial({
        color: 0x070809,
        metalness: 0.9
      })
    );

  barrel.rotation.x =
    Math.PI / 2;

  barrel.position.set(
    0.34,
    -0.25,
    -1.1
  );

  gun.add(barrel);


  // Scope

  const scope =
    new THREE.Mesh(
      new THREE.CylinderGeometry(
        0.055,
        0.055,
        0.28,
        16
      ),
      new THREE.MeshStandardMaterial({
        color: 0x24292b,
        metalness: 0.8
      })
    );

  scope.rotation.x =
    Math.PI / 2;

  scope.position.set(
    0.34,
    -0.12,
    -0.7
  );

  gun.add(scope);


  camera.add(gun);

  scene.add(camera);


  // ============================================================
  // DESKTOP EVENTS
  // ============================================================

  addEventListener(
    "resize",
    resize
  );

  addEventListener(
    "keydown",
    e => {
      keys[e.code] = true;
    }
  );

  addEventListener(
    "keyup",
    e => {
      keys[e.code] = false;
    }
  );


  // ============================================================
  // POINTER LOCK
  // ============================================================

  document.addEventListener(
    "pointerlockchange",
    () => {

      locked =
        document.pointerLockElement === canvas;

    }
  );


  // ============================================================
  // DESKTOP MOUSE LOOK
  // ============================================================

  document.addEventListener(
    "mousemove",
    e => {

      if (!locked) {
        return;
      }

      yaw -=
        e.movementX * 0.0022;

      pitch -=
        e.movementY * 0.0022;

      pitch =
        Math.max(
          -1.35,
          Math.min(
            1.35,
            pitch
          )
        );

    }
  );


  // ============================================================
  // DESKTOP SHOOT
  // ============================================================

  canvas.addEventListener(
    "click",
    () => {

      if (
        matchMedia(
          "(pointer:fine)"
        ).matches
      ) {

        canvas.requestPointerLock?.();

        shoot();

      }

    }
  );


  // ============================================================
  // MOBILE CONTROLS
  // ============================================================

  setupMobile();


  // ============================================================
  // START GAME LOOP
  // ============================================================

  animate();
}


// ============================================================
// RESIZE
// ============================================================

function resize() {

  if (!renderer) {
    return;
  }

  camera.aspect =
    innerWidth /
    innerHeight;

  camera.updateProjectionMatrix();

  renderer.setSize(
    innerWidth,
    innerHeight
  );
}


// ============================================================
// SHOOT
// ============================================================

function shoot() {

  const now =
    performance.now();

  // Server cooldown is 550ms.
  if (
    now - lastShot < 550
  ) {
    return;
  }

  const player =
    world.players.find(
      p => p.id === me
    );

  if (!player || !player.alive) {
    return;
  }

  lastShot = now;

  socket.emit(
    "shoot",
    {
      yaw,
      pitch
    }
  );


  // Weapon recoil

  if (gun) {

    gun.rotation.z = -0.06;

    setTimeout(
      () => {

        if (gun) {
          gun.rotation.z = 0;
        }

      },
      80
    );

  }
}


// ============================================================
// MOBILE CONTROLS
// ============================================================

function setupMobile() {

  const stickEl =
    document.querySelector("#stick");

  const knob =
    document.querySelector("#knob");

  const fire =
    document.querySelector("#fire");

  const hud =
    document.querySelector(".hud");


  // ============================================================
  // MOVEMENT JOYSTICK
  // ============================================================

  let activePointer = null;


  function resetStick() {

    stick.x = 0;
    stick.y = 0;

    knob.style.transform =
      "translate(0px, 0px)";
  }


  function updateStick(e) {

    const rect =
      stickEl.getBoundingClientRect();

    let dx =
      e.clientX -
      (
        rect.left +
        rect.width / 2
      );

    let dy =
      e.clientY -
      (
        rect.top +
        rect.height / 2
      );

    const max = 42;

    const distance =
      Math.hypot(dx, dy);


    if (distance > max) {

      dx =
        (dx / distance) *
        max;

      dy =
        (dy / distance) *
        max;

    }


    stick.x =
      dx / max;

    stick.y =
      dy / max;


    knob.style.transform =
      `translate(${dx}px,${dy}px)`;
  }


  stickEl.addEventListener(
    "pointerdown",
    e => {

      e.preventDefault();
      e.stopPropagation();

      activePointer =
        e.pointerId;

      try {

        stickEl.setPointerCapture(
          e.pointerId
        );

      } catch (error) {}

      updateStick(e);

    },
    {
      passive: false
    }
  );


  stickEl.addEventListener(
    "pointermove",
    e => {

      if (
        e.pointerId !==
        activePointer
      ) {
        return;
      }

      e.preventDefault();

      updateStick(e);

    },
    {
      passive: false
    }
  );


  stickEl.addEventListener(
    "pointerup",
    e => {

      if (
        e.pointerId !==
        activePointer
      ) {
        return;
      }

      activePointer = null;

      resetStick();

    }
  );


  stickEl.addEventListener(
    "pointercancel",
    () => {

      activePointer = null;

      resetStick();

    }
  );


  // ============================================================
  // MOBILE AIM
  //
  // RIGHT SIDE OF SCREEN = AIM
  // CROSSHAIR REMAINS CENTERED
  // ============================================================

  let aimPointer = null;

  let lastX = 0;
  let lastY = 0;


  hud.addEventListener(
    "pointerdown",
    e => {

      // Ignore joystick

      if (
        e.target.closest("#stick")
      ) {
        return;
      }


      // Ignore fire button

      if (
        e.target.closest("#fire")
      ) {
        return;
      }


      // Ignore desktop mouse

      if (
        e.pointerType === "mouse"
      ) {
        return;
      }


      e.preventDefault();


      aimPointer =
        e.pointerId;


      lastX =
        e.clientX;

      lastY =
        e.clientY;


      try {

        hud.setPointerCapture(
          e.pointerId
        );

      } catch (error) {}

    },
    {
      passive: false
    }
  );


  hud.addEventListener(
    "pointermove",
    e => {

      if (
        e.pointerId !==
        aimPointer
      ) {
        return;
      }


      e.preventDefault();


      const dx =
        e.clientX -
        lastX;

      const dy =
        e.clientY -
        lastY;


      lastX =
        e.clientX;

      lastY =
        e.clientY;


      // Horizontal camera

      yaw -=
        dx * 0.006;


      // Vertical camera

      pitch -=
        dy * 0.006;


      pitch =
        Math.max(
          -1.35,
          Math.min(
            1.35,
            pitch
          )
        );

    },
    {
      passive: false
    }
  );


  function stopAim(e) {

    if (
      e.pointerId ===
      aimPointer
    ) {

      aimPointer = null;

      try {

        hud.releasePointerCapture(
          e.pointerId
        );

      } catch (error) {}

    }

  }


  hud.addEventListener(
    "pointerup",
    stopAim
  );

  hud.addEventListener(
    "pointercancel",
    stopAim
  );


  // ============================================================
  // MOBILE FIRE
  // TAP OR HOLD
  // ============================================================

  let fireTimer = null;


  function startFire(e) {

    e.preventDefault();
    e.stopPropagation();


    shoot();


    clearInterval(
      fireTimer
    );


    fireTimer =
      setInterval(
        () => {

          shoot();

        },
        120
      );

  }


  function stopFire(e) {

    if (e) {

      e.preventDefault();
      e.stopPropagation();

    }


    clearInterval(
      fireTimer
    );

    fireTimer = null;

  }


  fire.addEventListener(
    "pointerdown",
    startFire,
    {
      passive: false
    }
  );


  fire.addEventListener(
    "pointerup",
    stopFire,
    {
      passive: false
    }
  );


  fire.addEventListener(
    "pointercancel",
    stopFire,
    {
      passive: false
    }
  );


  fire.addEventListener(
    "pointerleave",
    stopFire,
    {
      passive: false
    }
  );
}


// ============================================================
// MAIN GAME LOOP
// ============================================================

function animate() {

  requestAnimationFrame(
    animate
  );


  if (!renderer) {
    return;
  }


  const dt =
    Math.min(
      clock.getDelta(),
      0.05
    );


  const speed = 7;


  // ============================================================
  // MOVEMENT
  // ============================================================

  let f =
    (keys.KeyW ? 1 : 0) -
    (keys.KeyS ? 1 : 0) -
    stick.y;


  let s =
    (keys.KeyD ? 1 : 0) -
    (keys.KeyA ? 1 : 0) +
    stick.x;


  if (
    Math.abs(f) +
    Math.abs(s) >
    0
  ) {

    const len =
      Math.hypot(
        f,
        s
      );


    f /= len;
    s /= len;


    camera.position.x +=
      (
        -Math.sin(yaw) * f +
        Math.cos(yaw) * s
      ) *
      speed *
      dt;


    camera.position.z +=
      (
        -Math.cos(yaw) * f -
        Math.sin(yaw) * s
      ) *
      speed *
      dt;


    // Arena boundaries

    camera.position.x =
      Math.max(
        -26.5,
        Math.min(
          26.5,
          camera.position.x
        )
      );


    camera.position.z =
      Math.max(
        -20.5,
        Math.min(
          20.5,
          camera.position.z
        )
      );

  }


  // ============================================================
  // CAMERA
  // ============================================================

  camera.position.y = 1.6;

  camera.rotation.order =
    "YXZ";

  camera.rotation.y =
    yaw;

  camera.rotation.x =
    pitch;


  // ============================================================
  // SEND PLAYER STATE
  // ============================================================

  const now =
    performance.now();


  if (
    now - lastSend > 80
  ) {

    socket.emit(
      "state",
      {
        x:
          camera.position.x,

        y:
          1.6,

        z:
          camera.position.z,

        yaw,
        pitch
      }
    );


    lastSend = now;

  }


  // ============================================================
  // REMOTE PLAYERS
  // ============================================================

  renderPlayers();


  // ============================================================
  // RENDER
  // ============================================================

  renderer.render(
    scene,
    camera
  );
}


// ============================================================
// REMOTE PLAYER RENDERING
// ============================================================

function renderPlayers() {

  for (
    const player
    of world.players
  ) {

    if (
      player.id === me
    ) {
      continue;
    }


    let mesh =
      remoteMeshes.get(
        player.id
      );


    // Create remote player

    if (!mesh) {

      mesh =
        new THREE.Group();


      // Body

      const body =
        new THREE.Mesh(
          new THREE.CapsuleGeometry(
            0.38,
            0.8,
            5,
            10
          ),
          new THREE.MeshStandardMaterial({
            color: 0x9fb3bd,
            roughness: 0.8
          })
        );


      body.position.y =
        0.95;

      body.castShadow = true;


      // Head

      const head =
        new THREE.Mesh(
          new THREE.SphereGeometry(
            0.26,
            12,
            10
          ),
          new THREE.MeshStandardMaterial({
            color: 0xc6a58c
          })
        );


      head.position.y =
        1.65;

      head.castShadow = true;


      mesh.add(
        body,
        head
      );


      scene.add(mesh);


      remoteMeshes.set(
        player.id,
        mesh
      );

    }


    // Hide dead players

    mesh.visible =
      player.alive;


    // Position

    mesh.position.set(
      player.x,
      player.y - 1.6,
      player.z
    );


    // Rotation

    mesh.rotation.y =
      player.yaw;

  }
}


// ============================================================
// WORLD STATE
// ============================================================

socket.on(
  "world",
  state => {

    world = state;


    const mePlayer =
      state.players.find(
        player =>
          player.id === me
      );


    if (mePlayer) {

      // Health

      hpEl.style.width =
        mePlayer.hp + "%";


      hpText.textContent =
        mePlayer.hp;


      // Respawn

      if (!mePlayer.alive) {

        message.textContent =
          "RESPAWNING…";

      } else if (!state.winner) {

        message.textContent =
          "";

      }

    }


    // Scoreboard

    scoreboard.innerHTML =
      state.players
        .map(
          player =>
            `
            <div class="score ${
              player.id === me
                ? "me"
                : ""
            }">

              <span>
                ${escapeHtml(
                  player.name
                )}
              </span>

              <b>
                ${player.score}
              </b>

            </div>
            `
        )
        .join("");


    // Winner

    if (state.winner) {

      const winner =
        state.players.find(
          player =>
            player.id ===
            state.winner
        );


      message.textContent =
        (
          state.winner === me
            ? "MISSION COMPLETE"
            : "MATCH LOST"
        ) +
        " — " +
        (
          winner?.name ||
          "winner"
        );

    }

  }
);


// ============================================================
// HIT CONFIRMATION
// ============================================================

socket.on(
  "hitConfirm",
  data => {

    showFeed(
      data.head
        ? "HEADSHOT  +100"
        : "HIT  +" + data.damage
    );

  }
);


// ============================================================
// ELIMINATION
// ============================================================

socket.on(
  "elimination",
  data => {

    const killer =
      world.players.find(
        player =>
          player.id ===
          data.killer
      );


    const victim =
      world.players.find(
        player =>
          player.id ===
          data.victim
      );


    showFeed(
      `${killer?.name || "Operator"}  >  ${
        victim?.name || "Target"
      }${
        data.head
          ? "  HEADSHOT"
          : ""
      }`
    );

  }
);


// ============================================================
// MATCH OVER
// ============================================================

socket.on(
  "matchOver",
  data => {

    const player =
      world.players.find(
        p =>
          p.id ===
          data.winner
      );


    message.textContent =
      (
        data.winner === me
          ? "YOU WIN"
          : "YOU LOSE"
      ) +
      " — " +
      (
        player?.name ||
        "operator"
      );

  }
);


// ============================================================
// CONNECTION
// ============================================================

socket.on(
  "connect",
  () => {

    connection.textContent =
      "● ONLINE";

  }
);


socket.on(
  "disconnect",
  () => {

    connection.textContent =
      "● RECONNECTING";

  }
);


// ============================================================
// KILL FEED
// ============================================================

function showFeed(text) {

  const element =
    document.createElement(
      "div"
    );

  element.className =
    "kill";

  element.textContent =
    text;


  document
    .querySelector(
      "#killfeed"
    )
    .appendChild(
      element
    );


  setTimeout(
    () => {

      element.remove();

    },
    2200
  );
}


// ============================================================
// HTML ESCAPE
// ============================================================

function escapeHtml(text) {

  return String(text)
    .replace(
      /[&<>"']/g,
      character => ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#039;"
      }[character])
    );

}
