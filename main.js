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
// Canvas環境が提供するグローバル変数を使用し、なければフォールバックを使用
// __firebase_configが提供されない場合のフォールバック設定 (ユーザーが自身の値に置き換える必要があります)
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

// __app_idを使用して、データベースのルートパスを決定
const appId = typeof __app_id !== 'undefined' ? __app_id : 'default-app-id';
const RTDB_ROOT_PATH = `/artifacts/${appId}/public/data/luck_pick`;

const app = initializeApp(firebaseConfig);
const db = getDatabase(app);

/* --------------------\n   定数\n   -------------------- */
const INITIAL_HP = 5;
const INITIAL_ITEM = ["Peek2", "Shield1", "DoubleDamage", "ForceDeclare"];
const CARD_SUITS = ["S", "H", "D", "C"]; // Spade, Heart, Diamond, Club
const CARD_RANKS = ["A", "2", "3", "4", "5", "6", "7", "8", "9", "T", "J", "Q", "K"];
const JOKER = "J";

let currentRoomId = null;
let myRole = null;
let myToken = null;

/* --------------------\n   DOM 要素（index.html に合わせる）\n   -------------------- */
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
  myRoleText: document.getElementById("myRole"),
  myHPText: document.getElementById("myHP"),
  opponentHPText: document.getElementById("opponentHP"),
  turnText: document.getElementById("turn"),
  stateText: document.getElementById("state"),
  myItemText: document.getElementById("myItem"),
  logArea: document.getElementById("log"),
  deckCount: document.getElementById("deckCount"),
  topCard: document.getElementById("topCard"),
  topImg: document.getElementById("topImg"),
  localHandArea: document.getElementById("localHand"),
  itemArea: document.getElementById("itemArea"),
  peekArea: document.getElementById("peekArea"), // Peek2公開用エリア
  // ゲーム終了メッセージ用
  gameEndMessage: document.getElementById("gameEndMessage"),
  gameEndOverlay: document.getElementById("gameEndOverlay"),
};

/* --------------------\n   ユーティリティ関数\n   -------------------- */

// ログ表示
function pushLog(message) {
  const now = new Date().toLocaleTimeString();
  el.logArea.textContent = `[${now}] ${message}\n${el.logArea.textContent}`;
  console.log(message);
}

