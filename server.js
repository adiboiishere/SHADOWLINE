const express = require("express");
const http = require("http");
const path = require("path");
const crypto = require("crypto");
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);
const io = new Server(server, { transports: ["websocket", "polling"] });

const PORT = process.env.PORT || 3000;
const rooms = new Map();

app.use(express.static(path.join(__dirname, "public")));
app.use("/vendor", express.static(path.join(__dirname, "node_modules")));
app.use((req, res) => res.sendFile(path.join(__dirname, "public", "index.html")));

const ARENA = { minX: -28, maxX: 28, minZ: -22, maxZ: 22 };
const MAX_HP = 100;
const DAMAGE = 34;
const HEAD_DAMAGE = 100;
const KILL_SCORE = 1;
const WIN_SCORE = 10;
const SHOT_COOLDOWN = 550;
const RESPAWN_MS = 2500;

const spawnPoints = [
  [-22, 1.6, -16], [22, 1.6, -16],
  [-22, 1.6, 16], [22, 1.6, 16],
  [0, 1.6, -18], [0, 1.6, 18]
];

function code() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let out;
  do {
    out = Array.from({length: 5}, () => chars[Math.floor(Math.random()*chars.length)]).join("");
  } while (rooms.has(out));
  return out;
}

function cleanName(n) {
  return String(n || "Player").replace(/[<>]/g, "").trim().slice(0, 18) || "Player";
}

function makeRoom() {
  const c = code();
  const room = { code:c, players:new Map(), winner:null, startedAt:Date.now() };
  rooms.set(c, room);
  return room;
}

function spawnFor(room) {
  const occupied = new Set([...room.players.values()].map(p => p.spawnIndex));
  const free = spawnPoints.map((_,i)=>i).filter(i=>!occupied.has(i));
  const choices = free.length ? free : spawnPoints.map((_,i)=>i);
  return choices[Math.floor(Math.random()*choices.length)];
}

function publicState(room) {
  return {
    roomCode: room.code,
    players: [...room.players.values()].map(p => ({
      id:p.id, name:p.name, x:p.x, y:p.y, z:p.z,
      yaw:p.yaw, pitch:p.pitch, hp:p.hp, score:p.score,
      alive:p.alive, respawnAt:p.respawnAt || 0
    })),
    winner: room.winner
  };
}

function broadcast(room) {
  io.to(room.code).emit("world", publicState(room));
}

function clamp(n,a,b){ return Math.max(a, Math.min(b,n)); }

function addPlayer(socket, room, name, cb) {
  if (room.players.size >= 8) return cb?.({ok:false,error:"Room is full (8 players max)."});
  const spawnIndex = spawnFor(room);
  const [x,y,z] = spawnPoints[spawnIndex];
  const p = {
    id:socket.id, name:cleanName(name), x,y,z,
    yaw:0, pitch:0, hp:MAX_HP, score:0, alive:true,
    spawnIndex, lastShot:0, respawnAt:0
  };
  room.players.set(socket.id,p);
  socket.join(room.code);
  socket.data.roomCode=room.code;
  cb?.({ok:true, roomCode:room.code, id:socket.id});
  broadcast(room);
}

function raySphere(origin, dir, center, radius) {
  const ox=origin.x-center.x, oy=origin.y-center.y, oz=origin.z-center.z;
  const b=ox*dir.x+oy*dir.y+oz*dir.z;
  const c=ox*ox+oy*oy+oz*oz-radius*radius;
  const disc=b*b-c;
  if(disc<0) return Infinity;
  const t=-b-Math.sqrt(disc);
  return t>=0?t:Infinity;
}

function respawn(room,p) {
  const idx = spawnFor(room);
  const [x,y,z] = spawnPoints[idx];
  p.spawnIndex=idx; p.x=x; p.y=y; p.z=z; p.hp=MAX_HP; p.alive=true; p.respawnAt=0;
}

io.on("connection", socket => {
  socket.on("createRoom", ({name}, cb) => addPlayer(socket, makeRoom(), name, cb));

  socket.on("joinRoom", ({roomCode,name}, cb) => {
    const room=rooms.get(String(roomCode||"").toUpperCase());
    if(!room) return cb?.({ok:false,error:"Room not found."});
    addPlayer(socket,room,name,cb);
  });

  socket.on("state", data => {
    const room=rooms.get(socket.data.roomCode);
    const p=room?.players.get(socket.id);
    if(!room||!p||!p.alive) return;
    p.x=clamp(Number(data.x)||0,ARENA.minX,ARENA.maxX);
    p.y=clamp(Number(data.y)||1.6,1.0,3.2);
    p.z=clamp(Number(data.z)||0,ARENA.minZ,ARENA.maxZ);
    p.yaw=Number(data.yaw)||0;
    p.pitch=clamp(Number(data.pitch)||0,-1.45,1.45);
  });

  socket.on("shoot", data => {
    const room=rooms.get(socket.data.roomCode);
    const shooter=room?.players.get(socket.id);
    if(!room||!shooter||!shooter.alive||room.winner) return;

    const now=Date.now();
    if(now-shooter.lastShot<SHOT_COOLDOWN) return;
    shooter.lastShot=now;

    const yaw=Number(data.yaw), pitch=clamp(Number(data.pitch)||0,-1.45,1.45);
    const dir={
      x:-Math.sin(yaw)*Math.cos(pitch),
      y:Math.sin(pitch),
      z:-Math.cos(yaw)*Math.cos(pitch)
    };
    const origin={x:shooter.x,y:shooter.y,z:shooter.z};

    let target=null, best=Infinity;
    for(const p of room.players.values()){
      if(p.id===shooter.id||!p.alive) continue;
      const t=raySphere(origin,dir,{x:p.x,y:p.y-0.35,z:p.z},0.75);
      if(t<best && t<70){best=t;target=p;}
    }

    io.to(room.code).emit("shot", {id:shooter.id, hit:!!target, targetId:target?.id || null});

    if(!target) return;
    const headCenter={x:target.x,y:target.y+0.15,z:target.z};
    const headT=raySphere(origin,dir,headCenter,0.32);
    const damage=headT<best+0.8 ? HEAD_DAMAGE : DAMAGE;
    target.hp-=damage;
    io.to(shooter.id).emit("hitConfirm",{damage,head:damage===HEAD_DAMAGE,targetId:target.id});

    if(target.hp<=0){
      target.hp=0; target.alive=false; target.respawnAt=now+RESPAWN_MS;
      shooter.score+=KILL_SCORE;
      io.to(room.code).emit("elimination",{killer:shooter.id,victim:target.id,head:damage===HEAD_DAMAGE});
      if(shooter.score>=WIN_SCORE){
        room.winner=shooter.id;
        io.to(room.code).emit("matchOver",{winner:shooter.id});
      } else {
        setTimeout(()=>{
          if(!rooms.has(room.code)) return;
          const current=room.players.get(target.id);
          if(current && !room.winner){ respawn(room,current); broadcast(room); }
        },RESPAWN_MS);
      }
    }
    broadcast(room);
  });

  socket.on("disconnect", () => {
    const room=rooms.get(socket.data.roomCode);
    if(!room) return;
    room.players.delete(socket.id);
    if(room.players.size===0) rooms.delete(room.code);
    else broadcast(room);
  });
});

setInterval(()=>{
  for(const room of rooms.values()) broadcast(room);
},100);

server.listen(PORT,()=>console.log(`Shadowline FPP running on port ${PORT}`));