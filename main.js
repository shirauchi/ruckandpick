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
  // ここを自身のFirebase設定に置き換えてください
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

// ★★★ 修正箇所: カード画像パスを相対パスと指定ファイル名に変更 ★★★
const CARD_SRC = { 
    O: "/cards/maru.png", 
    T: "/cards/sankaku.png", 
    X: "/cards/batsu.png", 
    J: "/cards/JOKER.png" // ジョーカーはそのままJOKER.pngと仮定
};

// ★★★ 修正箇所: アイテム画像パスを相対パスと指定ファイル名に変更 ★★★
const ITEM_SRC = {
  Peek2: "/cards/item_see.png",
  Shield1: "/cards/item_shield.png",
  DoubleDamage: "/cards/item_double.png",
  ForceDeclare: "/cards/item_call.png",
};
const ITEM_KEYS = ["Peek2", "Shield1", "DoubleDamage", "ForceDeclare"];
// 裏面カードのパスを仮定 (もし違う場合は変更が必要です)
const BACK_CARD_SRC = "/cards/BACK.png"; 

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

async function resetGame(){
  // RoomIdがなければリセットできない
  if (!roomId) return pushLog("（エラー）リセットするルームがありません。");
  if (!db || typeof set !== 'function') { pushLog("（エラー）データベースが初期化されていません。"); return; }

  // 確認ダイアログ
  if (!confirm(`ルーム ${roomId} のゲームをリセットしてよろしいですか？\n(全てのゲームデータが初期化されます)`)) {
      return pushLog("（通知）リセットがキャンセルされました。");
  }

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
    // pick/rack の token, hp, hand, item, itemUsed の情報はそのまま残す
    pick: { 
        hp: INITIAL_HP, 
        hand: [], 
        token: null, // トークンはjoin時に再設定
        item: ITEM_KEYS[Math.floor(Math.random()*ITEM_KEYS.length)], 
        itemUsed: false 
    },
    rack: { 
        hp: INITIAL_HP, 
        hand: [], 
        token: null, // トークンはjoin時に再設定
        item: ITEM_KEYS[Math.floor(Math.random()*ITEM_KEYS.length)], 
        itemUsed: false 
    }, 
    usedCards: [],
    log: [`[${now()}] ゲームがリセットされました。`],
  };

  try {
    const roomRef = ref(db, `rooms/${roomId}`);
    // 現在のトークン情報を保持するため、一旦fetchしてマージ
    const currentSnap = await get(roomRef);
    if(currentSnap.exists()){
        const currentData = currentSnap.val();
        init.pick.token = currentData.pick ? currentData.pick.token : null;
        init.rack.token = currentData.rack ? currentData.rack.token : null;
    }
    
    await set(roomRef, init);
    pushLog(`ルーム ${roomId} のゲームデータをリセットしました。`);
  } catch (error) {
    console.error("リセットエラー:", error);
    pushLog(`エラー: リセットに失敗しました (${error.message})`);
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
      // 山札の裏側画像を表示
      el.topImg.style.display = "block";
      el.topImg.src = BACK_CARD_SRC; 
    }
  } else {
    el.topImg.style.display = "none";
  }

  // ピックの手札（公開予想エリア）表示
  el.pickHand.innerHTML = "";
  const pickHand = (data.pick && data.pick.hand) ? data.pick.hand : [];
  // Pick手札は常に裏面画像を表示（ジョーカーコール時も、Rackは予想するだけ）
  pickHand.forEach(c=>{
    const box = document.createElement("div"); box.className = "card";
    const img = document.createElement("img"); 
    img.className = "imgcard"; 
    img.src = BACK_CARD_SRC; 
    box.appendChild(img);
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
      const title = document.createElement("div");
      title.className = "small";
      title.textContent = "Peek2で確認したカード:";
      el.peekArea.appendChild(title);

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
  img.src = ITEM_SRC[itemKey] || "";
  
  base.appendChild(img);
  wrapper.appendChild(base);

  const rackHp = data.rack ? data.rack.hp : 0;
  // ★★★ 修正箇所: アイテム使用条件を Rack かつ未使用 かつ HP <= 2 に変更 ★★★
  const canUseItem = isLocalRack && rackHp <= 2 && !used; 
  
  if(canUseItem){
    base.style.cursor = "pointer";
    // クリックイベントでアイテム使用UIを起動
    base.addEventListener("click", ()=> useItemUI(itemKey)); 
    base.title = `${itemKey} (クリックで使用可能)`;
  } else {
    // 使用済みのマスク表示
    if(used){
        const mask = document.createElement("div");
        mask.className = "used-mask";
        mask.textContent = "USED"; // 使用済みテキスト
        wrapper.appendChild(mask);
    } else if (isLocalRack) {
        // HPが足りないなどで使えない場合は少し暗く表示
        base.style.opacity = 0.5;
        base.title = `HPが2以下の時のみ使用可能 (${itemKey})`;
    } else {
        base.title = `${itemKey}`;
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
        el.btnPredict.textContent = "ジョーカー予想"; // UIテキストの変更
    } else {
        el.btnPredict.textContent = "ラックの初期予想（ラックのみ）"; // 元に戻す
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
        updates["flags/doubleDamageActive"] = null; // nullで初期化
        updates["flags/revealToRack"] = null; // nullで初期化
        updates["pending"] = null; 
        
        // Shieldの状態は次のターンまで維持される
        
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
 * ピックがジョーカーコールを行う
 */
async function pickJokerCall(){
    if (!db || typeof runTransaction !== 'function') { pushLog("（エラー）データベースが初期化されていません。"); return; }
    const roomRef = ref(db, `rooms/${roomId}`);

    runTransaction(roomRef, (data) => {
        if (data === null) return data; 

        if(data.state !== "draw") { pushLog("（エラー）現在ドローフェーズではありません"); return; }
        if(!data.pick || data.pick.token !== token) { pushLog("（エラー）あなたはピックではありません"); return; }
        if(!(data.pick.hand || []).includes("J")) { pushLog("（エラー）ジョーカーを所持していません"); return; }

        const updates = {};
        updates["state"] = "joker_call";
        updates["turn"] = "rack";
        updates["pending"] = { jokerCallBy: "pick" }; 
        
        pushLog("ピックがジョーカーコールを宣言しました（ラックの予想待ち）");
        
        return { ...data, ...updates, pending: updates["pending"] };
    }).catch(error => {
        console.error("ジョーカーコール宣言エラー:", error);
        pushLog(`エラー: ジョーカーコール宣言に失敗しました (${error.message})`);
    });
}


/**
 * ラックが初期予想を行う
 */
async function rackInitialPredict(){
  if (!db || typeof runTransaction !== 'function') { pushLog("（エラー）データベースが初期化されていません。"); return; }
  const roomRef = ref(db, `rooms/${roomId}`);

  const snap = await get(roomRef);
  const currentData = snap.val();
  
  // ジョーカーコールフェーズの予想処理
  if (currentData && currentData.state === "joker_call" && currentData.pending && currentData.pending.jokerCallBy){
    return handleJokerCallGuess(roomRef);
  }
  
  // 通常の初期予想フェーズの処理
  if (currentData && currentData.state !== "guess") { pushLog("（エラー）現在予想フェーズではありません"); return; }
  if (!currentData || !currentData.rack || currentData.rack.token !== token) { pushLog("（エラー）あなたはラックではありません"); return; }

  const guess = prompt("初期予想: ピック手札の1枚を予想してください（O/T/X）\n入力: O / T / X");
  if(!guess || !CARD_TYPES.includes(guess)) { pushLog("（エラー）O / T / X を入力してください"); return; }
  
  runTransaction(roomRef, (data) => {
    if (data === null) return data; 
    
    if(data.state !== "guess") { pushLog("（エラー）状態が変化しました"); return; }

    const hand = data.pick.hand || [];
    const updates = {};
    const rackHp = data.rack.hp || INITIAL_HP;
    const pickHp = data.pick.hp || INITIAL_HP;

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
        updates["flags/shieldRack"] = null; // nullで初期化
        pushLog("ラックの守護がダメージを無効化");
        updates["rack/hp"] = rackHp; // HPは変わらない
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

    return { ...data, ...updates }; // HP変更はupdatesに含まれる
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
            updates["flags/shieldPick"] = null; // nullで初期化
            pushLog("ピックの守護がジョーカーコールを無効化"); 
            updates["pick/hp"] = pickHp;
          }
          else { 
            updates["pick/hp"] = pickHp - dmg;
            pushLog(`ジョーカーコール: ラックの予想的中。ピックに${dmg}ダメージ`); 
          }
        } else {
          // 予想失敗
          if(data.flags && data.flags.shieldRack){ 
            updates["flags/shieldRack"] = null; // nullで初期化
            pushLog("ラックの守護がジョーカーコールを無効化"); 
            updates["rack/hp"] = rackHp;
          }
          else { 
            updates["rack/hp"] = rackHp - dmg;
            pushLog(`ジョーカーコール: ラックの予想失敗。ラックに${dmg}ダメージ`); 
          }
        }
        
        // ジョーカーコール後のターン終了処理
        updates["pending"] = null;
        updates["flags/doubleDamageActive"] = null;
        updates["flags/revealToRack"] = null;
        
        // 次のターン進行フェーズへ
        updates["state"] = "wait_for_advance";
        updates["turn"] = "rack";
        
        return { ...data, ...updates };
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
  if(!p1 || !CARD_TYPES.includes(p1)) return pushLog("（エラー）O/T/X を入力");
  const p2 = prompt("エクストラ予想: 残り2枚のうち2つ目（O/T/X）");
  if(!p2 || !CARD_TYPES.includes(p2)) return pushLog("（エラー）O/T/X を入力");
  
  const predictedPair = [p1, p2].sort().join(""); // 例: "OT"

  runTransaction(ref(db, `rooms/${roomId}`), (data) => {
    if (data === null) return data; 
    if(data.state !== "extra") { pushLog("（エラー）状態が変化しました"); return; }

    const hand = data.pick.hand || [];
    const initialGuess = data.pending ? data.pending.initialGuess : null;
    if(!initialGuess) { pushLog("（エラー）初期予想情報が見つかりません"); return; }

    // 初期予想カードを除いた残り2枚を抽出 (ジョーカーは無視)
    const remainingCards = hand.filter(c => c !== "J");
    const initialIndex = remainingCards.indexOf(initialGuess);
    if (initialIndex > -1) remainingCards.splice(initialIndex, 1);
    
    // 予想対象のペア
    const actualPair = remainingCards.slice(0, 2).sort().join(""); // 例: "TX"
    
    const updates = {};
    const rackHp = data.rack.hp || INITIAL_HP;
    const pickHp = data.pick.hp || INITIAL_HP;

    if(predictedPair === actualPair){
      // エクストラ予想的中 -> ピックにダメージ
      let dmg = data.flags && data.flags.doubleDamageActive ? 2 : 1;
      
      if(data.flags && data.flags.shieldPick){
        updates["flags/shieldPick"] = null; // nullで初期化
        updates["pick/hp"] = pickHp;
        pushLog("ピックの守護がダメージを無効化");
      } else {
        updates["pick/hp"] = pickHp - dmg;
        pushLog(`ラックのエクストラ予想「${p1}, ${p2}」が的中。ピックに${dmg}ダメージ`);
      }
      
    } else {
      // エクストラ予想失敗 -> ラックにダメージ
      let dmg = 1; // エクストラ予想失敗は常に1ダメージ
      
      if(data.flags && data.flags.shieldRack){
        updates["flags/shieldRack"] = null; // nullで初期化
        updates["rack/hp"] = rackHp;
        pushLog("ラックの守護がダメージを無効化");
      } else {
        updates["rack/hp"] = rackHp - dmg;
        pushLog(`ラックのエクストラ予想「${p1}, ${p2}」が外れ。ラックに1ダメージ`);
      }
    }

    // ターン終了処理
    updates["flags/doubleDamageActive"] = null;
    updates["flags/revealToRack"] = null;
    updates["pending"] = null;
    updates["state"] = "wait_for_advance"; 
    updates["turn"] = "rack"; 

    return { ...data, ...updates };
  }).catch(error => {
      console.error("エクストラ予想トランザクションエラー:", error);
      pushLog(`エラー: エクストラ予想に失敗しました (${error.message})`);
  });
}


/**
 * アイテム使用のUI表示（Rackのみ）
 */
function useItemUI(itemKey){
  // 簡易的な確認ダイアログ
  if (confirm(`アイテム「${itemKey}」を使用しますか？\n(HP2以下の時のみ有効)`)) {
    applyItemEffect(itemKey);
  } else {
    pushLog(`（通知）アイテム「${itemKey}」の使用をキャンセルしました。`);
  }
}

/**
 * アイテムの効果を適用するトランザクション処理
 */
async function applyItemEffect(itemKey){
  if (!db || typeof runTransaction !== 'function') { pushLog("（エラー）データベースが初期化されていません。"); return; }
  const roomRef = ref(db, `rooms/${roomId}`);

  runTransaction(roomRef, (data) => {
    if (data === null) return data; 
    
    const isLocalRack = data.rack && data.rack.token === token;
    const rackHp = data.rack.hp || INITIAL_HP;

    if(!isLocalRack) { pushLog("（エラー）あなたはラックではありません。"); return; }
    if(data.rack.item !== itemKey || data.rack.itemUsed) { pushLog("（エラー）アイテムは使用済みか、所持していません。"); return; }
    if(rackHp > 2) { pushLog("（エラー）アイテム使用条件（HP2以下）を満たしていません。"); return; }
    
    const updates = { "rack/itemUsed": true };

    switch(itemKey){
      case "Peek2":
        // 山札の上から2枚を読み込み、Rackにのみ公開するフラグをセット
        const deck = data.deck || [];
        if(deck.length < 2) { 
            pushLog("（エラー）山札のカードが2枚未満のため、Peek2は使用できません。"); 
            updates["rack/itemUsed"] = false; // 使用フラグを元に戻す
            return { ...data, ...updates }; 
        }
        updates["flags/revealToRack"] = deck.slice(0, 2);
        pushLog("Peek2を使用: 山札のトップ2枚を確認しました。");
        break;
      case "Shield1":
        // Rackの守護フラグをセット
        updates["flags/shieldRack"] = true;
        pushLog("Shield1を使用: ラックに守護効果を付与しました。");
        break;
      case "DoubleDamage":
        // ダメージ2倍フラグをセット
        updates["flags/doubleDamageActive"] = true;
        pushLog("DoubleDamageを使用: 次の予想ダメージが2倍になります。");
        break;
      case "ForceDeclare":
        // Pickにジョーカーコールを強制する（ジョーカー所持の場合）
        if(!(data.pick.hand || []).includes("J")) {
             pushLog("ForceDeclareを使用: ピックはジョーカーを所持していません（効果なし）。");
        } else {
            // 強制ジョーカーコール処理
            updates["state"] = "joker_call";
            updates["turn"] = "rack"; // そのままラックのターン
            updates["pending"] = { jokerCallBy: "rack" }; // ラック側の強制コール
            pushLog("ForceDeclareを使用: ピックにジョーカーコールを強制しました（ラックの予想待ち）。");
        }
        break;
    }

    return { ...data, ...updates };
  }).catch(error => {
      console.error("アイテム使用トランザクションエラー:", error);
      pushLog(`エラー: アイテム使用に失敗しました (${error.message})`);
  });
}

// 初期化時にルームIDが設定されていたら自動で参加（トークンが設定されていれば再接続として機能）
if (el.roomInput.value.trim()) {
    joinRoom();
}
