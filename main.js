// main_full_turnfix_revised_v2.js — HP固定、攻守交代修正版
// Firebase 設定は下の firebaseConfig を自分の値に置き換えてください。

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

/* ====== Firebase 設定 (空欄にしてあるのでコンソール値で埋めてください) ====== */
const firebaseConfig = {
  apiKey: "AIzaSyB4wWBozfQ2A-2IppWjIGlOYmajSKBtOtM",
  authDomain: "luckandpick.firebaseapp.com",
  databaseURL: "https://luckandpick-default-rtdb.asia-southeast1.firebasedatabase.app/",
  projectId: "luckandpick",
  storageBucket: "luckandpick.firebasestorage.app",
  messagingSenderId: "116413627559",
  appId: "1:116413627559:web:51cf6dbc64eb25c060ef82"
};
/* ========================================================================= */

const app = initializeApp(firebaseConfig);
const db = getDatabase(app);

/* --------------------
   DOM 要素（index.html に合わせる）
   -------------------- */
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
  pickHand: document.getElementById("pickHand"),
  topImg: document.getElementById("topImg"),
  turnText: document.getElementById("turn"),
  stateText: document.getElementById("state"),
  myItemText: document.getElementById("myItem"),
  logArea: document.getElementById("log"),
  localHand: document.getElementById("localHand"),
  itemArea: document.getElementById("itemArea"),
};

/* --------------------
   定数・資産パス
   -------------------- */
const INITIAL_HP = 4;
const CARD_SRC = { O: "cards/maru.png", T: "cards/sankaku.png", X: "cards/batsu.png", J: "cards/joker.png" };
const ITEM_SRC = {
  Peek2: "cards/item_see.png",
  Shield1: "cards/item_shield.png",
  DoubleDamage: "cards/item_double.png",
  ForceDeclare: "cards/item_call.png",
};
const ITEM_KEYS = ["Peek2", "Shield1", "DoubleDamage", "ForceDeclare"];

/* --------------------
   ローカル状態
   -------------------- */
let roomId = null;
let token = Math.random().toString(36).slice(2, 9);
let localRole = null; // "pick" or "rack"
let unsubscribe = null;

/* --------------------
   ヘルパー
   -------------------- */
function shuffle(a){ for(let i=a.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[a[i],a[j]]=[a[j],a[i]];} return a; }
function now(){ return new Date().toLocaleTimeString(); }
function pushLog(text){
  if(!roomId) {
    el.logArea.textContent += `[${now()}] ${text}\n`;
    return;
  }
  const node = ref(db, `rooms/${roomId}/log`);
  runTransaction(node, cur => {
    cur = cur || [];
    cur.push(`[${now()}] ${text}`);
    if(cur.length>300) cur.shift();
    return cur;
  }).catch(err => console.warn(err));
}

/**
 * ターン終了時にPickとRackの役割を交代させるヘルパー関数
 * HP, Tokenは入れ替えず、役割に紐づく情報（手札、アイテム使用状況、一部のフラグ）を入れ替える
 * @param {object} currentPick 現在のpickデータ
 * @param {object} currentRack 現在のrackデータ
 * @returns {object} { newPick, newRack }
 */
function swapRoles(currentPick, currentRack) {
    // プレイヤーのHPとTokenは維持し、他の役割に紐づく情報を交換
    const nextPick = {
        hp: currentRack.hp, // 次のPickのHPは、現在のRackのHP
        hand: [], // 手札はリセット
        token: currentRack.token, // 次のPickのTokenは、現在のRackのToken
        item: currentRack.item,
        itemUsed: false, // アイテム使用状況はリセット (ターンごとの使用制限と仮定)
    };

    const nextRack = {
        hp: currentPick.hp, // 次のRackのHPは、現在のPickのHP
        hand: [], // 手札はリセット
        token: currentPick.token, // 次のRackのTokenは、現在のPickのToken
        item: currentPick.item,
        itemUsed: false, // アイテム使用状況はリセット
    };
    
    // アイテムは「ターンごとに使用」ではなく「ゲーム中に一度きり」の可能性もあるため、
    // ここでは「ターンごとの役割交代でリセットされる」という前提で itemUsed: false にしています。
    // もし「ゲーム中に一度きり」の場合は、itemUsed: currentRack.itemUsed / currentPick.itemUsed を維持してください。

    return { pick: nextPick, rack: nextRack };
}


