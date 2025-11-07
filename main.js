// Firebase SDKをCDNからインポート
import { 
  initializeApp 
} from "https://www.gstatic.com/firebasejs/11.10.0/firebase-app.js";
import {
  getDatabase,
  ref,
  set,
  get,
  update,
  onValue,
  runTransaction,
} from "https://www.gstatic.com/firebasejs/11.10.0/firebase-database.js";

/* ====== Firebase Configuration (Fallback and Global) ====== */
// ローカルテスト用 or __firebase_configが提供されない場合のフォールバック設定
const fallbackConfig = {
  apiKey: "AIzaSyB4wWBozfQ2A-2IppWjIGlOYmajSKBtOtM",
  authDomain: "luckandpick.firebaseapp.com",
  databaseURL: "https://luckandpick-default-rtdb.asia-southeast1.firebasedatabase.app/",
  projectId: "luckandpick",
  storageBucket: "luckandpick.firebasestorage.app",
  messagingSenderId: "116413627559",
  appId: "1:116413627559:web:51cf6dbc64eb25c060ef82"
};

// Canvas環境が提供するグローバル変数を使用し、なければフォールバックを使用
const firebaseConfig = typeof __firebase_config !== 'undefined' 
    ? JSON.parse(__firebase_config) 
    : fallbackConfig;

let app, db;
try {
    app = initializeApp(firebaseConfig);
    db = getDatabase(app);
    console.log("Firebase initialized successfully.");
} catch (e) {
    console.error("Firebase initialization failed:", e);
    const logEl = document.getElementById("log");
    if(logEl) logEl.textContent += `[ERROR] Firebase初期化に失敗しました。\n`;
}

/* --------------------
   DOM Elements
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
  peekArea: document.getElementById("peekArea"), 
};

/* --------------------
   Constants
   -------------------- */
const INITIAL_HP = 4;
const CARD_TYPES = ["O", "T", "X"];
// Placeholder image URLs for cards
// アイテムカードの画像は、CSSで回転させるため、通常のカードサイズ(80x120)と同じアスペクト比で作成
const CARD_SRC = { 
    O: "https://placehold.co/80x120/10b981/ffffff?text=O", 
    T: "https://placehold.co/80x120/f97316/ffffff?text=T", 
    X: "https://placehold.co/80x120/ef4444/ffffff?text=X", 
    J: "https://placehold.co/80x120/000000/ffffff?text=JOKER" 
};
// Placeholder image URLs for items (サイズはCSSで管理するため、ここでは無視される)
const ITEM_SRC = {
  Peek2: "https://placehold.co/80x120/2563eb/ffffff?text=Peek2",
  Shield1: "https://placehold.co/80x120/6366f1/ffffff?text=Shield1",
  DoubleDamage: "https://placehold.co/80x120/f59e0b/ffffff?text=Double\nDamage",
  ForceDeclare: "https://placehold.co/80x120/14b8a6/ffffff?text=Force\nDeclare",
};
const ITEM_KEYS = ["Peek2", "Shield1", "DoubleDamage", "ForceDeclare"];

/* --------------------
   Local State
   -------------------- */
let roomId = null;
let token = Math.random().toString(36).slice(2, 9);
let localRole = null; 
let unsubscribe = null; 

/* --------------------
   Helpers
   -------------------- */
/** 配列をシャッフル */
function shuffle(a){ for(let i=a.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[a[i],a[j]]=[a[j],a[i]];} return a; }
/** 現在時刻を取得 */
function now(){ return new Date().toLocaleTimeString(); }
    
/**
 * ログをコンソールとFirebaseにプッシュします。
 */
function pushLog(text){
  if(!el.logArea) return;
  
  const logEntry = `[${now()}] ${text}`;
  
  // ローカルログへの即時表示
  el.logArea.textContent += `${logEntry}\n`;
  el.logArea.scrollTop = el.logArea.scrollHeight;
  
  // Firebaseへのログ記録（roomIdがある場合のみ）
  if(!roomId || !db || typeof runTransaction !== 'function') return;

  const node = ref(db, `rooms/${roomId}/log`);
  runTransaction(node, cur => {
    cur = cur || [];
    cur.push(logEntry);
    if(cur.length>300) cur.shift(); // ログが多すぎる場合は古いものを削除
    return cur;
  }).catch(err => console.warn("Failed to push log to Firebase:", err));
}

/**
 * 役割交代時にステータスをコピーするヘルパー関数。
 * HP, トークン, アイテムの状態を入れ替える。
 */
