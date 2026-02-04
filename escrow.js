#!/usr/bin/env node

/**
 * PromiseKeeper - Escrow Management
 * Handles USDC testnet deposits, releases, and refunds
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PROMISES_FILE = path.join(__dirname, 'promises.json');
const USDC_TESTNET_CONTRACT = '0x9999f7Fea5968Ef84F65e40f4E2A6776D62F39e3';
const SUPPORTED_NETWORKS = ['sepolia', 'goerli', 'mumbai'];

// Load or initialize promises database
function loadPromises() {
  if (fs.existsSync(PROMISES_FILE)) {
    return JSON.parse(fs.readFileSync(PROMISES_FILE, 'utf8'));
  }
  return { promises: [], version: '1.0.0' };
}

function savePromises(data) {
  fs.writeFileSync(PROMISES_FILE, JSON.stringify(data, null, 2));
}

function generatePromiseId() {
  return 'promise_' + crypto.randomBytes(8).toString('hex');
}

function parseArgs() {
  const args = process.argv.slice(2);
  const command = args[0];
  const params = {};
  
  for (let i = 1; i < args.length; i += 2) {
    if (args[i].startsWith('--')) {
      params[args[i].replace('--', '').replace(/-/g, '_')] = args[i + 1];
    }
  }
  
  return { command, params };
}

function createPromise(params) {
  const { promise, deadline, deposit, counterparty, verification, network = 'sepolia' } = params;
  
  // Validation
  if (!promise || !deadline || !deposit || !counterparty || !verification) {
    console.error('PROMISE_KEEPER_ERROR: Missing required parameters');
    console.error('Usage: escrow.js create --promise "desc" --deadline "ISO8601" --deposit 0.5 --counterparty agent_b --verification "spec"');
    process.exit(1);
  }
  
  if (!SUPPORTED_NETWORKS.includes(network)) {
    console.error(`PROMISE_KEEPER_ERROR: Unsupported network ${network}. Use: ${SUPPORTED_NETWORKS.join(', ')}`);
    process.exit(1);
  }
  
  // Parse deposit
  const depositAmount = parseFloat(deposit);
  if (isNaN(depositAmount) || depositAmount < 0.01) {
    console.error('PROMISE_KEEPER_ERROR: Minimum deposit is 0.01 USDC');
    process.exit(1);
  }
  
  // Parse deadline
  const deadlineDate = new Date(deadline);
  if (isNaN(deadlineDate.getTime())) {
    console.error('PROMISE_KEEPER_ERROR: Invalid deadline format. Use ISO8601 (e.g., 2026-02-07T18:00:00Z)');
    process.exit(1);
  }
  
  // Calculate max deadline (30 days from now)
  const maxDeadline = new Date();
  maxDeadline.setDate(maxDeadline.getDate() + 30);
  if (deadlineDate > maxDeadline) {
    console.error('PROMISE_KEEPER_ERROR: Deadline cannot exceed 30 days');
    process.exit(1);
  }
  
  // Create promise record
  const promiseId = generatePromiseId();
  const data = loadPromises();
  
  const promiseRecord = {
    id: promiseId,
    agent_a: process.env.AGENT_ID || 'unknown_agent',
    agent_b: counterparty,
    promise: promise,
    deadline: deadline,
    deadline_timestamp: deadlineDate.getTime(),
    deposit_usdc: depositAmount.toFixed(2),
    network: network,
    usdc_contract: USDC_TESTNET_CONTRACT,
    verification_spec: verification,
    status: 'pending_deposit', // pending_deposit -> active -> completed|expired|refunded
    created_at: new Date().toISOString(),
    created_at_timestamp: Date.now(),
    escrow_address: null,
    deposit_tx_hash: null,
    release_tx_hash: null,
    refund_tx_hash: null,
    completed_at: null,
    completion_proof: null
  };
  
  data.promises.push(promiseRecord);
  savePromises(data);
  
  console.log(`\n╔════════════════════════════════════════════════════════════╗`);
  console.log(`║         PROMISE CREATED - AWAITING DEPOSIT                 ║`);
  console.log(`╚════════════════════════════════════════════════════════════╝\n`);
  console.log(`Promise ID:     ${promiseId}`);
  console.log(`From (Agent A): ${promiseRecord.agent_a}`);
  console.log(`To (Agent B):   ${counterparty}`);
  console.log(`Promise:        "${promise}"`);
  console.log(`Deadline:       ${deadline}`);
  console.log(`Deposit:        ${depositAmount.toFixed(2)} USDC (testnet)`);
  console.log(`Network:        ${network}`);
  console.log(`Verification:   ${verification}`);
  console.log(`Status:         PENDING_DEPOSIT\n`);
  console.log(`To activate, agent must deposit ${depositAmount.toFixed(2)} USDC to escrow.`);
  console.log(`Get testnet USDC from: https://faucet.circle.com/\n`);
  console.log(`Next: Have ${counterparty} run:`);
  console.log(`  ./escrow.js deposit ${promiseId} --amount ${depositAmount.toFixed(2)}\n`);
  
  // Output completion signal for automation
  console.log(`PROMISEKEEPER_CREATE_${promiseId}_PENDING: Promise created, awaiting deposit`);
  
  return promiseId;
}

function deposit(params) {
  const { promise_id, amount, network = 'sepolia' } = params;
  
  if (!promise_id || !amount) {
    console.error('PROMISE_KEEPER_ERROR: Usage: escrow.js deposit <promise_id> --amount <usdc_amount>');
    process.exit(1);
  }
  
  const data = loadPromises();
  const promise = data.promises.find(p => p.id === promise_id);
  
  if (!promise) {
    console.error(`PROMISE_KEEPER_ERROR: Promise ${promise_id} not found`);
    process.exit(1);
  }
  
  if (promise.status !== 'pending_deposit') {
    console.error(`PROMISE_KEEPER_ERROR: Promise ${promise_id} is ${promise.status}, expected pending_deposit`);
    process.exit(1);
  }
  
  const depositAmount = parseFloat(amount);
  const requiredAmount = parseFloat(promise.deposit_usdc);
  
  if (depositAmount < requiredAmount) {
    console.error(`PROMISE_KEEPER_ERROR: Deposit ${depositAmount} is less than required ${requiredAmount} USDC`);
    process.exit(1);
  }
  
  // Simulate blockchain deposit (in production, this would interact with USDC contract)
  const txHash = '0x' + crypto.randomBytes(32).toString('hex');
  
  promise.status = 'active';
  promise.deposit_tx_hash = txHash;
  promise.escrow_address = `pk_escrow_${promise_id}`;
  savePromises(data);
  
  console.log(`\n╔════════════════════════════════════════════════════════════╗`);
  console.log(`║              DEPOSIT RECEIVED - PROMISE ACTIVE             ║`);
  console.log(`╚════════════════════════════════════════════════════════════╝\n`);
  console.log(`Promise ID:     ${promise_id}`);
  console.log(`Deposit Amount: ${depositAmount.toFixed(2)} USDC`);
  console.log(`Tx Hash:        ${txHash}`);
  console.log(`Escrow:         ${promise.escrow_address}`);
  console.log(`Status:         ACTIVE\n`);
  console.log(`Agent A must complete by: ${promise.deadline}`);
  console.log(`Verification:   ${promise.verification_spec}\n`);
  
  console.log(`PROMISEKEEPER_${promise_id}_ACTIVE: Promise active with ${depositAmount.toFixed(2)} USDC escrow`);
}

function checkStatus(params) {
  const { params: p } = parseArgs();
  const promiseId = p.promise_id || process.argv[3];
  
  if (!promiseId) {
    console.error('PROMISE_KEEPER_ERROR: Usage: escrow.js status <promise_id>');
    process.exit(1);
  }
  
  const data = loadPromises();
  const promise = data.promises.find(p => p.id === promiseId);
  
  if (!promise) {
    console.error(`PROMISE_KEEPER_ERROR: Promise ${promiseId} not found`);
    process.exit(1);
  }
  
  const now = Date.now();
  const isExpired = now > promise.deadline_timestamp;
  const timeRemaining = promise.deadline_timestamp - now;
  
  console.log(`\n╔════════════════════════════════════════════════════════════╗`);
  console.log(`║                 PROMISE STATUS                             ║`);
  console.log(`╚════════════════════════════════════════════════════════════╝\n`);
  console.log(`Promise ID:     ${promise.id}`);
  console.log(`Agent A:        ${promise.agent_a}`);
  console.log(`Agent B:        ${promise.agent_b}`);
  console.log(`Promise:        "${promise.promise}"`);
  console.log(`Status:         ${promise.status.toUpperCase()}`);
  console.log(`Deposit:        ${promise.deposit_usdc} USDC`);
  console.log(`Deadline:       ${promise.deadline}`);
  console.log(`Network:        ${promise.network}`);
  console.log(`\nTime Analysis:`);
  console.log(`  Now:          ${new Date().toISOString()}`);
  console.log(`  Deadline:     ${promise.deadline}`);
  console.log(`  Expired:      ${isExpired ? 'YES - Refund available' : 'NO'}`);
  if (!isExpired && promise.status === 'active') {
    const hoursLeft = Math.floor(timeRemaining / (1000 * 60 * 60));
    const minutesLeft = Math.floor((timeRemaining % (1000 * 60 * 60)) / (1000 * 60));
    console.log(`  Remaining:    ${hoursLeft}h ${minutesLeft}m`);
  }
  console.log();
  
  if (promise.completed_at) {
    console.log(`Completed:      ${promise.completed_at}`);
  }
  if (promise.completion_proof) {
    console.log(`Proof:          ${JSON.stringify(promise.completion_proof)}`);
  }
  console.log();
}

function release(params) {
  const { params: p } = parseArgs();
  const promiseId = p.promise_id || process.argv[3];
  const proof = p.proof;
  
  if (!promiseId) {
    console.error('PROMISE_KEEPER_ERROR: Usage: escrow.js release <promise_id> --proof <verification>');
    process.exit(1);
  }
  
  const data = loadPromises();
  const promise = data.promises.find(p => p.id === promiseId);
  
  if (!promise) {
    console.error(`PROMISE_KEEPER_ERROR: Promise ${promiseId} not found`);
    process.exit(1);
  }
  
  if (promise.status !== 'active') {
    console.error(`PROMISE_KEEPER_ERROR: Cannot release - promise is ${promise.status}`);
    process.exit(1);
  }
  
  // Simulate blockchain release
  const txHash = '0x' + crypto.randomBytes(32).toString('hex');
  
  promise.status = 'completed';
  promise.release_tx_hash = txHash;
  promise.completed_at = new Date().toISOString();
  promise.completion_proof = proof || 'verified_via_external';
  savePromises(data);
  
  console.log(`\n╔════════════════════════════════════════════════════════════╗`);
  console.log(`║              PROMISE COMPLETE - FUNDS RELEASED             ║`);
  console.log(`╚════════════════════════════════════════════════════════════╝\n`);
  console.log(`Promise ID:     ${promiseId}`);
  console.log(`Funds Released: ${promise.deposit_usdc} USDC to ${promise.agent_a}`);
  console.log(`Release Tx:     ${txHash}`);
  console.log(`Status:         COMPLETED\n`);
  console.log(`PROMISE_${promiseId}_COMPLETE: Promise fulfilled, escrow released`);
  console.log(`PROMISEKEEPER_${promiseId}_RELEASED: ${promise.deposit_usdc} USDC transferred to ${promise.agent_a}`);
}

function refund(params) {
  const { params: p } = parseArgs();
  const promiseId = p.promise_id || process.argv[3];
  
  if (!promiseId) {
    console.error('PROMISE_KEEPER_ERROR: Usage: escrow.js refund <promise_id>');
    process.exit(1);
  }
  
  const data = loadPromises();
  const promise = data.promises.find(p => p.id === promiseId);
  
  if (!promise) {
    console.error(`PROMISE_KEEPER_ERROR: Promise ${promiseId} not found`);
    process.exit(1);
  }
  
  if (promise.status !== 'active' && promise.status !== 'pending_deposit') {
    console.error(`PROMISE_KEEPER_ERROR: Cannot refund - promise is ${promise.status}`);
    process.exit(1);
  }
  
  const now = Date.now();
  if (now < promise.deadline_timestamp && promise.status === 'active') {
    const hoursLeft = Math.floor((promise.deadline_timestamp - now) / (1000 * 60 * 60));
    console.error(`PROMISE_KEEPER_ERROR: Deadline not reached. ${hoursLeft} hours remaining.`);
    process.exit(1);
  }
  
  // Simulate blockchain refund
  const txHash = '0x' + crypto.randomBytes(32).toString('hex');
  
  promise.status = 'refunded';
  promise.refund_tx_hash = txHash;
  savePromises(data);
  
  console.log(`\n╔════════════════════════════════════════════════════════════╗`);
  console.log(`║           PROMISE EXPIRED - FUNDS REFUNDED                 ║`);
  console.log(`╚════════════════════════════════════════════════════════════╝\n`);
  console.log(`Promise ID:     ${promiseId}`);
  console.log(`Deadline:       ${promise.deadline}`);
  console.log(`Funds Refunded: ${promise.deposit_usdc} USDC to ${promise.agent_b}`);
  console.log(`Refund Tx:      ${txHash}`);
  console.log(`Status:         REFUNDED\n`);
  console.log(`PROMISE_${promiseId}_EXPIRED: Deadline missed, funds returned to ${promise.agent_b}`);
  console.log(`PROMISEKEEPER_${promiseId}_REFUNDED: ${promise.deposit_usdc} USDC refunded to depositor`);
}

function listPromises() {
  const data = loadPromises();
  const { promises } = data;
  
  console.log(`\n╔════════════════════════════════════════════════════════════╗`);
  console.log(`║              PROMISE KEEPER - ALL PROMISES                 ║`);
  console.log(`╚════════════════════════════════════════════════════════════╝\n`);
  
  if (promises.length === 0) {
    console.log('No promises found.\n');
    return;
  }
  
  // Group by status
  const byStatus = {
    pending_deposit: [],
    active: [],
    completed: [],
    refunded: [],
    expired: []
  };
  
  promises.forEach(p => {
    if (byStatus[p.status]) {
      byStatus[p.status].push(p);
    }
  });
  
  Object.entries(byStatus).forEach(([status, list]) => {
    if (list.length > 0) {
      console.log(`\n${status.toUpperCase()} (${list.length}):`);
      console.log('-'.repeat(60));
      list.forEach(p => {
        const shortId = p.id.replace('promise_', '');
        console.log(`  ${shortId}: ${p.promise.substring(0, 50)}... (${p.deposit_usdc} USDC)`);
        if (p.status === 'active') {
          const hoursLeft = Math.floor((p.deadline_timestamp - Date.now()) / (1000 * 60 * 60));
          console.log(`           ⏰ ${hoursLeft}h left | ${p.agent_a} → ${p.agent_b}`);
        }
      });
    }
  });
  
  console.log(`\n${promises.length} total promises in database.\n`);
}

// Main execution
const { command, params } = parseArgs();

switch (command) {
  case 'create':
    createPromise(params);
    break;
  case 'deposit':
    deposit(params);
    break;
  case 'release':
    release(params);
    break;
  case 'refund':
    refund(params);
    break;
  case 'status':
    checkStatus(params);
    break;
  case 'list':
    listPromises();
    break;
  default:
    console.log(`
PromiseKeeper - Agent Escrow for Verifiable Commitments

Commands:
  create --promise "desc" --deadline "ISO8601" --deposit 0.5 --counterparty agent_b --verification "spec"
    Create a new promise/escrow commitment

  deposit <promise_id> --amount 0.5
    Deposit USDC to activate a promise

  release <promise_id> --proof <verification>
    Release escrow to Agent A upon verified completion

  refund <promise_id>
    Return funds to Agent B if deadline passed

  status <promise_id>
    Check promise status and deadline

  list
    Show all promises grouped by status

Verification Specs:
  git:repo=<repo>,path=<file>,min_lines=<n>
  file:path=<file>,created_after=<ISO8601>
  api:url=<endpoint>,response_contains=<string>

Examples:
  ./escrow.js create --promise "Read chapters 1-3" --deadline "2026-02-07T18:00:00Z" --deposit 0.5 --counterparty agent_b --verification "git:repo=bob-bootstrap,path=notes/chapters.md,min_lines=50"
  
  ./escrow.js deposit promise_abc123 --amount 0.5
  
  ./escrow.js status promise_abc123
  
  ./escrow.js release promise_abc123 --proof "verified_commit_abc123"
  
  ./escrow.js refund promise_abc123
`);
    process.exit(0);
}
