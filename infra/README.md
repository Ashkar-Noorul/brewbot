# BrewBot on AWS (ECS Express Mode)

AWS CDK app (TypeScript) that runs BrewBot on **Amazon ECS Express Mode**: one Fargate service behind an HTTPS Application Load Balancer that ECS creates and manages, with auto scaling and CloudWatch logs.

```
visitor ──HTTPS──► Application Load Balancer (ECS-managed, ACM certificate)
                        │
                        ▼
                 ECS Fargate task (0.25 vCPU / 0.5 GB, 1–2 tasks)
                 image built from ../Dockerfile, pushed to ECR by cdk deploy
                 secrets from SSM Parameter Store (SecureString, KMS-encrypted)
                        │
                        ├──► Neon Postgres + pgvector in the same Region
                        └──► Gemini API
```

| Resource | Purpose |
|---|---|
| `AWS::ECS::ExpressGatewayService` | The service; ECS creates the load balancer, certificate, security groups, scaling policy and deployment alarms |
| Execution role | Pulls the image, writes logs, reads the three `/brewbot/*` parameters (and nothing else) |
| Infrastructure role | Lets ECS manage the load balancer and scaling (`AmazonECSInfrastructureRoleforExpressGatewayServices`) |
| Log group `/ecs/brewbot` | Container logs, kept for one week |

Secrets never appear in the code, the image or the CloudFormation template. Networking uses the Region's default VPC (public subnets), so there is no NAT gateway to pay for.

## Deploy

Prerequisites: AWS CLI v2 signed in (`aws login`) with your project's Region, Docker running, and a Postgres database with the docs ingested (`npm run ingest` from the repo root with that `DATABASE_URL`).

```bash
cd infra
npm install
npm run secrets              # stores DATABASE_URL, GEMINI_API_KEY, ADMIN_TOKEN as SecureStrings
npx cdk bootstrap            # once per account and Region
npm run diff                 # review what will be created
npm run deploy               # builds the image, pushes it to ECR, creates the stack; prints the URL
```

`npm run secrets` reads `../.env` and `../.env.neon-sydney`; pass `--env` / `--db-env` to use other files. After changing a secret, redeploy (or force a new deployment) so new tasks read it.

## Cost and cleanup

Roughly $35–40 a month while running (Fargate task, load balancer, public IPv4 addresses), so check the AWS Pricing Calculator for your Region. To remove everything:

```bash
npm run destroy
```

The SSM parameters and the CDK bootstrap stack are not part of this stack; delete them separately if you no longer need them.
