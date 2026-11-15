// Stores the app's secrets as SSM Parameter Store SecureStrings (KMS-encrypted, free tier), where
// the ECS service reads them at task start. Run once before the first deploy, and again whenever a
// value changes (then redeploy, or force a new deployment, so running tasks pick it up).
//
//   npm run secrets                       # reads ../.env and ../.env.neon-sydney
//   npm run secrets -- --db-env ../.env.neon
//
// Values are never printed.
import { readFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { PutParameterCommand, SSMClient } from "@aws-sdk/client-ssm";
import { PARAMETER_PREFIX, SECRET_NAMES } from "../lib/brewbot-stack.ts";

const { values: args } = parseArgs({
  options: {
    env: { type: "string", default: "../.env" },
    "db-env": { type: "string", default: "../.env.neon-sydney" },
  },
});

function readEnvFile(file: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of readFileSync(file, "utf8").split(/\r?\n/)) {
    const match = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
    if (match) out[match[1]!] = match[2]!.replace(/^"(.*)"$/, "$1");
  }
  return out;
}

const appEnv = readEnvFile(args.env!);
const dbEnv = readEnvFile(args["db-env"]!);
const values: Record<(typeof SECRET_NAMES)[number], string | undefined> = {
  // The pooled connection string of the database next to the deployment.
  DATABASE_URL: dbEnv.DATABASE_URL,
  // Falls back to the shell environment, where many people keep API keys.
  GEMINI_API_KEY: appEnv.GEMINI_API_KEY || process.env.GEMINI_API_KEY,
  ADMIN_TOKEN: appEnv.ADMIN_TOKEN,
};

const missing = SECRET_NAMES.filter((name) => !values[name]);
if (missing.length) {
  console.error(`Missing values for: ${missing.join(", ")}. Nothing was written.`);
  process.exit(1);
}
if (values.ADMIN_TOKEN!.length < 16) {
  console.error("ADMIN_TOKEN must be at least 16 characters. Nothing was written.");
  process.exit(1);
}

const ssm = new SSMClient({});
const region = await ssm.config.region();
for (const name of SECRET_NAMES) {
  await ssm.send(
    new PutParameterCommand({
      Name: `${PARAMETER_PREFIX}/${name}`,
      Value: values[name],
      Type: "SecureString",
      Overwrite: true,
      Description: "BrewBot app secret (read by the ECS task at start)",
    }),
  );
  console.log(`Stored ${PARAMETER_PREFIX}/${name} in ${region}`);
}
