const express = require("express");
const http = require("http");
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static("public"));

const PORT = process.env.PORT || 3000;
const ADMIN_CODE = "3487";

const rooms = new Map();

const CHARACTERS = {
  Blaze: { name: "🔥 ブレイズ", admin: false },
  Storm: { name: "⚡ ストーム", admin: false },
  Rock: { name: "🪨 ロック", admin: false },
  Shadow: { name: "🌑 シャドウ", admin: false },
  Wing: { name: "🪽 ウィング", admin: false },

  Neon: { name: "👑 ネオン", admin: true },
  Destroyer: { name: "💀 デストロイヤー", admin: true },
  Zero: { name: "🌌 ゼロ", admin: true },
  Glitch: { name: "☠️ グリッチ", admin: true },
  Dragon: { name: "🐉 ドラゴン", admin: true }
};

function validCharacter(id, adminUnlocked) {
  const character = CHARACTERS[id];

  if (!character) {
    return false;
  }

  if (character.admin && !adminUnlocked) {
    return false;
  }

  return true;
}

function createPlayer(socketId, slot, character) {
  return {
    socketId,
    slot,
    character,

    x: slot === 0 ? 360 : 690,
    y: 250,

    vx: 0,
    vy: 0,

    damage: 0,
    stocks: 3,

    invincible: 90,
    attackCooldown: 0,
    lastHitTime: 0,

    connected: true
  };
}

function resetPlayer(player) {
  player.x = player.slot === 0 ? 360 : 690;
  player.y = 250;

  player.vx = 0;
  player.vy = 0;

  player.damage = 0;

  player.invincible = 90;
  player.attackCooldown = 0;
  player.lastHitTime = 0;
}

function getPublicState(room) {
  return {
    roomId: room.id,
    phase: room.phase,
    stage: room.stage,
    adminUnlocked: room.adminUnlocked,
    winner: room.winner,

    players: room.players.map(player => ({
      slot: player.slot,
      character: player.character,

      x: player.x,
      y: player.y,

      damage: Math.floor(player.damage),
      stocks: player.stocks,

      invincible: player.invincible > 0,
      connected: player.connected
    }))
  };
}

function attack(room, player, type) {
  if (room.phase !== "battle") {
    return;
  }

  if (player.attackCooldown > 0) {
    return;
  }

  const target = room.players.find(
    other => other !== player && other.connected
  );

  if (!target) {
    return;
  }

  if (target.invincible > 0) {
    return;
  }

  let damage = 7;
  let range = 72;
  let knockback = 7;

  if (type === "special1") {
    damage = 10;
    range = 105;
    knockback = 8;
  }

  if (type === "special2") {
    damage = 12;
    range = 90;
    knockback = 9;
  }

  if (type === "special3") {
    damage = 16;
    range = 125;
    knockback = 11;
  }

  const character = CHARACTERS[player.character];

  if (character && character.admin) {
    damage *= 1.12;
  }

  player.attackCooldown =
    type === "attack"
      ? 220
      : 420;

  const horizontalDistance =
    Math.abs(target.x - player.x);

  const verticalDistance =
    Math.abs(target.y - player.y);

  if (
    horizontalDistance <= range &&
    verticalDistance <= 90 &&
    Date.now() - target.lastHitTime > 180
  ) {
    const direction =
      target.x >= player.x
        ? 1
        : -1;

    target.damage += damage;

    if (target.damage > 999) {
      target.damage = 999;
    }

    const finalKnockback =
      knockback +
      target.damage * 0.055;

    target.vx =
      direction *
      finalKnockback;

    target.vy =
      -(6 + target.damage * 0.018);

    target.lastHitTime =
      Date.now();
  }
}

function updateRoom(room) {
  if (room.phase !== "battle") {
    return;
  }

  const gravity = 0.62;

  for (const player of room.players) {
    if (!player.connected) {
      continue;
    }

    player.attackCooldown =
      Math.max(
        0,
        player.attackCooldown - 33
      );

    player.invincible =
      Math.max(
        0,
        player.invincible - 1
      );

    player.vy += gravity;

    player.x += player.vx;
    player.y += player.vy;

    player.vx *= 0.88;

    /*
      メインステージ
    */

    if (
      player.y + 70 >= 500 &&
      player.y + 70 <= 540 &&
      player.vy >= 0
    ) {
      player.y = 430;
      player.vy = 0;
    }

    /*
      場外判定
    */

    const outOfBounds =
      player.x < -120 ||
      player.x > 1120 ||
      player.y > 730;

    if (outOfBounds) {
      player.stocks--;

      if (player.stocks <= 0) {
        room.phase = "result";

        const winner =
          room.players.find(
            other => other !== player
          );

        room.winner =
          winner
            ? winner.slot
            : 0;
      } else {
        resetPlayer(player);
      }
    }
  }

  io
    .to(room.id)
    .emit(
      "state",
      getPublicState(room)
    );
}

