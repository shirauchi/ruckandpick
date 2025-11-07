// main.js — 全ゲームロジック（Firebase Realtime DB使用）
import { initializeApp } from "https://www.gstatic.com/firebasejs/11.0.1/firebase-app.js";
import {
  getDatabase,
  ref,
  set,
  update,
  get,
  onValue,
  runTransaction,
} from "https://www.gstatic.com/firebasejs/11.0.1/firebase-database.js";

/* ========================
   ここを君のFirebase設定に置き換えて！
   Realtime Database の databaseURL はコンソールから正確にコピペしてね
   ======================== */
const firebaseConfig = {
  apiKey: "AIzaSyB4wWBozfQ2A-2IppWjIGlOYmajSKBtOtM",
  authDomain: "luckandpick.firebaseapp.com",
  databaseURL: "https://luckandpick-default-rtdb.asia-southeast1.firebasedatabase.app/",
  projectId: "luckandpick",
  storageBucket: "luckandpick.firebasestorage.app",
  messagingSenderId: "116413627559",
  appId: "1:116413627559:web:51cf6dbc64eb25c060ef82"
};
/* ======================== */

const app = initializeApp(firebaseConfig);
const db = getDatabase(app);

/* -------------------------
   DOM
------------------------- */
const el = {
  roomInput: document.getElementById("roomInput"),
  btnCreate: document.getElementById("btnCreate"),
  btnJoin: document.getElementById("btnJoin"),
  btnDraw: document.getElementById("btnDraw"),
  btnPredict: document.getElementById("btnPredict"),
  btnExtra: document.getElementById("btnExtra"),
  btnJokerCall: document.getElementById("btnJokerCall"),
  btnUseItem: document.getElementById("btnUseItem"),
  btnReset: document.getElementById("btnReset"),
  roomIdText: document.getElementById("roomIdText"),
  roleText: document.getElementById("roleText"),
  pickHp: document.getElementById("pickHp"),
  rackHp: document.getElementById("rackHp"),
  pickHand: document.getElementById("pickHand"),
  topCard: document.getElementById("topCard"),
  turnText: document.getElementById("turnText"),
  stateText: document.getElementById("stateText"),
  itemText: document.getElementById("itemText"),
  logArea: document.getElementById("logArea"),
};

/* -------------------------
   ゲーム変数（クライアント側）
------------------------- */
let localRole = null; // "pick" or "rack"
let roomId = null;
let playerToken = Math.random().toString(36).slice(2, 9);

/* -------------------------
   ルール定義
------------------------- */
const INITIAL_HP = 4;
const deckBase = [...Array(10).fill("◯"), ...Array(10).fill("△"), ...Array(10).fill("☓")]; // ジョーカーは4ターン目に追加
const ITEMS = ["Peek2", "Shield1", "DoubleDamage", "ForceDeclare"];

/* -------------------------
   ヘルパー
------------------------- */
const shuffle = (a) => a.slice().sort(() => Math.random() - 0.5);
const now = () => new Date().toISOString();

function logPush(text) {
  const node = ref(db, `rooms/${roomId}/log`);
  runTransaction(node, (cur) => {
    cur = cur || [];
    cur.push(`[${now()}] ${text}`);
    if (cur.length > 300) cur.shift();
    return cur;
  });
}

/* -------------------------
   UI 更新 / DB 監視
------------------------- */
function bindUI() {
  el.btnCreate.addEventListener("click", createRoom);
  el.btnJoin.addEventListener("click", joinRoom);
  el.btnDraw.addEventListener("click", onDraw);
  el.btnPredict.addEventListener("click", onPredict);
  el.btnExtra.addEventListener("click", onExtra);
  el.btnJokerCall.addEventListener("click", onJokerCall);
  el.btnUseItem.addEventListener("click", onUseItem);
  el.btnReset.addEventListener("click", onResetGame);
}

bindUI();

