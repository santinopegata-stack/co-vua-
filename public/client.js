// client.js — Man hinh menu, ban co, choi voi ban / voi may / giai dau, noi voi server qua socket.io
import { Chess } from "https://unpkg.com/chess.js@1.4.0/dist/esm/chess.js";

const socket = io();
const game = new Chess(); // ban co o phia trinh duyet: hien thi + goi y nuoc di + (che do may) tu xu ly luat

// ---------- Cac phan tu man hinh ----------
const menuScreenEl = document.getElementById("menu-screen");
const modeFriendBtn = document.getElementById("mode-friend");
const modeRobotBtn = document.getElementById("mode-robot");
const modeTournamentBtn = document.getElementById("mode-tournament");

const lobbyEl = document.getElementById("lobby");
const lobbyMessageEl = document.getElementById("lobby-message");
const roomInputEl = document.getElementById("room-input");
const joinBtnEl = document.getElementById("join-btn");
const inviteBoxEl = document.getElementById("invite-box");
const inviteCodeEl = document.getElementById("invite-code");
const copyLinkBtnEl = document.getElementById("copy-link-btn");

const tournamentEl = document.getElementById("tournament-lobby");
const tournamentInputEl = document.getElementById("tournament-input");
const tournamentJoinBtnEl = document.getElementById("tournament-join-btn");
const tournamentMessageEl = document.getElementById("tournament-message");
const tournamentInfoEl = document.getElementById("tournament-info");
const tournamentCodeDisplayEl = document.getElementById("tournament-code-display");
const tournamentCountEl = document.getElementById("tournament-count");
const tournamentStartBtnEl = document.getElementById("tournament-start-btn");
const tournamentWaitMsgEl = document.getElementById("tournament-wait-msg");

const gameEl = document.getElementById("game");
const statusEl = document.getElementById("status");
const boardEl = document.getElementById("board");
const leaveGameBtnEl = document.getElementById("leave-game-btn");
const moveHistoryListEl = document.getElementById("move-history-list");

// ---------- Hinh anh quan co (bo "cburnett" mien phi, Lichess.org dang dung) ----------
const PIECE_LETTER = { p: "P", n: "N", b: "B", r: "R", q: "Q", k: "K" };
function pieceImageUrl(color, type) {
  return `https://lichess1.org/assets/piece/cburnett/${color}${PIECE_LETTER[type]}.svg`;
}

// ---------- Trang thai chung ----------
let myColor = null; // 'w' hoac 'b'
let roomCode = null;
let vsBot = false;
let selectedSquare = null;
let legalTargets = [];
let lastMove = null;

let tournamentCode = null;
let isTournamentHost = false;

let moveHistory = []; // danh sach { san, piece, color } cua tung nuoc di, theo dung thu tu

function buildMoveEntry(move) {
  const span = document.createElement("span");
  span.className = "move-entry";

  const icon = document.createElement("img");
  icon.className = "move-piece-icon";
  icon.src = pieceImageUrl(move.color, move.piece);
  icon.alt = "";
  icon.draggable = false;
  span.appendChild(icon);

  // Icon da the hien loai quan roi nen bo chu cai ky hieu quan (N, B, R, Q, K) cho de doc,
  // chi giu lai o di toi / an quan / phong cap / chieu tuong (vd: "Nc6" -> "c6")
  const displaySan = move.piece !== "p" ? move.san.replace(/^[NBRQK]/, "") : move.san;
  span.appendChild(document.createTextNode(displaySan));
  return span;
}

function renderMoveHistory() {
  moveHistoryListEl.innerHTML = "";
  for (let i = 0; i < moveHistory.length; i += 2) {
    const moveNumber = i / 2 + 1;
    const white = moveHistory[i];
    const black = moveHistory[i + 1];

    const li = document.createElement("li");

    const num = document.createElement("span");
    num.className = "move-num";
    num.textContent = `${moveNumber}.`;
    li.appendChild(num);

    li.appendChild(buildMoveEntry(white));
    if (black) li.appendChild(buildMoveEntry(black));

    moveHistoryListEl.appendChild(li);
  }
  moveHistoryListEl.scrollTop = moveHistoryListEl.scrollHeight;
}

function resetGameState() {
  game.reset();
  selectedSquare = null;
  legalTargets = [];
  lastMove = null;
  moveHistory = [];
  myColor = null;
  vsBot = false;
  roomCode = null;
}

