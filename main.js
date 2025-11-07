// main.js — Final working version (firebaseConfig left empty for user to fill)
import { initializeApp } from "https://www.gstatic.com/firebasejs/11.10.0/firebase-app.js";
import { getDatabase, ref, set, get, update, onValue } from "https://www.gstatic.com/firebasejs/11.10.0/firebase-database.js";

// ===== Firebase 設定 (あとで入力) =====
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

// ===== Constants & assets =====
const INITIAL_HP = 4;
const CARD_SRC = { O: "cards/maru.png", T: "cards/sankaku.png", X: "cards/batsu.png", J: "cards/joker.png" };
const ITEM_SRC = { Peek2: "cards/item_see.png", Shield1: "cards/item_shield.png", DoubleDamage: "cards/item_double.png", ForceDeclare: "cards/item_call.png" };
const ITEM_KEYS = ["Peek2","Shield1","DoubleDamage","ForceDeclare"];

// ===== DOM =====
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

// ===== State =====
let roomId = null;
let token = Math.random().toString(36).slice(2,9);
let localRole = null; // "pick" or "rack"
let unsub = null;

// Helpers
function shuffle(a){ for(let i=a.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[a[i],a[j]]=[a[j],a[i]];} return a; }
function now(){ return new Date().toLocaleTimeString(); }
function addLog(s){ const prev = el.logArea.textContent || ""; el.logArea.textContent = prev + `[${now()}] ${s}\n`; }

// Build deck (30 normal cards, Joker handled at turn>=4 insertion)
function buildDeck(){
  const deck = [];
  for(let i=0;i<10;i++){ deck.push("O"); deck.push("T"); deck.push("X"); }
  shuffle(deck);
  return deck;
}

// UI Binding
el.btnCreate.addEventListener("click", createRoom);
el.btnJoin.addEventListener("click", joinRoom);
el.btnReset.addEventListener("click", resetGame);
el.btnDraw.addEventListener("click", pickDraw);
el.btnPredict.addEventListener("click", rackInitialPredict);
el.btnExtra.addEventListener("click", rackExtraPredict);
el.btnJokerCall.addEventListener("click", pickJokerCall);
el.btnUseItem.addEventListener("click", useItem);

// Create room (pick)
async function createRoom(){
  const rid = el.roomInput.value.trim() || Math.random().toString(36).slice(2,8);
  roomId = rid; localRole = "pick";
  el.roomIdText.textContent = rid; el.roleText.textContent = "Pick (あなた)";
  const deck = buildDeck();
  const pickItem = ITEM_KEYS[Math.floor(Math.random()*ITEM_KEYS.length)];
  const rackItem = ITEM_KEYS[Math.floor(Math.random()*ITEM_KEYS.length)];
  const init = {
    turnCount: 1,
    state: "draw",
    deck,
    jokerEnabled: false,
    flags: {},
    pending: null,
    pick: { hp: INITIAL_HP, hand: [], token, item: pickItem, itemUsed: false },
    rack: { hp: INITIAL_HP, hand: [], token: null, item: rackItem, itemUsed: false },
    log: [],
  };
  await set(ref(db, `rooms/${rid}`), init);
  addLog("ルーム作成（ピック）: " + rid);
  watchRoom(rid);
}

// Join room (rack)
async function joinRoom(){
  const rid = el.roomInput.value.trim();
  if(!rid) return alert("ルームIDを入力してください");
  const snap = await get(ref(db, `rooms/${rid}`));
  if(!snap.exists()) return alert("ルームが存在しません");
  roomId = rid; localRole = "rack";
  el.roomIdText.textContent = rid; el.roleText.textContent = "Rack (あなた)";
  // set rack token if absent and give item if missing
  const data = snap.val();
  const updates = {};
  if(!data.rack) updates[`rack`] = { hp: INITIAL_HP, hand: [], token, item: ITEM_KEYS[Math.floor(Math.random()*ITEM_KEYS.length)], itemUsed: false };
  else updates[`rack/token`] = token;
  await update(ref(db, `rooms/${rid}`), updates);
  addLog("ルーム参加（ラック）: " + rid);
  watchRoom(rid);
}

