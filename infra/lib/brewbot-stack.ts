import path from "node:path";
import { fileURLToPath } from "node:url";
import { CfnOutput, IgnoreMode, RemovalPolicy, Stack, type StackProps } from "aws-cdk-lib";
import * as ecrAssets from "aws-cdk-lib/aws-ecr-assets";
import * as ecs from "aws-cdk-lib/aws-ecs";
import * as iam from "aws-cdk-lib/aws-iam";
import * as logs from "aws-cdk-lib/aws-logs";
import type { Construct } from "constructs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

/** SecureString parameters created by `npm run secrets` before the first deploy. Never in this template. */
export const SECRET_NAMES = ["DATABASE_URL", "GEMINI_API_KEY", "ADMIN_TOKEN"] as const;
export const PARAMETER_PREFIX = "/brewbot";

/**
 * BrewBot on Amazon ECS Express Mode: one Fargate service behind an HTTPS Application Load
 * Balancer that ECS creates and manages (certificate, listener rule, security groups, auto
 * scaling, deployment alarms). The image is built from the repo's Dockerfile and pushed to ECR
 * by `cdk deploy`. Networking is the Region's default VPC (public subnets, so no NAT gateway).
 */
export class BrewbotStack extends Stack {
  constructor(scope: Construct, id: string, props: StackProps) {
    super(scope, id, props);

    const image = new ecrAssets.DockerImageAsset(this, "Image", {
      directory: repoRoot,
      platform: ecrAssets.Platform.LINUX_AMD64,
      // Honour .dockerignore so .env files never enter the build context.
      ignoreMode: IgnoreMode.DOCKER,
    });

    // Short retention: this is a demo, and logs are billed by the GB stored.
    const logGroup = new logs.LogGroup(this, "Logs", {
      logGroupName: "/ecs/brewbot",
      retention: logs.RetentionDays.ONE_WEEK,
      removalPolicy: RemovalPolicy.DESTROY,
    });

    const parameterArn = (name: string) =>
      Stack.of(this).formatArn({ service: "ssm", resource: "parameter", resourceName: `${PARAMETER_PREFIX.slice(1)}/${name}` });

    // Used by ECS to pull the image, write logs and read the secrets at task start.
    const executionRole = new iam.Role(this, "ExecutionRole", {
      assumedBy: new iam.ServicePrincipal("ecs-tasks.amazonaws.com"),
      managedPolicies: [iam.ManagedPolicy.fromAwsManagedPolicyName("service-role/AmazonECSTaskExecutionRolePolicy")],
    });
    executionRole.addToPolicy(
      new iam.PolicyStatement({
        actions: ["ssm:GetParameters"],
        resources: SECRET_NAMES.map(parameterArn),
      }),
    );

    // Used by ECS to create and manage the load balancer, certificate, security groups and scaling.
    const infrastructureRole = new iam.Role(this, "InfrastructureRole", {
      assumedBy: new iam.ServicePrincipal("ecs.amazonaws.com"),
      managedPolicies: [
        iam.ManagedPolicy.fromAwsManagedPolicyName("service-role/AmazonECSInfrastructureRoleforExpressGatewayServices"),
      ],
    });

    const service = new ecs.CfnExpressGatewayService(this, "Service", {
      serviceName: "brewbot",
      infrastructureRoleArn: infrastructureRole.roleArn,
      executionRoleArn: executionRole.roleArn,
      // The smallest Fargate size: the app mostly waits on Gemini and Postgres.
      cpu: "256",
      memory: "512",
      // Liveness only: doesn't query the database, so health checks don't keep Neon awake.
      healthCheckPath: "/ping",
      scalingTarget: { minTaskCount: 1, maxTaskCount: 2, autoScalingMetric: "AVERAGE_CPU", autoScalingTargetValue: 70 },
      primaryContainer: {
        image: image.imageUri,
        containerPort: 8080,
        awsLogsConfiguration: { logGroup: logGroup.logGroupName, logStreamPrefix: "brewbot" },
        environment: [
          { name: "PORT", value: "8080" },
          { name: "LLM_PROVIDER", value: "gemini" },
          { name: "EMBEDDING_PROVIDER", value: "gemini" },
          // One proxy in front: the Application Load Balancer.
          { name: "TRUST_PROXY_HOPS", value: "1" },
        ],
        secrets: SECRET_NAMES.map((name) => ({ name, valueFrom: parameterArn(name) })),
      },
    });
    // The roles' policies must exist before ECS uses them.
    service.node.addDependency(executionRole, infrastructureRole);

    // The endpoint already includes the https:// scheme.
    new CfnOutput(this, "Url", { value: service.attrEndpoint, description: "Public HTTPS URL" });
    new CfnOutput(this, "LogGroup", { value: logGroup.logGroupName });
  }
}
