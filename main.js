// =======================================================
// RUCK AND PICK - 完全版 v4
// =======================================================
// Firebase & ターン交代完全同期 + 手札非公開仕様
// =======================================================

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.3/firebase-app.js";
import { getDatabase, ref, set, get, update, onValue } from "https://www.gstatic.com/firebasejs/10.12.3/firebase-database.js";

// === Firebase設定 ===
const firebaseConfig = {
  apiKey: "",
  authDomain: "",
  databaseURL: "",
  projectId: "",
  storageBucket: "",
  messagingSenderId: "",
  appId: "",
};
const app = initializeApp(firebaseConfig);
const db = getDatabase(app);

// =======================================================
// グローバル変数
// =======================================================
let playerId = null;
let enemyId = null;
let roomId = null;
let localState = {
  hand: [],
  hp: 4,
  item: null,
  usedItem: false,
  isShielded: false,
  doubleDamage: false,
  turnCount: 1,
};
let deck = [];

// =======================================================
// DOM要素取得
// =======================================================
const logBox = document.getElementById("log");
const createBtn = document.getElementById("createRoom");
const joinBtn = document.getElementById("joinRoom");
const roomInput = document.getElementById("roomInput");
const drawBtn = document.getElementById("drawCard");
const guessBtn = document.getElementById("guessBtn");
const guessArea = document.getElementById("guessArea");
const guessInput = document.getElementById("guessInput");
const turnInfo = document.getElementById("turnInfo");
const handArea = document.getElementById("handArea");
const itemBtn = document.getElementById("useItem");
const hpA = document.getElementById("hpA");
const hpB = document.getElementById("hpB");

// =======================================================
// ログ
// =======================================================
function log(msg) {
  logBox.value += msg + "\n";
  logBox.scrollTop = logBox.scrollHeight;
}

