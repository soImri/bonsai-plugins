// Sign or verify a skill marketplace's marketplace.index.json with a detached
// Ed25519 signature, producing/reading marketplace.index.sig.
//
// This script ships into a marketplace repository as tools/sign.mjs and runs
// there, on a contributor's machine or in that repository's own CI. There is
// no package.json and no node_modules to rely on: every import below is a
// Node builtin, and this file must never grow a dependency.
//
// Usage:
//   node tools/sign.mjs --key <path.pem>   sign marketplace.index.json with
//                                           the PKCS8 PEM Ed25519 private key
//                                           at <path.pem>, writing
//                                           marketplace.index.sig
//   node tools/sign.mjs --verify           verify marketplace.index.sig
//                                           against the current
//                                           marketplace.index.json, using the
//                                           public key the .sig file itself
//                                           names
//   node tools/sign.mjs --root DIR         run against DIR instead of the
//                                           current directory, mirroring
//                                           validate.mjs's own --root
//
// Signing needs a private key. `--key` names a PEM file directly; when it is
// absent, the PEM is read from the MARKETPLACE_SIGNING_KEY environment
// variable instead. That is how CI is expected to supply it, as a repository
// secret injected into the environment, never as a key file checked into the
// repo.
//
// *** --verify proves integrity and freshness, NOT authority. ***
// A passing --verify answers exactly one question: was marketplace.index.json
// signed, by the private half of the key this very .sig file names, after it
// was last regenerated. It trusts that key only because the file names it; it
// has no opinion on whether that key itself should be trusted. Deciding
// whether a keyId is one Bonsai actually trusts is Bonsai's job, done by matching
// it against a trust anchor Bonsai holds, never this script's. Never describe a
// passing --verify as proving the marketplace itself is "verified": that
// word names what Bonsai concludes after ALSO checking the key against its own
// trust anchor, a step this script cannot take and does not attempt.
//
// marketplace.index.sig, at the marketplace root beside marketplace.index.json:
//   {
//     "schemaVersion": 1,
//     "alg": "Ed25519",
//     "keyId": "<base64url of the raw 32-byte Ed25519 public key, no padding>",
//     "signature": "<base64url detached Ed25519 signature, no padding>"
//   }
//
// The signature covers the exact byte content of marketplace.index.json AS
// COMMITTED: this script reads it as raw bytes and signs (or verifies) those
// bytes, never a re-serialization or a canonicalized form. Signing a
// re-serialization would let bytes that are meaning-identical but
// byte-different from what is actually committed pass verification, which
// defeats the whole point of a byte-exact integrity check: Bonsai reads the
// committed bytes, not a canonical form of them.
//
// Signing is entirely optional. A marketplace with no marketplace.index.sig
// is a perfectly valid, unsigned marketplace; see validate-marketplace.yml,
// which only runs `--verify` when the file exists.
import { createPrivateKey, createPublicKey, sign, verify } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

const INDEX_FILENAME = "marketplace.index.json";
const SIG_FILENAME = "marketplace.index.sig";
const SCHEMA_VERSION = 1;
const ALG = "Ed25519";

// The fixed 12-byte ASN.1 prefix common to every Ed25519 SubjectPublicKeyInfo
// DER encoding: SEQUENCE { AlgorithmIdentifier { OID id-Ed25519 }, BIT STRING
// { unused-bits 0x00, <32-byte raw key> } }. Node's own `export({ type:
// "spki", format: "der" })` always produces exactly this shape for an
// Ed25519 public key, so the last 32 bytes of that export are always the raw
// key, and prefixing them back on always reconstructs a key Node's own
// `createPublicKey` accepts.
const ED25519_SPKI_DER_PREFIX = Buffer.from("302a300506032b6570032100", "hex");

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

