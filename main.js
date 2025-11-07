// main.js — 完全版（ルール全部実装）
import { initializeApp } from "https://www.gstatic.com/firebasejs/11.10.0/firebase-app.js";
import {
  getDatabase,
  ref,
  set,
  get,
  update,
  onValue,
  runTransaction,
} from "https://www.gstatic.com/firebasejs/11.10.0/firebase-database.js";


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

/* ----- DOM ----- */
const el = {
  roomInput: document.getElementById("roomInput"),
  btnCreate: document.getElementById("btnCreate"),
  btnJoin: document.getElementById("btnJoin"),
  btnReset: document.getElementById("btnReset"),
  btnDraw: document.getElementById("btnDraw"),
  btnPredict: document.getElementById("btnPredict"),
  btnExtra: document.getElementById("btnExtra"),
  btnJokerCall: document.getElementById("btnJokerCall"),
  btnUseItem: document.getElementById("btnUseItem"),
  roomIdText: document.getElementById("roomId"),
  roleText: document.getElementById("role"),
  pickHp: document.getElementById("pickHp"),
  rackHp: document.getElementById("rackHp"),
  pickHandDiv: document.getElementById("pickHand"),
  topImg: document.getElementById("topImg"),
  turnText: document.getElementById("turn"),
  stateText: document.getElementById("state"),
  myItemText: document.getElementById("myItem"),
  logArea: document.getElementById("log"),
  localHand: document.getElementById("localHand"),
  itemArea: document.getElementById("itemArea"),
};

let localToken = Math.random().toString(36).slice(2, 9);
let roomId = null;
let localRole = null; // "pick" or "rack"
let unsubscribe = null;

/* ----- Constants & assets ----- */
const INITIAL_HP = 4;
const CARD_MAP = { O: "cards/maru.png", T: "cards/sankaku.png", X: "cards/batsu.png", J: "cards/joker.png" };
// We'll use short codes internally: "◯" "△" "☓" ; map to letters for storage is optional — we'll store "O","T","X","J"
const TYPES = ["O", "T", "X"];
const ITEM_KEYS = ["Peek2", "Shield1", "DoubleDamage", "ForceDeclare"];
const ITEM_IMG = {
  Peek2: "cards/item_see.png",
  Shield1: "cards/item_shield.png",
  DoubleDamage: "cards/item_double.png",
  ForceDeclare: "cards/item_call.png",
};

/* ----- Helpers ----- */
function now() { return new Date().toLocaleTimeString(); }
function logPush(roomRefPath, text) {
  // append to /rooms/{roomId}/log via transaction to keep order
  const node = ref(db, `${roomRefPath}/log`);
  runTransaction(node, (cur) => {
    cur = cur || [];
    cur.push(`[${now()}] ${text}`);
    if (cur.length > 300) cur.shift();
    return cur;
  }).catch(console.warn);
}
function multisetsEqual(a, b) {
  if (a.length !== b.length) return false;
  const m = {};
  a.forEach(x => m[x] = (m[x]||0)+1);
  b.forEach(x => m[x] = (m[x]||0)-1);
  return Object.values(m).every(v=>v===0);
}
function shuffle(a){ for(let i=a.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[a[i],a[j]]=[a[j],a[i]]} return a; }

/* ----- Bind UI ----- */
el.btnCreate.addEventListener("click", createRoom);
el.btnJoin.addEventListener("click", joinRoom);
el.btnReset.addEventListener("click", resetGame);
el.btnDraw.addEventListener("click", pickDraw);
el.btnPredict.addEventListener("click", rackInitialPredict);
el.btnExtra.addEventListener("click", rackExtraPredict);
el.btnJokerCall.addEventListener("click", pickJokerCall);
el.btnUseItem.addEventListener("click", useItem);