/* --------------------
   UI バインド
   -------------------- */
el.btnCreate.addEventListener("click", createRoom);
el.btnJoin.addEventListener("click", joinRoom);
el.btnReset.addEventListener("click", resetGame);
el.btnDraw.addEventListener("click", pickDraw);
el.btnPredict.addEventListener("click", rackInitialPredict);
el.btnExtra.addEventListener("click", rackExtraPredict);
el.btnJokerCall.addEventListener("click", pickJokerCall);
el.btnUseItem.addEventListener("click", useItem);

/* --------------------
   ルーム作成 / 参加
   -------------------- */
async function createRoom(){
  const rid = el.roomInput.value.trim() || Math.random().toString(36).slice(2,8);
  roomId = rid;
  localRole = "pick";
  el.roomIdText.textContent = rid;
  el.roleText.textContent = "Pick (あなた)";

  // build deck (30 cards). Joker inserted later at turn>=4
  const deck = [];
  for(let i=0;i<10;i++){ deck.push("O"); deck.push("T"); deck.push("X"); }
  shuffle(deck);

  const init = {
    turnCount: 1,
    state: "draw",
    deck,
    jokerEnabled: false,
    flags: {},
    pending: null,
    turn: "pick", // who is currently pick
    pick: { hp: INITIAL_HP, hand: [], token, item: ITEM_KEYS[Math.floor(Math.random()*ITEM_KEYS.length)], itemUsed: false },
    rack: { hp: INITIAL_HP, hand: [], token: null, item: ITEM_KEYS[Math.floor(Math.random()*ITEM_KEYS.length)], itemUsed: false },
    log: [],
  };

  await set(ref(db, `rooms/${rid}`), init);
  pushLog(`ルーム作成: ${rid}（ピック）`);
  watchRoom(rid);
}

async function joinRoom(){
  const rid = el.roomInput.value.trim();
  if(!rid) return alert("ルームIDを入力してね");
  const s = await get(ref(db, `rooms/${rid}`));
  if(!s.exists()) return alert("そのルームは存在しません");
  roomId = rid;
  localRole = "rack";
  el.roomIdText.textContent = rid;
  el.roleText.textContent = "Rack (あなた)";

  // ensure rack token assigned
  const data = s.val();
  const updates = {};
  if(!data.rack || !data.rack.token) updates["rack"] = { hp: (data.rack && data.rack.hp) || INITIAL_HP, hand: [], token, item: (data.rack && data.rack.item) || ITEM_KEYS[Math.floor(Math.random()*ITEM_KEYS.length)], itemUsed: (data.rack && data.rack.itemUsed) || false };
  else updates["rack/token"] = token;
  
  // pickがまだトークンを持っていない場合（リセット後の途中参加など）に対応
  if(!data.pick || !data.pick.token) updates["pick/token"] = data.pick && data.pick.token ? data.pick.token : "player1-default"; // ダミー値を設定

  await update(ref(db, `rooms/${rid}`), updates);
  pushLog(`ルーム参加: ${rid}（ラック）`);
  watchRoom(rid);
}

/* --------------------
   監視（onValue）
   -------------------- */
function watchRoom(rid){
  if(unsubscribe) unsubscribe(); 
  const roomRef = ref(db, `rooms/${rid}`);
  unsubscribe = onValue(roomRef, snap => {
    const data = snap.val();
    if(!data) return;
    renderAll(data);
  });
}

/* --------------------
   描画
   -------------------- */