function parseArgs(argv) {
  const verifyMode = argv.includes("--verify");

  const keyIndex = argv.indexOf("--key");
  let keyPath;
  if (keyIndex !== -1) {
    const value = argv[keyIndex + 1];
    if (!value || value.startsWith("--")) {
      console.error("\u2717 --key requires a file path argument");
      process.exit(1);
    }
    keyPath = value;
  }

  const rootIndex = argv.indexOf("--root");
  let root = process.cwd();
  if (rootIndex !== -1) {
    const value = argv[rootIndex + 1];
    if (!value || value.startsWith("--")) {
      console.error("\u2717 --root requires a directory argument");
      process.exit(1);
    }
    root = resolve(value);
  }

  if (verifyMode && keyPath !== undefined) {
    console.error(
      "\u2717 --verify does not take --key; verification reads the key from the .sig file itself",
    );
    process.exit(1);
  }

  return { verifyMode, keyPath, root };
}

// ---------------------------------------------------------------------------
// Key handling
// ---------------------------------------------------------------------------

/** The raw 32-byte Ed25519 public key inside a KeyObject's SPKI DER export. */
function rawPublicKeyBytes(publicKeyObject) {
  const der = publicKeyObject.export({ format: "der", type: "spki" });
  return der.subarray(der.length - 32);
}

/** Reconstruct the public KeyObject a `keyId` names, or throw naming why not. */
function publicKeyFromKeyId(keyId) {
  const raw = Buffer.from(keyId, "base64url");
  if (raw.length !== 32) {
    throw new Error(
      `keyId decodes to ${raw.length} byte(s); a raw Ed25519 public key is 32 bytes`,
    );
  }
  const der = Buffer.concat([ED25519_SPKI_DER_PREFIX, raw]);
  return createPublicKey({ key: der, format: "der", type: "spki" });
}

/** The signing key's PEM text, from `--key` when given, else `MARKETPLACE_SIGNING_KEY`. */
function readPrivateKeyPem(keyPath) {
  if (keyPath !== undefined) {
    if (!existsSync(keyPath)) {
      console.error(`\u2717 --key '${keyPath}' does not exist`);
      process.exit(1);
    }
    return readFileSync(keyPath, "utf8");
  }
  const fromEnv = process.env.MARKETPLACE_SIGNING_KEY;
  if (fromEnv === undefined || fromEnv.trim().length === 0) {
    console.error(
      "\u2717 no signing key given: pass --key <path.pem>, or set the MARKETPLACE_SIGNING_KEY environment variable to the PEM contents",
    );
    process.exit(1);
  }
  return fromEnv;
}

// ---------------------------------------------------------------------------
// Sign
// ---------------------------------------------------------------------------

function doSign(root, keyPath) {
  const indexPath = join(root, INDEX_FILENAME);
  if (!existsSync(indexPath)) {
    console.error(`\u2717 ${INDEX_FILENAME} does not exist at '${root}'`);
    process.exitCode = 1;
    return;
  }

  const pem = readPrivateKeyPem(keyPath);
  let privateKey;
  try {
    privateKey = createPrivateKey({ key: pem, format: "pem" });
  } catch (error) {
    console.error(`\u2717 could not read the private key: ${error.message}`);
    process.exitCode = 1;
    return;
  }
  if (privateKey.asymmetricKeyType !== "ed25519") {
    console.error(
      `\u2717 the key is '${privateKey.asymmetricKeyType}', not 'ed25519'`,
    );
    process.exitCode = 1;
    return;
  }

  // The exact bytes as committed, never a re-serialization: see the header
  // comment for why that distinction is load-bearing.
  const indexBytes = readFileSync(indexPath);
  // The `algorithm` argument to `sign`/`verify` must be `null` for Ed25519:
  // the scheme has no separate hash-algorithm choice to make, unlike RSA or
  // ECDSA, and Node signals that by refusing anything else here.
  const signature = sign(null, indexBytes, privateKey);
  const publicKey = createPublicKey(privateKey);
  const keyId = rawPublicKeyBytes(publicKey).toString("base64url");

  const sigFile = {
    schemaVersion: SCHEMA_VERSION,
    alg: ALG,
    keyId,
    signature: signature.toString("base64url"),
  };
  writeFileSync(
    join(root, SIG_FILENAME),
    `${JSON.stringify(sigFile, null, 2)}\n`,
    "utf8",
  );
  console.log(`\u2713 wrote ${SIG_FILENAME} (keyId ${keyId})`);
  process.exitCode = 0;
}