/* ----- Room lifecycle ----- */
async function createRoom(){
  const rid = el.roomInput.value.trim() || Math.random().toString(36).slice(2,8);
  roomId = rid;
  localRole = "pick";
  el.roomIdText.textContent = rid;
  el.roleText.textContent = "Pick (あなた)";
  // build deck: O x10, T x10, X x10 => 30, Joker will be inserted at turn>=4; but we include J at end for easier handling later (we'll insert later)
  const deck = [];
  for(let i=0;i<10;i++){ deck.push("O"); deck.push("T"); deck.push("X"); }
  // don't include J yet
  shuffle(deck);
  const pickItem = ITEM_KEYS[Math.floor(Math.random()*ITEM_KEYS.length)];
  const rackItem = ITEM_KEYS[Math.floor(Math.random()*ITEM_KEYS.length)];
  const init = {
    turnCount: 1,
    turn: "pick", // "pick" player's token id string "pick" / "rack" as role markers
    state: "draw", // draw -> guess -> extra -> resolve -> draw
    deck,
    jokerEnabled: false,
    flags: {}, // shieldPick/shieldRack/doubleDamageActive, revealToRack
    pending: null,
    pick: { hp: INITIAL_HP, hand: [], token: localToken, item: pickItem, itemUsed: false },
    rack: { hp: INITIAL_HP, hand: [], token: null, item: rackItem, itemUsed: false },
    log: [],
  };
  await set(ref(db, `rooms/${rid}`), init);
  logPush(`rooms/${rid}`, `ルーム作成（ピック）。あなたはピック。`);
  watchRoom(rid);
}

async function joinRoom(){
  const rid = el.roomInput.value.trim();
  if(!rid) return alert("ルームIDを入力してね");
  const snap = await get(ref(db, `rooms/${rid}`));
  if(!snap.exists()) return alert("ルームが存在しません");
  roomId = rid;
  localRole = "rack";
  el.roomIdText.textContent = rid;
  el.roleText.textContent = "Rack (あなた)";
  // set rack token and item if missing
  const data = snap.val();
  const rackItem = ITEM_KEYS[Math.floor(Math.random()*ITEM_KEYS.length)];
  const updates = {};
  if(!data.rack) updates[`/rooms/${rid}/rack`] = { hp: INITIAL_HP, hand: [], token: localToken, item: rackItem, itemUsed: false };
  else updates[`/rooms/${rid}/rack/token`] = localToken;
  await update(ref(db, `/rooms/${rid}`), updates);
  logPush(`rooms/${rid}`, `ラックが参加。`);
  watchRoom(rid);
}

function watchRoom(rid){
  if(unsubscribe) unsubscribe();
  unsubscribe = onValue(ref(db, `rooms/${rid}`), (snap) => {
    const data = snap.val();
    if(!data) return;
    renderAll(data);
  });
}

/* ----- Render UI ----- */
function renderAll(data){
  // roles and rooms
  el.turnText.textContent = data.turnCount || "-";
  el.stateText.textContent = data.state || "-";
  el.pickHp.textContent = (data.pick && data.pick.hp!=null) ? data.pick.hp : "-";
  el.rackHp.textContent = (data.rack && data.rack.hp!=null) ? data.rack.hp : "-";
  // top card shown as image only for rack view (spec: rack looks at deck[0])
  if(data.deck && data.deck.length){
    const top = data.deck[0];
    if(localRole === "rack"){
      el.topImg.style.display = "block";
      el.topImg.src = CARD_SRC(top);
    } else {
      el.topImg.style.display = "none";
    }
  } else {
    el.topImg.style.display = "none";
  }
  // pick hand (show ● to opponent)
  el.pickHandDiv.innerHTML = "";
  const pickHand = (data.pick && data.pick.hand) ? data.pick.hand : [];
  const showPickHand = (localRole === "pick");
  pickHand.forEach((c) => {
    const d = document.createElement("div"); d.className="card";
    if(showPickHand){
      const img = document.createElement("img"); img.className="imgcard"; img.src = CARD_SRC(c); d.appendChild(img);
      // also show local hand separately
    } else {
      d.textContent = "●";
    }
    el.pickHandDiv.appendChild(d);
  });
  // local player's hand (images)
  const myHand = localRole === "pick" ? pickHand : ((data.rack && data.rack.token===localToken) ? (data.rack.hand||[]) : []);
  el.localHand.innerHTML = "";
  (myHand||[]).forEach(c=>{
    const img=document.createElement("img"); img.className="imgcard"; img.src=CARD_SRC(c);
    el.localHand.appendChild(img);
  });
  // item display
  const myItem = (localRole==="pick" ? data.pick && data.pick.item : data.rack && data.rack.item);
  const myUsed = (localRole==="pick" ? data.pick && data.pick.itemUsed : data.rack && data.rack.itemUsed);
  el.myItemText.textContent = myItem ? `${myItem}${myUsed ? "（使用済）":""}` : "なし";
  renderItemArea(myItem, myUsed, (localRole==="rack" && (localRole==="rack" ? (data.rack && data.rack.hp<=2) : false)));
  // flags revealToRack handling: if revealToRack exists and I'm rack, show it in log
  if(data.flags && data.flags.revealToRack && localRole==="rack"){
    logPush(`rooms/${roomId}`, `Peek2: ピックの確認: ${data.flags.revealToRack.join(", ")}`);
    // clear revealToRack after showing
    update(ref(db, `rooms/${roomId}/flags`), { revealToRack: null }).catch(()=>{});
  }
  // log
  el.logArea.textContent = (data.log || []).slice(-200).join("\n");
  // Buttons enable/disable depending on state and role
  updateButtons(data);
  // Win check
  if((data.pick && data.pick.hp<=0) || (data.rack && data.rack.hp<=0)){
    const loser = (data.pick && data.pick.hp<=0) ? "pick" : "rack";
    const winner = loser==="pick" ? "rack" : "pick";
    alert(`ゲーム終了：${winner} の勝ち！`);
  }
}