leaveGameBtnEl.addEventListener("click", () => {
  if (!confirm("Bạn có chắc muốn rời khỏi ván đấu này?")) return;
  if (!vsBot && roomCode) {
    socket.emit("leave-room");
  }
  resetGameState();
  showScreen("menu");
});

// ---------- Chuyen man hinh ----------
const SCREENS = { menu: menuScreenEl, lobby: lobbyEl, tournament: tournamentEl, game: gameEl };
function showScreen(name) {
  for (const key in SCREENS) {
    SCREENS[key].classList.toggle("hidden", key !== name);
  }
}

modeFriendBtn.addEventListener("click", () => showScreen("lobby"));
modeTournamentBtn.addEventListener("click", () => showScreen("tournament"));
modeRobotBtn.addEventListener("click", () => startBotGame());

document.querySelectorAll("[data-back]").forEach((btn) => {
  btn.addEventListener("click", () => {
    if (tournamentCode) {
      socket.emit("leave-tournament");
      tournamentCode = null;
      isTournamentHost = false;
      tournamentInfoEl.classList.add("hidden");
      tournamentMessageEl.textContent = "";
      tournamentInputEl.value = "";
    }
    showScreen("menu");
  });
});

// ---------- Choi voi mot nguoi ban (phong ma) ----------

function joinRoom(code) {
  code = code.trim();
  if (!code) {
    lobbyMessageEl.textContent = "Vui lòng nhập mã phòng.";
    return;
  }
  roomCode = code;
  roomInputEl.value = code;
  vsBot = false;
  socket.emit("join-room", code);
}

joinBtnEl.addEventListener("click", () => joinRoom(roomInputEl.value));

copyLinkBtnEl.addEventListener("click", async () => {
  try {
    await navigator.clipboard.writeText(roomCode);
    copyLinkBtnEl.textContent = "Đã sao chép!";
    setTimeout(() => (copyLinkBtnEl.textContent = "Sao chép mã"), 1500);
  } catch {
    // Trinh duyet khong ho tro clipboard API -> bo qua, nguoi dung tu doc ma tren man hinh
  }
});

socket.on("join-error", (msg) => {
  lobbyMessageEl.textContent = msg;
  inviteBoxEl.classList.add("hidden");
});

socket.on("waiting-for-opponent", () => {
  lobbyMessageEl.textContent = "Đã vào phòng. Đang chờ đối thủ tham gia...";
  inviteCodeEl.textContent = roomCode;
  inviteBoxEl.classList.remove("hidden");
});

// ---------- Giai dau: ghep cap ngau nhien toi da 10 nguoi ----------

tournamentJoinBtnEl.addEventListener("click", () => {
  const code = tournamentInputEl.value.trim();
  if (!code) {
    tournamentMessageEl.textContent = "Vui lòng nhập mã giải đấu.";
    return;
  }
  tournamentCode = code;
  tournamentInputEl.value = code;
  socket.emit("join-tournament", code);
});

tournamentStartBtnEl.addEventListener("click", () => {
  socket.emit("start-tournament", tournamentCode);
});

socket.on("tournament-host", () => {
  isTournamentHost = true;
});

socket.on("tournament-update", ({ count }) => {
  tournamentMessageEl.textContent = "";
  tournamentInfoEl.classList.remove("hidden");
  tournamentCodeDisplayEl.textContent = tournamentCode;
  tournamentCountEl.textContent = `${count}/10 người đã vào`;

  if (isTournamentHost) {
    tournamentStartBtnEl.classList.remove("hidden");
    tournamentWaitMsgEl.textContent =
      count < 2
        ? "Cần ít nhất 2 người mới bắt đầu được."
        : "Bạn là chủ giải đấu — bấm nút để ghép cặp ngẫu nhiên khi mọi người đã vào đủ.";
  } else {
    tournamentStartBtnEl.classList.add("hidden");
    tournamentWaitMsgEl.textContent = "Đang chờ chủ giải đấu bắt đầu...";
  }
});

socket.on("tournament-error", (msg) => {
  tournamentMessageEl.textContent = msg;
  tournamentInfoEl.classList.add("hidden");
});

socket.on("tournament-bye", (msg) => {
  tournamentMessageEl.textContent = msg;
  tournamentInfoEl.classList.add("hidden");
});