let roomUnsub = null;

async function watchRoom(rid) {
  if (roomUnsub) roomUnsub(); // not real unsubscribe; onValue returns unsubscribe function—will set below
  roomId = rid;
  el.roomIdText.textContent = rid;
  const roomRef = ref(db, `rooms/${rid}`);
  roomUnsub = onValue(roomRef, (snap) => {
    const data = snap.val();
    if (!data) return;
    renderState(data);
  });
}

/* -------------------------
   レンダリング
------------------------- */
function renderState(data) {
  // roles
  el.turnText.textContent = data.turn;
  el.stateText.textContent = data.state;
  el.pickHp.textContent = data.pick.hp;
  el.rackHp.textContent = data.rack.hp;

  // hand: show pick's hand only if localRole === "pick" OR show reduced depending on rules
  el.pickHand.innerHTML = "";
  if (data.pick.hand && data.pick.hand.length) {
    const show = localRole === "pick";
    data.pick.hand.forEach((c, i) => {
      const d = document.createElement("div");
      d.className = "card";
      d.textContent = show ? c : "●";
      el.pickHand.appendChild(d);
    });
  }

  // top card visible to rack (if rack role seeing) — we still show it in UI always but spec says rack views it
  el.topCard.textContent = data.deck && data.deck.length ? data.deck[0] : "?";

  el.roleText.textContent = localRole || "（未参加）";

  // my item: find which slot I'm (pick or rack) — we store token to identify who is who
  const myItem = getMyItemText(data);
  el.itemText.textContent = myItem || "無し";

  // log
  const log = data.log || [];
  el.logArea.textContent = log.slice(-200).join("\n");

  // disable/enable UI based on state & role
  updateButtons(data);
}

function getMyItemText(data) {
  // data.players contains tokens: pickToken & rackToken
  if (!data.players) return null;
  const players = data.players;
  for (const k of Object.keys(players)) {
    if (players[k].token === playerToken) return players[k].item || "（使用済み）";
  }
  return null;
}

/* -------------------------
   ボタン状態更新
------------------------- */
function updateButtons(data) {
  // default disabled
  el.btnDraw.disabled = true;
  el.btnPredict.disabled = true;
  el.btnExtra.disabled = true;
  el.btnJokerCall.disabled = true;
  el.btnUseItem.disabled = true;

  // enable draw: only if I'm pick, state is 'draw', and pick has no hand yet
  if (localRole === "pick" && data.state === "draw") {
    el.btnDraw.disabled = false;
  }

  // enable predict: only if I'm rack and state is 'guess'
  if (localRole === "rack" && data.state === "guess") {
    el.btnPredict.disabled = false;
  }

  // enable extra: only if I'm rack and state is 'extra'
  if (localRole === "rack" && data.state === "extra") {
    el.btnExtra.disabled = false;
  }

  // Joker call: only if I'm pick and jokerEnabled is true and state allows (not mid-guess)
  if (localRole === "pick" && data.jokerEnabled && data.state !== "joker_call") {
    el.btnJokerCall.disabled = false;
  }

  // Use item: only if my token exists and I'm rack and hp<=2 and item unused
  const myPlayerKey = localRole === "pick" ? "pick" : localRole === "rack" ? "rack" : null;
  if (myPlayerKey && localRole === "rack" && data[stateKey(myPlayerKey + "HasItem")] !== undefined) {
    // fallback: we'll check via players
  }
  // Simple approach: enable if I'm rack and my item exists and hp<=2
  if (localRole === "rack") {
    const players = data.players || {};
    for (const k in players) {
      if (players[k].token === playerToken) {
        if (players[k].item && players[k].hp <= 2) el.btnUseItem.disabled = false;
      }
    }
  }
}

