const fs = require('fs');
const bs58 = require('bs58');
const readline = require('readline');
const {
  Connection,
  Keypair,
  PublicKey,
  LAMPORTS_PER_SOL,
  clusterApiUrl,
  SystemProgram,
  Transaction,
  sendAndConfirmTransaction
} = require('@solana/web3.js');

// === Настройки ===

// RPC для доступа к сети Solana (можете заменить на свой RPC)
const RPC_URL = clusterApiUrl('mainnet-beta');
// Пример кастомного RPC:
// const RPC_URL = 'https://api.mainnet-beta.solana.com';
// const RPC_URL = 'https://my-quicknode-url/';

const connection = new Connection(RPC_URL, 'confirmed');

// Файл с Base58-приватными ключами
const WALLET_KEYS_FILE = './wallets.txt';

// Адрес, на который собираем средства (для режима "сбор средств")
const TARGET_ADDRESS = new PublicKey('ВСТАВЬТЕ_ТУТ_ЦЕЛЕВОЙ_АДРЕС');

// Файл, куда сохраняем результаты проверки баланса (для режима "проверка")
const OUTPUT_JSON_FILE = './balances.json';

// === Функция чтения Base58-ключей из файла и превращения их в Keypair ===
function loadKeypairsFromTxt(filePath) {
  const fileContent = fs.readFileSync(filePath, 'utf8');
  const lines = fileContent
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);

  return lines.map((base58Str) => {
    const secretKeyBytes = bs58.decode(base58Str);
    return Keypair.fromSecretKey(secretKeyBytes);
  });
}

// === 1) Проверка балансов (check) ===
async function checkBalances() {
  console.log('\n--- РЕЖИМ: Проверка балансов ---\n');
  
  const keypairs = loadKeypairsFromTxt(WALLET_KEYS_FILE);
  console.log(`Найдено кошельков: ${keypairs.length}`);
  console.log(`Используем RPC: ${RPC_URL}\n`);

  const balancesInfo = [];

  for (const kp of keypairs) {
    const pubKey = kp.publicKey;
    let balanceLamports = 0;

    try {
      balanceLamports = await connection.getBalance(pubKey);
    } catch (err) {
      console.error(`Ошибка при получении баланса для ${pubKey.toBase58()}:`, err);
    }
    
    const balanceSol = balanceLamports / LAMPORTS_PER_SOL;
    balancesInfo.push({
      wallet: pubKey.toBase58(),
      balanceLamports: balanceLamports,
      balanceSol: balanceSol
    });

    console.log(
      `Кошелёк: ${pubKey.toBase58()}, Баланс: ${balanceSol.toFixed(6)} SOL`
    );
  }

  // Записываем в JSON
  fs.writeFileSync(OUTPUT_JSON_FILE, JSON.stringify(balancesInfo, null, 2), 'utf8');
  console.log(`\nРезультаты сохранены в: ${OUTPUT_JSON_FILE}`);
}

// === 2) Сбор средств (collect) ===
async function collectAll() {
  console.log('\n--- РЕЖИМ: Сбор средств ---\n');
  
  const keypairs = loadKeypairsFromTxt(WALLET_KEYS_FILE);
  console.log(`Найдено кошельков: ${keypairs.length}`);
  console.log(`Используем RPC: ${RPC_URL}\n`);
  console.log(`Целевой адрес для сбора: ${TARGET_ADDRESS.toBase58()}\n`);

  for (const senderKeypair of keypairs) {
    const senderPubKey = senderKeypair.publicKey;
    let balanceLamports = 0;
    try {
      balanceLamports = await connection.getBalance(senderPubKey);
    } catch (err) {
      console.error(`Ошибка при получении баланса кошелька ${senderPubKey.toBase58()}:`, err);
      continue;
    }

    const balanceSol = balanceLamports / LAMPORTS_PER_SOL;
    console.log(`Кошелёк: ${senderPubKey.toBase58()}, Баланс: ${balanceSol.toFixed(6)} SOL`);

    if (balanceLamports === 0) {
      console.log('Баланс 0, пропускаем.\n');
      continue;
    }

    // Оставляем чуть-чуть лампортов (~5000) на комиссию
    const transactionAmount = balanceLamports - 5000;
    if (transactionAmount <= 0) {
      console.log('Недостаточно средств для комиссии. Пропускаем...\n');
      continue;
    }

    // Формируем инструкцию перевода
    const instruction = SystemProgram.transfer({
      fromPubkey: senderPubKey,
      toPubkey: TARGET_ADDRESS,
      lamports: transactionAmount,
    });

    const tx = new Transaction().add(instruction);

    try {
      const signature = await sendAndConfirmTransaction(
        connection,
        tx,
        [senderKeypair],
        {
          skipPreflight: false,
          commitment: 'confirmed',
          maxRetries: 5,
          timeout: 60000 // ждем до 60 секунд подтверждения
        }
      );
      console.log(
        `Отправлено ~${(transactionAmount / LAMPORTS_PER_SOL).toFixed(6)} SOL. Tx Signature: ${signature}\n`
      );
    } catch (err) {
      console.error('Ошибка при подтверждении транзакции:', err);
    }
  }

  console.log('Сбор средств завершён!');
}

// === Интерактивная часть ===
// Спросим у пользователя, что делать: 1) check, 2) collect
const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

console.log('Выберите режим работы:\n1) Проверка балансов\n2) Сбор средств');
rl.question('Введите номер (1 или 2): ', async (answer) => {
  if (answer === '1') {
    await checkBalances();
  } else if (answer === '2') {
    await collectAll();
  } else {
    console.log('Неизвестный выбор. Ничего не делаем.');
  }
  
  rl.close();
});