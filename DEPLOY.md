# Deployment Guide — pyxis-payment-mcp

This guide covers deploying the `pyxis-payment-mcp` HTTP bridge to AWS App Runner
and rebuilding the Android demo APK after each deployment.

---

## Prerequisites

Before you start, make sure you have:

- **AWS CLI v2** — [Install guide](https://docs.aws.amazon.com/cli/latest/userguide/install-cliv2.html)
- **Docker Desktop** (or Docker Engine) running locally
- **Node.js 20+** (for local build verification)
- **AWS credentials** configured with permissions for:
  - Amazon ECR (push images)
  - AWS App Runner (create/update services)
  - IAM (create role — first time only)

Verify your setup:

```bash
aws --version                        # should be 2.x
docker --version                     # should be 24.x or later
aws sts get-caller-identity          # confirms credentials are working
```

---

## Section 1 — ECR Setup (first time only)

### 1.1 Set environment variables

```bash
export AWS_ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)
export AWS_REGION=us-east-1   # change to your preferred region
```

### 1.2 Authenticate Docker to ECR

```bash
aws ecr get-login-password --region $AWS_REGION \
  | docker login --username AWS --password-stdin \
    $AWS_ACCOUNT_ID.dkr.ecr.$AWS_REGION.amazonaws.com
```

### 1.3 Create the ECR repository

```bash
aws ecr create-repository \
  --repository-name pyxis-payment-mcp \
  --region $AWS_REGION
```

> **Note:** Only run this once. If the repository already exists, skip this step.

---

## Section 2 — Build and Push Docker Image

Run these commands from the `pyxis-payment-mcp/` directory every time you want to deploy a new version.

```bash
# Build the image for linux/amd64 (required for App Runner — even on Apple Silicon Macs)
docker build --platform linux/amd64 -t pyxis-payment-mcp .

# Tag it for ECR
docker tag pyxis-payment-mcp:latest \
  $AWS_ACCOUNT_ID.dkr.ecr.$AWS_REGION.amazonaws.com/pyxis-payment-mcp:latest

# Push to ECR
docker push \
  $AWS_ACCOUNT_ID.dkr.ecr.$AWS_REGION.amazonaws.com/pyxis-payment-mcp:latest
```

> **Important — Apple Silicon Macs:** Always use `--platform linux/amd64` when building.
> Without it, Podman/Docker builds an ARM64 image that fails on App Runner with
> `exec format error` (exit code 255).

---

## Section 3 — Create App Runner Service (first time only)

### 3.1 Create the IAM role for ECR access

```bash
# Create the trust policy file
cat > /tmp/apprunner-trust.json << 'EOF'
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Principal": {
        "Service": "build.apprunner.amazonaws.com"
      },
      "Action": "sts:AssumeRole"
    }
  ]
}
EOF

# Create the role
aws iam create-role \
  --role-name AppRunnerECRAccessRole \
  --assume-role-policy-document file:///tmp/apprunner-trust.json

# Attach the managed policy
aws iam attach-role-policy \
  --role-name AppRunnerECRAccessRole \
  --policy-arn arn:aws:iam::aws:policy/service-role/AWSAppRunnerServicePolicyForECRAccess
```

> **Note:** Only run this once. The same role can be reused for future App Runner services.

### 3.2 Fill in the config template

Edit `apprunner-config.json` and replace the placeholders:

| Placeholder | Replace with |
|---|---|
| `<ACCOUNT_ID>` | Your AWS account ID (from `aws sts get-caller-identity`) |
| `<REGION>` | Your AWS region (e.g., `us-east-1`) |
| `<demo-username>` | The demo MCP username (e.g., `sandbox`) |
| `<demo-password>` | The demo MCP password (e.g., `sandbox`) |

### 3.3 Create the App Runner service

```bash
aws apprunner create-service \
  --cli-input-json file://apprunner-config.json \
  --region $AWS_REGION
```

The command returns a JSON response. Copy the `ServiceUrl` value — this is your stable HTTPS URL:

```
"ServiceUrl": "abc123xyz.us-east-1.awsapprunner.com"
```

The full URL is: `https://abc123xyz.us-east-1.awsapprunner.com`

> **Important:** Save this URL. You will need it to configure the Android demo APK (Section 5).

---

## Section 4 — Redeployment

When you push a new image to ECR, App Runner automatically deploys it because
`AutoDeploymentsEnabled` is set to `true` in `apprunner-config.json`.

**Redeploy steps:**

```bash
# 1. Rebuild and push the new image (same as Section 2)
docker build --platform linux/amd64 -t pyxis-payment-mcp .
docker tag pyxis-payment-mcp:latest \
  $AWS_ACCOUNT_ID.dkr.ecr.$AWS_REGION.amazonaws.com/pyxis-payment-mcp:latest
docker push \
  $AWS_ACCOUNT_ID.dkr.ecr.$AWS_REGION.amazonaws.com/pyxis-payment-mcp:latest

# 2. App Runner detects the new image and redeploys automatically.
#    To trigger manually instead:
SERVICE_ARN=$(aws apprunner list-services --region $AWS_REGION \
  --query "ServiceSummaryList[?ServiceName=='pyxis-payment-mcp-demo'].ServiceArn" \
  --output text)

aws apprunner start-deployment \
  --service-arn $SERVICE_ARN \
  --region $AWS_REGION
```

---

## Section 5 — Update Android URL and Rebuild APK

After the App Runner service is running, update the Android app to point to it.

### 5.1 Update the demo flavor URL

Open `dark-wizards-mobile-pay-processor/app/build.gradle.kts` and replace the
`YOUR_APP_RUNNER_URL` placeholder in the `demo` product flavor with your actual
App Runner URL:

```kotlin
create("demo") {
    dimension = "env"
    // Replace with your actual App Runner ServiceUrl
    buildConfigField("String", "MCP_BASE_URL", "\"https://abc123xyz.us-east-1.awsapprunner.com\"")
}
```

### 5.2 Build the demo APK

```bash
cd dark-wizards-mobile-pay-processor
./gradlew assembleDemoRelease
```

Output APK location:

```
app/build/outputs/apk/demo/release/app-demo-release-unsigned.apk
```

### 5.3 Install on a device

```bash
adb install app/build/outputs/apk/demo/release/app-demo-release-unsigned.apk
```

> **Note:** If the App Runner service is ever recreated with a different service name,
> the URL will change. Update `build.gradle.kts` and rebuild the APK before sharing.

---

## Smoke Test Checklist

Run these checks after every deployment before sharing the demo.

### ✅ 1. Health endpoint

```bash
curl -s https://<YOUR_APP_RUNNER_URL>/health
```

Expected response: `{"status":"ok"}` with HTTP 200.

### ✅ 2. JSON-RPC tool call

```bash
curl -s -X POST https://<YOUR_APP_RUNNER_URL> \
  -H "Content-Type: application/json" \
  -d '{
    "jsonrpc": "2.0",
    "id": 1,
    "method": "tools/call",
    "params": {
      "name": "pyxis_get_token",
      "arguments": {
        "username": "<demo-username>",
        "password": "<demo-password>"
      }
    }
  }'
```

Expected: JSON-RPC response with `result.content[0].text` containing `{"status":"Success","token":"..."}`.

### ✅ 3. Demo APK on a physical device

1. Install the APK: `adb install app-demo-release-unsigned.apk`
2. Open the app on a device connected to a real network (not emulator localhost).
3. Complete a full payment flow: get token → process sale → view transaction in report.
4. Confirm the transaction appears in the Transaction Report screen.

### ✅ 4. Local dev build still works

1. Start the local server: `npm run http` (inside `pyxis-payment-mcp/`)
2. Build and run the `devDebug` variant in Android Studio.
3. Confirm the app connects to `http://10.0.2.2:3000` and completes a payment flow.