/* -------------------------
   ルーム作成 / 参加
------------------------- */
async function createRoom() {
  const rid = el.roomInput.value ? el.roomInput.value.trim() : Math.random().toString(36).slice(2, 8);
  // allocate deck & shuffle (joker not added yet)
  const deck = shuffle(deckBase);
  // give each player a random item
  const p1Item = ITEMS[Math.floor(Math.random() * ITEMS.length)];
  const p2Item = ITEMS[Math.floor(Math.random() * ITEMS.length)];
  const init = {
    turn: 1,
    state: "draw", // draw -> guess -> extra -> resolve -> draw
    deck,
    jokerEnabled: false,
    turnStartedAt: Date.now(),
    log: [],
    pick: { hp: INITIAL_HP, hand: [], role: "pick" },
    rack: { hp: INITIAL_HP, role: "rack" },
    players: {
      pick: { token: playerToken, item: p1Item, itemUsed: false, hp: INITIAL_HP },
      rack: { token: null, item: p2Item, itemUsed: false, hp: INITIAL_HP },
    },
  };
  await set(ref(db, `rooms/${rid}`), init);
  localRole = "pick";
  roomId = rid;
  watchRoom(rid);
  logPush(`ルーム作成: ${rid} （あなたはピック）`);
  alert(`ルーム作成しました。ID: ${rid}`);
}

async function joinRoom() {
  const rid = el.roomInput.value ? el.roomInput.value.trim() : prompt("参加するルームIDを入力");
  if (!rid) return;
  // set our token as rack player (if empty)
  const roomRef = ref(db, `rooms/${rid}`);
  const snap = await get(roomRef);
  if (!snap.exists()) return alert("そのルームは存在しません");
  const data = snap.val();

  // if rack already occupied, still allow (simple)
  await update(roomRef, {
    "players/rack/token": playerToken,
    "players/rack/hp": data.rack.hp,
  });

  localRole = "rack";
  roomId = rid;
  watchRoom(rid);
  logPush(`参加: ${playerToken} がラックとして参加`);
  alert(`ルーム参加しました。あなたはラックです。`);
}

/* -------------------------
   ゲームアクション
------------------------- */

// Pick draws 3
async function onDraw() {
  if (!roomId || localRole !== "pick") return alert("ピックでルームに参加してください");
  const roomRef = ref(db, `rooms/${roomId}`);
  const snap = await get(roomRef);
  const data = snap.val();
  if (!data) return alert("ルームが見つかりません");
  if (data.state !== "draw") return alert("現在ドローフェーズではありません");
  // draw 3 from deck
  let deck = data.deck || [];
  // if deck empty, shuffle (shouldn't happen), but handle gracefully
  if (deck.length < 3) {
    // deck insufficient; shuffle discard? For now, just allow whatever remains
  }
  const drawn = deck.slice(0, 3);
  const rest = deck.slice(3);
  // if turn >=4 and joker not enabled, enable and push joker into deck at start of turn 4
  let updates = {
    deck: rest,
    "pick/hand": drawn,
    state: "guess",
  };
  // If turn >=4 and jokerEnabled false, enable and push Joker into deck (at random position)
  if (data.turn >= 4 && !data.jokerEnabled) {
    // push joker into a random position in rest deck
    const restWithJ = rest.slice();
    const pos = Math.floor(Math.random() * (restWithJ.length + 1));
    restWithJ.splice(pos, 0, "J");
    updates.deck = restWithJ;
    updates.jokerEnabled = true;
    logPush("ジョーカーが山札に追加されました（turn>=4）");
  }

  await update(roomRef, updates);
  logPush(`ピックが3枚ドロー: ${drawn.join(", ")}`);
}

