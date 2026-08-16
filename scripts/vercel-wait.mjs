#!/usr/bin/env node
/**
 * Wait until the Vercel deployment for a given Git commit is READY.
 *
 * The live site (yomikaze.vercel.app) is deployed from the GitHub repo, so a
 * pushed commit triggers a new deployment. This script polls the Vercel REST
 * API for that exact commit's deployment and exits 0 once it's READY, or 1 on
 * ERROR / timeout.
 *
 * Reads VERCEL_TOKEN from the VERCEL_TOKEN env var or from .env (gitignored).
 *
 * Usage:
 *     node scripts/vercel-wait.mjs <commit-sha> [timeoutMinutes]
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");
const TEAM = "team_8k0hj4en3nPW8iI6HyZaEaWf";
const PROJECT_ID = "prj_kqtTaz3lKXf1FZgDA4AsbnwpwEhj";
const targetSha = (process.argv[2] || "").trim();
const timeoutMs = (Number(process.argv[3]) || 4) * 60 * 1000;

function getToken() {
  if (process.env.VERCEL_TOKEN) return process.env.VERCEL_TOKEN.trim();
  const envFile = path.join(root, ".env");
  if (fs.existsSync(envFile)) {
    for (const line of fs.readFileSync(envFile, "utf-8").split(/\r?\n/)) {
      const m = line.match(/^\s*VERCEL_TOKEN\s*=\s*(\S+)/);
      if (m) return m[1];
    }
  }
  return null;
}

const token = getToken();
if (!token) {
  console.log("VERCEL_TOKEN not found - skipping deploy check.");
  process.exit(0);
}

const headers = { Authorization: `Bearer ${token}`, Accept: "application/json" };
const url = `https://api.vercel.com/v6/deployments?projectId=${PROJECT_ID}&teamId=${TEAM}&target=production&limit=5`;

async function latestDeployments() {
  const res = await fetch(url, { headers });
  if (!res.ok) throw new Error(`Vercel API ${res.status}`);
  const data = await res.json();
  return data?.deployments || [];
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

console.log(`waiting for deploy of commit ${targetSha || "(latest)"} ...`);
const deadline = Date.now() + timeoutMs;
let seen = new Set();

while (Date.now() < deadline) {
  try {
    const deps = await latestDeployments();
    for (const dep of deps) {
      const sha = dep.meta?.githubCommitSha || "";
      if (targetSha && sha !== targetSha) continue; // not our commit yet
      const id = dep.uid || dep.id;
      const state = dep.readyState || dep.status || "BUILDING";
      if (id && !seen.has(id)) {
        seen.add(id);
        console.log(`deploy ${id}: ${state}`);
      }
      if (state === "READY") {
        console.log("OK: live deployment is READY.");
        process.exit(0);
      }
      if (state === "ERROR" || state === "ERRORED" || state === "CANCELED") {
        console.log(`deploy ${id}: ${state} - see Vercel dashboard.`);
        process.exit(1);
      }
    }
  } catch (err) {
    console.log(`api check: ${err.message} (retrying)`);
  }
  await sleep(5000);
}

console.log("Timed out waiting for the Vercel deployment.");
process.exit(1);
