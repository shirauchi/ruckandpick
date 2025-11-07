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
const fallbackConfig = {
  apiKey: "AIzaSyB4wWBozfQ2A-2IppWjIGlOYmajSKBtOtM",
  authDomain: "luckandpick.firebaseapp.com",
  databaseURL: "https://luckandpick-default-rtdb.asia-southeast1.firebasedatabase.app/",
  projectId: "luckandpick",
  storageBucket: "luckandpick.firebasestorage.app",
  messagingSenderId: "116413627559",
  appId: "1:116413627559:web:51cf6dbc64eb25c060ef82"
};

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
  luckHp: document.getElementById("luckHp"),
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

const CARD_SRC = { 
    O: "cards/maru.png", 
    T: "cards/sankaku.png", 
    X: "cards/batsu.png", 
    J: "cards/JOKER.png"
};

const ITEM_SRC = {
  Peek2: "cards/item_see.png",
  Shield1: "cards/item_shield.png",
  DoubleDamage: "cards/item_double.png",
  ForceDeclare: "cards/item_call.png",
};
const ITEM_KEYS = ["Peek2", "Shield1", "DoubleDamage", "ForceDeclare"];
const BACK_CARD_SRC = "cards/BACK.png"; 

/* --------------------
   Local State
   -------------------- */
let roomId = null;
let token = Math.random().toString(36).slice(2, 9);
let localRole = null; 
let unsubscribe = null; 
let thinkTimeInterval = null; // タイマーIDを保持

/* --------------------
   Helpers
   -------------------- */
function shuffle(a){ for(let i=a.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[a[i],a[j]]=[a[j],a[i]];} return a; }
function now(){ return new Date().toLocaleTimeString(); }
    
function pushLog(text){
  if(!el.logArea) return;
  
  const logEntry = `[${now()}] ${text}`;
  
  el.logArea.textContent += `${logEntry}\n`;
  el.logArea.scrollTop = el.logArea.scrollHeight;
  
  if(!roomId || !db || typeof runTransaction !== 'function') return;

  const node = ref(db, `rooms/${roomId}/log`);
  runTransaction(node, cur => {
    cur = cur || [];
    cur.push(logEntry);
    if(cur.length>300) cur.shift();
    return cur;
  }).catch(err => console.warn("Failed to push log to Firebase:", err));
}

// FIX: 役割交代関数 (HP, アイテムはプレイヤーに紐づくため、役割と共にスワップされる)
function swapRoles(currentPick, currentLuck) {
  const nextPick = { // 新しいPickは、以前Luckだったプレイヤーのステータスを引き継ぐ
    hp: currentLuck.hp,
    token: currentLuck.token,
    hand: [], // 手札はクリア
    item: currentLuck.item,
    itemUsed: currentLuck.itemUsed, 
  };
  const nextLuck = { // 新しいLuckは、以前Pickだったプレイヤーのステータスを引き継ぐ
    hp: currentPick.hp,
    token: currentPick.token,
    hand: [], // 手札はクリア
    item: currentPick.item,
    itemUsed: currentPick.itemUsed, 
  };
  return { nextPick, nextLuck };
}

/* --------------------
   UI Binding
   -------------------- */