// Rack makes initial prediction (predict one of pick's hand). Before that, rack may view top card (we assume UI topCard shows deck[0])
async function onPredict() {
  if (!roomId || localRole !== "rack") return alert("ラックでルームに参加してください");
  const guess = prompt("ピックの手札のうち1枚の種類を予想してください（◯ / △ / ☓）");
  if (!["◯", "△", "☓"].includes(guess)) return alert("◯ / △ / ☓ のいずれかを入力してください");
  const roomRef = ref(db, `rooms/${roomId}`);
  const snap = await get(roomRef);
  const data = snap.val();
  if (!data || data.state !== "guess") return alert("現在予想フェーズではありません");
  const hand = data.pick.hand || [];
  // NOTE: top card was already visible in UI (data.deck[0]). Rack has seen it prior to guessing.
  // Evaluate: if guess is present in hand -> go to extra round; else rack loses 1 hp.
  const players = data.players || {};
  let rackHp = data.rack.hp;
  let pickHp = data.pick.hp;
  let updates = {};
  if (hand.includes(guess)) {
    // move to extra round: store initial guess and set state
    updates["pending/initialGuess"] = guess;
    updates.state = "extra";
    logPush(`ラックが初期予想を的中（${guess}）。エクストラへ移行`);
  } else {
    // miss: rack loses 1 (consider shield / doubleDamage)
    // handle shields/double damage via players flags
    const rackPlayer = players.rack || {};
    const pickPlayer = players.pick || {};
    let dmg = 1;
    // check if rack has shield active -> if shield exists as itemUsed false and item == Shield1? Our item model stores item and itemUsed. But Shield1 is used via onUseItem, which sets players.rack.shieldActive true. We implement shieldActive flag when using item. Check data.flags.shieldRack
    let double = data.flags && data.flags.doubleDamageActive;
    if (double) dmg *= 2;
    // check shield
    if (data.flags && data.flags.shieldRack) {
      // consume shield
      updates["flags/shieldRack"] = false;
      logPush("ラックの守護の印がダメージを無効化しました");
    } else {
      rackHp -= dmg;
      updates["rack/hp"] = rackHp;
      logPush(`ラックの予想が外れた：ラックに${dmg}ダメージ`);
    }
    // advance turn
    updates.state = "draw";
    updates.turn = (data.turn || 1) + 1;
    // clear pick.hand for next pick role?
    updates["pick/hand"] = []; // clear previous hand when swapping
  }
  // write updates
  await update(roomRef, updates);
  // final log already pushed
}

// Rack in extra round predicts the remaining 2 cards (order does not matter). Expectation: rack must specify two picks (each ◯△☓)
async function onExtra() {
  if (!roomId || localRole !== "rack") return alert("ラックでルームに参加してください");
  const p1 = prompt("エクストラ予想：残り2枚のうち1つ目（◯ / △ / ☓）");
  if (!["◯", "△", "☓"].includes(p1)) return alert("◯ / △ / ☓ のいずれかを入力");
  const p2 = prompt("エクストラ予想：残り2枚のうち2つ目（◯ / △ / ☓）");
  if (!["◯", "△", "☓"].includes(p2)) return alert("◯ / △ / ☓ のいずれかを入力");
  const roomRef = ref(db, `rooms/${roomId}`);
  const snap = await get(roomRef);
  const data = snap.val();
  if (!data || data.state !== "extra") return alert("現在エクストラフェーズではありません");
  const hand = (data.pick.hand || []).slice(); // original 3
  const initial = data.pending && data.pending.initialGuess;
  // compute remaining two actual cards (remove one occurrence of initial from hand)
  let copy = hand.slice();
  const idx = copy.indexOf(initial);
  if (idx >= 0) copy.splice(idx, 1); // remove one instance
  const remaining = copy; // length should be 2
  // Compare as multisets
  const preds = [p1, p2];
  const ok = multisetsEqual(preds, remaining);
  let updates = {};
  if (ok) {
    // pick takes damage 1 (apply doubleDamage and shield pick)
    let dmg = 1;
    if (data.flags && data.flags.doubleDamageActive) dmg *= 2;
    if (data.flags && data.flags.shieldPick) {
      updates["flags/shieldPick"] = false;
      logPush("ピックの守護の印がダメージを無効化しました");
    } else {
      updates["pick/hp"] = data.pick.hp - dmg;
      logPush(`エクストラ予想成功！ピックに${dmg}ダメージ`);
    }
  } else {
    logPush("エクストラ予想失敗。ダメージなし");
  }
  // Advance turn, swap roles
  updates.state = "draw";
  updates.turn = (data.turn || 1) + 1;
  updates["pick/hand"] = []; // clear hand for next pick turn
  updates["pending"] = null;
  // Clear doubleDamageActive after resolution
  updates["flags/doubleDamageActive"] = false;
  await update(roomRef, updates);
}