setInterval(() => {
  for (const room of rooms.values()) {
    updateRoom(room);
  }
}, 33);

io.on("connection", socket => {

  /*
    ルーム作成
  */

  socket.on(
    "createRoom",
    data => {

      const roomId =
        Math.random()
          .toString(36)
          .substring(2, 8)
          .toUpperCase();

      const adminUnlocked =
        data.adminCode === ADMIN_CODE;

      const character =
        validCharacter(
          data.character,
          adminUnlocked
        )
          ? data.character
          : "Blaze";

      const room = {
        id: roomId,

        stage:
          data.stage ||
          "Sky Island",

        adminUnlocked,

        phase: "lobby",

        players: [],

        winner: null
      };

      const player =
        createPlayer(
          socket.id,
          0,
          character
        );

      room.players.push(player);

      rooms.set(
        roomId,
        room
      );

      socket.join(roomId);

      socket.emit(
        "roomCreated",
        {
          id: roomId,
          adminUnlocked
        }
      );

      io
        .to(roomId)
        .emit(
          "state",
          getPublicState(room)
        );
    }
  );

  /*
    ルーム参加
  */

  socket.on(
    "joinRoom",
    data => {

      const id =
        String(
          data.id || ""
        ).toUpperCase();

      const room =
        rooms.get(id);

      if (!room) {
        socket.emit(
          "errorMsg",
          "そのルームはありません"
        );

        return;
      }

      if (room.players.length >= 2) {
        socket.emit(
          "errorMsg",
          "ルームは満員です"
        );

        return;
      }

      const character =
        validCharacter(
          data.character,
          room.adminUnlocked
        )
          ? data.character
          : "Blaze";

      const player =
        createPlayer(
          socket.id,
          1,
          character
        );

      room.players.push(player);

      socket.join(room.id);

      room.phase = "battle";

      io
        .to(room.id)
        .emit(
          "state",
          getPublicState(room)
        );
    }
  );

  /*
    操作入力
  */

  socket.on(
    "input",
    data => {

      for (const room of rooms.values()) {

        const player =
          room.players.find(
            p =>
              p.socketId ===
              socket.id
          );

        if (!player) {
          continue;
        }

        if (room.phase !== "battle") {
          continue;
        }

        if (data.action === "left") {
          player.vx =
            Math.max(
              -7,
              player.vx - 0.9
            );
        }

        if (data.action === "right") {
          player.vx =
            Math.min(
              7,
              player.vx + 0.9
            );
        }

        if (
          data.action === "jump" &&
          player.y >= 390
        ) {
          player.vy = -13;
        }

        if (
          [
            "attack",
            "special1",
            "special2",
            "special3"
          ].includes(data.action)
        ) {
          attack(
            room,
            player,
            data.action
          );
        }

        break;
      }
    }
  );

  /*
    再戦
  */

  socket.on(
    "restart",
    () => {

      for (
        const room
        of rooms.values()
      ) {

        const exists =
          room.players.some(
            player =>
              player.socketId ===
              socket.id
          );

        if (!exists) {
          continue;
        }

        room.phase =
          room.players.length === 2
            ? "battle"
            : "lobby";

        room.winner = null;

        for (
          const player
          of room.players
        ) {
          player.stocks = 3;

          resetPlayer(
            player
          );
        }

        io
          .to(room.id)
          .emit(
            "state",
            getPublicState(room)
          );

        break;
      }
    }
  );

  /*
    切断
  */

  socket.on(
    "disconnect",
    () => {

      for (
        const room
        of rooms.values()
      ) {

        const player =
          room.players.find(
            p =>
              p.socketId ===
              socket.id
          );

        if (!player) {
          continue;
        }

        player.connected = false;

        io
          .to(room.id)
          .emit(
            "state",
            getPublicState(room)
          );

        break;
      }
    }
  );
});

server.listen(
  PORT,
  () => {
    console.log(
      `Arena server running on port ${PORT}`
    );
  }
);