function renderAll(data){
  el.turnText.textContent = data.turnCount || "-";
  el.stateText.textContent = data.state || "-";
  
  // **HP表示**: data.pickとdata.rackのHPを表示 (HPはプレイヤーに固定)
  el.pickHp.textContent = (data.pick && data.pick.hp!=null) ? data.pick.hp : "-";
  el.rackHp.textContent = (data.rack && data.rack.hp!=null) ? data.rack.hp : "-";

  // show top card image only for rack
  if(data.deck && data.deck.length){
    const top = data.deck[0];
    if(localRole==="rack"){
      el.topImg.style.display = "block";
      el.topImg.src = CARD_SRC[top] || "";
    } else {
      el.topImg.style.display = "none";
    }
  } else {
    el.topImg.style.display = "none";
  }

  // pick hand visual (show actual only to pick)
  el.pickHand.innerHTML = "";
  const pickHand = (data.pick && data.pick.hand) ? data.pick.hand : [];
  const showPick = (localRole==="pick" && data.pick && data.pick.token===token);
  pickHand.forEach(c=>{
    const box = document.createElement("div"); box.className = "card";
    if(showPick){ const img = document.createElement("img"); img.className="imgcard"; img.src = CARD_SRC[c]||""; box.appendChild(img); }
    else box.textContent = "●";
    el.pickHand.appendChild(box);
  });

  // local hand (images) for whichever role
  el.localHand.innerHTML = "";
  let myHand = [];
  if(localRole==="pick" && data.pick && data.pick.token===token) myHand = data.pick.hand || [];
  if(localRole==="rack" && data.rack && data.rack.token===token) myHand = data.rack.hand || [];
  myHand.forEach(c => {
    const img = document.createElement("img"); img.className="imgcard"; img.src = CARD_SRC[c]||""; el.localHand.appendChild(img);
  });

  // item status
  // プレイヤーが現在Pick/Rackのどちらの役割についているかに応じてアイテムを表示
  const myRoleData = (localRole==="pick" && data.pick && data.pick.token===token) ? data.pick : (localRole==="rack" && data.rack && data.rack.token===token) ? data.rack : null;
  const myItem = myRoleData ? myRoleData.item : null;
  const myUsed = myRoleData ? myRoleData.itemUsed : false;

  el.myItemText.textContent = myItem ? `${myItem}${myUsed ? "（使用済）":""}` : "なし";
  renderItemArea(myItem, myUsed, data);

  // logs
  el.logArea.textContent = (data.log || []).slice(-300).join("\n");

  // buttons enablement
  updateButtons(data);

  // win check
  if((data.pick && data.pick.hp<=0) || (data.rack && data.rack.hp<=0)){
    const loser = (data.pick && data.pick.hp<=0) ? 
        ((data.pick.token===token) ? "あなた（ピック）" : "ピック") : 
        ((data.rack.token===token) ? "あなた（ラック）" : "ラック");
    const winner = loser.includes("ピック") ? 
        ((data.rack.token===token) ? "あなた（ラック）" : "ラック") : 
        ((data.pick.token===token) ? "あなた（ピック）" : "ピック");
    alert(`ゲーム終了 — ${winner} の勝ち！`);
  }
}

function renderItemArea(itemKey, used, data){
  el.itemArea.innerHTML = "";
  if(!itemKey) return;
  const img = document.createElement("img");
  img.className = "imgcard";
  img.src = ITEM_SRC[itemKey] || "";
  img.style.width = "68px"; img.style.height = "88px";
  
  // アイテム使用条件を修正
  const myRoleData = (localRole==="rack" && data.rack && data.rack.token===token) ? data.rack : null;
  const canUseItem = myRoleData && !used && myRoleData.hp<=2;

  if(canUseItem){
    img.style.cursor = "pointer";
    img.addEventListener("click", ()=> useItemUI(itemKey));
  } else {
    img.style.opacity = used ? 0.45 : 1;
  }
  el.itemArea.appendChild(img);
}