// Joker Call (pick initiates). Rack must guess whether pick has joker.
async function onJokerCall() {
  if (!roomId || localRole !== "pick") return alert("ピックのみ操作可能");
  const roomRef = ref(db, `rooms/${roomId}`);
  const snap = await get(roomRef);
  const data = snap.val();
  if (!data) return;
  if (!data.jokerEnabled) return alert("ジョーカーはまだ有効になっていません");
  // Ask rack to guess via prompt on rack side; here pick initiates call -> we set state to 'joker_call' and wait for rack to respond
  await update(roomRef, { state: "joker_call", jokerCallBy: "pick" });
  logPush("ピックがジョーカーコールを発動しました");
  // if pick has J in hand, forced earlier flow would have triggered; but if not, it's allowed
}

// When rack answers joker guess we must provide UI for rack to respond; but we didn't create a dedicated button — we will use onPredict path to handle it if state is 'joker_call'.
// To support that cleanly, implement a separate function for rack to answer joker guess:
async function onPredictJokerAnswer() {
  // Not used via UI; let's prompt when state==='joker_call' in onPredict function:
}

// Use item (rack only, hp<=2)
async function onUseItem() {
  if (!roomId || localRole !== "rack") return alert("アイテムはラックのみが使用できます");
  const roomRef = ref(db, `rooms/${roomId}`);
  const snap = await get(roomRef);
  const data = snap.val();
  if (!data) return;
  // find rack player object
  const players = data.players || {};
  let rackPlayerKey = null;
  for (const k in players) {
    if (players[k].token === playerToken) rackPlayerKey = k;
  }
  if (!rackPlayerKey) return alert("あなたのプレイヤーデータが見つかりません");
  const my = players[rackPlayerKey];
  if (!my.item) return alert("あなたのアイテムはありません、または既に使用済みです");
  if (my.hp > 2) return alert("アイテムは HP が 2 以下のときにのみ使用できます");
  const item = my.item;
  // perform item effect
  const roomRef2 = ref(db, `rooms/${roomId}`);
  if (item === "Peek2") {
    // reveal two cards from pick's hand to rack only — we implement by writing a short-lived flag 'revealToRack' that contains two cards
    const pickHand = data.pick.hand || [];
    const reveal = pickHand.slice(0, 2);
    await update(roomRef2, { "flags/revealToRack": reveal, ["players/" + rackPlayerKey + "/itemUsed"]: true });
    logPush("ラックが見透かしの瞳を使用：ピックの手札2枚を確認");
    alert(`ピックの手札2枚を確認: ${reveal.join(", ")}`);
  } else if (item === "Shield1") {
    // set flag to block one damage to rack
    await update(roomRef2, { "flags/shieldRack": true, ["players/" + rackPlayerKey + "/itemUsed"]: true });
    logPush("ラックが守護の印を使用：次の被ダメージを無効化します");
    alert("守護の印を使用しました（次の1ダメージを無効化）");
  } else if (item === "DoubleDamage") {
    await update(roomRef2, { "flags/doubleDamageActive": true, ["players/" + rackPlayerKey + "/itemUsed"]: true });
    logPush("ラックが共鳴の符を使用：このターンのダメージは2倍になります");
    alert("共鳴の符を使用しました（今ターンのダメージが2倍）");
  } else if (item === "ForceDeclare") {
    // Force pick to declare a type (we set a pending flag); pick will be prompted to declare via UI
    await update(roomRef2, { "pending/forceDeclare": true, ["players/" + rackPlayerKey + "/itemUsed"]: true });
    logPush("ラックが真偽の声を使用：ピックに持っていないカードの種類を宣言させます");
    alert("ピックに宣言させる効果を発動しました（ピックは宣言してください）");
  }
}