function swapRoles(currentPick, currentRack) {
  const nextPick = {
    hp: currentRack.hp,
    token: currentRack.token,
    hand: [], // 手札はクリア
    item: currentRack.item,
    itemUsed: currentRack.itemUsed, 
  };
  const nextRack = {
    hp: currentPick.hp,
    token: currentPick.token,
    hand: [], // 手札はクリア
    item: currentPick.item,
    itemUsed: currentPick.itemUsed, 
  };
  return { nextPick, nextRack };
}


/* --------------------
   UI Binding
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
   Room Setup
   -------------------- */
async function createRoom(){
  if (!db || typeof set !== 'function') { pushLog("（エラー）データベースが初期化されていません。"); return; }

  const rid = el.roomInput.value.trim() || Math.random().toString(36).slice(2,8);
  
  const deck = [];
  for(let i=0;i<10;i++){ deck.push("O"); deck.push("T"); deck.push("X"); }
  shuffle(deck);

  const init = {
    turnCount: 1,
    state: "draw", // draw, guess, extra, joker_call, wait_for_advance, game_over
    deck,
    jokerEnabled: false, 
    flags: {}, // doubleDamageActive, shieldPick, shieldRack, revealToRack
    pending: null, // initialGuess, jokerCallBy
    turn: "pick", 
    pick: { hp: INITIAL_HP, hand: [], token, item: ITEM_KEYS[Math.floor(Math.random()*ITEM_KEYS.length)], itemUsed: false },
    rack: { hp: INITIAL_HP, hand: [], token: null, item: ITEM_KEYS[Math.floor(Math.random()*ITEM_KEYS.length)], itemUsed: false }, 
    usedCards: [], // 捨て札
    log: [`[${now()}] ルーム作成: ${rid}（ピックとして参加）`],
  };

  try {
    await set(ref(db, `rooms/${rid}`), init);
    roomId = rid;
    localRole = "pick"; 
    el.roomIdText.textContent = rid;
    el.roleText.textContent = `プレイヤーA (${localRole})`;
    
    watchRoom(rid);
    pushLog(`ルーム作成: ${rid} に成功しました。`); 
  } catch (error) {
    console.error("ルーム作成エラー:", error);
    pushLog(`エラー: ルーム作成に失敗しました (${error.message})`);
  }
}

async function joinRoom(){
  if (!db || typeof get !== 'function' || typeof update !== 'function') { pushLog("（エラー）データベースが初期化されていません。"); return; }

  const rid = el.roomInput.value.trim();
  if(!rid) return pushLog("（エラー）ルームIDを入力してください");
  
  try {
    const roomRef = ref(db, `rooms/${rid}`);
    const s = await get(roomRef);
    if(!s.exists()) return pushLog("（エラー）そのルームは存在しません");
    
    const data = s.val();
    
    let roleToAssign = null;
    const updates = {};
    
    // Pickの参加判定と更新
    if (!data.pick || !data.pick.token) {
        roleToAssign = "pick";
        updates["pick/token"] = token;
    } 
    // Rackの参加判定と更新
    else if (!data.rack || !data.rack.token) {
        roleToAssign = "rack";
        if(!data.rack || data.rack.hp === undefined) {
            // Rackデータが完全に空の場合、初期値で作成
            updates["rack"] = { hp: INITIAL_HP, hand: [], token, item: ITEM_KEYS[Math.floor(Math.random()*ITEM_KEYS.length)], itemUsed: false };
        } else {
            // Rackデータはあるがトークンがない場合、トークンのみ更新
            updates["rack/token"] = token;
        }
    } 
    // 既存プレイヤーの場合の再接続
    else if (data.pick.token === token) {
         roleToAssign = "pick";
    } else if (data.rack.token === token) {
         roleToAssign = "rack";
    } else {
         return pushLog("（エラー）このルームにはすでに2人のプレイヤーがいます。");
    }

    if(!roleToAssign) { return pushLog("（エラー）ルームに参加できませんでした。"); }
    
    // 更新が必要な場合は実行
    if (Object.keys(updates).length > 0) { await update(roomRef, updates); }
    
    roomId = rid;
    localRole = roleToAssign; 
    el.roomIdText.textContent = rid;
    const initialRoleLetter = localRole === "pick" ? "A" : "B";
    el.roleText.textContent = `プレイヤー${initialRoleLetter} (${localRole})`;

    pushLog(`ルーム参加: ${rid}（${localRole === "pick" ? "ピック" : "ラック"}）`);
    watchRoom(rid);

  } catch (error) {
    console.error("ルーム参加エラー:", error);
    pushLog(`エラー: ルーム参加に失敗しました (${error.message})`);
  }
}

