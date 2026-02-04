// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

interface IERC20 {
    function transfer(address to, uint256 amount) external returns (bool);
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
    function balanceOf(address account) external view returns (uint256);
    function approve(address spender, uint256 amount) external returns (bool);
}

/**
 * @title PromiseKeeperEscrow
 * @notice Agent-to-agent escrow for verifiable commitments
 * @dev Testnet-only implementation for USDC Hackathon
 */
contract PromiseKeeperEscrow {
    
    struct Promise {
        bytes32 id;
        address agentA;        // Promisor
        address agentB;        // Beneficiary/Staker
        address token;         // USDC contract address
        uint256 amount;
        uint256 deadline;
        bytes32 verificationHash;
        PromiseStatus status;
        string promise;        // Description
        string verificationSpec;
    }
    
    enum PromiseStatus {
        Pending,      // Awaiting deposit
        Active,       // Deposited, awaiting completion
        Completed,    // Verified and released
        Expired,      // Deadline passed, refunded
        Disputed      // Under dispute resolution
    }
    
    mapping(bytes32 => Promise) public promises;
    mapping(address => bytes32[]) public agentPromises;
    
    uint256 public promiseCount;
    address public owner;
    
    // Testnet faucet allowance per agent
    mapping(address => uint256) public faucetAllowance;
    uint256 public constant MAX_FAUCET_AMOUNT = 10 * 10**6; // 10 USDC (6 decimals)
    
    event PromiseCreated(
        bytes32 indexed id,
        address indexed agentA,
        address indexed agentB,
        uint256 amount,
        uint256 deadline
    );
    
    event DepositMade(bytes32 indexed id, address indexed agentB, uint256 amount);
    event PromiseCompleted(bytes32 indexed id, address indexed agentA, bytes32 proof);
    event PromiseExpired(bytes32 indexed id, address indexed agentB);
    event PromiseDisputed(bytes32 indexed id, address indexed disputer, string reason);
    
    modifier onlyOwner() {
        require(msg.sender == owner, "Not owner");
        _;
    }
    
    modifier validPromise(bytes32 _promiseId) {
        require(promises[_promiseId].id == _promiseId, "Promise not found");
        _;
    }
    
    constructor() {
        owner = msg.sender;
    }
    
    /**
     * @notice Create a new promise commitment
     * @param _agentA The agent promising to do work
     * @param _deadline Unix timestamp for completion deadline
     * @param _verificationSpec Specification for verification
     * @param _promiseDescription Human-readable description of promise
     * @param _token USDC token contract address
     */
    function createPromise(
        address _agentA,
        uint256 _deadline,
        string calldata _verificationSpec,
        string calldata _promiseDescription,
        address _token
    ) external returns (bytes32) {
        require(_agentA != address(0), "Invalid agent A");
        require(_deadline > block.timestamp, "Deadline must be future");
        require(_deadline <= block.timestamp + 30 days, "Max 30 day deadline");
        require(bytes(_verificationSpec).length > 0, "Verification required");
        
        bytes32 promiseId = keccak256(abi.encodePacked(
            msg.sender,
            _agentA,
            _deadline,
            block.timestamp,
            promiseCount++
        ));
        
        Promise storage p = promises[promiseId];
        p.id = promiseId;
        p.agentA = _agentA;
        p.agentB = msg.sender;
        p.token = _token;
        p.deadline = _deadline;
        p.status = PromiseStatus.Pending;
        p.promise = _promiseDescription;
        p.verificationSpec = _verificationSpec;
        
        agentPromises[_agentA].push(promiseId);
        agentPromises[msg.sender].push(promiseId);
        
        emit PromiseCreated(promiseId, _agentA, msg.sender, 0, _deadline);
        
        return promiseId;
    }
    
    /**
     * @notice Deposit USDC into escrow for the promise
     * @param _promiseId The promise ID
     * @param _amount Amount of USDC (6 decimals)
     */
    function deposit(bytes32 _promiseId, uint256 _amount) external validPromise(_promiseId) {
        Promise storage p = promises[_promiseId];
        
        require(p.status == PromiseStatus.Pending, "Not pending");
        require(p.agentB == msg.sender, "Only agent B can deposit");
        require(_amount >= 0.01 * 10**6, "Minimum 0.01 USDC"); // Min 0.01 USDC
        require(_amount <= MAX_FAUCET_AMOUNT, "Exceeds max");
        
        IERC20 token = IERC20(p.token);
        require(
            token.transferFrom(msg.sender, address(this), _amount),
            "Transfer failed"
        );
        
        p.amount = _amount;
        p.status = PromiseStatus.Active;
        
        emit DepositMade(_promiseId, msg.sender, _amount);
    }
    
    /**
     * @notice Complete promise and release funds to agent A
     * @param _promiseId The promise ID
     * @param _verificationProof Hash of verification proof
     */
    function completePromise(
        bytes32 _promiseId,
        bytes32 _verificationProof
    ) external validPromise(_promiseId) {
        Promise storage p = promises[_promiseId];
        
        require(p.status == PromiseStatus.Active, "Not active");
        require(block.timestamp <= p.deadline, "Deadline passed");
        require(_verificationProof != bytes32(0), "Proof required");
        
        // In production, this would verify the proof against spec
        // For demo, we accept any non-zero proof
        
        p.verificationHash = _verificationProof;
        p.status = PromiseStatus.Completed;
        
        // Release funds to agent A
        IERC20 token = IERC20(p.token);
        require(
            token.transfer(p.agentA, p.amount),
            "Release failed"
        );
        
        emit PromiseCompleted(_promiseId, p.agentA, _verificationProof);
    }
    
    /**
     * @notice Refund agent B if deadline passed without completion
     * @param _promiseId The promise ID
     */
    function refund(bytes32 _promiseId) external validPromise(_promiseId) {
        Promise storage p = promises[_promiseId];
        
        require(
            p.status == PromiseStatus.Active || p.status == PromiseStatus.Pending,
            "Invalid status"
        );
        require(block.timestamp > p.deadline, "Deadline not passed");
        
        p.status = PromiseStatus.Expired;
        
        // Return funds to agent B
        if (p.amount > 0) {
            IERC20 token = IERC20(p.token);
            require(
                token.transfer(p.agentB, p.amount),
                "Refund failed"
            );
        }
        
        emit PromiseExpired(_promiseId, p.agentB);
    }
    
    /**
     * @notice Get promise details
     */
    function getPromise(bytes32 _promiseId) external view returns (Promise memory) {
        return promises[_promiseId];
    }
    
    /**
     * @notice Get all promise IDs for an agent
     */
    function getAgentPromises(address _agent) external view returns (bytes32[] memory) {
        return agentPromises[_agent];
    }
    
    /**
     * @notice Check if promise is expired
     */
    function isExpired(bytes32 _promiseId) external view validPromise(_promiseId) returns (bool) {
        Promise storage p = promises[_promiseId];
        return block.timestamp > p.deadline;
    }
    
    /**
     * @notice Dispute a promise (for future arbitration)
     */
    function dispute(bytes32 _promiseId, string calldata _reason) external validPromise(_promiseId) {
        Promise storage p = promises[_promiseId];
        require(
            msg.sender == p.agentA || msg.sender == p.agentB,
            "Not a party"
        );
        require(p.status == PromiseStatus.Active, "Not active");
        
        p.status = PromiseStatus.Disputed;
        
        emit PromiseDisputed(_promiseId, msg.sender, _reason);
    }
    
    // Admin functions
    
    function setFaucetAllowance(address _agent, uint256 _amount) external onlyOwner {
        faucetAllowance[_agent] = _amount;
    }
    
    function emergencyRelease(bytes32 _promiseId, address _to) external onlyOwner validPromise(_promiseId) {
        Promise storage p = promises[_promiseId];
        require(p.amount > 0, "No funds");
        
        uint256 amount = p.amount;
        p.amount = 0;
        
        IERC20 token = IERC20(p.token);
        token.transfer(_to, amount);
    }
    
    receive() external payable {
        revert("ETH not accepted");
    }
}
