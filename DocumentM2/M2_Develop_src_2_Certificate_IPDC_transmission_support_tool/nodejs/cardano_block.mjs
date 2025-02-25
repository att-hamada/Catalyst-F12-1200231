import Log4js from 'log4js';

import fetch from 'node-fetch';
import dotenv from "dotenv";
import fs from 'fs';
import { sha3_256 } from '@noble/hashes/sha3';

dotenv.config()

let logpath;
logpath = "logs/cardano_block.log";

const logger = Log4js.getLogger('system');


Log4js.configure(
	{
		appenders: {
			file: { type: "file", filename: logpath ,maxLogSize:14400000,buckups:30},
			console: { type: "console" }
		},
		categories: {
			default: { appenders: ["console", "file"], level: "trace" }
		}
	}
);

logger.info("cardano_block.mjs start");

const apiKey = process.env.PROJECT_ID;
let lastHeight = 0;
let lastHash = "";
let pastHashes = [];

// 最新ブロック情報を取得し、状態を更新
const fetchBlockInfo = async () => {

	if (fs.existsSync('cardano_data/download.lock')) {
		logger.warn("fetchBlockInfo found download.lock",lastHeight);
		return;
	}


	const blockInfo = await fetchBlock('https://cardano-preprod.blockfrost.io/api/v0/blocks/latest');
	if (!blockInfo) return;

	const currentHeight = blockInfo.height;

	if (lastHeight !== currentHeight) {
		if (lastHeight > 0 && currentHeight > lastHeight + 1) {
			for (let h = lastHeight + 1; h < currentHeight; h++) {
				await fetchBlockDetails(h);
			}
		}

		if (lastHash !== blockInfo.previous_block) {
			logger.warn("■■■■ DIFFERENT HASH ■■■■");
			await reconcileBlocks(lastHeight);
		}

		await updateState(blockInfo);
	} else {
		logger.info("skip:", blockInfo.height);
	}
};

const fetchBlock = async (endpoint) => {
	try {
		const response = await fetch(endpoint, {
			method: 'GET',
			headers: {
				'project_id': apiKey
			}
		});

		if (response.ok) {
			return await response.json();
		} else {
			const error = await response.text();
			logger.error(`Error fetching block information from ${endpoint}:`, error);
			return null;
		}
	} catch (error) {
		logger.error(`Error fetching block information from ${endpoint}:`, error);
		return null;
	}
};

const fetchBlockDetails = async (height) => {
	const blockDetails = await fetchBlock(`https://cardano-preprod.blockfrost.io/api/v0/blocks/${height}`);
	if (!blockDetails) return;

	if (lastHash !== blockDetails.previous_block) {
		logger.warn("■■■■ DIFFERENT HASH ■■■■");
		await reconcileBlocks(height - 1);
	}

	await updateState(blockDetails);
};

const reconcileBlocks = async (startHeight) => {
	logger.warn("Reconciling blocks...");
	let currentHeight = startHeight;

	while (currentHeight > 0) {
		const blockDetails = await fetchBlock(`https://cardano-preprod.blockfrost.io/api/v0/blocks/${currentHeight}`);
		if (!blockDetails) break;

		await updateState(blockDetails);

		const pastBlock = pastHashes.find(p => p.height === blockDetails.height);
		if (pastBlock && pastBlock.hash === blockDetails.hash) {
			logger.warn(`Match found at height ${currentHeight}`);
			break;
		} else {
			logger.warn(`No match found at height ${currentHeight}, fetching previous block`);
			currentHeight--;
		}
	}
	logger.warn("Reconciling blocks complete");
};

const updateState = async function(blockInfo){
	const ipdcBlockInfo = await setIpdcBlockInfo(blockInfo);

	logger.info("- prevHash:", ipdcBlockInfo.previous_block);
	logger.info("- height:", ipdcBlockInfo.height);
	logger.info("- calcHash:", ipdcBlockInfo.hash);

	logger.info("= prevIpdcHash:", ipdcBlockInfo.ipdc_previous_block);
	logger.info("= txsHash:", ipdcBlockInfo.block_body_hash);
	logger.info("= calcIpdcHash:", ipdcBlockInfo.ipdc_hash);

	pastHashes.push({ height: ipdcBlockInfo.height, hash: ipdcBlockInfo.hash , ipdc_hash:ipdcBlockInfo.ipdc_hash});
	if (pastHashes.length > 100) {
	    pastHashes = pastHashes.slice(-100);
	}

	lastHash = blockInfo.hash;
	lastHeight = blockInfo.height;

	createHeaderFile(ipdcBlockInfo)

/*
	if(blockInfo.ipdc_previous_block !== undefined){
	}else{
		logger.info("skip createHeaderFile");
	}
*/

};

