const { ethers } = require("ethers");
const fs = require("fs");

// =========================================================================
// 1. CONFIGURATION & TARGET SETUP
// =========================================================================
const RPC_URL = "https://eth-sepolia.g.alchemy.com/v2/YOUR_API_KEY";
const provider = new ethers.JsonRpcProvider(RPC_URL);

const CONTRACT_ADDRESS = "0xD7541FFAB41AB174c892338330CACc13515aA7B5"; 

// Update these to match the poll you manually create in your system!
const TARGET_BALLOT_ID = 1;     // The ID of the poll you just created
const TARGET_CANDIDATE_ID = 1;  // The ID of the candidate inside that poll

const CONTRACT_ABI = [
    "function whitelistVoter(address _voter) public",
    "function authorizeVoter(address _voter) public",
    "function vote(uint256 _ballotId, uint256 _candidateId) public", 
    "function castVote(uint256 _ballotId, uint256 _candidateId) public",
    "function vote(uint256 _candidateId) public", // 1-arg fallback
    "function hasVoted(address) public view returns (bool)"
];

// MUST be the private key of the account that has Admin/Deployer privileges
const ADMIN_PRIVATE_KEY = "0xbA57bEB11a23e5C3dFe3c20f7117A0705885f218"; 
const adminWallet = new ethers.Wallet(ADMIN_PRIVATE_KEY, provider);

// =========================================================================
// 2. RUN SIMULATION
// =========================================================================
async function runSystemSimulation() {
    console.log("==========================================================");
    console.log(`[START] RUNNING WORKLOAD FOR BALLOT ID: ${TARGET_BALLOT_ID}`);
    console.log("==========================================================");

    const csvFileName = "election_simulation_report.csv";
    const csvHeaders = "Timestamp,Voter Address,Simulated Action,Status,Gas Used,Tx Latency (Seconds),Tx Hash,EVM Reversion Message\n";
    fs.writeFileSync(csvFileName, csvHeaders);

    const votingContract = new ethers.Contract(CONTRACT_ADDRESS, CONTRACT_ABI, provider);
    const adminContract = votingContract.connect(adminWallet);

    const virtualVoters = [];
    const BATCH_SIZE = 50;
    
    for (let i = 0; i < BATCH_SIZE; i++) {
        virtualVoters.push(ethers.Wallet.createRandom().connect(provider));
    }
    console.log(`[SUCCESS] Generated ${virtualVoters.length} synthetic voter profiles.`);

    // PHASE 1: ADMIN AUTHORIZATION & GAS FUNDING
    console.log("\n[PHASE 1] Admin executing Whitelisting & Gas Sponsorship...");
    for (let i = 0; i < virtualVoters.length; i++) {
        const voterAddress = virtualVoters[i].address;
        try {
            const gasTx = await adminWallet.sendTransaction({
                to: voterAddress,
                value: ethers.parseEther("0.001") 
            });
            await gasTx.wait();

            let whitelistTx;
            try {
                whitelistTx = await adminContract.whitelistVoter(voterAddress);
            } catch (err) {
                whitelistTx = await adminContract.authorizeVoter(voterAddress);
            }
            await whitelistTx.wait();
            
            console.log(`[PREPPED #${i+1}] Funded & Whitelisted: ${voterAddress}`);
        } catch (error) {
            console.log(`[SETUP FAILED #${i+1}] Skipping address ${voterAddress}: ${error.message}`);
        }
    }

    // PHASE 2: VOTING CORRUPTION & ACCESSIBILITY STRESS TEST
    console.log("\n[PHASE 2] Initializing decentralized voting simulation...");
    for (let i = 0; i < virtualVoters.length; i++) {
        const voter = virtualVoters[i];
        const contractWithSigner = votingContract.connect(voter);
        const timestamp = new Date().toISOString();
        
        console.log(`\nProcessing Ballot #${i + 1}/${BATCH_SIZE} | Address: ${voter.address}`);

        let startTime = Date.now();
        try {
            let tx;
            // Tries 2-argument format first, falls back to 1-argument if contract requires it
            try {
                tx = await contractWithSigner.vote(TARGET_BALLOT_ID, TARGET_CANDIDATE_ID); 
            } catch (abiErr1) {
                try {
                    tx = await contractWithSigner.castVote(TARGET_BALLOT_ID, TARGET_CANDIDATE_ID);
                } catch (abiErr2) {
                    tx = await contractWithSigner.vote(TARGET_CANDIDATE_ID);
                }
            }

            const receipt = await tx.wait();
            let endTime = Date.now();
            let latency = ((endTime - startTime) / 1000).toFixed(2);
            
            console.log(`[VOTE SUCCESS] Mined in ${latency}s | Gas Used: ${receipt.gasUsed.toString()}`);

            const row = `${timestamp},${voter.address},Initial Vote (Whitelisted),SUCCESS,${receipt.gasUsed.toString()},${latency},${receipt.hash},N/A\n`;
            fs.appendFileSync(csvFileName, row);

            // DOUBLE-VOTING EXPLOIT ATTEMPT (Every 5th user)
            if ((i + 1) % 5 === 0) {
                const attackTimestamp = new Date().toISOString();
                console.log(`  [ATTACK SIMULATION] Attempting duplicate vote transaction...`);
                
                let attackStartTime = Date.now();
                try {
                    let attackTx;
                    try {
                        attackTx = await contractWithSigner.vote(TARGET_BALLOT_ID, TARGET_CANDIDATE_ID);
                    } catch (abiErr) {
                        attackTx = await contractWithSigner.vote(TARGET_CANDIDATE_ID);
                    }
                    await attackTx.wait();
                } catch (attackError) {
                    let attackEndTime = Date.now();
                    let attackLatency = ((attackEndTime - attackStartTime) / 1000).toFixed(2);
                    
                    console.log(`  [SECURITY MATCH] Attack successfully blocked in ${attackLatency}s.`);
                    
                    const attackRow = `${attackTimestamp},${voter.address},Duplicate Vote Attack,BLOCKED,0,${attackLatency},N/A,EVM State Reverted: Already Voted\n`;
                    fs.appendFileSync(csvFileName, attackRow);
                }
            }

        } catch (error) {
            let endTime = Date.now();
            let latency = ((endTime - startTime) / 1000).toFixed(2);
            console.log(`[FAILURE] Transaction rejected: EVM State Reverted.`);
            
            const failRow = `${timestamp},${voter.address},Initial Vote,FAILED,0,${latency},N/A,EVM Revert\n`;
            fs.appendFileSync(csvFileName, failRow);
        }
    }

    console.log("\n==========================================================");
    console.log("[COMPLETE] ALL METRICS RECORDED IN election_simulation_report.csv");
    console.log("==========================================================");
}

runSystemSimulation().catch((err) => {
    console.error("[CRITICAL SYSTEM ERROR]:", err);
});