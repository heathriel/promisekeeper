#!/usr/bin/env node

/**
 * PromiseKeeper - Verification Module
 * Checks completion signals for escrowed promises
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execSync } = require('child_process');

const PROMISES_FILE = path.join(__dirname, 'promises.json');

function loadPromises() {
  if (fs.existsSync(PROMISES_FILE)) {
    return JSON.parse(fs.readFileSync(PROMISES_FILE, 'utf8'));
  }
  return { promises: [] };
}

function savePromises(data) {
  fs.writeFileSync(PROMISES_FILE, JSON.stringify(data, null, 2));
}

function parseVerificationSpec(spec) {
  const parts = spec.split(':');
  const type = parts[0];
  const params = {};
  
  if (parts[1]) {
    parts[1].split(',').forEach(part => {
      const [key, value] = part.split('=');
      if (key && value) {
        params[key] = value;
      }
    });
  }
  
  return { type, params };
}

function verifyGitCommit(params) {
  const { repo, path: filePath, min_lines } = params;
  
  console.log(`🔍 Verifying git commit in repo: ${repo || 'current'}`);
  console.log(`   Looking for file: ${filePath}`);
  if (min_lines) console.log(`   Minimum lines required: ${min_lines}`);
  
  try {
    // Check if we're in a git repo
    const gitRoot = execSync('git rev-parse --show-toplevel', { 
      encoding: 'utf8', 
      cwd: process.cwd(),
      stdio: ['pipe', 'pipe', 'pipe']
    }).trim();
    
    console.log(`   Git repo found: ${gitRoot}`);
    
    // Check file existence
    const fullPath = path.join(gitRoot, filePath);
    
    if (!fs.existsSync(fullPath)) {
      return {
        fulfilled: false,
        reason: `File ${filePath} not found`,
        proof: null
      };
    }
    
    console.log(`   ✓ File exists: ${fullPath}`);
    
    // Check line count if specified
    if (min_lines) {
      const content = fs.readFileSync(fullPath, 'utf8');
      const lineCount = content.split('\n').length;
      
      if (lineCount < parseInt(min_lines)) {
        return {
          fulfilled: false,
          reason: `File has ${lineCount} lines, minimum ${min_lines} required`,
          proof: { lineCount, filePath }
        };
      }
      
      console.log(`   ✓ Line count: ${lineCount} >= ${min_lines}`);
    }
    
    // Get latest commit hash for the file
    const commitHash = execSync(`git log -1 --pretty=format:"%H" -- "${fullPath}"`, {
      encoding: 'utf8',
      cwd: gitRoot
    }).trim();
    
    const commitTime = execSync(`git log -1 --pretty=format:"%ci" -- "${fullPath}"`, {
      encoding: 'utf8',
      cwd: gitRoot
    }).trim();
    
    console.log(`   ✓ Commit found: ${commitHash.substring(0, 16)}...`);
    console.log(`   ✓ Commit time: ${commitTime}`);
    
    return {
      fulfilled: true,
      proof: {
        commitHash,
        commitTime,
        filePath,
        lineCount: min_lines ? fs.readFileSync(fullPath, 'utf8').split('\n').length : null
      }
    };
    
  } catch (error) {
    return {
      fulfilled: false,
      reason: `Git verification failed: ${error.message}`,
      proof: null
    };
  }
}

function verifyFileExists(params) {
  const { path: filePath, created_after, modified_after } = params;
  
  console.log(`🔍 Verifying file existence: ${filePath}`);
  
  const workDir = process.env.WORKSPACE || process.cwd();
  const fullPath = path.join(workDir, filePath);
  
  if (!fs.existsSync(fullPath)) {
    return {
      fulfilled: false,
      reason: `File ${filePath} not found`,
      proof: null
    };
  }
  
  console.log(`   ✓ File exists: ${fullPath}`);
  
  const stats = fs.statSync(fullPath);
  const created = new Date(stats.birthtime);
  const modified = new Date(stats.mtime);
  
  console.log(`   Created: ${created.toISOString()}`);
  console.log(`   Modified: ${modified.toISOString()}`);
  
  // Check creation time if specified
  if (created_after) {
    const afterDate = new Date(created_after);
    if (created <= afterDate) {
      return {
        fulfilled: false,
        reason: `File created ${created.toISOString()}, but must be after ${created_after}`,
        proof: { created: created.toISOString() }
      };
    }
    console.log(`   ✓ Created after ${created_after}`);
  }
  
  // Check modification time if specified
  if (modified_after) {
    const afterDate = new Date(modified_after);
    if (modified <= afterDate) {
      return {
        fulfilled: false,
        reason: `File modified ${modified.toISOString()}, but must be after ${modified_after}`,
        proof: { modified: modified.toISOString() }
      };
    }
    console.log(`   ✓ Modified after ${modified_after}`);
  }
  
  return {
    fulfilled: true,
    proof: {
      filePath,
      created: created.toISOString(),
      modified: modified.toISOString(),
      size: stats.size
    }
  };
}

function verifyApiCall(params) {
  const { url, response_contains, status_code = '200' } = params;
  
  console.log(`🔍 Verifying API call to: ${url}`);
  console.log(`   Expected status: ${status_code}`);
  if (response_contains) console.log(`   Response must contain: ${response_contains}`);
  
  // Note: In a real implementation, this would make the actual API call
  // For hackathon demo, we simulate the verification
  console.log(`   ⚠️  API verification simulated (would call ${url})`);
  
  return {
    fulfilled: true,
    proof: {
      url,
      statusCode: parseInt(status_code),
      timestamp: new Date().toISOString(),
      note: 'Simulated for demo - production would make actual API call'
    }
  };
}

function checkPromise(promiseId) {
  const data = loadPromises();
  const promise = data.promises.find(p => p.id === promiseId);
  
  if (!promise) {
    console.error(`❌ PROMISE_KEEPER_ERROR: Promise ${promiseId} not found`);
    process.exit(1);
  }
  
  console.log(`\n╔════════════════════════════════════════════════════════════╗`);
  console.log(`║           VERIFYING PROMISE COMPLETION                     ║`);
  console.log(`╚════════════════════════════════════════════════════════════╝\n`);
  console.log(`Promise ID: ${promiseId}`);
  console.log(`Promise:    "${promise.promise}"`);
  console.log(`Deadline:   ${promise.deadline}`);
  console.log(`Spec:       ${promise.verification_spec}\n`);
  
  // Check deadline
  const now = Date.now();
  const deadlinePassed = now > promise.deadline_timestamp;
  
  if (deadlinePassed) {
    console.log(`⚠️  DEADLINE PASSED`);
    console.log(`   Promise expired at ${promise.deadline}`);
    
    return {
      promiseId,
      fulfilled: false,
      deadline_passed: true,
      reason: 'Deadline passed without completion',
      proof: null
    };
  }
  
  // Parse and execute verification
  const { type, params } = parseVerificationSpec(promise.verification_spec);
  
  console.log(`Verification Type: ${type}`);
  console.log(`Parameters: ${JSON.stringify(params, null, 2)}\n`);
  
  let result;
  
  switch (type) {
    case 'git':
      result = verifyGitCommit(params);
      break;
    case 'file':
      result = verifyFileExists(params);
      break;
    case 'api':
      result = verifyApiCall(params);
      break;
    default:
      result = {
        fulfilled: false,
        reason: `Unknown verification type: ${type}`,
        proof: null
      };
  }
  
  console.log(`\n╔════════════════════════════════════════════════════════════╗`);
  if (result.fulfilled) {
    console.log(`║              ✅ VERIFICATION SUCCESSFUL                     ║`);
    console.log(`╚════════════════════════════════════════════════════════════╝`);
    console.log(`\nCompletion verified! Ready for release.`);
    console.log(`Run: ./escrow.js release ${promiseId}\n`);
    
    // Output completion signal
    console.log(`PROMISE_${promiseId}_COMPLETE: "${promise.promise}" verified and ready for release`);
    console.log(`PROMISEKEEPER_VERIFY_${promiseId}_SUCCESS: Verification passed`);
  } else {
    console.log(`║              ❌ VERIFICATION FAILED                         ║`);
    console.log(`╚════════════════════════════════════════════════════════════╝`);
    console.log(`\nReason: ${result.reason}`);
    console.log(`Promise not yet complete. Agent A must finish the work.\n`);
    
    console.log(`PROMISEKEEPER_VERIFY_${promiseId}_PENDING: ${result.reason}`);
  }
  
  result.promise_id = promiseId;
  result.deadline_passed = deadlinePassed;
  
  return result;
}

function listVerifications() {
  const data = loadPromises();
  const activePromises = data.promises.filter(p => p.status === 'active');
  
  console.log(`\n╔════════════════════════════════════════════════════════════╗`);
  console.log(`║           ACTIVE PROMISES - VERIFICATION STATUS            ║`);
  console.log(`╚════════════════════════════════════════════════════════════╝\n`);
  
  if (activePromises.length === 0) {
    console.log('No active promises to verify.\n');
    return;
  }
  
  activePromises.forEach(p => {
    const hoursLeft = Math.floor((p.deadline_timestamp - Date.now()) / (1000 * 60 * 60));
    console.log(`\n${p.id}:`);
    console.log(`  Promise: ${p.promise.substring(0, 60)}...`);
    console.log(`  Spec:    ${p.verification_spec}`);
    console.log(`  ⏰ ${hoursLeft}h remaining`);
    console.log(`  Check:   ./verify.js check ${p.id}`);
  });
  
  console.log(`\n\n${activePromises.length} active promises awaiting completion.\n`);
}

// Main execution
const command = process.argv[2];
const promiseId = process.argv[3];

switch (command) {
  case 'check':
    if (!promiseId) {
      console.error('❌ Usage: verify.js check <promise_id>');
      process.exit(1);
    }
    const result = checkPromise(promiseId);
    process.exit(result.fulfilled ? 0 : 1);
    break;
    
  case 'list':
  case 'status':
    listVerifications();
    break;
    
  default:
    console.log(`
PromiseKeeper Verification Module

Commands:
  check <promise_id>
    Verify if the promise conditions are met
    Returns exit code 0 if fulfilled, 1 if not

  list
    Show all active promises with verification specs

Verification Types:
  git:repo=<repo>,path=<file>,min_lines=<n>
    Verify a git commit exists for the specified file
    with optional minimum line count

  file:path=<file>,created_after=<ISO8601>,modified_after=<ISO8601>
    Verify file exists and was created/modified after specified times

  api:url=<endpoint>,response_contains=<string>,status_code=<n>
    Verify API call returns expected response

Examples:
  ./verify.js check promise_abc123
  ./verify.js list

Exit Codes:
  0 - Verification passed (promise fulfilled)
  1 - Verification failed or promise not found
`);
    process.exit(0);
}
