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
  statusText: document.getElementById("status"),
  turnText: document.getElementById("turn"),
  stateText: document.getElementById("state"),
  logText: document.getElementById("log"),
  myRoleText: document.getElementById("myRole"),
  myHpText: document.getElementById("myHp"),
  myTokenText: document.getElementById("myToken"),
  myDeckText: document.getElementById("myDeck"),
  myPredictionText: document.getElementById("myPrediction"),
  opponentHpText: document.getElementById("opponentHp"),
  opponentTokenText: document.getElementById("opponentToken"),
  opponentDeckText: document.getElementById("opponentDeck"),
  topCardArea: document.getElementById("topCard"),
  topCardImg: document.getElementById("topImg"),
  localHandArea: document.getElementById("localHand"),
  itemArea: document.getElementById("itemArea"),
  myItemText: document.getElementById("myItem"),
  peekArea: document.getElementById("peekArea"), // Peek2公開用エリア
  gameArea: document.getElementById("gameArea"), // ゲームエリア全体
  resultArea: document.getElementById("resultArea"), // リザルトエリア全体
  resultText: document.getElementById("resultText"), // リザルト表示テキスト
};

/* --------------------
   定数
   -------------------- */
const INITIAL_HP = 5;
const INITIAL_TOKEN = 3;
const ROLE = {
  RACK: "rack",
  PICK: "pick",
};
const STATE = {
  DRAW: "draw",
  PREDICT: "predict",
  EXTRA: "extra",
  JOKER_CALL: "joker_call",
  END: "end", // 終了ステートを追加
};
const CARDS = ["A", "2", "3", "4", "5", "6", "7", "8", "9", "T", "J"]; // T=10
const JOKER = "J";

// カード画像のマッピング (例)
const CARD_IMAGES = {
  A: "https://placehold.co/60x90/cc3333/ffffff?text=A",
  2: "https://placehold.co/60x90/33cc33/ffffff?text=2",
  3: "https://placehold.co/60x90/3333cc/ffffff?text=3",
  4: "https://placehold.co/60x90/cccc33/ffffff?text=4",
  5: "https://placehold.co/60x90/cc33cc/ffffff?text=5",
  6: "https://placehold.co/60x90/33cccc/ffffff?text=6",
  7: "https://placehold.co/60x90/ff6600/ffffff?text=7",
  8: "https://placehold.co/60x90/6600ff/ffffff?text=8",
  9: "https://placehold.co/60x90/009900/ffffff?text=9",
  T: "https://placehold.co/60x90/000000/ffffff?text=10",
  J: "https://placehold.co/60x90/ff9900/000000?text=JOKER", // ジョーカー
  BACK: "https://placehold.co/60x90/333333/ffffff?text=?", // 裏面
};

// アイテムの定義
const ITEMS = {
  Peek2: { name: "Peek2", description: "山札のトップ2枚を確認（Peek2）" },
  Shield1: { name: "Shield1", description: "次の一回のみダメージを無効化（Shield1）" },
  DoubleDamage: { name: "DoubleDamage", description: "次の予想ダメージを2倍（DoubleDamage）" },
  ForceDeclare: { name: "ForceDeclare", description: "Pickにジョーカーコールを強制（ForceDeclare）" },
};

/* --------------------
   グローバル変数
   -------------------- */
let myRole = null; // 自分の役割
let roomId = null; // 現在のルームID
let token = null; // 自分のトークン
let logCounter = 0; // ログ表示用のカウンター

/* --------------------
   ユーティリティ
   -------------------- */