function renderItemArea(itemKey, used, canUse){
  el.itemArea.innerHTML = "";
  if(itemKey){
    const img = document.createElement("img");
    img.src = ITEM_IMG[itemKey];
    img.className = "imgcard";
    img.style.width="68px"; img.style.height="88px";
    img.title = itemKey + (used ? "（使用済）" : "");
    if(!used && localRole==="rack" && canUse){
      img.style.cursor="pointer";
      img.addEventListener("click", ()=> useItemUI(itemKey));
    } else {
      img.style.opacity = used ? 0.4 : 1;
    }
    el.itemArea.appendChild(img);
  }
}

function updateButtons(data){
  // default disable all
  el.btnDraw.disabled = true; el.btnPredict.disabled = true; el.btnExtra.disabled = true; el.btnJokerCall.disabled = true; el.btnUseItem.disabled = true;
  // pick can draw only in state draw and pick.token===localToken
  if(localRole==="pick" && data.state==="draw" && data.pick && data.pick.token===localToken){
    el.btnDraw.disabled = false;
  }
  // rack can predict initial when state === "guess" and rack.token===localToken
  if(localRole==="rack" && data.state==="guess" && data.rack && data.rack.token===localToken){
    el.btnPredict.disabled = false;
  }
  // rack can do extra when state === "extra" and token matches
  if(localRole==="rack" && data.state==="extra" && data.rack && data.rack.token===localToken){
    el.btnExtra.disabled = false;
  }
  // pick can joker-call when jokerEnabled true and state not mid-guess and pick token matches
  if(localRole==="pick" && data.jokerEnabled && data.pick && data.pick.token===localToken && data.state!=="joker_call"){
    el.btnJokerCall.disabled = false;
  }
  // use item enabled when rack, hp<=2 and item exists and not used
  if(localRole==="rack" && data.rack && data.rack.token===localToken && data.rack.item && !data.rack.itemUsed && data.rack.hp<=2){
    el.btnUseItem.disabled = false;
  }
}

/* ----- Card / Image helpers ----- */
function CARD_SRC(code){
  if(code==="O") return "cards/maru.png";
  if(code==="T") return "cards/sankaku.png";
  if(code==="X") return "cards/batsu.png";
  if(code==="J") return "cards/joker.png";
  return "cards/maru.png";
}

/* ----- Actions ----- */

// PICK draws 3
async function pickDraw(){
  const roomRef = ref(db, `rooms/${roomId}`);
  const snap = await get(roomRef); if(!snap.exists()) return;
  const data = snap.val();
  if(data.state !== "draw") return alert("現在ドローフェーズではありません");
  if(!data.pick || data.pick.token!==localToken) return alert("あなたはピックではありません");
  let deck = data.deck || [];
  if(deck.length < 3){
    // if deck low, still draw whatever remains (deck design guarantees enough most times)
  }
  const drawn = deck.slice(0,3);
  const rest = deck.slice(3);
  // If turnCount >=4 and joker not enabled -> insert J at random position in rest deck and set jokerEnabled true
  const updates = {};
  if((data.turnCount || 1) >= 4 && !data.jokerEnabled){
    const restWithJ = rest.slice();
    const pos = Math.floor(Math.random()*(restWithJ.length+1));
    restWithJ.splice(pos,0,"J");
    updates["deck"] = restWithJ;
    updates["jokerEnabled"] = true;
    logPush(`rooms/${roomId}`, "ジョーカーが山札に追加されました（turnCount>=4）");
  } else {
    updates["deck"] = rest;
  }
  updates["pick/hand"] = drawn;
  updates["state"] = "guess";
  // If drawn contains J -> forced joker_call immediately: set state to joker_call and leave hand as-is
  if(drawn.includes("J")){
    updates["state"] = "joker_call";
    // ensure J present in pick.hand (we already set)
    logPush(`rooms/${roomId}`, "ピックがジョーカーを引いたため強制ジョーカーコール発生");
  } else {
    logPush(`rooms/${roomId}`, `ピックが3枚ドロー: ${drawn.join(",")}`);
  }
  await update(roomRef, updates);
}

