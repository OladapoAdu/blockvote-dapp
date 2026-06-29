// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

contract BlockVote {

    address public admin;

    // 1. ADDED: Mapping to track which public keys have been manually authorized by the admin
    mapping(address => bool) public isWhitelisted;

    constructor() {
        admin = msg.sender;
    }

    struct Candidate {
        string name;
        uint256 voteCount;
    }

    struct Ballot {
        string title;
        uint256 endTime;
        bool exists;
        Candidate[] candidates;
    }

    Ballot[] private ballots;

    // ballotId => voter => voted?
    mapping(uint256 => mapping(address => bool)) public hasVoted;

    modifier onlyAdmin() {
        require(msg.sender == admin, "Only admin");
        _;
    }

    // 2. ADDED: Function for the admin to manually register student addresses
    function whitelistVoter(address _voter) public onlyAdmin {
        isWhitelisted[_voter] = true;
    }

    // =========================
    // CREATE BALLOT
    // =========================

    function createBallot(
        string memory _title,
        uint256 _durationInMinutes
    ) public onlyAdmin {

        Ballot storage newBallot = ballots.push();

        newBallot.title = _title;
        newBallot.endTime =
            block.timestamp +
            (_durationInMinutes * 1 minutes);

        newBallot.exists = true;
    }

    // =========================
    // ADD CANDIDATE
    // =========================

    function addCandidate(
        uint256 ballotId,
        string memory candidateName
    ) public onlyAdmin {

        require(ballotId < ballots.length, "Invalid ballot");

        ballots[ballotId].candidates.push(
            Candidate({
                name: candidateName,
                voteCount: 0
            })
        );
    }

    // =========================
    // VOTE
    // =========================

    function vote(
        uint256 ballotId,
        uint256 candidateId
    ) public {
        // 3. ADDED: Strict on-chain check to ensure the sender is whitelisted
        require(isWhitelisted[msg.sender], "You are not a registered voter");

        require(ballotId < ballots.length, "Invalid ballot");

        Ballot storage ballot = ballots[ballotId];

        require(
            block.timestamp <= ballot.endTime,
            "Election ended"
        );

        require(
            !hasVoted[ballotId][msg.sender],
            "Already voted"
        );

        require(
            candidateId < ballot.candidates.length,
            "Invalid candidate"
        );

        hasVoted[ballotId][msg.sender] = true;

        ballot.candidates[candidateId].voteCount++;
    }

    // =========================
    // GET BALLOT COUNT
    // =========================

    function getBallotCount()
        public
        view
        returns (uint256)
    {
        return ballots.length;
    }

    // =========================
    // GET BALLOT INFO
    // =========================

    function getBallot(
        uint256 ballotId
    )
        public
        view
        returns (
            string memory,
            uint256,
            uint256
        )
    {
        Ballot storage ballot = ballots[ballotId];

        return (
            ballot.title,
            ballot.endTime,
            ballot.candidates.length
        );
    }

    // =========================
    // GET CANDIDATE
    // =========================

    function getCandidate(
        uint256 ballotId,
        uint256 candidateId
    )
        public
        view
        returns (
            string memory,
            uint256
        )
    {
        Candidate storage c =
            ballots[ballotId].candidates[candidateId];

        return (
            c.name,
            c.voteCount
        );
    }
}