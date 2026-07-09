// client.js — Ve ban co, xu ly click chon quan/di chuyen, noi chuyen voi server qua socket.io
import { Chess } from "https://unpkg.com/chess.js@1.4.0/dist/esm/chess.js";

const socket = io();
const game = new Chess(); // ban co o phia trinh duyet, chi dung de hien thi va goi y nuoc di hop le

const lobbyEl = document.getElementById("lobby");
const lobbyMessageEl = document.getElementById("lobby-message");
const roomInputEl = document.getElementById("room-input");
const joinBtnEl = document.getElementById("join-btn");
const gameEl = document.getElementById("game");
const statusEl = document.getElementById("status");
const boardEl = document.getElementById("board");
const inviteBoxEl = document.getElementById("invite-box");
const inviteLinkEl = document.getElementById("invite-link");
const copyLinkBtnEl = document.getElementById("copy-link-btn");

// Ky hieu quan co bang Unicode. Dung chung 1 bo glyph dac (filled) cho ca 2 mau,
// mau trang/den that su duoc to bang CSS (piece-white / piece-black) de luon ro rang.
const PIECE_ICONS = { p: "♟", n: "♞", b: "♝", r: "♜", q: "♛", k: "♚" };

let myColor = null; // 'w' hoac 'b'
let roomCode = null;
let selectedSquare = null;
let legalTargets = []; // danh sach o co the di toi tu selectedSquare
let lastMove = null;

function joinRoom(code) {
  code = code.trim();
  if (!code) {
    lobbyMessageEl.textContent = "Vui long nhap ma phong.";
    return;
  }
  roomCode = code;
  roomInputEl.value = code;
  socket.emit("join-room", code);
}

joinBtnEl.addEventListener("click", () => joinRoom(roomInputEl.value));

copyLinkBtnEl.addEventListener("click", async () => {
  try {
    await navigator.clipboard.writeText(inviteLinkEl.value);
    copyLinkBtnEl.textContent = "Đã sao chép!";
    setTimeout(() => (copyLinkBtnEl.textContent = "Sao chép"), 1500);
  } catch {
    inviteLinkEl.select();
  }
});

socket.on("join-error", (msg) => {
  lobbyMessageEl.textContent = msg;
  inviteBoxEl.classList.add("hidden");
});

socket.on("waiting-for-opponent", () => {
  lobbyMessageEl.textContent = "Đã vào phòng. Đang chờ đối thủ tham gia...";

  const url = new URL(window.location.href);
  url.searchParams.set("room", roomCode);
  inviteLinkEl.value = url.toString();
  inviteBoxEl.classList.remove("hidden");
});

// Neu link co san ?room=... (ai do gui link moi) thi tu dong vao phong luon
const roomFromUrl = new URLSearchParams(window.location.search).get("room");
if (roomFromUrl) {
  joinRoom(roomFromUrl);
}

socket.on("joined", ({ color }) => {
  myColor = color;
});

socket.on("start-game", ({ fen }) => {
  game.load(fen);
  lobbyEl.classList.add("hidden");
  gameEl.classList.remove("hidden");
  renderBoard();
  updateStatus();
});

socket.on("move-made", ({ fen, lastMove: lm, status }) => {
  game.load(fen);
  lastMove = lm;
  selectedSquare = null;
  legalTargets = [];
  renderBoard();
  updateStatus(status);
});

socket.on("invalid-move", (msg) => {
  statusEl.textContent = msg;
  setTimeout(updateStatus, 1200);
});

socket.on("opponent-left", () => {
  statusEl.textContent = "Doi thu da roi phong.";
});

function updateStatus(status) {
  const turnText = game.turn() === "w" ? "Trang" : "Den";
  const meText = myColor === "w" ? "Trang" : "Den";
  let text = `Ban la quan ${meText}. Luot di: ${turnText}.`;

  if (status === "checkmate") {
    const winner = game.turn() === "w" ? "Den" : "Trang";
    text = `Chieu het! ${winner} thang!`;
  } else if (status === "stalemate" || status === "draw") {
    text = "Hoa co!";
  } else if (status === "check") {
    text += " Dang bi chieu tuong!";
  }

  statusEl.textContent = text;
}

function renderBoard() {
  boardEl.innerHTML = "";

  const files = ["a", "b", "c", "d", "e", "f", "g", "h"];
  const ranks = ["8", "7", "6", "5", "4", "3", "2", "1"];

  // Neu la quan Den thi lat ban co de nguoi choi luon nhin thay quan minh o phia duoi
  const orderedFiles = myColor === "b" ? [...files].reverse() : files;
  const orderedRanks = myColor === "b" ? [...ranks].reverse() : ranks;

  for (const rank of orderedRanks) {
    for (const file of orderedFiles) {
      const square = file + rank;
      const squareEl = document.createElement("div");
      squareEl.classList.add("square");

      const isLight = (files.indexOf(file) + ranks.indexOf(rank)) % 2 === 0;
      squareEl.classList.add(isLight ? "light" : "dark");

      if (lastMove && (square === lastMove.from || square === lastMove.to)) {
        squareEl.classList.add("last-move");
      }
      if (square === selectedSquare) {
        squareEl.classList.add("selected");
      }
      if (legalTargets.includes(square)) {
        squareEl.classList.add("legal-move");
      }

      const piece = game.get(square);
      if (piece) {
        const pieceEl = document.createElement("span");
        pieceEl.className = piece.color === "w" ? "piece-white" : "piece-black";
        pieceEl.textContent = PIECE_ICONS[piece.type];
        squareEl.appendChild(pieceEl);
      }

      squareEl.addEventListener("click", () => onSquareClick(square));
      boardEl.appendChild(squareEl);
    }
  }
}

function onSquareClick(square) {
  if (!myColor || game.turn() !== myColor) return; // chua den luot minh thi khong cho chon

  if (selectedSquare && legalTargets.includes(square)) {
    // Thuc hien nuoc di: kiem tra phong hau (pawn len hang cuoi)
    const piece = game.get(selectedSquare);
    const isPromotion =
      piece?.type === "p" && (square[1] === "8" || square[1] === "1");

    socket.emit("move", {
      roomCode,
      from: selectedSquare,
      to: square,
      promotion: isPromotion ? "q" : undefined,
    });

    selectedSquare = null;
    legalTargets = [];
    return;
  }

  const piece = game.get(square);
  if (piece && piece.color === myColor) {
    selectedSquare = square;
    legalTargets = game
      .moves({ square, verbose: true })
      .map((m) => m.to);
  } else {
    selectedSquare = null;
    legalTargets = [];
  }

  renderBoard();
}
