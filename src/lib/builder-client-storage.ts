export const BUILDER_CHAT_SESSION_KEY = "builder_chat_session_id";
export const BUILDER_SITE_ID_KEY = "builder_site_id";
export const BUILDER_BUILD_RUN_KEY = "builder_build_run_id";

export function clearBuilderClientStorage() {
  localStorage.removeItem(BUILDER_CHAT_SESSION_KEY);
  localStorage.removeItem(BUILDER_SITE_ID_KEY);
  localStorage.removeItem(BUILDER_BUILD_RUN_KEY);
}
