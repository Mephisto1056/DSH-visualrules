/** Stable identifiers shared by the Host half. */

export const PLUGIN_ID = 'visualrules'
export const API_PREFIX = '/api/visualrules'

/** The one section this plugin contributes to a Session's system prompt. */
export const PROMPT_SECTION_NAME = 'visualrules:workspace-rules'
/** After first-party guidance, before the harness environment suffix (10_000). */
export const PROMPT_SECTION_ORDER = 9_900
/** Follows the workspace-rules section; carries recent commit-validation feedback. */
export const PROMPT_GUARD_SECTION_NAME = 'visualrules:commit-feedback'
export const PROMPT_GUARD_SECTION_ORDER = 9_901

/** Domain/table names are restricted by the storage-domain package. */
export const DOMAIN_NAME = 'dsh_visualrules'
export const DOMAIN_VERSION = 1

/** Used only when the Host cannot report a context window. */
export const FALLBACK_PROMPT_CHARS = 24_000
/** Share of a model's context window this plugin is allowed to occupy. */
export const PROMPT_BUDGET_RATIO = 0.06
/** Rough characters per token for the budget conversion. */
export const CHARS_PER_TOKEN = 3

export const MAX_PACK_CONTENT = 200_000
export const MAX_EXTRA_RULES = 40_000
export const MAX_TEAM_FILE_BYTES = 512_000

export const CONFIG_FILE_NAMES = ['.dsh/profile.yaml', '.dsh/profile.yml']
