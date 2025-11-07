// main_full_turnfix.js — 完全版（ターン入れ替え修正版）
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

// プレイヤー識別情報。ページロード時に生成し、リロードまで維持する
let token = localStorage.getItem("playerToken");
if (!token) {
  token = Math.random().toString(36).substring(2, 15);
  localStorage.setItem("playerToken", token);
}
let currentRoomId = localStorage.getItem("currentRoomId") || null;

// 定数
const INITIAL_HP = 5;
const INITIAL_ITEM = 1;
const ITEMS = ["Heal1", "Peek2", "Shield1", "DoubleDamage", "ForceDeclare", "PeekSelf"]; // アイテムリスト
const DECK_VALUES = ["A", "2", "3", "4", "5", "6", "7", "8", "9", "T", "J"];
const RACK_ROLES = ["A", "2", "3", "4", "5", "6", "7", "8", "9", "T"]; // ラックが予想できるカード

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
  
  // 状態表示系
  roomIdText: document.getElementById("roomId"),
  playerRole: document.getElementById("playerRole"),
  turn: document.getElementById("turn"),
  state: document.getElementById("state"),
  myItem: document.getElementById("myItem"),
  
  // HPとスコア
  rackHP: document.getElementById("rackHP"),
  pickHP: document.getElementById("pickHP"),
  rackScore: document.getElementById("rackScore"),
  pickScore: document.getElementById("pickScore"),
  
  // カードエリア
  topCard: document.getElementById("topCard"),
  topImg: document.getElementById("topImg"),
  deckCount: document.getElementById("deckCount"),
  discardCount: document.getElementById("discardCount"),
  localHand: document.getElementById("localHand"),
  itemArea: document.getElementById("itemArea"),
  peekArea: document.getElementById("peekArea"), // Peek2公開エリア
  
  // ログ
  log: document.getElementById("log"),
};

// 【重要】DOM要素の初期化チェック
// エラーの主因となる可能性が高い部分をチェックします
for (const key in el) {
    if (el[key] === null) {
        console.error(`DOM要素の初期化エラー: ID ${key} に対応する要素が見つかりません。HTMLファイルを確認してください。`);
        // エラーログを出力するだけで、プログラムの続行を試みますが、機能しない可能性があります。
        // ユーザーのエラー行 (373行目) がこの初期化に含まれる場合、ここで判別できます。
    }
}
// --------------------

/**
 * ログエリアにメッセージを追加
 * @param {string} msg 
 */