// ---------- Choi voi may (AI cuc bo, khong can server) ----------

function startBotGame() {
  resetGameState();
  vsBot = true;
  myColor = "w";
  showScreen("game");
  renderBoard();
  renderMoveHistory();
  updateStatus();
}

function computeLocalStatus() {
  if (game.isCheckmate()) return "checkmate";
  if (game.isStalemate()) return "stalemate";
  if (game.isDraw()) return "draw";
  if (game.isCheck()) return "check";
  return "playing";
}

// Gia tri quan co de AI danh gia the co (khong tinh vua vi vua khong bao gio bi "an")
const PIECE_VALUE = { p: 100, n: 300, b: 300, r: 500, q: 900, k: 0 };
const BOT_SEARCH_DEPTH = 3; // so nuoc nhin truoc (bot -> doi thu -> bot)

function evaluateMaterial() {
  const board = game.board();
  let score = 0;
  for (const row of board) {
    for (const sq of row) {
      if (!sq) continue;
      score += sq.color === "w" ? PIECE_VALUE[sq.type] : -PIECE_VALUE[sq.type];
    }
  }
  return score; // duong = co loi cho Trang, am = co loi cho Den
}

// Minimax + cat tia alpha-beta: tim the co tot nhat sau khi tinh ca nuoc phan don cua doi thu,
// nho vay bot khong con "thi quan" mien phi nhu kieu chi nhin 1 nuoc cua chinh minh.
function minimax(depth, alpha, beta, maximizing) {
  if (depth === 0) return evaluateMaterial();
  if (game.isCheckmate()) return maximizing ? -100000 - depth : 100000 + depth;
  if (game.isDraw() || game.isStalemate()) return 0;

  const moves = game.moves({ verbose: true });

  if (maximizing) {
    let best = -Infinity;
    for (const m of moves) {
      game.move(m);
      best = Math.max(best, minimax(depth - 1, alpha, beta, false));
      game.undo();
      alpha = Math.max(alpha, best);
      if (beta <= alpha) break;
    }
    return best;
  } else {
    let best = Infinity;
    for (const m of moves) {
      game.move(m);
      best = Math.min(best, minimax(depth - 1, alpha, beta, true));
      game.undo();
      beta = Math.min(beta, best);
      if (beta <= alpha) break;
    }
    return best;
  }
}

function botPlayMove() {
  const moves = game.moves({ verbose: true });
  if (!moves.length) return;

  const botIsWhite = game.turn() === "w";
  let bestMove = moves[0];
  let bestScore = botIsWhite ? -Infinity : Infinity;

  for (const m of moves) {
    game.move(m);
    const score = minimax(BOT_SEARCH_DEPTH - 1, -Infinity, Infinity, !botIsWhite);
    game.undo();

    if (botIsWhite ? score > bestScore : score < bestScore) {
      bestScore = score;
      bestMove = m;
    }
  }

  const result = game.move(bestMove);
  lastMove = { from: bestMove.from, to: bestMove.to };
  moveHistory.push({ san: result.san, piece: result.piece, color: result.color });
  renderBoard();
  renderMoveHistory();
  updateStatus(computeLocalStatus());
}

// ---------- Su kien tran dau online (choi voi ban / giai dau) ----------

socket.on("joined", ({ color, roomCode: rc }) => {
  myColor = color;
  if (rc) roomCode = rc;
  vsBot = false;
});

socket.on("start-game", ({ fen }) => {
  game.load(fen);
  selectedSquare = null;
  legalTargets = [];
  lastMove = null;
  moveHistory = [];
  showScreen("game");
  renderBoard();
  renderMoveHistory();
  updateStatus();
});

socket.on("move-made", ({ fen, lastMove: lm, san, piece, color, status }) => {
  game.load(fen);
  lastMove = lm;
  selectedSquare = null;
  legalTargets = [];
  if (san) moveHistory.push({ san, piece, color });
  renderBoard();
  renderMoveHistory();
  updateStatus(status);
});

socket.on("invalid-move", (msg) => {
  statusEl.textContent = msg;
  setTimeout(() => updateStatus(), 1200);
});

socket.on("opponent-left", () => {
  statusEl.textContent = "Đối thủ đã rời phòng. Ván đấu kết thúc.";
  setTimeout(() => {
    alert("Đối thủ đã rời phòng. Bạn sẽ được đưa về sảnh để tạo phòng mới.");
    window.location.href = window.location.pathname; // ve sanh, xoa ?room= cu tren URL
  }, 300);
});