async function setIpdcBlockInfo(blockInfo){

	const hasher = sha3_256.create();
	hasher.update(Buffer.from(new BigInt64Array([BigInt(blockInfo.height)]).buffer)); 
	hasher.update(Buffer.from(blockInfo.hash,'hex'));
	hasher.update(Buffer.from(blockInfo.previous_block,'hex'));

	const pastBlock = pastHashes.find(p => p.height === blockInfo.height - 1);
	if (pastBlock && pastBlock.ipdc_hash) {
//		hasher.update(Buffer.from(pastBlock.ipdc_hash, 'hex'));
		blockInfo.ipdc_previous_block = pastBlock.ipdc_hash;
	}else{

		logger.warn("cant fetch previous block hash from pastHashes");

		//preHashが取れない場合はファイルから取得する。
		const previousBlockHeight = blockInfo.height - 1;
		let content;
		try{
			console.log("./cardano_data/cardano_head_" + previousBlockHeight + ".json")

			content = fs.readFileSync("./cardano_data/cardano_head_" + previousBlockHeight + ".json", 'utf8');
			console.log(content)
			blockInfo.ipdc_previous_block = JSON.parse(content).ipdc_hash;
//			hasher.update(Buffer.from(blockInfo.ipdc_previous_block, 'hex'));

		}catch(error){

			logger.error(error)
			const emptyBlockHash = sha3_256.create().update(Buffer.from("")).digest();
			blockInfo.ipdc_previous_block = Buffer.from(emptyBlockHash).toString('hex');
//			hasher.update(Buffer.from(blockInfo.ipdc_previous_block, 'hex'));

			logger.warn("emptyBlockHash",blockInfo.ipdc_previous_block);
		}

	}
	hasher.update(Buffer.from(blockInfo.ipdc_previous_block, 'hex'));



	const transactions = await fetchBlock(`https://cardano-preprod.blockfrost.io/api/v0/blocks/${blockInfo.height}/txs`);

	let merkleRoot;
	logger.info('transactions count',transactions.length);

	if (transactions.length === 0) {
		const emptyTransactionHash = sha3_256.create().update(Buffer.from("")).digest();
		hasher.update(Buffer.from(emptyTransactionHash));

		merkleRoot = Buffer.from(emptyTransactionHash).toString('hex');
	}else{
		logger.log('Transaction IDs:', transactions);

		const transactionHashes = getTransactionHashes(transactions);
		const tree = buildMerkleTree(transactionHashes);

		const root = tree[tree.length - 1][0];
		hasher.update(Buffer.from(root,'hex'));
		merkleRoot = root;
	}
	blockInfo.block_body_hash = merkleRoot;

	const hash = Buffer.from(hasher.digest()).toString("hex");
	blockInfo.ipdc_hash = hash;

	return blockInfo;
}

function createHeaderFile(blockInfo) {
	const path = 'cardano_data/cardano_head_' + blockInfo.height + '.json';
	const jsonBlockInfo = JSON.stringify(blockInfo);
	
	writeFileWithRetry(path, jsonBlockInfo, (err) => {
		if (err) {
			logger.error(`error!::${err}`);
		} else {
//			lastHash = blockInfo.hash;
//			lastHeight = blockInfo.height;
			updateTriggerFile(path);
		}
	});
}

function updateTriggerFile(filePath) {
	const triggerFilePath = 'cardano_data/trigger.txt';	
	const fileName = filePath.split('/').pop(); 

	if (fs.existsSync(triggerFilePath)) {
		const existingEntries = fs.readFileSync(triggerFilePath, 'utf-8').split('\n').filter(Boolean);
		let fileExists = false;

		for (const entry of existingEntries) {
			if (entry === fileName) {
				fileExists = true;
				logger.info("file already exists in trigger.txt",fileName)
				break;
			}
		}

		if (!fileExists) {
			logger.info("push to trigger.txt", fileName)
			fs.appendFileSync(triggerFilePath, fileName + '\n');
		}
	} else {

		logger.info("create trigger.txt and ",fileName)
		fs.writeFileSync(triggerFilePath, fileName + '\n');
	}
}

function writeFileWithRetry(path, data, callback) {
	logger.info("writeFileWithRetry",path);

	if (fs.existsSync('cardano_data/download.lock')) {
		logger.warn("found download.lock");
	} else {
		if (fs.existsSync(path)) {
			fs.readFile(path, (err, existingData) => {
				if (err) {
					return callback(err);
				}

				const existingHash = calculateFileHash(existingData);
				const newHash = calculateFileHash(data);

				if (existingHash !== newHash) {
					fs.writeFile(path, data, callback);
				} else {
					logger.info("No changes detected, file write skipped.");
					callback(null); 
				}
			});
		} else {
			fs.writeFile(path, data, callback);
		}
	}
}

function calculateFileHash(data) {
	return Buffer.from(sha3_256(data)).toString('hex');
}

function getTransactionHashes(transactions) {
	return transactions.map(tx => Buffer.from(sha3_256(tx)).toString('hex'));
}

function hashConcat(left, right) {
	return Buffer.from(sha3_256(left + right)).toString('hex');
}

function buildMerkleTree(hashes) {
	let tree = [hashes];

	while (tree[tree.length - 1].length > 1) {
		let currentLevel = tree[tree.length - 1];
		let nextLevel = [];

		for (let i = 0; i < currentLevel.length; i += 2) {
			const left = currentLevel[i];
			const right = i + 1 < currentLevel.length ? currentLevel[i + 1] : left;
			nextLevel.push(hashConcat(left, right));
		}
		tree.push(nextLevel);
	}
	return tree;
}

function cleanOldFiles(directory) {
	const files = fs.readdirSync(directory);
	const now = Date.now();

	files.forEach(file => {
		const filePath = `${directory}/${file}`;
		const stats = fs.statSync(filePath);
		const fileAgeInDays = (now - stats.mtimeMs) / (1000 * 60 * 60 * 24); // ミリ秒を日に変換

		if (fileAgeInDays > FILE_EXPIRATION_DAYS) {
			fs.unlinkSync(filePath); // ファイルを削除
			logger.info(`Deleted old file: ${filePath}`);
		}
	});
}



setInterval(fetchBlockInfo, 15000);
fetchBlockInfo();

// 1日に1回実行
const FILE_EXPIRATION_DAYS = 1; // 例えば30日
const ONE_DAY_IN_MS = 24 * 60 * 60 * 1000; // 1日をミリ秒で表現
setInterval(() => {
    cleanOldFiles('cardano_data');
    logger.info('Old files cleaned up.');
}, ONE_DAY_IN_MS);