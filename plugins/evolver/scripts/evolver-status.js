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

const nodeVersion = { ok: true, value: process.version };
const gitVersion = run("git", ["--version"]);
const evolverPath = run("sh", ["-lc", "command -v evolver"]);
const evolverHelp = evolverPath.ok ? run("evolver", ["--help"]) : { ok: false, value: "evolver CLI not found" };
const gitRoot = run("git", ["rev-parse", "--show-toplevel"]);
const proxySettings = path.join(os.homedir(), ".evolver", "settings.json");

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
console.log(`INFO A2A_NODE_ID: ${process.env.A2A_NODE_ID ? "(set)" : "(not set)"}`);
console.log(`INFO Proxy settings: ${fs.existsSync(proxySettings) ? proxySettings : "(not found)"}`);

if (!evolverPath.ok) {
  console.log("NEXT install with: npm install -g @evomap/evolver");
} else if (!gitRoot.ok) {
  console.log("NEXT run Evolver from inside a git-initialized workspace.");
} else {
  console.log("NEXT try: evolver --review");
}