// ---------- Hien thi trang thai + ban co (dung chung cho moi che do) ----------

function updateStatus(status) {
  const turnText = game.turn() === "w" ? "Trắng" : "Đen";
  const meText = myColor === "w" ? "Trắng" : "Đen";
  let text = `Bạn là quân ${meText}. Lượt đi: ${turnText}.`;
  if (vsBot) text += " (Đối thủ: Máy)";

  if (status === "checkmate") {
    const winner = game.turn() === "w" ? "Đen" : "Trắng";
    text = `Chiếu hết! ${winner} thắng!`;
  } else if (status === "stalemate" || status === "draw") {
    text = "Hòa cờ!";
  } else if (status === "check") {
    text += " Đang bị chiếu tướng!";
  }

  statusEl.textContent = text;
}

// Tim o cua vua dang bi chieu (vua cua ben sap di, vi ho la nguoi dang bi chieu)
function findKingInCheckSquare() {
  if (!game.isCheck()) return null;
  const turnColor = game.turn();
  const files = ["a", "b", "c", "d", "e", "f", "g", "h"];
  for (const file of files) {
    for (let rank = 1; rank <= 8; rank++) {
      const sq = file + rank;
      const piece = game.get(sq);
      if (piece && piece.type === "k" && piece.color === turnColor) return sq;
    }
  }
  return null;
}

function renderBoard() {
  boardEl.innerHTML = "";

  const files = ["a", "b", "c", "d", "e", "f", "g", "h"];
  const ranks = ["8", "7", "6", "5", "4", "3", "2", "1"];
  const checkSquare = findKingInCheckSquare();

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
      if (square === checkSquare) {
        squareEl.classList.add("in-check");
      }

      // Nhan toa do: so hang o cot dau tien, chu cot o hang cuoi cung (kieu ban co chuan)
      if (file === orderedFiles[0]) {
        const rankLabel = document.createElement("span");
        rankLabel.className = "coord-label rank-label";
        rankLabel.textContent = rank;
        squareEl.appendChild(rankLabel);
      }
      if (rank === orderedRanks[orderedRanks.length - 1]) {
        const fileLabel = document.createElement("span");
        fileLabel.className = "coord-label file-label";
        fileLabel.textContent = file;
        squareEl.appendChild(fileLabel);
      }

      const piece = game.get(square);
      if (piece) {
        const pieceEl = document.createElement("img");
        pieceEl.className = "piece-img";
        pieceEl.src = pieceImageUrl(piece.color, piece.type);
        pieceEl.alt = `${piece.color === "w" ? "Trắng" : "Đen"} ${piece.type}`;
        pieceEl.draggable = false;
        squareEl.appendChild(pieceEl);
      }

      squareEl.addEventListener("click", () => onSquareClick(square));
      boardEl.appendChild(squareEl);
    }
  }
}

function onSquareClick(square) {
  if (!myColor || game.turn() !== myColor) return; // chua den luot minh (hoac may dang di) thi khong cho chon

  if (selectedSquare && legalTargets.includes(square)) {
    const piece = game.get(selectedSquare);
    const isPromotion = piece?.type === "p" && (square[1] === "8" || square[1] === "1");

    if (vsBot) {
      const result = game.move({ from: selectedSquare, to: square, promotion: isPromotion ? "q" : undefined });
      lastMove = { from: selectedSquare, to: square };
      moveHistory.push({ san: result.san, piece: result.piece, color: result.color });
      selectedSquare = null;
      legalTargets = [];
      renderBoard();
      renderMoveHistory();

      const status = computeLocalStatus();
      updateStatus(status);
      if (status === "playing" || status === "check") {
        setTimeout(botPlayMove, 500);
      }
    } else {
      socket.emit("move", {
        roomCode,
        from: selectedSquare,
        to: square,
        promotion: isPromotion ? "q" : undefined,
      });
      selectedSquare = null;
      legalTargets = [];
    }
    return;
  }

  const piece = game.get(square);
  if (piece && piece.color === myColor) {
    selectedSquare = square;
    legalTargets = game.moves({ square, verbose: true }).map((m) => m.to);
  } else {
    selectedSquare = null;
    legalTargets = [];
  }

  renderBoard();
}