function updateButtons(data){
  el.btnDraw.disabled = true; el.btnPredict.disabled = true; el.btnExtra.disabled = true; el.btnJokerCall.disabled = true; el.btnUseItem.disabled = true;

  // ボタンの有効化は、現在の役割とトークンが一致し、かつフェーズが正しい場合に限る
  const isLocalPick = localRole==="pick" && data.pick && data.pick.token===token;
  const isLocalRack = localRole==="rack" && data.rack && data.rack.token===token;

  if(isLocalPick && data.state==="draw") el.btnDraw.disabled = false;
  if(isLocalRack && data.state==="guess") el.btnPredict.disabled = false;
  if(isLocalRack && data.state==="extra") el.btnExtra.disabled = false;
  if(isLocalPick && data.jokerEnabled && data.state!=="joker_call") el.btnJokerCall.disabled = false;
  
  // アイテム使用ボタンは、ラックであり、かつHP<=2, 未使用の場合に有効化
  const rackData = data.rack;
  if(isLocalRack && rackData && rackData.item && !rackData.itemUsed && rackData.hp<=2) el.btnUseItem.disabled = false;
}

/* --------------------
   ゲーム本体：ドロー・予想・エクストラ・ジョーカー・アイテム
   -------------------- */

// PICK draws 3
async function pickDraw(){
  const roomRef = ref(db, `rooms/${roomId}`);
  const snap = await get(roomRef); if(!snap.exists()) return;
  const data = snap.val();
  if(data.state !== "draw") return alert("現在ドローフェーズではありません");
  if(!data.pick || data.pick.token !== token) return alert("あなたはピックではありません");

  let deck = data.deck || [];
  const drawn = deck.slice(0,3);
  const rest = deck.slice(3);
  const updates = {};

  // If turnCount >=4 and joker not enabled -> insert J into rest at random position
  if((data.turnCount || 1) >= 4 && !data.jokerEnabled){
    const r = rest.slice();
    const pos = Math.floor(Math.random()*(r.length+1));
    r.splice(pos,0,"J");
    updates["deck"] = r;
    updates["jokerEnabled"] = true;
    pushLog("ジョーカーが山札に追加されました（turnCount>=4）");
  } else {
    updates["deck"] = rest;
  }

  updates["pick/hand"] = drawn;

  // if drawn includes J -> forced joker_call
  if(drawn.includes("J")){
    updates["state"] = "joker_call";
    // set turn to rack to respond
    updates["turn"] = "rack";
    pushLog("ピックがジョーカーをドローしたため強制ジョーカーコール発生");
  } else {
    updates["state"] = "guess";
    // hand out turn to rack to make guess
    updates["turn"] = "rack";
    // **修正**: ログにカード詳細を表示しない
    pushLog("ピックが3枚ドローしました（予想フェーズへ）");
  }

  await update(roomRef, updates);
}

// RACK initial predict
async function rackInitialPredict(){
  const guess = prompt("初期予想: ピック手札の1枚を予想してください（O/T/X）\n入力: O / T / X");
  if(!guess || !["O","T","X"].includes(guess)) return alert("O / T / X を入力してください");
  const roomRef = ref(db, `rooms/${roomId}`);
  const snap = await get(roomRef); if(!snap.exists()) return;
  const data = snap.val();
  if(data.state !== "guess") return alert("現在予想フェーズではありません");
  if(!data.rack || data.rack.token !== token) return alert("あなたはラックではありません");

  const hand = data.pick.hand || [];
  const updates = {};

  if(hand.includes(guess)){
    updates["pending/initialGuess"] = guess;
    updates["state"] = "extra";
    // keep turn with rack for extra predictions
    updates["turn"] = "rack";
    pushLog("ラックの初期予想が的中。エクストラへ移行");
  } else {
    // miss: rack loses 1 (respect shields/double)
    let dmg = 1;
    if(data.flags && data.flags.doubleDamageActive) dmg *= 2;
    if(data.flags && data.flags.shieldRack){
      updates["flags/shieldRack"] = false;
      pushLog("ラックの守護がダメージを無効化");
    } else {
      // **HP固定**: ラックのHPを減らす
      updates["rack/hp"] = (data.rack.hp || INITIAL_HP) - dmg;
      pushLog("ラックの初期予想が外れ。ラックに" + dmg + "ダメージ");
    }
    
    // end turn: clear pick hand, advance turnCount, state draw and assign pick role
    updates["pick/hand"] = [];
    updates["state"] = "draw";
    updates["turnCount"] = (data.turnCount || 1) + 1;
    updates["flags/doubleDamageActive"] = false;

    // **修正**: 予想失敗時、役割（pick/rackのデータ）を入れ替える（HP, Tokenは維持）
    const { pick: nextPick, rack: nextRack } = swapRoles(data.pick, data.rack);
    updates["pick"] = nextPick;
    updates["rack"] = nextRack;
    updates["turn"] = "pick"; // 新しいpickがドローから開始
  }

  await update(roomRef, updates);
}