/* --------------------
   Realtime Watch (onValue)
   -------------------- */
function watchRoom(rid){
  if(unsubscribe) unsubscribe(); 
  if (!db || typeof onValue !== 'function') { pushLog("（エラー）データベースが初期化されていないか、監視関数がありません。"); return; }
  
  const roomRef = ref(db, `rooms/${rid}`);
  
  unsubscribe = onValue(roomRef, snap => {
    const data = snap.val();
    if(!data) return;
    renderAll(data);
  }, (error) => {
      console.error("Firebase Watch Error:", error);
      pushLog(`エラー: データの監視中に問題が発生しました。`);
  });
}

/* --------------------
   Rendering
   -------------------- */
function renderAll(data){
  // 自分の役割を確定
  const isLocalPick = data.pick && data.pick.token === token;
  const isLocalRack = data.rack && data.rack.token === token;
  
  // ステータス表示
  el.turnText.textContent = data.turnCount || "-";
  el.stateText.textContent = data.state || "-";
  el.pickHp.textContent = (data.pick && data.pick.hp!=null) ? data.pick.hp : "-";
  el.rackHp.textContent = (data.rack && data.rack.hp!=null) ? data.rack.hp : "-";
  
  const currentRole = isLocalPick ? "Pick" : isLocalRack ? "Rack" : localRole ? `観戦(${localRole})` : "観戦";
  const initialRole = localRole === "pick" ? "A" : localRole === "rack" ? "B" : "";
  el.roleText.textContent = `プレイヤー${initialRole} (${currentRole})`;

  // 山札のトップカード表示 (ラックのみ)
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

  // ピックの手札（公開予想エリア）表示
  el.pickHand.innerHTML = "";
  const pickHand = (data.pick && data.pick.hand) ? data.pick.hand : [];
  // Pick手札は常に非表示（ジョーカーコール時も、Rackは予想するだけ）
  pickHand.forEach(c=>{
    const box = document.createElement("div"); box.className = "card";
    box.textContent = "●"; // 常に「●」で非表示
    el.pickHand.appendChild(box);
  });

  // 自分の手札（ローカル）表示
  el.localHand.innerHTML = "";
  let myHand = [];
  if(isLocalPick) myHand = data.pick.hand || []; 
  if(isLocalRack) myHand = data.rack.hand || []; 
  myHand.forEach(c => {
    const img = document.createElement("img"); img.className="imgcard"; img.src = CARD_SRC[c]||""; 
    img.style.width = "75px"; img.style.height = "105px";
    el.localHand.appendChild(img);
  });

  // アイテム情報表示
  const myRoleData = isLocalPick ? data.pick : isLocalRack ? data.rack : null; 
  const myItem = myRoleData ? myRoleData.item : null;
  const myUsed = myRoleData ? myRoleData.itemUsed : false;

  el.myItemText.textContent = myItem ? `${myItem}${myUsed ? "（使用済）":""}` : "なし";
  renderItemArea(myItem, myUsed, data, isLocalRack); 

  // 使用済みカードエリア表示
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
  
  // Peek2による公開情報 (Rackのみ)
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

  // ログ表示
  el.logArea.textContent = (data.log || []).slice(-300).join("\n");
  el.logArea.scrollTop = el.logArea.scrollHeight;

  // ボタンの状態更新
  updateButtons(data, isLocalPick, isLocalRack); 

  // ゲームオーバー判定
  if((data.pick && data.pick.hp<=0) || (data.rack && data.rack.hp<=0)){
    const loser = (data.pick && data.pick.hp<=0) ? "ピック" : "ラック";
    const winner = loser==="ピック" ? "ラック" : "ピック";
    if(data.state !== "game_over"){
        pushLog(`*** ゲーム終了！ ${winner} の勝利です ***`);
        update(ref(db, `rooms/${roomId}`), { state: "game_over" });
    }
  }
}

/**
 * アイテムエリアの描画とクリックイベントの設定
 * CSSの変更に合わせて、要素の構造を変更
 */
