import express	 from 'express';
import bodyParser from 'body-parser';

import axios from 'axios';
import dotenv from "dotenv";

const res = dotenv.config()
const apiKey = process.env.PROJECT_ID; // BlockfrostのAPIキー // Blockfrost API key

// ログ設定 /////////////////////////////////////
import Log4js from 'log4js';
let logpath = "logs/cardano_server.log";
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
logger.info("cardano_server.mjs start");
//////////////////////////////// ログ設定終了 //


const app = express();
app.use(Log4js.connectLogger(logger));
app.use(bodyParser.urlencoded({extended: false}));
app.use(bodyParser.json());
app.use(function(req, res, next){
	res.header("Access-Control-Allow-Origin","*");
	res.header("Access-Control-Allow-Headers", "Origin, X-Requested-With, Content-Type, Accept");
	next();
})
app.post('/',function(req, res){
	var obj = {}; 
	var rejson = JSON.stringify(req.body);
	res.send(rejson);
});

app.post('/submit',async function(req, res){
	var obj = {}; 
	var rejson = JSON.stringify(req.body);
	console.log(req.body.payload);
	var nodeRes = await sendTransaction(req.body.payload);


	console.log(nodeRes)
	res.send(nodeRes);

});

app.get('/submit',async (req, res, next) => {
    // クエリパラメータを取得（例: /submit?param1=value1&param2=value2）
    const payload = req.query.payload;

    // 取得したデータをsendTransaction関数に渡す
    await sendTransaction(payload);

	res.send("500");
});

app.listen(1337);

async function sendTransaction(signedTxHex) {
    try {
        const response = await axios.post('https://cardano-preprod.blockfrost.io/api/v0/tx/submit', Buffer.from(signedTxHex, 'hex'), {
            headers: {
                'Content-Type': 'application/cbor',
                'project_id': apiKey,
            },
        });

        console.log('Transaction sent successfully:', response);


		return {code:"success",data:response.data}
    } catch (error) {
        console.error('Error sending transaction:', error.response ? error.response.data : error.message);
		return {code:"error",data:error.response ? error.response.data : error.message}

    }
}

