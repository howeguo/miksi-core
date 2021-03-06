const DepositVerifier = artifacts.require("../build/DepositVerifier");
const WithdrawVerifier = artifacts.require("../build/WithdrawVerifier");
const Miksi = artifacts.require("../build/Miksi.sol");

const chai = require("chai");
const expect = chai.expect;
const truffleAssert = require('truffle-assertions');

const fs = require("fs");
const { groth } = require('snarkjs');
const { stringifyBigInts, unstringifyBigInts } = require('ffjavascript').utils;
const WitnessCalculatorBuilder = require("circom_runtime").WitnessCalculatorBuilder;
const circomlib = require("circomlib");
const smt = require("circomlib").smt;

let insVerifier;
let insMiksi;

const nLevels = 4;
const secret = ["1234567890", "987654321", "123"];

const coinCode = "0"; // refearing to ETH
const ethAmount = '1';
const amount = web3.utils.toWei(ethAmount, 'ether');
const nullifier = ["0", "0", "0"];
let commitment = [];
let tree;
let oldKey = [];
let oldValue = [];
let siblingsOld = [];
let siblingsNew = [];
let rootOld = [];
let rootNew = [];
// let commitment = [];
let proof = [];
let publicSignals = [];
let commitmentsArray = [];
let currKey=0;
let u = 0;

contract("miksi", (accounts) => {


  const {
    0: owner,
    1: addr1, // used for the deposit
    2: addr2, // used for the withdraw
    3: addr3,
    4: addr4,
  } = accounts;


  before(async () => {
    insDepositVerifier = await DepositVerifier.new();
    insWithdrawVerifier = await WithdrawVerifier.new();
    insMiksi = await Miksi.new(insDepositVerifier.address, insWithdrawVerifier.address);
  });

  before(async() => {
    let balance_wei = await web3.eth.getBalance(addr1);
    // console.log("Balance at " + addr1, web3.utils.fromWei(balance_wei, 'ether'));
    expect(balance_wei).to.be.equal('100000000000000000000');

    tree = await smt.newMemEmptyTrie();
    await tree.insert(currKey, 0);

    await computeTree(0);

    expect(rootOld[0].toString()).to.be.equal('7191590165524151132621032034309259185021876706372059338263145339926209741311');
    // expect(rootNew[0].toString()).to.be.equal('9328869343897770565751281504295758914771207504252217956739346620422361279598');
  });

  it("Make first deposit", async () => {
    await makeDeposit(0, addr1);
    balance_wei = await web3.eth.getBalance(addr1);
    // console.log("Balance at " + addr1, web3.utils.fromWei(balance_wei, 'ether'));
    // expect(balance_wei).to.be.equal('98993526980000000000');
  });
  it("Make second deposit", async () => {
    await computeTree(1);
    await makeDeposit(1, addr3);
  });
  it("Make 3rd deposit", async () => {
    await computeTree(2);
    await makeDeposit(2, addr3);
  });

  it("Get the commitments data", async () => {
    // getCommitments data
    let res = await insMiksi.getCommitments();
    expect(res[1].toString()).to.be.equal(tree.root.toString());
    commitmentsArray[0] = res[0];
    currKey = res[2];
  });

  it("Rebuild the tree from sc commitments", async () => {
    let treeTmp = await smt.newMemEmptyTrie();
    await treeTmp.insert(0, 0);
    for (let i=0; i<commitmentsArray[0].length; i++) {
      await treeTmp.insert(i+1, commitmentsArray[0][i]);
    }
    expect(treeTmp.root).to.be.equal(tree.root);
  });
  
  it("Calculate witness and generate the zkProof", async () => {
    await genZKProof(0, addr2, "1");
    await genZKProof(1, addr4, "2");
    await genZKProof(2, addr4, "3");
  });
  
  it("Try to use the zkProof with another address and get revert", async () => {
    // console.log("Try to reuse the zkproof and expect revert");
    await truffleAssert.fails(
      withdrawSC(0, addr1),
      truffleAssert.ErrorType.REVERT,
      "zkProof withdraw could not be verified"
    );
  });
  
  it("Withdraw 1 ETH with the zkProof of the 1st deposit to addr2", async () => {
    // withdraw
    // console.log("Withdraw of " + ethAmount + " ETH to " + addr2);
    let resW = await withdrawSC(0, addr2);
    // console.log("resW", resW);
  
    balance_wei = await web3.eth.getBalance(addr2);
    // console.log("Balance at " + addr2, web3.utils.fromWei(balance_wei, 'ether'));
    expect(balance_wei).to.be.equal('101000000000000000000');
  });
  
  it("Try to reuse the zkProof and get revert", async () => {
    // console.log("Try to reuse the zkproof and expect revert");
    await truffleAssert.fails(
      withdrawSC(0, addr2),
      truffleAssert.ErrorType.REVERT,
      "nullifier already used"
    );
    balance_wei = await web3.eth.getBalance(addr2);
    expect(balance_wei).to.be.equal('101000000000000000000');
  });
  it("Withdraw 1 ETH with the zkProof of the 2nd deposit to addr4", async () => {
    let resW = await withdrawSC(1, addr4);
    balance_wei = await web3.eth.getBalance(addr4);
    expect(balance_wei).to.be.equal('101000000000000000000');
  });
  it("Withdraw 1 ETH with the zkProof of the 3rd deposit to addr4", async () => {
    let resW = await withdrawSC(2, addr4);
    balance_wei = await web3.eth.getBalance(addr4);
    expect(balance_wei).to.be.equal('102000000000000000000');
  });
});