function pushLog(msg) {
  const now = new Date();
  const time = now.toLocaleTimeString('ja-JP', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' });
  if (el.log) {
    el.log.textContent = `[${time}] ${msg}\n` + (el.log.textContent === '—' ? '' : el.log.textContent);
    // ログが多い場合は古いものを削除
    const lines = el.log.textContent.split('\n');
    if (lines.length > 50) {
      el.log.textContent = lines.slice(0, 50).join('\n');
    }
  } else {
    console.warn("ログ要素が見つかりません:", msg);
  }
}

/**
 * カードの画像を生成するDOMヘルパー
 * @param {string} cardValue カードの値 ("A" - "T", "J") または "B" (裏面)
 * @returns {HTMLDivElement}
 */
function createCardElement(cardValue) {
  const cardEl = document.createElement('div');
  cardEl.className = 'card';
  cardEl.dataset.value = cardValue;

  const imgEl = document.createElement('img');
  imgEl.className = 'imgcard';
  imgEl.alt = cardValue === 'B' ? '裏面' : cardValue;

  // 画像URLの生成 (ここではシンプルなプレースホルダーを使用)
  if (cardValue === 'B') {
    // 裏面画像 (青)
    imgEl.src = `https://placehold.co/64x90/071026/2ea3ff?text=?`;
  } else if (DECK_VALUES.includes(cardValue)) {
    // カード画像 (カード値)
    imgEl.src = `https://placehold.co/64x90/071026/e8f4ff?text=${cardValue}`;
  } else if (ITEMS.includes(cardValue)) {
    // アイテム画像
    imgEl.src = `https://placehold.co/64x90/09233a/2ea3ff?text=${cardValue}`;
  } else {
    // 不明なカード
    imgEl.src = `https://placehold.co/64x90/262626/ffffff?text=X`;
  }

  cardEl.appendChild(imgEl);
  return cardEl;
}

/**
 * 山札と捨て札を初期化する
 * @returns {Array<string>} シャッフルされた山札
 */
function createShuffledDeck() {
  let deck = [];
  // A, 2, ..., T (10枚) を4セット
  for (let i = 0; i < 4; i++) {
    deck = deck.concat(RACK_ROLES);
  }
  // J (ジョーカー) を1枚
  deck.push("J");

  // シャッフル (Fisher-Yates)
  for (let i = deck.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
  return deck;
}

/**
 * アイテムを初期化する
 * @returns {string} ランダムに選ばれたアイテム
 */
function createInitialItem() {
  const randomIndex = Math.floor(Math.random() * ITEMS.length);
  return ITEMS[randomIndex];
}

/**
 * 初期ゲーム状態
 */
const INITIAL_STATE = {
  // プレイヤー情報
  rack: { token: null, hp: INITIAL_HP, score: 0, item: createInitialItem(), itemUsed: false },
  pick: { token: null, hp: INITIAL_HP, score: 0, item: createInitialItem(), itemUsed: false },
  // ゲームの状態
  turn: "pick", // pick または rack
  state: "waiting", // waiting | setup | draw | predict | extra_predict | joker_call | game_over
  turnCount: 1,
  // カード
  deck: createShuffledDeck(),
  discard: [],
  topCard: null, // 場に出ているカード
  pending: null, // 予想やジョーカーコールなどの保留情報
  // フラグ
  flags: {
    revealToRack: null, // Peek2で使用。ラックに公開される山札トップ2枚の配列
    shieldRack: false, // Shield1で使用。ラックの守護状態
    shieldPick: false, // Shield1で使用。ピックの守護状態
    doubleDamageActive: false, // DoubleDamageで使用。次のダメージが2倍になる
    isExtraPredictActive: false, // ExtraPredictを使用。エクストラ予想が有効
  }
};

let currentData = null; // 現在のゲーム状態

/**
 * 部屋の作成処理
 */
async function createRoom(roomId) {
  if (!roomId) {
    pushLog("ルームIDを入力してください。");
    return;
  }

  const roomRef = ref(db, 'rooms/' + roomId);
  try {
    const success = await runTransaction(roomRef, (currentData) => {
      if (currentData === null) {
        // 部屋が存在しない場合のみ作成
        const newState = {
          ...INITIAL_STATE,
          state: "setup", // セットアップ状態に
          rack: { ...INITIAL_STATE.rack, token: token },
        };
        pushLog(`ルームID: ${roomId} を作成しました。あなたはラックです。`);
        return newState;
      } else {
        pushLog("そのルームIDは既に存在します。");
        return undefined; // トランザクションを中止
      }
    });

    if (success.committed) {
      currentRoomId = roomId;
      localStorage.setItem("currentRoomId", roomId);
      // ★★★ 373行目付近で問題が発生している可能性が高いのはここ。 ★★★
      // ルームID表示を更新
      if (el.roomIdText) { 
        el.roomIdText.textContent = roomId; // nullチェックを追加
      }
      // 初期表示を更新
      if (el.playerRole) {
        el.playerRole.textContent = "ラック"; // nullチェックを追加
      }
      
      // onValueリスナーを設定
      setupGameListener(roomId);
    }

  } catch (error) {
    pushLog("部屋作成エラー: " + error.message);
    console.error("部屋作成エラー:", error);
  }
}

/**
 * 部屋への参加処理
 */
async function joinRoom(roomId) {
  if (!roomId) {
    pushLog("ルームIDを入力してください。");
    return;
  }

  const roomRef = ref(db, 'rooms/' + roomId);
  try {
    const success = await runTransaction(roomRef, (currentData) => {
      if (currentData && currentData.state === "setup") {
        if (currentData.rack.token === token) {
          pushLog("あなたは既にこのルームのラックとして参加しています。");
          return undefined;
        }
        if (currentData.pick.token) {
          pushLog("このルームは満員です。");
          return undefined;
        }
        
        // ピックとして参加
        const deck = createShuffledDeck();
        const pickItem = createInitialItem();
        currentData.pick.token = token;
        currentData.pick.item = pickItem;
        currentData.state = "draw"; // ピックが参加したらドローフェーズへ
        currentData.deck = deck; // 新しいデッキをセット
        
        pushLog(`ルームID: ${roomId} にピックとして参加しました。`);
        return currentData;
      } else if (currentData) {
         // 既存の参加者として再接続
         if (currentData.rack.token === token) {
           pushLog(`ルームID: ${roomId} にラックとして再接続しました。`);
           return undefined;
         } else if (currentData.pick.token === token) {
           pushLog(`ルームID: ${roomId} にピックとして再接続しました。`);
           return undefined;
         }
         pushLog("このルームは既にゲーム中です（参加できません）。");
         return undefined;
      } else {
        pushLog("そのルームIDは存在しません。");
        return undefined;
      }
    });

    if (success.committed) {
      currentRoomId = roomId;
      localStorage.setItem("currentRoomId", roomId);
       // ルームID表示を更新
      if (el.roomIdText) {
        el.roomIdText.textContent = roomId;
      }
      // onValueリスナーを設定
      setupGameListener(roomId);
    }

  } catch (error) {
    pushLog("部屋参加エラー: " + error.message);
    console.error("部屋参加エラー:", error);
  }
}

/**
 * ゲームリスナーの設定
 * @param {string} roomId 
 */
function setupGameListener(roomId) {
  const roomRef = ref(db, 'rooms/' + roomId);
  onValue(roomRef, (snapshot) => {
    const data = snapshot.val();
    if (data) {
      currentData = data;
      renderGame(data);
    } else {
      currentData = null;
      renderGame(null);
      pushLog("ルームが存在しないか、リセットされました。");
    }
  }, (error) => {
    pushLog("データ受信エラー: " + error.message);
    console.error("Firebase Realtime Database Error:", error);
  });
}

/**
 * ゲームUIの更新
 * @param {object | null} data 
 */
function renderGame(data) {
  const isRack = data && data.rack && data.rack.token === token;
  const isPick = data && data.pick && data.pick.token === token;
  const role = isRack ? "ラック" : isPick ? "ピック" : "観戦者";

  // 1. 基本情報
  if (el.roomIdText) el.roomIdText.textContent = currentRoomId || "—";
  if (el.playerRole) el.playerRole.textContent = role;
  if (el.turn) el.turn.textContent = data ? (data.turn === "pick" ? "ピック" : data.turn === "rack" ? "ラック" : "—") + ` (T:${data.turnCount || 1})` : "—";
  if (el.state) el.state.textContent = data ? data.state : "—";

  if (!data) {
    // データがない場合は初期状態に戻す
    if (el.rackHP) el.rackHP.textContent = INITIAL_HP;
    if (el.pickHP) el.pickHP.textContent = INITIAL_HP;
    if (el.rackScore) el.rackScore.textContent = 0;
    if (el.pickScore) el.pickScore.textContent = 0;
    if (el.myItem) el.myItem.textContent = "—";
    
    // カードエリアをクリア
    if (el.topImg) el.topImg.style.display = 'none';
    if (el.deckCount) el.deckCount.textContent = 0;
    if (el.discardCount) el.discardCount.textContent = 0;
    if (el.localHand) el.localHand.innerHTML = '';
    if (el.itemArea) el.itemArea.innerHTML = '';
    if (el.peekArea) el.peekArea.innerHTML = '';
    return;
  }
  
  // 2. HPとスコア
  if (el.rackHP) el.rackHP.textContent = data.rack.hp;
  if (el.pickHP) el.pickHP.textContent = data.pick.hp;
  if (el.rackScore) el.rackScore.textContent = data.rack.score;
  if (el.pickScore) el.pickScore.textContent = data.pick.score;

  // 3. 自分の情報 (手札、アイテム)
  const myData = isRack ? data.rack : isPick ? data.pick : null;
  const opponentData = isRack ? data.pick : isPick ? data.rack : null;
  
  if (el.myItem) el.myItem.textContent = myData ? myData.item : "—";
  
  // 手札
  if (el.localHand) {
    el.localHand.innerHTML = '';
    const hand = myData && myData.hand ? myData.hand : [];
    if (hand.length > 0) {
        hand.forEach(card => {
            el.localHand.appendChild(createCardElement(card));
        });
    } else {
        el.localHand.textContent = (isRack || isPick) ? "手札はありません。" : "—";
    }
  }

  // アイテム表示 (ラックのみ)
  if (el.itemArea) {
    el.itemArea.innerHTML = '';
    if (isRack && myData && myData.item) {
        el.itemArea.appendChild(createCardElement(myData.item));
    } else {
        el.itemArea.textContent = isRack ? "アイテムなし" : "—";
    }
  }

  // Peek2公開エリア (ラックのみ)
  if (el.peekArea) {
    el.peekArea.innerHTML = '';
    if (isRack && data.flags && data.flags.revealToRack && data.flags.revealToRack.length > 0) {
      data.flags.revealToRack.forEach(card => {
        el.peekArea.appendChild(createCardElement(card));
      });
      // 一度表示したら、次のターン開始時にリセットされるべきですが、ここでは表示を維持
    } else {
      el.peekArea.textContent = "公開情報なし";
    }
  }
  
  // 4. 場札と山札
  if (el.topImg) {
    if (data.topCard) {
      const cardValue = data.topCard;
      el.topImg.src = `https://placehold.co/64x90/071026/e8f4ff?text=${cardValue}`;
      el.topImg.alt = cardValue;
      el.topImg.style.display = 'block';
    } else {
      el.topImg.style.display = 'none';
    }
  }
  if (el.deckCount) el.deckCount.textContent = data.deck.length;
  if (el.discardCount) el.discardCount.textContent = data.discard.length;

  // 5. ボタンの有効/無効化（ゲーム状態とロールに基づく）
  const isMyTurn = (data.turn === 'pick' && isPick) || (data.turn === 'rack' && isRack);
  
  if (el.btnDraw) el.btnDraw.disabled = !(isPick && data.state === 'draw' && isMyTurn);
  if (el.btnPredict) el.btnPredict.disabled = !(isRack && data.state === 'predict' && isMyTurn);
  if (el.btnExtra) el.btnExtra.disabled = !(isRack && data.state === 'extra_predict' && isMyTurn);
  if (el.btnJokerCall) el.btnJokerCall.disabled = !(isPick && data.state === 'draw'); // Pickはいつでもコールできる
  if (el.btnUseItem) el.btnUseItem.disabled = !(isRack && data.state === 'predict' && isMyTurn && myData.hp <= 2 && myData.item && !myData.itemUsed);
  
  // ルーム作成・参加ボタン
  const isSetupOrWaiting = data.state === 'waiting' || data.state === 'setup';
  if (el.btnCreate) el.btnCreate.disabled = currentRoomId !== null;
  if (el.btnJoin) el.btnJoin.disabled = currentRoomId !== null || !isSetupOrWaiting;
  if (el.btnReset) el.btnReset.disabled = currentRoomId === null;

  // 強制ジョーカーコール中のボタン状態
  if (data.state === 'joker_call') {
    if (isRack && data.pending && data.pending.jokerCallBy === "rack") {
        if (el.btnPredict) el.btnPredict.disabled = true;
        if (el.btnExtra) el.btnExtra.disabled = true;
        if (el.btnDraw) el.btnDraw.disabled = true;
        if (el.btnJokerCall) el.btnJokerCall.disabled = true;
        // ラック側は何もせず、Pickからの応答を待つ
    }
  }
  
  // ゲーム終了
  if (data.state === 'game_over') {
    pushLog("--- ゲーム終了 ---");
    // 全ての操作ボタンを無効化
    [el.btnDraw, el.btnPredict, el.btnExtra, el.btnJokerCall, el.btnUseItem].forEach(btn => {
      if(btn) btn.disabled = true;
    });
  }
}

// --------------------
// ゲームアクション関数 (非同期でFirebaseを更新)
// --------------------

/**
 * ピックのドロー処理
 */
async function drawCard() {
  if (!currentRoomId || !currentData || currentData.turn !== 'pick' || currentData.state !== 'draw') return;
  if (currentData.pick.token !== token) {
    pushLog("今はピックのターンではありません。");
    return;
  }

  const roomRef = ref(db, 'rooms/' + currentRoomId);
  try {
    await runTransaction(roomRef, (data) => {
      if (data && data.turn === 'pick' && data.state === 'draw') {
        if (data.deck.length === 0) {
          pushLog("山札が空です。");
          // 山札が空の場合は捨て札をシャッフルして再利用
          data.deck = createShuffledDeck(); // 完全に初期化と同じ処理
          data.discard = [];
          pushLog("山札が空になりました。捨て札をシャッフルして山札に戻します。");
        }

        const drawnCard = data.deck.shift(); // 山札から1枚引く
        
        // ピックの手札に追加
        if (!data.pick.hand) data.pick.hand = [];
        data.pick.hand.push(drawnCard);
        
        // 状態を更新
        data.state = 'predict'; // 次はラックの予想フェーズ
        data.turn = 'rack'; // ターンをラックに渡す
        
        pushLog(`ピックがカードを1枚ドローしました。（手札: ${data.pick.hand.length}枚）`);
        return data;
      }
      return undefined; // トランザクションを中断
    });
  } catch (error) {
    pushLog("ドローエラー: " + error.message);
    console.error("ドローエラー:", error);
  }
}

/**
 * ラックの予想処理
 */
async function makePrediction(isExtra = false) {
  if (!currentRoomId || !currentData || currentData.turn !== 'rack') return;
  if (currentData.rack.token !== token) {
    pushLog("今はラックのターンではありません。");
    return;
  }
  
  const expectedState = isExtra ? 'extra_predict' : 'predict';
  if (currentData.state !== expectedState) {
    pushLog(`${expectedState === 'predict' ? '初期予想' : 'エクストラ予想'}ができる状態ではありません。`);
    return;
  }
  
  // 予想するカードを選択
  let prediction = prompt("予想するカードの値を入力してください (" + RACK_ROLES.join(", ") + ")");
  if (!prediction) return;
  prediction = prediction.toUpperCase();
  
  if (!RACK_ROLES.includes(prediction)) {
    pushLog("無効なカード値です。A, 2, ..., T から選んでください。");
    return;
  }

  // 予想の整合性チェック
  if (isExtra) {
      const topCard = currentData.topCard;
      if (!topCard) {
          pushLog("場札がありません。エクストラ予想はできません。");
          return;
      }
      if (prediction !== topCard) {
          pushLog("エクストラ予想では、場札と同じカードを予想する必要があります。");
          return;
      }
  }

  const roomRef = ref(db, 'rooms/' + currentRoomId);
  try {
    await runTransaction(roomRef, (data) => {
      if (data && data.turn === 'rack' && data.state === expectedState) {
        
        // ピックの手札をチェック
        const hand = data.pick.hand || [];
        const cardIndex = hand.indexOf(prediction);
        let updates = {};
        let dmg = 1; 
        if(data.flags && data.flags.doubleDamageActive) dmg*=2;

        if (cardIndex !== -1) {
          // 予想的中
          const removedCard = hand.splice(cardIndex, 1)[0];
          updates["pick/hand"] = hand;
          updates["discard"] = [...data.discard, removedCard];
          
          if (isExtra) {
            // エクストラ予想成功
            updates["topCard"] = null; // 場札を捨てる
            updates["discard"] = [...updates["discard"], data.topCard];
            if (data.flags && data.flags.shieldPick) { updates["flags/shieldPick"] = false; pushLog("ピックの守護が予想を無効化"); }
            else { updates["rack/hp"] = (data.rack.hp || INITIAL_HP) - dmg; pushLog("エクストラ予想的中: ピックは守った。ラックに" + dmg + "ダメージ"); }
            
          } else {
            // 初期予想成功
            if (data.flags && data.flags.shieldPick) { updates["flags/shieldPick"] = false; pushLog("ピックの守護が予想を無効化"); }
            else { updates["pick/hp"] = (data.pick.hp || INITIAL_HP) - dmg; pushLog("予想的中: ピックに" + dmg + "ダメージ"); }
          }
          
          // 次の状態へ
          updates["topCard"] = null; // 場札をクリア（成功時は常にクリア）
          updates["state"] = "draw";
          updates["turn"] = "pick";
          updates["turnCount"] = (data.turnCount || 1) + 1;
          updates["flags/doubleDamageActive"] = false;

        } else if (prediction === "J" && hand.includes("J")) {
             // 予想がJokerで、PickがJokerを持っている場合 (予想失敗 - Joker Callの強制)
            updates["state"] = "joker_call";
            updates["turn"] = "pick"; // ピックのターンに渡す
            updates["pending"] = { jokerCallBy: "rack" };
            pushLog("予想失敗（ジョーカー所持の疑い）: ピックにジョーカーコールを強制します。");
            return { ...data, ...updates };

        } else {
          // 予想失敗
          if (data.flags && data.flags.shieldRack) { updates["flags/shieldRack"] = false; pushLog("ラックの守護が予想を無効化"); }
          else { updates["rack/hp"] = (data.rack.hp || INITIAL_HP) - dmg; pushLog("予想失敗: ラックに" + dmg + "ダメージ"); }
          
          if (isExtra) {
            // エクストラ予想失敗
            updates["topCard"] = null; // 場札は残る（失敗時は残る）
            updates["state"] = "draw";
            updates["turn"] = "pick";
            updates["turnCount"] = (data.turnCount || 1) + 1;
            updates["flags/doubleDamageActive"] = false;
          } else {
            // 初期予想失敗
            updates["topCard"] = prediction; // 予想を場札として公開
            updates["state"] = "extra_predict"; // エクストラ予想フェーズへ
            updates["turn"] = "rack"; // ターンはラックのまま
          }
        }
        
        // HPチェック
        const pickHP = (updates["pick/hp"] !== undefined ? updates["pick/hp"] : data.pick.hp) || INITIAL_HP;
        const rackHP = (updates["rack/hp"] !== undefined ? updates["rack/hp"] : data.rack.hp) || INITIAL_HP;
        
        if (pickHP <= 0 || rackHP <= 0) {
            updates["state"] = "game_over";
            updates["rack/score"] = rackHP <= 0 ? data.rack.score : data.rack.score + 1;
            updates["pick/score"] = pickHP <= 0 ? data.pick.score : data.pick.score + 1;
            pushLog(pickHP <= 0 ? "ラックの勝利！" : rackHP <= 0 ? "ピックの勝利！" : "エラー");
        }
        
        return { ...data, ...updates };
      }
      return undefined;
    });
  } catch (error) {
    pushLog("予想エラー: " + error.message);
    console.error("予想エラー:", error);
  }
}

/**
 * ピックのジョーカーコール処理
 */
async function jokerCall() {
  if (!currentRoomId || !currentData || currentData.pick.token !== token) return;
  if (currentData.state !== 'draw') {
    pushLog("ジョーカーコールはドローフェーズ中のみ可能です。");
    return;
  }

  // Pickがジョーカーを所持しているかを確認
  const hand = currentData.pick.hand || [];
  const hasJoker = hand.includes("J");
  
  if (!hasJoker) {
      pushLog("ジョーカーを所持していないため、コールできません。");
      return;
  }

  const roomRef = ref(db, 'rooms/' + currentRoomId);
  try {
    await runTransaction(roomRef, (data) => {
      if (data && data.state === 'draw') {
        let updates = {};
        
        // ピックはジョーカーをコールし、手札からJokerを公開
        const jokerIndex = data.pick.hand.indexOf("J");
        if (jokerIndex === -1) {
            // ここでJokerがないのはおかしいが、念のため
            pushLog("エラー: ジョーカーが見つかりません。");
            return undefined;
        }

        const removedCard = data.pick.hand.splice(jokerIndex, 1)[0];
        updates["pick/hand"] = data.pick.hand;
        updates["discard"] = [...data.discard, removedCard];
        
        // ダメージ計算（ジョーカーコールは必ず成功し、ラックにダメージ）
        let dmg = 1; if(data.flags && data.flags.doubleDamageActive) dmg*=2;
        
        if(data.flags && data.flags.shieldRack){ updates["flags/shieldRack"] = false; pushLog("ラックの守護がジョーカーコールを無効化"); }
        else { updates["rack/hp"] = (data.rack.hp || INITIAL_HP) - dmg; pushLog("ピックがジョーカーコール！ラックに" + dmg + "ダメージ"); }

        // 次のターンへ
        updates["state"] = "draw";
        updates["turn"] = "pick";
        updates["turnCount"] = (data.turnCount || 1) + 1;
        updates["topCard"] = null;
        updates["flags/doubleDamageActive"] = false;
        updates["pending"] = null;

        // HPチェック
        const rackHP = (updates["rack/hp"] !== undefined ? updates["rack/hp"] : data.rack.hp) || INITIAL_HP;
        if (rackHP <= 0) {
            updates["state"] = "game_over";
            updates["pick/score"] = data.pick.score + 1;
            pushLog("ピックの勝利！ラックHPが0になりました。");
        }
        
        return { ...data, ...updates };
      }
      return undefined;
    });
  } catch (error) {
    pushLog("ジョーカーコールエラー: " + error.message);
    console.error("ジョーカーコールエラー:", error);
  }
}

/**
 * 強制ジョーカーコールに対するピックの応答
 */
async function respondToJokerCall() {
  if (!currentRoomId || !currentData || currentData.pick.token !== token) return;
  if (currentData.state !== 'joker_call' || !(currentData.pending && currentData.pending.jokerCallBy === "rack")) return;

  const roomRef = ref(db, 'rooms/' + currentRoomId);
  
  // ピックの応答（ジョーカーを持っているか否か）
  const hand = currentData.pick.hand || [];
  const actualHas = hand.includes("J");
  let guessHas = null;

  // 強制コールに対する応答は、ジョーカーの有無を隠すことはできない
  if (actualHas) {
      // PickがJokerを持っている場合（コールが成功）
      jokerCall(); // 既存のジョーカーコール処理を呼び出す
      return;
  } else {
      // PickがJokerを持っていない場合（コールが失敗）
      try {
        await runTransaction(roomRef, (data) => {
            if (data && data.state === 'joker_call' && data.pending && data.pending.jokerCallBy === "rack") {
                let updates = {};
                let dmg = 1; if(data.flags && data.flags.doubleDamageActive) dmg*=2;

                // ラックの予想失敗として処理
                if(data.flags && data.flags.shieldRack){ updates["flags/shieldRack"] = false; pushLog("ラックの守護がジョーカーコールを無効化"); }
                else { updates["rack/hp"] = (data.rack.hp || INITIAL_HP) - dmg; pushLog("強制ジョーカーコール: ラックの予想失敗。ラックに" + dmg + "ダメージ"); }
                
                // 次のターンへ
                updates["state"] = "draw";
                updates["pending"] = null;
                updates["turnCount"] = (data.turnCount || 1) + 1;
                updates["turn"] = "pick";
                updates["flags/doubleDamageActive"] = false;

                // HPチェック
                const rackHP = (updates["rack/hp"] !== undefined ? updates["rack/hp"] : data.rack.hp) || INITIAL_HP;
                if (rackHP <= 0) {
                    updates["state"] = "game_over";
                    updates["pick/score"] = data.pick.score + 1;
                    pushLog("ピックの勝利！ラックHPが0になりました。");
                }

                pushLog("ピックはジョーカーを所持していませんでした。ラックのコールは失敗しました。");
                return { ...data, ...updates };
            }
            return undefined;
        });
      } catch (error) {
        pushLog("応答エラー: " + error.message);
        console.error("応答エラー:", error);
      }
  }
}

/**
 * アイテム使用処理 (ラックのみ、HP<=2、1ゲーム1回のみ)
 */
async function useItem() {
  if (!currentRoomId || !currentData || currentData.rack.token !== token) return;
  const myData = currentData.rack;

  if (currentData.state !== 'predict' || currentData.turn !== 'rack') {
    pushLog("アイテムは予想フェーズ開始時のみ使用可能です。");
    return;
  }
  if (myData.hp > 2) {
    pushLog("HPが3以上のため、アイテムを使用できません。");
    return;
  }
  if (!myData.item || myData.itemUsed) {
    pushLog("アイテムを所持していないか、既に今ゲームで使用済みです。");
    return;
  }
  
  const itemToUse = myData.item;
  
  const roomRef = ref(db, 'rooms/' + currentRoomId);
  try {
    await runTransaction(roomRef, (data) => {
      if (data && data.rack.token === token && data.state === 'predict' && data.turn === 'rack' && data.rack.hp <= 2 && data.rack.item && !data.rack.itemUsed) {
        let updates = {};
        updates["rack/itemUsed"] = true; // 使用フラグをセット
        
        switch (itemToUse) {
          case "Heal1":
            // HPを1回復 (最大HPを超えない)
            updates["rack/hp"] = Math.min((data.rack.hp || INITIAL_HP) + 1, INITIAL_HP);
            pushLog("Heal1を使用: ラックのHPが1回復しました。");
            break;
          case "Peek2":
            // 山札のトップ2枚をラックに公開 (revealToRackフラグを使用)
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
                updates["turn"] = "pick"; // ピックのターンに渡し、応答を待つ
                updates["pending"] = { jokerCallBy: "rack" };
                pushLog("ForceDeclareを使用: ピックにジョーカーコールを強制しました。");
            }
            break;
          case "PeekSelf":
            // 自分のアイテムを再シャッフル
            const newItem = createInitialItem();
            updates["rack/item"] = newItem;
            updates["rack/itemUsed"] = false; // 再シャッフルしたので使用フラグをリセット
            pushLog(`PeekSelfを使用: アイテムを再抽選しました。新しいアイテム: ${newItem}`);
            break;
          default:
            pushLog(`不明なアイテム ${itemToUse} の使用を試みました。`);
            updates["rack/itemUsed"] = false; // 使用フラグを元に戻す
            return { ...data, ...updates }; 
        }

        // PeekSelf以外はアイテムを消費し、アイテムをnullにする
        if(itemToUse !== "PeekSelf") {
            updates["rack/item"] = null;
        }

        return { ...data, ...updates };
      }
      return undefined;
    });
  } catch (error) {
    pushLog("アイテム使用エラー: " + error.message);
    console.error("アイテム使用エラー:", error);
  }
}

/**
 * 部屋のリセット処理
 */
async function resetRoom() {
    if (!currentRoomId) return;
    const roomRef = ref(db, 'rooms/' + currentRoomId);
    
    try {
        await set(roomRef, null); // ルームデータを削除
        localStorage.removeItem("currentRoomId");
        currentRoomId = null;
        // UIを初期状態に戻す
        renderGame(null);
        pushLog("ルームをリセットしました。");
        // ボタンを有効化
        if (el.btnCreate) el.btnCreate.disabled = false;
        if (el.btnJoin) el.btnJoin.disabled = false;

    } catch (error) {
        pushLog("リセットエラー: " + error.message);
        console.error("リセットエラー:", error);
    }
}


// --------------------
// イベントリスナー
// --------------------

// ルーム作成
if (el.btnCreate) el.btnCreate.onclick = () => {
    const roomId = el.roomInput ? el.roomInput.value.trim() : null;
    createRoom(roomId);
};

// ルーム参加
if (el.btnJoin) el.btnJoin.onclick = () => {
    const roomId = el.roomInput ? el.roomInput.value.trim() : null;
    joinRoom(roomId);
};

// リセット
if (el.btnReset) el.btnReset.onclick = () => {
    if (confirm("本当にこのルームをリセットしてよろしいですか？")) {
        resetRoom();
    }
};

// ドロー
if (el.btnDraw) el.btnDraw.onclick = () => {
    if (currentData && currentData.state === 'joker_call' && currentData.pending && currentData.pending.jokerCallBy === "rack") {
        respondToJokerCall(); // 強制ジョーカーコールへの応答
    } else {
        drawCard();
    }
};

// 初期予想
if (el.btnPredict) el.btnPredict.onclick = () => makePrediction(false);

// エクストラ予想
if (el.btnExtra) el.btnExtra.onclick = () => makePrediction(true);

// ジョーカーコール
if (el.btnJokerCall) el.btnJokerCall.onclick = () => jokerCall();

// アイテム使用
if (el.btnUseItem) el.btnUseItem.onclick = () => useItem();

// --------------------
// 初期化
// --------------------

// 既にルームに参加している場合は再接続を試みる
if (currentRoomId) {
    pushLog(`自動的にルームID: ${currentRoomId} への再接続を試みます...`);
    setupGameListener(currentRoomId);
    if (el.roomInput) el.roomInput.value = currentRoomId;
    // UIボタンの初期状態を更新
    if (el.btnCreate) el.btnCreate.disabled = true;
    if (el.btnJoin) el.btnJoin.disabled = true;
} else {
    renderGame(null); // UIを初期化
}

// ログにプレイヤー情報を表示
pushLog(`あなたのプレイヤートークン: ${token}`);