// ---------------------------------------------------------------------------
// Verify
// ---------------------------------------------------------------------------

function doVerify(root) {
  const indexPath = join(root, INDEX_FILENAME);
  const sigPath = join(root, SIG_FILENAME);

  if (!existsSync(indexPath)) {
    console.error(`\u2717 ${INDEX_FILENAME} does not exist at '${root}'`);
    process.exitCode = 1;
    return;
  }
  if (!existsSync(sigPath)) {
    console.error(`\u2717 ${SIG_FILENAME} does not exist at '${root}'`);
    process.exitCode = 1;
    return;
  }

  let sigFile;
  try {
    sigFile = JSON.parse(readFileSync(sigPath, "utf8"));
  } catch (error) {
    console.error(`\u2717 ${SIG_FILENAME} is not valid JSON: ${error.message}`);
    process.exitCode = 1;
    return;
  }
  if (
    typeof sigFile !== "object" ||
    sigFile === null ||
    Array.isArray(sigFile)
  ) {
    console.error(`\u2717 ${SIG_FILENAME} must be a JSON object`);
    process.exitCode = 1;
    return;
  }
  if (sigFile.schemaVersion !== SCHEMA_VERSION) {
    console.error(
      `\u2717 ${SIG_FILENAME}: 'schemaVersion' must be ${SCHEMA_VERSION}`,
    );
    process.exitCode = 1;
    return;
  }
  if (sigFile.alg !== ALG) {
    console.error(`\u2717 ${SIG_FILENAME}: 'alg' must be '${ALG}'`);
    process.exitCode = 1;
    return;
  }
  if (typeof sigFile.keyId !== "string" || sigFile.keyId.length === 0) {
    console.error(`\u2717 ${SIG_FILENAME}: 'keyId' must be a non-empty string`);
    process.exitCode = 1;
    return;
  }
  if (typeof sigFile.signature !== "string" || sigFile.signature.length === 0) {
    console.error(
      `\u2717 ${SIG_FILENAME}: 'signature' must be a non-empty string`,
    );
    process.exitCode = 1;
    return;
  }

  let publicKey;
  try {
    publicKey = publicKeyFromKeyId(sigFile.keyId);
  } catch (error) {
    console.error(
      `\u2717 ${SIG_FILENAME}: malformed 'keyId': ${error.message}`,
    );
    process.exitCode = 1;
    return;
  }

  const signature = Buffer.from(sigFile.signature, "base64url");
  const indexBytes = readFileSync(indexPath);

  let valid;
  try {
    valid = verify(null, indexBytes, publicKey, signature);
  } catch (error) {
    console.error(
      `\u2717 ${SIG_FILENAME}: signature could not be verified: ${error.message}`,
    );
    process.exitCode = 1;
    return;
  }

  if (!valid) {
    console.error(
      `\u2717 ${SIG_FILENAME} does not verify against the current ${INDEX_FILENAME}`,
    );
    console.error(
      `\u2717 either ${INDEX_FILENAME} changed since it was signed, or ${SIG_FILENAME} was signed by a different key; run 'node tools/sign.mjs --key <path.pem>' to re-sign`,
    );
    process.exitCode = 1;
    return;
  }

  console.log(
    `\u2713 ${SIG_FILENAME} verifies against ${INDEX_FILENAME} (keyId ${sigFile.keyId})`,
  );
  console.log(
    "\u2713 this proves integrity and freshness only; whether this key is TRUSTED is Bonsai's decision, not this script's",
  );
  process.exitCode = 0;
}

// ---------------------------------------------------------------------------
// Orchestration
// ---------------------------------------------------------------------------

function main() {
  const { verifyMode, keyPath, root } = parseArgs(process.argv.slice(2));

  if (!existsSync(root)) {
    console.error(`\u2717 --root '${root}' is not a directory`);
    process.exitCode = 1;
    return;
  }

  if (verifyMode) {
    doVerify(root);
    return;
  }

  doSign(root, keyPath);
}

try {
  main();
} catch (error) {
  console.error(
    `\u2717 sign.mjs crashed: ${error instanceof Error ? error.message : String(error)}`,
  );
  process.exitCode = 1;
}