function renderItemArea(itemKey, used, data, isLocalRack){ 
  el.itemArea.innerHTML = "";
  if(!itemKey) return;
  
  // 外側のラッパー (回転後の領域を確保)
  const wrapper = document.createElement("div");
  wrapper.className = "item-card-wrapper";

  // 回転するベース要素 (カード本体)
  const base = document.createElement("div");
  base.className = "item-card-base";
  
  const img = document.createElement("img");
  img.className = "imgcard";
  // Placeholder image URLs for items - サイズ指定はCSSで行うため削除
  img.src = ITEM_SRC[itemKey] || "";
  
  base.appendChild(img);
  wrapper.appendChild(base);

  const rackHp = data.rack ? data.rack.hp : 0;
  const canUseItem = isLocalRack && rackHp<=2 && !used; 
  
  if(canUseItem){
    base.style.cursor = "pointer";
    // クリックイベントでアイテム使用UIを起動
    base.addEventListener("click", ()=> useItemUI(itemKey)); 
  } else {
    // 使用済みのマスク表示
    if(used){
        const mask = document.createElement("div");
        mask.className = "used-mask";
        mask.textContent = itemKey; // マスクにアイテム名を表示
        wrapper.appendChild(mask);
    } else if (isLocalRack) {
        // HPが足りないなどで使えない場合は少し暗く表示
        base.style.opacity = 0.5;
    }
  }
  
  el.itemArea.appendChild(wrapper);
}

/**
 * アクションボタンの状態を更新
 */
function updateButtons(data, isLocalPick, isLocalRack){ 
  el.btnDraw.disabled = true; 
  el.btnPredict.disabled = true; 
  el.btnExtra.disabled = true; 
  el.btnJokerCall.disabled = true; 
  el.btnAdvanceTurn.disabled = true; 
  
  if(data.state === "game_over") return;

  // PICKの操作
  if(isLocalPick){
    if(data.state==="draw") {
        // ドロー
        if(data.pick && data.pick.hand.length !== 3) {
          el.btnDraw.disabled = false;
        }
        // ジョーカーコール
        if (data.pick && data.pick.hand.length === 3 && data.pick.hand.includes("J")) {
           el.btnJokerCall.disabled = false;
        }
    }
  }
  
  // RACKの操作
  if(isLocalRack){
    // 初期予想
    if(data.state==="guess") el.btnPredict.disabled = false;
    // エクストラ予想
    if(data.state==="extra") el.btnExtra.disabled = false;
    
    // ジョーカーコール時の予想
    if (data.state === "joker_call" && data.pending && data.pending.jokerCallBy){
        el.btnPredict.disabled = false; // 初期予想ボタンを流用
    }

    // ターン進行
    if (data.state === "wait_for_advance") {
       el.btnAdvanceTurn.disabled = false;
    }
  }
}

/* --------------------
   Game Actions
   -------------------- */

/**
 * ターン進行処理（Rackのみ実行）
 */
async function advanceTurn() {
    if (!db || typeof runTransaction !== 'function') { pushLog("（エラー）データベースが初期化されていません。"); return; }
    const roomRef = ref(db, `rooms/${roomId}`);
    
    // トランザクション
    runTransaction(roomRef, (currentData) => {
        if (currentData === null) return currentData; 

        if (currentData.state !== "wait_for_advance") {
            pushLog("（エラー）現在ターン進行フェーズではありません。");
            return; 
        }
        if (!currentData.rack || currentData.rack.token !== token) {
            pushLog("（エラー）あなたはラックではありません。");
            return;
        }
        
        const updates = {};
        
        // Pickの手札（ジョーカー以外）をUsedCardsに追加
        const hand = currentData.pick.hand || [];
        const nonJokerCards = hand.filter(c => c !== "J");
        updates["usedCards"] = [...(currentData.usedCards || []), ...nonJokerCards];
        
        // 役割交代
        const { nextPick, nextRack } = swapRoles(currentData.pick, currentData.rack);
        updates["pick"] = nextPick;
        updates["rack"] = nextRack;
        
        // 状態更新
        updates["state"] = "draw"; 
        updates["turnCount"] = (currentData.turnCount || 1) + 1; 
        updates["turn"] = "pick"; 
        
        // フラグ・保留情報のクリア
        updates["flags/doubleDamageActive"] = null; // false 
        updates["flags/revealToRack"] = null; 
        updates["pending"] = null; 

        pushLog(`ラックがターンを進行し、役割が交代しました。ターン${updates["turnCount"]}（ドローフェーズへ）`);
        
        // 更新オブジェクトを返す
        return { ...currentData, ...updates, pick: nextPick, rack: nextRack }; 

    }).catch(error => {
        console.error("ターン進行トランザクションエラー:", error);
        pushLog(`エラー: ターン進行に失敗しました (${error.message})`);
    });
}


/**
 * ピックが山札から3枚ドローする
 */
