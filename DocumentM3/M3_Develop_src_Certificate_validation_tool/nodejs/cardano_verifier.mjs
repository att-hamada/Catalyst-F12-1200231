import fs from 'fs';
import { sha3_256 } from '@noble/hashes/sha3';
import Log4js from 'log4js';



Log4js.configure(
	{
		appenders: {
			file: { type: "file", filename: "logs/cardano_verifier.log" ,maxLogSize:1048576,buckups:5},
			console: { type: "console" }
		},
		categories: {
			default: { appenders: ["console", "file"], level: "trace" }
		}
	}
);
var logger = Log4js.getLogger('system');
logger.info("START VALIDATION.");

const blocks = new Array();
fs.readdir('./cardano_data/', (err, files) => {

	const headFiles = files.filter(file => file.startsWith('cardano_head_'));
	headFiles.forEach(file => {
		const content = fs.readFileSync("./cardano_data/" + file, 'utf8');
//		console.log(content)
		blocks.push(JSON.parse(content));
	});

	blocks.sort(function(a, b) {
		return b.height - a.height;
	});

	try{



		for(const block of blocks.slice(0, -1)){
//			console.log(block)
			validateBlock(block);
		}
		logger.info("SUCCESS:ALL BLOCKS VERIFIED.");
		
	}catch(error){
		logger.error("VALIDATION FAILED");
		logger.error(error);
	}
});

let prevHash;
function validateBlock(block){

		const calcHash = calculateHash(block);

		if(calcHash === prevHash){

			logger.info("┏ calc hash: " + calcHash);
			logger.info("┃ new block: height:" + block.height +",time:" + block.time);
			logger.info("┗ prev hash: " + block.ipdc_previous_block);
		}else if(prevHash === undefined){ //初回は検証不可能

		}else{
			logger.error(block.height);
			logger.error(block);
			logger.error("prevHash",prevHash);
			logger.error("calcHash",calcHash);
			throw new Error('error');
		}
		prevHash = block.ipdc_previous_block;
}

function calculateHash(block){

	const hasher = sha3_256.create();

	hasher.update(Buffer.from(new BigInt64Array([BigInt(block.height)]).buffer)); 
	hasher.update(Buffer.from(block.hash,'hex'));
	hasher.update(Buffer.from(block.previous_block,'hex'));
	hasher.update(Buffer.from(block.ipdc_previous_block,'hex'));
//	hasher.update(Buffer.from(block.ipdc_hash,'hex'));
	hasher.update(Buffer.from(block.block_body_hash,'hex'));

	const hash = Buffer.from(hasher.digest()).toString("hex");
	return hash;
}
