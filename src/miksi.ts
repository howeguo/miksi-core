const fs = require("fs");
const bigInt = require("big-integer");
const { groth } = require('snarkjs');
const { Fr } = require('ffjavascript').bn128;
const { stringifyBigInts, unstringifyBigInts } = require('ffjavascript').utils;
const WitnessCalculatorBuilder = require("circom_runtime").WitnessCalculatorBuilder;
const circomlib = require("circomlib");
const smt = require("circomlib").smt;
const Web3 = require("web3");
// const buildBn128 = require("wasmsnark").buildBn128;


const nLevels = 5;
const coinCode = "0"; // refearing to ETH
const ethAmount = '1';
const amount = Web3.utils.toWei(ethAmount, 'ether');

exports.randBigInt = () => {
	return Fr.random();
};

exports.calcCommitment = (secret, nullifier) => {
	const poseidon = circomlib.poseidon.createHash(6, 8, 57);
	const commitment = poseidon([coinCode, amount, secret, nullifier]).toString();
	return commitment;
};

exports.calcDepositWitness = async (wasm, secret, nullifier, commitments) => {
	const poseidon = circomlib.poseidon.createHash(6, 8, 57);
	const commitment = poseidon([coinCode, amount, secret, nullifier]).toString();

	// rebuild the tree
	let tree = await smt.newMemEmptyTrie();
	await tree.insert(1, 0);
	for (let i=0; i<commitments.length; i++) {
		await tree.insert(commitments[i], 0);
	}

	// old root
	const rootOld = tree.root;
	const resOld = await tree.find(commitment);
	let oldKey = "0";
	if (!resOld.found) {
		oldKey = resOld.notFoundKey.toString();
	}
	console.log("oldKey", oldKey);
	// if (resOld.found) {
	//         console.error("leaf expect to not exist but exists");
	// }
	let siblingsOld = resOld.siblings;
	while (siblingsOld.length < nLevels) {
		siblingsOld.push("0");
	};

	await tree.insert(commitment, 0);

	// new root
	const rootNew = tree.root;
	const resNew = await tree.find(commitment);
	if (!resNew.found) {
		console.error("leaf expect to exist but not exists");
	}
	let siblingsNew = resNew.siblings;
	while (siblingsNew.length < nLevels) {
		siblingsNew.push("0");
	};

	// calculate witness
	const input = unstringifyBigInts({
		"coinCode": coinCode,
		"amount": amount,
		"secret": secret,
		"nullifier": nullifier,
		"oldKey": oldKey,
		"siblingsOld": siblingsOld,
		"siblingsNew": siblingsNew,
		"rootOld": rootOld,
		"rootNew": rootNew,
		"commitment": commitment
	});
	console.log("input", input);
	// const options = {};
	// const wc = await WitnessCalculatorBuilder(wasm, options);

	const wc = await WitnessCalculatorBuilder(wasm);

	const witness = await wc.calculateWitness(input, {sanityCheck: true});

	const wBuff = Buffer.allocUnsafe(witness.length*32);

	for (let i=0; i<witness.length; i++) {
		for (let j=0; j<8; j++) {
			const bi = witness[i];
			const v = bigInt(bi).shiftRight(j*32).and(0xFFFFFFFF).toJSNumber();
			// wBuff.writeUInt32LE(v, i*32 + j*4, 4)
			wBuff.writeUInt32LE(v, i*32 + j*4)
		}
	}


	// const witness = unstringifyBigInts(stringifyBigInts(w));
	// return wBuff;
	return {
		witness: wBuff,
		publicInputs: {
			commitment:commitment,
			root:rootNew
		}
	};
}

exports.calcWithdrawWitness = async (wasm, secret, nullifier, commitments, addr) => {
	const poseidon = circomlib.poseidon.createHash(6, 8, 57);
	const commitment = poseidon([coinCode, amount, secret, nullifier]).toString();

	// rebuild the tree
	let tree = await smt.newMemEmptyTrie();
	await tree.insert(1, 0);
	for (let i=0; i<commitments.length; i++) {
		await tree.insert(commitments[i], 0);
	}
	// await tree.insert(commitment, 0);

	// root
	const root = tree.root;
	const res = await tree.find(commitment);
	if (!res.found) {
		console.error("leaf expect to exist but not exists");
	}
	let siblings = res.siblings;
	while (siblings.length < nLevels) {
		siblings.push("0");
	};

	// calculate witness
	const input = unstringifyBigInts({
		"coinCode": coinCode,
		"amount": amount,
		"secret": secret,
		"nullifier": nullifier,
		"siblings": siblings,
		"root": root,
		"address": addr
	});
	console.log("input", input);
	// const options = {};
	// const wc = await WitnessCalculatorBuilder(wasm, options);

	const wc = await WitnessCalculatorBuilder(wasm);

	const witness = await wc.calculateWitness(input, {sanityCheck: true});

	const wBuff = Buffer.allocUnsafe(witness.length*32);

	for (let i=0; i<witness.length; i++) {
		for (let j=0; j<8; j++) {
			const bi = witness[i];
			const v = bigInt(bi).shiftRight(j*32).and(0xFFFFFFFF).toJSNumber();
			wBuff.writeUInt32LE(v, i*32 + j*4, 4)
		}
	}


	// const witness = unstringifyBigInts(stringifyBigInts(w));
	return {
		witness: wBuff,
		publicInputs: {
			address:addr,
			nullifier:nullifier
		}
	};
}



