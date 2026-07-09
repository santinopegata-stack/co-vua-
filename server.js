// server.js — Server chinh: phuc vu file web + xu ly logic choi co online
const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const { Chess } = require("chess.js");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

// Phuc vu toan bo file trong thu muc "public" (index.html, style.css, client.js)
app.use(express.static("public"));

// Luu tat ca phong choi dang mo: ma phong -> { game, white, black }
const rooms = new Map();

// Luu tat ca giai dau dang cho ghep cap: ma giai dau -> { players: [socketId,...], hostId }
const tournaments = new Map();
const MAX_TOURNAMENT_PLAYERS = 10;

function enterRoom(socket, roomCode, color) {
  socket.join(roomCode);
  socket.data.currentRoom = roomCode;
  socket.emit("joined", { color, roomCode });
}

function leaveRoom(socket) {
  const currentRoom = socket.data.currentRoom;
  if (!currentRoom) return;
  const room = rooms.get(currentRoom);
  socket.data.currentRoom = null;
  socket.leave(currentRoom);
  if (!room) return;

  // Mot trong hai nguoi roi phong -> bao cho nguoi con lai va xoa han phong nay
  socket.to(currentRoom).emit("opponent-left");
  rooms.delete(currentRoom);
}

function removeFromTournament(socket) {
  const code = socket.data.tournamentCode;
  if (!code) return;
  const t = tournaments.get(code);
  socket.data.tournamentCode = null;
  if (!t) return;

  socket.leave("t:" + code);
  t.players = t.players.filter((id) => id !== socket.id);

  if (t.players.length === 0 || socket.id === t.hostId) {
    // Chu giai dau roi di hoac het nguoi -> huy giai dau
    io.to("t:" + code).emit("tournament-error", "Giai dau da bi huy (chu phong roi di hoac het nguoi).");
    tournaments.delete(code);
  } else {
    io.to("t:" + code).emit("tournament-update", { count: t.players.length });
  }
}

io.on("connection", (socket) => {
  socket.on("join-room", (roomCode) => {
    roomCode = String(roomCode || "").trim();
    if (!roomCode) {
      socket.emit("join-error", "Ma phong khong duoc de trong.");
      return;
    }

    let room = rooms.get(roomCode);

    if (!room) {
      // Phong chua ton tai -> tao moi, nguoi vao dau tien la quan Trang
      room = { game: new Chess(), white: socket.id, black: null };
      rooms.set(roomCode, room);
      enterRoom(socket, roomCode, "w");
      socket.emit("waiting-for-opponent");
      return;
    }

    if (room.white && room.black) {
      socket.emit("join-error", "Phong da du 2 nguoi choi.");
      return;
    }

    // Phong da co 1 nguoi -> nguoi thu 2 la quan Den, bat dau van co
    room.black = socket.id;
    enterRoom(socket, roomCode, "b");

    io.to(roomCode).emit("start-game", { fen: room.game.fen() });
  });

  socket.on("move", ({ roomCode, from, to, promotion }) => {
    const room = rooms.get(roomCode);
    if (!room) return;

    const isWhiteTurn = room.game.turn() === "w";
    const playerColor = socket.id === room.white ? "w" : socket.id === room.black ? "b" : null;
    if (!playerColor) return;
    if ((isWhiteTurn && playerColor !== "w") || (!isWhiteTurn && playerColor !== "b")) {
      socket.emit("invalid-move", "Chua den luot ban.");
      return;
    }

    let move;
    try {
      move = room.game.move({ from, to, promotion: promotion || "q" });
    } catch (err) {
      move = null;
    }

    if (!move) {
      socket.emit("invalid-move", "Nuoc di khong hop le.");
      return;
    }

    const game = room.game;
    let status = "playing";
    if (game.isCheckmate()) status = "checkmate";
    else if (game.isStalemate()) status = "stalemate";
    else if (game.isDraw()) status = "draw";
    else if (game.isCheck()) status = "check";

    io.to(roomCode).emit("move-made", {
      fen: game.fen(),
      lastMove: { from, to },
      san: move.san,
      piece: move.piece,
      color: move.color,
      turn: game.turn(),
      status,
    });
  });

  socket.on("leave-room", () => leaveRoom(socket));

  // ---------- Giai dau: ghep cap ngau nhien toi da 10 nguoi ----------

  socket.on("join-tournament", (code) => {
    code = String(code || "").trim();
    if (!code) {
      socket.emit("tournament-error", "Ma giai dau khong duoc de trong.");
      return;
    }

    let t = tournaments.get(code);

    if (!t) {
      t = { players: [socket.id], hostId: socket.id };
      tournaments.set(code, t);
      socket.join("t:" + code);
      socket.data.tournamentCode = code;
      socket.emit("tournament-host");
      socket.emit("tournament-update", { count: t.players.length });
      return;
    }

    if (t.players.includes(socket.id)) {
      socket.emit("tournament-update", { count: t.players.length });
      return;
    }

    if (t.players.length >= MAX_TOURNAMENT_PLAYERS) {
      socket.emit("tournament-error", "Giai dau da du 10 nguoi.");
      return;
    }

    t.players.push(socket.id);
    socket.join("t:" + code);
    socket.data.tournamentCode = code;
    io.to("t:" + code).emit("tournament-update", { count: t.players.length });
  });

  socket.on("leave-tournament", () => removeFromTournament(socket));

  socket.on("start-tournament", (code) => {
    const t = tournaments.get(code);
    if (!t || t.hostId !== socket.id) return;
    if (t.players.length < 2) {
      socket.emit("tournament-error", "Can it nhat 2 nguoi de bat dau.");
      return;
    }

    // Xao ngau nhien danh sach nguoi choi (Fisher-Yates)
    const shuffled = [...t.players];
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }

    let byePlayerId = null;
    if (shuffled.length % 2 === 1) byePlayerId = shuffled.pop();

    for (let i = 0; i < shuffled.length; i += 2) {
      const whiteId = shuffled[i];
      const blackId = shuffled[i + 1];
      const pairRoomCode = `${code}-${i / 2 + 1}`;
      const room = { game: new Chess(), white: whiteId, black: blackId };
      rooms.set(pairRoomCode, room);

      const whiteSocket = io.sockets.sockets.get(whiteId);
      const blackSocket = io.sockets.sockets.get(blackId);
      if (whiteSocket) {
        whiteSocket.leave("t:" + code);
        whiteSocket.data.tournamentCode = null;
        enterRoom(whiteSocket, pairRoomCode, "w");
      }
      if (blackSocket) {
        blackSocket.leave("t:" + code);
        blackSocket.data.tournamentCode = null;
        enterRoom(blackSocket, pairRoomCode, "b");
      }
      io.to(pairRoomCode).emit("start-game", { fen: room.game.fen() });
    }

    if (byePlayerId) {
      const byeSocket = io.sockets.sockets.get(byePlayerId);
      if (byeSocket) {
        byeSocket.leave("t:" + code);
        byeSocket.data.tournamentCode = null;
        byeSocket.emit("tournament-bye", "So nguoi le, ban tam thoi chua co cap trong vong nay.");
      }
    }

    tournaments.delete(code);
  });

  socket.on("disconnect", () => {
    removeFromTournament(socket);
    leaveRoom(socket);
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Server dang chay tai http://localhost:${PORT}`);
});