// カードのシャッフル
function shuffleDeck() {
  let deck = [];
  // 通常のトランプ52枚 + ジョーカー1枚
  CARD_SUITS.forEach(suit => {
    CARD_RANKS.forEach(rank => {
      deck.push(rank + suit);
    });
  });
  deck.push(JOKER);

  // Fisher-Yates shuffle
  for (let i = deck.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
  return deck;
}

// カード画像HTMLの生成
function createCardImage(card, isHidden = false) {
  const cardName = isHidden ? "back" : card.replace("T", "10"); // T->10に変換
  const cardPath = `./img/${cardName}.png`;
  const html = `<img class="imgcard" src="${cardPath}" alt="${isHidden ? '?' : card}" onerror="this.onerror=null; this.src='./img/back.png'; this.alt='?'" />`;
  return html;
}

// 勝敗判定と状態変更
function checkGameOver(data, updates) {
  let winner = null;

  if ((data.pick && data.pick.hp <= 0) && (data.rack && data.rack.hp <= 0)) {
      winner = "draw";
      pushLog("ダブルKO！引き分けです。");
  } else if (data.pick && data.pick.hp <= 0) {
    winner = "rack";
    pushLog("ラックの勝利！ピックのHPが0になりました。");
  } else if (data.rack && data.rack.hp <= 0) {
    winner = "pick";
    pushLog("ピックの勝利！ラックのHPが0になりました。");
  }

  if (winner) {
    updates.state = "ended";
    updates.winner = winner;
    // ログは既にpushLogで記録済み
  }
}

// ゲーム終了メッセージの表示
function displayGameEnd(winner) {
    el.gameEndOverlay.style.display = 'flex';
    let message = "";
    switch (winner) {
        case "pick":
            message = "勝者: ピック (Pick)！";
            break;
        case "rack":
            message = "勝者: ラック (Rack)！";
            break;
        case "draw":
            message = "引き分け (Draw)！";
            break;
        default:
            message = "ゲーム終了";
            break;
    }
    el.gameEndMessage.textContent = message;
}

/* --------------------\n   Firebase 操作\n   -------------------- */

// ルームの作成（Pickとして）
async function createRoom() {
  const roomId = el.roomInput.value.trim();
  if (!roomId) {
    pushLog("ルームIDを入力してください。");
    return;
  }

  const roomRef = ref(db, `${RTDB_ROOT_PATH}/${roomId}`);

  try {
    const snapshot = await get(roomRef);
    if (snapshot.exists()) {
      pushLog(`ルームID ${roomId} は既に存在します。`);
      return;
    }

    const shuffledDeck = shuffleDeck();
    const token = crypto.randomUUID();

    await set(roomRef, {
      id: roomId,
      pick: { token, hp: INITIAL_HP, hand: [], item: INITIAL_ITEM },
      rack: null,
      deck: shuffledDeck,
      state: "waiting", // 待機中
      turn: null,
      turnCount: 0,
      log: [["ルーム作成", `ルームID: ${roomId} が作成されました。`]],
      flags: {
          doubleDamageActive: false,
          shieldRack: false,
          shieldPick: false,
          revealToRack: null, // Peek2用
      }
    });

    currentRoomId = roomId;
    myRole = "pick";
    myToken = token;
    setupGameListener(roomId);
    pushLog(`ルームID ${roomId} を作成し、Pickとして参加しました。`);
  } catch (error) {
    pushLog("ルーム作成エラー: " + error.message);
  }
}

// ルームへの参加（Rackとして）
async function joinRoom() {
  const roomId = el.roomInput.value.trim();
  if (!roomId) {
    pushLog("ルームIDを入力してください。");
    return;
  }

  const roomRef = ref(db, `${RTDB_ROOT_PATH}/${roomId}`);

  try {
    const data = await runTransaction(roomRef, (currentData) => {
      if (currentData) {
        if (currentData.rack) {
          pushLog("既に2名のプレイヤーが参加しています。");
          return;
        }

        // --- 修正点 1: Rack参加時のゲーム開始処理 ---
        const newToken = crypto.randomUUID();
        currentData.rack = { token: newToken, hp: INITIAL_HP, hand: [], item: INITIAL_ITEM };
        currentData.state = "draw"; // 状態を 'draw' に変更
        currentData.turn = "pick";  // ターンを 'pick' に設定
        currentData.turnCount = 1;  // ターンカウント開始
        currentData.log.push(["ゲーム開始", "ラックが参加しました。ゲーム開始！ピックのドローフェーズから始まります。"]);
        // ------------------------------------------

        // ここでcurrentDataが更新され、トランザクションがコミットされる
        return currentData;
      } else {
        pushLog(`ルームID ${roomId} は存在しません。`);
        return; // トランザクションを中止
      }
    });

    if (data && data.committed) {
      currentRoomId = roomId;
      myRole = "rack";
      myToken = data.snapshot.val().rack.token;
      setupGameListener(roomId);
      pushLog(`ルームID ${roomId} にRackとして参加しました。`);
    }

  } catch (error) {
    pushLog("ルーム参加エラー: " + error.message);
  }
}

// ゲーム状態のリセット
async function resetGame() {
    if (!currentRoomId) return;

    const roomRef = ref(db, `${RTDB_ROOT_PATH}/${currentRoomId}`);
    try {
        const shuffledDeck = shuffleDeck();

        await runTransaction(roomRef, (data) => {
            if (data) {
                // PickとRackのトークンは維持し、他の情報をリセット
                const pickToken = data.pick ? data.pick.token : null;
                const rackToken = data.rack ? data.rack.token : null;

                data.pick = pickToken ? { token: pickToken, hp: INITIAL_HP, hand: [], item: INITIAL_ITEM } : null;
                data.rack = rackToken ? { token: rackToken, hp: INITIAL_HP, hand: [], item: INITIAL_ITEM } : null;
                data.deck = shuffledDeck;
                data.state = (data.pick && data.rack) ? "draw" : "waiting"; // 2人いる場合はすぐにdraw、そうでなければwaiting
                data.turn = (data.pick && data.rack) ? "pick" : null;
                data.turnCount = (data.pick && data.rack) ? 1 : 0;
                data.log = [["ゲームリセット", "ゲームがリセットされました。"]];
                data.winner = null;
                data.flags = {
                    doubleDamageActive: false,
                    shieldRack: false,
                    shieldPick: false,
                    revealToRack: null,
                };
            }
            return data;
        });
        pushLog("ゲーム状態をリセットしました。");
    } catch (error) {
        pushLog("リセット処理中にエラーが発生しました: " + error.message);
    }
}

// Pickのドロー
async function drawCard() {
  if (myRole !== "pick" || !currentRoomId) return;

  const roomRef = ref(db, `${RTDB_ROOT_PATH}/${currentRoomId}`);
  try {
    const { committed, snapshot } = await runTransaction(roomRef, (data) => {
      if (!data || data.state !== "draw" || data.turn !== "pick") {
        return; // 中止
      }

      const updates = {};
      
      // --- 修正点 2: 山札切れチェック ---
      let deck = data.deck || [];
      if (deck.length === 0) {
          let winner = "";
          const pickHP = data.pick ? data.pick.hp : 0;
          const rackHP = data.rack ? data.rack.hp : 0;

          if (pickHP > rackHP) {
              winner = "pick";
              pushLog("山札がなくなりました！HPが多いピックの勝利！", currentRoomId);
          } else if (rackHP > pickHP) {
              winner = "rack";
              pushLog("山札がなくなりました！HPが多いラックの勝利！", currentRoomId);
          } else {
              winner = "draw";
              pushLog("山札がなくなりました！HPが同点のため引き分け！", currentRoomId);
          }
          
          updates.state = "ended";
          updates.winner = winner;
          
          // トランザクション内でupdatesを適用するためにdataを更新
          Object.assign(data, updates); 
          return data; // トランザクションを終了して更新を適用
      }
      // ----------------------------------

      // 山札からカードを引く
      const drawnCard = deck.shift();
      updates.deck = deck;
      updates.pick = { ...data.pick, hand: [...data.pick.hand, drawnCard] };
      updates.state = "predict_start"; // 次の状態へ
      updates.turn = "rack"; // ターンはRackへ
      
      // フラグをリセット (Peek2など)
      updates["flags/revealToRack"] = null;

      data.log.push(["ドロー", `ピックがカードを1枚引きました。現在の状態: ${updates.state}`]);

      // トランザクション内でupdatesを適用
      Object.assign(data, updates);
      return data;
    });
    
    if (committed) {
        if(snapshot.val().state !== "ended") {
            pushLog("カードをドローしました。ラックの予想ターンへ移行します。");
        }
    }
  } catch (error) {
    pushLog("ドロー処理エラー: " + error.message);
  }
}

// Rackの初期予想
async function startPrediction(prediction) {
  if (myRole !== "rack" || !currentRoomId) return;

  const roomRef = ref(db, `${RTDB_ROOT_PATH}/${currentRoomId}`);
  try {
    await runTransaction(roomRef, (data) => {
      if (!data || data.state !== "predict_start" || data.turn !== "rack") {
        return;
      }

      const updates = {};
      updates.state = "predict_extra";
      updates.pending = {
        prediction: prediction,
        extraUsed: false,
      };

      data.log.push(["予想", `ラックが初期予想 ${prediction} を行いました。エクストラ予想フェーズへ。`]);
      Object.assign(data, updates);
      return data;
    });
    pushLog(`初期予想: ${prediction} を行いました。`);
  } catch (error) {
    pushLog("予想処理エラー: " + error.message);
  }
}

// Rackのエクストラ予想
async function extraPrediction(prediction) {
  if (myRole !== "rack" || !currentRoomId) return;

  const roomRef = ref(db, `${RTDB_ROOT_PATH}/${currentRoomId}`);
  try {
    await runTransaction(roomRef, (data) => {
      if (!data || data.state !== "predict_extra" || data.turn !== "rack" || (data.pending && data.pending.extraUsed)) {
        pushLog("エクストラ予想は既に実行済みか、フェーズ外です。");
        return;
      }

      const updates = {};
      updates.pending = { ...data.pending, prediction: prediction, extraUsed: true };
      
      data.log.push(["エクストラ予想", `ラックがエクストラ予想 ${prediction} を行いました。`]);
      Object.assign(data, updates);
      return data;
    });
    pushLog(`エクストラ予想: ${prediction} を行いました。`);
  } catch (error) {
    pushLog("エクストラ予想処理エラー: " + error.message);
  }
}

// ターン終了（予測の評価とダメージ処理）
async function endTurn() {
    if (myRole !== "rack" || !currentRoomId) return; // 予想ターンはRackが主導

    const roomRef = ref(db, `${RTDB_ROOT_PATH}/${currentRoomId}`);
    try {
        const { committed, snapshot } = await runTransaction(roomRef, (data) => {
            if (!data || data.turn !== "rack" || (data.state !== "predict_start" && data.state !== "predict_extra")) {
                pushLog("ターン終了処理を実行できません。");
                return;
            }

            const updates = {};
            const pickHand = data.pick.hand || [];
            const topCard = pickHand[pickHand.length - 1]; // Pickが最後に引いたカード
            const prediction = data.pending ? data.pending.prediction : null;
            let dmg = 1;

            if (data.flags && data.flags.doubleDamageActive) {
                dmg *= 2;
                updates["flags/doubleDamageActive"] = false; // ダメージ倍増フラグをリセット
            }

            // 評価ロジック (Jokerは予想外)
            let isCorrect = false;
            if (topCard === JOKER) {
                // ジョーカーの場合、予測は常に失敗
                updates.rack = { ...data.rack, hp: data.rack.hp - dmg };
                updates.pick = { ...data.pick, hand: [] }; // Pickの手札をリセット
                data.log.push(["ターン終了", `ジョーカー！ラックの予想失敗。ラックに${dmg}ダメージ。`]);
            } else if (prediction && topCard && topCard.startsWith(prediction)) {
                // 予想が的中した場合 (例: 'A' -> 'AS', 'H' -> 'AH')
                isCorrect = true;
                if (data.flags && data.flags.shieldPick) {
                    updates["flags/shieldPick"] = false;
                    data.log.push(["ターン終了", `ラックの予想的中したが、ピックの守護により無効化。`]);
                } else {
                    updates.pick = { ...data.pick, hp: data.pick.hp - dmg, hand: [] }; // Pickにダメージ & 手札リセット
                    data.log.push(["ターン終了", `ラックの予想的中。ピックに${dmg}ダメージ。`]);
                }
            } else {
                // 予想が外れた場合
                if (data.flags && data.flags.shieldRack) {
                    updates["flags/shieldRack"] = false;
                    data.log.push(["ターン終了", `ラックの予想失敗したが、ラックの守護により無効化。`]);
                } else {
                    updates.rack = { ...data.rack, hp: data.rack.hp - dmg }; // Rackにダメージ
                    updates.pick = { ...data.pick, hand: [] }; // Pickの手札をリセット
                    data.log.push(["ターン終了", `ラックの予想失敗。ラックに${dmg}ダメージ。`]);
                }
            }

            // 次のターンへ
            updates.state = "draw";
            updates.turn = "pick";
            updates.turnCount = (data.turnCount || 0) + 1;
            updates.pending = null; // pendingリセット

            // HPチェック
            checkGameOver(data, updates);

            Object.assign(data, updates);
            return data;
        });

        if (committed && snapshot.val().state !== "ended") {
            pushLog("予想を確定し、ターンを終了しました。次のドローフェーズへ移行します。");
        } else if (committed && snapshot.val().state === "ended") {
             pushLog("予想を確定し、ゲームが終了しました。");
        }
    } catch (error) {
        pushLog("ターン終了処理エラー: " + error.message);
    }
}

// Pickのジョーカーコール
async function jokerCall(isConfirm) {
    if (myRole !== "pick" || !currentRoomId) return;

    const roomRef = ref(db, `${RTDB_ROOT_PATH}/${currentRoomId}`);
    try {
        await runTransaction(roomRef, (data) => {
            if (!data || data.state !== "joker_call" || data.turn !== "rack" || (data.pending.jokerCallBy === "pick" && data.pick.token !== myToken)) {
                return;
            }

            const updates = {};
            const guessHas = isConfirm; // true: 持っていると予想, false: 持っていないと予想
            const actualHas = (data.pick && (data.pick.hand || []).includes(JOKER));
            let dmg = 1;

            if (data.flags && data.flags.doubleDamageActive) {
                dmg *= 2;
            }

            if (guessHas === actualHas) {
                // Pickの予想的中（Pickの勝ち） -> Rackにダメージ
                if (data.flags && data.flags.shieldRack) {
                    updates["flags/shieldRack"] = false;
                    data.log.push(["ジョーカーコール", "ピックの予想的中したが、ラックの守護により無効化。"]);
                } else {
                    updates.rack = { ...data.rack, hp: (data.rack.hp || INITIAL_HP) - dmg };
                    data.log.push(["ジョーカーコール", `ピックの予想的中。ラックに${dmg}ダメージ。`]);
                }
            } else {
                // Pickの予想失敗（Pickの負け） -> Pickにダメージ
                if (data.flags && data.flags.shieldPick) {
                    updates["flags/shieldPick"] = false;
                    data.log.push(["ジョーカーコール", "ピックの予想失敗したが、ピックの守護により無効化。"]);
                } else {
                    updates.pick = { ...data.pick, hp: (data.pick.hp || INITIAL_HP) - dmg };
                    data.log.push(["ジョーカーコール", `ピックの予想失敗。ピックに${dmg}ダメージ。`]);
                }
            }

            // ターン終了処理
            updates.state = "draw";
            updates.pending = null;
            updates["pick/hand"] = []; // Pickの手札リセット
            updates.turnCount = (data.turnCount || 0) + 1;
            updates.turn = "pick";
            updates["flags/doubleDamageActive"] = false;
            updates["flags/revealToRack"] = null;

            // HPチェック
            checkGameOver(data, updates);

            Object.assign(data, updates);
            return data;
        });
        pushLog("ジョーカーコールを完了しました。次のドローフェーズへ移行します。");
    } catch (error) {
        pushLog("ジョーカーコール処理エラー: " + error.message);
    }
}


// Itemの使用
async function useItem(item) {
    if (myRole !== "rack" || !currentRoomId) return;

    const roomRef = ref(db, `${RTDB_ROOT_PATH}/${currentRoomId}`);
    try {
        await runTransaction(roomRef, (data) => {
            if (!data || data.turn !== "rack" || data.state === "ended" || (data.rack.hp || 0) > 2 || (data.rack.itemUsed)) {
                pushLog("アイテムを使用できません（ターン、状態、HP、または使用済み）。");
                return;
            }

            const updates = {};
            const rackItems = data.rack.item || [];
            if (!rackItems.includes(item)) {
                pushLog(`アイテム ${item} を所持していません。`);
                return;
            }

            updates["rack/itemUsed"] = true; // 1ゲーム1回制限
            updates["rack/item"] = rackItems.filter(i => i !== item);

            switch (item) {
              case "Heal3":
                // RackのHPを3回復 (最大INITIAL_HPまで)
                const newHP = Math.min((data.rack.hp || INITIAL_HP) + 3, INITIAL_HP);
                updates["rack/hp"] = newHP;
                data.log.push(["Heal3を使用", `ラックがHPを${newHP - data.rack.hp}回復しました。`]);
                break;
              case "Peek2":
                // 山札のトップ2枚を公開 (revealToRackにセット)
                const deck = data.deck || [];
                if(deck.length < 2) { 
                    pushLog("（エラー）山札のカードが2枚未満のため、Peek2は使用できません。", currentRoomId); 
                    updates["rack/itemUsed"] = false; // 使用フラグを元に戻す
                    updates["rack/item"] = [...rackItems]; // アイテムリストも元に戻す
                    return data; 
                }
                updates["flags/revealToRack"] = deck.slice(0, 2);
                data.log.push(["Peek2を使用", "ラックは山札のトップ2枚を確認しました。"]);
                break;
              case "Shield1":
                // Rackの守護フラグをセット
                updates["flags/shieldRack"] = true;
                data.log.push(["Shield1を使用", "ラックに守護効果（次のダメージ無効化）を付与しました。"]);
                break;
              case "DoubleDamage":
                // ダメージ2倍フラグをセット
                updates["flags/doubleDamageActive"] = true;
                data.log.push(["DoubleDamageを使用", "次の予想ダメージが2倍になります。"]);
                break;
              case "ForceDeclare":
                // Pickにジョーカーコールを強制する
                if(!(data.pick.hand || []).includes(JOKER)) {
                     data.log.push(["ForceDeclareを使用", "ピックはジョーカーを所持していません（効果なし）。"]);
                } else {
                    // 強制ジョーカーコール処理
                    updates.state = "joker_call";
                    updates.turn = "pick"; // Pickのジョーカーコール処理に移行
                    updates.pending = { jokerCallBy: "rack" }; // 強制実行フラグ
                    data.log.push(["ForceDeclareを使用", "ピックにジョーカーコールが強制されました。"]);
                }
                break;
              default:
                // 未知のアイテムは使用をキャンセル
                updates["rack/itemUsed"] = false;
                updates["rack/item"] = [...rackItems]; 
                data.log.push(["アイテム使用", `不明なアイテム ${item} の使用はキャンセルされました。`]);
                break;
            }

            // トランザクション内でupdatesを適用
            Object.assign(data, updates);
            return data;
        });
        pushLog(`アイテム ${item} を使用しました。`);
    } catch (error) {
        pushLog("アイテム使用処理エラー: " + error.message);
    }
}


/* --------------------\n   レンダリングとリスナー\n   -------------------- */

// ゲーム状態のレンダリング
function renderGame(data) {
  if (!data) return;

  // プレイヤー情報
  const myData = myRole === "pick" ? data.pick : data.rack;
  const oppData = myRole === "pick" ? data.rack : data.pick;
  const myHP = myData ? (myData.hp || INITIAL_HP) : "—";
  const oppHP = oppData ? (oppData.hp || INITIAL_HP) : "—";

  el.roomIdText.textContent = data.id || "—";
  el.myRoleText.textContent = myRole ? (myRole === "pick" ? "Pick" : "Rack") : "—";
  el.myHPText.textContent = myHP;
  el.opponentHPText.textContent = oppHP;
  el.turnText.textContent = data.turn || "—";
  el.stateText.textContent = data.state || "—";
  el.deckCount.textContent = (data.deck || []).length;
  el.gameEndOverlay.style.display = data.state === "ended" ? 'flex' : 'none';
  if (data.state === "ended") {
      displayGameEnd(data.winner);
  } else {
      el.gameEndOverlay.style.display = 'none';
  }

  // トップカード表示 (Pickがドローしたカード)
  const pickHand = data.pick ? data.pick.hand || [] : [];
  const topCard = pickHand[pickHand.length - 1];
  const isTopCardVisible = data.state !== "draw" && data.state !== "waiting" && data.state !== "ended" && topCard;
  el.topImg.style.display = isTopCardVisible ? 'block' : 'none';
  el.topCard.innerHTML = isTopCardVisible ? createCardImage(topCard) : createCardImage("?", true);


  // 自分の手札表示 (Pickの場合のみ)
  el.localHandArea.innerHTML = myRole === "pick" && myData && myData.hand ?
    myData.hand.map(card => createCardImage(card)).join('') :
    '—';

  // アイテム表示 (Rackの場合のみ)
  el.myItemText.textContent = myRole === "rack" && myData && myData.item ? 
      myData.item.join(', ') : '—';
  el.itemArea.innerHTML = myRole === "rack" && myData && myData.item ?
      myData.item.map(item => `<div class="itemcard" data-item="${item}" style="cursor:pointer; padding: 4px 8px; border: 1px solid var(--accent); border-radius: 4px; margin-right: 4px;">${item}</div>`).join('') :
      '—';


  // Peek2公開情報表示 (Rackの場合のみ)
  const revealCards = data.flags && data.flags.revealToRack && myRole === "rack" ? data.flags.revealToRack : [];
  el.peekArea.innerHTML = revealCards.length > 0 ?
      revealCards.map(card => createCardImage(card)).join('') :
      '—';


  // ログ表示
  if (data.log && data.log.length > 0) {
      el.logArea.textContent = data.log.map(entry => {
          const [type, message] = entry;
          return `[${type}] ${message}`;
      }).join('\n');
  }

  // ボタンの活性化/非活性化
  const isMyTurn = data.turn === myRole;
  const isOtherPlayerPresent = data.pick && data.rack;

  el.btnDraw.disabled = !(isOtherPlayerPresent && data.state === "draw" && isMyTurn && myRole === "pick");
  el.btnPredict.disabled = !(isOtherPlayerPresent && data.state === "predict_start" && isMyTurn && myRole === "rack");
  el.btnExtra.disabled = !(isOtherPlayerPresent && data.state === "predict_extra" && isMyTurn && myRole === "rack");
  el.btnJokerCall.disabled = !(isOtherPlayerPresent && data.state === "joker_call" && isMyTurn && myRole === "pick");
  // Rackのみ、HP2以下、使用済みでない
  const isItemUsable = isOtherPlayerPresent && myRole === "rack" && (myData.hp || 0) <= 2 && !(myData.itemUsed);
  el.btnUseItem.disabled = !isItemUsable;
  
  // PredictとExtraが両方押せる状態なら、Extraボタンをターン終了ボタンとして使う
  if (data.state === "predict_extra" && isMyTurn && myRole === "rack") {
      el.btnExtra.textContent = "ターン終了（予想確定）";
      el.btnExtra.onclick = () => endTurn(); // ターン終了処理を割り当て
  } else {
      el.btnExtra.textContent = "エクストラ予想（ラックのみ）";
      el.btnExtra.onclick = () => {
          const prediction = prompt("エクストラ予想: カードの数字(A-K)またはスート(S, H, D, C)を入力してください。");
          if (prediction) extraPrediction(prediction.toUpperCase().trim());
      };
  }

  // 初期予想ボタンは、初期予想を行うか、ターンをスキップする
  if (data.state === "predict_start" && isMyTurn && myRole === "rack") {
    el.btnPredict.textContent = "予想/ターン終了";
    el.btnPredict.onclick = () => {
        const action = prompt("予想を行いますか？(y/n)");
        if (action && action.toLowerCase().startsWith('y')) {
            const prediction = prompt("初期予想: カードの数字(A-K)またはスート(S, H, D, C)を入力してください。");
            if (prediction) startPrediction(prediction.toUpperCase().trim());
        } else if (action && action.toLowerCase().startsWith('n')) {
             endTurn(); // 予想なしでターン終了
        }
    };
  } else {
     el.btnPredict.textContent = "ラックの初期予想（ラックのみ）";
     el.btnPredict.onclick = () => {
        const prediction = prompt("初期予想: カードの数字(A-K)またはスート(S, H, D, C)を入力してください。");
        if (prediction) startPrediction(prediction.toUpperCase().trim());
     };
  }
}

// Firebaseリスナー設定
function setupGameListener(roomId) {
  const roomRef = ref(db, `${RTDB_ROOT_PATH}/${roomId}`);

  onValue(roomRef, (snapshot) => {
    const data = snapshot.val();
    if (data) {
      if (myToken && data[myRole] && data[myRole].token !== myToken) {
          // トークンが一致しない場合（予期しない上書きなど）
          pushLog("エラー：あなたのトークンが上書きされました。再参加してください。");
          return;
      }
      renderGame(data);
    } else {
      // ルームが削除された場合
      pushLog("ルームが閉じられました。");
      currentRoomId = null;
      myRole = null;
      myToken = null;
      window.location.reload();
    }
  }, (error) => {
    pushLog("Firebaseデータの読み込みエラー: " + error.message);
  });
}

/* --------------------\n   イベントリスナー\n   -------------------- */

// ルーム作成・参加ボタン
el.btnCreate.addEventListener("click", createRoom);
el.btnJoin.addEventListener("click", joinRoom);
el.btnReset.addEventListener("click", resetGame);

// ゲームアクションボタン
el.btnDraw.addEventListener("click", drawCard);

// エクストラ予想は renderGame で endTurn/extraPrediction に動的に切り替え

// ジョーカーコール
el.btnJokerCall.addEventListener("click", () => {
    const ans = prompt("ジョーカーコール: ラックがジョーカーを所持していると思いますか？ はい(y) / いいえ(n)");
    if(!ans) return;
    const isConfirm = ans.toLowerCase().startsWith("y");
    jokerCall(isConfirm);
});

// アイテム使用
el.btnUseItem.addEventListener("click", () => {
    const myData = myRole === "rack" ? (document.querySelector('#itemArea').textContent || "") : null;
    if (!myData) {
        pushLog("アイテムを所持していません。");
        return;
    }
    const items = myData.split(',').map(s => s.trim()).filter(s => s.length > 0);
    const item = prompt(`使用したいアイテムを選択してください: ${items.join(', ')}`);
    if (item && items.includes(item)) {
        useItem(item);
    } else if (item) {
        pushLog(`無効なアイテム名が入力されました: ${item}`);
    }
});

// アイテムエリアのクリックイベント（デリゲート）
el.itemArea.addEventListener('click', (event) => {
    const itemElement = event.target.closest('.itemcard');
    if (itemElement) {
        const item = itemElement.dataset.item;
        if (item) {
            // HPチェックなどはuseItem側で再度行われるが、ここでは簡易的なチェックのみ
            const myData = myRole === "rack" ? (document.querySelector('#myItem').textContent || "") : null;
            if ((document.getElementById("myHP").textContent || 0) <= 2 && myRole === "rack" && myData.includes(item)) {
                useItem(item);
            } else {
                pushLog("アイテムを使用できません（HPが3以上、またはPickです）。");
            }
        }
    }
});

// --- 初期ロード時の処理 ---
window.onload = function() {
  // 初期化時のログ
  pushLog("Luck & Pick ゲームを開始します。ルームIDを入力して作成または参加してください。");
};