// RACK extra predict (remaining 2)
async function rackExtraPredict(){
  const p1 = prompt("エクストラ予想: 残り2枚のうち1つ目（O/T/X）");
  if(!p1 || !["O","T","X"].includes(p1)) return alert("O/T/X を入力");
  const p2 = prompt("エクストラ予想: 残り2枚のうち2つ目（O/T/X）");
  if(!p2 || !["O","T","X"].includes(p2)) return alert("O/T/X を入力");
  const roomRef = ref(db, `rooms/${roomId}`);
  const snap = await get(roomRef); if(!snap.exists()) return;
  const data = snap.val();
  if(data.state !== "extra") return alert("現在エクストラフェーズではありません");

  const hand = (data.pick.hand || []).slice();
  const init = data.pending && data.pending.initialGuess;
  if(!init) return alert("初期予想データがありません");
  // remove one occurrence of initial from hand
  const cp = hand.slice();
  const idx = cp.indexOf(init);
  if(idx>=0) cp.splice(idx,1);
  const remaining = cp; // should be length 2

  // compare multisets
  const preds = [p1,p2];
  const ok = (function(a,b){ if(a.length!==b.length) return false; const m={}; a.forEach(x=>m[x]=(m[x]||0)+1); b.forEach(x=>m[x]=(m[x]||0)-1); return Object.values(m).every(v=>v===0); })(preds, remaining);

  const updates = {};
  if(ok){
    let dmg = 1;
    if(data.flags && data.flags.doubleDamageActive) dmg *= 2;
    if(data.flags && data.flags.shieldPick){
      updates["flags/shieldPick"] = false;
      pushLog("ピックの守護がダメージを無効化");
    } else {
      // **HP固定**: ピックのHPを減らす
      updates["pick/hp"] = (data.pick.hp || INITIAL_HP) - dmg;
      pushLog("エクストラ予想成功！ピックに" + dmg + "ダメージ");
    }
  } else {
    pushLog("エクストラ予想失敗。ダメージなし");
  }

  // end turn: clear hand, swap roles (turnCount++), set state draw and assign pick role
  updates["pending"] = null;
  updates["pick/hand"] = [];
  updates["state"] = "draw";
  updates["turnCount"] = (data.turnCount || 1) + 1;
  updates["flags/doubleDamageActive"] = false;

  // **修正**: エクストラ予想完了時、役割（pick/rackのデータ）を入れ替える（HP, Tokenは維持）
  const { pick: nextPick, rack: nextRack } = swapRoles(data.pick, data.rack);
  updates["pick"] = nextPick;
  updates["rack"] = nextRack;
  updates["turn"] = "pick"; // 新しいpickがドローから開始

  await update(roomRef, updates);
}

// PICK Joker Call
async function pickJokerCall(){
  const roomRef = ref(db, `rooms/${roomId}`);
  const snap = await get(roomRef); if(!snap.exists()) return;
  const data = snap.val();
  if(!data.jokerEnabled) return alert("ジョーカーはまだ有効になっていません");
  if(!data.pick || data.pick.token !== token) return alert("あなたはピックではありません");
  await update(roomRef, { state: "joker_call", pending: { jokerCallBy: "pick" }, turn: "rack" });
  pushLog("ピックがジョーカーコールを発動");
}

/* --------------------
   アイテムの使用
   -------------------- */
async function useItemUI(itemKey){
  if(!confirm(`アイテム「${itemKey}」を使用しますか？`)) return;
  await useItem();
}

