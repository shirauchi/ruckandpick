import { initializeApp } from "https://www.gstatic.com/firebasejs/11.0.1/firebase-app.js";
import {
  getDatabase,
  ref,
  set,
  update,
  get,
} from "https://www.gstatic.com/firebasejs/11.0.1/firebase-database.js";

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

let playerRole = null; // "pick" or "rack"
let roomId = null;

const statusEl = document.getElementById("status");

// カードデータ（ジョーカー除外）
const deckBase = [
  ...Array(10).fill("◯"),
  ...Array(10).fill("△"),
  ...Array(10).fill("☓"),
];

// シャッフル関数
const shuffle = (arr) => arr.sort(() => Math.random() - 0.5);

// ルーム作成
window.createRoom = async () => {
  const id = Math.random().toString(36).substring(2, 8);
  const deck = shuffle([...deckBase]);
  await set(ref(db, "rooms/" + id), {
    turn: 1,
    deck,
    pick: { hp: 4, hand: [], role: "pick" },
    rack: { hp: 4, role: "rack" },
    state: "draw", // draw / guess / resolve
  });
  playerRole = "pick";
  roomId = id;
  updateStatus(`ルーム作成完了！ID: ${id}\nあなたはピックです。`);
};

// ルーム参加
window.joinRoom = async () => {
  const id = prompt("ルームIDを入力");
  roomId = id;
  playerRole = "rack";
  updateStatus(`ルーム参加！ID: ${id}\nあなたはラックです。`);
};

// ピックのドロー
window.drawCards = async () => {
  if (playerRole !== "pick") return alert("ピックのみ操作可能");
  const roomRef = ref(db, "rooms/" + roomId);
  const snap = await get(roomRef);
  const data = snap.val();

  const drawn = data.deck.slice(0, 3);
  const restDeck = data.deck.slice(3);

  await update(roomRef, {
    deck: restDeck,
    "pick/hand": drawn,
    state: "guess",
  });

  updateStatus(`ドロー完了\nあなたの手札: ${drawn.join(", ")}`);
};

// ラックの推測
window.guessCard = async () => {
  if (playerRole !== "rack") return alert("ラックのみ操作可能");
  const guess = prompt("相手の手札の中から ◯ / △ / ☓ を予想");
  if (!["◯", "△", "☓]()

window.createRoom = createRoom;
window.joinRoom = joinRoom;