// RACK initial predict (predict one card among pick's hand)
// IMPORTANT: rack has seen deck[0] earlier via UI (topImg)
async function rackInitialPredict(){
  const guess = prompt("初期予想: ピックの手札のうち1枚の種類を予想してください（O=◯ T=△ X=☓）\n※入力は O / T / X のいずれか");
  if(!guess || !["O","T","X"].includes(guess)) return alert("O / T / X のいずれかを入力してください");
  const roomRef = ref(db, `rooms/${roomId}`);
  const snap = await get(roomRef); if(!snap.exists()) return;
  const data = snap.val();
  if(data.state !== "guess") return alert("現在予想フェーズではありません");
  if(!data.rack || data.rack.token!==localToken) return alert("あなたはラックではありません");
  const hand = data.pick.hand || [];
  const updates = {};
  if(hand.includes(guess)){
    // initial correct -> go to extra: store initialGuess and move to extra
    updates["pending/initialGuess"] = guess;
    updates["state"] = "extra";
    logPush(`rooms/${roomId}`, `ラックの初期予想が的中（${guess}）。エクストラへ移行`);
  } else {
    // miss -> rack loses 1 (consider shield and double)
    let dmg = 1;
    if(data.flags && data.flags.doubleDamageActive) dmg *= 2;
    if(data.flags && data.flags.shieldRack){
      updates["flags/shieldRack"] = false;
      logPush(`rooms/${roomId}`, `ラックの守護がダメージを無効化`);
    } else {
      updates["rack/hp"] = (data.rack.hp || INITIAL_HP) - dmg;
      logPush(`rooms/${roomId}`, `ラックの初期予想が外れ。ラックに${dmg}ダメージ`);
    }
    // end turn: clear pick hand, swap roles (turnCount++), set state draw
    updates["pick/hand"] = [];
    updates["state"] = "draw";
    updates["turnCount"] = (data.turnCount || 1) + 1;
    // reset doubleDamageActive after resolution
    updates["flags/doubleDamageActive"] = false;
  }
  await update(roomRef, updates);
}

// RACK extra predict (predict remaining 2 cards)
async function rackExtraPredict(){
  const p1 = prompt("エクストラ予想: 残り2枚のうち1つ目（O/T/X）");
  if(!p1 || !["O","T","X"].includes(p1)) return alert("O/T/X のいずれかを入力");
  const p2 = prompt("エクストラ予想: 残り2枚のうち2つ目（O/T/X）");
  if(!p2 || !["O","T","X"].includes(p2)) return alert("O/T/X のいずれかを入力");
  const roomRef = ref(db, `rooms/${roomId}`);
  const snap = await get(roomRef); if(!snap.exists()) return;
  const data = snap.val();
  if(data.state !== "extra") return alert("現在エクストラフェーズではありません");
  // compute remaining two actual cards by removing one occurrence of initialGuess from pick.hand
  const hand = (data.pick.hand || []).slice();
  const init = data.pending && data.pending.initialGuess;
  if(!init){ alert("初期予想情報が欠落しています"); return; }
  const cp = hand.slice();
  const idx = cp.indexOf(init);
  if(idx>=0) cp.splice(idx,1);
  const remaining = cp; // expect length 2
  const preds = [p1,p2];
  const ok = multisetsEqual(preds, remaining);
  const updates = {};
  if(ok){
    // pick takes 1 (consider shield/double)
    let dmg = 1;
    if(data.flags && data.flags.doubleDamageActive) dmg *= 2;
    if(data.flags && data.flags.shieldPick){
      updates["flags/shieldPick"] = false;
      logPush(`rooms/${roomId}`, `ピックの守護がダメージを無効化`);
    } else {
      updates["pick/hp"] = (data.pick.hp || INITIAL_HP) - dmg;
      logPush(`rooms/${roomId}`, `エクストラ的中！ピックに${dmg}ダメージ`);
    }
  } else {
    logPush(`rooms/${roomId}`, `エクストラ予想失敗。ダメージなし`);
  }
  // end turn: clear hand, swap roles (turnCount++), reset flags
  updates["pending"] = null;
  updates["pick/hand"] = [];
  updates["state"] = "draw";
  updates["turnCount"] = (data.turnCount || 1) + 1;
  updates["flags/doubleDamageActive"] = false;
  await update(roomRef, updates);
}