/* -------------------------
   Reset / New Game but same room
------------------------- */
async function onResetGame() {
  if (!roomId) return alert("まずルームを作成または参加してください");
  if (!confirm("同ルームで新規ゲームを開始しますか？（既存データが上書きされます）")) return;
  // reinitialize deck and players keeping tokens (so roles remain)
  const roomRef = ref(db, `rooms/${roomId}`);
  const snap = await get(roomRef);
  if (!snap.exists()) return alert("room not found");
  const data = snap.val();
  // preserve tokens if present
  const pickToken = data.players && data.players.pick && data.players.pick.token ? data.players.pick.token : (localRole === "pick" ? playerToken : null);
  const rackToken = data.players && data.players.rack && data.players.rack.token ? data.players.rack.token : (localRole === "rack" ? playerToken : null);
  const p1Item = ITEMS[Math.floor(Math.random() * ITEMS.length)];
  const p2Item = ITEMS[Math.floor(Math.random() * ITEMS.length)];
  const deck = shuffle(deckBase);
  const resetObj = {
    turn: 1,
    state: "draw",
    deck,
    jokerEnabled: false,
    turnStartedAt: Date.now(),
    log: [],
    pick: { hp: INITIAL_HP, hand: [], role: "pick" },
    rack: { hp: INITIAL_HP, role: "rack" },
    players: {
      pick: { token: pickToken, item: p1Item, itemUsed: false, hp: INITIAL_HP },
      rack: { token: rackToken, item: p2Item, itemUsed: false, hp: INITIAL_HP },
    },
    flags: {},
    pending: null,
  };
  await set(roomRef, resetObj);
  logPush("新しいゲームを開始しました（同ルーム）");
  alert("新規ゲームを開始しました");
}

/* -------------------------
   Utility functions
------------------------- */
function multisetsEqual(a, b) {
  // treat arrays as multisets
  if (!Array.isArray(a) || !Array.isArray(b)) return false;
  if (a.length !== b.length) return false;
  const m = {};
  a.forEach((x) => (m[x] = (m[x] || 0) + 1));
  b.forEach((x) => (m[x] = (m[x] || 0) - 1));
  return Object.values(m).every((v) => v === 0);
}

/* -------------------------
   Listen to certain state changes to prompt user actions
   (e.g., when pending.forceDeclare true -> if I'm pick prompt to declare)
------------------------- */
onValue(ref(db), (snap) => {
  // not used globally
});

