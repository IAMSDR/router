import { BEDROCK_REGIONS, BEDROCK_DEFAULT_REGION } from "../../config/bedrock.js";

const bedrock = {
  id: "bedrock",
  alias: "bedrock",
  aliases: ["aws-bedrock"],
  uiAlias: "bedrock",
  display: {
    name: "Amazon Bedrock",
    icon: "cloud",
    color: "#FF9900",
    textIcon: "BR",
    website: "https://aws.amazon.com/bedrock/",
    notice: {
      text: "Use your Amazon Bedrock API Key and select your AWS region. Bedrock's native Converse API is called directly.",
      apiKeyUrl: "https://aws.amazon.com/bedrock/",
    },
  },
  category: "apikey",
  authType: "apikey",
  hasProviderSpecificData: true,
  regions: BEDROCK_REGIONS,
  defaultRegion: BEDROCK_DEFAULT_REGION,
  passthroughModels: true,
  transport: {
    baseUrl: `https://bedrock-runtime.${BEDROCK_DEFAULT_REGION}.amazonaws.com`,
    format: "openai",
  },
  models: [
    { id: "anthropic.claude-sonnet-4-6", name: "Claude Sonnet 4.6 (Bedrock)" },
    { id: "anthropic.claude-sonnet-4-5", name: "Claude Sonnet 4.5 (Bedrock)" },
    { id: "anthropic.claude-opus-4-6", name: "Claude Opus 4.6 (Bedrock)" },
    { id: "anthropic.claude-opus-4-7", name: "Claude Opus 4.7 (Bedrock)" },
    { id: "anthropic.claude-haiku-4-5", name: "Claude Haiku 4.5 (Bedrock)" },
    { id: "anthropic.claude-3-7-sonnet-20250219-v1:0", name: "Claude 3.7 Sonnet (Bedrock)" },
    { id: "anthropic.claude-3-5-sonnet-20241022-v2:0", name: "Claude 3.5 Sonnet v2 (Bedrock)" },
    { id: "anthropic.claude-3-5-haiku-20241022-v1:0", name: "Claude 3.5 Haiku (Bedrock)" },
    { id: "amazon.nova-pro-v1:0", name: "Amazon Nova Pro" },
    { id: "amazon.nova-lite-v1:0", name: "Amazon Nova Lite" },
    { id: "amazon.nova-micro-v1:0", name: "Amazon Nova Micro" },
    { id: "meta.llama3-3-70b-instruct-v1:0", name: "Llama 3.3 70B Instruct (Bedrock)" },
    { id: "meta.llama3-1-70b-instruct-v1:0", name: "Llama 3.1 70B Instruct (Bedrock)" },
    { id: "meta.llama3-1-8b-instruct-v1:0", name: "Llama 3.1 8B Instruct (Bedrock)" },
    { id: "mistral.mistral-large-2407-v1:0", name: "Mistral Large 2407 (Bedrock)" },
    { id: "cohere.command-r-plus-v1:0", name: "Cohere Command R+ (Bedrock)" },
  ],
};

export default bedrock;
