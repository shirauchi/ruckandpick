// ==============================
// Ruck & Pick 完全版 main.js
// ==============================
import { initializeApp } from "https://www.gstatic.com/firebasejs/9.23.0/firebase-app.js";
import { getDatabase, ref, set, get, update, onValue } from "https://www.gstatic.com/firebasejs/9.23.0/firebase-database.js";

// ===== Firebase 設定 =====
const firebaseConfig = {
  apiKey: "AIzaSyB4wWBozfQ2A-2IppWjIGlOYmajSKBtOtM",
  authDomain: "luckandpick.firebaseapp.com",
  databaseURL: "https://luckandpick-default-rtdb.asia-southeast1.firebasedatabase.app/",
  projectId: "luckandpick",
  storageBucket: "luckandpick.firebasestorage.app",
  messagingSenderId: "116413627559",
  appId: "1:116413627559:web:51cf6dbc64eb25c060ef82"
};

const app = initializeApp(firebaseConfig);
const db = getDatabase(app);

// ===== ゲーム用定数 =====
const CARD_TYPES = ["◯", "△", "☓"];
const CARD_IMAGES = {
  "◯": "cards/maru.png",
  "△": "cards/sankaku.png",
  "☓": "cards/batsu.png",
  "JOKER": "cards/joker.png",
};
const ITEM_IMAGES = {
  "see": "cards/item_see.png",
  "shield": "cards/item_shield.png",
  "double": "cards/item_double.png",
  "call": "cards/item_call.png",
};

let roomId, playerId, enemyId;
let localState = { hp: 4, hand: [], item: null, usedItem: false };

// ===== UI =====
const menu = document.getElementById("menu");
const game = document.getElementById("game");
const statusEl = document.getElementById("status");
const hpInfo = document.getElementById("hpInfo");
const turnInfo = document.getElementById("turnInfo");
const handArea = document.getElementById("handArea");
const guessArea = document.getElementById("guessArea");
const itemArea = document.getElementById("itemArea");
const drawBtn = document.getElementById("drawBtn");
const logEl = document.getElementById("log");

document.getElementById("createRoomBtn").addEventListener("click", createRoom);
document.getElementById("joinRoomBtn").addEventListener("click", joinRoom);
drawBtn.addEventListener("click", drawCards);

async function createRoom() {
  roomId = Math.random().toString(36).substring(2, 8);
  playerId = "A";
  enemyId = "B";
  const deck = createDeck();
  const roomRef = ref(db, "rooms/" + roomId);
  await set(roomRef, {
    deck,
    turn: "A",
    turnCount: 1,
    players: { A: { hp: 4, hand: [], item: randomItem(), usedItem: false } },
  });
  statusEl.textContent = `ルーム作成成功！ID: ${roomId}`;
  startGame();
}

async function joinRoom() {
  const id = document.getElementById("roomIdInput").value.trim();
  if (!id) return alert("ルームIDを入力してね！");
  roomId = id;
  playerId = "B";
  enemyId = "A";
  const roomRef = ref(db, "rooms/" + roomId);
  const snap = await get(roomRef);
  if (!snap.exists()) return alert("ルームが見つかりません");
  await update(roomRef, {
    "players/B": { hp: 4, hand: [], item: randomItem(), usedItem: false },
    state: "playing",
  });
  startGame();
}

function startGame() {
  menu.style.display = "none";
  game.style.display = "block";
  syncRoom();
}

function syncRoom() {
  const roomRef = ref(db, "rooms/" + roomId);
  onValue(roomRef, (snap) => {
    const room = snap.val();
    if (!room) return;
    const me = room.players[playerId];
    const enemy = room.players[enemyId];
    localState.hp = me.hp;
    localState.hand = me.hand || [];
    localState.item = me.item;
    localState.usedItem = me.usedItem;
    hpInfo.textContent = `あなたのHP: ${me.hp}　相手: ${enemy?.hp ?? "?"}`;
    turnInfo.textContent = room.turn === playerId ? "あなたのターン（ピック）" : "相手のターン（ラック）";
    if (room.turn === playerId) { drawBtn.style.display = "inline-block"; guessArea.style.display = "none"; }
    else { drawBtn.style.display = "none"; showGuessUI(room); }
    updateItemUI();
    updateHandUI();
  });
}

function createDeck() {
  const deck = []; for (let i = 0; i < 10; i++) deck.push("◯", "△", "☓");
  deck.push("JOKER"); shuffle(deck); return deck;
}
function shuffle(arr){for(let i=arr.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[arr[i],arr[j]]=[arr[j],arr[i]];}}

async function drawCards() {
  const roomRef = ref(db, "rooms/" + roomId);
  const snap = await get(roomRef); const room = snap.val(); if (!room) return;
  const deck = [...room.deck]; const hand = deck.splice(0, 3);
  await update(roomRef, { "players/"+playerId+"/hand": hand, deck });
  drawBtn.style.display = "none"; addLog(`カードをドロー: ${hand.join(", ")}`);
}

function showGuessUI(room) {
  guessArea.innerHTML = "";
  CARD_TYPES.forEach((type) => {
    const btn = document.createElement("img");
    btn.src = CARD_IMAGES[type]; btn.className = "card";
    btn.addEventListener("click", () => guessCard(type, room));
    guessArea.appendChild(btn);
  });
  guessArea.style.display = "flex";
}

async function guessCard(type, room) {
  const enemyHand = room.players[enemyId].hand || [];
  const correct = enemyHand.includes(type);
  const enemyHp = room.players[enemyId].hp;
  const myHp = room.players[playerId].hp;
  if (correct) {
    addLog(`的中！相手の手札に ${type} があった！`);
    await update(ref(db, "rooms/"+roomId+"/players/"+enemyId), { hp: enemyHp - 1 });
  } else {
    addLog(`外れ…あなたの体力が1減った`);
    await update(ref(db, "rooms/"+roomId+"/players/"+playerId), { hp: myHp - 1 });
  }
  await update(ref(db, "rooms/"+roomId), { turn: enemyId, turnCount: room.turnCount + 1 });
  guessArea.style.display = "none";
}

function randomItem(){const list=["see","shield","double","call"];return list[Math.floor(Math.random()*list.length)];}
function updateItemUI(){itemArea.innerHTML="";if(localState.hp<=2&&!localState.usedItem){const img=document.createElement("img");img.src=ITEM_IMAGES[localState.item];img.className="card";img.addEventListener("click",useItem);itemArea.appendChild(img);}}
function useItem(){addLog(`アイテム「${localState.item}」を使用！`);localState.usedItem=true;update(ref(db,`rooms/${roomId}/players/${playerId}`),{usedItem:true});}

function updateHandUI(){handArea.innerHTML="";localState.hand.forEach((c)=>{const img=document.createElement("img");img.src=CARD_IMAGES[c];img.className="card";handArea.appendChild(img);});}
function addLog(msg){logEl.textContent+=msg+"\n";}
