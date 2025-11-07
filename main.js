// main.js — 仕様変更対応版（Peek2修正、ForceDeclare自動化・無効化、アイテム1回制限、Joker Call通知）

import { initializeApp } from "https://www.gstatic.com/firebasejs/11.10.0/firebase-app.js";
import {
  getDatabase,
  ref,
  set,
  get,
  update,
  onValue,
  runTransaction,
} from "https://www.gstatic.com/gstatic.com/firebasejs/11.10.0/firebase-database.js";

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
  btnAdvanceTurn: document.getElementById("btnAdvanceTurn"),
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
  usedCardArea: document.getElementById("usedCardArea"),
  peekArea: document.getElementById("peekArea"), // 新規追加
};

/* --------------------
   定数・資産パス
   -------------------- */
const INITIAL_HP = 4;
const CARD_TYPES = ["O", "T", "X"];
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
let localRole = null; 
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
 * 役割交代ヘルパー関数。
 */
function swapRoles(currentPick, currentRack) {
  const nextPick = {
    hp: currentRack.hp,
    token: currentRack.token,
    hand: [],
    // Pickが持っていたアイテムはRackに、Rackが持っていたアイテムはPickに引き継がれる
    item: currentRack.item,
    itemUsed: currentRack.itemUsed, 
  };
  const nextRack = {
    hp: currentPick.hp,
    token: currentPick.token,
    hand: [],
    item: currentPick.item,
    itemUsed: currentPick.itemUsed, 
  };
  return { nextPick, nextRack };
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
el.btnAdvanceTurn.addEventListener("click", advanceTurn);

/* --------------------
   ルーム作成 / 参加
   -------------------- */
async function createRoom(){
  const rid = el.roomInput.value.trim() || Math.random().toString(36).slice(2,8);
  roomId = rid;
  localRole = "pick"; 
  el.roomIdText.textContent = rid;
  el.roleText.textContent = `プレイヤーA (${localRole})`;

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
    pick: { hp: INITIAL_HP, hand: [], token, item: ITEM_KEYS[Math.floor(Math.random()*ITEM_KEYS.length)], itemUsed: false },
    rack: { hp: INITIAL_HP, hand: [], token: null, item: ITEM_KEYS[Math.floor(Math.random()*ITEM_KEYS.length)], itemUsed: false },
    usedCards: [],
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
  el.roleText.textContent = `プレイヤーB (${localRole})`;

  const data = s.val();
  const updates = {};
  const rackHp = (data.rack && data.rack.hp !== undefined) ? data.rack.hp : INITIAL_HP;
  
  // ラックプレイヤーが未設定の場合、初期アイテムとHPを設定
  if(!data.rack || !data.rack.token) updates["rack"] = { hp: rackHp, hand: [], token, item: ITEM_KEYS[Math.floor(Math.random()*ITEM_KEYS.length)], itemUsed: false };
  else updates["rack/token"] = token;
  
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
  const isLocalPick = data.pick && data.pick.token === token;
  const isLocalRack = data.rack && data.rack.token === token;
  
  el.turnText.textContent = data.turnCount || "-";
  el.stateText.textContent = data.state || "-";
  el.pickHp.textContent = (data.pick && data.pick.hp!=null) ? data.pick.hp : "-";
  el.rackHp.textContent = (data.rack && data.rack.hp!=null) ? data.rack.hp : "-";
  
  const currentRole = isLocalPick ? "Pick" : isLocalRack ? "Rack" : localRole ? `観戦(${localRole})` : "観戦";
  const initialRole = localRole === "pick" ? "A" : localRole === "rack" ? "B" : "";
  el.roleText.textContent = `プレイヤー${initialRole} (${currentRole})`;

  // show top card image only for rack
  if(data.deck && data.deck.length){
    const top = data.deck[0];
    if(isLocalRack){ 
      el.topImg.style.display = "block";
      el.topImg.src = CARD_SRC[top] || "";
    } else {
      el.topImg.style.display = "none";
    }
  } else {
    el.topImg.style.display = "none";
  }

  // pick hand visual
  el.pickHand.innerHTML = "";
  const pickHand = (data.pick && data.pick.hand) ? data.pick.hand : [];
  const showPick = isLocalPick; 
  pickHand.forEach(c=>{
    const box = document.createElement("div"); box.className = "card";
    if(showPick){ const img = document.createElement("img"); img.className="imgcard"; img.src = CARD_SRC[c]||""; box.appendChild(img); }
    else box.textContent = "●";
    el.pickHand.appendChild(box);
  });

  // local hand (images)
  el.localHand.innerHTML = "";
  let myHand = [];
  if(isLocalPick) myHand = data.pick.hand || []; 
  if(isLocalRack) myHand = data.rack.hand || []; 
  myHand.forEach(c => {
    const img = document.createElement("img"); img.className="imgcard"; img.src = CARD_SRC[c]||""; el.localHand.appendChild(img);
  });

  // item status
  const myRoleData = isLocalPick ? data.pick : isLocalRack ? data.rack : null; 
  const myItem = myRoleData ? myRoleData.item : null;
  const myUsed = myRoleData ? myRoleData.itemUsed : false;

  el.myItemText.textContent = myItem ? `${myItem}${myUsed ? "（使用済）":""}` : "なし";
  renderItemArea(myItem, myUsed, data, isLocalRack); 

  // 使用済みカードの描画
  el.usedCardArea.innerHTML = "";
  const usedCards = data.usedCards || [];
  usedCards.forEach(c => {
    const img = document.createElement("img"); 
    img.className="imgcard"; 
    img.src = CARD_SRC[c]||""; 
    img.style.width = "48px"; img.style.height = "62px"; 
    img.style.margin = "2px";
    el.usedCardArea.appendChild(img);
  });
  
  // Peek2公開情報（Rackのみ）
  el.peekArea.innerHTML = "";
  const revealedCards = data.flags && data.flags.revealToRack;
  if(isLocalRack && revealedCards && revealedCards.length > 0){
      revealedCards.forEach(c => {
          const img = document.createElement("img"); 
          img.className="imgcard"; 
          img.src = CARD_SRC[c]||""; 
          img.style.width = "60px"; img.style.height = "80px"; 
          img.style.margin = "0 4px";
          el.peekArea.appendChild(img);
      });
  }


  // logs
  el.logArea.textContent = (data.log || []).slice(-300).join("\n");

  // buttons enablement
  updateButtons(data, isLocalPick, isLocalRack); 

  // win check
  if((data.pick && data.pick.hp<=0) || (data.rack && data.rack.hp<=0)){
    const loser = (data.pick && data.pick.hp<=0) ? "ピック" : "ラック";
    const winner = loser==="ピック" ? "ラック" : "ピック";
    // アラートの代わりにログとUIで通知
    if(data.state !== "game_over"){
        pushLog(`*** ゲーム終了！ ${winner} の勝利です ***`);
        update(ref(db, `rooms/${roomId}`), { state: "game_over" });
    }
  }
}

function renderItemArea(itemKey, used, data, isLocalRack){ 
  el.itemArea.innerHTML = "";
  if(!itemKey) return;
  
  const wrapper = document.createElement("div");
  wrapper.className = "item-card-wrapper";

  const img = document.createElement("img");
  img.className = "imgcard";
  img.src = ITEM_SRC[itemKey] || "";
  img.style.width = "68px"; img.style.height = "88px";
  
  const canUseItem = !used && isLocalRack && data.rack && data.rack.hp<=2; 
  
  if(canUseItem){
    img.style.cursor = "pointer";
    // アイテムボタンのクリックイベントは、UI描画時に直接バインド
    img.addEventListener("click", ()=> useItemUI(itemKey)); 
  } else {
    // 使用済みの場合はマスクを表示
    if(used){
        const mask = document.createElement("div");
        mask.className = "used-mask";
        mask.textContent = "使用済";
        wrapper.appendChild(mask);
    } else {
        img.style.opacity = 1;
    }
  }
  wrapper.appendChild(img);
  el.itemArea.appendChild(wrapper);
}

function updateButtons(data, isLocalPick, isLocalRack){ 
  // 全ボタン無効化
  el.btnDraw.disabled = true; 
  el.btnPredict.disabled = true; 
  el.btnExtra.disabled = true; 
  el.btnJokerCall.disabled = true; 
  el.btnAdvanceTurn.disabled = true; 
  
  if(data.state === "game_over") return;

  // 状態に基づく有効化
  if(isLocalPick && data.state==="draw") {
      el.btnDraw.disabled = false;
      if (data.pick && data.pick.hand.length === 3) {
          pushLog("（通知）ピックはドロー済みです。ジョーカーコールが必要な場合はボタンを押してください。");
      }
  }
  if(isLocalRack && data.state==="guess") el.btnPredict.disabled = false;
  if(isLocalRack && data.state==="extra") el.btnExtra.disabled = false;
  
  // ジョーカーコールはPickが任意で発動
  if(isLocalPick && data.jokerEnabled && data.state!=="joker_call" && data.pick && data.pick.hand.length === 3) {
      el.btnJokerCall.disabled = false;
  }
  
  // ターン進行待ち
  if (isLocalRack && data.state === "wait_for_advance") {
     el.btnAdvanceTurn.disabled = false;
  }
  
  // 強制宣言/ジョーカーコール待ち状態でも、Rackはターン進行ボタンを押せる
  if (isLocalRack && data.state === "force_declare" && data.pending && data.pending.forceDeclare){
      // ForceDeclareの処理はlocalWatcherに移すため、Rackにはターン進行を促す
      el.btnAdvanceTurn.disabled = false; 
  }
  if (isLocalRack && data.state === "joker_call" && data.pending && data.pending.jokerCallBy){
      el.btnPredict.disabled = false; // JokerCallはPredictボタンで代用（Guessフェーズへ移行しないため）
  }

}

// ラックが押すターン進行（役割交代）ボタンの処理
async function advanceTurn() {
    const roomRef = ref(db, `rooms/${roomId}`);
    const snap = await get(roomRef); if (!snap.exists()) return;
    const data = snap.val();
    
    if (!data.rack || data.rack.token !== token) return alert("あなたはラックではありません。");

    // ForceDeclare後の場合は、まずPickのターンを強制的に終わらせる
    if (data.state === "force_declare" && data.pending && data.pending.forceDeclare) {
        // ForceDeclareはダメージなし
        pushLog("ForceDeclareの結果が出ました。ターンを進行します。");
        // ForceDeclareのフラグをリセット
        await update(roomRef, {
            "pending": null,
            "flags/doubleDamageActive": false,
            "flags/revealToRack": null,
            "state": "wait_for_advance",
            "turn": "rack"
        });
        // stateがwait_for_advanceになったら、この関数が再実行される
        // （あるいは、プレイヤーがもう一度ボタンを押す）
        return; 
    }
    
    // wait_for_advance または ForceDeclare直後の処理
    if (data.state !== "wait_for_advance") return alert("現在ターン進行フェーズではありません。");

    const updates = {};
    
    // Pickの手札をUsedCardsに追加
    const hand = data.pick.hand || [];
    // ジョーカー以外のカードを使用済みリストに追加
    const nonJokerCards = hand.filter(c => c !== "J");
    updates["usedCards"] = [...(data.usedCards || []), ...nonJokerCards];
    
    // 役割交代の実行
    const { nextPick, nextRack } = swapRoles(data.pick, data.rack);
    updates["pick"] = nextPick;
    updates["rack"] = nextRack;
    
    // ターン情報の更新
    updates["state"] = "draw"; 
    updates["turnCount"] = (data.turnCount || 1) + 1; 
    updates["turn"] = "pick"; 
    updates["flags/doubleDamageActive"] = false; 
    updates["flags/revealToRack"] = null; 
    updates["pending"] = null; //念の為クリア

    pushLog(`ラックがターンを進行し、役割が交代しました。ターン${updates["turnCount"]}（ドローフェーズへ）`);

    await update(roomRef, updates);
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
  if(data.pick.hand && data.pick.hand.length === 3) return pushLog("（通知）すでにドロー済みです。");

  let deck = data.deck || [];
  if(deck.length < 3) return alert("山札のカードが足りません。リセットしてください。");
  
  const drawn = deck.slice(0,3);
  const rest = deck.slice(3);
  const updates = {};

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

  if(drawn.includes("J")){
    // ジョーカーを引いたが、自動コールはしない。ボタン操作を促す。
    updates["state"] = "draw"; // 状態は draw のまま
    updates["turn"] = "pick"; 
    pushLog("ピックがジョーカーをドローしました。ジョーカーコールをするか判断してください。");
  } else {
    updates["state"] = "guess";
    updates["turn"] = "rack";
    pushLog("ピックが3枚ドローしました（予想フェーズへ）");
  }

  await update(roomRef, updates);
}

// RACK initial predict (Guess Phase & Joker Call Phase兼用)
async function rackInitialPredict(){
  const roomRef = ref(db, `rooms/${roomId}`);
  const snap = await get(roomRef); if(!snap.exists()) return;
  const data = snap.val();
  
  if(!data.rack || data.rack.token !== token) return alert("あなたはラックではありません");
  
  const isJokerCall = data.state === "joker_call" && data.pending && data.pending.jokerCallBy;

  // ** Joker Call 処理 **
  if (isJokerCall) {
    const ans = prompt("ジョーカーコール: ピックがジョーカーを所持していると思いますか？ yes / no");
    if(!ans) return;
    const guessHas = ans.toLowerCase().startsWith("y");
    const actualHas = (data.pick && (data.pick.hand||[]).includes("J"));
    const updates = {};
    let dmg = 1; if(data.flags && data.flags.doubleDamageActive) dmg*=2;

    if(guessHas === actualHas){
      if(data.flags && data.flags.shieldPick){ updates["flags/shieldPick"] = false; pushLog("ピックの守護がジョーカーコールを無効化"); }
      else { updates["pick/hp"] = (data.pick.hp || INITIAL_HP) - dmg; pushLog("ジョーカーコール: ラックの予想的中。ピックに"+dmg+"ダメージ"); }
    } else {
      if(data.flags && data.flags.shieldRack){ updates["flags/shieldRack"] = false; pushLog("ラックの守護がジョーカーコールを無効化"); }
      else { updates["rack/hp"] = (data.rack.hp || INITIAL_HP) - dmg; pushLog("ジョーカーコール: ラックの予想失敗。ラックに"+dmg+"ダメージ"); }
    }
    
    updates["pending"] = null;
    updates["flags/doubleDamageActive"] = false;
    updates["flags/revealToRack"] = null;

    // 手動進行待ちへ
    updates["state"] = "wait_for_advance";
    updates["turn"] = "rack"; 
    await update(roomRef, updates);
    return;
  }
  
  // ** Guess Phase 処理 **
  if(data.state !== "guess") return alert("現在予想フェーズではありません");

  const guess = prompt("初期予想: ピック手札の1枚を予想してください（O/T/X）\n入力: O / T / X");
  if(!guess || !["O","T","X"].includes(guess)) return alert("O / T / X を入力してください");
  
  const hand = data.pick.hand || [];
  const updates = {};

  if(hand.includes(guess)){
    updates["pending/initialGuess"] = guess;
    updates["state"] = "extra";
    updates["turn"] = "rack";
    pushLog("ラックの初期予想が的中。エクストラへ移行");
  } else {
    let dmg = 1;
    if(data.flags && data.flags.doubleDamageActive) dmg *= 2;
    if(data.flags && data.flags.shieldRack){
      updates["flags/shieldRack"] = false;
      pushLog("ラックの守護がダメージを無効化");
    } else {
      updates["rack/hp"] = (data.rack.hp || INITIAL_HP) - dmg;
      pushLog("ラックの初期予想が外れ。ラックに" + dmg + "ダメージ");
    }
    
    updates["flags/doubleDamageActive"] = false;
    updates["flags/revealToRack"] = null;
    updates["state"] = "wait_for_advance"; 
    updates["turn"] = "rack"; 
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
  if(!data.rack || data.rack.token !== token) return alert("あなたはラックではありません");

  const hand = (data.pick.hand || []).slice();
  const init = data.pending && data.pending.initialGuess;
  if(!init) return alert("初期予想データがありません");
  const cp = hand.slice();
  const idx = cp.indexOf(init);
  if(idx>=0) cp.splice(idx,1);
  const remaining = cp; 

  // 残りの2枚と予想が完全に一致するか判定
  const preds = [p1,p2];
  const ok = (function(a,b){ 
      if(a.length!==b.length) return false; 
      const m={}; 
      a.forEach(x=>m[x]=(m[x]||0)+1); 
      b.forEach(x=>m[x]=(m[x]||0)-1); 
      return Object.values(m).every(v=>v===0); 
  })(preds, remaining);

  const updates = {};
  if(ok){
    let dmg = 1;
    if(data.flags && data.flags.doubleDamageActive) dmg *= 2;
    if(data.flags && data.flags.shieldPick){
      updates["flags/shieldPick"] = false;
      pushLog("ピックの守護がダメージを無効化");
    } else {
      updates["pick/hp"] = (data.pick.hp || INITIAL_HP) - dmg;
      pushLog("エクストラ予想成功！ピックに" + dmg + "ダメージ");
    }
  } else {
    pushLog("エクストラ予想失敗。ダメージなし");
  }

  // 手動進行待ちへ
  updates["pending"] = null;
  updates["flags/doubleDamageActive"] = false;
  updates["flags/revealToRack"] = null;
  updates["state"] = "wait_for_advance"; 
  updates["turn"] = "rack"; 

  await update(roomRef, updates);
}

// PICK Joker Call
async function pickJokerCall(){
  const roomRef = ref(db, `rooms/${roomId}`);
  const snap = await get(roomRef); if(!snap.exists()) return;
  const data = snap.val();
  if(!data.jokerEnabled) return pushLog("（通知）ジョーカーはまだ有効になっていません");
  if(!data.pick || data.pick.token !== token) return alert("あなたはピックではありません");
  if(data.pick.hand.length !== 3) return pushLog("（通知）ドローが完了していません。");
  
  await update(roomRef, { state: "joker_call", pending: { jokerCallBy: "pick" }, turn: "rack" });
  pushLog("ピックがジョーカーコールを発動しました（ラックは予想ボタンを押してください）");
}

/* --------------------
   アイテムの使用
   -------------------- */
async function useItemUI(itemKey){
  if(!confirm(`アイテム「${itemKey}」を使用しますか？`)) return;
  await useItem(itemKey);
}

async function useItem(itemKey){
  const roomRef = ref(db, `rooms/${roomId}`);
  const snap = await get(roomRef); if(!snap.exists()) return;
  const data = snap.val();
  
  const isLocalRack = data.rack && data.rack.token === token;
  const myRoleData = isLocalRack ? data.rack : null;
  if(!myRoleData) return pushLog("（エラー）アイテムは現在のラックプレイヤーのみ使用可");
  if(myRoleData.hp > 2) return pushLog("（エラー）アイテムは HP が 2 以下のときのみ使用できます");
  if(!myRoleData.item || myRoleData.itemUsed) return pushLog("（エラー）アイテムがないか既に**使用済み**です");

  const item = myRoleData.item;
  const updates = {};
  const rolePath = "rack"; 

  if(item === "Peek2"){
    const reveal = (data.pick && data.pick.hand) ? data.pick.hand.slice(0,2) : [];
    updates["flags/revealToRack"] = reveal; // ラック側で見えるようにデータに保存
    updates[`${rolePath}/itemUsed`] = true; // 1ゲーム1回制限
    pushLog("ラックがPeek2を使用しました。ピックの最初の2枚が公開されました。");
  } else if(item === "Shield1"){
    updates["flags/shieldRack"] = true;
    updates[`${rolePath}/itemUsed`] = true; // 1ゲーム1回制限
    pushLog("ラックがShield1を使用しました（次の被ダメージを無効化）");
  } else if(item === "DoubleDamage"){
    updates["flags/doubleDamageActive"] = true;
    updates[`${rolePath}/itemUsed`] = true; // 1ゲーム1回制限
    pushLog("ラックがDoubleDamageを使用しました（今ターンの与ダメージ2倍）");
  } else if(item === "ForceDeclare"){
    // Pickの手札を調べて持っていないカードを特定し、ログに通知する
    const hand = data.pick.hand || [];
    const counts = {};
    CARD_TYPES.forEach(t => counts[t] = hand.filter(c => c === t).length);
    
    const missing = CARD_TYPES.filter(t => counts[t] === 0);

    // ForceDeclareは即座に結果を出し、ダメージを与えずターン進行待ちに移行する
    updates[`${rolePath}/itemUsed`] = true; // 1ゲーム1回制限
    updates["pending"] = null;
    updates["flags/doubleDamageActive"] = false;
    updates["flags/revealToRack"] = null;

    if (missing.length === 0) {
        pushLog("ラックがForceDeclareを使用しましたが、ピックの手札には全ての種類（O, T, X）が含まれていました。");
    } else {
        pushLog(`ラックがForceDeclareを使用しました。ピックの手札に**含まれていない**のは: ${missing.join(", ")} です。`);
    }
    
    // ForceDeclareはダメージを発生させないため、直接 wait_for_advance へ
    updates["state"] = "wait_for_advance"; 
    updates["turn"] = "rack"; 

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
    pick: { hp: INITIAL_HP, hand: [], token: pickToken, item: ITEM_KEYS[Math.floor(Math.random()*ITEM_KEYS.length)], itemUsed: false },
    rack: { hp: INITIAL_HP, hand: [], token: rackToken, item: ITEM_KEYS[Math.floor(Math.random()*ITEM_KEYS.length)], itemUsed: false },
    usedCards: [],
    log: [],
  };
  if(localRole === "pick" && !pickToken) init.pick.token = token;
  if(localRole === "rack" && !rackToken) init.rack.token = token;
  
  await set(ref(db, `rooms/${roomId}`), init);
  pushLog("新しいゲームを開始しました（同ルーム）");
}

/* --------------------
   ローカルウォッチャー（即時入力が必要な場合にプロンプト表示）
   -------------------- */
async function localWatcher(){
  if(!roomId) return;
  const snap = await get(ref(db, `rooms/${roomId}`));
  if(!snap.exists()) return;
  const data = snap.val();
  
  const isLocalPick = data.pick && data.pick.token === token;
  
  // Pick側: ジョーカーを引いたがコールしていない場合
  if(isLocalPick && data.pick.hand && data.pick.hand.length === 3 && data.pick.hand.includes("J") && data.state === "draw" && data.turn === "pick"){
      pushLog("（通知）あなたはジョーカーを引いています。ジョーカーコールをするか（ボタンを押すか）判断してください。");
  }

  // ForceDeclareはアイテムの使用関数内で完結するよう修正したため、
  // ここでのプロンプト処理は不要になりました。

  setTimeout(localWatcher, 700);
}

setInterval(()=>{ if(roomId) localWatcher(); }, 1200);

/* expose debug helper */
window.dumpRoom = async ()=>{ if(!roomId) return alert("no room"); const s = await get(ref(db, `rooms/${roomId}`)); console.log(s.val()); alert("dumped to console"); };

pushLog("クライアント読み込み完了 — ルームを作成するか参加してください。");
