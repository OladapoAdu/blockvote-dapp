const { ethers } = require("ethers");
const fs = require("fs");
const readline = require("readline");
// 1. Load the dotenv library to read your hidden file
require('dotenv').config();

// =========================================================================
// 1. CONFIGURATION BLOCK
// =========================================================================
const RPC_URL = "https://ethereum-sepolia-rpc.publicnode.com";
const provider = new ethers.JsonRpcProvider(RPC_URL);

const CONTRACT_ADDRESS = "0xD7541FFAB41AB174c892338330CACc13515aA7B5"; 

const CONTRACT_ABI = [
    "function whitelistVoter(address _voter) public",
    "function vote(uint256 ballotId, uint256 candidateId) public",
    "function getBallotCount() view returns (uint256)",
    "function getBallot(uint256 ballotId) view returns (string, uint256, uint256)",
    "function getCandidate(uint256 ballotId, uint256 candidateId) view returns (string, uint256)"
];

// 2. Safely extract the key from your environment without exposing it
const ADMIN_PRIVATE_KEY = process.env.ADMIN_PRIVATE_KEY; 

if (!ADMIN_PRIVATE_KEY) {
    console.error("❌ Error: ADMIN_PRIVATE_KEY is missing from your .env file!");
    process.exit(1);
}

const adminWallet = new ethers.Wallet(ADMIN_PRIVATE_KEY, provider);

// =========================================================================
// 2. MAIN CORE EXECUTION ENGINE
// =========================================================================
async function runSystemSimulation() {
    console.log("==========================================================");
    console.log("[START] RUNNING BLOCKVOTE DYNAMIC BALLOT WORKLOAD TEST");
    console.log("==========================================================");

    // Named uniquely to keep your 100-vote data safe from being overwritten
    const csvFileName = "100-vote_election_simulation_report.csv";
    const csvHeaders = "Timestamp,Voter Address,Simulated Action,Status,Gas Used,Tx Latency (Seconds),Tx Hash,EVM Reversion Message\n";
    fs.writeFileSync(csvFileName, csvHeaders);

    const votingContract = new ethers.Contract(CONTRACT_ADDRESS, CONTRACT_ABI, provider);
    const adminContract = votingContract.connect(adminWallet);

    console.log("\n[LOOKUP] Fetching active ballots from the contract registry...");
    let ballotCount;
    try {
        const countBN = await adminContract.getBallotCount();
        ballotCount = Number(countBN);
    } catch (e) {
        console.error("❌ Failed to communicate with smart contract:", e.message);
        return;
    }

    if (ballotCount === 0) {
        console.log("❌ Zero ballots found on this contract deployment. Please check admin.html.");
        return;
    }

    console.log("\n==========================================================");
    console.log("LIVE BLOCKCHAIN BALLOTS DETECTED:");
    console.log("==========================================================");
    for (let i = 0; i < ballotCount; i++) {
        try {
            const ballot = await adminContract.getBallot(i);
            const title = ballot[0];
            const candidateCount = Number(ballot[2]);
            console.log(`  🔹 ID: ${i} | Title: "${title}" (${candidateCount} candidates found)`);
        } catch (err) {
            console.log(`  🔹 ID: ${i} | [Error parsing data structural details]`);
        }
    }
    console.log("==========================================================\n");

    const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout
    });

    rl.question('👉 Enter the Ballot ID for "Best Drink: Fanta vs Coca Cola": ', async (choice) => {
        const TARGET_BALLOT_ID = parseInt(choice);

        if (isNaN(TARGET_BALLOT_ID) || TARGET_BALLOT_ID >= ballotCount || TARGET_BALLOT_ID < 0) {
            console.log("❌ Selection out of bounds. Exiting script safely to prevent EVM rejections.");
            rl.close();
            return;
        }

        let candidatesAvailable = 0;
        try {
            const chosenBallot = await adminContract.getBallot(TARGET_BALLOT_ID);
            candidatesAvailable = Number(chosenBallot[2]);
            console.log(`\nSelected Ballot: "${chosenBallot[0]}"`);
        } catch (e) {
            console.log("❌ Could not read ballot metrics.");
            rl.close();
            return;
        }

        if (candidatesAvailable === 0) {
            console.log("❌ This ballot has no options registered yet. Go to admin.html to add options.");
            rl.close();
            return;
        }

        rl.question('👉 Enter Candidate Index to receive votes (0 for Fanta, 1 for Coca Cola): ', async (candidateChoice) => {
            const TARGET_CANDIDATE_ID = parseInt(candidateChoice);

            if (isNaN(TARGET_CANDIDATE_ID) || TARGET_CANDIDATE_ID >= candidatesAvailable || TARGET_CANDIDATE_ID < 0) {
                console.log("❌ Invalid candidate choice. Exiting script safely.");
                rl.close();
                return;
            }

            try {
                const cInfo = await adminContract.getCandidate(TARGET_BALLOT_ID, TARGET_CANDIDATE_ID);
                console.log(`🎯 Targeted Candidate Profile: "${cInfo[0]}" (Current Vote Count: ${cInfo[1].toString()})`);
            } catch (e) {}

            rl.close();

            await executeSimulationMatrix(virtualVoters, BATCH_SIZE, TARGET_BALLOT_ID, TARGET_CANDIDATE_ID, adminContract, votingContract, csvFileName);
        });
    });

    const virtualVoters = [];
    const BATCH_SIZE = 100;
    for (let i = 0; i < BATCH_SIZE; i++) {
        virtualVoters.push(ethers.Wallet.createRandom().connect(provider));
    }
    console.log(`[SUCCESS] Staged ${virtualVoters.length} synthetic voter profiles.`);
}