// Watch room updates
function watchRoom(rid){
  if(unsub) unsub();
  unsub = onValue(ref(db, `rooms/${rid}`), snap => {
    const data = snap.val();
    if(!data) return;
    render(data);
  });
}

// Render state to UI
function render(data){
  el.turnText.textContent = data.turnCount || "-";
  el.stateText.textContent = data.state || "-";
  el.pickHp.textContent = (data.pick && data.pick.hp!=null) ? data.pick.hp : "-";
  el.rackHp.textContent = (data.rack && data.rack.hp!=null) ? data.rack.hp : "-";
  // top card visible for rack
  if(data.deck && data.deck.length){
    if(localRole==="rack"){ el.topImg.style.display="block"; el.topImg.src = CARD_SRC[data.deck[0]] || ""; }
    else { el.topImg.style.display="none"; }
  } else { el.topImg.style.display="none"; }
  // pick hand (show actual for pick, bullets for rack)
  el.pickHandDiv.innerHTML = "";
  const pickHand = (data.pick && data.pick.hand) ? data.pick.hand : [];
  const show = (localRole==="pick" && data.pick && data.pick.token===token);
  pickHand.forEach(c=>{
    const box = document.createElement("div"); box.className="card";
    if(show){ const img=document.createElement("img"); img.src = CARD_SRC[c]||""; img.className="imgcard"; box.appendChild(img); }
    else { box.textContent="●"; }
    el.pickHandDiv.appendChild(box);
  });
  // local hand area (for whichever role you are)
  el.localHand.innerHTML = "";
  let myHand = [];
  if(localRole==="pick" && data.pick && data.pick.token===token) myHand = data.pick.hand || [];
  if(localRole==="rack" && data.rack && data.rack.token===token) myHand = data.rack.hand || [];
  myHand.forEach(c=>{ const img=document.createElement("img"); img.className="imgcard"; img.src=CARD_SRC[c]||""; el.localHand.appendChild(img); });
  // item text
  const myItem = (localRole==="pick") ? (data.pick && data.pick.item) : (data.rack && data.rack.item);
  const myUsed = (localRole==="pick") ? (data.pick && data.pick.itemUsed) : (data.rack && data.rack.itemUsed);
  el.myItemText.textContent = myItem ? `${myItem}${myUsed ? "（使用済）":""}` : "なし";
  renderItemArea(myItem, myUsed, data);
  // show logs
  el.logArea.textContent = (data.log||[]).slice(-200).join("\n");
  updateButtons(data);
  // check end
  if((data.pick && data.pick.hp<=0) || (data.rack && data.rack.hp<=0)){
    const loser = (data.pick && data.pick.hp<=0) ? "pick" : "rack";
    const winner = loser==="pick" ? "rack" : "pick";
    alert(`ゲーム終了：${winner} の勝ち！`);
  }
}

function renderItemArea(itemKey, used, data){
  el.itemArea.innerHTML = "";
  if(!itemKey) return;
  const img=document.createElement("img"); img.src=ITEM_SRC[itemKey]||""; img.className="imgcard"; img.style.width="68px"; img.style.height="88px";
  if(!used && localRole==="rack" && data && data.rack && data.rack.token===token && data.rack.hp<=2){
    img.style.cursor="pointer"; img.addEventListener("click", ()=> useItemUI(itemKey)); 
  } else { img.style.opacity = used?0.4:1; }
  el.itemArea.appendChild(img);
}