// Short watcher to detect pending flags and prompt local user accordingly
async function localWatcher() {
  if (!roomId) return;
  const snap = await get(ref(db, `rooms/${roomId}`));
  const data = snap.val();
  if (!data) return;
  // If pending.forceDeclare and I'm pick -> prompt to declare
  if (data.pending && data.pending.forceDeclare && localRole === "pick") {
    // pick must declare a type (◯/△/☓). If pick declares a type they don't have, pick takes 1 damage
    const decl = prompt("ラックに宣言させられました。あなたは「持っていないカードの種類」を宣言してください（◯ / △ / ☓）");
    if (!["◯", "△", "☓"].includes(decl)) {
      alert("◯/△/☓ のいずれかを入力してください。処理を中止します。");
      return;
    }
    // evaluate: if pick has zero of that type -> pick takes 1 damage
    const hand = data.pick.hand || [];
    const count = hand.filter((x) => x === decl).length;
    const roomRef = ref(db, `rooms/${roomId}`);
    let updates = { "pending/forceDeclare": null };
    if (count === 0) {
      // pick takes damage (consider shield/double)
      let dmg = 1;
      if (data.flags && data.flags.doubleDamageActive) dmg *= 2;
      if (data.flags && data.flags.shieldPick) {
        updates["flags/shieldPick"] = false;
        logPush("ピックの守護の印がダメージを無効化しました");
      } else {
        updates["pick/hp"] = (data.pick.hp || INITIAL_HP) - dmg;
        logPush(`ピックが宣言した${decl}は手札に無かったためピックに${dmg}ダメージ`);
      }
    } else {
      logPush(`ピックが宣言した${decl}は手札に存在したため効果なし`);
    }
    // clear pending.forceDeclare and advance turn
    updates.state = "draw";
    updates.turn = (data.turn || 1) + 1;
    updates["pick/hand"] = [];
    await update(roomRef, updates);
  }

  // If state == 'joker_call' and localRole == 'rack' -> prompt to guess has/not_has
  if (data.state === "joker_call" && localRole === "rack") {
    const ans = prompt("ジョーカーコール：ピックがジョーカーを所持していると思いますか？ yes / no");
    if (!ans) return;
    const guessHas = ans.toLowerCase().startsWith("y");
    // evaluate actual
    const hand = data.pick.hand || [];
    const actualHas = hand.includes("J");
    const roomRef = ref(db, `rooms/${roomId}`);
    let updates = { state: "draw", turn: (data.turn || 1) + 1, "pick/hand": [] };
    // damage resolution: if rack guessed correctly -> pick takes 1; else rack takes 1
    let dmg = 1;
    if (data.flags && data.flags.doubleDamageActive) dmg *= 2;
    if (guessHas === actualHas) {
      // rack correct -> pick takes dmg (consider shieldPick)
      if (data.flags && data.flags.shieldPick) {
        updates["flags/shieldPick"] = false;
        logPush("ピックの守護の印がジョーカーコールダメージを無効化しました");
      } else {
        updates["pick/hp"] = (data.pick.hp || INITIAL_HP) - dmg;
        logPush(`ジョーカーコール: ラックの予想的中。ピックに${dmg}ダメージ`);
      }
    } else {
      // rack wrong -> rack takes dmg (consider shieldRack)
      if (data.flags && data.flags.shieldRack) {
        updates["flags/shieldRack"] = false;
        logPush("ラックの守護の印がジョーカーコールダメージを無効化しました");
      } else {
        updates["rack/hp"] = (data.rack.hp || INITIAL_HP) - dmg;
        logPush(`ジョーカーコール: ラックの予想外れ。ラックに${dmg}ダメージ`);
      }
    }
    await update(roomRef, updates);
  }

  // If pick drew and hand contains 'J' -> forced joker_call: if localRole pick we prompt? But forced handled at draw time: our draw function inserts J into deck only; forced if drawn J we should set state=joker_call on draw. For safety, if state== 'drawn_forced_joker' handle.
  // schedule next local check
  setTimeout(localWatcher, 800);
}

// Start local watcher loop if room present
setInterval(() => {
  if (roomId) localWatcher();
}, 1200);

/* -------------------------
   Start
------------------------- */
// Export functions for non-module consumers (safety)
window.createRoom = createRoom;
window.joinRoom = joinRoom;
window.onDraw = onDraw;
window.onPredict = onPredict;
window.onExtra = onExtra;
window.onJokerCall = onJokerCall;
window.onUseItem = onUseItem;
window.onResetGame = onResetGame;

/* Small helper on start: if user loads page and wants to auto-fill last room id from URL hash */
(function initFromHash() {
  bindUI(); // already bound, but safe
  const h = location.hash && location.hash.slice(1);
  if (h) {
    el.roomInput.value = h;
  }
})();