// ログ表示
const pushLog = (message) => {
  const timestamp = new Date().toLocaleTimeString("ja-JP", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  logCounter++;
  const formattedMessage = `[${timestamp} #${logCounter}] ${message}\n`;
  el.logText.textContent = formattedMessage + el.logText.textContent;
  console.log(message);
};

// シャッフル
const shuffle = (array) => {
  for (let i = array.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [array[i], array[j]] = [array[j], array[i]];
  }
  return array;
};

// カードの画像を生成
const createCardImage = (card) => {
  const img = document.createElement("img");
  img.className = "imgcard";
  img.src = CARD_IMAGES[card] || CARD_IMAGES.BACK;
  img.alt = card;
  img.dataset.card = card;
  return img;
};

// 数字カードの値を取得 (JOKERは常に11として扱う)
const getCardValue = (card) => {
  if (card === JOKER) return 11;
  if (card === "T") return 10;
  return parseInt(card, 10);
};

/* --------------------
   ゲーム状態の初期化
   -------------------- */

const initializeGameData = (pickToken, rackToken) => {
  // 3セット（1-10 + J）* 3の山札
  let deck = [];
  for (let i = 0; i < 3; i++) {
    deck = deck.concat(CARDS);
  }
  deck = shuffle(deck);

  // 初期アイテム (Rackのみ)
  const initialItems = shuffle(Object.keys(ITEMS)).slice(0, 3);

  const initialData = {
    state: STATE.DRAW, // 初期状態はドローから
    turn: ROLE.PICK, // 初期ターンはピック
    turnCount: 1,
    deck: deck, // 山札
    topCard: null, // 現在表向きのカード
    pending: null, // 待機中の処理 (e.g., predict, joker_call)
    pick: {
      token: pickToken,
      hp: INITIAL_HP,
      hand: [], // ピックの手札
    },
    rack: {
      token: rackToken,
      hp: INITIAL_HP,
      items: initialItems, // ラックのアイテム
      itemUsed: false, // アイテム使用済みフラグ（1ゲーム1回）
    },
    flags: {
      // 状態フラグ
      shieldRack: false, // ラックの守護
      shieldPick: false, // ピックの守護
      doubleDamageActive: false, // ダメージ2倍
      revealToRack: null, // Peek2でラックに公開されたカード ([card1, card2] or null)
    },
    // 勝敗判定
    winner: null, // 勝者 (null, 'rack', 'pick', 'draw')
    resultReason: null, // 勝敗理由
  };
  return initialData;
};

/* --------------------
   メイン処理
   -------------------- */

// 勝敗判定処理
const checkGameEnd = (data) => {
  const updates = {};
  let winner = null;
  let reason = null;

  // 1. HPチェック
  if (data.pick.hp <= 0 && data.rack.hp <= 0) {
    winner = "draw";
    reason = "両者のHPが0以下になりました。引き分けです。";
  } else if (data.pick.hp <= 0) {
    winner = ROLE.RACK;
    reason = "ピックのHPが0になりました。ラックの勝利です。";
  } else if (data.rack.hp <= 0) {
    winner = ROLE.PICK;
    reason = "ラックのHPが0になりました。ピックの勝利です。";
  }

  // 2. 山札切れチェック（HPチェックが勝敗を決定しなかった場合のみ実行）
  if (winner === null && (data.deck || []).length === 0) {
    reason = "山札が尽きました。残りのHPで勝敗を決定します。";
    if (data.pick.hp > data.rack.hp) {
      winner = ROLE.PICK;
      reason += " ピックのHPが多いため、ピックの勝利です。";
    } else if (data.rack.hp > data.pick.hp) {
      winner = ROLE.RACK;
      reason += " ラックのHPが多いため、ラックの勝利です。";
    } else {
      winner = "draw";
      reason += " 両者のHPが同点のため、引き分けです。";
    }
  }

  if (winner) {
    updates["winner"] = winner;
    updates["resultReason"] = reason;
    updates["state"] = STATE.END;
    pushLog("ゲーム終了! 勝者: " + winner + ", 理由: " + reason);
  }

  return updates;
};

// 予想処理のトランザクション
const processPrediction = async (data, prediction, isExtra) => {
  // ピックの手札と山札のトップを取得
  const pickCard = data.pick.hand?.[0];
  const topCard = data.deck?.[0];

  if (!pickCard || !topCard) {
    pushLog("（エラー）カードが不足しています。予想できません。");
    return;
  }

  const pickValue = getCardValue(pickCard);
  const topValue = getCardValue(topCard);

  const updates = {
    // ターン終了共通処理
    topCard: topCard, // トップカードを表にする
    "deck/0": null, // 山札から除去
    deck: data.deck.slice(1),
    "pick/hand": [], // ピックの手札を空にする
    turnCount: (data.turnCount || 1) + 1,
    turn: ROLE.PICK, // 次のターンはピック
    state: STATE.DRAW, // 次の状態はドロー
    pending: null,
    "flags/revealToRack": null, // Peek2情報をリセット
    "flags/doubleDamageActive": false, // ダメージ2倍をリセット
  };

  // 予想の勝敗判定
  let hit = false;
  if (prediction === "over") {
    hit = topValue > pickValue;
  } else if (prediction === "under") {
    hit = topValue < pickValue;
  } else if (prediction === "equal") {
    hit = topValue === pickValue;
  }

  const dmgMultiplier = (data.flags && data.flags.doubleDamageActive) ? 2 : 1;
  const damage = isExtra ? 2 * dmgMultiplier : 1 * dmgMultiplier;
  const isJoker = topCard === JOKER; // トップカードがジョーカーか

  let logMsg = `予想: ${prediction} / 結果: ${pickValue} (${pickCard}) vs ${topValue} (${topCard})。`;
  let resultMsg = "";

  if (hit && !isJoker) {
    // ラックの予想が的中（ジョーカーではない）
    if (data.flags && data.flags.shieldPick) {
      updates["flags/shieldPick"] = false;
      resultMsg = `ラックの予想的中。ピックに${damage}ダメージ。`;
      logMsg += resultMsg + "ピックの守護が無効化されました。";
    } else {
      updates["pick/hp"] = (data.pick.hp || INITIAL_HP) - damage;
      resultMsg = `ラックの予想的中。ピックに${damage}ダメージ。`;
      logMsg += resultMsg;
    }
  } else if (!hit && !isJoker) {
    // ラックの予想が失敗（ジョーカーではない）
    if (data.flags && data.flags.shieldRack) {
      updates["flags/shieldRack"] = false;
      resultMsg = `ラックの予想失敗。ラックに${damage}ダメージ。`;
      logMsg += resultMsg + "ラックの守護が無効化されました。";
    } else {
      updates["rack/hp"] = (data.rack.hp || INITIAL_HP) - damage;
      resultMsg = `ラックの予想失敗。ラックに${damage}ダメージ。`;
      logMsg += resultMsg;
    }
  } else if (isJoker) {
    // トップカードがジョーカーの場合
    const currentToken = (data.pick.token || INITIAL_TOKEN);
    const newToken = Math.max(0, currentToken - 1);
    updates["pick/token"] = newToken;
    resultMsg = `トップカードはジョーカー。ピックのトークンが1減少 (${currentToken} → ${newToken})。`;
    logMsg += resultMsg;
  }

  pushLog(logMsg);

  // ターン終了時の勝敗判定を実行
  Object.assign(updates, checkGameEnd({ ...data, ...updates }));

  return updates;
};

// --------------------
// イベントハンドラ: 部屋操作
// --------------------

// 部屋作成
el.btnCreate.onclick = async () => {
  const newRoomId = el.roomInput.value.trim();
  if (!newRoomId) return alert("ルームIDを入力してください。");

  // トークン生成
  const pickToken = Math.random().toString(36).substring(2, 8);
  const rackToken = Math.random().toString(36).substring(2, 8);

  const initialData = initializeGameData(pickToken, rackToken);
  const roomRef = ref(db, "rooms/" + newRoomId);

  try {
    // トランザクションで部屋の存在チェックと作成をアトミックに行う
    const result = await runTransaction(roomRef, (currentData) => {
      if (currentData === null) {
        // 部屋が存在しない場合、作成する
        return initialData;
      } else {
        // 部屋が既に存在する場合、中断
        return undefined;
      }
    });

    if (result.committed) {
      roomId = newRoomId;
      myRole = ROLE.PICK; // 作成者はピック
      token = pickToken;
      pushLog(`ルーム「${roomId}」を作成しました。あなたの役割は「ピック」です。`);
      pushLog(`あなたのトークン: ${token}`);
      el.statusText.textContent = `ルームID: ${roomId} / 役割: ピック`;
      el.roomIdText.textContent = roomId;
      setupGameListener();
    } else {
      alert("そのルームIDは既に存在します。");
    }
  } catch (error) {
    console.error("部屋作成エラー:", error);
    alert("部屋作成中にエラーが発生しました。");
  }
};

// 部屋参加
el.btnJoin.onclick = async () => {
  roomId = el.roomInput.value.trim();
  if (!roomId) return alert("ルームIDを入力してください。");

  const roomRef = ref(db, "rooms/" + roomId);
  try {
    const snapshot = await get(roomRef);
    const data = snapshot.val();

    if (data) {
      if (data.pick && data.rack) {
        // 両プレイヤーがいる場合はエラー（今回はシンプル化のため）
        alert("このゲームは2人用です。既に両プレイヤーが参加しています。");
        return;
      }

      // ラックとして参加
      if (!data.rack) {
        myRole = ROLE.RACK;
        token = data.rack.token; // 既存のラックトークンを取得
        pushLog(`ルーム「${roomId}」に参加しました。あなたの役割は「ラック」です。`);
        pushLog(`あなたのトークン: ${token}`);
        el.statusText.textContent = `ルームID: ${roomId} / 役割: ラック`;
        el.roomIdText.textContent = roomId;
        setupGameListener();
      } else {
        alert("両プレイヤーが揃っています。");
      }
    } else {
      alert("そのルームIDは存在しません。");
    }
  } catch (error) {
    console.error("部屋参加エラー:", error);
    alert("部屋参加中にエラーが発生しました。");
  }
};

// リセット
el.btnReset.onclick = async () => {
  if (!roomId || !myRole || !token) {
    return alert("ルームに参加していません。");
  }

  const roomRef = ref(db, "rooms/" + roomId);
  const initialData = initializeGameData(
    // トークンはそのまま引き継ぐ
    myRole === ROLE.PICK ? token : null,
    myRole === ROLE.RACK ? token : null
  );

  try {
    // トランザクション内でリセット処理を実行
    await runTransaction(roomRef, (currentData) => {
      if (currentData !== null) {
        // トークン情報だけは現行のものを引き継ぐ
        const pickToken = currentData.pick.token;
        const rackToken = currentData.rack.token;

        // 新しい初期データに既存のトークンを上書き
        initialData.pick.token = pickToken;
        initialData.rack.token = rackToken;

        return initialData;
      }
      return undefined; // 何もしない
    });
    pushLog("ゲームをリセットしました。");
  } catch (error) {
    console.error("リセットエラー:", error);
    alert("ゲームリセット中にエラーが発生しました。");
  }
};

// --------------------
// イベントハンドラ: ゲーム操作
// --------------------

// ピックのドロー
el.btnDraw.onclick = async () => {
  if (myRole !== ROLE.PICK) return alert("あなたはピックではありません。");

  const updates = {};
  await runTransaction(ref(db, "rooms/" + roomId), (currentData) => {
    if (currentData && currentData.pick.token === token) {
      const data = currentData;

      if (data.state !== STATE.DRAW) {
        pushLog("（エラー）現在はドローフェーズではありません。");
        return;
      }
      if (data.turn !== ROLE.PICK) {
        pushLog("（エラー）今はピックのターンではありません。");
        return;
      }

      // ** 山札切れの事前チェック **
      if (data.deck.length === 0) {
        pushLog("（エラー）山札が空です。ゲーム終了処理へ移行します。");
        // 山札がない状態でドローを試みた場合も、終了チェックを実行
        Object.assign(updates, checkGameEnd(data));
        return { ...data, ...updates }; // 終了処理をトランザクションに反映
      }


      // 1枚引いて手札に
      const card = data.deck[0];
      updates["deck"] = data.deck.slice(1);
      updates["pick/hand"] = [card];
      updates["state"] = STATE.PREDICT; // 次はラックの予想フェーズ
      updates["turn"] = ROLE.RACK; // 次はラックのターン
      updates["topCard"] = CARD_IMAGES.BACK; // トップカードは裏向きのまま
      updates["pending"] = null; // 待機中処理をクリア

      pushLog("ピックがカードをドローしました。");
      return { ...data, ...updates };
    }
  });
};

// ラックの初期予想
el.btnPredict.onclick = async () => {
  if (myRole !== ROLE.RACK) return alert("あなたはラックではありません。");

  const prediction = prompt(
    "予想を選択してください:\n[O]ver (数字が大きい)\n[U]nder (数字が小さい)\n[E]qual (数字が同じ)"
  );
  if (!prediction) return;

  const p = prediction.toLowerCase();
  let selectedPrediction = null;
  if (p.startsWith("o")) selectedPrediction = "over";
  else if (p.startsWith("u")) selectedPrediction = "under";
  else if (p.startsWith("e")) selectedPrediction = "equal";
  else return alert("無効な予想です。");

  const updates = {};
  await runTransaction(ref(db, "rooms/" + roomId), (currentData) => {
    if (currentData && currentData.rack.token === token) {
      const data = currentData;

      if (data.state !== STATE.PREDICT) {
        pushLog("（エラー）現在は予想フェーズではありません。");
        return;
      }
      if (data.turn !== ROLE.RACK) {
        pushLog("（エラー）今はラックのターンではありません。");
        return;
      }

      updates["pending"] = { prediction: selectedPrediction };
      updates["state"] = STATE.EXTRA; // 次はエクストラ予想フェーズ（またはそのまま処理）

      pushLog(`ラックが初期予想: ${selectedPrediction} を行いました。`);
      return { ...data, ...updates };
    }
  });
};

// ラックのエクストラ予想
el.btnExtra.onclick = async () => {
  if (myRole !== ROLE.RACK) return alert("あなたはラックではありません。");

  const updates = {};
  await runTransaction(ref(db, "rooms/" + roomId), async (currentData) => {
    if (currentData && currentData.rack.token === token) {
      const data = currentData;

      if (data.state !== STATE.EXTRA) {
        pushLog("（エラー）現在はエクストラ予想フェーズではありません。");
        return;
      }
      if (data.turn !== ROLE.RACK) {
        pushLog("（エラー）今はラックのターンではありません。");
        return;
      }

      // 1. エクストラ予想を行うか確認
      const ans = prompt("エクストラ予想をしますか？ (トークン1消費) yes / no");
      if (!ans) return;
      const willExtra = ans.toLowerCase().startsWith("y");

      if (willExtra) {
        // 2. トークンを消費できるかチェック
        const currentToken = data.rack.token || INITIAL_TOKEN;
        if (currentToken <= 0) {
          pushLog("（エラー）エクストラ予想にはトークンが必要です。");
          return;
        }

        updates["rack/token"] = currentToken - 1; // トークン消費
        pushLog("ラックがエクストラ予想を行いました（トークン1消費）。");

        // 3. エクストラ予想の内容を再度尋ねる（初期予想を上書き）
        const prediction = prompt(
          "エクストラ予想を選択してください:\n[O]ver (数字が大きい)\n[U]nder (数字が小さい)\n[E]qual (数字が同じ)"
        );
        if (!prediction) {
          pushLog("（エラー）予想が中断されました。トークンは元に戻りません。");
          // トークン消費は確定
          updates["pending"] = null;
          updates["state"] = STATE.DRAW;
          updates["turn"] = ROLE.PICK;
          updates["turnCount"] = (data.turnCount || 1) + 1;
          return { ...data, ...updates };
        }

        const p = prediction.toLowerCase();
        let selectedPrediction = null;
        if (p.startsWith("o")) selectedPrediction = "over";
        else if (p.startsWith("u")) selectedPrediction = "under";
        else if (p.startsWith("e")) p = "equal";
        else {
          pushLog("（エラー）無効な予想が入力されました。トークンは元に戻りません。");
          updates["pending"] = null;
          updates["state"] = STATE.DRAW;
          updates["turn"] = ROLE.PICK;
          updates["turnCount"] = (data.turnCount || 1) + 1;
          return { ...data, ...updates };
        }

        // 4. 予想を確定し、勝敗処理を実行
        const predictionToProcess = selectedPrediction; // エクストラ予想を適用
        Object.assign(
          updates,
          await processPrediction(data, predictionToProcess, true)
        ); // isExtra = true

        return { ...data, ...updates };
      } else {
        // エクストラ予想をしない場合、初期予想で勝敗処理を実行
        const predictionToProcess = data.pending.prediction; // 初期予想を適用
        Object.assign(
          updates,
          await processPrediction(data, predictionToProcess, false)
        ); // isExtra = false

        return { ...data, ...updates };
      }
    }
  });
};

// ピックのジョーカーコール
el.btnJokerCall.onclick = async () => {
  if (myRole !== ROLE.PICK) return alert("あなたはピックではありません。");

  const updates = {};
  await runTransaction(ref(db, "rooms/" + roomId), async (currentData) => {
    if (currentData && currentData.pick.token === token) {
      const data = currentData;

      if (data.state !== STATE.PREDICT && data.state !== STATE.EXTRA) {
        pushLog("（エラー）ジョーカーコールは予想フェーズでのみ可能です。");
        return;
      }
      if (data.turn !== ROLE.RACK) {
        pushLog("（エラー）ジョーカーコールはラックのターン中に実行します。");
        return;
      }

      const ans = prompt(
        "ジョーカーコール: ラックがジョーカーを所持していると思いますか？ yes / no"
      );
      if (!ans) return;
      const guessHas = ans.toLowerCase().startsWith("y");
      const actualHas = (data.pick && (data.pick.hand || []).includes(JOKER));

      let dmg = 1;
      if (data.flags && data.flags.doubleDamageActive) dmg *= 2;

      // 勝敗判定
      if (guessHas === actualHas) {
        // ピックの予想的中
        if (data.flags && data.flags.shieldPick) {
          updates["flags/shieldPick"] = false;
          pushLog("ジョーカーコール: ピックの予想的中。ピックの守護がジョーカーコールを無効化");
        } else {
          updates["pick/hp"] = (data.pick.hp || INITIAL_HP) - dmg;
          pushLog("ジョーカーコール: ピックの予想的中。ピックに" + dmg + "ダメージ");
        }
      } else {
        // ピックの予想失敗
        if (data.flags && data.flags.shieldRack) {
          updates["flags/shieldRack"] = false;
          pushLog("ジョーカーコール: ピックの予想失敗。ラックの守護がジョーカーコールを無効化");
        } else {
          updates["rack/hp"] = (data.rack.hp || INITIAL_HP) - dmg;
          pushLog("ジョーカーコール: ピックの予想失敗。ラックに" + dmg + "ダメージ");
        }
      }

      // 処理終了後の状態遷移（予想は行われずにターン終了）
      updates["state"] = STATE.DRAW;
      updates["pending"] = null;
      updates["pick/hand"] = []; // 手札を空にする
      updates["turnCount"] = (data.turnCount || 1) + 1;
      updates["turn"] = ROLE.PICK;
      updates["flags/doubleDamageActive"] = false; // ダメージ2倍をリセット

      // ターン終了時の勝敗判定を実行
      Object.assign(updates, checkGameEnd({ ...data, ...updates }));

      return { ...data, ...updates };
    }
  });
};

// ラックのアイテム使用
el.btnUseItem.onclick = async () => {
  if (myRole !== ROLE.RACK) return alert("あなたはラックではありません。");

  const updates = {};
  await runTransaction(ref(db, "rooms/" + roomId), async (currentData) => {
    if (currentData && currentData.rack.token === token) {
      const data = currentData;
      const rackHp = data.rack.hp || INITIAL_HP;

      if (rackHp > 2) {
        pushLog("（エラー）アイテムはラックのHPが2以下のときのみ使用可能です。");
        return;
      }
      if (data.rack.itemUsed) {
        pushLog("（エラー）アイテムは1ゲーム中に一度しか使用できません。");
        return;
      }
      if (data.rack.items.length === 0) {
        pushLog("（エラー）使用できるアイテムがありません。");
        return;
      }

      const itemNames = data.rack.items.join(", ");
      const selectedItem = prompt(
        `使用するアイテム名を入力してください: (${itemNames})`
      );
      if (!selectedItem) return;

      const itemKey = Object.keys(ITEMS).find(
        (key) => key.toLowerCase() === selectedItem.toLowerCase()
      );
      if (!itemKey) {
        pushLog("（エラー）無効なアイテム名です。");
        return;
      }

      // アイテム消費
      const newItems = data.rack.items.filter((i) => i !== itemKey);
      updates["rack/items"] = newItems;
      updates["rack/itemUsed"] = true; // 使用フラグを立てる

      // アイテムごとの効果
      switch (itemKey) {
        case "Peek2":
          // 山札のトップ2枚を公開
          const deck = data.deck || [];
          if (deck.length < 2) {
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
          if (!(data.pick.hand || []).includes(JOKER)) {
            pushLog("ForceDeclareを使用: ピックはジョーカーを所持していません（効果なし）。");
          } else {
            // 強制ジョーカーコール処理
            updates["state"] = STATE.JOKER_CALL;
            updates["turn"] = ROLE.RACK; // そのままラックのターン
            updates["pending"] = { jokerCallBy: ROLE.RACK };
            pushLog("ForceDeclareを使用: ピックにジョーカーコールを強制しました。");
          }
          break;
      }

      return { ...data, ...updates };
    }
  });
};

/* --------------------
   ビューの更新
   -------------------- */

// ビューを更新する関数
const updateView = (data) => {
  if (!data) return;

  // 1. 共通情報
  el.turnText.textContent = data.turn === ROLE.PICK ? "ピック" : "ラック";
  el.stateText.textContent = {
    draw: "ドロー（ピック）",
    predict: "予想（ラック）",
    extra: "追加予想（ラック）",
    joker_call: "強制ジョーカーコール",
    end: "ゲーム終了", // 終了ステートの表示
  }[data.state] || data.state;

  // 2. プレイヤー情報
  const myData = data[myRole];
  const oppRole = myRole === ROLE.PICK ? ROLE.RACK : ROLE.PICK;
  const oppData = data[oppRole];

  if (myData) {
    el.myRoleText.textContent = myRole === ROLE.PICK ? "ピック" : "ラック";
    el.myHpText.textContent = myData.hp;
    el.myTokenText.textContent = myData.token;
    el.myDeckText.textContent = (myData.hand || []).length;
    el.myPredictionText.textContent = data.pending?.prediction || "—";
  }

  if (oppData) {
    el.opponentHpText.textContent = oppData.hp;
    el.opponentTokenText.textContent = oppData.token;
    el.opponentDeckText.textContent = (oppData.hand || []).length;
  }

  // 3. トップカード表示
  el.topCardImg.src = CARD_IMAGES[data.topCard] || CARD_IMAGES.BACK;
  el.topCardImg.style.display = data.topCard ? "block" : "none";

  // 4. 自分の手札表示
  el.localHandArea.innerHTML = "";
  if (myRole === ROLE.PICK && myData && myData.hand && myData.hand.length > 0) {
    myData.hand.forEach((card) => {
      el.localHandArea.appendChild(createCardImage(card));
    });
  }

  // 5. アイテム表示（ラックのみ）
  el.myItemText.textContent = myRole === ROLE.RACK && data.rack.itemUsed ? "使用済み" : "未使用";
  el.itemArea.innerHTML = "";
  if (myRole === ROLE.RACK && data.rack.items && data.rack.items.length > 0) {
    data.rack.items.forEach((itemKey) => {
      const item = ITEMS[itemKey];
      const div = document.createElement("div");
      div.className = "card";
      div.style.backgroundColor = "#ff7e7e";
      div.style.color = "#000";
      div.style.padding = "4px 8px";
      div.style.borderRadius = "4px";
      div.textContent = item.name;
      el.itemArea.appendChild(div);
    });
  }

  // 6. Peek2公開情報
  el.peekArea.innerHTML = "";
  if (myRole === ROLE.RACK && data.flags.revealToRack) {
    data.flags.revealToRack.forEach((card) => {
      el.peekArea.appendChild(createCardImage(card));
    });
  }

  // 7. ボタン表示制御
  el.btnDraw.disabled = !(
    myRole === ROLE.PICK &&
    data.state === STATE.DRAW &&
    data.turn === ROLE.PICK
  );
  el.btnPredict.disabled = !(
    myRole === ROLE.RACK &&
    data.state === STATE.PREDICT &&
    data.turn === ROLE.RACK
  );
  el.btnExtra.disabled = !(
    myRole === ROLE.RACK &&
    data.state === STATE.EXTRA &&
    data.turn === ROLE.RACK
  );
  el.btnJokerCall.disabled = !(
    myRole === ROLE.PICK &&
    (data.state === STATE.PREDICT || data.state === STATE.EXTRA) &&
    data.turn === ROLE.RACK
  );
  el.btnUseItem.disabled = !(
    myRole === ROLE.RACK &&
    (data.rack.hp || INITIAL_HP) <= 2 &&
    !data.rack.itemUsed &&
    data.rack.items.length > 0
  );

  // 8. 守護・ダメージ2倍フラグの表示
  const flags = data.flags;
  const flagText = [];
  if (flags.shieldRack) flagText.push("守護(R)");
  if (flags.shieldPick) flagText.push("守護(P)");
  if (flags.doubleDamageActive) flagText.push("2倍DMG");
  if (flags.revealToRack) flagText.push("Peek2済");

  document.getElementById("flagsText").textContent =
    flagText.length > 0 ? flagText.join(" / ") : "—";


  // 9. ゲーム終了表示
  if (data.state === STATE.END) {
    el.gameArea.style.display = 'none';
    el.resultArea.style.display = 'block';
    el.resultText.textContent = `勝者: ${data.winner === 'draw' ? '引き分け' : data.winner.toUpperCase()} \n理由: ${data.resultReason}`;
  } else {
    el.gameArea.style.display = 'block';
    el.resultArea.style.display = 'none';
  }

};

/* --------------------
   リスナー設定
   -------------------- */

// データベースリスナーの設定
const setupGameListener = () => {
  const roomRef = ref(db, "rooms/" + roomId);
  onValue(roomRef, (snapshot) => {
    const data = snapshot.val();
    if (data) {
      updateView(data);
    } else {
      pushLog("ルームデータがリセットされたか、存在しません。");
      // UIを初期状態に戻すなどの処理
    }
  });
};