async function pickDraw(){
  if (!db || typeof runTransaction !== 'function') { pushLog("（エラー）データベースが初期化されていません。"); return; }
  const roomRef = ref(db, `rooms/${roomId}`);

  runTransaction(roomRef, (data) => {
    if (data === null) return data; 

    if(data.state !== "draw") { pushLog("（エラー）現在ドローフェーズではありません"); return; }
    if(!data.pick || data.pick.token !== token) { pushLog("（エラー）あなたはピックではありません"); return; }
    if(data.pick.hand && data.pick.hand.length === 3) { pushLog("（通知）すでにドロー済みです。"); return; }

    let deck = data.deck || [];
    if(deck.length < 3) { pushLog("（エラー）山札のカードが足りません。リセットしてください。"); return; }
    
    const drawn = deck.slice(0,3);
    const rest = deck.slice(3);
    const updates = {};

    // ターン4以上でジョーカーがまだなら追加
    if((data.turnCount || 1) >= 4 && !data.jokerEnabled){
      const r = rest.slice();
      const pos = Math.floor(Math.random()*(r.length+1));
      r.splice(pos,0,"J"); 
      updates["deck"] = r;
      updates["jokerEnabled"] = true;
      pushLog("ジョーカーが山札に追加されました（Turn>=4）");
    } else {
      updates["deck"] = rest; 
    }

    updates["pick/hand"] = drawn; 

    if(drawn.includes("J")){
      // ジョーカーを引いた場合、ジョーカーコールフェーズへ移行（ボタン待ち）
      updates["state"] = "draw"; // Pickがコールボタンを押すまではdrawステータスを維持
      updates["turn"] = "pick"; 
      pushLog("ピックがジョーカーをドローしました。ジョーカーコールボタンを押すことができます。");
    } else {
      // 通常ドローの場合、予想フェーズへ移行
      updates["state"] = "guess";
      updates["turn"] = "rack";
      pushLog("ピックが3枚ドローしました（予想フェーズへ）");
    }
    
    return { ...data, ...updates, pick: { ...data.pick, hand: drawn } }; 
  }).catch(error => {
      console.error("ピックドローエラー:", error);
      pushLog(`エラー: ドローに失敗しました (${error.message})`);
  });
}

/**
 * ラックが初期予想を行う
 */
async function rackInitialPredict(){
  if (!db || typeof runTransaction !== 'function') { pushLog("（エラー）データベースが初期化されていません。"); return; }
  const roomRef = ref(db, `rooms/${roomId}`);

  // ジョーカーコールフェーズの予想処理
  const snap = await get(roomRef);
  const currentData = snap.val();

  if (currentData && currentData.state === "joker_call" && currentData.pending && currentData.pending.jokerCallBy){
    return handleJokerCallGuess(roomRef);
  }
  
  // 通常の初期予想フェーズの処理
  if (currentData && currentData.state !== "guess") { pushLog("（エラー）現在予想フェーズではありません"); return; }
  if (!currentData || !currentData.rack || currentData.rack.token !== token) { pushLog("（エラー）あなたはラックではありません"); return; }

  const guess = prompt("初期予想: ピック手札の1枚を予想してください（O/T/X）\n入力: O / T / X");
  if(!guess || !["O","T","X"].includes(guess)) { pushLog("（エラー）O / T / X を入力してください"); return; }
  
  runTransaction(roomRef, (data) => {
    if (data === null) return data; 
    
    if(data.state !== "guess") { pushLog("（エラー）状態が変化しました"); return; }

    const hand = data.pick.hand || [];
    const updates = {};
    const rackHp = data.rack.hp || INITIAL_HP;

    if(hand.includes(guess)){
      // 初期予想的中 -> エクストラへ
      updates["pending"] = { initialGuess: guess };
      updates["state"] = "extra";
      updates["turn"] = "rack";
      pushLog(`ラックの初期予想「${guess}」が的中。エクストラ予想へ移行`);
    } else {
      // 初期予想失敗 -> ラックにダメージ
      let dmg = data.flags && data.flags.doubleDamageActive ? 2 : 1;
      
      if(data.flags && data.flags.shieldRack){
        updates["flags/shieldRack"] = null; // false
        pushLog("ラックの守護がダメージを無効化");
      } else {
        updates["rack/hp"] = rackHp - dmg;
        pushLog(`ラックの初期予想「${guess}」が外れ。ラックに${dmg}ダメージ`);
      }
      
      // ターン終了処理
      updates["flags/doubleDamageActive"] = null;
      updates["flags/revealToRack"] = null;
      updates["pending"] = null;
      updates["state"] = "wait_for_advance"; 
      updates["turn"] = "rack"; 
    }

    return { ...data, ...updates, rack: { ...data.rack, hp: updates["rack/hp"] || rackHp } };
  }).catch(error => {
      console.error("ラック予想トランザクションエラー:", error);
      pushLog(`エラー: 予想処理に失敗しました (${error.message})`);
  });
}