async function useItem(){
  const roomRef = ref(db, `rooms/${roomId}`);
  const snap = await get(roomRef); if(!snap.exists()) return;
  const data = snap.val();
  
  // 役割ではなく、現在のプレイヤーのデータ（ローカルトークンで識別）を取得
  const myRoleData = (localRole==="rack" && data.rack && data.rack.token===token) ? data.rack : null;
  if(!myRoleData) return alert("アイテムは現在のラックプレイヤーのみ使用可");

  if(myRoleData.hp > 2) return alert("アイテムは HP が 2 以下のときのみ使用できます");
  if(!myRoleData.item || myRoleData.itemUsed) return alert("アイテムがないか既に使用済み");

  const item = myRoleData.item;
  const updates = {};
  
  // 役割に基づいてパスを動的に決定
  const rolePath = localRole; // "rack"
  
  if(item === "Peek2"){
    const reveal = (data.pick && data.pick.hand) ? data.pick.hand.slice(0,2) : [];
    updates["flags/revealToRack"] = reveal;
    updates[`${rolePath}/itemUsed`] = true; // 現在の役割のitemUsedを更新
    pushLog("ラックがPeek2を使用（ピックの2枚を確認）");
  } else if(item === "Shield1"){
    updates["flags/shieldRack"] = true;
    updates[`${rolePath}/itemUsed`] = true;
    pushLog("ラックがShield1を使用（次の被ダメージを無効化）");
  } else if(item === "DoubleDamage"){
    updates["flags/doubleDamageActive"] = true;
    updates[`${rolePath}/itemUsed`] = true;
    pushLog("ラックがDoubleDamageを使用（今ターンの与ダメージ2倍）");
  } else if(item === "ForceDeclare"){
    updates["pending/forceDeclare"] = true;
    updates[`${rolePath}/itemUsed`] = true;
    pushLog("ラックがForceDeclareを使用（ピックに宣言させる）");
  }
  await update(roomRef, updates);
}

/* --------------------
   リセット（同ルームで新規ゲーム）
   -------------------- */
async function resetGame(){
  if(!roomId) return alert("まずルーム作成/参加してください");
  if(!confirm("同ルームで新規ゲームを開始しますか？（既存データが上書きされます）")) return;
  const snap = await get(ref(db, `rooms/${roomId}`));
  if(!snap.exists()) return alert("room not found");
  const data = snap.val();

  // リセット時、プレイヤーのトークンは維持し、初期HP/アイテム/手札/状態をリセット
  const pickToken = data.pick && data.pick.token ? data.pick.token : null;
  const rackToken = data.rack && data.rack.token ? data.rack.token : null;
  
  const deck = [];
  for(let i=0;i<10;i++){ deck.push("O"); deck.push("T"); deck.push("X"); }
  shuffle(deck);
  
  const init = {
    turnCount: 1,
    state: "draw",
    deck,
    jokerEnabled: false,
    flags: {},
    pending: null,
    turn: "pick",
    // プレイヤーの役割とトークンを維持し、HP/アイテムを初期化
    pick: { 
      hp: INITIAL_HP, 
      hand: [], 
      token: pickToken, 
      item: ITEM_KEYS[Math.floor(Math.random()*ITEM_KEYS.length)], 
      itemUsed: false 
    },
    rack: { 
      hp: INITIAL_HP, 
      hand: [], 
      token: rackToken, 
      item: ITEM_KEYS[Math.floor(Math.random()*ITEM_KEYS.length)], 
      itemUsed: false 
    },
    log: [],
  };
  await set(ref(db, `rooms/${roomId}`), init);
  pushLog("新しいゲームを開始しました（同ルーム）");
}

/* --------------------
   ローカルウォッチャー（即時入力が必要な場合にプロンプト表示）
   - pending.forceDeclare -> pick must declare a type they do NOT have
   - state === 'joker_call' and localRole==='rack' -> prompt yes/no
   -------------------- */
