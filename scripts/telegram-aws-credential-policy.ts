import type { BunPlugin } from "bun"

// credential_process is an optional CLI capability, not a Telegram provider
// requirement. Never substitute an unowned SDK child or fall back to a different
// identity when the selected profile requests it. Non-process chain links remain.
export const telegramAwsCredentialPolicy: BunPlugin = {
  name: "telegram-aws-credential-policy",
  setup(build) {
    build.onResolve({ filter: /^@aws-sdk\/credential-provider-process$/ }, args => ({
      path: args.resolveDir,
      namespace: "telegram-aws-credential-policy",
    }))
    build.onLoad({ filter: /.*/, namespace: "telegram-aws-credential-policy" }, args => ({
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
    }))
  },
}
