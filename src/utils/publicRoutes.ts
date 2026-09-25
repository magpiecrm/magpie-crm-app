/**
 * Pages served to people who aren't logged in (survey respondents). The root
 * route skips its auth redirect for these and renders them without the app
 * shell (sidebar, copilot, notification bell).
 */
export function isPublicPath(pathname: string): boolean {
  return pathname.startsWith('/s/')
}