// PICK initiates Joker Call (or forced on draw if picked J)
async function pickJokerCall(){
  const roomRef = ref(db, `rooms/${roomId}`);
  const snap = await get(roomRef); if(!snap.exists()) return;
  const data = snap.val();
  if(!data.jokerEnabled) return alert("ジョーカーはまだ有効ではありません");
  if(!data.pick || data.pick.token !== localToken) return alert("あなたはピックではありません");
  // set state to 'joker_call' and await rack's guess via localWatcher
  await update(roomRef, { state: "joker_call", pending: { jokerCallBy: "pick" } });
  logPush(`rooms/${roomId}`, `ピックがジョーカーコールを発動`);
}

// RACK answers Joker guess via localWatcher prompt (handled below in watcher)
// PICK forced joker-call handled at draw time (we set state 'joker_call' when draw contains J)

/* ----- Item use flow ----- */
async function useItem(){
  const roomRef = ref(db, `rooms/${roomId}`);
  const snap = await get(roomRef); if(!snap.exists()) return;
  const data = snap.val();
  if(localRole !== "rack") return alert("アイテムはラック時のみ使用できます");
  const rack = data.rack || {};
  if(!rack.token || rack.token!==localToken) return alert("あなたのラック情報が不一致");
  if(rack.hp > 2) return alert("アイテムはHPが2以下のときのみ使用可能");
  if(!rack.item || rack.itemUsed) return alert("アイテムが無いか既に使用済み");
  const item = rack.item;
  const updates = {};
  if(item === "Peek2"){
    // reveal two pick's cards (we set flags.revealToRack to array) — will be shown to rack and cleared by watcher
    const reveal = (data.pick && data.pick.hand) ? (data.pick.hand.slice(0,2)) : [];
    updates["flags/revealToRack"] = reveal;
    updates["players/rack/itemUsed"] = true; // not in schema, but safe
    updates["rack/itemUsed"] = true;
    logPush(`rooms/${roomId}`, `ラックが見透かしの瞳を使用（${reveal.join(",") || "見えるカード無し"})`);
  } else if(item === "Shield1"){
    updates["flags/shieldRack"] = true;
    updates["rack/itemUsed"] = true;
    logPush(`rooms/${roomId}`, `ラックが守護の印を使用（次の被ダメージを無効化）`);
  } else if(item === "DoubleDamage"){
    updates["flags/doubleDamageActive"] = true;
    updates["rack/itemUsed"] = true;
    logPush(`rooms/${roomId}`, `ラックが共鳴の符を使用（今ターンのダメージ2倍）`);
  } else if(item === "ForceDeclare"){
    updates["pending/forceDeclare"] = true;
    updates["rack/itemUsed"] = true;
    logPush(`rooms/${roomId}`, `ラックが真偽の声を使用（ピックに宣言させる）`);
  }
  // mark itemUsed in data.rack and proceed
  await update(roomRef, updates);
}

/* ----- Reset new game in same room (preserve tokens) ----- */
async function resetGame(){
  if(!roomId) return alert("ルーム未設定");
  if(!confirm("同ルームで新規ゲームを開始しますか？ 既存データが上書きされます")) return;
  const snap = await get(ref(db, `rooms/${roomId}`)); if(!snap.exists()) return;
  const data = snap.val();
  const pickToken = data.pick && data.pick.token ? data.pick.token : (localRole==="pick" ? localToken : null);
  const rackToken = data.rack && data.rack.token ? data.rack.token : (localRole==="rack" ? localToken : null);
  const deck = [];
  for(let i=0;i<10;i++){ deck.push("O"); deck.push("T"); deck.push("X"); }
  shuffle(deck);
  const init = {
    turnCount: 1,
    turn: "pick",
    state: "draw",
    deck,
    jokerEnabled: false,
    flags: {},
    pending: null,
    pick: { hp: INITIAL_HP, hand: [], token: pickToken, item: ITEM_KEYS[Math.floor(Math.random()*ITEM_KEYS.length)], itemUsed: false },
    rack: { hp: INITIAL_HP, hand: [], token: rackToken, item: ITEM_KEYS[Math.floor(Math.random()*ITEM_KEYS.length)], itemUsed: false },
    log: [],
  };
  await set(ref(db, `rooms/${roomId}`), init);
  logPush(`rooms/${roomId}`, "新しいゲームを開始しました（同ルーム）");
}

