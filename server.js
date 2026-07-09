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

io.on("connection", (socket) => {
  let currentRoom = null;

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
      socket.join(roomCode);
      currentRoom = roomCode;
      socket.emit("joined", { color: "w", roomCode });
      socket.emit("waiting-for-opponent");
      return;
    }

    if (room.white && room.black) {
      socket.emit("join-error", "Phong da du 2 nguoi choi.");
      return;
    }

    // Phong da co 1 nguoi -> nguoi thu 2 la quan Den, bat dau van co
    room.black = socket.id;
    socket.join(roomCode);
    currentRoom = roomCode;
    socket.emit("joined", { color: "b", roomCode });

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
      turn: game.turn(),
      status,
    });
  });

  socket.on("disconnect", () => {
    if (!currentRoom) return;
    const room = rooms.get(currentRoom);
    if (!room) return;

    socket.to(currentRoom).emit("opponent-left");

    if (room.white === socket.id) room.white = null;
    if (room.black === socket.id) room.black = null;
    if (!room.white && !room.black) rooms.delete(currentRoom);
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Server dang chay tai http://localhost:${PORT}`);
});