/**
 * ジョーカーコール時のラックの予想処理
 */
async function handleJokerCallGuess(roomRef) {
    const ans = prompt("ジョーカーコール: ピックがジョーカーを所持していると思いますか？\n入力: yes / no");
    if(!ans) { pushLog("（通知）キャンセルされました。"); return; }
    const guessHas = ans.toLowerCase().startsWith("y");

    runTransaction(roomRef, (data) => {
        if (data === null) return data; 
        if(data.state !== "joker_call" || !data.rack || data.rack.token !== token) { pushLog("（エラー）状態が変化しました"); return; }

        const actualHas = (data.pick && (data.pick.hand||[]).includes("J"));
        const updates = {};
        let pickHp = data.pick.hp || INITIAL_HP;
        let rackHp = data.rack.hp || INITIAL_HP;
        let dmg = data.flags && data.flags.doubleDamageActive ? 2 : 1;

        if(guessHas === actualHas){
          // 予想的中
          if(data.flags && data.flags.shieldPick){ 
            updates["flags/shieldPick"] = null; // false
            pushLog("ピックの守護がジョーカーコールを無効化"); 
          }
          else { 
            pickHp -= dmg;
            pushLog(`ジョーカーコール: ラックの予想的中。ピックに${dmg}ダメージ`); 
          }
        } else {
          // 予想失敗
          if(data.flags && data.flags.shieldRack){ 
            updates["flags/shieldRack"] = null; // false
            pushLog("ラックの守護がジョーカーコールを無効化"); 
          }
          else { 
            rackHp -= dmg;
            pushLog(`ジョーカーコール: ラックの予想失敗。ラックに${dmg}ダメージ`); 
          }
        }
        
        // ジョーカーコール後のターン終了処理
        updates["pick/hp"] = pickHp;
        updates["rack/hp"] = rackHp;

        updates["pending"] = null;
        updates["flags/doubleDamageActive"] = null;
        updates["flags/revealToRack"] = null;
        
        // 次のターン進行フェーズへ
        updates["state"] = "wait_for_advance";
        updates["turn"] = "rack";
        
        return { ...data, ...updates, pick: { ...data.pick, hp: pickHp }, rack: { ...data.rack, hp: rackHp } };
    }).catch(error => {
        console.error("ジョーカーコール予想トランザクションエラー:", error);
        pushLog(`エラー: ジョーカーコール予想に失敗しました (${error.message})`);
    });
}


/**
 * ラックがエクストラ予想を行う
 */
async function rackExtraPredict(){
  if (!db || typeof runTransaction !== 'function') { pushLog("（エラー）データベースが初期化されていません。"); return; }
  
  const snap = await get(ref(db, `rooms/${roomId}`));
  const currentData = snap.val();
  if (currentData && currentData.state !== "extra") { pushLog("（エラー）現在エクストラフェーズではありません"); return; }

  const p1 = prompt("エクストラ予想: 残り2枚のうち1つ目（O/T/X）");
  if(!p1 || !["O","T","X"].includes(p1)) return pushLog("（エラー）O/T/X を入力");
  const p2 = prompt("エクストラ予想: 残り2枚のうち2つ目（O/T/X）");
  if(!p2 || !["O","T","X"].includes(p2)) return pushLog("（エラー）O/T/X を入力");
  
  const roomRef = ref(db, `rooms/${roomId}`);

  runTransaction(roomRef, (data) => {
    if (data === null) return data; 
    
    if(data.state !== "extra") { pushLog("（エラー）状態が変化しました"); return; }
    if(!data.rack || data.rack.token !== token) { pushLog("（エラー）あなたはラックではありません"); return; }

    const hand = (data.pick.hand || []).slice();
    const init = data.pending && data.pending.initialGuess;
    if(!init) { pushLog("（エラー）初期予想データがありません"); return; }
    
    const cp = hand.slice();
    const idx = cp.indexOf(init);
    if(idx>=0) cp.splice(idx,1);
    const remaining = cp; // 残りの2枚
    const pickHp = data.pick.hp || INITIAL_HP;

    const preds = [p1,p2];
    
    // エクストラ予想の成否判定（要素と数が完全に一致するか）
    const isMatch = (function(a,b){ 
        if(a.length!==b.length) return false; 
        const m={}; 
        a.forEach(x=>m[x]=(m[x]||0)+1); 
        b.forEach(x=>m[x]=(m[x]||0)-1); 
        return Object.values(m).every(v=>v===0); 
    })(preds, remaining);

    const updates = {};
    if(isMatch){
      // エクストラ予想成功
      let dmg = data.flags && data.flags.doubleDamageActive ? 2 : 1;
      if(data.flags && data.flags.shieldPick){
        updates["flags/shieldPick"] = null; // false
        pushLog("ピックの守護がダメージを無効化");
      } else {
        updates["pick/hp"] = pickHp - dmg;
        pushLog(`エクストラ予想成功！ピックに${dmg}ダメージ`);
      }
    } else {
      pushLog("エクストラ予想失敗。ダメージなし");
    }

    // ターン終了処理
    updates["pending"] = null;
    updates["flags/doubleDamageActive"] = null;
    updates["flags/revealToRack"] = null;
    updates["state"] = "wait_for_advance"; 
    updates["turn"] = "rack"; 

    return { ...data, ...updates, pick: { ...data.pick, hp: updates["pick/hp"] || pickHp } };
  }).catch(error => {
      console.error("エクストラ予想トランザクションエラー:", error);
      pushLog(`エラー: エクストラ予想に失敗しました (${error.message})`);
  });
}