async function localWatcher(){
  if(!roomId) return;
  const snap = await get(ref(db, `rooms/${roomId}`));
  if(!snap.exists()) return;
  const data = snap.val();

  // Force Declare 処理 (Pick側)
  if(data.pending && data.pending.forceDeclare && localRole==="pick" && data.pick && data.pick.token===token){
    const decl = prompt("真偽の声: 「持っていないカードの種類」を宣言してください（O / T / X）");
    if(!decl || !["O","T","X"].includes(decl)){ alert("O/T/X を入力してください"); return; }
    const hand = data.pick.hand || [];
    const count = hand.filter(x=>x===decl).length;
    const updates = {};
    if(count === 0){
      let dmg = 1; if(data.flags && data.flags.doubleDamageActive) dmg*=2;
      if(data.flags && data.flags.shieldPick){ updates["flags/shieldPick"] = false; pushLog("ピックの守護がダメージを無効化"); }
      else { 
        // **HP固定**: PickのHPを減らす
        updates["pick/hp"] = (data.pick.hp || INITIAL_HP) - dmg; 
        pushLog("ピックが宣言した"+decl+"は手札に無くダメージを受けた"); 
      }
    } else {
      pushLog("ピックの宣言は手札に存在したため効果なし");
    }
    updates["pending/forceDeclare"] = null;
    updates["state"] = "draw";
    updates["pick/hand"] = [];
    updates["turnCount"] = (data.turnCount || 1) + 1;
    updates["flags/doubleDamageActive"] = false;

    // **修正**: ターン終了時、役割（pick/rackのデータ）を入れ替える（HP, Tokenは維持）
    const { pick: nextPick, rack: nextRack } = swapRoles(data.pick, data.rack);
    updates["pick"] = nextPick;
    updates["rack"] = nextRack;
    updates["turn"] = "pick";
    
    await update(ref(db, `rooms/${roomId}`), updates);
    return;
  }

  // Joker Call 処理 (Rack側)
  if(data.state === "joker_call" && localRole==="rack" && data.rack && data.rack.token===token){
    const ans = prompt("ジョーカーコール: ピックがジョーカーを所持していると思いますか？ yes / no");
    if(!ans) return;
    const guessHas = ans.toLowerCase().startsWith("y");
    const actualHas = (data.pick && (data.pick.hand||[]).includes("J"));
    const updates = {};
    let dmg = 1; if(data.flags && data.flags.doubleDamageActive) dmg*=2;
    if(guessHas === actualHas){
      if(data.flags && data.flags.shieldPick){ updates["flags/shieldPick"] = false; pushLog("ピックの守護がジョーカーコールを無効化"); }
      else { 
        // **HP固定**: PickのHPを減らす
        updates["pick/hp"] = (data.pick.hp || INITIAL_HP) - dmg; 
        pushLog("ジョーカーコール: ラックの予想的中。ピックに"+dmg+"ダメージ"); 
      }
    } else {
      if(data.flags && data.flags.shieldRack){ updates["flags/shieldRack"] = false; pushLog("ラックの守護がジョーカーコールを無効化"); }
      else { 
        // **HP固定**: RackのHPを減らす
        updates["rack/hp"] = (data.rack.hp || INITIAL_HP) - dmg; 
        pushLog("ジョーカーコール: ラックの予想失敗。ラックに"+dmg+"ダメージ"); 
      }
    }
    updates["state"] = "draw";
    updates["pending"] = null;
    updates["pick/hand"] = [];
    updates["turnCount"] = (data.turnCount || 1) + 1;
    updates["flags/doubleDamageActive"] = false;

    // **修正**: ターン終了時、役割（pick/rackのデータ）を入れ替える（HP, Tokenは維持）
    const { pick: nextPick, rack: nextRack } = swapRoles(data.pick, data.rack);
    updates["pick"] = nextPick;
    updates["rack"] = nextRack;
    updates["turn"] = "pick";
    
    await update(ref(db, `rooms/${roomId}`), updates);
    return;
  }

  setTimeout(localWatcher, 700);
}

setInterval(()=>{ if(roomId) localWatcher(); }, 1200);

/* expose debug helper */
window.dumpRoom = async ()=>{ if(!roomId) return alert("no room"); const s = await get(ref(db, `rooms/${roomId}`)); console.log(s.val()); alert("dumped to console"); };

pushLog("クライアント読み込み完了 — firebaseConfig を設定してください。");
