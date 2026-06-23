import Anthropic from "@anthropic-ai/sdk";

let client: Anthropic | undefined;

export function getClient(): Anthropic {
  if (!client) {
    if (!process.env["ANTHROPIC_API_KEY"]) {
      throw new Error(
        "ANTHROPIC_API_KEY not set. Export it or create a .env file.\n" +
          "  export ANTHROPIC_API_KEY=sk-ant-..."
      );
    }
    client = new Anthropic();
  }
  return client;
}

export function isMockMode(): boolean {
  return process.env["POLO_MOCK"] === "1";
}