/**
 * ピックがジョーカーコールを発動する
 */
async function pickJokerCall(){
  if (!db || typeof runTransaction !== 'function') { pushLog("（エラー）データベースが初期化されていません。"); return; }
  const roomRef = ref(db, `rooms/${roomId}`);
  
  runTransaction(roomRef, (data) => {
    if (data === null) return data; 

    if(!data.jokerEnabled) { pushLog("（通知）ジョーカーはまだ有効になっていません"); return; }
    if(!data.pick || data.pick.token !== token) { pushLog("（エラー）あなたはピックではありません"); return; }
    if(data.pick.hand.length !== 3) { pushLog("（通知）ドローが完了していません。"); return; }
    if(!data.pick.hand.includes("J")) { pushLog("（通知）ジョーカーを持っていません。"); return; }
    
    if (data.state !== "draw") { pushLog("（通知）ジョーカーコールはドローフェーズでのみ可能です。"); return; }

    pushLog("ピックがジョーカーコールを発動しました（ラックは予想ボタンを押してください）");
    return { ...data, state: "joker_call", pending: { jokerCallBy: "pick" }, turn: "rack" };

  }).catch(error => {
      console.error("ジョーカーコールエラー:", error);
      pushLog(`エラー: ジョーカーコールに失敗しました (${error.message})`);
  });
}

/* --------------------
   Item Usage
   -------------------- */
/**
 * アイテム使用の確認UI
 */
function useItemUI(itemKey){
  // alert/confirmは使えないため、promptを代替として使用
  const result = prompt(`アイテム「${itemKey}」を使用しますか？\n「使用する」と入力してください。`);
  if(result === "使用する") {
      useItem(itemKey);
  } else {
      pushLog("（通知）アイテム使用がキャンセルされました。");
  }
}

/**
 * アイテムの使用処理
 */