function updateButtons(data){
  el.btnDraw.disabled = true; el.btnPredict.disabled = true; el.btnExtra.disabled = true; el.btnJokerCall.disabled = true; el.btnUseItem.disabled = true;
  if(localRole==="pick" && data.state==="draw" && data.pick && data.pick.token===token) el.btnDraw.disabled = false;
  if(localRole==="rack" && data.state==="guess" && data.rack && data.rack.token===token) el.btnPredict.disabled = false;
  if(localRole==="rack" && data.state==="extra" && data.rack && data.rack.token===token) el.btnExtra.disabled = false;
  if(localRole==="pick" && data.jokerEnabled && data.pick && data.pick.token===token && data.state!=="joker_call") el.btnJokerCall.disabled = false;
  if(localRole==="rack" && data.rack && data.rack.token===token && data.rack.item && !data.rack.itemUsed && data.rack.hp<=2) el.btnUseItem.disabled = false;
}

// Actions

async function pickDraw(){
  const roomRef = ref(db, `rooms/${roomId}`);
  const snap = await get(roomRef); if(!snap.exists()) return;
  const data = snap.val();
  if(data.state!=="draw") return alert("現在ドローフェーズではありません");
  if(!data.pick || data.pick.token!==token) return alert("あなたはピックではありません");
  let deck = data.deck || [];
  const drawn = deck.splice(0,3);
  // if turnCount>=4 and joker not enabled -> insert J randomly
  const updates = {};
  if((data.turnCount||1)>=4 && !data.jokerEnabled){
    const restWithJ = deck.slice();
    const pos = Math.floor(Math.random()*(restWithJ.length+1));
    restWithJ.splice(pos,0,"J");
    updates["deck"] = restWithJ;
    updates["jokerEnabled"] = true;
    addLog("ジョーカーが山札に追加されました（turnCount>=4）");
  } else {
    updates["deck"] = deck;
  }
  updates["pick/hand"] = drawn;
  // if drawn includes J -> forced joker_call
  if(drawn.includes("J")){
    updates["state"] = "joker_call";
    addLog("ピックがジョーカーを引いた！強制ジョーカーコール");
  } else {
    updates["state"] = "guess";
    addLog("ピックが3枚ドロー: " + drawn.join(","));
  }
  await update(roomRef, updates);
}

async function rackInitialPredict(){
  const guess = prompt("初期予想: ピックの手札のうち1枚の種類を予想してください（O/T/X）");
  if(!guess || !["O","T","X"].includes(guess)) return alert("O/T/X のいずれかを入力してください");
  const roomRef = ref(db, `rooms/${roomId}`);
  const snap = await get(roomRef); if(!snap.exists()) return;
  const data = snap.val();
  if(data.state!=="guess") return alert("現在予想フェーズではありません");
  if(!data.rack || data.rack.token!==token) return alert("あなたはラックではありません");
  const hand = data.pick.hand || [];
  const updates = {};
  if(hand.includes(guess)){
    updates["pending/initialGuess"] = guess;
    updates["state"] = "extra";
    addLog("ラックの初期予想が的中。エクストラへ移行");
  } else {
    // miss -> rack loses 1 (consider shield/double)
    let dmg = 1;
    if(data.flags && data.flags.doubleDamageActive) dmg *= 2;
    if(data.flags && data.flags.shieldRack){
      updates["flags/shieldRack"] = false;
      addLog("ラックの守護がダメージを無効化");
    } else {
      updates["rack/hp"] = (data.rack.hp||INITIAL_HP) - dmg;
      addLog("ラックの初期予想が外れ。ラックに"+dmg+"ダメージ");
    }
    updates["pick/hand"] = [];
    updates["state"] = "draw";
    updates["turnCount"] = (data.turnCount||1)+1;
    updates["flags/doubleDamageActive"] = false;
  }
  await update(roomRef, updates);
}

