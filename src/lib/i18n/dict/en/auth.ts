import type { AuthDict } from "../tr/auth.ts";

export const auth: AuthDict = {
  login: {
    username: "Username",
    password: "Password",
    remember: "Remember me",
    rememberHint: "Stay signed in on this device. Do not tick this on a shared machine.",
    submit: "Sign in",
    submitBusy: "Signing in…",
    failed: "Could not sign in.",
    backToApps: "Back to apps",
  },

  twoFactor: {
    title: "Two-factor authentication",
    hint: "Enter the 6-digit code from your authenticator app. If you do not have your phone, you can type one of your recovery codes.",
    submit: "Verify",
    submitBusy: "Verifying…",
    restart: "Start over",
    failed: "Could not be verified.",
  },

  password: {
    title: "Change password",
    forcedNotice:
      "The first-login password appears in the setup log. You must change it before continuing.",
    current: "Current password",
    next: "New password (at least {min} characters)",
    repeat: "New password (again)",
    submit: "Change password",
    submitBusy: "Changing…",
    mismatch: "The new passwords do not match.",
    failed: "Could not change the password.",
  },
};