// =======================================================
// デッキ生成
// =======================================================
function generateDeck() {
  const arr = Array(10).fill("◯").concat(Array(10).fill("△")).concat(Array(10).fill("☓"));
  arr.push("ジョーカー");
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

// =======================================================
// ランダムアイテム
// =======================================================
function randomItem() {
  const items = ["2枚見る", "ダメージ無効", "ダメージ2倍", "宣言させる"];
  return items[Math.floor(Math.random() * items.length)];
}

// =======================================================
// ルーム作成
// =======================================================
createBtn.addEventListener("click", async () => {
  roomId = roomInput.value || "testroom";
  playerId = "A";
  enemyId = "B";
  deck = generateDeck();
  await set(ref(db, "rooms/" + roomId), {
    deckCount: deck.length,
    players: {
      A: { hp: 4, handCount: 0, item: randomItem(), usedItem: false, isShielded: false },
      B: { hp: 4, handCount: 0, item: randomItem(), usedItem: false, isShielded: false },
    },
    turn: "A",
    turnCount: 1,
    state: "draw",
    lastResult: null,
  });
  log("ルーム作成: " + roomId);
  syncRoom();
});

// =======================================================
// ルーム参加
// =======================================================
joinBtn.addEventListener("click", async () => {
  roomId = roomInput.value || "testroom";
  playerId = "B";
  enemyId = "A";
  const snap = await get(ref(db, "rooms/" + roomId));
  if (!snap.exists()) {
    alert("ルームが存在しません");
    return;
  }
  log("ルーム参加: " + roomId);
  syncRoom();
});

// =======================================================
// カードドロー
// =======================================================
drawBtn.addEventListener("click", async () => {
  const snap = await get(ref(db, "rooms/" + roomId));
  const room = snap.val();
  if (room.turn !== playerId || room.state !== "draw") return;

  const card = deck.shift();
  localState.hand.push(card);
  renderHand();

  await update(ref(db, "rooms/" + roomId), {
    deckCount: deck.length,
    ["players/" + playerId + "/handCount"]: localState.hand.length,
    state: "guess",
  });

  log("カードをドローしました（非公開）");
});

// =======================================================
// 予想
// =======================================================
guessBtn.addEventListener("click", async () => {
  const guess = guessInput.value.trim();
  const snap = await get(ref(db, "rooms/" + roomId));
  const room = snap.val();
  if (room.turn === playerId) return; // ピックが押すの防止

  // ピックの手札は非公開。予想はラック側だけで処理
  const enemyHand = localState.enemyHand || [];
  const hit = enemyHand.includes(guess);

  if (hit) {
    log("予想的中！エクストララウンドへ！");
    await update(ref(db, "rooms/" + roomId), { state: "extra", lastResult: "hit" });
  } else {
    log("予想失敗！ラックがダメージを受けた！");
    await applyDamage(room, playerId, 1);
    await endTurn(room);
  }
});

// =======================================================
// エクストララウンド終了後など共通ターン交代
// =======================================================
async function endTurn(room) {
  const next = room.turn === "A" ? "B" : "A";
  await update(ref(db, "rooms/" + roomId), {
    turn: next,
    state: "draw",
    turnCount: room.turnCount + 1,
  });
  log("ターン交代 → " + next + " がピックになります。");
}

// =======================================================
// ダメージ処理
// =======================================================
async function applyDamage(room, targetId, dmg) {
  const players = room.players;
  let actual = dmg;
  if (players[targetId].isShielded) {
    log("シールドでダメージ無効！");
    players[targetId].isShielded = false;
    actual = 0;
  }
  players[targetId].hp -= actual;
  if (players[targetId].hp < 0) players[targetId].hp = 0;
  await update(ref(db, "rooms/" + roomId + "/players/" + targetId), players[targetId]);
}

// =======================================================
// アイテム使用
// =======================================================
itemBtn.addEventListener("click", async () => {
  if (localState.usedItem) return log("アイテムは既に使用済みです");
  const snap = await get(ref(db, "rooms/" + roomId));
  const room = snap.val();
  const me = room.players[playerId];
  if (me.hp > 2) return log("体力2以下の時のみ使用可能");
  localState.usedItem = true;
  const item = me.item;
  log("アイテム使用: " + item);
  switch (item) {
    case "2枚見る":
      log("相手の手札を2枚覗いた！（非同期シミュレーション）");
      break;
    case "ダメージ無効":
      localState.isShielded = true;
      break;
    case "ダメージ2倍":
      localState.doubleDamage = true;
      break;
    case "宣言させる":
      log("相手に持っていないカードを宣言させる！（非同期シミュレーション）");
      break;
  }
});

// =======================================================
// カード表示
// =======================================================
function renderHand() {
  handArea.innerHTML = "";
  localState.hand.forEach((card) => {
    const img = document.createElement("img");
    img.src = `cards/${card}.png`;
    img.className = "card";
    handArea.appendChild(img);
  });
}

// =======================================================
// リアルタイム同期
// =======================================================
function syncRoom() {
  const roomRef = ref(db, "rooms/" + roomId);
  onValue(roomRef, (snap) => {
    const room = snap.val();
    if (!room) return;

    const me = room.players[playerId];
    const enemy = room.players[enemyId];

    hpA.textContent = room.players.A.hp;
    hpB.textContent = room.players.B.hp;

    turnInfo.textContent =
      room.turn === playerId
        ? "あなたのターン（ピック）"
        : "相手のターン（ラック）";

    if (room.turn === playerId && room.state === "draw") {
      drawBtn.style.display = "inline-block";
      guessArea.style.display = "none";
    } else if (room.turn !== playerId && room.state === "guess") {
      drawBtn.style.display = "none";
      guessArea.style.display = "block";
    } else {
      drawBtn.style.display = "none";
      guessArea.style.display = "none";
    }

    if (me.hp <= 0) {
      log("あなたの敗北…");
    } else if (enemy.hp <= 0) {
      log("あなたの勝利！");
    }
  });
}