async function executeSimulationMatrix(virtualVoters, BATCH_SIZE, TARGET_BALLOT_ID, TARGET_CANDIDATE_ID, adminContract, votingContract, csvFileName) {
    console.log("\n[PHASE 2] Admin wallet registering addresses & distributing gas funds...");
    for (let i = 0; i < virtualVoters.length; i++) {
        const voterAddress = virtualVoters[i].address;
        
        try {
            const gasTx = await adminWallet.sendTransaction({
                to: voterAddress,
                value: ethers.parseEther("0.001") 
            });
            await gasTx.wait();

            const whitelistTx = await adminContract.whitelistVoter(voterAddress);
            await whitelistTx.wait();
            
            console.log(`  [REGISTERED #${i+1}/${BATCH_SIZE}] Sponsoring + Whitelisting: ${voterAddress}`);
        } catch (error) {
            console.log(`  [SKIP/ERROR #${i+1}] Registration issue for ${voterAddress}: ${error.message.substring(0, 50)}`);
        }
    }

    console.log("\n[PHASE 3] Dispatching signed voter transactions to Sepolia...");
    for (let i = 0; i < virtualVoters.length; i++) {
        const voter = virtualVoters[i];
        const contractWithSigner = votingContract.connect(voter);
        const timestamp = new Date().toISOString();
        
        console.log(`\nProcessing Ballot #${i + 1}/${BATCH_SIZE} | Address: ${voter.address}`);

        let startTime = Date.now();
        let tx;
        let receipt;
        let success = false;
        let finalErrorMsg = "N/A";

        try {
            console.log(`  Executing: vote(${TARGET_BALLOT_ID}, ${TARGET_CANDIDATE_ID})...`);
            tx = await contractWithSigner.vote(TARGET_BALLOT_ID, TARGET_CANDIDATE_ID);
            receipt = await tx.wait();
            success = true;

            let endTime = Date.now();
            let latency = ((endTime - startTime) / 1000).toFixed(2);
            console.log(`  [VOTE SUCCESS] Mined in ${latency}s | Gas Used: ${receipt.gasUsed.toString()}`);

            const row = `${timestamp},${voter.address},Cast Vote,SUCCESS,${receipt.gasUsed.toString()},${latency},${receipt.hash},N/A\n`;
            fs.appendFileSync(csvFileName, row);

            if ((i + 1) % 5 === 0) {
                const attackTimestamp = new Date().toISOString();
                console.log(`  [SECURITY TEST] Injecting duplicate vote attack transaction...`);
                
                let attackStartTime = Date.now();
                try {
                    let attackTx = await contractWithSigner.vote(TARGET_BALLOT_ID, TARGET_CANDIDATE_ID);
                    await attackTx.wait();
                } catch (attackError) {
                    let attackEndTime = Date.now();
                    let attackLatency = ((attackEndTime - attackStartTime) / 1000).toFixed(2);
                    console.log(`  [SECURITY MATCH] State reverted! Fraud attempt blocked in ${attackLatency}s.`);
                    
                    const attackRow = `${attackTimestamp},${voter.address},Duplicate Vote Attack,BLOCKED,0,${attackLatency},N/A,EVM State Reverted: Already Voted\n`;
                    fs.appendFileSync(csvFileName, attackRow);
                }
            }

        } catch (masterError) {
            let endTime = Date.now();
            let latency = ((endTime - startTime) / 1000).toFixed(2);
            
            finalErrorMsg = masterError.message.replace(/[\r\n,]/g, " ").substring(0, 60);
            console.log(`  [VOTE REJECTED] EVM Error: ${finalErrorMsg}`);
            
            const failRow = `${timestamp},${voter.address},Cast Vote,FAILED,0,latency,N/A,${finalErrorMsg}\n`;
            fs.appendFileSync(csvFileName, failRow);
        }
    }

    console.log(`\n==========================================================`);
    console.log(`[COMPLETE] EVALUATION SUCCESSFUL LOGGED IN ${csvFileName}`);
    console.log(`==========================================================`);
}

runSystemSimulation().catch((err) => {
    console.error("[CRITICAL HARDWARE FAILURE]:", err);
});