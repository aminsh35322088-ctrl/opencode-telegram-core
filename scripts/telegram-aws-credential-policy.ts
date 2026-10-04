import type { BunPlugin } from "bun";
import path from "node:path";

// credential_process is an optional CLI capability, not a Telegram provider
// requirement. Never substitute an unowned SDK child or fall back to a different
// identity when the selected profile requests it. Non-process chain links remain.
export const telegramAwsCredentialPolicy: BunPlugin = {
  name: "telegram-aws-credential-policy",
  setup(build) {
    build.onResolve(
      { filter: /^@aws-sdk\/credential-provider-process$/ },
      (args) => ({
        path: args.resolveDir,
        namespace: "telegram-aws-credential-policy",
      }),
    );
    build.onLoad(
      { filter: /.*/, namespace: "telegram-aws-credential-policy" },
      (args) => ({
        loader: "js",
        resolveDir: args.path,
        contents: `
        import { CredentialsProviderError, getProfileName, parseKnownFiles } from "@smithy/core/config";
        export const fromProcess = (init = {}) => async ({ callerClientConfig } = {}) => {
          const profiles = await parseKnownFiles(init);
          const profile = getProfileName({ profile: init.profile ?? callerClientConfig?.profile });
          const configured = profiles[profile]?.credential_process !== undefined;
          throw new CredentialsProviderError(configured
            ? "AWS credential_process is unsupported in Telegram Core; use a supported credential source"
            : "No AWS process credentials configured", { logger: init.logger, tryNextLink: !configured });
        };
      `,
      }),
    );
  },
};

// The retained Azure provider supports API keys. Its upstream CLI OAuth loader
// launches an implicit process without execution cancellation ownership. Exclude
// that optional mechanism rather than claiming a utility lease owns the request.
export const telegramAzureCredentialPolicy: BunPlugin = {
  name: "telegram-azure-credential-policy",
  setup(build) {
    build.onResolve(
      { filter: /(?:^\.\/azure$|\/src\/plugin\/azure\.ts$)/ },
      (args) => {
        if (
          args.path === "./azure" &&
          !args.importer.endsWith("/src/plugin/index.ts")
        )
          return;
        return {
          path:
            args.path === "./azure" ? args.resolveDir : path.dirname(args.path),
          namespace: "telegram-azure-credential-policy",
        };
      },
    );
    build.onLoad(
      { filter: /.*/, namespace: "telegram-azure-credential-policy" },
      (args) => ({
        loader: "js",
        resolveDir: args.path,
        contents: `
        import { APICallError } from "@ai-sdk/provider";
        export async function AzureAuthPlugin() {
          return { auth: { provider: "azure", methods: [{type: "api", label: "API key"}],
            async loader(getAuth) {
              if ((await getAuth()).type !== "oauth") return {};
              return { apiKey: "opencode-oauth-dummy-key", async fetch() {
                throw new APICallError({
                  message: "Azure CLI OAuth is unsupported in Telegram Core; use Azure API-key credentials",
                  url: "azure", requestBodyValues: undefined, statusCode: 400, isRetryable: false,
                });
              }};
            },
          }};
        }
      `,
      }),
    );
  },
};