async function rackExtraPredict(){
  const p1 = prompt("エクストラ予想：残り2枚のうち1つ目（O/T/X）");
  if(!p1 || !["O","T","X"].includes(p1)) return alert("O/T/X のいずれかを入力");
  const p2 = prompt("エクストラ予想：残り2枚のうち2つ目（O/T/X）");
  if(!p2 || !["O","T","X"].includes(p2)) return alert("O/T/X のいずれかを入力");
  const roomRef = ref(db, `rooms/${roomId}`);
  const snap = await get(roomRef); if(!snap.exists()) return;
  const data = snap.val();
  if(data.state!=="extra") return alert("現在エクストラフェーズではありません");
  const hand = (data.pick.hand||[]).slice();
  const init = data.pending && data.pending.initialGuess;
  if(!init) return alert("初期予想データがありません");
  const cp = hand.slice(); const idx = cp.indexOf(init); if(idx>=0) cp.splice(idx,1);
  const remaining = cp;
  const ok = (function(a,b){ if(a.length!==b.length) return false; const m={}; a.forEach(x=>m[x]=(m[x]||0)+1); b.forEach(x=>m[x]=(m[x]||0)-1); return Object.values(m).every(v=>v===0); })([p1,p2], remaining);
  const updates = {};
  if(ok){
    let dmg = 1; if(data.flags && data.flags.doubleDamageActive) dmg *= 2;
    if(data.flags && data.flags.shieldPick){
      updates["flags/shieldPick"] = false;
      addLog("ピックの守護がダメージを無効化");
    } else {
      updates["pick/hp"] = (data.pick.hp||INITIAL_HP) - dmg;
      addLog("エクストラ的中！ピックに"+dmg+"ダメージ");
    }
  } else {
    addLog("エクストラ予想失敗。ダメージなし");
  }
  updates["pending"] = null;
  updates["pick/hand"] = [];
  updates["state"] = "draw";
  updates["turnCount"] = (data.turnCount||1)+1;
  updates["flags/doubleDamageActive"] = false;
  await update(roomRef, updates);
}

async function pickJokerCall(){
  const roomRef = ref(db, `rooms/${roomId}`);
  const snap = await get(roomRef); if(!snap.exists()) return;
  const data = snap.val();
  if(!data.jokerEnabled) return alert("ジョーカーはまだ有効ではありません");
  if(!data.pick || data.pick.token!==token) return alert("あなたはピックではありません");
  await update(roomRef, { state: "joker_call", pending: { jokerCallBy: "pick" } });
  addLog("ピックがジョーカーコールを発動");
}

async function useItem(){
  const roomRef = ref(db, `rooms/${roomId}`);
  const snap = await get(roomRef); if(!snap.exists()) return;
  const data = snap.val();
  if(localRole!=="rack") return alert("アイテムはラック時のみ使用できます");
  const rack = data.rack||{};
  if(!rack.token || rack.token!==token) return alert("あなたのラック情報が不一致");
  if(rack.hp>2) return alert("アイテムはHPが2以下のときのみ使用可能");
  if(!rack.item || rack.itemUsed) return alert("アイテムが無いか既に使用済み");
  const item = rack.item;
  const updates = {};
  if(item==="Peek2"){
    const reveal = (data.pick && data.pick.hand) ? (data.pick.hand.slice(0,2)) : [];
    updates["flags/revealToRack"] = reveal;
    updates["rack/itemUsed"] = true;
    updates["rack/itemUsed"] = true;
    addLog("ラックが見透かしの瞳を使用");
  } else if(item==="Shield1"){
    updates["flags/shieldRack"] = true;
    updates["rack/itemUsed"] = true;
    addLog("ラックが守護の印を使用");
  } else if(item==="DoubleDamage"){
    updates["flags/doubleDamageActive"] = true;
    updates["rack/itemUsed"] = true;
    addLog("ラックが共鳴の符を使用（今ターンダメージ2倍）");
  } else if(item==="ForceDeclare"){
    updates["pending/forceDeclare"] = true;
    updates["rack/itemUsed"] = true;
    addLog("ラックが真偽の声を使用（ピックに宣言させる）");
  }
  await update(roomRef, updates);
}