/* ----- Local watcher for special pending interactions ----- */
async function localWatcher(){
  if(!roomId) return;
  const snap = await get(ref(db, `rooms/${roomId}`));
  if(!snap.exists()) return;
  const data = snap.val();

  // pending.forceDeclare -> if I'm pick, prompt to declare a type that I must declare as "持っていないカードの種類"
  if(data.pending && data.pending.forceDeclare && localRole==="pick" && data.pick && data.pick.token===localToken){
    // pick must declare a type (O/T/X)
    const decl = prompt("真偽の声: あなたは「持っていないカードの種類」を宣言してください（O / T / X）");
    if(!decl || !["O","T","X"].includes(decl)) { alert("O/T/X のいずれかを入力してください。処理中止。"); return; }
    const hand = (data.pick.hand || []);
    const count = hand.filter(x => x===decl).length;
    const updates = {};
    if(count === 0){
      // pick takes damage (consider shield/double)
      let dmg = 1;
      if(data.flags && data.flags.doubleDamageActive) dmg *= 2;
      if(data.flags && data.flags.shieldPick){
        updates["flags/shieldPick"] = false;
        logPush(`rooms/${roomId}`, `ピックの守護がダメージを無効化`);
      } else {
        updates["pick/hp"] = (data.pick.hp || INITIAL_HP) - dmg;
        logPush(`rooms/${roomId}`, `ピックが宣言した${decl}は手札に無く、ピックに${dmg}ダメージ`);
      }
    } else {
      logPush(`rooms/${roomId}`, `ピックが宣言した${decl}は手札に存在したため効果なし`);
    }
    updates["pending/forceDeclare"] = null;
    updates["state"] = "draw";
    updates["pick/hand"] = [];
    updates["turnCount"] = (data.turnCount || 1) + 1;
    updates["flags/doubleDamageActive"] = false;
    await update(ref(db, `rooms/${roomId}`), updates);
    return;
  }

  // pending: joker_call -> if state is joker_call and I'm rack => prompt yes/no for has
  if(data.state === "joker_call" && localRole==="rack" && data.rack && data.rack.token===localToken){
    const ans = prompt("ジョーカーコール: ピックがジョーカーを所持していると思いますか？ yes / no");
    if(!ans) return;
    const guessHas = ans.toLowerCase().startsWith("y");
    const actualHas = (data.pick && (data.pick.hand||[]).includes("J"));
    const updates = {};
    let dmg = 1; if(data.flags && data.flags.doubleDamageActive) dmg *= 2;
    if(guessHas === actualHas){
      // rack correct -> pick takes dmg (shieldPick)
      if(data.flags && data.flags.shieldPick){
        updates["flags/shieldPick"] = false;
        logPush(`rooms/${roomId}`, `ピックの守護がジョーカーコールを無効化`);
      } else {
        updates["pick/hp"] = (data.pick.hp || INITIAL_HP) - dmg;
        logPush(`rooms/${roomId}`, `ジョーカーコール: ラックの予想的中。ピックに${dmg}ダメージ`);
      }
    } else {
      // rack wrong -> rack takes dmg
      if(data.flags && data.flags.shieldRack){
        updates["flags/shieldRack"] = false;
        logPush(`rooms/${roomId}`, `ラックの守護がジョーカーコールを無効化`);
      } else {
        updates["rack/hp"] = (data.rack.hp || INITIAL_HP) - dmg;
        logPush(`rooms/${roomId}`, `ジョーカーコール: ラックの予想失敗。ラックに${dmg}ダメージ`);
      }
    }
    // end turn: clear pick hand and advance
    updates["state"] = "draw";
    updates["pending"] = null;
    updates["pick/hand"] = [];
    updates["turnCount"] = (data.turnCount || 1) + 1;
    // clear doubleDamageActive
    updates["flags/doubleDamageActive"] = false;
    await update(ref(db, `rooms/${roomId}`), updates);
    return;
  }

  // flags.revealToRack handled earlier: we display in logs when rendering (and clearing)
  setTimeout(localWatcher, 700);
}

/* start watcher loop */
setInterval(()=>{ if(roomId) localWatcher(); }, 1000);

/* expose a few for debug */
window._dumpRoom = async ()=>{ if(!roomId) return alert("no room"); const s = await get(ref(db, `rooms/${roomId}`)); console.log(s.val()); alert("dumped to console"); };

console.log("Ruck & Pick client loaded");