el.btnCreate.addEventListener("click", createRoom);
el.btnJoin.addEventListener("click", joinRoom);
el.btnReset.addEventListener("click", resetGame);
el.btnDraw.addEventListener("click", pickDraw);
el.btnPredict.addEventListener("click", luckInitialPredict);
el.btnExtra.addEventListener("click", luckExtraPredict);
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
    state: "draw",
    deck,
    jokerEnabled: false, 
    flags: {},
    pending: null,
    timer: null, // NEW: タイマーを追加
    turn: "pick", 
    pick: { hp: INITIAL_HP, hand: [], token, item: ITEM_KEYS[Math.floor(Math.random()*ITEM_KEYS.length)], itemUsed: false },
    luck: { hp: INITIAL_HP, hand: [], token: null, item: ITEM_KEYS[Math.floor(Math.random()*ITEM_KEYS.length)], itemUsed: false }, 
    usedCards: [],
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
  if (!db || typeof get !== 'function' || typeof update !== 'function') { 
    pushLog("（エラー）データベースが初期化されていません。"); 
    return; 
  }

  const rid = el.roomInput.value.trim();
  if(!rid) {
    pushLog("（エラー）ルームIDを入力してください");
    return;
  }
  
  try {
    const roomRef = ref(db, `rooms/${rid}`);
    const s = await get(roomRef);
    
    if(!s.exists()) {
      pushLog("（エラー）そのルームは存在しません");
      return;
    }
    
    const data = s.val();
    
    // 既存プレイヤーの再接続チェック
    if (data.pick && data.pick.token === token) {
      roomId = rid;
      localRole = "pick";
      el.roomIdText.textContent = rid;
      el.roleText.textContent = `プレイヤーA (pick)`;
      pushLog(`ルーム再接続: ${rid}（ピック）`);
      watchRoom(rid);
      return;
    }
    
    if (data.luck && data.luck.token === token) {
      roomId = rid;
      localRole = "luck";
      el.roomIdText.textContent = rid;
      el.roleText.textContent = `プレイヤーB (luck)`;
      pushLog(`ルーム再接続: ${rid}（ラック）`);
      watchRoom(rid);
      return;
    }
    
    // 新規参加処理
    if (!data.luck || !data.luck.token) {
      // Luckとして参加
      await update(roomRef, {
        "luck/token": token
      });
      
      roomId = rid;
      localRole = "luck";
      el.roomIdText.textContent = rid;
      el.roleText.textContent = `プレイヤーB (luck)`;
      pushLog(`ルーム参加: ${rid}（ラック）`);
      watchRoom(rid);
    } else {
      pushLog("（エラー）このルームにはすでに2人のプレイヤーがいます。");
    }

  } catch (error) {
    console.error("ルーム参加エラー:", error);
    pushLog(`エラー: ルーム参加に失敗しました (${error.message})`);
  }
}

