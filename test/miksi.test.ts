const fs = require("fs");

const miksi = require("../src/miksi.ts");

export {};

describe("deposit test", function () {
    this.timeout(200000);

    it("Test Deposit", async () => {
        const secret = "1234567890";
	const key = 1;
	const commitments = [];

	const wasm = await fs.promises.readFile("./build/deposit.wasm");
	console.log("w", wasm.length);

	const witness = await miksi.calcDepositWitness(wasm, key, secret, commitments);
	// console.log("w", witness);


	// const pk = await fs.promises.readFile("./build/deposit-proving_key.bin");
	// const proof = await miksi.calcProof(witness, pk);

    });
});