async function useItem(itemKey){
  if (!db || typeof runTransaction !== 'function') { pushLog("（エラー）データベースが初期化されていません。"); return; }
  const roomRef = ref(db, `rooms/${roomId}`);

  runTransaction(roomRef, (data) => {
    if (data === null) return data; 
    
    const isLocalRack = data.rack && data.rack.token === token;
    const myRoleData = isLocalRack ? data.rack : null;
    
    if(!myRoleData) { pushLog("（エラー）アイテムは現在のラックプレイヤーのみ使用可"); return; }
    if(myRoleData.hp > 2) { pushLog("（エラー）アイテムは HP が 2 以下のときのみ使用できます"); return; }
    if(!myRoleData.item || myRoleData.itemUsed) { pushLog("（エラー）アイテムがないか既に**使用済み**です"); return; }
    if(myRoleData.item !== itemKey) { pushLog("（エラー）アイテムキーが一致しません。"); return; }
    
    // アイテムはターンに影響しないので、Pickのアイテムも使えますが、今回はRackのアイテムのみを実装
    if (data.turn !== 'rack' && data.state !== 'guess' && data.state !== 'extra') {
         pushLog("（エラー）アイテムは予想フェーズでのみ使用可能です。"); return;
    }
    
    const updates = {};
    const rolePath = "rack"; 

    if(itemKey === "Peek2"){
      // Pickの手札の上から2枚をRackに公開
      const reveal = (data.pick && data.pick.hand) ? data.pick.hand.slice(0,2) : [];
      updates["flags/revealToRack"] = reveal;
      updates[`${rolePath}/itemUsed`] = true;
      pushLog("ラックがPeek2を使用しました。ピックの最初の2枚が公開されました。");
    } else if(itemKey === "Shield1"){
      // 次のRackへのダメージを無効化（ジョーカーコール含む）
      updates["flags/shieldRack"] = true;
      updates[`${rolePath}/itemUsed`] = true;
      pushLog("ラックがShield1を使用しました（次の被ダメージを無効化）");
    } else if(itemKey === "DoubleDamage"){
      // 今ターンの与ダメージを2倍
      updates["flags/doubleDamageActive"] = true;
      updates[`${rolePath}/itemUsed`] = true;
      pushLog("ラックがDoubleDamageを使用しました（今ターンの与ダメージ2倍）");
    } else if(itemKey === "ForceDeclare"){
      // Pickの手札に含まれていない種類を公開し、ターン終了
      const hand = data.pick.hand || [];
      const counts = {};
      CARD_TYPES.forEach(t => counts[t] = hand.filter(c => c === t).length);
      
      const missing = CARD_TYPES.filter(t => counts[t] === 0);

      updates[`${rolePath}/itemUsed`] = true;
      
      let logMsg = `ラックがForceDeclareを使用しました。`;
      if (missing.length === 0) {
          logMsg += "ピックの手札には全ての種類（O, T, X）が含まれていました。";
      } else {
          logMsg += `ピックの手札に**含まれていない**のは: ${missing.join(", ")} です。`;
      }
      pushLog(logMsg);
      
      // ForceDeclareはターンを終了させる
      updates["pending"] = null;
      updates["flags/doubleDamageActive"] = null;
      updates["flags/revealToRack"] = null;
      updates["state"] = "wait_for_advance"; 
      updates["turn"] = "rack"; 

    } else {
        pushLog("（エラー）不明なアイテムキーです。");
        return;
    }

    const newRackData = { ...data.rack, itemUsed: updates[`${rolePath}/itemUsed`] || data.rack.itemUsed };
    const newData = { ...data, ...updates, rack: newRackData };
    return newData;
  }).catch(error => {
      console.error("アイテム使用トランザクションエラー:", error);
      pushLog(`エラー: アイテム使用に失敗しました (${error.message})`);
  });
}


/* --------------------
   Reset Game
   -------------------- */
async function resetGame(){
  if (!db || typeof runTransaction !== 'function') { pushLog("（エラー）データベースが初期化されていません。"); return; }
  if(!roomId) return pushLog("（エラー）まずルーム作成/参加してください");
  
  const confirmResult = prompt("同ルームで新規ゲームを開始しますか？（「はい」と入力）");
  if(confirmResult !== "はい") return pushLog("（通知）リセットがキャンセルされました。");
  
  const roomRef = ref(db, `rooms/${roomId}`);
  
  runTransaction(roomRef, (data) => {
    if (data === null) return data;

    const deck = [];
    for(let i=0;i<10;i++){ deck.push("O"); deck.push("T"); deck.push("X"); }
    shuffle(deck);
    
    const newPickItem = ITEM_KEYS[Math.floor(Math.random()*ITEM_KEYS.length)];
    const newRackItem = ITEM_KEYS[Math.floor(Math.random()*ITEM_KEYS.length)];

    const updates = {
      turnCount: 1,
      state: "draw",
      deck,
      jokerEnabled: false,
      flags: {},
      pending: null,
      turn: "pick",
      // Pickは既存のトークンを維持しつつHPと手札をリセット、新しいアイテムを割り当てる
      pick: { ...data.pick, hp: INITIAL_HP, hand: [], item: newPickItem, itemUsed: false },
      // Rackも同様にリセット
      rack: { ...data.rack, hp: INITIAL_HP, hand: [], item: newRackItem, itemUsed: false },
      usedCards: [],
    };
    
    updates.log = (data.log || []);
    updates.log.push(`[${now()}] ゲームリセットが実行されました。`);

    return updates;

  }).catch(error => {
    console.error("ゲームリセットエラー:", error);
    pushLog(`エラー: ゲームリセットに失敗しました (${error.message})`);
  });
}
