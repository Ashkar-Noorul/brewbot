import { App, Tags } from "aws-cdk-lib";
import { BrewbotStack } from "../lib/brewbot-stack.ts";

const app = new App();

// Account and Region come from the AWS CLI profile you're signed in with (`aws login`).
// Every resource is created in that one Region.
const region = process.env.CDK_DEFAULT_REGION;
if (!region) throw new Error("No AWS Region configured. Run `aws login` (or `aws configure`) first.");

const stack = new BrewbotStack(app, "Brewbot", {
  env: { account: process.env.CDK_DEFAULT_ACCOUNT, region },
  description: "BrewBot RAG support chatbot on Amazon ECS Express Mode (Fargate)",
});
Tags.of(stack).add("project", "brewbot");