async function resetGame(){
  if (!roomId) return pushLog("（エラー）リセットするルームがありません。");
  if (!db || typeof set !== 'function') { pushLog("（エラー）データベースが初期化されていません。"); return; }

  if (!confirm(`ルーム ${roomId} のゲームをリセットしてよろしいですか？\n(全てのゲームデータが初期化されます)`)) {
      return pushLog("（通知）リセットがキャンセルされました。");
  }

  const deck = [];
  for(let i=0;i<10;i++){ deck.push("O"); deck.push("T"); deck.push("X"); }
  shuffle(deck);

  try {
    const roomRef = ref(db, `rooms/${roomId}`);
    const currentSnap = await get(roomRef);
    
    const init = {
      turnCount: 1,
      state: "draw",
      deck,
      jokerEnabled: false, 
      flags: {},
      pending: null, 
      timer: null, // NEW: タイマーもリセット
      turn: "pick", 
      pick: { 
          hp: INITIAL_HP, 
          hand: [], 
          token: null,
          item: ITEM_KEYS[Math.floor(Math.random()*ITEM_KEYS.length)], 
          itemUsed: false 
      },
      luck: { 
          hp: INITIAL_HP, 
          hand: [], 
          token: null,
          item: ITEM_KEYS[Math.floor(Math.random()*ITEM_KEYS.length)], 
          itemUsed: false 
      }, 
      usedCards: [],
      log: [`[${now()}] ゲームがリセットされました。`],
    };
    
    if(currentSnap.exists()){
        const currentData = currentSnap.val();
        init.pick.token = currentData.pick ? currentData.pick.token : null;
        init.luck.token = currentData.luck ? currentData.luck.token : null;
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
  const isLocalPick = data.pick && data.pick.token === token;
  const isLocalLuck = data.luck && data.luck.token === token;
  const localRole = isLocalPick ? "pick" : isLocalLuck ? "luck" : null;
  
  el.turnText.textContent = data.turnCount || "-";
  el.pickHp.textContent = (data.pick && data.pick.hp!=null) ? data.pick.hp : "-";
  el.luckHp.textContent = (data.luck && data.luck.hp!=null) ? data.luck.hp : "-";

  // 状態表示 (Think Time中の場合はタイマーを表示)
  if ((data.state === "draw" || data.state === "think_time") && data.timer != null) {
      el.stateText.textContent = `${data.state.toUpperCase()}: ${data.timer.toFixed(1)}秒`;
  } else {
      el.stateText.textContent = data.state || "-";
  }
  
  const currentRole = isLocalPick ? "Pick" : isLocalLuck ? "Luck" : localRole ? `観戦(${localRole})` : "観戦";
  const initialRole = localRole === "pick" ? "A" : localRole === "luck" ? "B" : "";
  el.roleText.textContent = `プレイヤー${initialRole} (${currentRole})`;

  // 山札のトップカード表示（Luckのみ）
  // ... (変更なし) ...
  const topCard = data.deck && data.deck.length > 0 ? data.deck[0] : null;
  el.topImg.src = (isLocalLuck && topCard) ? CARD_SRC[topCard] : BACK_CARD_SRC;

  // ピックの手札（公開予想エリア）表示
  const pickHand = data.pick && data.pick.hand ? data.pick.hand : [];
  el.pickHand.innerHTML = pickHand.map(c => `<img src="${CARD_SRC[c]}" class="card-img" />`).join("");

  // 自分の手札（ローカル）表示
  const localPlayer = localRole === "pick" ? data.pick : localRole === "luck" ? data.luck : null;
  const localHand = localPlayer && localPlayer.hand ? localPlayer.hand : [];
  el.localHand.innerHTML = localHand.map(c => `<img src="${CARD_SRC[c]}" class="card-img" />`).join("");

  // アイテム情報表示
  el.myItemText.textContent = localPlayer && localPlayer.item ? `${localPlayer.item} (${localPlayer.itemUsed ? '使用済' : '未'})` : "なし";
  
  if (localRole === "luck" && localPlayer) {
      renderItemArea(localPlayer.item, localPlayer.itemUsed, data, isLocalLuck);
  } else {
      el.itemArea.innerHTML = ''; 
  }

  // 使用済みカードエリア表示
  el.usedCardArea.innerHTML = (data.usedCards || []).map(c => `<img src="${CARD_SRC[c]}" class="card-img small-card" />`).join("");
  
  // Peek2による公開情報（Luckのみ）
  const revealCards = data.flags && data.flags.revealToLuck ? data.flags.revealToLuck : null;
  el.peekArea.innerHTML = (isLocalLuck && revealCards) 
      ? revealCards.map(c => `<img src="${CARD_SRC[c]}" class="card-img small-card" />`).join("")
      : "";

  // NEW: ForceDeclareによる宣言情報の公開（Luckのみ）
  const declareText = data.flags && data.flags.forceDeclareText ? data.flags.forceDeclareText : null;
  let declareEl = document.getElementById("declareText");
  let declareContainer = document.getElementById("declareContainer");
  
  if(isLocalLuck && declareText){
      if(!declareContainer){
          // エリアがなければ作成
          declareContainer = document.createElement('div');
          declareContainer.id = "declareContainer";
          declareContainer.style.marginTop = "16px";
          declareContainer.innerHTML = `
              <div class="small" style="color:#ffc42e;">ForceDeclareによる宣言</div>
              <div id="declareText" style="font-weight:bold;color:#ffc42e;min-height:20px;"></div>
          `;
          el.peekArea.insertAdjacentElement('afterend', declareContainer);
          declareEl = document.getElementById("declareText");
      } else {
          declareEl = document.getElementById("declareText");
      }
      declareEl.textContent = declareText;
  } else if (declareContainer) {
      // Luckではない、またはフラグがクリアされたら削除
      declareContainer.remove();
  }
  
  // ログ表示
  el.logArea.textContent = (data.log || []).slice(-300).join("\n");
  el.logArea.scrollTop = el.logArea.scrollHeight;

  // ボタンの状態更新
  updateButtons(data, isLocalPick, isLocalLuck); 

  /* =======================================
     NEW: Think Time Timer Logic (クライアント側で実行)
     ======================================= */
  if (thinkTimeInterval) {
      clearInterval(thinkTimeInterval);
      thinkTimeInterval = null;
  }
  
  // Pickかつ、drawまたはthink_time状態の場合にタイマーを起動
  if (isLocalPick && (data.state === "draw" || data.state === "think_time") && data.timer != null) {
      if (!thinkTimeInterval) {
          thinkTimeInterval = setInterval(() => {
              const roomRef = ref(db, 'rooms/' + roomId);
              runTransaction(roomRef, (currentData) => {
                  if (currentData && (currentData.state === "draw" || currentData.state === "think_time") && currentData.timer != null) {
                      // 0.1秒減らす
                      currentData.timer = Math.max(0.0, currentData.timer - 0.1);
                      
                      // 0.5秒以下で自動実行/自動遷移
                      if (currentData.timer <= 0.5) {
                          const hand = currentData.pick.hand || [];
                          const isJokerDrawn = hand.includes("J");
                          
                          if (isJokerDrawn && currentData.state === "draw") {
                              // 義務未押下 -> 自動でジョーカーコール実行
                              currentData.state = "joker_call";
                              currentData.turn = "luck";
                              currentData.pending = { jokerCallBy: "auto" }; 
                              pushLog("ピックがジョーカーを引いたため、自動でジョーカーコールが実行されました。");
                          } else {
                              // 権利未行使 or 義務（state: draw）ではない -> guess へ自動遷移
                              currentData.state = "guess";
                              currentData.turn = "luck";
                              pushLog("Think Time終了。ジョーカーコールは宣言されませんでした（予想フェーズへ）。");
                          }
                          
                          currentData.timer = null;
                      }
                  }
                  return currentData;
              });
          }, 100); // 100ms (0.1秒) ごとに実行
      }
  } else {
      // タイマーが不要な状態ではクライアント側のタイマーをクリア
      if (thinkTimeInterval) {
          clearInterval(thinkTimeInterval);
          thinkTimeInterval = null;
      }
  }

  /* =======================================
     NEW: ゲームオーバー判定 (HPと山札切れ)
     ======================================= */
  const deck = data.deck || [];
  
  // HPが0以下、または山札が0枚になったらゲームオーバー判定を行う
  if(data.state !== "game_over" && ((data.pick && data.pick.hp<=0) || (data.luck && data.luck.hp<=0) || deck.length === 0)){
    
    let winner = null;
    let message = "";
    
    if((data.pick && data.pick.hp<=0) || (data.luck && data.luck.hp<=0)){
        // HPによる勝敗
        const loser = (data.pick && data.pick.hp<=0) ? "ピック" : "ラック";
        winner = loser==="ピック" ? "ラック" : "ピック";
        message = `HPが0になりゲーム終了！ ${winner} の勝利です。`;
    } else if (deck.length === 0) {
        // 山札切れによる勝敗
        const pickHp = data.pick.hp || 0;
        const luckHp = data.luck.hp || 0;
        
        if (pickHp > luckHp) {
            winner = "ピック";
            message = `山札切れによりゲーム終了。HP差でピック (${pickHp}HP) の勝利！`;
        } else if (luckHp > pickHp) {
            winner = "ラック";
            message = `山札切れによりゲーム終了。HP差でラック (${luckHp}HP) の勝利！`;
        } else {
            winner = "draw";
            message = "山札切れによりゲーム終了。HP同点のため引き分けです。";
        }
    }
    
    if(data.state !== "game_over"){
        pushLog(`*** ${message} ***`);
        runTransaction(ref(db, `rooms/${roomId}`), (currentData) => {
            if (currentData) {
                currentData.state = "game_over";
                currentData.winner = winner;
            }
            return currentData;
        });
    }
  }
}

function renderItemArea(itemKey, used, data, isLocalLuck){ 
  // ... (変更なし) ...
  el.itemArea.innerHTML = '';
  if(!itemKey) return;
  
  const itemWrapper = document.createElement('div');
  itemWrapper.className = `item-card-wrapper ${used ? 'used' : ''}`;
  itemWrapper.title = used ? `${itemKey} (使用済)` : `${itemKey} (未)`;
  
  const itemBase = document.createElement('div');
  itemBase.className = 'item-card-base';
  
  const itemImg = document.createElement('img');
  itemImg.src = ITEM_SRC[itemKey];
  itemImg.className = 'card-img item-img';
  
  itemBase.appendChild(itemImg);
  itemWrapper.appendChild(itemBase);
  el.itemArea.appendChild(itemWrapper);
  
  // アイテム使用ボタンの追加（Luckかつ未使用の場合）
  if (isLocalLuck && !used) {
      const btn = document.createElement('button');
      btn.textContent = "使用";
      btn.style.marginTop = "4px";
      btn.onclick = () => useItemUI(itemKey);
      el.itemArea.appendChild(btn);
  }
}

function updateButtons(data, isLocalPick, isLocalLuck){ 
  el.btnDraw.disabled = true; 
  el.btnPredict.disabled = true; 
  el.btnExtra.disabled = true; 
  el.btnJokerCall.disabled = true; 
  el.btnAdvanceTurn.disabled = true; 
  
  if(data.state === "game_over") return;

  // PICKの操作
  if(isLocalPick){
    const pickHand = data.pick && data.pick.hand ? data.pick.hand : [];
    
    if(data.state==="draw") {
        // ドロー（手札が3枚未満の場合）
        if(pickHand.length < 3) {
          el.btnDraw.disabled = false;
        }
        // ジョーカーコール（義務 - 手札が3枚でジョーカーを含む場合）
        if (pickHand.length === 3 && pickHand.includes("J")) {
           el.btnJokerCall.disabled = false;
        }
    } else if (data.state === "think_time") {
        // ジョーカーコール（権利）
        el.btnJokerCall.disabled = false;
    }
  }
  
  // LUCKの操作
  if(isLocalLuck){
    // 初期予想
    if(data.state==="guess") el.btnPredict.disabled = false;
    // エクストラ予想
    if(data.state==="extra") el.btnExtra.disabled = false;
    
    // ジョーカーコール時の予想
    if (data.state === "joker_call" && data.pending && (data.pending.jokerCallBy || data.pending.jokerCallBy === "auto")){
        el.btnPredict.disabled = false;
        el.btnPredict.textContent = "ジョーカー予想";
    } else {
        el.btnPredict.textContent = "初期予想（Luck）";
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

async function advanceTurn() {
    if (!db || typeof runTransaction !== 'function') { pushLog("（エラー）データベースが初期化されていません。"); return; }
    const roomRef = ref(db, `rooms/${roomId}`);
    
    runTransaction(roomRef, (currentData) => {
        if (currentData === null) return currentData; 

        if (currentData.state !== "wait_for_advance") {
            pushLog("（エラー）現在ターン進行フェーズではありません。");
            return currentData;
        }
        if (!currentData.luck || currentData.luck.token !== token) {
            pushLog("（エラー）あなたはラックではありません。");
            return currentData;
        }
        
        // Pickの手札（ジョーカー以外）をUsedCardsに追加
        const hand = currentData.pick.hand || [];
        const nonJokerCards = hand.filter(c => c !== "J");
        currentData.usedCards = [...(currentData.usedCards || []), ...nonJokerCards];
        
        // 役割交代 (HP, アイテム情報はプレイヤーに紐づくため、役割と同時にスワップされる)
        const { nextPick, nextLuck } = swapRoles(currentData.pick, currentData.luck);
        currentData.pick = nextPick;
        currentData.luck = nextLuck;
        
        // 状態更新
        currentData.state = "draw"; 
        currentData.turnCount = (currentData.turnCount || 1) + 1; 
        currentData.turn = "pick"; 
        
        // FIX: フラグ・保留情報のクリア
        currentData.flags = {}; // 全てのアイテム効果をクリア（Phase 4終了時）
        currentData.pending = null; 
        currentData.timer = null; // タイマー情報もクリア
        
        pushLog(`ラックがターンを進行し、役割が交代しました。ターン${currentData.turnCount}（ドローフェーズへ）`);
        
        return currentData;

    }).catch(error => {
        console.error("ターン進行トランザクションエラー:", error);
        pushLog(`エラー: ターン進行に失敗しました (${error.message})`);
    });
}

async function pickDraw(){
  if (!db || typeof runTransaction !== 'function') { pushLog("（エラー）データベースが初期化されていません。"); return; }
  const roomRef = ref(db, `rooms/${roomId}`);

  runTransaction(roomRef, (data) => {
    if (data === null) return data; 

    if(data.state !== "draw") { // Think Timeからはドローできない
        pushLog("（エラー）現在ドローフェーズではありません"); 
        return data;
    }
    if(!data.pick || data.pick.token !== token) { 
        pushLog("（エラー）あなたはピックではありません"); 
        return data;
    }
    if(data.pick.hand && data.pick.hand.length === 3) { 
        pushLog("（通知）すでにドロー済みです。"); 
        return data;
    }

    let deck = data.deck || [];
    if(deck.length < 3) { 
        pushLog("（エラー）山札のカードが足りません。リセットしてください。"); 
        return data;
    }
    
    const drawn = deck.slice(0,3);
    const rest = deck.slice(3);

    // ターン4以上でジョーカーがまだなら追加
    if((data.turnCount || 1) >= 4 && !data.jokerEnabled){
      const r = rest.slice();
      const pos = Math.floor(Math.random()*(r.length+1));
      r.splice(pos,0,"J"); 
      data.deck = r;
      data.jokerEnabled = true;
      pushLog("ジョーカーが山札に追加されました（Turn>=4）");
    } else {
      data.deck = rest; 
    }

    data.pick.hand = drawn; 
    data.timer = 3.0; // NEW: タイマーを設定

    if(drawn.includes("J")){
      // ジョーカーを引いた場合 -> draw (ジョーカーコール義務の継続)
      data.state = "draw"; // 状態は'draw'のまま
      data.turn = "pick"; 
      pushLog("ピックがジョーカーをドローしました！ジョーカーコールを実行してください（義務）。");
    } else if ((data.turnCount || 1) >= 4 && data.deck.includes("J")) {
      // ターン4以降でジョーカーが山札にあり、ジョーカーを引かなかった場合 -> think_time (コール権利)
      data.state = "think_time";
      data.turn = "pick"; 
      pushLog("カードをドローしました。ジョーカーコールを宣言するチャンスです！（権利）");
    } else {
      // 通常ドローの場合 -> guess (初期予想へ)
      data.state = "guess";
      data.turn = "luck";
      data.timer = null; // タイマーをクリア
      pushLog("ピックが3枚ドローしました（予想フェーズへ）");
    }
    
    return data;
  }).catch(error => {
      console.error("ピックドローエラー:", error);
      pushLog(`エラー: ドローに失敗しました (${error.message})`);
  });
}

async function pickJokerCall(){
    if (!db || typeof runTransaction !== 'function') { pushLog("（エラー）データベースが初期化されていません。"); return; }
    const roomRef = ref(db, `rooms/${roomId}`);

    runTransaction(roomRef, (data) => {
        if (data === null) return data; 

        // FIX: draw (義務) または think_time (権利) のどちらからでもコール可能
        if(data.state !== "draw" && data.state !== "think_time") { 
            pushLog("（エラー）現在ジョーカーコール可能なフェーズではありません"); 
            return data;
        }
        if(!data.pick || data.pick.token !== token) { 
            pushLog("（エラー）あなたはピックではありません"); 
            return data;
        }
        
        const isCompulsory = (data.pick.hand || []).includes("J");
        
        // ドローフェーズ (state: "draw") の場合は、ジョーカー所持が必須（義務）
        if(data.state === "draw" && !isCompulsory) {
             pushLog("（エラー）ドローフェーズでジョーカーコールできるのは、ジョーカーを引いた時のみです（義務）。"); 
             return data;
        }

        data.state = "joker_call";
        data.turn = "luck";
        data.pending = { jokerCallBy: "pick" }; 
        data.timer = null; // NEW: タイマーをクリア
        
        pushLog(`ピックがジョーカーコールを宣言しました（${isCompulsory ? "義務実行" : "権利行使"}、ラックの予想待ち）`);
        
        return data;
    }).catch(error => {
        console.error("ジョーカーコール宣言エラー:", error);
        pushLog(`エラー: ジョーカーコール宣言に失敗しました (${error.message})`);
    });
}

async function luckInitialPredict(){
  if (!db || typeof runTransaction !== 'function') { pushLog("（エラー）データベースが初期化されていません。"); return; }
  const roomRef = ref(db, `rooms/${roomId}`);

  const snap = await get(roomRef);
  const currentData = snap.val();
  
  // ジョーカーコールフェーズの予想処理
  if (currentData && currentData.state === "joker_call" && currentData.pending && (currentData.pending.jokerCallBy || currentData.pending.jokerCallBy === "auto")){
    return handleJokerCallGuess(roomRef);
  }
  
  // 通常の初期予想フェーズの処理
  if (currentData && currentData.state !== "guess") { 
      pushLog("（エラー）現在予想フェーズではありません"); 
      return; 
  }
  if (!currentData || !currentData.luck || currentData.luck.token !== token) { 
      pushLog("（エラー）あなたはラックではありません"); 
      return; 
  }

  const guess = prompt("初期予想: ピック手札の1枚を予想してください（O/T/X）\n入力: O / T / X");
  if(!guess || !CARD_TYPES.includes(guess)) { 
      pushLog("（エラー）O / T / X を入力してください"); 
      return; 
  }
  
  runTransaction(roomRef, (data) => {
    if (data === null) return data; 
    
    if(data.state !== "guess") { 
        pushLog("（エラー）状態が変化しました"); 
        return data;
    }

    const hand = data.pick.hand || [];
    const luckHp = data.luck.hp || INITIAL_HP;

    if(hand.includes(guess)){
      // 初期予想的中 -> エクストラへ
      data.pending = { initialGuess: guess };
      data.state = "extra";
      data.turn = "luck";
      pushLog(`ラックの初期予想「${guess}」が的中。エクストラ予想へ移行`);
    } else {
      // 初期予想失敗 -> ラックにダメージ
      let dmg = data.flags && data.flags.doubleDamageActive ? 2 : 1;
      
      if(data.flags && data.flags.shieldLuck){
        data.flags.shieldLuck = null;
        pushLog("ラックの守護がダメージを無効化");
      } else {
        data.luck.hp = luckHp - dmg;
        pushLog(`ラックの初期予想「${guess}」が外れ。ラックに${dmg}ダメージ`);
      }
      
      // ターン終了処理
      data.pending = null;
      data.state = "wait_for_advance"; 
      data.turn = "luck"; 
    }

    return data;
  }).catch(error => {
      console.error("ラック予想トランザクションエラー:", error);
      pushLog(`エラー: 予想処理に失敗しました (${error.message})`);
  });
}

async function handleJokerCallGuess(roomRef) {
    const ans = prompt("ジョーカーコール: ピックがジョーカーを所持していると思いますか？\n入力: yes / no");
    if(!ans) { 
        pushLog("（通知）キャンセルされました。"); 
        return; 
    }
    const guessHas = ans.toLowerCase().startsWith("y");

    runTransaction(roomRef, (data) => {
        if (data === null) return data; 
        
        if(data.state !== "joker_call" || !data.luck || data.luck.token !== token) { 
            pushLog("（エラー）状態が変化しました"); 
            return data;
        }

        const actualHas = (data.pick && (data.pick.hand||[]).includes("J"));
        let pickHp = data.pick.hp || INITIAL_HP;
        let luckHp = data.luck.hp || INITIAL_HP;
        let dmg = data.flags && data.flags.doubleDamageActive ? 2 : 1;

        if(guessHas === actualHas){
          // 予想的中 -> ピックにダメージ
          if(data.flags && data.flags.shieldPick){ // pick側のシールドはアイテムにないが、念のため残す
            data.flags.shieldPick = null;
            pushLog("ピックの守護がジョーカーコールを無効化"); 
          }
          else { 
            data.pick.hp = pickHp - dmg;
            pushLog(`ジョーカーコール: ラックの予想的中。ピックに${dmg}ダメージ`); 
          }
        } else {
          // 予想失敗 -> ラックにダメージ
          if(data.flags && data.flags.shieldLuck){ 
            data.flags.shieldLuck = null;
            pushLog("ラックの守護がジョーカーコールを無効化"); 
          }
          else { 
            data.luck.hp = luckHp - dmg;
            pushLog(`ジョーカーコール: ラックの予想失敗。ラックに${dmg}ダメージ`); 
          }
        }
        
        // ジョーカーコール後のターン終了処理
        data.pending = null;
        // 次のターン進行フェーズへ
        data.state = "wait_for_advance";
        data.turn = "luck";
        
        return data;
    }).catch(error => {
        console.error("ジョーカーコール予想トランザクションエラー:", error);
        pushLog(`エラー: ジョーカーコール予想に失敗しました (${error.message})`);
    });
}

async function luckExtraPredict(){
  if (!db || typeof runTransaction !== 'function') { pushLog("（エラー）データベースが初期化されていません。"); return; }
  
  const snap = await get(ref(db, `rooms/${roomId}`));
  const currentData = snap.val();
  
  if (currentData && currentData.state !== "extra") { 
      pushLog("（エラー）現在エクストラフェーズではありません"); 
      return; 
  }

  const p1 = prompt("エクストラ予想: 残り2枚のうち1つ目（O/T/X）");
  if(!p1 || !CARD_TYPES.includes(p1)) {
      pushLog("（エラー）O/T/X を入力");
      return;
  }
  const p2 = prompt("エクストラ予想: 残り2枚のうち2つ目（O/T/X）");
  if(!p2 || !CARD_TYPES.includes(p2)) {
      pushLog("（エラー）O/T/X を入力");
      return;
  }
  
  const predictedPair = [p1, p2].sort().join("");

  runTransaction(ref(db, `rooms/${roomId}`), (data) => {
    if (data === null) return data; 
    
    if(data.state !== "extra") { 
        pushLog("（エラー）状態が変化しました"); 
        return data;
    }

    const hand = data.pick.hand || [];
    const initialGuess = data.pending ? data.pending.initialGuess : null;
    if(!initialGuess) { 
        pushLog("（エラー）初期予想情報が見つかりません"); 
        return data;
    }

    // 初期予想カードを除いた残り2枚を抽出（ジョーカーは無視）
    const remainingCards = hand.filter(c => c !== "J");
    const initialIndex = remainingCards.indexOf(initialGuess);
    if (initialIndex > -1) remainingCards.splice(initialIndex, 1);
    
    // 予想対象のペア
    const actualPair = remainingCards.slice(0, 2).sort().join("");
    
    const pickHp = data.pick.hp || INITIAL_HP;

    if(predictedPair === actualPair){
      // エクストラ予想的中 -> ピックにダメージ
      let dmg = data.flags && data.flags.doubleDamageActive ? 2 : 1;
      
      if(data.flags && data.flags.shieldPick){
        data.flags.shieldPick = null;
        pushLog("ピックの守護がダメージを無効化");
      } else {
        data.pick.hp = pickHp - dmg;
        pushLog(`ラックのエクストラ予想「${p1}, ${p2}」が的中。ピックに${dmg}ダメージ`);
      }
      
    } else {
      // FIX: エクストラ予想失敗 -> ダメージなし
      pushLog(`ラックのエクストラ予想「${p1}, ${p2}」が外れ。ラックにダメージなし`);
    }

    // ターン終了処理
    data.pending = null;
    data.state = "wait_for_advance"; 
    data.turn = "luck"; 

    return data;
  }).catch(error => {
      console.error("エクストラ予想トランザクションエラー:", error);
      pushLog(`エラー: エクストラ予想に失敗しました (${error.message})`);
  });
}

function useItemUI(itemKey){
  if (confirm(`アイテム「${itemKey}」を使用しますか？\n(HP2以下の時のみ有効)`)) {
    applyItemEffect(itemKey);
  } else {
    pushLog(`（通知）アイテム「${itemKey}」の使用をキャンセルしました。`);
  }
}

async function applyItemEffect(itemKey){
  if (!db || typeof runTransaction !== 'function') { pushLog("（エラー）データベースが初期化されていません。"); return; }
  const roomRef = ref(db, `rooms/${roomId}`);

  runTransaction(roomRef, (data) => {
    if (data === null) return data; 
    
    const isLocalLuck = data.luck && data.luck.token === token;
    const luckHp = data.luck.hp || INITIAL_HP;
    
    // NEW: アイテム使用可能フェーズのガード（guess, extra, wait_for_advanceのみ）
    if(data.state === "joker_call" || data.state === "draw" || data.state === "think_time") {
        pushLog("（エラー）アイテムは予想フェーズでのみ使用可能です。"); 
        return data;
    }

    if(!isLocalLuck) { 
        pushLog("（エラー）あなたはラックではありません。"); 
        return data;
    }
    if(data.luck.item !== itemKey || data.luck.itemUsed) { 
        pushLog("（エラー）アイテムは使用済みか、所持していません。"); 
        return data;
    }
    if(luckHp > 2) { 
        pushLog("（エラー）アイテム使用条件（HP2以下）を満たしていません。"); 
        return data;
    }
    
    data.luck.itemUsed = true;

    switch(itemKey){
      case "Peek2":
        // 山札の上から2枚を読み込み、Luckのみに公開するフラグをセット
        const deck = data.deck || [];
        if(deck.length < 2) { 
            pushLog("（エラー）山札のカードが2枚未満のため、Peek2は使用できません。"); 
            data.luck.itemUsed = false;
            return data;
        }
        data.flags = data.flags || {};
        data.flags.revealToLuck = deck.slice(0, 2);
        pushLog("Peek2を使用: 山札のトップ2枚を確認しました。");
        break;
        
      case "Shield1":
        // Luckの守護フラグをセット
        data.flags = data.flags || {};
        data.flags.shieldLuck = true;
        pushLog("Shield1を使用: ラックに守護効果を付与しました。");
        break;
        
      case "DoubleDamage":
        // ダメージ2倍フラグをセット
        data.flags = data.flags || {};
        data.flags.doubleDamageActive = true;
        pushLog("DoubleDamageを使用: 次の予想ダメージが2倍になります。");
        break;
        
      case "ForceDeclare":
        // FIX: Pickに「持っていないカード種類」を宣言させる
        const pickHand = data.pick.hand || [];
        const uniqueCards = new Set(pickHand.filter(c => c !== "J"));
        
        let notHeld = [];
        // O, T, X のうち、Pickの手札にないカードを探す
        CARD_TYPES.forEach(type => {
            if (!uniqueCards.has(type)) {
                notHeld.push(type);
            }
        });
        
        let declarationText = "";
        if (notHeld.length > 0) {
            declarationText = `${notHeld.join("と")}を持っていません。`;
            pushLog(`ForceDeclareを使用: ピックは「${declarationText}」と宣言しました。`);
        } else {
            declarationText = "持っていないカードはありません（全種所持）。";
            pushLog(`ForceDeclareを使用: ピックは「${declarationText}」と宣言しました。`);
        }
        
        // Luck側に宣言情報を公開するためのフラグをセット
        data.flags = data.flags || {};
        data.flags.forceDeclareText = declarationText;

        break;
    }

    return data;
  }).catch(error => {
      console.error("アイテム使用トランザクションエラー:", error);
      pushLog(`エラー: アイテム使用に失敗しました (${error.message})`);
  });
}

// 初期化時にルームIDが設定されていたら自動で参加（トークンが設定されていれば再接続として機能）
if (el.roomInput.value.trim()) {
    joinRoom();
}

