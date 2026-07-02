#!/usr/bin/env node
"use strict";

const { execFileSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

function run(cmd, args = []) {
  try {
    return {
      ok: true,
      value: execFileSync(cmd, args, {
        cwd: process.cwd(),
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"]
      }).trim()
    };
  } catch (error) {
    const stderr = error.stderr ? String(error.stderr).trim() : "";
    return { ok: false, value: stderr || error.message };
  }
}

function printCheck(label, result) {
  const mark = result.ok ? "OK" : "MISSING";
  console.log(`${mark} ${label}: ${result.value || "(no output)"}`);
}

// Fail-safe read of the pending claim link written on first node registration.
// If the file can't be read for any reason, treat it as "no pending claim".
function readClaimUrl() {
  try {
    const p = path.join(os.homedir(), ".evomap", "claim_url");
    const raw = fs.readFileSync(p, "utf8").trim();
    return raw || null;
  } catch (_) {
    return null;
  }
}

const nodeVersion = { ok: true, value: process.version };
const gitVersion = run("git", ["--version"]);
const evolverPath = run("sh", ["-lc", "command -v evolver"]);
const evolverHelp = evolverPath.ok ? run("evolver", ["--help"]) : { ok: false, value: "evolver CLI not found" };
const gitRoot = run("git", ["rev-parse", "--show-toplevel"]);
const proxySettings = path.join(os.homedir(), ".evolver", "settings.json");
const claimUrl = readClaimUrl();

console.log("Evolver Codex plugin status");
console.log(`cwd: ${process.cwd()}`);
printCheck("Node.js", nodeVersion);
printCheck("Git", gitVersion);
printCheck("Evolver CLI", evolverPath);
printCheck("Git workspace", gitRoot);

if (evolverHelp.ok) {
  const firstLine = evolverHelp.value.split(/\r?\n/).find(Boolean) || "help output available";
  console.log(`OK Evolver help: ${firstLine}`);
} else {
  console.log(`MISSING Evolver help: ${evolverHelp.value}`);
}

console.log(`INFO EVOLVE_STRATEGY: ${process.env.EVOLVE_STRATEGY || "balanced (default)"}`);
console.log(`INFO A2A_HUB_URL: ${process.env.A2A_HUB_URL || "(offline/default)"}`);
console.log(`INFO Proxy settings: ${fs.existsSync(proxySettings) ? proxySettings : "(not found)"}`);

// Plain-language "are you connected?" summary. Local memory always works; the
// network layer is optional. Leave the node id blank — the first run registers
// a fresh node and writes a claim link here. Never print secrets or node ids.
console.log("");
if (claimUrl) {
  console.log("NETWORK not yet connected — this machine registered a node but it isn't claimed yet.");
  console.log(`NETWORK to finish: sign in to evomap.ai and open this link: ${claimUrl}`);
  console.log("NETWORK that's the only step — there's no id or secret to paste anywhere.");
} else if (process.env.A2A_NODE_ID) {
  console.log("NETWORK a node id is configured; run 'evolver' once in a git repo to sync with the network.");
} else {
  console.log("NETWORK local memory works with zero config. To connect the network layer (optional),");
  console.log("NETWORK leave the node id blank and run 'evolver' once in a git repo — it registers a");
  console.log("NETWORK node and prints a claim link you open on evomap.ai. No id or secret to paste.");
}
console.log("NETWORK note: network features (searching/reusing assets) need credits — see https://evomap.ai/pricing. Local memory is always free.");

if (!evolverPath.ok) {
  console.log("NEXT install with: npm install -g @evomap/evolver");
} else if (!gitRoot.ok) {
  console.log("NEXT run Evolver from inside a git-initialized workspace.");
} else {
  console.log("NEXT try: evolver --review");
}
