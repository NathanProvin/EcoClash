/// <reference types="vite/client" />

// Client configuration (INSTRUCTIONS §14): every variable is documented in .env.example.
interface ImportMetaEnv {
  /** The build shown on the main menu: commit and date, set by the deploy job (D-157). */
  readonly VITE_BUILD?: string;
  /** Where the "Send feedback" link on the main menu points; no link when unset (D-157). */
  readonly VITE_FEEDBACK_URL?: string;
}