async function resetGame(){
  if(!roomId) return alert("ルーム未設定");
  if(!confirm("同ルームで新規ゲームを開始しますか？")) return;
  const snap = await get(ref(db, `rooms/${roomId}`)); if(!snap.exists()) return;
  const data = snap.val();
  const pickToken = data.pick && data.pick.token ? data.pick.token : (localRole==="pick" ? token : null);
  const rackToken = data.rack && data.rack.token ? data.rack.token : (localRole==="rack" ? token : null);
  const deck = buildDeck();
  const init = {
    turnCount: 1, state: "draw", deck, jokerEnabled: false, flags: {}, pending: null,
    pick: { hp: INITIAL_HP, hand: [], token: pickToken, item: ITEM_KEYS[Math.floor(Math.random()*ITEM_KEYS.length)], itemUsed: false },
    rack: { hp: INITIAL_HP, hand: [], token: rackToken, item: ITEM_KEYS[Math.floor(Math.random()*ITEM_KEYS.length)], itemUsed: false },
    log: []
  };
  await set(ref(db, `rooms/${roomId}`), init);
  addLog("新しいゲームを開始しました（同ルーム）");
}

// Local watcher handles forced interactions (forceDeclare, joker_call prompts)
async function localWatcher(){
  if(!roomId) return;
  const snap = await get(ref(db, `rooms/${roomId}`));
  if(!snap.exists()) return;
  const data = snap.val();
  if(data.pending && data.pending.forceDeclare && localRole==="pick" && data.pick && data.pick.token===token){
    const decl = prompt("真偽の声: あなたは「持っていないカードの種類」を宣言してください（O/T/X）");
    if(!decl || !["O","T","X"].includes(decl)) { alert("O/T/X を入力してください"); return; }
    const hand = data.pick.hand || [];
    const count = hand.filter(x=>x===decl).length;
    const updates = {};
    if(count===0){
      let dmg = 1; if(data.flags && data.flags.doubleDamageActive) dmg*=2;
      if(data.flags && data.flags.shieldPick){ updates["flags/shieldPick"]=false; addLog("ピックの守護がダメージを無効化"); }
      else { updates["pick/hp"] = (data.pick.hp||INITIAL_HP) - dmg; addLog("ピックが宣言した"+decl+"は手札に無くダメージ"); }
    } else { addLog("ピックの宣言は手札に存在したため効果なし"); }
    updates["pending/forceDeclare"]=null; updates["state"]="draw"; updates["pick/hand"]=[]; updates["turnCount"]=(data.turnCount||1)+1; updates["flags/doubleDamageActive"]=false;
    await update(ref(db, `rooms/${roomId}`), updates); return;
  }
  if(data.state==="joker_call" && localRole==="rack" && data.rack && data.rack.token===token){
    const ans = prompt("ジョーカーコール: ピックがジョーカーを所持していると思いますか？ yes / no");
    if(!ans) return;
    const guessHas = ans.toLowerCase().startsWith("y");
    const actualHas = (data.pick && (data.pick.hand||[]).includes("J"));
    const updates = {};
    let dmg = 1; if(data.flags && data.flags.doubleDamageActive) dmg*=2;
    if(guessHas===actualHas){
      if(data.flags && data.flags.shieldPick){ updates["flags/shieldPick"]=false; addLog("ピックの守護が無効化"); }
      else { updates["pick/hp"] = (data.pick.hp||INITIAL_HP) - dmg; addLog("ジョーカーコール: ラックの予想的中。ピックに"+dmg+"ダメージ"); }
    } else {
      if(data.flags && data.flags.shieldRack){ updates["flags/shieldRack"]=false; addLog("ラックの守護が無効化"); }
      else { updates["rack/hp"] = (data.rack.hp||INITIAL_HP) - dmg; addLog("ジョーカーコール: ラックの予想失敗。ラックに"+dmg+"ダメージ"); }
    }
    updates["state"]="draw"; updates["pending"]=null; updates["pick/hand"]=[]; updates["turnCount"]=(data.turnCount||1)+1; updates["flags/doubleDamageActive"]=false;
    await update(ref(db, `rooms/${roomId}`), updates); return;
  }
  setTimeout(localWatcher, 800);
}

setInterval(()=>{ if(roomId) localWatcher(); }, 1000);

console.log("Ruck & Pick client ready (firebaseConfig empty — fill from console).");
