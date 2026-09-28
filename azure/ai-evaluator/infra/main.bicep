// ============================================================
//  Jobs Automation — EVALUATOR provisioning (main.bicep)
//
//  Creates the AI Evaluator Function App that the Next.js frontend
//  reaches at https://jobsautomation-evaluator-v2.azurewebsites.net
//
//    - Function App (Node 22, Consumption Y1, Linux)
//    - System-assigned managed identity
//    - RBAC: Storage Blob + Queue + Table Data Contributor
//
//  ZERO-COST BY DESIGN. Like the scraper app, the messaging layer is
//  Azure Storage Queues ($0) — Service Bus (~$10/mo) was removed
//  2026-08-28. The evaluator's queues (`evaluation-requests`,
//  `resume-requests`, `cover-letter-requests`) are auto-created by the
//  runtime inside `AzureWebJobsStorage`; nothing to provision, nothing
//  to pay. See `queues.bicep` (intentionally a no-op placeholder).
//
//  The host storage account is REUSED from the scraper deployment so the
//  evaluator adds no new billable resource. Its connection string is
//  composed here via `listKeys()` — see the CRITICAL note below.
// ============================================================

param location string = resourceGroup().location

// Function App names are GLOBALLY unique. The original
// 'jobsautomation-evaluator' is still held by the AdminDisabled app in the
// OLD subscription (ee2c075a), so this deploy uses '-v2'.
param functionAppName string = 'jobsautomation-evaluator-v2'

// Host storage account — shared with the scraper app (see scraper main.bicep,
// which owns the lifecycle of this account). Never create a second one; the
// evaluator's queues simply live alongside the scraper's.
param storageAccountName string = 'jobsautold46rmnuvvqpi'

@secure()
param supabaseServiceKey string

@secure()
param deepSeekApi string

@secure()
param stateWebhookSecret string

param supabaseUrl string = 'https://uqrgivzeklqehuqqqqyv.supabase.co'
param deepSeekBaseUrl string = 'https://api.deepseek.com/v1'
// MUST stay `deepseek-chat`. `deepseek-v4-flash` is a REASONING variant that
// burns tokens "thinking" before every answer (reasoning_tokens + empty
// content + slow generation). See src/lib/ai.ts.
param deepSeekModel string = 'deepseek-chat'
param stateWebhookUrl string = 'https://ai-job-server-r2dk.onrender.com/webhook/state'
param defaultCountryCode string = 'hk'

// ── Existing storage account (created by the scraper deployment) ─
resource storageAccount 'Microsoft.Storage/storageAccounts@2023-05-01' existing = {
  name: storageAccountName
}

// CRITICAL: the queue helper does
//   `process.env["AzureWebJobsStorage"]` → `QueueServiceClient.fromConnectionString(...)`
// (src/lib/storageQueue.ts). With identity-ONLY config
// (`AzureWebJobsStorage__accountName` + `__credential`) that env var can be
// absent in the worker and every enqueue throws
// "Azure Storage Queue not configured". Composing the connection string HERE
// (instead of hand-editing the portal) keeps it in IaC so a redeploy can
// never silently drop it.
var storageConnectionString = 'DefaultEndpointsProtocol=https;AccountName=${storageAccount.name};AccountKey=${storageAccount.listKeys().keys[0].value};EndpointSuffix=${environment().suffixes.storage}'

// ── Function App ───────────────────────────────────────────────
resource serverFarm 'Microsoft.Web/serverfarms@2023-01-01' = {
  name: '${functionAppName}-plan'
  location: location
  sku: {
    name: 'Y1' // Consumption — billed per execution, $0 at rest
    tier: 'Dynamic'
  }
  kind: 'functionapp'
  properties: {
    reserved: true // required for Linux
  }
}

resource functionApp 'Microsoft.Web/sites@2023-01-01' = {
  name: functionAppName
  location: location
  kind: 'functionapp,linux'
  identity: { type: 'SystemAssigned' }
  properties: {
    serverFarmId: serverFarm.id
    siteConfig: {
      linuxFxVersion: 'Node|22'
      appSettings: [
        { name: 'FUNCTIONS_WORKER_RUNTIME', value: 'node' }
        { name: 'FUNCTIONS_EXTENSION_VERSION', value: '~4' }

        // Connection string (NOT identity) — required by src/lib/storageQueue.ts.
        { name: 'AzureWebJobsStorage', value: storageConnectionString }

        // Supabase (service role — server-side only)
        { name: 'SUPABASE_URL', value: supabaseUrl }
        { name: 'SUPABASE_SERVICE_KEY', value: supabaseServiceKey }

        // DeepSeek (OpenAI-compatible)
        { name: 'DEEP_SEEK_BASE_URL', value: deepSeekBaseUrl }
        { name: 'DEEP_SEEK_API', value: deepSeekApi }
        { name: 'DEEP_SEEK_MODEL', value: deepSeekModel }

        // The evaluator's own queues (auto-created in the host storage account)
        { name: 'EvaluationQueue', value: 'evaluation-requests' }
        { name: 'ResumeQueue', value: 'resume-requests' }
        { name: 'CoverLetterQueue', value: 'cover-letter-requests' }

        // Backend Express socket push — must match the backend's secret
        { name: 'STATE_WEBHOOK_URL', value: stateWebhookUrl }
        { name: 'STATE_WEBHOOK_SECRET', value: stateWebhookSecret }

        { name: 'DefaultCountryCode', value: defaultCountryCode }
      ]
    }
  }
}

// ── RBAC: evaluator identity → shared storage account ──────────
// Role assignments are free. The QUEUE role is load-bearing: without it the
// app cannot see `evaluation-requests` / `resume-requests` /
// `cover-letter-requests` at all. The TABLE role covers the Functions runtime's
// own host state; BLOB covers generated documents.
resource storageBlobContributorRole 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(storageAccount.id, functionAppName, 'storageblob')
  scope: storageAccount
  properties: {
    roleDefinitionId: '/providers/Microsoft.Authorization/roleDefinitions/ba92f5b4-2d11-453d-a403-e96b0029c9fe' // Storage Blob Data Contributor
    principalId: functionApp.identity.principalId
    principalType: 'ServicePrincipal'
  }
}

resource storageQueueContributorRole 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(storageAccount.id, functionAppName, 'storagequeue')
  scope: storageAccount
  properties: {
    roleDefinitionId: '/providers/Microsoft.Authorization/roleDefinitions/974c5e8b-45b9-4653-ba55-5f855dd0fb88' // Storage Queue Data Contributor
    principalId: functionApp.identity.principalId
    principalType: 'ServicePrincipal'
  }
}

resource storageTableContributorRole 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(storageAccount.id, functionAppName, 'storagetable')
  scope: storageAccount
  properties: {
    roleDefinitionId: '/providers/Microsoft.Authorization/roleDefinitions/0a9a7e1f-b9d0-4cc4-a60d-0319b160aaa3' // Storage Table Data Contributor
    principalId: functionApp.identity.principalId
    principalType: 'ServicePrincipal'
  }
}

// ── Outputs ────────────────────────────────────────────────────
output functionAppName_out string = functionAppName
output functionAppDefaultHostName string = functionApp.properties.defaultHostName
// This is the value Vercel needs: NEXT_PUBLIC_EVALUATOR_URL
output evaluatorBaseUrl string = 'https://${functionApp.properties.defaultHostName}'
output principalId_out string = functionApp.identity.principalId