async function computeTree(u) {
    const poseidon = circomlib.poseidon.createHash(6, 8, 57);
    nullifier[u] = poseidon([currKey+1, secret[u]]).toString();
    commitment[u] = poseidon([coinCode, amount, secret[u], nullifier[u]]).toString();

    // deposit
    // add commitment into SMT

    // console.log("currKey", currKey);
    rootOld[u] = tree.root;
    const resC = await tree.find(currKey+1);
    assert(!resC.found);
    oldKey[u] = "0";
    oldValue[u] = "0";
    if (!resC.found) {
      oldKey[u] = resC.notFoundKey.toString();
      oldValue[u] = resC.notFoundValue.toString();
    }
    // console.log(oldValue[u]);
    // console.log("FIND", resC);
    siblingsOld[u] = resC.siblings;
    while (siblingsOld[u].length < nLevels) {
        siblingsOld[u].push("0");
    };

    await tree.insert(currKey+1, commitment[u]);
    rootNew[u] = tree.root;
    currKey += 1;
    // console.log("currKey", currKey);
}

async function makeDeposit(u, addr) {
    const resC = await tree.find(currKey);
    assert(resC.found);
    siblingsNew[u] = resC.siblings;
    while (siblingsNew[u].length < nLevels) {
        siblingsNew[u].push("0");
    };

    // calculate witness
    const wasm = await fs.promises.readFile("./test/build/deposit.wasm");
    const input = unstringifyBigInts({
      "coinCode": coinCode,
      "amount": amount,
      "secret": secret[u],
      "oldKey": oldKey[u],
      "oldValue": oldValue[u],
      "siblingsOld": siblingsOld[u],
      "siblingsNew": siblingsNew[u],
      "rootOld": rootOld[u],
      "rootNew": rootNew[u],
      "commitment": commitment[u],
      "key": currKey
    });
    const options = {};
    // console.log("Calculate witness");
    const wc = await WitnessCalculatorBuilder(wasm, options);
    const w = await wc.calculateWitness(input);
    const witness = unstringifyBigInts(stringifyBigInts(w));

    // generate zkproof of commitment using snarkjs (as is a test)
    const provingKey = unstringifyBigInts(JSON.parse(fs.readFileSync("./test/build/deposit-proving_key.json", "utf8")));

    // console.log("Generate zkSNARK proof");
    const res = groth.genProof(provingKey, witness);
    proof[u] = res.proof;
    publicSignals[u] = res.publicSignals;

    const verificationKey = unstringifyBigInts(JSON.parse(fs.readFileSync("./test/build/deposit-verification_key.json", "utf8")));
    let pubI = unstringifyBigInts([coinCode, amount, rootOld[u].toString(), rootNew[u].toString(), commitment[u], currKey]);
    let validCheck = groth.isValid(verificationKey, proof[u], pubI);
    assert(validCheck);
    await insMiksi.deposit(
      commitment[u],
      tree.root.toString(),
      [proof[u].pi_a[0].toString(), proof[u].pi_a[1].toString()],
      [
        [proof[u].pi_b[0][1].toString(), proof[u].pi_b[0][0].toString()],
        [proof[u].pi_b[1][1].toString(), proof[u].pi_b[1][0].toString()]
      ],
      [proof[u].pi_c[0].toString(), proof[u].pi_c[1].toString()],
      {from: addr, value: amount}
    );

}

async function genZKProof(u, addr, k) {
    const resC = await tree.find(k);
    assert(resC.found);
    let siblings = resC.siblings;
    while (siblings.length < nLevels) {
        siblings.push("0");
    };
    // console.log("siblings", siblings);

    // calculate witness
    const wasm = await fs.promises.readFile("./test/build/withdraw.wasm");
    const input = unstringifyBigInts({
      "coinCode": coinCode,
      "amount": amount,
      "secret": secret[u],
      "nullifier": nullifier[u],
      "siblings": siblings,
      "root": tree.root,
      "address": addr,
      "key": k
    });
    const options = {};
    // console.log("Calculate witness");
    const wc = await WitnessCalculatorBuilder(wasm, options);
    const w = await wc.calculateWitness(input);
    const witness = unstringifyBigInts(stringifyBigInts(w));

    // generate zkproof of commitment using snarkjs (as is a test)
    const provingKey = unstringifyBigInts(JSON.parse(fs.readFileSync("./test/build/withdraw-proving_key.json", "utf8")));

    // console.log("Generate zkSNARK proof");
    const res = groth.genProof(provingKey, witness);
    proof[u] = res.proof;
    publicSignals[u] = res.publicSignals;
}

async function withdrawSC(u, addr) {
      return insMiksi.withdraw(
        addr,
        nullifier[u],
        [proof[u].pi_a[0].toString(), proof[u].pi_a[1].toString()],
        [
          [proof[u].pi_b[0][1].toString(), proof[u].pi_b[0][0].toString()],
          [proof[u].pi_b[1][1].toString(), proof[u].pi_b[1][0].toString()]
        ],
        [proof[u].pi_c[0].toString(), proof[u].pi_c[1].toString()]
      );
}

