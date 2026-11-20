const baseUrl = "https://api.cfrouter.com/v1";

const cfrouter = {
  id: "cfrouter",
  alias: "cfrouter",
  category: "apikey",
  display: {
    name: "Cf Router",
    icon: "hub",
    color: "#2563EB",
    textIcon: "CF",
    website: "https://cfrouter.com",
  },
  transport: {
    baseUrl: `${baseUrl}/chat/completions`,
    validateUrl: `${baseUrl}/models`,
    usage: { url: "https://cfrouter.com/usage/api/all" },
  },
  // Catalog is discovered from /models or managed through the compatible-provider controls.
  models: [],
  passthroughModels: true,
  features: {
    usage: true,
    usageApikey: true,
  },
};

export default cfrouter;
